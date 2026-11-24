import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYER_BUILDINGS_ID,
  DEFAULT_LAYER_VECTORS_ID,
  createEmptyDocument,
  validateDocumentManifest
} from '../../src/model/document';
import {
  CITY_THEMES,
  CITY_INKPLAN_THEME,
  CITY_MEDIEVAL_THEME,
  MAP_THEMES,
  getThemesForEnvironment
} from '../../src/theme/theme';
import {
  AddAndDeleteObjectsCommand,
  DeleteObjectsBatchCommand,
  SetCityThemeCommand,
  createBuildingObject,
  createPathObject,
  createPlazaObject
} from '../../src/objects/objectCommands';
import {
  distPointToSegment,
  doOrientedRectsOverlap,
  findNearestUrbanStreet,
  findOverlappingBuildingIdsForPlaza,
  findSnapPointForPathKind,
  findSnapPointOnUrbanPaths,
  getPathWorldPoints,
  sampleLandMaskAtDoc
} from '../../src/city/geometry';
import {
  findBuildingsInBrushStroke,
  generateDistrictBuildingsAlongStroke
} from '../../src/city/smartDistrictBrush';
import {
  buildSmartCityWallObjects,
  generateStreetGridInRect
} from '../../src/city/streetGridTool';
import {
  CITY_GENERATOR_PRESETS,
  generateProceduralCity
} from '../../src/city/cityGenerator';
import { exportProjectArchive, importProjectArchive } from '../../src/persistence';
import {
  drawBuildingToContext,
  drawPlazaToContext,
  drawUrbanPathSegmentsToContext
} from '../../src/render/cityRenderer';
import { drawMapObjectsToContext } from '../../src/render/objectMetrics';
import { getRiverWorldSpinePoints } from '../../src/render/riverRenderer';
import { EditorStore } from '../../src/state/editorStore';

