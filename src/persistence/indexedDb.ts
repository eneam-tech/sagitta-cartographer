import { PageSizeMm } from '../model/coordinates';
import {
  DocumentManifest,
  MAX_COVER_CODE,
  MapDocument,
  isCoverCode,
  validateDocumentManifest
} from '../model/document';
import { decodeMaskPng, encodeMaskPng } from '../core/png';
import { MapTheme, V1_FLAT_THEME, cloneTheme, normalizeTheme } from '../theme/theme';
import { validateMapTheme } from './archive';
import {
  assertSupportedSchemaVersion,
  initializeV1TerrainBuffers,
  migrateManifestToV3
} from './migration';
import { SavedProjectSummary } from './types';

export const CARTOGRAFO_DB_NAME = 'cartografo-db';
export const CARTOGRAFO_DB_VERSION = 1;

const STORE_PROJECTS = 'projects';
const STORE_TERRAIN_BLOBS = 'terrainBlobs';
const STORE_ASSETS = 'assets';

export class ConflictError extends Error {
  readonly remoteRevision: number;

  constructor(
    remoteRevision: number,
    message = `Conflitto di salvataggio: nel database è presente la revisione ${remoteRevision}.`
  ) {
    super(message);
    this.name = 'ConflictError';
    this.remoteRevision = remoteRevision;
  }
}

export class StorageQuotaError extends Error {
  constructor(
    message = 'Spazio locale esaurito. Scarica una copia del progetto.'
  ) {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

export class StorageUnavailableError extends Error {
  constructor(
    message = 'Archiviazione locale non disponibile. Scarica una copia del progetto.'
  ) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export function isQuotaExceededError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if (current instanceof StorageQuotaError) return true;
    const obj = current as { name?: unknown; code?: unknown; cause?: unknown };
    if (
      obj.name === 'QuotaExceededError' ||
      obj.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      obj.code === 22 ||
      obj.code === 1014
    ) {
      return true;
    }
    current = obj.cause;
  }
  return false;
}

export function isStorageUnavailableError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if (current instanceof StorageUnavailableError) return true;
    const obj = current as { name?: unknown; cause?: unknown };
    if (obj.name === 'SecurityError' || obj.name === 'InvalidStateError') {
      return true;
    }
    current = obj.cause;
  }
  return false;
}

export interface ProjectAssetKeyRef {
  key: string;
  path: string;
}

export interface ProjectRecord {
  id: string;
  title: string;
  revision: number;
  page: PageSizeMm;
  manifest: DocumentManifest;
  theme: MapTheme;
  terrainVersion: number;
  updatedAt: number;
  lastSavedMaskKey: string;
  assetKeys: ProjectAssetKeyRef[];
}

export interface TerrainBlobRecord {
  key: string;
  projectId: string;
  terrainVersion: number;
  maskPng?: Uint8Array;
  maskU8?: Uint8Array;
  widthPx?: number;
  heightPx?: number;
  heightU8: Uint8Array;
  coverU8: Uint8Array;
}

export interface AssetBlobRecord {
  key: string;
  projectId: string;
  path: string;
  blob: Blob | Uint8Array;
  mimeType: string;
}

export type MaskPngEncoderFn = (
  mask: Uint8Array,
  width: number,
  height: number
) => Uint8Array | Promise<Uint8Array>;

export type MaskPngDecoderFn = (bytes: Uint8Array) => {
  width: number;
  height: number;
  mask: Uint8Array;
};

export interface IndexedDbOptions {
  idbFactory?: IDBFactory | null;
  dbName?: string;
  encodeMaskPngFn?: MaskPngEncoderFn;
  decodeMaskPngFn?: MaskPngDecoderFn;
  delayBeforeWriteMs?: number;
}

interface PreparedTerrainPayload {
  maskPng?: Uint8Array;
  maskU8?: Uint8Array;
  widthPx: number;
  heightPx: number;
  heightU8: Uint8Array;
  coverU8: Uint8Array;
}

