import type Konva from 'konva';
import KonvaRuntime from 'konva/lib/index.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

const KonvaCtor = KonvaRuntime as unknown as typeof Konva;
import { BUILTIN_POI_CATALOG, POI_CATEGORIES } from '../../src/assets/catalog';
import {
  AddLayerCommand,
  DeleteLayerCommand,
  ReorderLayersCommand,
  UpdateLayerCommand
} from '../../src/model/commands';
import {
  COVER_FOREST,
  COVER_NATURAL,
  DEFAULT_LAYER_LABELS_ID,
  DEFAULT_LAYER_POI_ID,
  DEFAULT_LAYER_TERRAIN_ID,
  DEFAULT_LAYER_VECTORS_ID,
  LabelObject,
  PathObject,
  StampObject,
  cloneMapObject,
  createEmptyDocument,
  validateDocumentManifest
} from '../../src/model/document';
import { HistoryManager } from '../../src/model/history';
import {
  AddObjectCommand,
  AddObjectsBatchCommand,
  DeleteObjectCommand,
  InlineLabelEditor,
  LayersPanel,
  ObjectInspector,
  ObjectListPanel,
  ObjectsLayerController,
  PathToolPanel,
  PoiLibraryPanel,
  ReorderObjectsCommand,
  UpdateObjectCommand,
  areMapObjectsEqual,
  commitObjectReorder,
  commitObjectUpdate,
  createLabelObject,
  createPathObject,
  createPoiStampObject,
  simplifyPolyline
} from '../../src/objects';
import { EditorStore } from '../../src/state/editorStore';
import { TerrainRenderer, TerrainStrokeSession, inspectCellAtDoc, isPointOnLand } from '../../src/terrain';
import { handleObjectListItemKeyDown } from '../../src/ui/ObjectListPanel';

function countDiffBytes(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let diffs = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diffs += 1;
  }
  return diffs;
}

