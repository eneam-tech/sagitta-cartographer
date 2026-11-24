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
  doOrientedRectsOverlap,
  findNearestUrbanStreet,
  findOverlappingBuildingIdsForPlaza,
  findSnapPointOnUrbanPaths,
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
});
