import 'fake-indexeddb/auto';
import {
  IDBFactory as FakeIDBFactory,
  IDBObjectStore as FakeIDBObjectStore
} from 'fake-indexeddb';
import { unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_POI_CATALOG, getBuiltinAssetSvgBytes } from '../../src/assets/catalog';
import { encodeMaskPng } from '../../src/core/png';
import {
  COVER_BRICK,
  COVER_FIELDS,
  COVER_FOREST,
  COVER_LAVA,
  COVER_MEADOW,
  COVER_NATURAL,
  COVER_ROCK,
  COVER_SAND,
  COVER_SNOW,
  COVER_SWAMP,
  DEFAULT_LAYER_LABELS_ID,
  DEFAULT_LAYER_POI_ID,
  DEFAULT_LAYER_TERRAIN_ID,
  DEFAULT_LAYER_VECTORS_ID,
  MapDocument,
  PathObject,
  SCHEMA_VERSION,
  createDefaultLayers,
  createEmptyDocument
} from '../../src/model/document';
import { createSampleWorldDocument } from '../../src/model/sampleDocument';
import {
  CartografoIndexedDb,
  ConflictError,
  MAX_ARCHIVE_FILES,
  PersistenceService,
  PersistenceState,
  exportProjectArchive,
  importProjectArchive,
  migrateManifestV1ToV2
} from '../../src/persistence';
import { validateMapTheme } from '../../src/persistence/archive';
import { migrateManifestToV3 } from '../../src/persistence/migration';
import { DEFAULT_THEME, NORDICA_THEME, V1_FLAT_THEME } from '../../src/theme/theme';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

function createCustomAssetBlob(svgText: string): Blob {
  return new Blob([svgText], { type: 'image/svg+xml' });
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function expectBytesEqual(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `Byte mismatch at index ${i}: expected ${expected[i]}, got ${actual[i]}`
      );
    }
  }
}

function createRichSampleDocument(): {
  doc: MapDocument;
  extraAssets: Map<string, Blob>;
} {
  const doc = createSampleWorldDocument({ widthPx: 96, heightPx: 72 });
  doc.manifest.title = 'Arcipelago delle Città Sospese — ÀÈÌÒÙ';

  const customAssetId = 'custom-banner';
  const customAssetPath = 'assets/custom-banner.svg';
  const customSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#8B493D"/></svg>';

  doc.manifest.assets.push({
    id: customAssetId,
    path: customAssetPath,
    mimeType: 'image/svg+xml',
    version: 1,
    author: 'Maestro Cartografo',
    source: 'custom-test',
    license: 'CC0-1.0',
    attribution: 'Laboratorio Cartografico',
    width: 64,
    height: 64,
    anchorX: 0.5,
    anchorY: 0.5
  });

  doc.manifest.objects.push(
    {
      id: 'obj-deco-banner',
      type: 'stamp',
      role: 'decorative',
      assetId: customAssetId,
      x: 420,
      y: 310,
      width: 64,
      height: 64,
      rotationDeg: 18
    },
    {
      id: 'obj-accented-label',
      type: 'label',
      text: 'Città di Èlite — Mare d’Argento (òàùìé)',
      x: 800,
      y: 640,
      fontId: 'spectral-italic',
      fontSize: 42.5,
      color: '#263C40',
      rotationDeg: -12.5
    }
  );

  // Add subtle partial antialiasing alpha & mixed cover codes for bit-for-bit verification
  doc.terrain.mask[10] = 128;
  doc.terrain.height[10] = 35;
  doc.terrain.cover[10] = COVER_FOREST;
  doc.terrain.mask[11] = 255;
  doc.terrain.height[11] = 210;
  doc.terrain.cover[11] = COVER_FIELDS;

  doc.theme.name = 'Tema personalizzato dell’Arcipelago';
  doc.theme.coast.strokeWidthDoc = 4.5;

  const extraAssets = new Map<string, Blob>([
    [customAssetPath, createCustomAssetBlob(customSvg)]
  ]);

  return { doc, extraAssets };
}