interface PreparedAssetPayload {
  key: string;
  path: string;
  bytes: Uint8Array;
  mimeType: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBlobFromStored(stored: Blob | Uint8Array, mimeType: string): Blob {
  if (typeof Blob !== 'undefined' && stored instanceof Blob) {
    return stored;
  }
  return new Blob([new Uint8Array(stored as Uint8Array)], {
    type: mimeType || 'application/octet-stream'
  });
}

class RetryWithPreparedTerrainSignal {
  readonly kind = 'retry-terrain';
}

export class CartografoIndexedDb {
  private readonly idbFactory: IDBFactory | null;
  private readonly dbName: string;
  private readonly encodeMaskPngFn: MaskPngEncoderFn;
  private readonly decodeMaskPngFn: MaskPngDecoderFn;
  private readonly useCustomMaskEncoder: boolean;
  private readonly delayBeforeWriteMs: number;

  private dbPromise: Promise<IDBDatabase> | null = null;
  private openDbInstance: IDBDatabase | null = null;
  private disposed = false;

  private readonly expectedPersistedRevision = new Map<string, number>();
  private readonly lastSavedTerrainVersion = new Map<string, number>();
  private readonly lastSavedMaskKey = new Map<string, string>();

  constructor(options: IndexedDbOptions = {}) {
    this.idbFactory =
      options.idbFactory === undefined
        ? ((globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB ?? null)
        : options.idbFactory;
    this.dbName = options.dbName ?? CARTOGRAFO_DB_NAME;
    this.useCustomMaskEncoder = Boolean(options.encodeMaskPngFn);
    this.encodeMaskPngFn = options.encodeMaskPngFn ?? encodeMaskPng;
    this.decodeMaskPngFn = options.decodeMaskPngFn ?? decodeMaskPng;
    this.delayBeforeWriteMs = options.delayBeforeWriteMs ?? 0;
  }

  hasCachedTerrainVersion(projectId: string, terrainVersion: number): boolean {
    return (
      this.lastSavedTerrainVersion.get(projectId) === terrainVersion &&
      this.lastSavedMaskKey.has(projectId)
    );
  }

  private getDb(): Promise<IDBDatabase> {
    if (this.disposed) {
      return Promise.reject(new StorageUnavailableError('Database locale chiuso.'));
    }
    if (!this.idbFactory) {
      return Promise.reject(new StorageUnavailableError());
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }

    const factory = this.idbFactory;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(this.dbName, CARTOGRAFO_DB_VERSION);
      } catch (err) {
        this.dbPromise = null;
        if (isQuotaExceededError(err)) {
          reject(err);
        } else {
          reject(
            new StorageUnavailableError(
              'Impossibile accedere ad IndexedDB in questo contesto.',
            )
          );
        }
        return;
      }

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_TERRAIN_BLOBS)) {
          db.createObjectStore(STORE_TERRAIN_BLOBS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS, { keyPath: 'key' });
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        this.openDbInstance = db;
        db.onversionchange = () => {
          db.close();
          if (this.openDbInstance === db) {
            this.openDbInstance = null;
          }
          this.dbPromise = null;
        };
        db.onclose = () => {
          if (this.openDbInstance === db) {
            this.openDbInstance = null;
          }
          this.dbPromise = null;
        };
        resolve(db);
      };

      req.onerror = () => {
        this.dbPromise = null;
        const err = req.error;
        if (isQuotaExceededError(err)) {
          reject(err);
        } else {
          reject(
            new StorageUnavailableError(
              err?.message ?? 'Impossibile aprire il database locale.'
            )
          );
        }
      };

