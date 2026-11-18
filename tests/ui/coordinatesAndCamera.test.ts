import { describe, expect, it } from 'vitest';
import {
  CameraState,
  docToMaskX,
  docToMaskY,
  screenToDoc,
  zoomAtPoint
} from '../../src/model/coordinates';
import { createEmptyDocument } from '../../src/model/document';
import { createSampleWorldDocument } from '../../src/model/sampleDocument';
import {
  EditorStore,
  isBrushSeaOnly,
  shouldIgnoreShortcut
} from '../../src/state/editorStore';

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
});