describe('POI, labels, object commands, z-order, and Spec §11 interactions', () => {
  it('exports all public object commands, controller, and UI components cleanly', () => {
    expect(typeof AddObjectCommand).toBe('function');
    expect(typeof AddObjectsBatchCommand).toBe('function');
    expect(typeof UpdateObjectCommand).toBe('function');
    expect(typeof DeleteObjectCommand).toBe('function');
    expect(typeof ReorderObjectsCommand).toBe('function');
    expect(typeof simplifyPolyline).toBe('function');
    expect(typeof createPathObject).toBe('function');
    expect(typeof ObjectsLayerController).toBe('function');
    expect(typeof PoiLibraryPanel).toBe('function');
    expect(typeof PathToolPanel).toBe('function');
    expect(typeof LayersPanel).toBe('function');
    expect(typeof ObjectListPanel).toBe('function');
    expect(typeof ObjectInspector).toBe('function');
    expect(typeof InlineLabelEditor).toBe('function');
  });

  it('Spec §11 — POI interaction: digging a lake beneath a Torre preserves sticker identity/order and undo/redo restores all 3 rasters exactly', () => {
    const doc = createEmptyDocument({ widthPx: 594, heightPx: 420, seed: 173 });
    const history = new HistoryManager();
    const session = new TerrainStrokeSession();

    const towerX = 1485;
    const towerY = 1050;

    // 1. Crea costa, rilievo collinare e foresta sul versante con TerrainStrokeSession reale
    session.beginStroke(doc, { tool: 'land', diameterDoc: 900, intensity: 1 }, towerX, towerY);
    const landCommit = session.commit(doc);
    expect(landCommit).not.toBeNull();
    history.execute(doc, landCommit!.command, { alreadyApplied: true });

    session.beginStroke(doc, { tool: 'raise', diameterDoc: 460, intensity: 0.9 }, towerX, towerY);
    const raiseCommit = session.commit(doc);
    expect(raiseCommit).not.toBeNull();
    history.execute(doc, raiseCommit!.command, { alreadyApplied: true });

    session.beginStroke(doc, { tool: 'forest', diameterDoc: 420, intensity: 1 }, towerX, towerY);
    const forestCommit = session.commit(doc);
    expect(forestCommit).not.toBeNull();
    history.execute(doc, forestCommit!.command, { alreadyApplied: true });

    const preTowerCell = inspectCellAtDoc(doc, towerX, towerY);
    expect(preTowerCell).not.toBeNull();
    expect(preTowerCell!.isLand).toBe(true);
    expect(preTowerCell!.height).toBeGreaterThan(0);
    expect(preTowerCell!.cover).toBe(COVER_FOREST);

    // 2. Colloca una Torre sul versante e una seconda etichetta
    const towerCatalog = BUILTIN_POI_CATALOG.find((item) => item.id === 'poi-tower')!;
    const tower = createPoiStampObject(towerCatalog, towerX, towerY, {
      width: 112,
      height: 112,
      rotationDeg: 12
    });
    const label = createLabelObject('Torre del Crinale', towerX + 80, towerY + 90, doc.theme, 'city');

    history.execute(doc, new AddObjectCommand(tower));
    history.execute(doc, new AddObjectCommand(label));

    expect(doc.manifest.assets.some((a) => a.id === 'poi-tower')).toBe(true);
    expect(doc.manifest.objects).toHaveLength(2);
    expect(() => validateDocumentManifest(doc.manifest)).not.toThrow();

    const beforeLakeMask = new Uint8Array(doc.terrain.mask);
    const beforeLakeHeight = new Uint8Array(doc.terrain.height);
    const beforeLakeCover = new Uint8Array(doc.terrain.cover);
    const towerSnapshotBefore = cloneMapObject(doc.manifest.objects[0] as StampObject);

    // 3. Scava un lago direttamente sotto la torre usando TerrainStrokeSession('water')
    session.beginStroke(doc, { tool: 'water', diameterDoc: 240, intensity: 1 }, towerX - 30, towerY);
    session.addPoint(doc, towerX + 30, towerY);
    const waterCommit = session.commit(doc);
    expect(waterCommit).not.toBeNull();
    history.execute(doc, waterCommit!.command, { alreadyApplied: true });

    expect(isPointOnLand(doc, towerX, towerY)).toBe(false);
    const underTowerAfterLake = inspectCellAtDoc(doc, towerX, towerY);
    expect(underTowerAfterLake!.mask).toBe(0);
    expect(underTowerAfterLake!.height).toBe(0);
    expect(underTowerAfterLake!.cover).toBe(COVER_NATURAL);

    const afterLakeMask = new Uint8Array(doc.terrain.mask);
    const afterLakeHeight = new Uint8Array(doc.terrain.height);
    const afterLakeCover = new Uint8Array(doc.terrain.cover);

    // La torre mantiene identico id, posizione, dimensioni, rotazione e ordine
    expect(doc.manifest.objects).toHaveLength(2);
    expect(doc.manifest.objects[0]).toEqual(towerSnapshotBefore);
    expect(doc.manifest.objects[1].id).toBe(label.id);

    // 4. Undo del lago: tutti e tre i raster tornano identici al pre-lago, torre intatta
    const undone = history.undo(doc);
    expect(undone).not.toBeNull();
    expect(countDiffBytes(doc.terrain.mask, beforeLakeMask)).toBe(0);
    expect(countDiffBytes(doc.terrain.height, beforeLakeHeight)).toBe(0);
    expect(countDiffBytes(doc.terrain.cover, beforeLakeCover)).toBe(0);
    expect(doc.manifest.objects[0]).toEqual(towerSnapshotBefore);
    expect(doc.manifest.objects[1].id).toBe(label.id);

    // 5. Redo del lago: coerenza completa di raster e oggetti
    const redone = history.redo(doc);
    expect(redone).not.toBeNull();
    expect(countDiffBytes(doc.terrain.mask, afterLakeMask)).toBe(0);
    expect(countDiffBytes(doc.terrain.height, afterLakeHeight)).toBe(0);
    expect(countDiffBytes(doc.terrain.cover, afterLakeCover)).toBe(0);
    expect(doc.manifest.objects[0]).toEqual(towerSnapshotBefore);
    expect(doc.manifest.objects[1].id).toBe(label.id);
  });

  it('preserves selected id across ReorderObjectsCommand and keeps foreground-first order and asset registration coherent', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
    const store = new EditorStore({
      initialDocument: doc,
      strokeSession: new TerrainStrokeSession(),
      renderer: new TerrainRenderer()
    });

    const settlementCatalog = BUILTIN_POI_CATALOG.find((i) => i.id === 'poi-settlement')!;
    const towerCatalog = BUILTIN_POI_CATALOG.find((i) => i.id === 'poi-tower')!;

    const obj1 = createPoiStampObject(settlementCatalog, 600, 500);
    const obj2 = createPoiStampObject(towerCatalog, 610, 505);
    const obj3 = createPoiStampObject(towerCatalog, 620, 510);
    const obj4 = createLabelObject('Cittadella', 590, 495, doc.theme, 'title');

    store.executeCommand(new AddObjectCommand(obj1));
    store.executeCommand(new AddObjectCommand(obj2));
    store.executeCommand(new AddObjectCommand(obj3));
    store.executeCommand(new AddObjectCommand(obj4));

    // Asset 'poi-tower' deve apparire una sola volta nel manifest anche con due torri
    expect(doc.manifest.assets.filter((a) => a.id === 'poi-tower')).toHaveLength(1);
    expect(doc.manifest.objects.map((o) => o.id)).toEqual([obj1.id, obj2.id, obj3.id, obj4.id]);

    // Seleziona l'oggetto sul fondo (index 0) e portalo in primo piano
    store.selectObject(obj1.id);
    expect(store.getSnapshot().selectedObjectId).toBe(obj1.id);

    store.executeCommand(new ReorderObjectsCommand(obj1.id, 3, 'Porta in primo piano'));
    expect(store.getSnapshot().selectedObjectId).toBe(obj1.id);
    expect(doc.manifest.objects.map((o) => o.id)).toEqual([obj2.id, obj3.id, obj4.id, obj1.id]);

    // Ordine lista primo-piano-per-primo (inverso dell'array di disegno)
    const foregroundFirstIds = [...doc.manifest.objects].reverse().map((o) => o.id);
    expect(foregroundFirstIds).toEqual([obj1.id, obj4.id, obj3.id, obj2.id]);

    // Porta indietro di un passo
    const movedBack = commitObjectReorder(store, obj1.id, 2, 'Porta indietro');
    expect(movedBack).toBe(true);
    expect(store.getSnapshot().selectedObjectId).toBe(obj1.id);
    expect(doc.manifest.objects.map((o) => o.id)).toEqual([obj2.id, obj3.id, obj1.id, obj4.id]);

    // Riordino no-op allo stesso indice
    const revBeforeNoOp = doc.manifest.revision;
    expect(commitObjectReorder(store, obj1.id, 2)).toBe(false);
    expect(doc.manifest.revision).toBe(revBeforeNoOp);

    // Undo / Redo del riordino
    store.undo();
    expect(doc.manifest.objects.map((o) => o.id)).toEqual([obj2.id, obj3.id, obj4.id, obj1.id]);
    expect(store.getSnapshot().selectedObjectId).toBe(obj1.id);

    store.undo();
    expect(doc.manifest.objects.map((o) => o.id)).toEqual([obj1.id, obj2.id, obj3.id, obj4.id]);
    expect(store.getSnapshot().selectedObjectId).toBe(obj1.id);

    store.redo();
    expect(doc.manifest.objects.map((o) => o.id)).toEqual([obj2.id, obj3.id, obj4.id, obj1.id]);
    expect(store.getSnapshot().selectedObjectId).toBe(obj1.id);

    // Verifica pulizia asset su undo di AddObjectCommand:
    // annulliamo obj4, obj3 (seconda torre: asset resta) e obj2 (prima torre: asset rimosso)
    store.undo(); // torna a [obj1, obj2, obj3, obj4]
    store.undo(); // rimuove obj4
    store.undo(); // rimuove obj3 (seconda torre) -> poi-tower ancora referenziato da obj2
    expect(doc.manifest.assets.some((a) => a.id === 'poi-tower')).toBe(true);
    store.undo(); // rimuove obj2 (prima torre) -> poi-tower non più referenziato -> rimosso
    expect(doc.manifest.assets.some((a) => a.id === 'poi-tower')).toBe(false);
    expect(() => validateDocumentManifest(doc.manifest)).not.toThrow();

    store.redo();
    expect(doc.manifest.assets.some((a) => a.id === 'poi-tower')).toBe(true);
    expect(() => validateDocumentManifest(doc.manifest)).not.toThrow();

    store.dispose();
  });

  it('supports Italian accented labels, atomic UpdateObjectCommand, no-op skipping, and DeleteObjectCommand index restoration', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
    const store = new EditorStore({
      initialDocument: doc,
      strokeSession: new TerrainStrokeSession(),
      renderer: new TerrainRenderer()
    });

    const towerCatalog = BUILTIN_POI_CATALOG.find((i) => i.id === 'poi-tower')!;
    const stampBefore = createPoiStampObject(towerCatalog, 300, 400);
    const labelInitial = createLabelObject('Città dell’Alba', 800, 620, doc.theme, 'city');
    const stampAfter = createPoiStampObject(towerCatalog, 1100, 750);

    store.executeCommand(new AddObjectCommand(stampBefore));
    store.executeCommand(new AddObjectCommand(labelInitial));
    store.executeCommand(new AddObjectCommand(stampAfter));
    store.selectObject(labelInitial.id);

    // Modifica testo con accenti e proprietà tipografiche/trasformazioni
    const prevLabel = cloneMapObject(doc.manifest.objects[1] as LabelObject);
    const updatedLabel: LabelObject = {
      ...prevLabel,
      text: 'Porto delle Brume',
      fontId: 'spectral-italic',
      fontSize: 44.5,
      color: '#8B493D',
      rotationDeg: 18,
      x: 840,
      y: 650
    };

    const committed = commitObjectUpdate(store, prevLabel, updatedLabel, 'Modifica etichetta');
    expect(committed).toBe(true);

    const storedLabel = doc.manifest.objects[1] as LabelObject;
    expect(storedLabel.text).toBe('Porto delle Brume');
    expect(storedLabel.fontId).toBe('spectral-italic');
    expect(storedLabel.fontSize).toBe(44.5);
    expect(storedLabel.color).toBe('#8B493D');
    expect(storedLabel.rotationDeg).toBe(18);
    expect(() => validateDocumentManifest(doc.manifest)).not.toThrow();

    // Skip no-op se il testo e tutte le proprietà sono invariate
    const revBeforeNoOp = doc.manifest.revision;
    const sameSnapshot = cloneMapObject(storedLabel);
    expect(areMapObjectsEqual(storedLabel, sameSnapshot)).toBe(true);
    expect(new UpdateObjectCommand(storedLabel.id, storedLabel, sameSnapshot).isNoOp()).toBe(true);
    expect(commitObjectUpdate(store, storedLabel, sameSnapshot, 'Modifica etichetta')).toBe(false);
    expect(doc.manifest.revision).toBe(revBeforeNoOp);

    // Undo / Redo della modifica etichetta
    expect(store.undo()).toBe(true);
    expect((doc.manifest.objects[1] as LabelObject).text).toBe('Città dell’Alba');
    expect((doc.manifest.objects[1] as LabelObject).rotationDeg).toBe(0);

    expect(store.redo()).toBe(true);
    expect((doc.manifest.objects[1] as LabelObject).text).toBe('Porto delle Brume');
    expect((doc.manifest.objects[1] as LabelObject).rotationDeg).toBe(18);

    // DeleteObjectCommand sull'elemento centrale (index 1) + undo() ripristina all'indice esatto + redo()
    store.executeCommand(new DeleteObjectCommand(labelInitial.id, 'Elimina etichetta'));
    expect(doc.manifest.objects.map((o) => o.id)).toEqual([stampBefore.id, stampAfter.id]);
    expect(store.getSnapshot().selectedObjectId).toBeNull();

    expect(store.undo()).toBe(true);
    expect(doc.manifest.objects.map((o) => o.id)).toEqual([
      stampBefore.id,
      labelInitial.id,
      stampAfter.id
    ]);
    expect((doc.manifest.objects[1] as LabelObject).text).toBe('Porto delle Brume');

    expect(store.redo()).toBe(true);
    expect(doc.manifest.objects.map((o) => o.id)).toEqual([stampBefore.id, stampAfter.id]);

    store.dispose();
  });

  it('handles 2,000 POI stamps cleanly in document, manifest validation, and history operations', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
    const history = new HistoryManager();
    const towerCatalog = BUILTIN_POI_CATALOG.find((i) => i.id === 'poi-tower')!;

    for (let i = 0; i < 2000; i += 1) {
      const col = i % 50;
      const row = Math.floor(i / 50);
      const stamp = createPoiStampObject(towerCatalog, 60 + col * 56, 60 + row * 50, {
        id: `tower-${i}`,
        width: 48,
        height: 48
      });
      history.execute(doc, new AddObjectCommand(stamp));
    }

    expect(doc.manifest.objects).toHaveLength(2000);
    expect(doc.manifest.assets).toHaveLength(1);
    expect(() => validateDocumentManifest(doc.manifest)).not.toThrow();

    history.execute(doc, new ReorderObjectsCommand('tower-0', 1999));
    expect(doc.manifest.objects[1999].id).toBe('tower-0');
    history.undo(doc);
    expect(doc.manifest.objects[0].id).toBe('tower-0');
  });

  it('renders PoiLibraryPanel, ObjectListPanel (empty, foreground-first, 2,000-symbol windowed), ObjectInspector, and InlineLabelEditor accurately', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
    const store = new EditorStore({
      initialDocument: doc,
      strokeSession: new TerrainStrokeSession(),
      renderer: new TerrainRenderer()
    });

    // PoiLibraryPanel
    store.setActivePoiId('poi-tower');
    const poiHtml = renderToStaticMarkup(createElement(PoiLibraryPanel, { store }));
    expect(poiHtml).toContain('Insediamento');
    expect(poiHtml).toContain('Porto');
    expect(poiHtml).toContain('Torre');
    expect(poiHtml).toContain('Rovina');
    expect(poiHtml).toContain('Cittadella');
    expect(poiHtml).toContain('Monolite');
    expect(poiHtml).toContain('aria-pressed="true"');

    // Empty ObjectListPanel
    const emptyListHtml = renderToStaticMarkup(createElement(ObjectListPanel, { store }));
    expect(emptyListHtml).toContain('Nessun oggetto sulla mappa.');

    // Populate with 1 stamp + 1 label
    const towerCatalog = BUILTIN_POI_CATALOG.find((i) => i.id === 'poi-tower')!;
    const tower = createPoiStampObject(towerCatalog, 400, 300);
    const label = createLabelObject('Porto delle Brume', 600, 500, doc.theme, 'city');
    store.executeCommand(new AddObjectCommand(tower));
    store.executeCommand(new AddObjectCommand(label));
    store.selectObject(label.id);

    const listHtml = renderToStaticMarkup(createElement(ObjectListPanel, { store }));
    // Primo piano (label) appare prima del fondo (Torre)
    expect(listHtml.indexOf('Porto delle Brume')).toBeLessThan(listHtml.indexOf('Torre'));
    expect(listHtml).toContain('aria-current="true"');
    expect(listHtml).toContain('has-tooltip-top');
    expect(listHtml).toContain('data-tooltip="Porta avanti"');
    expect(listHtml).toContain('data-tooltip="Porta indietro"');
    expect(listHtml).toContain('data-tooltip="Elimina"');
    expect(listHtml).toContain('min-width:36px');
    expect(listHtml).toContain('min-height:36px');
    expect(listHtml).not.toContain('font-size:11px');
    expect(listHtml).not.toContain('font-size:12px');
    expect(listHtml).not.toContain('font-size:14px');

    // ObjectInspector for Label
    const labelInspectorHtml = renderToStaticMarkup(createElement(ObjectInspector, { store }));
    expect(labelInspectorHtml).toContain('Porto delle Brume');
    expect(labelInspectorHtml).toContain('Titolo (16 pt)');
    expect(labelInspectorHtml).toContain('Città (11 pt)');
    expect(labelInspectorHtml).toContain('Mare (10 pt corsivo)');
    expect(labelInspectorHtml).toContain('#263C40');
    expect(labelInspectorHtml).toContain('#8B493D');
    expect(labelInspectorHtml).toContain('width:36px;height:36px;min-width:36px;min-height:36px');
    expect(labelInspectorHtml).not.toContain('font-size:14px');

    // ObjectInspector for Stamp
    store.selectObject(tower.id);
    const stampInspectorHtml = renderToStaticMarkup(createElement(ObjectInspector, { store }));
    expect(stampInspectorHtml).toContain('Torre');
    expect(stampInspectorHtml).toContain('Larghezza');
    expect(stampInspectorHtml).toContain('Altezza');
    expect(stampInspectorHtml).toContain('Mantieni proporzioni');
    expect(stampInspectorHtml).toContain('Rotazione');
    expect(stampInspectorHtml).toContain('font-size:15px');
    expect(stampInspectorHtml).not.toContain('font-size:14px');

    // InlineLabelEditor positioned via docToScreen with Italian accents
    store.setCamera({ offsetX: 100, offsetY: 50, scale: 0.5 });
    const inlineHtml = renderToStaticMarkup(
      createElement(InlineLabelEditor, {
        store,
        session: {
          mode: 'edit',
          docX: 800,
          docY: 400,
          objectId: label.id,
          initialText: 'Città dell’Alba',
          fontId: 'spectral-semibold',
          fontSize: 38.81,
          color: '#263C40',
          rotationDeg: 0
        },
        onClose: () => {}
      })
    );
    // screenX = 800 * 0.5 + 100 = 500, screenY = 400 * 0.5 + 50 = 250
    expect(inlineHtml).toContain('left:500px');
    expect(inlineHtml).toContain('top:250px');
    expect(inlineHtml).toContain('Città dell’Alba');

    // 2,000 objects windowing in ObjectListPanel while keeping background-selected item pinned
    const bigDoc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
    for (let i = 0; i < 2000; i += 1) {
      bigDoc.manifest.objects.push(
        createPoiStampObject(towerCatalog, 100, 100, { id: `big-${i}` })
      );
    }
    bigDoc.manifest.assets.push({ ...towerCatalog.asset });
    const bigStore = new EditorStore({
      initialDocument: bigDoc,
      strokeSession: new TerrainStrokeSession(),
      renderer: new TerrainRenderer()
    });
    bigStore.selectObject('big-0'); // sul fondo (#2000 su 2000)
    const bigListHtml = renderToStaticMarkup(createElement(ObjectListPanel, { store: bigStore }));
    expect(bigListHtml).toContain('Selezionato (#2000 su 2000)');
    expect(bigListHtml).toContain('Mostra altri (1900 rimanenti)');
    expect(bigListHtml).not.toContain('font-size:12px');

    bigStore.dispose();
    store.dispose();
  });

  it('stops propagation on Delete and Backspace in ObjectListPanel rows so window shortcuts cannot double-delete', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
    const store = new EditorStore({
      initialDocument: doc,
      strokeSession: new TerrainStrokeSession(),
      renderer: new TerrainRenderer()
    });

    const towerCatalog = BUILTIN_POI_CATALOG.find((i) => i.id === 'poi-tower')!;
    const objA = createPoiStampObject(towerCatalog, 300, 300, { id: 'obj-a' });
    const objB = createPoiStampObject(towerCatalog, 500, 500, { id: 'obj-b' });
    const objC = createPoiStampObject(towerCatalog, 700, 700, { id: 'obj-c' });
    store.executeCommand(new AddObjectCommand(objA));
    store.executeCommand(new AddObjectCommand(objB));
    store.executeCommand(new AddObjectCommand(objC));
    store.selectObject(objC.id);

    for (const [key, targetObj] of [
      ['Delete', objA],
      ['Backspace', objB]
    ] as const) {
      let prevented = false;
      let stopped = false;

      const handled = handleObjectListItemKeyDown(
        {
          key,
          preventDefault: () => {
            prevented = true;
          },
          stopPropagation: () => {
            stopped = true;
          }
        },
        {
          onDelete: () => {
            store.executeCommand(new DeleteObjectCommand(targetObj.id, 'Elimina simbolo'));
          }
        }
      );

      expect(handled).toBe(true);
      expect(prevented).toBe(true);
      expect(stopped).toBe(true);

      // Simulazione risalita verso window: non deve invocare la cancellazione globale sul selezionato
      if (!stopped && store.getSnapshot().selectedObjectId) {
        store.executeCommand(new DeleteObjectCommand(store.getSnapshot().selectedObjectId!));
      }
    }

    expect(doc.manifest.objects.map((o) => o.id)).toEqual([objC.id]);
    expect(store.getSnapshot().selectedObjectId).toBe(objC.id);

    store.dispose();
  });

  it('executes AddObjectsBatchCommand atomically with undo/redo asset cleanup and supports layerId/scale options', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
    const store = new EditorStore({
      initialDocument: doc,
      strokeSession: new TerrainStrokeSession(),
      renderer: new TerrainRenderer()
    });

    const castleCatalog = BUILTIN_POI_CATALOG.find((i) => i.id === 'poi-castle')!;
    const harborCatalog = BUILTIN_POI_CATALOG.find((i) => i.id === 'poi-harbor')!;

    // Pre-esistente harbour per verificare che l'undo del batch mantenga asset referenziati altrove
    const existingHarbor = createPoiStampObject(harborCatalog, 250, 250, {
      layerId: DEFAULT_LAYER_POI_ID,
      scale: 1.5
    });
    expect(existingHarbor.layerId).toBe(DEFAULT_LAYER_POI_ID);
    expect(existingHarbor.width).toBeCloseTo(harborCatalog.defaultWidthDoc * 1.5, 2);
    expect(existingHarbor.height).toBeCloseTo(harborCatalog.defaultHeightDoc * 1.5, 2);
    store.executeCommand(new AddObjectCommand(existingHarbor));

    const scaledLabel = createLabelObject('Rocca del Nord', 500, 300, doc.theme, 'city', {
      layerId: DEFAULT_LAYER_LABELS_ID,
      scale: 1.25
    });
    expect(scaledLabel.layerId).toBe(DEFAULT_LAYER_LABELS_ID);
    expect(scaledLabel.fontSize).toBeCloseTo(createLabelObject('X', 0, 0, doc.theme, 'city').fontSize * 1.25, 1);

    const revBeforeBatch = doc.manifest.revision;
    const batchStamps = [
      createPoiStampObject(castleCatalog, 600, 400, { layerId: DEFAULT_LAYER_POI_ID, scale: 0.9 }),
      createPoiStampObject(castleCatalog, 680, 440, { layerId: DEFAULT_LAYER_POI_ID, scale: 1.1 }),
      createPoiStampObject(harborCatalog, 720, 480, { layerId: DEFAULT_LAYER_POI_ID, scale: 1.0 })
    ];

    store.executeCommand(
      new AddObjectsBatchCommand(batchStamps, 'Pennellata POI scatter', [
        castleCatalog.asset,
        harborCatalog.asset
      ])
    );

    // Un unico step di cronologia per tutto il batch
    expect(doc.manifest.revision).toBe(revBeforeBatch + 1);
    expect(doc.manifest.objects).toHaveLength(4);
    expect(doc.manifest.assets.filter((a) => a.id === 'poi-castle')).toHaveLength(1);
    expect(doc.manifest.assets.filter((a) => a.id === 'poi-harbor')).toHaveLength(1);
    expect(() => validateDocumentManifest(doc.manifest)).not.toThrow();

    // Un solo undo rimuove tutti e 3 gli oggetti del batch e rimuove poi-castle (non più referenziato),
    // ma conserva poi-harbor usato da existingHarbor
    expect(store.undo()).toBe(true);
    expect(doc.manifest.objects.map((o) => o.id)).toEqual([existingHarbor.id]);
    expect(doc.manifest.assets.some((a) => a.id === 'poi-castle')).toBe(false);
    expect(doc.manifest.assets.some((a) => a.id === 'poi-harbor')).toBe(true);

    // Redo ripristina tutti e 3 gli oggetti del batch e l'asset poi-castle
    expect(store.redo()).toBe(true);
    expect(doc.manifest.objects).toHaveLength(4);
    expect(doc.manifest.assets.some((a) => a.id === 'poi-castle')).toBe(true);
    expect(() => validateDocumentManifest(doc.manifest)).not.toThrow();

    store.dispose();
  });

  it('simplifies polylines via Ramer-Douglas-Peucker, centers PathObject around its bounding box, and tracks PathObject & layerId updates', () => {
    const raw = [0, 0, 25, 0.3, 50, -0.2, 100, 0, 150, 48, 175, 48.2, 200, 48];
    const simplified = simplifyPolyline(raw, 2);
    expect(simplified).toEqual([0, 0, 100, 0, 150, 48, 200, 48]);

    // Polilinea corta o tolleranza <= 0 conserva i vertici originali
    expect(simplifyPolyline([10, 20, 30, 40], 5)).toEqual([10, 20, 30, 40]);
    expect(simplifyPolyline(raw, 0)).toEqual(raw);

    const doc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
    const river = createPathObject({
      kind: 'river',
      points: [100, 200, 200, 260, 300, 220],
      theme: doc.theme
    });
    // Bounding box X: [100, 300] -> center 200; Y: [200, 260] -> center 230
    expect(river.x).toBe(200);
    expect(river.y).toBe(230);
    expect(river.points).toEqual([-100, -30, 0, 30, 100, -10]);
    expect(river.layerId).toBe(DEFAULT_LAYER_VECTORS_ID);
    expect(river.tapered).toBe(true);
    expect(river.smooth).toBe(true);
    expect(river.dashed).toBe(false);
    expect(river.color).toBe(doc.theme.colors.pathRiver);

    const store = new EditorStore({
      initialDocument: doc,
      strokeSession: new TerrainStrokeSession(),
      renderer: new TerrainRenderer()
    });
    store.executeCommand(new AddObjectCommand(river));
    expect(() => validateDocumentManifest(doc.manifest)).not.toThrow();

    const prev = cloneMapObject(doc.manifest.objects[0] as PathObject);
    expect(areMapObjectsEqual(prev, cloneMapObject(prev))).toBe(true);

    const next: PathObject = {
      ...prev,
      kind: 'border',
      layerId: DEFAULT_LAYER_POI_ID,
      strokeWidthDoc: 18,
      color: doc.theme.colors.pathBorder,
      opacity: 0.75,
      dashed: true,
      tapered: false,
      smooth: false,
      rotationDeg: 15
    };
    expect(areMapObjectsEqual(prev, next)).toBe(false);
    expect(commitObjectUpdate(store, prev, next, 'Modifica tracciato')).toBe(true);

    const updated = doc.manifest.objects[0] as PathObject;
    expect(updated.kind).toBe('border');
    expect(updated.layerId).toBe(DEFAULT_LAYER_POI_ID);
    expect(updated.strokeWidthDoc).toBe(18);
    expect(updated.opacity).toBe(0.75);
    expect(updated.dashed).toBe(true);
    expect(updated.tapered).toBe(false);
    expect(updated.smooth).toBe(false);
    expect(updated.rotationDeg).toBe(15);

    store.undo();
    const reverted = doc.manifest.objects[0] as PathObject;
    expect(reverted.kind).toBe('river');
    expect(reverted.layerId).toBe(DEFAULT_LAYER_VECTORS_ID);
    expect(reverted.tapered).toBe(true);

    store.dispose();
  });

  it('enforces layer groups order, visibility/lock guards, live path drawing, and POI scatter in ObjectsLayerController', () => {
    const prevDocument = (globalThis as { document?: unknown }).document;
    const noop = () => {};
    const ctx2d = new Proxy(
      {
        canvas: {},
        measureText: () => ({ width: 60 }),
        createImageData: (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4)
        }),
        getImageData: () => ({ data: new Uint8ClampedArray(4) })
      },
      { get: (t, p) => (p in t ? (t as Record<string | symbol, unknown>)[p] : noop) }
    );
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({
        width: 200,
        height: 200,
        style: {},
        getContext: () => ctx2d,
        addEventListener: noop,
        removeEventListener: noop
      }),
      querySelector: () => null
    };

    try {
      const containerStub = {
        appendChild: noop,
        style: {},
        clientWidth: 960,
        clientHeight: 640,
        innerHTML: ''
      } as unknown as HTMLDivElement;

      const stage = new KonvaCtor.Stage({ container: containerStub, width: 960, height: 640 });
      const terrainLayer = new KonvaCtor.Layer({ listening: false });
      const objectsLayer = new KonvaCtor.Layer({ listening: false });
      const overlayLayer = new KonvaCtor.Layer({ listening: false });
      stage.add(terrainLayer, objectsLayer, overlayLayer);

      const doc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
      const store = new EditorStore({
        initialDocument: doc,
        strokeSession: new TerrainStrokeSession(),
        renderer: new TerrainRenderer()
      });

      const controller = new ObjectsLayerController({
        layers: { stage, terrainLayer, objectsLayer, overlayLayer },
        store
      });

      // Verifica gruppi Konva ordinati come i livelli non-terrain in manifest.layers
      const groups = objectsLayer.getChildren();
      expect(groups.map((g) => g.id())).toEqual([
        DEFAULT_LAYER_VECTORS_ID,
        DEFAULT_LAYER_POI_ID,
        DEFAULT_LAYER_LABELS_ID
      ]);
      expect(groups.every((g) => g.visible() && g.listening() && g.opacity() === 1)).toBe(true);

      // 1. Disegno tracciato live (`activeTool === 'path'`)
      store.setTool('path');
      store.setActiveLayerId(DEFAULT_LAYER_VECTORS_ID);
      const fakeEvent = { pointerId: 1 } as unknown as PointerEvent;
      expect(
        controller.handlePointerDown({
          docX: 300,
          docY: 400,
          cssX: 300,
          cssY: 400,
          camera: store.getSnapshot().camera,
          event: fakeEvent
        })
      ).toBe(true);
      controller.handlePointerMove({
        docX: 450,
        docY: 460,
        cssX: 450,
        cssY: 460,
        camera: store.getSnapshot().camera,
        event: fakeEvent
      });
      controller.handlePointerUp({
        docX: 600,
        docY: 420,
        cssX: 600,
        cssY: 420,
        camera: store.getSnapshot().camera,
        event: fakeEvent
      });

      expect(doc.manifest.objects).toHaveLength(1);
      const drawnPath = doc.manifest.objects[0] as PathObject;
      expect(drawnPath.type).toBe('path');
      expect(drawnPath.layerId).toBe(DEFAULT_LAYER_VECTORS_ID);
      const vectorsGroup = objectsLayer.findOne(`#${DEFAULT_LAYER_VECTORS_ID}`) as Konva.Group;
      expect(vectorsGroup.getChildren()).toHaveLength(1);
      expect(vectorsGroup.getChildren()[0].getClassName()).toBe('Shape');

      // 2. Piazzamento POI scatter con variazione scala +-15% e singolo AddObjectsBatchCommand
      store.setTool('poi');
      store.setActivePoiId('poi-tower');
      store.setActiveLayerId(DEFAULT_LAYER_POI_ID);
      store.setPoiPlacementScale(1.5);
      store.setPoiBrushMode('scatter');
      store.setPoiScatterDensity(5);
      store.setPoiScatterRadiusDoc(140);

      const towerCatalog = BUILTIN_POI_CATALOG.find((i) => i.id === 'poi-tower')!;
      const revBeforeScatter = doc.manifest.revision;
      expect(
        controller.handlePointerDown({
          docX: 900,
          docY: 700,
          cssX: 900,
          cssY: 700,
          camera: store.getSnapshot().camera,
          event: fakeEvent
        })
      ).toBe(true);
      expect(doc.manifest.revision).toBe(revBeforeScatter + 1);
      expect(doc.manifest.objects).toHaveLength(6);
      const scattered = doc.manifest.objects.slice(1) as StampObject[];
      for (const s of scattered) {
        expect(s.layerId).toBe(DEFAULT_LAYER_POI_ID);
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(doc.manifest.space.width);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(doc.manifest.space.height);
        const expectedBase = towerCatalog.defaultWidthDoc * 1.5;
        expect(s.width).toBeGreaterThanOrEqual(expectedBase * 0.84);
        expect(s.width).toBeLessThanOrEqual(expectedBase * 1.16);
      }

      // 3. Blocco di un livello impedisce selezione su tela, nuovo disegno e cancellazione
      const vectorsLayer = doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_VECTORS_ID)!;
      store.executeCommand(
        new UpdateLayerCommand(vectorsLayer, { ...vectorsLayer, locked: true })
      );
      expect(vectorsGroup.listening()).toBe(false);

      // Tentativo di disegno su livello bloccato mostra notice e non crea oggetti
      store.setTool('path');
      store.setActiveLayerId(DEFAULT_LAYER_VECTORS_ID);
      controller.handlePointerDown({
        docX: 200,
        docY: 200,
        cssX: 200,
        cssY: 200,
        camera: store.getSnapshot().camera,
        event: fakeEvent
      });
      controller.handlePointerUp({
        docX: 350,
        docY: 240,
        cssX: 350,
        cssY: 240,
        camera: store.getSnapshot().camera,
        event: fakeEvent
      });
      expect(doc.manifest.objects).toHaveLength(6);
      expect(store.getSnapshot().statusNotice?.text).toContain('bloccato');

      // Tentativo di selezione cliccando sopra al tracciato su livello bloccato
      store.setTool('select');
      store.selectObject(null);
      controller.handlePointerDown({
        docX: drawnPath.x,
        docY: drawnPath.y,
        cssX: drawnPath.x,
        cssY: drawnPath.y,
        camera: store.getSnapshot().camera,
        event: fakeEvent
      });
      expect(store.getSnapshot().selectedObjectId).toBeNull();

      // Tentativo di eliminazione da tastiera su oggetto di livello bloccato non elimina
      store.selectObject(drawnPath.id);
      controller.handleKeyDown({ key: 'Delete', target: null });
      expect(doc.manifest.objects.some((o) => o.id === drawnPath.id)).toBe(true);

      // 4. Nascondere livello aggiorna Konva.Group visible/listening e blocca posa POI
      const poiLayer = doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_POI_ID)!;
      store.executeCommand(
        new UpdateLayerCommand(poiLayer, { ...poiLayer, visible: false, opacity: 0.45 })
      );
      const poiGroup = objectsLayer.findOne(`#${DEFAULT_LAYER_POI_ID}`) as Konva.Group;
      expect(poiGroup.visible()).toBe(false);
      expect(poiGroup.listening()).toBe(false);
      expect(poiGroup.opacity()).toBeCloseTo(0.45, 2);

      store.setTool('poi');
      store.setActiveLayerId(DEFAULT_LAYER_POI_ID);
      controller.handlePointerDown({
        docX: 1200,
        docY: 900,
        cssX: 1200,
        cssY: 900,
        camera: store.getSnapshot().camera,
        event: fakeEvent
      });
      expect(doc.manifest.objects).toHaveLength(6);

      controller.dispose();
      stage.destroy();
      store.dispose();
    } finally {
      if (prevDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDocument;
      }
    }
  });

  it('renders LayersPanel, PathToolPanel, expanded PoiLibraryPanel, ObjectListPanel badges, and Path/Layer ObjectInspector in SSR without DOM', () => {
    const doc = createEmptyDocument({ widthPx: 128, heightPx: 128 });
    const store = new EditorStore({
      initialDocument: doc,
      strokeSession: new TerrainStrokeSession(),
      renderer: new TerrainRenderer()
    });

    const towerCatalog = BUILTIN_POI_CATALOG.find((i) => i.id === 'poi-tower')!;
    const river = createPathObject({
      kind: 'river',
      points: [200, 200, 420, 340],
      theme: doc.theme
    });
    const tower = createPoiStampObject(towerCatalog, 600, 500, { layerId: DEFAULT_LAYER_POI_ID });
    const label = createLabelObject('Valico Ventoso', 800, 620, doc.theme, 'city', {
      layerId: DEFAULT_LAYER_LABELS_ID
    });
    store.executeCommand(new AddObjectCommand(river));
    store.executeCommand(new AddObjectCommand(tower));
    store.executeCommand(new AddObjectCommand(label));

    // PoiLibraryPanel (31 di 31, categorie, scatter sliders)
    store.setPoiBrushMode('scatter');
    const poiHtml = renderToStaticMarkup(createElement(PoiLibraryPanel, { store }));
    expect(poiHtml).toContain(`${BUILTIN_POI_CATALOG.length} di ${BUILTIN_POI_CATALOG.length}`);
    expect(poiHtml).toContain('Tutte');
    for (const cat of POI_CATEGORIES) {
      expect(poiHtml).toContain(cat.label);
    }
    expect(poiHtml).toContain('Singolo');
    expect(poiHtml).toContain('Scatter');
    expect(poiHtml).toContain('Scala POI');
    expect(poiHtml).toContain('Raggio');
    expect(poiHtml).toContain('Densità');
    expect(poiHtml).not.toContain('font-size:11px');
    expect(poiHtml).not.toContain('font-size:12px');
    expect(poiHtml).not.toContain('font-size:14px');

    // PathToolPanel
    const pathHtml = renderToStaticMarkup(createElement(PathToolPanel, { store }));
    expect(pathHtml).toContain('Fiume');
    expect(pathHtml).toContain('Strada');
    expect(pathHtml).toContain('Confine');
    expect(pathHtml).toContain('Inchiostro libero');
    expect(pathHtml).toContain('Spessore');
    expect(pathHtml).toContain('Curva morbida');
    expect(pathHtml).toContain('Affusolato');
    expect(pathHtml).toContain('Tratteggiato');
    expect(pathHtml).toContain('type="color"');
    expect(pathHtml).toContain('Luoghi e POI'); // activeLayerId default target or resolved target
    expect(pathHtml).not.toContain('font-size:11px');
    expect(pathHtml).not.toContain('font-size:12px');
    expect(pathHtml).not.toContain('font-size:14px');

    // LayersPanel (ordine inverso con Base in fondo + controlli accessibili)
    const layersHtml = renderToStaticMarkup(createElement(LayersPanel, { store }));
    expect(layersHtml).toContain('+ Nuovo livello');
    expect(layersHtml).toContain('Base');
    expect(layersHtml).toContain('Terreno e Rilievo');
    expect(layersHtml.indexOf('Nomi e Note')).toBeLessThan(layersHtml.indexOf('Luoghi e POI'));
    expect(layersHtml.indexOf('Luoghi e POI')).toBeLessThan(layersHtml.indexOf('Fiumi e Strade'));
    expect(layersHtml.indexOf('Fiumi e Strade')).toBeLessThan(layersHtml.indexOf('Terreno e Rilievo'));
    expect(layersHtml).not.toContain('font-size:11px');
    expect(layersHtml).not.toContain('font-size:12px');
    expect(layersHtml).not.toContain('font-size:14px');

    // Layer commands via store work coherently
    const customLayer = {
      id: 'layer-custom-notes',
      name: 'Note Master',
      kind: 'custom' as const,
      visible: true,
      locked: false,
      opacity: 0.8
    };
    store.executeCommand(new AddLayerCommand(customLayer));
    const afterAddOrder = [...doc.manifest.layers];
    const reordered = [
      afterAddOrder[0],
      afterAddOrder[1],
      afterAddOrder[2],
      afterAddOrder[4],
      afterAddOrder[3]
    ];
    store.executeCommand(new ReorderLayersCommand(afterAddOrder, reordered));
    expect(doc.manifest.layers[3].id).toBe('layer-custom-notes');
    store.executeCommand(new DeleteLayerCommand(DEFAULT_LAYER_TERRAIN_ID));
    expect(doc.manifest.layers.some((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)).toBe(true);

    // ObjectListPanel shows PathObject and layer badges
    const listHtml = renderToStaticMarkup(createElement(ObjectListPanel, { store }));
    expect(listHtml).toContain('Fiume');
    expect(listHtml).toContain('Fiumi e Strade');
    expect(listHtml).toContain('Luoghi e POI');
    expect(listHtml).toContain('Nomi e Note');

    // ObjectInspector for PathObject + Livello <select> + locked state
    store.selectObject(river.id);
    const pathInspectorHtml = renderToStaticMarkup(createElement(ObjectInspector, { store }));
    expect(pathInspectorHtml).toContain('Tracciato vettoriale');
    expect(pathInspectorHtml).toContain('Livello');
    expect(pathInspectorHtml).toContain('Spessore');
    expect(pathInspectorHtml).toContain('Opacità');
    expect(pathInspectorHtml).toContain('Curva morbida');
    expect(pathInspectorHtml).toContain('Affusolato');
    expect(pathInspectorHtml).toContain('Tratteggiato');
    expect(pathInspectorHtml).not.toContain('font-size:11px');
    expect(pathInspectorHtml).not.toContain('font-size:12px');
    expect(pathInspectorHtml).not.toContain('font-size:14px');

    // Lock river layer and verify ObjectInspector shows locked notice
    const vecLayer = doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_VECTORS_ID)!;
    store.executeCommand(new UpdateLayerCommand(vecLayer, { ...vecLayer, locked: true }));
    const lockedInspectorHtml = renderToStaticMarkup(createElement(ObjectInspector, { store }));
    expect(lockedInspectorHtml).toContain('è bloccato o nascosto');

    store.dispose();
  });
});
