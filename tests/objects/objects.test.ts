import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BUILTIN_POI_CATALOG } from '../../src/assets/catalog';
import {
  COVER_FOREST,
  COVER_NATURAL,
  LabelObject,
  StampObject,
  cloneMapObject,
  createEmptyDocument,
  validateDocumentManifest
} from '../../src/model/document';
import { HistoryManager } from '../../src/model/history';
import {
  AddObjectCommand,
  DeleteObjectCommand,
  ObjectsLayerController,
  PoiLibraryPanel,
  ObjectListPanel,
  ObjectInspector,
  InlineLabelEditor,
  ReorderObjectsCommand,
  UpdateObjectCommand,
  areMapObjectsEqual,
  commitObjectReorder,
  commitObjectUpdate,
  createLabelObject,
  createPoiStampObject
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
    expect(typeof UpdateObjectCommand).toBe('function');
    expect(typeof DeleteObjectCommand).toBe('function');
    expect(typeof ReorderObjectsCommand).toBe('function');
    expect(typeof ObjectsLayerController).toBe('function');
    expect(typeof PoiLibraryPanel).toBe('function');
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
});