      req.onblocked = () => {
        this.dbPromise = null;
        reject(
          new StorageUnavailableError(
            'Accesso al database locale bloccato da un’altra scheda.'
          )
        );
      };
    });

    return this.dbPromise;
  }

  /**
   * Saves a document and optional extra assets.
   * All PNG encoding, buffer cloning, and Blob reading happen OUTSIDE the IndexedDB transaction.
   * Reuses existing terrainBlobs when terrainVersion matches the persisted project record.
   * Aborts and throws ConflictError if persisted revision differs from expectedPersistedRevision.
   */
  async saveProject(
    doc: MapDocument,
    extraAssets?: Map<string, Blob>,
    options?: { preclonedTerrain?: boolean }
  ): Promise<void> {
    // Capture immutable document snapshot synchronously before any await.
    const manifest = validateDocumentManifest(structuredClone(doc.manifest));
    const theme = cloneTheme(doc.theme);
    const terrainVersion = doc.terrainVersion;
    const id = manifest.id;
    const widthPx = doc.terrain.widthPx;
    const heightPx = doc.terrain.heightPx;
    const reusePrecloned = Boolean(options?.preclonedTerrain);

    let forcePrepareTerrain = !this.hasCachedTerrainVersion(id, terrainVersion);
    let rawMaskCopy = forcePrepareTerrain
      ? reusePrecloned
        ? doc.terrain.mask
        : new Uint8Array(doc.terrain.mask)
      : null;
    let rawHeightCopy = forcePrepareTerrain
      ? reusePrecloned
        ? doc.terrain.height
        : new Uint8Array(doc.terrain.height)
      : null;
    let rawCoverCopy = forcePrepareTerrain
      ? reusePrecloned
        ? doc.terrain.cover
        : new Uint8Array(doc.terrain.cover)
      : null;

    const rawAssetEntries = extraAssets ? Array.from(extraAssets.entries()) : [];
    const preparedAssets: PreparedAssetPayload[] = [];
    for (const [assetPath, blob] of rawAssetEntries) {
      const ab = await blob.arrayBuffer();
      preparedAssets.push({
        key: `${id}::${assetPath}`,
        path: assetPath,
        bytes: new Uint8Array(ab),
        mimeType: blob.type || 'application/octet-stream'
      });
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let preparedTerrain: PreparedTerrainPayload | null = null;
      if (forcePrepareTerrain) {
        const maskCopy = rawMaskCopy ?? new Uint8Array(doc.terrain.mask);
        const heightU8 = rawHeightCopy ?? new Uint8Array(doc.terrain.height);
        const coverU8 = rawCoverCopy ?? new Uint8Array(doc.terrain.cover);
        rawMaskCopy = null;
        rawHeightCopy = null;
        rawCoverCopy = null;
        if (this.useCustomMaskEncoder) {
          const maskPng = await this.encodeMaskPngFn(maskCopy, widthPx, heightPx);
          preparedTerrain = {
            maskPng: new Uint8Array(maskPng),
            widthPx,
            heightPx,
            heightU8,
            coverU8
          };
        } else {
          preparedTerrain = {
            maskU8: maskCopy,
            widthPx,
            heightPx,
            heightU8,
            coverU8
          };
        }
      }

      if (this.delayBeforeWriteMs > 0) {
        await sleep(this.delayBeforeWriteMs);
      }

      const db = await this.getDb();
      const maskKeyToSave = `${id}:terrain:${terrainVersion}`;

      try {
        const committedMaskKey = await this.commitSaveTransaction(
          db,
          manifest,
          theme,
          terrainVersion,
          maskKeyToSave,
          preparedTerrain,
          preparedAssets
        );

        this.expectedPersistedRevision.set(id, manifest.revision);
        this.lastSavedTerrainVersion.set(id, terrainVersion);
        this.lastSavedMaskKey.set(id, committedMaskKey);
        return;
      } catch (err) {
        if (err instanceof RetryWithPreparedTerrainSignal && attempt === 0) {
          forcePrepareTerrain = true;
          continue;
        }
        throw err;
      }
    }
  }

  private commitSaveTransaction(
    db: IDBDatabase,
    manifest: DocumentManifest,
    theme: MapTheme,
    terrainVersion: number,
    newMaskKey: string,
    preparedTerrain: PreparedTerrainPayload | null,
    preparedAssets: PreparedAssetPayload[]
  ): Promise<string> {
    const id = manifest.id;
    const expectedRevision = this.expectedPersistedRevision.get(id);

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let abortedForError: unknown = null;
      let reqError: unknown = null;
      let finalMaskKey = newMaskKey;

      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      let tx: IDBTransaction;
      try {
        tx = db.transaction(
          [STORE_PROJECTS, STORE_TERRAIN_BLOBS, STORE_ASSETS],
          'readwrite'
        );
      } catch (err) {
        fail(err);
        return;
      }

      const projectsStore = tx.objectStore(STORE_PROJECTS);
      const terrainStore = tx.objectStore(STORE_TERRAIN_BLOBS);
      const assetsStore = tx.objectStore(STORE_ASSETS);

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(finalMaskKey);
      };

      tx.onabort = () => {
        fail(
          abortedForError ??
            tx.error ??
            reqError ??
            new Error('Transazione IndexedDB annullata.')
        );
      };

      tx.onerror = () => {
        fail(
          abortedForError ??
            tx.error ??
            reqError ??
            new Error('Errore nella transazione IndexedDB.')
        );
      };

      const abortWith = (err: unknown) => {
        abortedForError = err;
        try {
          tx.abort();
        } catch {
          fail(err);
        }
      };

      const writeAssetsAndProject = (
        existing: ProjectRecord | undefined,
        maskKeyToUse: string
      ) => {
        try {
          const newAssetKeySet = new Set(preparedAssets.map((a) => a.key));
          for (const oldRef of existing?.assetKeys ?? []) {
            if (!newAssetKeySet.has(oldRef.key)) {
              const delReq = assetsStore.delete(oldRef.key);
              delReq.onerror = () => {
                reqError = delReq.error;
              };
            }
          }

          const newAssetRefs: ProjectAssetKeyRef[] = [];
          for (const asset of preparedAssets) {
            newAssetRefs.push({ key: asset.key, path: asset.path });
            const assetRec: AssetBlobRecord = {
              key: asset.key,
              projectId: id,
              path: asset.path,
              blob: asset.bytes,
              mimeType: asset.mimeType
            };
            const putAssetReq = assetsStore.put(assetRec);
            putAssetReq.onerror = () => {
              reqError = putAssetReq.error;
            };
          }

          const projectRec: ProjectRecord = {
            id,
            title: manifest.title,
            revision: manifest.revision,
            page: { ...manifest.page },
            manifest,
            theme,
            terrainVersion,
            updatedAt: Date.now(),
            lastSavedMaskKey: maskKeyToUse,
            assetKeys: newAssetRefs
          };

          finalMaskKey = maskKeyToUse;
          const putProjReq = projectsStore.put(projectRec);
          putProjReq.onerror = () => {
            reqError = putProjReq.error;
          };
        } catch (err) {
          abortWith(err);
        }
      };

      const writeNewTerrainAndProject = (existing: ProjectRecord | undefined) => {
        if (!preparedTerrain) {
          abortWith(new RetryWithPreparedTerrainSignal());
          return;
        }
        try {
          const blobRec: TerrainBlobRecord = {
            key: newMaskKey,
            projectId: id,
            terrainVersion,
            ...(preparedTerrain.maskPng ? { maskPng: preparedTerrain.maskPng } : {}),
            ...(preparedTerrain.maskU8
              ? {
                  maskU8: preparedTerrain.maskU8,
                  widthPx: preparedTerrain.widthPx,
                  heightPx: preparedTerrain.heightPx
                }
              : {}),
            heightU8: preparedTerrain.heightU8,
            coverU8: preparedTerrain.coverU8
          };
          const putBlobReq = terrainStore.put(blobRec);
          putBlobReq.onerror = () => {
            reqError = putBlobReq.error;
          };

          if (existing?.lastSavedMaskKey && existing.lastSavedMaskKey !== newMaskKey) {
            const delOldReq = terrainStore.delete(existing.lastSavedMaskKey);
            delOldReq.onerror = () => {
              reqError = delOldReq.error;
            };
          }

          writeAssetsAndProject(existing, newMaskKey);
        } catch (err) {
          abortWith(err);
        }
      };

      try {
        const getReq = projectsStore.get(id);
        getReq.onerror = () => {
          reqError = getReq.error;
          abortWith(getReq.error ?? new Error('Impossibile leggere il progetto.'));
        };

        getReq.onsuccess = () => {
          const existing = getReq.result as ProjectRecord | undefined;
          if (existing) {
            const remoteRevision = existing.revision ?? existing.manifest.revision;
            if (expectedRevision === undefined || remoteRevision !== expectedRevision) {
              abortWith(new ConflictError(remoteRevision));
              return;
            }
          }

          if (
            existing &&
            existing.terrainVersion === terrainVersion &&
            existing.lastSavedMaskKey &&
            (existing.manifest?.schemaVersion ?? 1) >= 2
          ) {
            const verifyBlobReq = terrainStore.getKey(existing.lastSavedMaskKey);
            verifyBlobReq.onerror = () => {
              reqError = verifyBlobReq.error;
            };
            verifyBlobReq.onsuccess = () => {
              if (verifyBlobReq.result !== undefined) {
                writeAssetsAndProject(existing, existing.lastSavedMaskKey);
              } else {
                writeNewTerrainAndProject(existing);
              }
            };
            return;
          }

          writeNewTerrainAndProject(existing);
        };
      } catch (err) {
        abortWith(err);
      }
    });
  }

  async loadProject(
    id: string
  ): Promise<{ document: MapDocument; extraAssetBlobs: Map<string, Blob> } | null> {
    const db = await this.getDb();

    const rawLoaded = await new Promise<{
      project: ProjectRecord;
      terrain: TerrainBlobRecord | undefined;
      assets: AssetBlobRecord[];
    } | null>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const tx = db.transaction(
        [STORE_PROJECTS, STORE_TERRAIN_BLOBS, STORE_ASSETS],
        'readonly'
      );
      const projectsStore = tx.objectStore(STORE_PROJECTS);
      const terrainStore = tx.objectStore(STORE_TERRAIN_BLOBS);
      const assetsStore = tx.objectStore(STORE_ASSETS);

      let projectRec: ProjectRecord | undefined;
      let terrainRec: TerrainBlobRecord | undefined;
      const assetRecs: AssetBlobRecord[] = [];

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        if (!projectRec) {
          resolve(null);
          return;
        }
        resolve({
          project: projectRec,
          terrain: terrainRec,
          assets: assetRecs
        });
      };
      tx.onerror = () => fail(tx.error ?? new Error('Errore di lettura IndexedDB.'));
      tx.onabort = () => fail(tx.error ?? new Error('Lettura IndexedDB annullata.'));

      const projReq = projectsStore.get(id);
      projReq.onsuccess = () => {
        projectRec = projReq.result as ProjectRecord | undefined;
        if (!projectRec) return;

        const terReq = terrainStore.get(projectRec.lastSavedMaskKey);
        terReq.onsuccess = () => {
          terrainRec = terReq.result as TerrainBlobRecord | undefined;
        };

        for (const ref of projectRec.assetKeys ?? []) {
          const assetReq = assetsStore.get(ref.key);
          assetReq.onsuccess = () => {
            if (assetReq.result) {
              assetRecs.push(assetReq.result as AssetBlobRecord);
            }
          };
        }
      };
    });

    if (!rawLoaded) {
      return null;
    }

    const { project, terrain, assets } = rawLoaded;
    if (!terrain) {
      throw new Error(
        `Dati binari del terreno mancanti per il progetto "${project.id}".`
      );
    }

    let decoded: { width: number; height: number; mask: Uint8Array };
    if (
      terrain.maskU8 &&
      terrain.maskU8.length > 0 &&
      typeof terrain.widthPx === 'number' &&
      typeof terrain.heightPx === 'number' &&
      terrain.widthPx > 0 &&
      terrain.heightPx > 0 &&
      terrain.maskU8.length === terrain.widthPx * terrain.heightPx
    ) {
      decoded = {
        width: terrain.widthPx,
        height: terrain.heightPx,
        mask: new Uint8Array(terrain.maskU8)
      };
    } else if (terrain.maskPng) {
      decoded = this.decodeMaskPngFn(new Uint8Array(terrain.maskPng));
    } else {
      throw new Error(
        `Dati maschera del terreno mancanti per il progetto "${project.id}".`
      );
    }
    const rawManifest = project.manifest as unknown as Record<string, unknown> | undefined;
    const sourceVersion = assertSupportedSchemaVersion(rawManifest?.schemaVersion);
    const manifest = migrateManifestToV3(rawManifest, {
      widthPx: decoded.width,
      heightPx: decoded.height
    });

    if (
      decoded.width !== manifest.terrain.widthPx ||
      decoded.height !== manifest.terrain.heightPx
    ) {
      throw new Error(
        `Dimensioni maschera incoerenti in IndexedDB per "${manifest.id}".`
      );
    }

    const expectedCells = decoded.width * decoded.height;
    let height: Uint8Array;
    let cover: Uint8Array;
    let initializedFromV1 = false;

    if (
      sourceVersion === 1 &&
      (!terrain.heightU8 ||
        terrain.heightU8.length === 0 ||
        !terrain.coverU8 ||
        terrain.coverU8.length === 0)
    ) {
      const initialized = initializeV1TerrainBuffers(
        decoded.mask,
        decoded.width,
        decoded.height
      );
      height = initialized.height;
      cover = initialized.cover;
      initializedFromV1 = true;
    } else {
      height = new Uint8Array(terrain.heightU8);
      cover = new Uint8Array(terrain.coverU8);
      if (height.length !== expectedCells || cover.length !== expectedCells) {
        throw new Error(
          `Lunghezza dei raster quota/copertura non valida per "${manifest.id}".`
        );
      }
      for (let i = 0; i < cover.length; i += 1) {
        if (!isCoverCode(cover[i])) {
          throw new Error(
            `Codice copertura non valido (${cover[i]}) in IndexedDB per "${manifest.id}" alla cella ${i}: ammessi solo 0–${MAX_COVER_CODE}.`
          );
        }
      }
    }

    const extraAssetBlobs = new Map<string, Blob>();
    for (const rec of assets) {
      extraAssetBlobs.set(rec.path, toBlobFromStored(rec.blob, rec.mimeType));
    }

    const theme =
      sourceVersion === 1
        ? normalizeTheme(V1_FLAT_THEME)
        : validateMapTheme(project.theme);
    const terrainVersion =
      typeof project.terrainVersion === 'number' ? project.terrainVersion : 0;

    const document: MapDocument = {
      manifest,
      terrain: {
        widthPx: decoded.width,
        heightPx: decoded.height,
        mask: decoded.mask,
        height,
        cover
      },
      theme,
      terrainVersion
    };

    this.expectedPersistedRevision.set(id, manifest.revision);
    if (!initializedFromV1) {
      this.lastSavedTerrainVersion.set(id, terrainVersion);
      this.lastSavedMaskKey.set(id, project.lastSavedMaskKey);
    } else {
      this.lastSavedTerrainVersion.delete(id);
      this.lastSavedMaskKey.delete(id);
    }

    return { document, extraAssetBlobs };
  }

  async listProjects(): Promise<SavedProjectSummary[]> {
    const db = await this.getDb();
    return new Promise<SavedProjectSummary[]>((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS], 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.getAll();

      req.onsuccess = () => {
        const records = (req.result as ProjectRecord[]) ?? [];
        const summaries: SavedProjectSummary[] = records
          .map((r) => ({
            id: r.id,
            title: r.manifest?.title ?? r.title,
            revision: r.manifest?.revision ?? r.revision,
            updatedAt: r.updatedAt,
            page: { ...(r.manifest?.page ?? r.page) }
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(summaries);
      };

      req.onerror = () => reject(req.error ?? new Error('Impossibile elencare i progetti.'));
      tx.onabort = () => reject(tx.error ?? new Error('Lettura elenco progetti annullata.'));
    });
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const tx = db.transaction(
        [STORE_PROJECTS, STORE_TERRAIN_BLOBS, STORE_ASSETS],
        'readwrite'
      );
      const projectsStore = tx.objectStore(STORE_PROJECTS);
      const terrainStore = tx.objectStore(STORE_TERRAIN_BLOBS);
      const assetsStore = tx.objectStore(STORE_ASSETS);

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      tx.onerror = () => fail(tx.error ?? new Error('Errore eliminazione progetto.'));
      tx.onabort = () => fail(tx.error ?? new Error('Eliminazione progetto annullata.'));

      const getReq = projectsStore.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as ProjectRecord | undefined;
        if (existing) {
          if (existing.lastSavedMaskKey) {
            terrainStore.delete(existing.lastSavedMaskKey);
          }
          for (const ref of existing.assetKeys ?? []) {
            assetsStore.delete(ref.key);
          }
          projectsStore.delete(id);
        }
      };
    });

    this.expectedPersistedRevision.delete(id);
    this.lastSavedTerrainVersion.delete(id);
    this.lastSavedMaskKey.delete(id);
  }

  async projectExists(id: string): Promise<boolean> {
    const db = await this.getDb();
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS], 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).getKey(id);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(req.error ?? new Error('Errore verifica progetto.'));
    });
  }

  async getProjectIds(): Promise<Set<string>> {
    const db = await this.getDb();
    return new Promise<Set<string>>((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS], 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).getAllKeys();
      req.onsuccess = () => {
        const keys = (req.result as IDBValidKey[]) ?? [];
        resolve(new Set(keys.map((k) => String(k))));
      };
      req.onerror = () => reject(req.error ?? new Error('Errore lettura chiavi progetto.'));
    });
  }

  close(): void {
    this.disposed = true;
    if (this.openDbInstance) {
      this.openDbInstance.close();
      this.openDbInstance = null;
    }
    this.dbPromise = null;
  }
}
