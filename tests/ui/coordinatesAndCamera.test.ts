import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CameraState,
  PAGE_PRESETS,
  ResizeAnchor,
  computeAnchorOffset,
  docToMaskX,
  docToMaskY,
  pageMmToInteractiveMaskDimensions,
  screenToDoc,
  zoomAtPoint
} from '../../src/model/coordinates';
import { UpdateLayerCommand } from '../../src/model/commands';
import {
  COVER_LAVA,
  COVER_MATERIALS,
  DEFAULT_LAYER_TERRAIN_ID,
  LabelObject,
  PathObject,
  StampObject,
  createEmptyDocument
} from '../../src/model/document';
import { createSampleWorldDocument } from '../../src/model/sampleDocument';
import {
  EditorStore,
  FallbackPersistenceService,
  isBrushSeaOnly,
  shouldIgnoreShortcut
} from '../../src/state/editorStore';
import { LAND_MASK_THRESHOLD, TerrainStrokeSession } from '../../src/terrain';
import { MAP_THEMES, NORDICA_THEME, VULCANICA_THEME, WITCHER_THEME } from '../../src/theme/theme';
import { DialogsHost } from '../../src/ui/Dialogs';
import { PropertiesPanel } from '../../src/ui/PropertiesPanel';
import { buildResizeCanvasCommand, resizeMapObjects } from '../../src/ui/ResizeCanvasDialog';
import { StatusBar } from '../../src/ui/StatusBar';
import { ToolRail } from '../../src/ui/ToolRail';
import { TopBar } from '../../src/ui/TopBar';

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clientToMaskCoords(
  clientX: number,
  clientY: number,
  containerRect: RectLike,
  camera: CameraState,
  space: { width: number; height: number },
  terrain: { widthPx: number; heightPx: number }
) {
  const cssX = clientX - containerRect.left;
  const cssY = clientY - containerRect.top;
  const docPoint = screenToDoc(cssX, cssY, camera);
  return {
    cssX,
    cssY,
    docX: docPoint.x,
    docY: docPoint.y,
    maskX: docToMaskX(docPoint.x, space, terrain),
    maskY: docToMaskY(docPoint.y, space, terrain)
  };
}