describe('Persistence, Archive & v1 Migration', () => {
  const activeServices: PersistenceService[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const service of activeServices.splice(0, activeServices.length)) {
      service.dispose();
    }
  });

  it('1. Round-trips a rich project bit-for-bit through IndexedDB and ZIP archive', async () => {
    const fdb = new FakeIDBFactory();
    const { doc, extraAssets } = createRichSampleDocument();

    const serviceA = new PersistenceService({ idbFactory: fdb, debounceMs: 10 });
    activeServices.push(serviceA);

    await serviceA.flushNow(doc, extraAssets);
    expect(serviceA.getState()).toEqual({
      status: 'saved',
      savedRevision: doc.manifest.revision
    });

    const summaries = await serviceA.listProjects();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe(doc.manifest.id);
    expect(summaries[0].title).toBe(doc.manifest.title);
    expect(summaries[0].revision).toBe(doc.manifest.revision);

    // Reopen from a fresh service instance (cold session)
    const serviceB = new PersistenceService({ idbFactory: fdb, debounceMs: 10 });
    activeServices.push(serviceB);

    const loaded = await serviceB.loadProject(doc.manifest.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.document.manifest).toEqual(doc.manifest);
    expect(loaded!.document.theme).toEqual(doc.theme);
    expect(loaded!.document.terrainVersion).toBe(doc.terrainVersion);
    expectBytesEqual(loaded!.document.terrain.mask, doc.terrain.mask);
    expectBytesEqual(loaded!.document.terrain.height, doc.terrain.height);
    expectBytesEqual(loaded!.document.terrain.cover, doc.terrain.cover);
    expect(loaded!.extraAssetBlobs.size).toBe(1);
    expectBytesEqual(
      await blobToBytes(loaded!.extraAssetBlobs.get('assets/custom-banner.svg')!),
      await blobToBytes(extraAssets.get('assets/custom-banner.svg')!)
    );

    // ZIP Export -> verify archive layout & LICENSES.txt -> clean Import round-trip
    const zipBytes = await exportProjectArchive(loaded!.document, loaded!.extraAssetBlobs);
    const unzippedEntries = unzipSync(zipBytes);
    expect(Object.keys(unzippedEntries)).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'terrain/land.png',
        'terrain/height.u8',
        'terrain/cover.u8',
        'theme/theme.json',
        'assets/poi-tower.svg',
        'assets/poi-harbor.svg',
        'assets/custom-banner.svg',
        'LICENSES.txt'
      ])
    );
    const licensesText = dec.decode(unzippedEntries['LICENSES.txt']);
    expect(licensesText).toContain('Maestro Cartografo');
    expect(licensesText).toContain('CC0-1.0');
    expect(licensesText).toContain('Laboratorio Cartografico');

    const cleanService = new PersistenceService({
      idbFactory: new FakeIDBFactory(),
      debounceMs: 10
    });
    activeServices.push(cleanService);

    const imported = await cleanService.importArchive(zipBytes);
    expect(imported.wasMigratedFromV1).toBe(false);
    expect(imported.wasIdRemapped).toBe(false);
    expect(imported.document.manifest).toEqual(doc.manifest);
    expect(imported.document.theme).toEqual(doc.theme);
    expectBytesEqual(imported.document.terrain.mask, doc.terrain.mask);
    expectBytesEqual(imported.document.terrain.height, doc.terrain.height);
    expectBytesEqual(imported.document.terrain.cover, doc.terrain.cover);
    expect(imported.extraAssetBlobs.size).toBe(1);
    expectBytesEqual(
      await blobToBytes(imported.extraAssetBlobs.get('assets/custom-banner.svg')!),
      await blobToBytes(extraAssets.get('assets/custom-banner.svg')!)
    );
  });

  it('reuses existing terrainBlobs without re-encoding PNG when terrainVersion is unchanged', async () => {
    const fdb = new FakeIDBFactory();
    const { doc, extraAssets } = createRichSampleDocument();
    const encodeSpy = vi.fn((mask: Uint8Array, w: number, h: number) =>
      encodeMaskPng(mask, w, h)
    );

    const db = new CartografoIndexedDb({
      idbFactory: fdb,
      encodeMaskPngFn: encodeSpy
    });

    await db.saveProject(doc, extraAssets);
    expect(encodeSpy).toHaveBeenCalledTimes(1);

    // Update only title/label, keeping terrainVersion unchanged
    doc.manifest.title = 'Titolo aggiornato senza tocco al terreno';
    doc.manifest.revision += 1;

    const putSpy = vi.spyOn(FakeIDBObjectStore.prototype, 'put');
    await db.saveProject(doc, extraAssets);

    expect(encodeSpy).toHaveBeenCalledTimes(1);
    const writtenStores = putSpy.mock.instances.map(
      (store) => (store as unknown as { name?: string }).name
    );
    expect(writtenStores).not.toContain('terrainBlobs');

    const loaded = await db.loadProject(doc.manifest.id);
    expect(loaded!.document.manifest.title).toBe(doc.manifest.title);
    expectBytesEqual(loaded!.document.terrain.mask, doc.terrain.mask);
    db.close();
  });

  it('2. Rejects malformed/corrupt/unsafe archives with specific Italian errors without altering IndexedDB', async () => {
    const fdb = new FakeIDBFactory();
    const service = new PersistenceService({ idbFactory: fdb, debounceMs: 10 });
    activeServices.push(service);

    const { doc, extraAssets } = createRichSampleDocument();
    await service.flushNow(doc, extraAssets);
    const validZip = await service.exportArchive(doc, extraAssets);

    const validMaskPng = encodeMaskPng(
      doc.terrain.mask,
      doc.terrain.widthPx,
      doc.terrain.heightPx
    );
    const buildBaseEntries = (): Record<string, Uint8Array> => ({
      'manifest.json': enc.encode(JSON.stringify(doc.manifest)),
      'terrain/land.png': validMaskPng,
      'terrain/height.u8': new Uint8Array(doc.terrain.height),
      'terrain/cover.u8': new Uint8Array(doc.terrain.cover),
      'theme/theme.json': enc.encode(JSON.stringify(doc.theme)),
      'assets/poi-tower.svg': getBuiltinAssetSvgBytes('poi-tower')!,
      'assets/poi-harbor.svg': getBuiltinAssetSvgBytes('poi-harbor')!,
      'assets/custom-banner.svg': enc.encode('<svg/>')
    });

    // 2a. Truncated ZIP
    await expect(service.importArchive(validZip.subarray(0, 64))).rejects.toThrow(
      /corrotto|troncato/i
    );

    // 2b. Missing height.u8
    const noHeight = buildBaseEntries();
    delete noHeight['terrain/height.u8'];
    await expect(service.importArchive(zipSync(noHeight))).rejects.toThrow(
      /height\.u8.*mancante/i
    );

    // 2c. Wrong height.u8 length
    const badHeightLen = buildBaseEntries();
    badHeightLen['terrain/height.u8'] = new Uint8Array(12);
    await expect(service.importArchive(zipSync(badHeightLen))).rejects.toThrow(
      /Lunghezza non valida.*height\.u8/i
    );

    // 2d. Invalid cover code in cover.u8 (0..9 are valid; 10 is invalid)
    const badCoverCode = buildBaseEntries();
    badCoverCode['terrain/cover.u8'][5] = 10;
    await expect(service.importArchive(zipSync(badCoverCode))).rejects.toThrow(
      /Codice copertura non valido.*10/i
    );

    // 2e. Referenced asset missing from ZIP
    const missingAsset = buildBaseEntries();
    delete missingAsset['assets/custom-banner.svg'];
    await expect(service.importArchive(zipSync(missingAsset))).rejects.toThrow(
      /File risorsa "assets\/custom-banner\.svg".*mancante/i
    );

    // 2f. Path traversal ../evil
    const traversalZip = zipSync({
      ...buildBaseEntries(),
      '../evil': enc.encode('pwn')
    });
    await expect(service.importArchive(traversalZip)).rejects.toThrow(
      /path traversal|non valido/i
    );

    // 2g. Unsupported schemaVersion: 99
    const futureManifest = structuredClone(doc.manifest) as unknown as Record<
      string,
      unknown
    >;
    futureManifest.schemaVersion = 99;
    const futureZip = zipSync({
      ...buildBaseEntries(),
      'manifest.json': enc.encode(JSON.stringify(futureManifest))
    });
    await expect(service.importArchive(futureZip)).rejects.toThrow(/99.*v1–v3/i);

    // 2h. Exceeds MAX_ARCHIVE_FILES (500)
    const tooManyFiles: Record<string, Uint8Array> = { ...buildBaseEntries() };
    for (let i = 0; i <= MAX_ARCHIVE_FILES; i += 1) {
      tooManyFiles[`extra/file-${i}.txt`] = enc.encode('x');
    }
    await expect(service.importArchive(zipSync(tooManyFiles))).rejects.toThrow(
      /limite massimo.*500/i
    );

    // Verify original IndexedDB project is completely intact
    const projectsAfter = await service.listProjects();
    expect(projectsAfter).toHaveLength(1);
    expect(projectsAfter[0].id).toBe(doc.manifest.id);
    const reloaded = await service.loadProject(doc.manifest.id);
    expect(reloaded!.document.manifest.title).toBe(doc.manifest.title);
  });

  it('3. Remaps colliding project ID on import and preserves the existing local project', async () => {
    const fdb = new FakeIDBFactory();
    const service = new PersistenceService({ idbFactory: fdb, debounceMs: 10 });
    activeServices.push(service);

    const { doc, extraAssets } = createRichSampleDocument();
    await service.flushNow(doc, extraAssets);

    const zipBytes = await service.exportArchive(doc, extraAssets);

    // Modify local title after export so we can verify original local copy stays untouched
    doc.manifest.title = 'Originale Locale Intatto';
    doc.manifest.revision += 1;
    await service.flushNow(doc, extraAssets);

    const imported = await service.importArchive(zipBytes);
    expect(imported.wasIdRemapped).toBe(true);
    expect(imported.document.manifest.id).not.toBe(doc.manifest.id);

    await service.flushNow(imported.document, imported.extraAssetBlobs);

    const list = await service.listProjects();
    expect(list).toHaveLength(2);

    const origReloaded = await service.loadProject(doc.manifest.id);
    const copyReloaded = await service.loadProject(imported.document.manifest.id);
    expect(origReloaded!.document.manifest.title).toBe('Originale Locale Intatto');
    expect(copyReloaded!.document.manifest.title).toBe(
      'Arcipelago delle Città Sospese — ÀÈÌÒÙ'
    );
  });

  it('4. Migrates v1 archive: plains=64, sea=0, cover=0, V1_FLAT_THEME, stamps without role -> decorative', async () => {
    const widthPx = 64;
    const heightPx = 64;
    const mask = new Uint8Array(widthPx * heightPx);
    for (let y = 32; y < heightPx; y += 1) {
      for (let x = 0; x < widthPx; x += 1) {
        mask[y * widthPx + x] = y === 32 ? 128 : 255;
      }
    }

    const towerItem = BUILTIN_POI_CATALOG.find((item) => item.id === 'poi-tower')!;
    const legacyTreeAsset = {
      id: 'legacy-tree',
      path: 'assets/legacy-tree.svg',
      mimeType: 'image/svg+xml',
      version: 1,
      author: 'Autore v1',
      source: 'legacy',
      license: 'CC0-1.0',
      width: 64,
      height: 64,
      anchorX: 0.5,
      anchorY: 0.5
    };

    const rawV1Manifest = {
      schemaVersion: 1,
      id: '11111111-1111-4111-8111-111111111111',
      revision: 4,
      kind: 'world',
      title: 'Vecchia Mappa v1',
      page: { widthMm: 297, heightMm: 210 },
      terrain: {
        mask: 'terrain/land.png',
        widthPx,
        heightPx
      },
      theme: { id: 'old-flat', version: 1, file: 'theme/theme.json' },
      assets: [towerItem.asset, legacyTreeAsset],
      objects: [
        {
          id: 'old-tree-stamp',
          type: 'stamp',
          assetId: 'legacy-tree',
          x: 500,
          y: 600,
          width: 48,
          height: 48,
          rotationDeg: 15
        },
        {
          id: 'new-poi-stamp',
          type: 'stamp',
          role: 'poi',
          categoryId: 'tower',
          assetId: 'poi-tower',
          x: 900,
          y: 700,
          width: 96,
          height: 96,
          rotationDeg: 0
        },
        {
          id: 'old-label',
          type: 'label',
          text: 'Valle Antica',
          x: 1200,
          y: 800,
          fontId: 'spectral-regular',
          fontSize: 38,
          color: '#263C40',
          rotationDeg: 0
        }
      ]
    };

    const v1Zip = zipSync({
      'manifest.json': enc.encode(JSON.stringify(rawV1Manifest)),
      'terrain/land.png': encodeMaskPng(mask, widthPx, heightPx),
      'theme/theme.json': enc.encode(JSON.stringify({ id: 'old-flat', version: 1 })),
      'assets/poi-tower.svg': getBuiltinAssetSvgBytes('poi-tower')!,
      'assets/legacy-tree.svg': enc.encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    });

    const result = await importProjectArchive(v1Zip);
    expect(result.wasMigratedFromV1).toBe(true);
    expect(result.wasIdRemapped).toBe(false);

    const { document } = result;
    expect(document.manifest.schemaVersion).toBe(SCHEMA_VERSION);
    expect(document.manifest.schemaVersion).toBe(3);
    expect(document.manifest.layers).toEqual(createDefaultLayers());
    expect(document.manifest.space).toEqual({ width: 2970, height: 2100 });
    expect(document.manifest.terrain.seed).toBeGreaterThanOrEqual(0);
    expect(document.manifest.terrain.seed).toBeLessThanOrEqual(0xffffffff);
    expect(document.theme).toEqual(V1_FLAT_THEME);
    expect(document.theme.mode).toBe('flat');

    for (let y = 0; y < heightPx; y += 1) {
      for (let x = 0; x < widthPx; x += 1) {
        const idx = y * widthPx + x;
        expect(document.terrain.cover[idx]).toBe(COVER_NATURAL);
        expect(document.terrain.height[idx]).toBe(y < 32 ? 0 : 64);
      }
    }

    const oldStamp = document.manifest.objects[0];
    const poiStamp = document.manifest.objects[1];
    const oldLabel = document.manifest.objects[2];
    expect(oldStamp.type === 'stamp' && oldStamp.role).toBe('decorative');
    expect(oldStamp.layerId).toBe(DEFAULT_LAYER_POI_ID);
    expect(poiStamp.type === 'stamp' && poiStamp.role).toBe('poi');
    expect(poiStamp.type === 'stamp' && poiStamp.categoryId).toBe('tower');
    expect(poiStamp.layerId).toBe(DEFAULT_LAYER_POI_ID);
    expect(oldLabel.layerId).toBe(DEFAULT_LAYER_LABELS_ID);

    const migratedA = migrateManifestToV3(rawV1Manifest);
    const migratedB = migrateManifestV1ToV2(rawV1Manifest);
    expect(migratedA.schemaVersion).toBe(3);
    expect(migratedB.schemaVersion).toBe(3);
    expect(migratedA.terrain.seed).toBe(migratedB.terrain.seed);
    expect(migratedA).toEqual(migratedB);
    expect((rawV1Manifest as { schemaVersion: number }).schemaVersion).toBe(1);
  });

  it('5. Handles concurrent edit during slow PNG encoding: Saved matches latest revision 2 and persists latest change', async () => {
    const fdb = new FakeIDBFactory();
    const doc = createEmptyDocument({
      title: 'Titolo Iniziale',
      widthPx: 64,
      heightPx: 64
    });
    doc.terrain.mask.fill(255, 0, 128);
    doc.manifest.revision = 1;
    doc.terrainVersion = 1;
    doc.manifest.objects.push({
      id: 'lbl-1',
      type: 'label',
      text: 'Etichetta R1',
      x: 100,
      y: 100,
      fontId: 'spectral-semibold',
      fontSize: 38,
      color: '#263C40',
      rotationDeg: 0
    });

    let encodeCalls = 0;
    let signalFirstEncodeStarted!: () => void;
    const firstEncodeStarted = new Promise<void>((resolve) => {
      signalFirstEncodeStarted = resolve;
    });
    let releaseFirstEncode!: () => void;
    const allowFirstEncodeFinish = new Promise<void>((resolve) => {
      releaseFirstEncode = resolve;
    });

    const slowEncodeMaskPng = async (
      mask: Uint8Array,
      w: number,
      h: number
    ): Promise<Uint8Array> => {
      encodeCalls += 1;
      if (encodeCalls === 1) {
        signalFirstEncodeStarted();
        await allowFirstEncodeFinish;
      }
      return encodeMaskPng(mask, w, h);
    };

    const service = new PersistenceService({
      idbFactory: fdb,
      debounceMs: 15,
      encodeMaskPngFn: slowEncodeMaskPng
    });
    activeServices.push(service);

    const states: PersistenceState[] = [];
    const savedAtRev2 = new Promise<void>((resolve) => {
      service.subscribe((s) => {
        states.push(s);
        if (s.status === 'saved' && s.savedRevision === 2) {
          resolve();
        }
      });
    });

    // Kick off revision 1 save (blocks inside slow PNG encoding)
    const flushR1 = service.flushNow(doc);
    await firstEncodeStarted;

    // While rev 1 is still encoding, mutate title & label to revision 2 and scheduleSave
    doc.manifest.title = 'Titolo Aggiornato R2';
    if (doc.manifest.objects[0].type === 'label') {
      doc.manifest.objects[0].text = 'Etichetta R2 — Àncora';
    }
    doc.manifest.revision = 2;
    service.scheduleSave(doc);

    // Let rev 1 finish encoding & writing
    releaseFirstEncode();
    await flushR1;

    expect(states.some((s) => s.status === 'saved' && s.savedRevision === 1)).toBe(
      false
    );

    await savedAtRev2;
    expect(service.getState()).toEqual({ status: 'saved', savedRevision: 2 });

    // Reopen from fresh service and verify latest edit is persisted
    const reader = new PersistenceService({ idbFactory: fdb });
    activeServices.push(reader);
    const reloaded = await reader.loadProject(doc.manifest.id);
    expect(reloaded!.document.manifest.revision).toBe(2);
    expect(reloaded!.document.manifest.title).toBe('Titolo Aggiornato R2');
    expect(
      reloaded!.document.manifest.objects[0].type === 'label' &&
        reloaded!.document.manifest.objects[0].text
    ).toBe('Etichetta R2 — Àncora');
  });

  it('6. Transitions to error with exact quota message on QuotaExceededError while exportArchive still succeeds', async () => {
    const fdb = new FakeIDBFactory();
    const { doc, extraAssets } = createRichSampleDocument();

    const service = new PersistenceService({ idbFactory: fdb, debounceMs: 10 });
    activeServices.push(service);

    vi.spyOn(FakeIDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    await service.flushNow(doc, extraAssets);

    const state = service.getState();
    expect(state.status).toBe('error');
    expect(state.errorMessage).toBe(
      'Spazio locale esaurito. Scarica una copia del progetto.'
    );

    // Document in memory stays intact and portable ZIP export continues to work
    const exportedBytes = await service.exportArchive(doc, extraAssets);
    const imported = await importProjectArchive(exportedBytes);
    expect(imported.document.manifest.id).toBe(doc.manifest.id);
    expect(imported.document.manifest.title).toBe(doc.manifest.title);

    // Also test unavailable IndexedDB (idbFactory: null)
    const offlineService = new PersistenceService({
      idbFactory: null,
      debounceMs: 10
    });
    activeServices.push(offlineService);
    await offlineService.flushNow(doc, extraAssets);
    expect(offlineService.getState().status).toBe('error');
    expect(offlineService.getState().errorMessage).toContain('Scarica una copia');

    const offlineZip = await offlineService.exportArchive(doc, extraAssets);
    const offlineImported = await offlineService.importArchive(offlineZip);
    expect(offlineImported.document.manifest.id).toBe(doc.manifest.id);
  });

  it('7. Detects multi-tab conflict on same project ID and preserves both versions via saveAsCopy', async () => {
    const fdb = new FakeIDBFactory();
    const tabA = new PersistenceService({ idbFactory: fdb, debounceMs: 10 });
    const tabB = new PersistenceService({ idbFactory: fdb, debounceMs: 10 });
    activeServices.push(tabA, tabB);

    const docA = createEmptyDocument({
      title: 'Base Condivisa',
      widthPx: 64,
      heightPx: 64
    });
    docA.manifest.revision = 1;
    docA.terrainVersion = 1;
    docA.terrain.mask[0] = 255;
    await tabA.flushNow(docA);

    // Tab B loads the same project at revision 1
    const loadedB = await tabB.loadProject(docA.manifest.id);
    expect(loadedB).not.toBeNull();

    // Tab A edits & saves revision 2
    docA.manifest.title = 'Modifica Scheda A';
    docA.manifest.revision = 2;
    await tabA.flushNow(docA);
    expect(tabA.getState()).toEqual({ status: 'saved', savedRevision: 2 });

    // Tab B edits & tries to flush -> must detect conflict with remote revision 2
    const docB = loadedB!.document;
    docB.manifest.title = 'Modifica Scheda B';
    docB.manifest.revision = 2;
    docB.terrain.mask[1] = 255;
    docB.terrain.height[1] = 120;
    docB.terrainVersion = 2;

    await tabB.flushNow(docB);
    expect(tabB.getState().status).toBe('conflict');
    expect(tabB.getState().conflictRemoteRevision).toBe(2);

    // Low-level DB must also throw ConflictError directly
    const rawDb = new CartografoIndexedDb({ idbFactory: fdb });
    await expect(rawDb.saveProject(docB)).rejects.toBeInstanceOf(ConflictError);
    rawDb.close();

    // Tab B resolves via saveAsCopy -> both versions saved without data loss
    const copyDoc = await tabB.saveAsCopy(docB, loadedB!.extraAssetBlobs);
    expect(copyDoc.manifest.id).not.toBe(docA.manifest.id);
    expect(copyDoc.manifest.title).toBe('Modifica Scheda B');
    expect(tabB.getState()).toEqual({
      status: 'saved',
      savedRevision: copyDoc.manifest.revision
    });

    const projects = await tabA.listProjects();
    expect(projects).toHaveLength(2);

    const checkA = await tabA.loadProject(docA.manifest.id);
    const checkB = await tabA.loadProject(copyDoc.manifest.id);
    expect(checkA!.document.manifest.title).toBe('Modifica Scheda A');
    expect(checkB!.document.manifest.title).toBe('Modifica Scheda B');
    expect(checkB!.document.terrain.mask[1]).toBe(255);
    expect(checkB!.document.terrain.height[1]).toBe(120);
  });

  it('coalesces rapid scheduleSave bursts, cleans up old blobs on terrainVersion bump & deleteProject', async () => {
    const fdb = new FakeIDBFactory();
    const encodeSpy = vi.fn((mask: Uint8Array, w: number, h: number) =>
      encodeMaskPng(mask, w, h)
    );
    const service = new PersistenceService({
      idbFactory: fdb,
      debounceMs: 30,
      encodeMaskPngFn: encodeSpy
    });
    activeServices.push(service);

    const doc = createEmptyDocument({ title: 'Burst', widthPx: 64, heightPx: 64 });
    const doneRev3 = new Promise<void>((resolve) => {
      service.subscribe((s) => {
        if (s.status === 'saved' && s.savedRevision === 3) resolve();
      });
    });

    doc.manifest.revision = 1;
    doc.terrainVersion = 1;
    service.scheduleSave(doc);

    doc.manifest.revision = 2;
    doc.manifest.title = 'Burst 2';
    service.scheduleSave(doc);

    doc.manifest.revision = 3;
    doc.manifest.title = 'Burst 3';
    service.scheduleSave(doc);

    await doneRev3;
    expect(encodeSpy).toHaveBeenCalledTimes(1);

    // Bump terrainVersion and flush -> old terrainBlob key should be removed
    doc.manifest.revision = 4;
    doc.terrainVersion = 2;
    doc.terrain.mask[0] = 255;
    await service.flushNow(doc);

    const rawDb = new CartografoIndexedDb({ idbFactory: fdb });
    expect(await rawDb.projectExists(doc.manifest.id)).toBe(true);
    expect(await rawDb.projectExists('missing-id')).toBe(false);
    expect(await service.loadProject('missing-id')).toBeNull();
    rawDb.close();

    // Verify terrainBlobs contains only 1 key (no stale v1 blob leaked)
    const countStoreKeys = (storeName: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = fdb.open('cartografo-db', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction([storeName], 'readonly');
          const countReq = tx.objectStore(storeName).count();
          countReq.onsuccess = () => {
            db.close();
            resolve(countReq.result);
          };
          countReq.onerror = () => reject(countReq.error);
        };
        req.onerror = () => reject(req.error);
      });

    expect(await countStoreKeys('terrainBlobs')).toBe(1);

    // Deleting project removes project, terrainBlobs, and assets
    await service.deleteProject(doc.manifest.id);
    expect(await service.listProjects()).toHaveLength(0);
    expect(await countStoreKeys('terrainBlobs')).toBe(0);
    expect(await countStoreKeys('assets')).toBe(0);
  });

  it('rejects additional edge-case invalid archives (/abs, backslash, schemaVersion 0, missing manifest/theme, bad PNG dims) and missing asset on export', async () => {
    const { doc, extraAssets } = createRichSampleDocument();
    const validMaskPng = encodeMaskPng(
      doc.terrain.mask,
      doc.terrain.widthPx,
      doc.terrain.heightPx
    );
    const baseEntries = (): Record<string, Uint8Array> => ({
      'manifest.json': enc.encode(JSON.stringify(doc.manifest)),
      'terrain/land.png': validMaskPng,
      'terrain/height.u8': new Uint8Array(doc.terrain.height),
      'terrain/cover.u8': new Uint8Array(doc.terrain.cover),
      'theme/theme.json': enc.encode(JSON.stringify(doc.theme)),
      'assets/poi-tower.svg': getBuiltinAssetSvgBytes('poi-tower')!,
      'assets/poi-harbor.svg': getBuiltinAssetSvgBytes('poi-harbor')!,
      'assets/custom-banner.svg': enc.encode('<svg/>')
    });

    // Leading slash path traversal
    await expect(
      importProjectArchive(zipSync({ ...baseEntries(), '/etc/passwd': enc.encode('x') }))
    ).rejects.toThrow(/non valido|path traversal/i);

    // Backslash path traversal
    await expect(
      importProjectArchive(zipSync({ ...baseEntries(), 'assets\\evil.svg': enc.encode('x') }))
    ).rejects.toThrow(/non valido|path traversal/i);

    // Schema version 0
    const m0 = structuredClone(doc.manifest) as unknown as Record<string, unknown>;
    m0.schemaVersion = 0;
    await expect(
      importProjectArchive(
        zipSync({ ...baseEntries(), 'manifest.json': enc.encode(JSON.stringify(m0)) })
      )
    ).rejects.toThrow(/0.*v1–v3/i);

    // Missing manifest.json
    const noManifest = baseEntries();
    delete noManifest['manifest.json'];
    await expect(importProjectArchive(zipSync(noManifest))).rejects.toThrow(
      /manifest\.json.*mancante/i
    );

    // Missing theme/theme.json
    const noTheme = baseEntries();
    delete noTheme['theme/theme.json'];
    await expect(importProjectArchive(zipSync(noTheme))).rejects.toThrow(
      /theme\.json.*mancante/i
    );

    // Mismatched PNG mask dimensions
    const wrongPng = encodeMaskPng(new Uint8Array(64 * 64), 64, 64);
    await expect(
      importProjectArchive(zipSync({ ...baseEntries(), 'terrain/land.png': wrongPng }))
    ).rejects.toThrow(/Dimensioni della maschera/i);

    // Export fails if declared custom asset has no Blob in extraAssets
    await expect(exportProjectArchive(doc)).rejects.toThrow(
      /assets\/custom-banner\.svg.*mancante/i
    );

    // Export succeeds when extraAssets provides it
    const validBytes = await exportProjectArchive(doc, extraAssets);
    expect(validBytes.length).toBeGreaterThan(100);
  });

  it('8. Migrates real v2 ZIP archive and 16-color theme.json cleanly to v3 without data loss', async () => {
    const widthPx = 96;
    const heightPx = 64;
    const cells = widthPx * heightPx;
    const mask = new Uint8Array(cells);
    const height = new Uint8Array(cells);
    const cover = new Uint8Array(cells);
    mask.fill(255, 0, cells / 2);
    height.fill(140, 0, cells / 2);
    cover[0] = COVER_FOREST;
    cover[1] = COVER_FIELDS;
    cover[2] = COVER_NATURAL;

    const towerItem = BUILTIN_POI_CATALOG.find((item) => item.id === 'poi-tower')!;
    const rawV2Manifest = {
      schemaVersion: 2,
      id: '22222222-2222-4222-8222-222222222222',
      revision: 7,
      kind: 'world',
      title: 'Regno Boreale v2',
      page: { widthMm: 420, heightMm: 297 },
      space: { width: 4200, height: 2970 },
      terrain: {
        mask: 'terrain/land.png',
        height: 'terrain/height.u8',
        cover: 'terrain/cover.u8',
        rulesVersion: 1,
        seed: 9876,
        widthPx,
        heightPx
      },
      theme: {
        id: 'nordica',
        file: 'theme/theme.json'
      },
      assets: [towerItem.asset],
      objects: [
        {
          id: 'v2-tower',
          type: 'stamp',
          role: 'poi',
          categoryId: towerItem.categoryId,
          assetId: 'poi-tower',
          x: 1100,
          y: 950,
          width: 96,
          height: 96,
          rotationDeg: 10
        },
        {
          id: 'v2-label',
          type: 'label',
          text: 'Fjord di Tramontana',
          x: 1350,
          y: 1120,
          fontId: 'spectral-italic',
          fontSize: 40,
          color: '#1C2B36',
          rotationDeg: -6
        }
      ]
    };

    // Real v2 theme.json with only the 16 base colors (missing v3 extended materials/paths)
    const legacyV2Theme = {
      id: 'nordica',
      version: 1,
      name: 'Atlante boreale v2',
      mode: 'reactive',
      colors: {
        sea: NORDICA_THEME.colors.sea,
        seaShallow: NORDICA_THEME.colors.seaShallow,
        seaBathymetry: NORDICA_THEME.colors.seaBathymetry,
        beach: NORDICA_THEME.colors.beach,
        land: '#E1EAEB',
        hill: NORDICA_THEME.colors.hill,
        mountain: NORDICA_THEME.colors.mountain,
        mountainCrest: NORDICA_THEME.colors.mountainCrest,
        ink: NORDICA_THEME.colors.ink,
        forest: NORDICA_THEME.colors.forest,
        forestShadow: NORDICA_THEME.colors.forestShadow,
        fields: NORDICA_THEME.colors.fields,
        fieldsFurrow: NORDICA_THEME.colors.fieldsFurrow,
        stone: NORDICA_THEME.colors.stone,
        settlement: NORDICA_THEME.colors.settlement,
        labelHalo: NORDICA_THEME.colors.labelHalo
      },
      coast: { ...NORDICA_THEME.coast },
      elevation: { ...NORDICA_THEME.elevation },
      fonts: structuredClone(NORDICA_THEME.fonts)
    };

    const validatedTheme = validateMapTheme(legacyV2Theme);
    expect(validatedTheme.colors.land).toBe('#E1EAEB');
    expect(validatedTheme.colors.sand).toBe(NORDICA_THEME.colors.sand);
    expect(validatedTheme.colors.lava).toBe(NORDICA_THEME.colors.lava);
    expect(validatedTheme.colors.pathRiver).toBe(NORDICA_THEME.colors.pathRiver);
    expect(() =>
      validateMapTheme({ ...legacyV2Theme, colors: { ...legacyV2Theme.colors, sea: '' } })
    ).toThrow(/Colore tema "sea"/i);
    expect(() =>
      validateMapTheme({ ...legacyV2Theme, mode: 'invalid' })
    ).toThrow(/Modalità tema/i);

    const v2Zip = zipSync({
      'manifest.json': enc.encode(JSON.stringify(rawV2Manifest)),
      'terrain/land.png': encodeMaskPng(mask, widthPx, heightPx),
      'terrain/height.u8': height,
      'terrain/cover.u8': cover,
      'theme/theme.json': enc.encode(JSON.stringify(legacyV2Theme)),
      'assets/poi-tower.svg': getBuiltinAssetSvgBytes('poi-tower')!
    });

    const imported = await importProjectArchive(v2Zip);
    expect(imported.wasMigratedFromV1).toBe(false);
    expect(imported.wasIdRemapped).toBe(false);

    const { document } = imported;
    expect(document.manifest.schemaVersion).toBe(3);
    expect(document.manifest.revision).toBe(7);
    expect(document.manifest.title).toBe('Regno Boreale v2');
    expect(document.manifest.page).toEqual({ widthMm: 420, heightMm: 297 });
    expect(document.manifest.space).toEqual({ width: 4200, height: 2970 });
    expect(document.manifest.terrain.rulesVersion).toBe(1);
    expect(document.manifest.terrain.seed).toBe(9876);
    expect(document.manifest.theme).toEqual({
      id: 'nordica',
      version: NORDICA_THEME.version,
      file: 'theme/theme.json'
    });
    expect(document.manifest.layers).toEqual(createDefaultLayers());
    expect(document.manifest.objects[0].layerId).toBe(DEFAULT_LAYER_POI_ID);
    expect(document.manifest.objects[1].layerId).toBe(DEFAULT_LAYER_LABELS_ID);
    expect(document.theme.colors.land).toBe('#E1EAEB');
    expect(document.theme.colors.brick).toBe(NORDICA_THEME.colors.brick);
    expect(document.theme.colors.snow).toBe(NORDICA_THEME.colors.snow);
    expect(document.theme.colors.swamp).toBe(NORDICA_THEME.colors.swamp);
    expect(document.theme.colors.rock).toBe(NORDICA_THEME.colors.rock);
    expect(document.theme.colors.meadow).toBe(NORDICA_THEME.colors.meadow);
    expect(document.theme.colors.lava).toBe(NORDICA_THEME.colors.lava);
    expect(document.theme.colors.pathRiver).toBe(NORDICA_THEME.colors.pathRiver);
    expect(document.theme.colors.pathRoad).toBe(NORDICA_THEME.colors.pathRoad);
    expect(document.theme.colors.pathBorder).toBe(NORDICA_THEME.colors.pathBorder);
    expectBytesEqual(document.terrain.mask, mask);
    expectBytesEqual(document.terrain.height, height);
    expectBytesEqual(document.terrain.cover, cover);

    // Direct manifest migration leaves raw v2 object unmutated
    const directMigrated = migrateManifestToV3(rawV2Manifest);
    expect(directMigrated.schemaVersion).toBe(3);
    expect((rawV2Manifest as { schemaVersion: number }).schemaVersion).toBe(2);
    expect('layers' in rawV2Manifest).toBe(false);
  });

  it('9. Loads and migrates legacy v1 and v2 ProjectRecords directly from IndexedDB to v3', async () => {
    const fdb = new FakeIDBFactory();

    const widthPx = 64;
    const heightPx = 64;
    const cells = widthPx * heightPx;
    const mask = new Uint8Array(cells);
    mask.fill(255, 0, cells / 2);
    const maskPng = encodeMaskPng(mask, widthPx, heightPx);

    const v1Id = '33333333-3333-4333-8333-333333333333';
    const v2Id = '44444444-4444-4444-8444-444444444444';

    // Seed FakeIDB directly with v1 and v2 records (simulating existing browser storage)
    await new Promise<void>((resolve, reject) => {
      const openReq = fdb.open('cartografo-db', 1);
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        db.createObjectStore('terrainBlobs', { keyPath: 'key' });
        db.createObjectStore('assets', { keyPath: 'key' });
      };
      openReq.onsuccess = () => {
        const db = openReq.result;
        const tx = db.transaction(['projects', 'terrainBlobs'], 'readwrite');
        const projects = tx.objectStore('projects');
        const blobs = tx.objectStore('terrainBlobs');

        projects.put({
          id: v1Id,
          title: 'Archivio Locale v1',
          revision: 2,
          page: { widthMm: 297, heightMm: 210 },
          manifest: {
            schemaVersion: 1,
            id: v1Id,
            revision: 2,
            kind: 'world',
            title: 'Archivio Locale v1',
            page: { widthMm: 297, heightMm: 210 },
            terrain: { mask: 'terrain/land.png', widthPx, heightPx },
            theme: { id: 'old-v1', version: 1, file: 'theme/theme.json' },
            assets: [],
            objects: [
              {
                id: 'v1-lbl',
                type: 'label',
                text: 'Costa Antica',
                x: 400,
                y: 300,
                fontSize: 36
              }
            ]
          },
          theme: { id: 'old-v1', version: 1, name: 'Old', mode: 'flat', colors: {} },
          terrainVersion: 1,
          updatedAt: 1000,
          lastSavedMaskKey: `${v1Id}:terrain:1`,
          assetKeys: []
        });
        blobs.put({
          key: `${v1Id}:terrain:1`,
          projectId: v1Id,
          terrainVersion: 1,
          maskPng,
          heightU8: new Uint8Array(0),
          coverU8: new Uint8Array(0)
        });

        const v2Height = new Uint8Array(cells).fill(95);
        const v2Cover = new Uint8Array(cells).fill(COVER_FOREST);
        projects.put({
          id: v2Id,
          title: 'Archivio Locale v2',
          revision: 5,
          page: { widthMm: 420, heightMm: 297 },
          manifest: {
            schemaVersion: 2,
            id: v2Id,
            revision: 5,
            kind: 'world',
            title: 'Archivio Locale v2',
            page: { widthMm: 420, heightMm: 297 },
            space: { width: 4200, height: 2970 },
            terrain: {
              mask: 'terrain/land.png',
              height: 'terrain/height.u8',
              cover: 'terrain/cover.u8',
              rulesVersion: 1,
              seed: 777,
              widthPx,
              heightPx
            },
            theme: { id: 'base', version: 1, file: 'theme/theme.json' },
            assets: [],
            objects: [
              {
                id: 'v2-lbl',
                type: 'label',
                text: 'Valico v2',
                x: 700,
                y: 500,
                fontId: 'spectral-semibold',
                fontSize: 38.81,
                color: '#263C40',
                rotationDeg: 0
              }
            ]
          },
          theme: {
            id: 'base',
            version: 1,
            name: 'Base v2',
            mode: 'reactive',
            colors: {
              sea: DEFAULT_THEME.colors.sea,
              seaShallow: DEFAULT_THEME.colors.seaShallow,
              seaBathymetry: DEFAULT_THEME.colors.seaBathymetry,
              beach: DEFAULT_THEME.colors.beach,
              land: DEFAULT_THEME.colors.land,
              hill: DEFAULT_THEME.colors.hill,
              mountain: DEFAULT_THEME.colors.mountain,
              mountainCrest: DEFAULT_THEME.colors.mountainCrest,
              ink: DEFAULT_THEME.colors.ink,
              forest: DEFAULT_THEME.colors.forest,
              forestShadow: DEFAULT_THEME.colors.forestShadow,
              fields: DEFAULT_THEME.colors.fields,
              fieldsFurrow: DEFAULT_THEME.colors.fieldsFurrow,
              stone: DEFAULT_THEME.colors.stone,
              settlement: DEFAULT_THEME.colors.settlement,
              labelHalo: DEFAULT_THEME.colors.labelHalo
            },
            coast: { ...DEFAULT_THEME.coast },
            elevation: { ...DEFAULT_THEME.elevation },
            fonts: structuredClone(DEFAULT_THEME.fonts)
          },
          terrainVersion: 3,
          updatedAt: 2000,
          lastSavedMaskKey: `${v2Id}:terrain:3`,
          assetKeys: []
        });
        blobs.put({
          key: `${v2Id}:terrain:3`,
          projectId: v2Id,
          terrainVersion: 3,
          maskPng,
          heightU8: v2Height,
          coverU8: v2Cover
        });

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      openReq.onerror = () => reject(openReq.error);
    });

    const service = new PersistenceService({ idbFactory: fdb, debounceMs: 10 });
    activeServices.push(service);

    const loadedV1 = await service.loadProject(v1Id);
    expect(loadedV1).not.toBeNull();
    expect(loadedV1!.document.manifest.schemaVersion).toBe(3);
    expect(loadedV1!.document.manifest.layers).toEqual(createDefaultLayers());
    expect(loadedV1!.document.manifest.objects[0].layerId).toBe(DEFAULT_LAYER_LABELS_ID);
    expect(loadedV1!.document.theme).toEqual(V1_FLAT_THEME);
    expect(loadedV1!.document.terrain.height[0]).toBe(64);
    expect(loadedV1!.document.terrain.height[cells - 1]).toBe(0);
    expect(loadedV1!.document.terrain.cover[0]).toBe(COVER_NATURAL);

    const loadedV2 = await service.loadProject(v2Id);
    expect(loadedV2).not.toBeNull();
    expect(loadedV2!.document.manifest.schemaVersion).toBe(3);
    expect(loadedV2!.document.manifest.layers).toEqual(createDefaultLayers());
    expect(loadedV2!.document.manifest.objects[0].layerId).toBe(DEFAULT_LAYER_LABELS_ID);
    expect(loadedV2!.document.theme.colors.lava).toBe(DEFAULT_THEME.colors.lava);
    expect(loadedV2!.document.theme.colors.pathRiver).toBe(DEFAULT_THEME.colors.pathRiver);
    expect(loadedV2!.document.terrain.height[0]).toBe(95);
    expect(loadedV2!.document.terrain.cover[0]).toBe(COVER_FOREST);

    // Migrated v1 and v2 projects can be edited and persisted seamlessly back to IndexedDB as v3
    loadedV1!.document.manifest.revision += 1;
    loadedV1!.document.manifest.title = 'v1 Promosso a v3';
    await service.flushNow(loadedV1!.document);
    expect(service.getState()).toEqual({ status: 'saved', savedRevision: 3 });

    loadedV2!.document.manifest.revision += 1;
    loadedV2!.document.manifest.title = 'Aggiornato a v3';
    await service.flushNow(loadedV2!.document);
    expect(service.getState()).toEqual({ status: 'saved', savedRevision: 6 });

    const coldReader = new PersistenceService({ idbFactory: fdb });
    activeServices.push(coldReader);
    const reloadedV1AsV3 = await coldReader.loadProject(v1Id);
    expect(reloadedV1AsV3!.document.manifest.schemaVersion).toBe(3);
    expect(reloadedV1AsV3!.document.manifest.title).toBe('v1 Promosso a v3');
    expect(reloadedV1AsV3!.document.terrain.height[0]).toBe(64);
    expect(reloadedV1AsV3!.document.terrain.cover[0]).toBe(COVER_NATURAL);
  });

  it('10. Round-trips v3 document with cover 0..9, custom layers, PathObjects (river & border), and A1/2000mm canvases', async () => {
    const fdb = new FakeIDBFactory();
    const service = new PersistenceService({ idbFactory: fdb, debounceMs: 10 });
    activeServices.push(service);

    // A1 landscape canvas (841 x 594 mm)
    const doc = createEmptyDocument({
      title: 'Atlante A1 Completo — v3',
      page: { widthMm: 841, heightMm: 594 },
      widthPx: 128,
      heightPx: 96,
      seed: 2026
    });
    doc.manifest.revision = 4;
    doc.terrainVersion = 2;

    const allCovers = [
      COVER_NATURAL,
      COVER_FOREST,
      COVER_FIELDS,
      COVER_SAND,
      COVER_BRICK,
      COVER_SNOW,
      COVER_SWAMP,
      COVER_ROCK,
      COVER_MEADOW,
      COVER_LAVA
    ] as const;
    allCovers.forEach((code, idx) => {
      doc.terrain.mask[idx] = 255;
      doc.terrain.height[idx] = 40 + idx * 18;
      doc.terrain.cover[idx] = code;
    });

    // Customize built-in layers + add custom layer with visibility/lock/opacity
    doc.manifest.layers = [
      {
        id: DEFAULT_LAYER_TERRAIN_ID,
        name: 'Terreno e Rilievo',
        kind: 'terrain',
        visible: true,
        locked: false,
        opacity: 1
      },
      {
        id: DEFAULT_LAYER_VECTORS_ID,
        name: 'Fiumi e Strade',
        kind: 'vector',
        visible: true,
        locked: false,
        opacity: 0.92
      },
      {
        id: 'layer-custom-borders',
        name: 'Confini Politici',
        kind: 'custom',
        visible: false,
        locked: true,
        opacity: 0.65
      },
      {
        id: DEFAULT_LAYER_POI_ID,
        name: 'Luoghi e POI',
        kind: 'poi',
        visible: true,
        locked: false,
        opacity: 1
      },
      {
        id: DEFAULT_LAYER_LABELS_ID,
        name: 'Nomi e Note',
        kind: 'labels',
        visible: true,
        locked: false,
        opacity: 0.85
      }
    ];

    const riverPath: PathObject = {
      id: 'path-river-main',
      type: 'path',
      layerId: DEFAULT_LAYER_VECTORS_ID,
      kind: 'river',
      x: 1200,
      y: 800,
      rotationDeg: 0,
      points: [-200, -100, -40, 20, 120, 85, 310, 190],
      strokeWidthDoc: 16,
      color: DEFAULT_THEME.colors.pathRiver,
      opacity: 0.9,
      tapered: true,
      smooth: true
    };
    const borderPath: PathObject = {
      id: 'path-border-realm',
      type: 'path',
      layerId: 'layer-custom-borders',
      kind: 'border',
      x: 2400,
      y: 1600,
      rotationDeg: 12.5,
      points: [0, 0, 520, -140, 980, 160],
      strokeWidthDoc: 7.5,
      color: DEFAULT_THEME.colors.pathBorder,
      dashed: true,
      smooth: false
    };
    doc.manifest.objects.push(riverPath, borderPath);

    await service.flushNow(doc);
    const reader = new PersistenceService({ idbFactory: fdb });
    activeServices.push(reader);

    const loaded = await reader.loadProject(doc.manifest.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.document.manifest).toEqual(doc.manifest);
    expect(loaded!.document.manifest.page).toEqual({ widthMm: 841, heightMm: 594 });
    expect(loaded!.document.manifest.space).toEqual({ width: 8410, height: 5940 });
    expectBytesEqual(loaded!.document.terrain.cover, doc.terrain.cover);
    for (let i = 0; i < allCovers.length; i += 1) {
      expect(loaded!.document.terrain.cover[i]).toBe(allCovers[i]);
    }

    const zipBytes = await exportProjectArchive(loaded!.document);
    const imported = await importProjectArchive(zipBytes);
    expect(imported.wasMigratedFromV1).toBe(false);
    expect(imported.document.manifest).toEqual(doc.manifest);
    expect(imported.document.theme).toEqual(doc.theme);
    expectBytesEqual(imported.document.terrain.cover, doc.terrain.cover);
    expectBytesEqual(imported.document.terrain.height, doc.terrain.height);
    expectBytesEqual(imported.document.terrain.mask, doc.terrain.mask);

    // Validate maximum allowed physical size (2000 x 2000 mm) and 32M px dimensions
    const giantDoc = createEmptyDocument({
      title: 'Mappa Massima 2000mm',
      page: { widthMm: 2000, heightMm: 2000 },
      widthPx: 96,
      heightPx: 96
    });
    const giantZip = await exportProjectArchive(giantDoc);
    const giantImported = await importProjectArchive(giantZip);
    expect(giantImported.document.manifest.page).toEqual({
      widthMm: 2000,
      heightMm: 2000
    });
    expect(giantImported.document.manifest.space).toEqual({
      width: 20000,
      height: 20000
    });

    const maxPixelManifest = structuredClone(giantDoc.manifest);
    maxPixelManifest.terrain.widthPx = 8000;
    maxPixelManifest.terrain.heightPx = 4000; // 32,000,000 px
    const validatedMax = migrateManifestToV3(maxPixelManifest);
    expect(validatedMax.terrain.widthPx * validatedMax.terrain.heightPx).toBe(
      32_000_000
    );
  });

  it('11. Rejects invalid v3 theme, invalid PathObject, or invalid layerId atomically without altering saved project', async () => {
    const fdb = new FakeIDBFactory();
    const service = new PersistenceService({ idbFactory: fdb, debounceMs: 10 });
    activeServices.push(service);

    const { doc, extraAssets } = createRichSampleDocument();
    await service.flushNow(doc, extraAssets);

    const maskPng = encodeMaskPng(
      doc.terrain.mask,
      doc.terrain.widthPx,
      doc.terrain.heightPx
    );
    const baseEntries = (): Record<string, Uint8Array> => ({
      'manifest.json': enc.encode(JSON.stringify(doc.manifest)),
      'terrain/land.png': maskPng,
      'terrain/height.u8': new Uint8Array(doc.terrain.height),
      'terrain/cover.u8': new Uint8Array(doc.terrain.cover),
      'theme/theme.json': enc.encode(JSON.stringify(doc.theme)),
      'assets/poi-tower.svg': getBuiltinAssetSvgBytes('poi-tower')!,
      'assets/poi-harbor.svg': getBuiltinAssetSvgBytes('poi-harbor')!,
      'assets/custom-banner.svg': enc.encode('<svg/>')
    });

    // Invalid theme.json missing required base color
    const brokenTheme = structuredClone(doc.theme) as unknown as {
      colors: Record<string, string>;
    };
    delete brokenTheme.colors.sea;
    await expect(
      service.importArchive(
        zipSync({
          ...baseEntries(),
          'theme/theme.json': enc.encode(JSON.stringify(brokenTheme))
        })
      )
    ).rejects.toThrow(/Colore tema "sea"/i);

    // Invalid PathObject (only 2 coords)
    const badPathManifest = structuredClone(doc.manifest);
    badPathManifest.objects.push({
      id: 'bad-path',
      type: 'path',
      layerId: DEFAULT_LAYER_VECTORS_ID,
      kind: 'road',
      x: 100,
      y: 100,
      rotationDeg: 0,
      points: [0, 0],
      strokeWidthDoc: 5,
      color: '#7D5C43'
    });
    await expect(
      service.importArchive(
        zipSync({
          ...baseEntries(),
          'manifest.json': enc.encode(JSON.stringify(badPathManifest))
        })
      )
    ).rejects.toThrow(/Vertici del tracciato non validi/i);

    // Invalid layerId reference on object
    const badLayerRefManifest = structuredClone(doc.manifest);
    badLayerRefManifest.objects[0] = {
      ...badLayerRefManifest.objects[0],
      layerId: 'non-existent-layer'
    };
    await expect(
      service.importArchive(
        zipSync({
          ...baseEntries(),
          'manifest.json': enc.encode(JSON.stringify(badLayerRefManifest))
        })
      )
    ).rejects.toThrow(/Riferimento layerId non valido/i);

    // Existing IndexedDB project must remain completely intact
    const projects = await service.listProjects();
    expect(projects).toHaveLength(1);
    const reloaded = await service.loadProject(doc.manifest.id);
    expect(reloaded!.document.manifest).toEqual(doc.manifest);
  });

  it('salva maschera grezza maskU8 senza ricodifica PNG per default e supporta flushPending con debounce terreno differenziato', async () => {
    const fdb = new FakeIDBFactory();
    const { doc, extraAssets } = createRichSampleDocument();

    const db = new CartografoIndexedDb({ idbFactory: fdb });
    await db.saveProject(doc, extraAssets);

    const rawBlob = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const req = fdb.open('cartografo-db', 1);
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction(['terrainBlobs'], 'readonly');
        const getReq = tx.objectStore('terrainBlobs').getAll();
        getReq.onsuccess = () => resolve((getReq.result as Record<string, unknown>[])[0]);
        getReq.onerror = () => reject(getReq.error);
      };
      req.onerror = () => reject(req.error);
    });

    expect(rawBlob?.maskU8).toBeInstanceOf(Uint8Array);
    expect(rawBlob?.maskPng).toBeUndefined();

    const loaded = await db.loadProject(doc.manifest.id);
    expect(loaded).not.toBeNull();
    expectBytesEqual(loaded!.document.terrain.mask, doc.terrain.mask);
    expectBytesEqual(loaded!.document.terrain.height, doc.terrain.height);
    expectBytesEqual(loaded!.document.terrain.cover, doc.terrain.cover);
    db.close();

    // Debounce terreno lungo + flushPending immediato
    const service = new PersistenceService({
      idbFactory: fdb,
      debounceMs: 15,
      terrainDebounceMs: 5000
    });
    activeServices.push(service);

    const freshDoc = createEmptyDocument({ title: 'Flush Background', widthPx: 64, heightPx: 64 });
    freshDoc.manifest.revision = 1;
    freshDoc.terrainVersion = 1;
    freshDoc.terrain.mask[10] = 255;

    service.scheduleSave(freshDoc);
    expect(service.getState().status).toBe('saving');

    await service.flushPending();
    expect(service.getState()).toEqual({ status: 'saved', savedRevision: 1 });

    const reloadedFresh = await service.loadProject(freshDoc.manifest.id);
    expect(reloadedFresh).not.toBeNull();
    expect(reloadedFresh!.document.terrain.mask[10]).toBe(255);
  });
});