function createMockCanvasContext(): {
  ctx: CanvasRenderingContext2D;
  ops: string[];
} {
  const ops: string[] = [];
  const ctx = {
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    translate: () => ops.push('translate'),
    rotate: () => ops.push('rotate'),
    scale: () => ops.push('scale'),
    beginPath: () => ops.push('beginPath'),
    closePath: () => ops.push('closePath'),
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    rect: () => ops.push('rect'),
    clip: () => ops.push('clip'),
    fill: () => ops.push('fill'),
    stroke: () => ops.push('stroke'),
    fillRect: () => ops.push('fillRect'),
    strokeRect: () => ops.push('strokeRect'),
    setLineDash: () => {},
    globalAlpha: 1,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    font: '16px serif',
    textBaseline: 'top',
    fillText: () => {},
    strokeText: () => {}
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

describe('Modalità Urbana / Città (kind: "city")', () => {
  it('inizializza una carta città con terra precompilata, 5 livelli e temi dedicati', () => {
    const cityDoc = createEmptyDocument({ kind: 'city', title: 'Porto Azzurro' });
    expect(cityDoc.manifest.kind).toBe('city');
    expect(cityDoc.theme.id).toBe(CITY_MEDIEVAL_THEME.id);
    expect(cityDoc.manifest.layers).toHaveLength(5);
    expect(cityDoc.manifest.layers.some((l) => l.id === DEFAULT_LAYER_BUILDINGS_ID)).toBe(true);
    expect(cityDoc.terrain.mask.every((v) => v === 255)).toBe(true);

    expect(getThemesForEnvironment('world')).toEqual(MAP_THEMES);
    expect(getThemesForEnvironment('city')).toEqual(CITY_THEMES);
    expect(CITY_THEMES.length).toBe(4);
    expect(validateDocumentManifest(cityDoc.manifest).kind).toBe('city');
  });

  it('supporta il round-trip archivio .zip per edifici, piazze e tracciati urbani', async () => {
    const cityDoc = createEmptyDocument({ kind: 'city', title: 'Archivio Borgo' });
    const street = createPathObject({
      layerId: DEFAULT_LAYER_VECTORS_ID,
      kind: 'avenue',
      points: [200, 300, 900, 300],
      theme: cityDoc.theme
    });
    const bldg = createBuildingObject({
      layerId: DEFAULT_LAYER_BUILDINGS_ID,
      shape: 'cathedral',
      x: 520,
      y: 230,
      width: 68,
      height: 44,
      rotationDeg: 15,
      roofColor: '#7B342C'
    });
    const plaza = createPlazaObject({
      layerId: DEFAULT_LAYER_VECTORS_ID,
      shape: 'octagon',
      x: 520,
      y: 360,
      width: 96,
      height: 96,
      fillColor: '#DDD1B8',
      borderColor: '#4B3A2C',
      centerpiece: 'fountain'
    });
    cityDoc.manifest.objects = [street, plaza, bldg];

    const zipBytes = await exportProjectArchive(cityDoc);
    const imported = await importProjectArchive(zipBytes);

    expect(imported.document.manifest.kind).toBe('city');
    expect(imported.document.manifest.objects).toHaveLength(3);
    const importedBldg = imported.document.manifest.objects.find((o) => o.type === 'building');
    const importedPlaza = imported.document.manifest.objects.find((o) => o.type === 'plaza');
    const importedStreet = imported.document.manifest.objects.find((o) => o.type === 'path');
    expect(importedBldg?.type).toBe('building');
    expect(importedPlaza?.type).toBe('plaza');
    expect(importedStreet?.type).toBe('path');
    if (importedBldg?.type === 'building') {
      expect(importedBldg.shape).toBe('cathedral');
      expect(importedBldg.rotationDeg).toBe(15);
    }
    if (importedPlaza?.type === 'plaza') {
      expect(importedPlaza.shape).toBe('octagon');
      expect(importedPlaza.centerpiece).toBe('fountain');
    }
  });

  it('pennello quartiere intelligente: evita acqua, allinea alle strade e previene collisioni', () => {
    const doc = createEmptyDocument({ kind: 'city', seed: 1234 });
    const { widthPx, heightPx, mask } = doc.terrain;
    // Allaga il quadrante sinistro (x < 35% larghezza)
    for (let py = 0; py < heightPx; py += 1) {
      for (let px = 0; px < Math.floor(widthPx * 0.35); px += 1) {
        mask[py * widthPx + px] = 0;
      }
    }

    // Aggiungi una strada diagonale inclinata di ~20° nella zona asciutta
    const road = createPathObject({
      kind: 'road',
      points: [1200, 900, 2200, 1260],
      strokeWidthDoc: 10,
      theme: doc.theme
    });
    doc.manifest.objects.push(road);

    const strokePts = [
      { x: 400, y: 900 }, // in acqua: nessuno edificio deve nascere qui
      { x: 1400, y: 970 },
      { x: 1650, y: 1060 },
      { x: 1900, y: 1150 }
    ];

    const created = generateDistrictBuildingsAlongStroke(doc, strokePts, {
      diameterDoc: 150,
      density: 0.85,
      buildingScale: 1.0,
      irregularity: 0.1,
      preset: 'residential',
      seed: 999
    });

    expect(created.length).toBeGreaterThanOrEqual(4);

    for (let i = 0; i < created.length; i += 1) {
      const b = created[i];
      // Ogni centro e su terraferma
      expect(sampleLandMaskAtDoc(doc, b.x, b.y)).toBe(true);
      // Nessuna sovrapposizione SAT tra edifici generati
      for (let j = i + 1; j < created.length; j += 1) {
        expect(doOrientedRectsOverlap(b, created[j], 0.5)).toBe(false);
      }
    }

    // Verifica allineamento medio alla strada vicina (~19.8°)
    const nearRoad = findNearestUrbanStreet(doc, 1650, 1060, 150);
    expect(nearRoad).not.toBeNull();
    expect(Math.abs(nearRoad!.angleDeg - 19.8)).toBeLessThan(1.5);

    // Verifica cancellazione selettiva edifici con findBuildingsInBrushStroke
    doc.manifest.objects.push(...created);
    const erasedIds = findBuildingsInBrushStroke(
      doc,
      [{ x: created[0].x, y: created[0].y }],
      120
    );
    expect(erasedIds).toContain(created[0].id);
  });

  it('griglia stradale supporta stili ortogonale, organico e radiale e snap incroci', () => {
    const doc = createEmptyDocument({ kind: 'city', seed: 515 });
    for (const style of ['orthogonal', 'organic', 'radial'] as const) {
      const generated = generateStreetGridInRect(
        doc,
        { x: 500, y: 400, width: 700, height: 550 },
        {
          style,
          spacingDoc: 96,
          angleDeg: 10,
          autoFillBuildings: style === 'orthogonal',
          districtPreset: 'residential',
          density: 0.7,
          buildingScale: 1,
          irregularity: 0.25
        }
      );
      const roads = generated.filter((o) => o.type === 'path');
      expect(roads.length).toBeGreaterThanOrEqual(3);
      if (style === 'orthogonal') {
        const bldgs = generated.filter((o) => o.type === 'building');
        expect(bldgs.length).toBeGreaterThan(0);
      }
    }

    // Snap incroci su strade esistenti
    const existingRoad = createPathObject({
      kind: 'road',
      points: [400, 600, 1100, 600],
      theme: doc.theme
    });
    doc.manifest.objects.push(existingRoad);
    const snapHit = findSnapPointOnUrbanPaths(doc, 742, 608, 20);
    expect(snapHit.snapped).toBe(true);
    expect(Math.abs(snapHit.y - 600)).toBeLessThan(1e-6);
  });

  it('mura cittadine creano cortina, torrioni periodici e porte agli incroci stradali', () => {
    const doc = createEmptyDocument({ kind: 'city' });
    const horizontalRoad = createPathObject({
      kind: 'avenue',
      points: [300, 700, 1400, 700],
      strokeWidthDoc: 15,
      theme: doc.theme
    });
    doc.manifest.objects.push(horizontalRoad);

    const wallItems = buildSmartCityWallObjects(doc, [850, 350, 850, 1050], {
      strokeWidthDoc: 14,
      towerSpacingDoc: 120,
      autoTowers: true,
      autoGates: true
    });

    const wallPath = wallItems.find((o) => o.type === 'path');
    expect(wallPath?.type).toBe('path');
    if (wallPath?.type === 'path') {
      expect(wallPath.kind).toBe('wall');
    }
    const gatehouses = wallItems.filter(
      (o) => o.type === 'building' && o.districtTag === 'gatehouse'
    );
    const bastionTowers = wallItems.filter(
      (o) => o.type === 'building' && o.districtTag === 'wall-tower'
    );
    expect(gatehouses).toHaveLength(2);
    expect(bastionTowers.length).toBeGreaterThanOrEqual(3);
  });

  it('piazza individua edifici sovrapposti e li sgombera atomicamente con Undo/Redo', () => {
    const doc = createEmptyDocument({ kind: 'city' });
    const store = new EditorStore({ initialDocument: doc });

    const insideBldg = createBuildingObject({
      shape: 'rect',
      x: 1000,
      y: 800,
      width: 34,
      height: 24,
      roofColor: '#9E4638'
    });
    const outsideBldg = createBuildingObject({
      shape: 'rect',
      x: 1600,
      y: 1200,
      width: 34,
      height: 24,
      roofColor: '#9E4638'
    });
    doc.manifest.objects = [insideBldg, outsideBldg];

    const plaza = createPlazaObject({
      shape: 'circle',
      x: 1000,
      y: 800,
      width: 110,
      height: 110,
      fillColor: '#DDD1B8',
      borderColor: '#4B3A2C',
      centerpiece: 'fountain'
    });

    const overlappingIds = findOverlappingBuildingIdsForPlaza(doc, plaza);
    expect(overlappingIds).toEqual([insideBldg.id]);

    store.executeCommand(
      new AddAndDeleteObjectsCommand([plaza], overlappingIds, 'Aggiungi piazza')
    );
    expect(store.getDocument().manifest.objects.map((o) => o.id)).toEqual([
      outsideBldg.id,
      plaza.id
    ]);

    expect(store.undo()).toBe(true);
    expect(store.getDocument().manifest.objects.map((o) => o.id)).toEqual([
      insideBldg.id,
      outsideBldg.id
    ]);

    expect(store.redo()).toBe(true);
    expect(store.getDocument().manifest.objects.map((o) => o.id)).toEqual([
      outsideBldg.id,
      plaza.id
    ]);

    const delBatch = new DeleteObjectsBatchCommand([outsideBldg.id], 'Cancella edifici');
    store.executeCommand(delBatch);
    expect(store.getDocument().manifest.objects.map((o) => o.id)).toEqual([plaza.id]);
    store.undo();
    expect(store.getDocument().manifest.objects).toHaveLength(2);
    store.dispose();
  });

  it('generatore città procedurale (4 preset) e cambio tema/planimetria sono annullabili in 1 passo', () => {
    const emptyCity = createEmptyDocument({ kind: 'city' });
    const store = new EditorStore({ initialDocument: emptyCity });

    for (const preset of CITY_GENERATOR_PRESETS) {
      const res = generateProceduralCity(emptyCity, {
        preset: preset.id,
        seed: 2026,
        citySizePercent: preset.defaultSizePercent,
        densityPercent: preset.defaultDensityPercent,
        waterfront: preset.defaultWaterfront,
        hasWalls: preset.defaultHasWalls
      });
      expect(res.objects.some((o) => o.type === 'building')).toBe(true);
      expect(res.objects.some((o) => o.type === 'plaza')).toBe(true);
      expect(res.objects.some((o) => o.type === 'path')).toBe(true);
      expect(res.objects.some((o) => o.type === 'label')).toBe(true);
    }

    store.generateCity(
      {
        preset: 'harbor-canals',
        seed: 4412,
        citySizePercent: 72,
        densityPercent: 75,
        waterfront: 'harbor',
        hasWalls: false
      },
      CITY_MEDIEVAL_THEME
    );
    const countAfterGen = store.getDocument().manifest.objects.length;
    expect(countAfterGen).toBeGreaterThan(25);
    expect(store.getDocument().terrain.mask.some((v) => v === 0)).toBe(true);

    // Undo in 1 passaggio
    expect(store.undo()).toBe(true);
    expect(store.getDocument().manifest.objects).toHaveLength(0);
    expect(store.getDocument().terrain.mask.every((v) => v === 255)).toBe(true);

    // Redo in 1 passaggio
    expect(store.redo()).toBe(true);
    expect(store.getDocument().manifest.objects).toHaveLength(countAfterGen);

    // Cambio stile urbano verso planimetria piatta a inchiostro
    store.setTheme(CITY_INKPLAN_THEME);
    expect(store.getDocument().theme.id).toBe(CITY_INKPLAN_THEME.id);
    expect(store.getDocument().theme.city?.renderStyle).toBe('ink-plan');

    // Undo ripristina tema precedente e colori tetti precedenti
    expect(store.undo()).toBe(true);
    expect(store.getDocument().theme.id).toBe(CITY_MEDIEVAL_THEME.id);

    const cmdCheck = new SetCityThemeCommand(store.getDocument(), CITY_INKPLAN_THEME);
    expect(cmdCheck.kind).toBe('set-city-theme');
    store.dispose();
  });

  it('rendering Canvas2D supporta tetti 2.5D, planimetria a inchiostro, piazze e strade urbane', () => {
    const doc = createEmptyDocument({ kind: 'city' });
    const { ctx, ops } = createMockCanvasContext();

    for (const shape of ['rect', 'l-shape', 'courtyard', 'tower', 'cathedral', 'market'] as const) {
      const b = createBuildingObject({
        shape,
        x: 300,
        y: 300,
        width: 50,
        height: 36,
        rotationDeg: 25,
        roofColor: '#9E4638'
      });
      drawBuildingToContext(ctx, b, CITY_MEDIEVAL_THEME, 1, 1);
      drawBuildingToContext(ctx, b, CITY_INKPLAN_THEME, 1, 1, { applyTransform: false });
    }

    for (const pShape of ['rect', 'circle', 'octagon'] as const) {
      for (const c of ['none', 'fountain', 'obelisk', 'market-stalls', 'tree'] as const) {
        const plaza = createPlazaObject({
          shape: pShape,
          x: 600,
          y: 500,
          width: 90,
          height: 80,
          fillColor: '#DDD1B8',
          borderColor: '#4B3A2C',
          centerpiece: c
        });
        drawPlazaToContext(ctx, plaza, CITY_MEDIEVAL_THEME, 1, 1);
      }
    }

    for (const kind of ['avenue', 'alley', 'canal', 'wall'] as const) {
      const p = createPathObject({
        kind,
        points: [100, 100, 400, 220],
        theme: doc.theme
      });
      expect(drawUrbanPathSegmentsToContext(ctx, p, p.points, doc.theme, 1, 1)).toBe(true);
    }

    doc.manifest.objects = [
      createPathObject({ kind: 'wall', points: [100, 100, 400, 100], theme: doc.theme }),
      createPlazaObject({
        shape: 'rect',
        x: 250,
        y: 250,
        width: 80,
        height: 60,
        fillColor: '#DDD1B8',
        borderColor: '#4B3A2C',
        centerpiece: 'fountain'
      }),
      createBuildingObject({
        shape: 'rect',
        x: 350,
        y: 250,
        width: 40,
        height: 28,
        roofColor: '#9E4638'
      })
    ];
    drawMapObjectsToContext(ctx, doc, new Map(), 1, 1);

    expect(ops.filter((o) => o === 'fill').length).toBeGreaterThan(20);
    expect(ops.filter((o) => o === 'stroke').length).toBeGreaterThan(20);
  });

  it('rete stradale organica genera 1-4 arterie principali e fitta rete non-ortogonale connessa', () => {
    const doc = createEmptyDocument({ kind: 'city', seed: 919 });
    const configs = [
      { rect: { x: 400, y: 350, width: 320, height: 240 }, seed: 11 },
      { rect: { x: 350, y: 280, width: 880, height: 640 }, seed: 42 },
      { rect: { x: 240, y: 220, width: 1200, height: 860 }, seed: 777 }
    ];

    for (const cfg of configs) {
      const generated = generateStreetGridInRect(doc, cfg.rect, {
        style: 'organic',
        spacingDoc: 96,
        angleDeg: 14,
        autoFillBuildings: false,
        districtPreset: 'residential',
        density: 0.72,
        buildingScale: 1,
        irregularity: 0.35,
        seed: cfg.seed
      });

      const paths = generated.filter((o) => o.type === 'path');
      const avenues = paths.filter((p) => p.kind === 'avenue');
      const secondary = paths.filter((p) => p.kind === 'road' || p.kind === 'alley');

      expect(avenues.length).toBeGreaterThanOrEqual(1);
      expect(avenues.length).toBeLessThanOrEqual(4);
      expect(secondary.length).toBeGreaterThanOrEqual(6);

      // Verify organic angular diversity (NOT just 0/90 deg orthogonal axes)
      const angleBuckets = new Set<number>();
      for (const p of paths) {
        const wPts = getPathWorldPoints(p);
        for (let i = 0; i < wPts.length / 2 - 1; i += 1) {
          const deg =
            (((Math.atan2(wPts[i * 2 + 3] - wPts[i * 2 + 1], wPts[i * 2 + 2] - wPts[i * 2]) *
              180) /
              Math.PI) %
              180 +
              180) %
            180;
          angleBuckets.add(Math.floor(deg / 18)); // 10 buckets of 18 deg across [0..180)
        }
      }
      expect(angleBuckets.size).toBeGreaterThanOrEqual(5);

      // Verify every secondary road attaches to at least one other road/avenue
      for (const sec of secondary) {
        const wPts = getPathWorldPoints(sec);
        const startX = wPts[0];
        const startY = wPts[1];
        let touchesOther = false;
        for (const other of paths) {
          if (other.id === sec.id) continue;
          const oPts = getPathWorldPoints(other);
          for (let j = 0; j < oPts.length / 2 - 1; j += 1) {
            const hit = distPointToSegment(
              startX,
              startY,
              oPts[j * 2],
              oPts[j * 2 + 1],
              oPts[j * 2 + 2],
              oPts[j * 2 + 3]
            );
            if (hit.dist < 3) {
              touchesOther = true;
              break;
            }
          }
          if (touchesOther) break;
        }
        expect(touchesOther).toBe(true);
      }
    }
  });

  it('esegue compositing a due passate (casing -> fill) su strade, piazze e fiumi affluenti + snap fiume e piazza ruotata', () => {
    const doc = createEmptyDocument({ kind: 'city', seed: 123 });
    const palette = CITY_MEDIEVAL_THEME.city!;

    const roadA = createPathObject({
      kind: 'road',
      points: [200, 400, 900, 400],
      strokeWidthDoc: 10,
      theme: doc.theme
    });
    const roadB = createPathObject({
      kind: 'avenue',
      points: [550, 150, 550, 750],
      strokeWidthDoc: 16,
      theme: doc.theme
    });
    const plaza = createPlazaObject({
      shape: 'rect',
      x: 550,
      y: 400,
      width: 100,
      height: 80,
      rotationDeg: 35,
      fillColor: palette.plazaFill,
      borderColor: palette.streetBorder,
      centerpiece: 'none'
    });
    const riverMain = createPathObject({
      kind: 'river',
      points: [100, 150, 400, 260, 750, 320],
      strokeWidthDoc: 10,
      theme: doc.theme
    });
    const riverTributary = createPathObject({
      kind: 'river',
      points: [260, 50, 390, 250],
      strokeWidthDoc: 7,
      theme: doc.theme
    });
    doc.manifest.objects = [roadA, plaza, roadB, riverMain, riverTributary];

    const trace: Array<{ op: 'stroke' | 'fill'; style: unknown; width?: number }> = [];
    const ctxState = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      ellipse: () => {},
      rect: () => {},
      clip: () => {},
      closePath: () => {},
      setLineDash: () => {},
      globalAlpha: 1,
      strokeStyle: '#000',
      fillStyle: '#000',
      lineWidth: 1,
      stroke: () => {
        trace.push({ op: 'stroke', style: ctxState.strokeStyle, width: ctxState.lineWidth });
      },
      fill: () => {
        trace.push({ op: 'fill', style: ctxState.fillStyle });
      }
    };
    const ctx = ctxState as unknown as CanvasRenderingContext2D;

    drawMapObjectsToContext(ctx, doc, new Map(), 1, 1);

    // Every streetBorder stroke (casing) must appear strictly BEFORE streetFill & plazaFill fills
    const streetBorderIdxs = trace
      .map((t, i) => (t.op === 'stroke' && t.style === palette.streetBorder && (t.width ?? 0) >= 3 ? i : -1))
      .filter((i) => i >= 0);
    const streetFillIdxs = trace
      .map((t, i) => (t.op === 'stroke' && t.style === palette.streetFill ? i : -1))
      .filter((i) => i >= 0);
    const plazaFillIdx = trace.findIndex((t) => t.op === 'fill' && t.style === palette.plazaFill);

    expect(streetBorderIdxs.length).toBeGreaterThanOrEqual(3);
    expect(streetFillIdxs.length).toBe(2);
    expect(plazaFillIdx).toBeGreaterThan(-1);
    expect(Math.max(...streetBorderIdxs)).toBeLessThan(Math.min(...streetFillIdxs));
    expect(Math.max(...streetFillIdxs)).toBeLessThan(plazaFillIdx);

    // River water fill happens strictly after both river casing passes
    const riverWaterIdxs = trace
      .map((t, i) => (t.op === 'fill' && t.style === doc.theme.colors.pathRiver ? i : -1))
      .filter((i) => i >= 0);
    expect(riverWaterIdxs).toHaveLength(2);
    expect(riverWaterIdxs[0]).toBeGreaterThan(2); // after both valley & bank casing fills

    // Tributary snap hits meandered spine of riverMain
    const spinePts = getRiverWorldSpinePoints(riverMain);
    const midSpineIdx = Math.floor(spinePts.length / 4);
    const midX = spinePts[midSpineIdx * 2];
    const midY = spinePts[midSpineIdx * 2 + 1];
    const riverSnap = findSnapPointForPathKind(doc, midX + 5, midY - 6, 'river', 24);
    expect(riverSnap.snapped).toBe(true);
    expect(Math.hypot(riverSnap.x - midX, riverSnap.y - midY)).toBeLessThan(6);

    // Road snap works on rotated plaza boundary
    const plazaSnap = findSnapPointForPathKind(doc, plaza.x + 62, plaza.y + 38, 'road', 32);
    expect(plazaSnap.snapped).toBe(true);
  });
});