describe('Coordinates, camera, shortcuts, and EditorStore', () => {
  it('maps client coordinates through pan, zoomAtPoint, DPR 1x/2x, and viewport resize within <= 1 mask pixel', () => {
    const doc = createEmptyDocument();
    const store = new EditorStore({ initialDocument: doc });

    // Apertura iniziale: adatta alla viewport
    store.setViewportSize(1024, 700);
    const camAfterFit = store.getSnapshot().camera;
    expect(camAfterFit.scale).toBeGreaterThan(0);

    // Ridimensionamento finestra: non deve spostare o resettare la camera
    store.setViewportSize(1280, 820);
    expect(store.getSnapshot().camera).toEqual(camAfterFit);

    const containerRect: RectLike = { left: 64, top: 56, width: 936, height: 728 };
    const startClientX = 520;
    const startClientY = 410;

    // La pipeline usa coordinate CSS (indipendenti dal devicePixelRatio 1x o 2x)
    const dpr1Start = clientToMaskCoords(
      startClientX,
      startClientY,
      containerRect,
      store.getSnapshot().camera,
      doc.manifest.space,
      doc.terrain
    );
    const dpr2Start = {
      ...clientToMaskCoords(
        startClientX,
        startClientY,
        containerRect,
        store.getSnapshot().camera,
        doc.manifest.space,
        doc.terrain
      ),
      backingScale: 2
    };
    expect(dpr1Start.maskX).toBeCloseTo(dpr2Start.maskX, 8);
    expect(dpr1Start.maskY).toBeCloseTo(dpr2Start.maskY, 8);

    // Esegui pan e annota dove si è spostato il punto sullo schermo
    const panDx = 138;
    const panDy = -74;
    store.panBy(panDx, panDy);

    const pannedClientX = startClientX + panDx;
    const pannedClientY = startClientY + panDy;
    const pannedCssX = pannedClientX - containerRect.left;
    const pannedCssY = pannedClientY - containerRect.top;

    // Zoom in e poi zoom out centrato sul cursore nella nuova posizione
    const camBeforeZoom = store.getSnapshot().camera;
    const zoomedInCam = zoomAtPoint(camBeforeZoom, pannedCssX, pannedCssY, camBeforeZoom.scale * 2.75);
    store.setCamera(zoomedInCam);
    store.zoomAt(pannedCssX, pannedCssY, store.getSnapshot().camera.scale * 0.55);

    const afterZoom = clientToMaskCoords(
      pannedClientX,
      pannedClientY,
      containerRect,
      store.getSnapshot().camera,
      doc.manifest.space,
      doc.terrain
    );

    expect(Math.abs(afterZoom.maskX - dpr1Start.maskX)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterZoom.maskY - dpr1Start.maskY)).toBeLessThanOrEqual(1);

    // Dipingi sotto quel punto dopo pan + zoom + resize e verifica la maschera
    store.setBrushDiameter(40);
    store.beginTerrainStroke(afterZoom.docX, afterZoom.docY);
    store.commitTerrainStroke();

    const expectedPxX = Math.round(dpr1Start.maskX);
    const expectedPxY = Math.round(dpr1Start.maskY);
    expect(doc.terrain.mask[expectedPxY * doc.terrain.widthPx + expectedPxX]).toBe(255);
  });

  it('suppresses keyboard shortcuts inside INPUT, TEXTAREA, SELECT, and contentEditable elements', () => {
    expect(shouldIgnoreShortcut({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(shouldIgnoreShortcut({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true);
    expect(shouldIgnoreShortcut({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(shouldIgnoreShortcut({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(
      shouldIgnoreShortcut({
        tagName: 'SPAN',
        closest: () => ({})
      } as unknown as EventTarget)
    ).toBe(true);
    expect(shouldIgnoreShortcut({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
    expect(shouldIgnoreShortcut(null)).toBe(false);

    const store = new EditorStore();
    store.setTitle('Arcipelago');
    expect(store.getSnapshot().activeTool).toBe('land');

    // Scorciatoie ignorate quando il target è un campo testuale
    const handledTool = store.handleKeyDown({
      key: 'w',
      target: { tagName: 'INPUT' } as unknown as EventTarget
    });
    const handledUndo = store.handleKeyDown({
      key: 'z',
      ctrlKey: true,
      target: { tagName: 'TEXTAREA' } as unknown as EventTarget
    });
    expect(handledTool).toBe(false);
    expect(handledUndo).toBe(false);
    expect(store.getSnapshot().activeTool).toBe('land');
    expect(store.getDocument().manifest.title).toBe('Arcipelago');

    // Simula document.activeElement su INPUT anche con target generico
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { activeElement: { tagName: 'INPUT' } };
    try {
      expect(
        store.handleKeyDown({
          key: 'h',
          target: { tagName: 'DIV' } as unknown as EventTarget
        })
      ).toBe(false);
      expect(store.getSnapshot().activeTool).toBe('land');
    } finally {
      if (prevDoc === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDoc;
      }
    }
  });

  it('manages tools, diameter sync, undoable title, and stroke undo/redo/cancel in EditorStore', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 96 });
    const store = new EditorStore({ initialDocument: doc });

    // Stato iniziale richiesto su carta nuova
    expect(store.getSnapshot().activeTool).toBe('land');
    expect(store.getSnapshot().brushDiameterDoc).toBe(80);
    expect(store.getSnapshot().brushIntensity).toBe(0.45);
    expect(store.getSnapshot().hasLand).toBe(false);

    // Cambio diametro e intensità con limiti rispettati
    store.setBrushDiameter(5);
    expect(store.getSnapshot().brushDiameterDoc).toBe(10);
    store.setBrushDiameter(180);
    expect(store.getSnapshot().brushDiameterDoc).toBe(180);
    store.setBrushDiameter(999);
    expect(store.getSnapshot().brushDiameterDoc).toBe(400);

    store.setBrushIntensityPercent(75);
    expect(store.getSnapshot().brushIntensity).toBe(0.75);

    // Selezione strumenti e sub-modalità via API e scorciatoie
    store.setTool('lower');
    store.setTool('water');
    expect(store.handleKeyDown({ key: 'e', target: null })).toBe(true);
    expect(store.getSnapshot().activeTool).toBe('lower');

    store.setTool('fields');
    store.setTool('poi');
    expect(store.handleKeyDown({ key: 'c', target: null })).toBe(true);
    expect(store.getSnapshot().activeTool).toBe('fields');

    // Spazio temporaneo per Mano
    expect(store.handleKeyDown({ key: ' ', code: 'Space', target: null })).toBe(true);
    expect(store.getEffectiveTool()).toBe('hand');
    store.handleKeyUp({ key: ' ', code: 'Space' });
    expect(store.getEffectiveTool()).toBe('fields');

    // Titolo annullabile
    store.setTitle('Costa delle Nebbie');
    expect(store.getDocument().manifest.title).toBe('Costa delle Nebbie');
    expect(store.getSnapshot().canUndo).toBe(true);

    store.undo();
    expect(store.getDocument().manifest.title).toBe('Nuova carta');
    expect(store.getSnapshot().canRedo).toBe(true);

    store.redo();
    expect(store.getDocument().manifest.title).toBe('Costa delle Nebbie');

    // Annullamento gesto con cancelTerrainStroke / Escape: nessuna modifica né nuova revisione
    store.setTool('land');
    const revBeforeCancel = store.getDocument().manifest.revision;
    store.beginTerrainStroke(1485, 1050);
    store.moveTerrainStroke(1600, 1050);
    expect(store.getStrokeSession().isActive()).toBe(true);
    expect(store.handleKeyDown({ key: 'Escape', target: null })).toBe(true);
    expect(store.getStrokeSession().isActive()).toBe(false);
    expect(store.getDocument().manifest.revision).toBe(revBeforeCancel);
    expect(store.getSnapshot().hasLand).toBe(false);
    expect(doc.terrain.mask.some((v) => v > 0)).toBe(false);

    // Tratto Terra confermato, undo e redo
    store.beginTerrainStroke(1485, 1050);
    store.moveTerrainStroke(1550, 1050);
    store.commitTerrainStroke();
    expect(store.getSnapshot().hasLand).toBe(true);
    expect(doc.terrain.mask.some((v) => v > 0)).toBe(true);
    expect(store.getDocument().manifest.revision).toBe(revBeforeCancel + 1);

    store.undo();
    expect(store.getSnapshot().hasLand).toBe(false);
    expect(doc.terrain.mask.some((v) => v > 0)).toBe(false);

    store.redo();
    expect(store.getSnapshot().hasLand).toBe(true);
    expect(doc.terrain.mask.some((v) => v > 0)).toBe(true);
  });

  it('detects sea-only cursor regions for elevation/cover brushes', () => {
    const sample = createSampleWorldDocument();
    const store = new EditorStore({ initialDocument: sample });

    // Centro del promontorio campione è terra; angolo in alto a sinistra è mare
    const landX = sample.manifest.space.width * 0.48;
    const landY = sample.manifest.space.height * 0.52;
    const seaX = 100;
    const seaY = 100;

    expect(isBrushSeaOnly(sample, landX, landY, 40)).toBe(false);
    expect(isBrushSeaOnly(sample, seaX, seaY, 40)).toBe(true);
    expect(isBrushSeaOnly(sample, -50, -50, 40)).toBe(false);

    store.setTool('forest');
    store.updateCursorSeaHint(seaX, seaY);
    expect(store.getSnapshot().seaOnlyHintVisible).toBe(true);

    store.updateCursorSeaHint(landX, landY);
    expect(store.getSnapshot().seaOnlyHintVisible).toBe(false);

    // Con Terra attivo, il suggerimento non deve mai apparire sul mare
    store.setTool('land');
    store.updateCursorSeaHint(seaX, seaY);
    expect(store.getSnapshot().seaOnlyHintVisible).toBe(false);
  });

  it('handles zoomIn/zoomOut/fitCamera and skips no-op terrain strokes without bumping revision', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 96 });
    const store = new EditorStore({ initialDocument: doc });
    store.setViewportSize(800, 600);
    const fitScale = store.getSnapshot().camera.scale;

    store.zoomIn();
    expect(store.getSnapshot().camera.scale).toBeGreaterThan(fitScale);
    store.zoomOut();
    expect(store.getSnapshot().camera.scale).toBeCloseTo(fitScale, 6);

    store.panBy(200, -150);
    store.fitCamera();
    expect(store.getSnapshot().camera.scale).toBeCloseTo(fitScale, 6);

    // Scavare acqua su una tela già interamente vuota (mare) non deve creare un comando vuoto
    store.setTool('water');
    const revBefore = store.getDocument().manifest.revision;
    store.beginTerrainStroke(500, 500);
    store.commitTerrainStroke();
    expect(store.getDocument().manifest.revision).toBe(revBefore);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it('uses intensity 1.0 for single-click land and water strokes with real TerrainStrokeSession while keeping Rilievo intensity', () => {
    const doc = createEmptyDocument();
    const store = new EditorStore({
      initialDocument: doc,
      strokeSession: new TerrainStrokeSession()
    });

    // Verifica impostazioni predefinite (Rilievo parte a 0.45 ma Terra deve usare 1.0)
    expect(store.getSnapshot().activeTool).toBe('land');
    expect(store.getSnapshot().brushIntensity).toBe(0.45);
    expect(store.getSnapshot().brushDiameterDoc).toBe(80);

    const centerDocX = doc.manifest.space.width * 0.5;
    const centerDocY = doc.manifest.space.height * 0.5;
    const pxX = Math.floor(docToMaskX(centerDocX, doc.manifest.space, doc.terrain));
    const pxY = Math.floor(docToMaskY(centerDocY, doc.manifest.space, doc.terrain));
    const centerIdx = pxY * doc.terrain.widthPx + pxX;

    // Singolo clic fermo con Terra: crea terra piena (mask === 255 >= LAND_MASK_THRESHOLD)
    store.beginTerrainStroke(centerDocX, centerDocY);
    store.commitTerrainStroke();

    expect(doc.terrain.mask[centerIdx]).toBe(255);
    expect(doc.terrain.mask[centerIdx]).toBeGreaterThanOrEqual(LAND_MASK_THRESHOLD);
    expect(store.getSnapshot().hasLand).toBe(true);
    expect(doc.manifest.revision).toBe(1);

    // Verifica che Rilievo continui a rispettare brushIntensity (0.45 -> incremento delta < 16 rispetto al rilievo costiero)
    const heightAfterLand = doc.terrain.height[centerIdx];
    store.setTool('raise');
    store.beginTerrainStroke(centerDocX, centerDocY);
    store.commitTerrainStroke();
    const raiseDelta = doc.terrain.height[centerIdx] - heightAfterLand;
    expect(raiseDelta).toBeGreaterThan(0);
    expect(raiseDelta).toBeLessThan(16);

    // Singolo clic fermo con Acqua sullo stesso punto: azzera maschera, quota e copertura
    store.setTool('water');
    store.beginTerrainStroke(centerDocX, centerDocY);
    store.commitTerrainStroke();

    expect(doc.terrain.mask[centerIdx]).toBe(0);
    expect(doc.terrain.height[centerIdx]).toBe(0);
    expect(doc.terrain.cover[centerIdx]).toBe(0);
  });

  it('catches downloadArchive errors and exposes a statusNotice without throwing', async () => {
    const persistence = new FallbackPersistenceService();
    persistence.exportArchive = async () => {
      throw new Error('Errore creazione archivio ZIP');
    };
    const store = new EditorStore({ persistence });

    const result = await store.downloadArchive();
    expect(result).toBeNull();
    expect(store.getSnapshot().statusNotice).toEqual({
      tone: 'error',
      text: 'Errore creazione archivio ZIP'
    });
  });

  it('resizes canvas, terrain buffers, and Stamp/Label/Path objects across 9 anchors with ResizeCanvasCommand and Undo/Redo', () => {
    const doc = createEmptyDocument({
      page: { widthMm: 297, heightMm: 210 },
      widthPx: 297,
      heightPx: 210
    });

    // Dipingi una zona centrale di terra con quota 140 e copertura Lava (9)
    for (let y = 80; y < 130; y += 1) {
      for (let x = 100; x < 180; x += 1) {
        const idx = y * doc.terrain.widthPx + x;
        doc.terrain.mask[idx] = 255;
        doc.terrain.height[idx] = 140;
        doc.terrain.cover[idx] = COVER_LAVA;
      }
    }

    const stamp: StampObject = {
      id: 'stamp-1',
      type: 'stamp',
      role: 'poi',
      assetId: 'poi-tower',
      x: 1000,
      y: 800,
      width: 120,
      height: 120,
      rotationDeg: 15
    };
    const label: LabelObject = {
      id: 'label-1',
      type: 'label',
      text: 'Rocca Rossa',
      x: 500,
      y: 400,
      fontId: 'spectral-semibold',
      fontSize: 40,
      color: '#263C40',
      rotationDeg: 0
    };
    const path: PathObject = {
      id: 'path-1',
      type: 'path',
      kind: 'river',
      x: 1400,
      y: 1000,
      rotationDeg: 0,
      points: [-100, -50, 0, 0, 100, 50],
      strokeWidthDoc: 12,
      color: '#5E95A0',
      smooth: true,
      tapered: true
    };
    doc.manifest.objects = [stamp, label, path];

    // Verifica matematica di tutte e 9 le ancore
    const allAnchors: ResizeAnchor[] = [
      'top-left',
      'top',
      'top-right',
      'left',
      'center',
      'right',
      'bottom-left',
      'bottom',
      'bottom-right'
    ];
    for (const anchor of allAnchors) {
      const { dx, dy } = computeAnchorOffset(2970, 2100, 4200, 2970, anchor);
      const moved = resizeMapObjects([stamp, label, path], { width: 2970, height: 2100 }, { width: 4200, height: 2970 }, 'expand-crop', anchor);
      expect(moved[0].x).toBeCloseTo(1000 + dx, 2);
      expect(moved[0].y).toBeCloseTo(800 + dy, 2);
      expect(moved[1].x).toBeCloseTo(500 + dx, 2);
      expect(moved[2].x).toBeCloseTo(1400 + dx, 2);
      expect(moved[2].y).toBeCloseTo(1000 + dy, 2);
    }

    const store = new EditorStore({ initialDocument: doc });
    store.setViewportSize(1200, 800);

    // 1. Espandi / Ritaglia ancorato in basso a destra (dx = 1230, dy = 870)
    const expandCmd = buildResizeCanvasCommand(store.getDocument(), {
      page: { widthMm: 420, heightMm: 297 },
      mode: 'expand-crop',
      anchor: 'bottom-right'
    });
    store.executeCommand(expandCmd);

    const expanded = store.getDocument();
    expect(expanded.manifest.page).toEqual({ widthMm: 420, heightMm: 297 });
    expect(expanded.manifest.space).toEqual({ width: 4200, height: 2970 });
    expect(expanded.terrain.widthPx).toBe(420);
    expect(expanded.terrain.heightPx).toBe(297);
    expect(expanded.manifest.objects[0].x).toBe(2230);
    expect(expanded.manifest.objects[0].y).toBe(1670);
    expect(expanded.manifest.objects[1].x).toBe(1730);
    expect(expanded.manifest.objects[1].y).toBe(1270);
    expect(expanded.manifest.objects[2].x).toBe(2630);
    expect(expanded.manifest.objects[2].y).toBe(1870);
    // Il margine superiore sinistro esposto deve essere mare (0)
    expect(expanded.terrain.mask[0]).toBe(0);
    // La terra spostata in basso a destra mantiene maschera, quota e lava
    const shiftedCenterPxX = Math.floor(docToMaskX(1230 + 1400, expanded.manifest.space, expanded.terrain));
    const shiftedCenterPxY = Math.floor(docToMaskY(870 + 1050, expanded.manifest.space, expanded.terrain));
    const shiftedIdx = shiftedCenterPxY * expanded.terrain.widthPx + shiftedCenterPxX;
    expect(expanded.terrain.mask[shiftedIdx]).toBe(255);
    expect(expanded.terrain.height[shiftedIdx]).toBe(140);
    expect(expanded.terrain.cover[shiftedIdx]).toBe(COVER_LAVA);

    // Undo ripristina esattamente formato, buffer e oggetti originali
    expect(store.undo()).toBe(true);
    const reverted = store.getDocument();
    expect(reverted.manifest.page).toEqual({ widthMm: 297, heightMm: 210 });
    expect(reverted.terrain.widthPx).toBe(297);
    expect(reverted.terrain.heightPx).toBe(210);
    expect(reverted.manifest.objects[0].x).toBe(1000);
    expect(reverted.manifest.objects[2].x).toBe(1400);

    // Redo riapplica il ridimensionamento
    expect(store.redo()).toBe(true);
    expect(store.getDocument().manifest.page).toEqual({ widthMm: 420, heightMm: 297 });

    // 2. Scala contenuto: scala proporzionalmente oggetti, punti PathObject e raster terreno
    const scaleCmd = buildResizeCanvasCommand(store.getDocument(), {
      page: { widthMm: 840, heightMm: 594 },
      mode: 'scale-content',
      anchor: 'center'
    });
    store.executeCommand(scaleCmd);

    const scaled = store.getDocument();
    expect(scaled.manifest.page).toEqual({ widthMm: 840, heightMm: 594 });
    const scaledStamp = scaled.manifest.objects[0] as StampObject;
    const scaledLabel = scaled.manifest.objects[1] as LabelObject;
    const scaledPath = scaled.manifest.objects[2] as PathObject;
    expect(scaledStamp.x).toBe(4460);
    expect(scaledStamp.width).toBe(240);
    expect(scaledLabel.fontSize).toBe(80);
    expect(scaledPath.x).toBe(5260);
    expect(scaledPath.points).toEqual([-200, -100, 0, 0, 200, 100]);
    expect(scaledPath.strokeWidthDoc).toBe(24);
    const expectedA1Mask = pageMmToInteractiveMaskDimensions({ widthMm: 841, heightMm: 594 });
    expect(expectedA1Mask.widthPx * expectedA1Mask.heightPx).toBeLessThanOrEqual(12_000_000);
  });

  it('switches themes via store.setTheme with Undo/Redo and skips redundant theme updates', () => {
    const store = new EditorStore();
    expect(store.getDocument().theme.id).toBe('base');

    const rev0 = store.getDocument().manifest.revision;
    store.setTheme(MAP_THEMES[0]);
    expect(store.getDocument().manifest.revision).toBe(rev0);

    store.setTheme(VULCANICA_THEME);
    expect(store.getDocument().theme.id).toBe('vulcanica');
    expect(store.getDocument().manifest.theme.id).toBe('vulcanica');
    expect(store.getDocument().manifest.revision).toBe(rev0 + 1);

    store.setTheme(NORDICA_THEME);
    expect(store.getDocument().theme.id).toBe('nordica');

    expect(store.undo()).toBe(true);
    expect(store.getDocument().theme.id).toBe('vulcanica');

    expect(store.undo()).toBe(true);
    expect(store.getDocument().theme.id).toBe('base');

    expect(store.redo()).toBe(true);
    expect(store.getDocument().theme.id).toBe('vulcanica');
  });

  it('blocks terrain brush strokes when layer-terrain is locked or hidden', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 96 });
    const store = new EditorStore({ initialDocument: doc });
    const terrainLayer = doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)!;

    // 1. Blocca livello terreno
    store.executeCommand(
      new UpdateLayerCommand(terrainLayer, { ...terrainLayer, locked: true }, 'Blocca terreno')
    );
    const revLocked = store.getDocument().manifest.revision;
    expect(store.beginTerrainStroke(1485, 1050)).toBe(false);
    expect(store.getStrokeSession().isActive()).toBe(false);
    expect(store.getSnapshot().statusNotice?.text).toContain('bloccato');
    expect(store.getDocument().manifest.revision).toBe(revLocked);
    expect(doc.terrain.mask.some((v) => v > 0)).toBe(false);

    // 2. Sblocca ma nascondi livello terreno
    const lockedLayer = store.getDocument().manifest.layers.find((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)!;
    store.executeCommand(
      new UpdateLayerCommand(
        lockedLayer,
        { ...lockedLayer, locked: false, visible: false },
        'Nascondi terreno'
      )
    );
    expect(store.beginTerrainStroke(1485, 1050)).toBe(false);
    expect(doc.terrain.mask.some((v) => v > 0)).toBe(false);

    // 3. Ripristina visibile e sbloccato -> pennellata consentita
    const hiddenLayer = store.getDocument().manifest.layers.find((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)!;
    store.executeCommand(
      new UpdateLayerCommand(
        hiddenLayer,
        { ...hiddenLayer, visible: true, locked: false },
        'Mostra terreno'
      )
    );
    expect(store.beginTerrainStroke(1485, 1050)).toBe(true);
    store.commitTerrainStroke();
    expect(doc.terrain.mask.some((v) => v > 0)).toBe(true);
  });

  it('handles Wave 2 keyboard shortcuts (R, [, ], ?) and ignores them inside INPUT elements', () => {
    const store = new EditorStore();
    expect(store.getSnapshot().brushDiameterDoc).toBe(80);

    // R attiva Fiumi e Strade ('path')
    expect(store.handleKeyDown({ key: 'r', target: null })).toBe(true);
    expect(store.getSnapshot().activeTool).toBe('path');

    // [ e ] regolano il diametro pennello
    expect(store.handleKeyDown({ key: '[', target: null })).toBe(true);
    expect(store.getSnapshot().brushDiameterDoc).toBe(68);
    expect(store.handleKeyDown({ key: ']', target: null })).toBe(true);
    expect(store.getSnapshot().brushDiameterDoc).toBe(78);

    // ? apre la modale scorciatoie, Esc la chiude
    expect(store.handleKeyDown({ key: '?', target: null })).toBe(true);
    expect(store.getSnapshot().activeDialog).toBe('shortcuts');
    expect(store.handleKeyDown({ key: 'Escape', target: null })).toBe(true);
    expect(store.getSnapshot().activeDialog).toBeNull();

    // Disabilitate dentro INPUT
    const inputTarget = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(store.handleKeyDown({ key: 'b', target: inputTarget })).toBe(false);
    expect(store.handleKeyDown({ key: '[', target: inputTarget })).toBe(false);
    expect(store.handleKeyDown({ key: ']', target: inputTarget })).toBe(false);
    expect(store.handleKeyDown({ key: '?', target: inputTarget })).toBe(false);
    expect(store.getSnapshot().activeTool).toBe('path');
    expect(store.getSnapshot().brushDiameterDoc).toBe(78);
    expect(store.getSnapshot().activeDialog).toBeNull();
  });

  it('renders Wave 2 ToolRail, TopBar, PropertiesPanel 3 tabs & 10 materials, StatusBar telemetry, and Dialogs in SSR', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 96 });
    const centerPx = 48 * 128 + 64;
    doc.terrain.mask[centerPx] = 255;
    doc.terrain.height[centerPx] = 152;
    doc.terrain.cover[centerPx] = COVER_LAVA;

    const store = new EditorStore({ initialDocument: doc });

    // ToolRail: Fiumi e Strade + Rilievo su flatten + Superfici su lava
    store.setTool('flatten');
    const railFlatten = renderToStaticMarkup(createElement(ToolRail, { store }));
    expect(railFlatten).toContain('Fiumi e Strade (R)');
    expect(railFlatten).toContain('aria-pressed="true" aria-label="Rilievo (E)"');

    store.setTool('lava');
    const railLava = renderToStaticMarkup(createElement(ToolRail, { store }));
    expect(railLava).toContain('aria-pressed="true" aria-label="Superfici (C)"');

    // PropertiesPanel: Rilievo (4 modalità + 3 preset intensità + diametro)
    store.setTool('raise');
    const propRaise = renderToStaticMarkup(createElement(PropertiesPanel, { store }));
    expect(propRaise).toContain('Strumento');
    expect(propRaise).toContain('Livelli');
    expect(propRaise).toContain('Oggetti');
    expect(propRaise).toContain('Alza');
    expect(propRaise).toContain('Abbassa');
    expect(propRaise).toContain('Appiattisci');
    expect(propRaise).toContain('Ammorbidisci');
    expect(propRaise).toContain('Leggero');
    expect(propRaise).toContain('Medio');
    expect(propRaise).toContain('Forte');

    // PropertiesPanel: 10 materiali in Superfici
    store.setTool('lava');
    const propCover = renderToStaticMarkup(createElement(PropertiesPanel, { store }));
    for (const mat of COVER_MATERIALS) {
      expect(propCover).toContain(mat.label);
    }

    // PropertiesPanel: scheda Strumento con pathToolSlot, scheda Livelli con layersSlot, scheda Oggetti
    store.setTool('path');
    const propPath = renderToStaticMarkup(
      createElement(PropertiesPanel, {
        store,
        pathToolSlot: createElement('div', null, 'SLOT_PATH_TEST')
      })
    );
    expect(propPath).toContain('SLOT_PATH_TEST');

    store.setInspectorTab('layers');
    const propLayers = renderToStaticMarkup(
      createElement(PropertiesPanel, {
        store,
        layersSlot: createElement('div', null, 'SLOT_LAYERS_TEST')
      })
    );
    expect(propLayers).toContain('SLOT_LAYERS_TEST');

    store.setInspectorTab('objects');
    const propObjects = renderToStaticMarkup(
      createElement(PropertiesPanel, {
        store,
        objectInspectorSlot: createElement('div', null, 'SLOT_INSPECTOR_TEST'),
        objectListSlot: createElement('div', null, 'SLOT_LIST_TEST')
      })
    );
    expect(propObjects).toContain('SLOT_LIST_TEST');

    // TopBar: Tela 297×210 mm + 4 temi + Scorciatoie
    const topHtml = renderToStaticMarkup(createElement(TopBar, { store }));
    expect(topHtml).toContain('297×210 mm');
    expect(topHtml).toContain('Carta di stracci classica');
    expect(topHtml).toContain('Scorciatoie da tastiera (?)');

    // StatusBar: formato mm, livello attivo, cursore + ispezione cella (acqua e lava)
    store.setCursorDoc({ x: 10, y: 10 });
    const statusSea = renderToStaticMarkup(createElement(StatusBar, { store }));
    expect(statusSea).toContain('297×210 mm');
    expect(statusSea).toContain('Livello:');
    expect(statusSea).toContain('Acqua');

    store.setCursorDoc({ x: doc.manifest.space.width * 0.505, y: doc.manifest.space.height * 0.505 });
    const statusLand = renderToStaticMarkup(createElement(StatusBar, { store }));
    expect(statusLand).toContain('Quota 152');
    expect(statusLand).toContain('Lava');

    // DialogsHost: newProject (7 preset + 4 temi), resizeCanvas, shortcuts
    store.openDialog('newProject');
    const newProjHtml = renderToStaticMarkup(createElement(DialogsHost, { store }));
    for (const preset of PAGE_PRESETS) {
      expect(newProjHtml).toContain(preset.label);
    }
    for (const theme of MAP_THEMES) {
      expect(newProjHtml).toContain(theme.name);
    }

    store.openDialog('resizeCanvas');
    const resizeHtml = renderToStaticMarkup(createElement(DialogsHost, { store }));
    expect(resizeHtml).toContain('Ridimensiona tela');
    expect(resizeHtml).toContain('Espandi / Ritaglia');
    expect(resizeHtml).toContain('Scala contenuto');
    expect(resizeHtml).toContain('Griglia ancora a 9 punti');

    store.openDialog('shortcuts');
    const shortcutsHtml = renderToStaticMarkup(createElement(DialogsHost, { store }));
    expect(shortcutsHtml).toContain('Scorciatoie da tastiera');
    expect(shortcutsHtml).toContain('L / B');
    expect(shortcutsHtml).toContain('Fiumi e Strade');

    // Verifica assenza di dimensioni fuori scala tipografica (11, 12, 14 px)
    for (const html of [propRaise, propCover, topHtml, statusLand, resizeHtml, shortcutsHtml]) {
      expect(html).not.toContain('font-size:11px');
      expect(html).not.toContain('font-size:12px');
      expect(html).not.toContain('font-size:14px');
    }

    // StatusBar idle (revision === 0 -> 'Pronto', mai 'Salvataggio…') e notice 'info' distinta da 'success'
    const idleHtml = renderToStaticMarkup(createElement(StatusBar, { store }));
    expect(idleHtml).toContain('Pronto');
    expect(idleHtml).not.toContain('Salvataggio…');

    store.setStatusNotice({ tone: 'info', text: 'Il livello «Terreno e Rilievo» è bloccato o nascosto.' });
    const infoNoticeHtml = renderToStaticMarkup(createElement(StatusBar, { store }));
    expect(infoNoticeHtml).toContain('statusbar-icon-info');
    expect(infoNoticeHtml).not.toContain('statusbar-icon-success');

    // Badge scheda Oggetti > 999 formattato come 999+ con title completo
    const crowdedDoc = createEmptyDocument({ widthPx: 64, heightPx: 64 });
    crowdedDoc.manifest.objects = Array.from({ length: 1005 }, (_, i) => ({
      id: `lbl-${i}`,
      type: 'label' as const,
      text: `L${i}`,
      x: 100,
      y: 100,
      fontId: 'spectral-semibold',
      fontSize: 20,
      color: '#263C40',
      rotationDeg: 0
    }));
    const crowdedStore = new EditorStore({ initialDocument: crowdedDoc });
    const crowdedPropHtml = renderToStaticMarkup(createElement(PropertiesPanel, { store: crowdedStore }));
    expect(crowdedPropHtml).toContain('999+');
    expect(crowdedPropHtml).toContain('title="Oggetti: 1005"');
  });

  it('scales rotated PathObject and StampObject accurately under anisotropic scale-content resize', () => {
    const rotatedPath: PathObject = {
      id: 'rot-path-90',
      type: 'path',
      kind: 'river',
      x: 400,
      y: 200,
      rotationDeg: 90,
      points: [-100, 0, 0, 50, 100, 0],
      strokeWidthDoc: 10,
      color: '#5E95A0'
    };
    const rotatedStamp: StampObject = {
      id: 'rot-stamp-90',
      type: 'stamp',
      role: 'poi',
      assetId: 'poi-tower',
      x: 300,
      y: 500,
      width: 40,
      height: 80,
      rotationDeg: 90
    };

    // Scala anisotropa: scaleX = 2, scaleY = 3
    const resized = resizeMapObjects(
      [rotatedPath, rotatedStamp],
      { width: 1000, height: 1000 },
      { width: 2000, height: 3000 },
      'scale-content',
      'center'
    );

    const outPath = resized[0] as PathObject;
    const outStamp = resized[1] as StampObject;

    // A 90° l'asse X locale coincide con Y pagina (×3) e l'asse Y locale con -X pagina (×2)
    expect(outPath.x).toBe(800);
    expect(outPath.y).toBe(600);
    expect(outPath.points[0]).toBeCloseTo(-300, 2);
    expect(outPath.points[1]).toBeCloseTo(0, 2);
    expect(outPath.points[2]).toBeCloseTo(0, 2);
    expect(outPath.points[3]).toBeCloseTo(100, 2);
    expect(outPath.points[4]).toBeCloseTo(300, 2);
    expect(outPath.points[5]).toBeCloseTo(0, 2);

    // Stamp a 90°: width segue scaleY (40*3=120), height segue scaleX (80*2=160)
    expect(outStamp.x).toBe(600);
    expect(outStamp.y).toBe(1500);
    expect(outStamp.width).toBeCloseTo(120, 2);
    expect(outStamp.height).toBeCloseTo(160, 2);
  });

  it('supports plateau tool, smart brush controls, GenerateWorldDialog SSR, generateWorld undo/redo, and theme path auto-sync', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
    const store = new EditorStore({
      initialDocument: doc,
      strokeSession: new TerrainStrokeSession()
    });

    // Smart brush mode & plateau defaults
    expect(store.getSnapshot().brushMode).toBe('smart');
    expect(store.getSnapshot().plateauTargetHeight).toBe(185);
    expect(store.getSnapshot().poiAutoLabel).toBe(false);

    store.setTool('plateau');
    expect(store.getSnapshot().activeTool).toBe('plateau');
    store.setPlateauTargetHeight(225);
    expect(store.getSnapshot().plateauTargetHeight).toBe(225);

    const plateauPropHtml = renderToStaticMarkup(createElement(PropertiesPanel, { store }));
    expect(plateauPropHtml).toContain('Alza picchi');
    expect(plateauPropHtml).toContain('Altopiano');
    expect(plateauPropHtml).toContain('Quota altopiano');
    expect(plateauPropHtml).toContain('Tavolato');

    store.setTool('land');
    const smartLandHtml = renderToStaticMarkup(createElement(PropertiesPanel, { store }));
    expect(smartLandHtml).toContain('Intelligente');
    expect(smartLandHtml).toContain('Geometrico');
    expect(smartLandHtml).toContain('Frastagliatura costa');
    expect(smartLandHtml).toContain('Genera continente…');

    store.setTool('forest');
    const smartCoverHtml = renderToStaticMarkup(createElement(PropertiesPanel, { store }));
    expect(smartCoverHtml).toContain('Uniforme');

    // GenerateWorldDialog SSR + typography check
    store.openDialog('generateWorld');
    const genDialogHtml = renderToStaticMarkup(createElement(DialogsHost, { store }));
    expect(genDialogHtml).toContain('Genera continente');
    expect(genDialogHtml).toContain('Regni del Nord (The Witcher 3)');
    expect(genDialogHtml).toContain('Arcipelago di Skellige');
    expect(genDialogHtml).toContain('Valle Continentale');
    expect(genDialogHtml).toContain('Costa e Isole Frastagliate');
    expect(genDialogHtml).toContain('Seme procedurale (Seed)');
    for (const html of [plateauPropHtml, smartLandHtml, smartCoverHtml, genDialogHtml]) {
      expect(html).not.toContain('font-size:11px');
      expect(html).not.toContain('font-size:12px');
      expect(html).not.toContain('font-size:14px');
    }

    // Theme switching auto-syncs default pathColor while preserving custom colors
    const riverColorBefore = store.getSnapshot().pathColor;
    expect(riverColorBefore.toLowerCase()).toBe(doc.theme.colors.pathRiver.toLowerCase());
    store.setTheme(WITCHER_THEME);
    expect(store.getSnapshot().pathColor.toLowerCase()).toBe(WITCHER_THEME.colors.pathRiver.toLowerCase());
    store.setPathColor('#123456');
    store.setTheme(MAP_THEMES[0]);
    expect(store.getSnapshot().pathColor).toBe('#123456');

    // generateWorld populates terrain & undoes cleanly in 1 step
    store.generateWorld({
      preset: 'northern-realms',
      seed: 4219,
      seaLevelPercent: 40,
      mountainStrengthPercent: 78,
      coastRoughnessPercent: 76,
      biomeRichnessPercent: 82
    });
    expect(store.getSnapshot().activeDialog).toBeNull();
    expect(store.getSnapshot().hasLand).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().hasLand).toBe(false);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot().hasLand).toBe(true);

    store.dispose();
  });
});
