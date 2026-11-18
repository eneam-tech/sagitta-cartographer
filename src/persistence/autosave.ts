import { MapDocument, safeRandomUUID } from '../model/document';
import { cloneTheme } from '../theme/theme';
import { exportProjectArchive, importProjectArchive } from './archive';
import {
  CartografoIndexedDb,
  ConflictError,
  MaskPngDecoderFn,
  MaskPngEncoderFn,
  isQuotaExceededError,
  isStorageUnavailableError
} from './indexedDb';
import {
  ArchiveImportResult,
  IPersistenceService,
  PersistenceState,
  SavedProjectSummary
} from './types';

const DEFAULT_DEBOUNCE_MS = 350;
const QUOTA_ERROR_MESSAGE =
  'Spazio locale esaurito. Scarica una copia del progetto.';
const UNAVAILABLE_ERROR_MESSAGE =
  'Archiviazione locale non disponibile. Scarica una copia del progetto.';
const CONFLICT_ERROR_MESSAGE =
  'Il progetto è stato modificato in un’altra scheda. Salva come copia per conservare entrambe le versioni.';

export interface PersistenceServiceOptions {
  debounceMs?: number;
  idbFactory?: IDBFactory | null;
  dbName?: string;
  encodeMaskPngFn?: MaskPngEncoderFn;
  decodeMaskPngFn?: MaskPngDecoderFn;
  delayBeforeWriteMs?: number;
  onBeforePersist?: (doc: MapDocument) => Promise<void> | void;
}

interface SaveSnapshot {
  seq: number;
  revision: number;
  document: MapDocument;
  extraAssets?: Map<string, Blob>;
}

interface FlushWaiter {
  targetSeq: number;
  resolve: () => void;
}

interface ProjectQueue {
  timer: ReturnType<typeof setTimeout> | null;
  debouncedSnapshot: SaveSnapshot | null;
  readySnapshot: SaveSnapshot | null;
  latestEnqueuedSeq: number;
  running: boolean;
  flushWaiters: FlushWaiter[];
}

export class PersistenceService implements IPersistenceService {
  private readonly debounceMs: number;
  private readonly db: CartografoIndexedDb;
  private readonly onBeforePersist?: (doc: MapDocument) => Promise<void> | void;

  private readonly listeners = new Set<(state: PersistenceState) => void>();
  private readonly queues = new Map<string, ProjectQueue>();

  private state: PersistenceState = {
    status: 'idle',
    savedRevision: 0
  };
  private activeProjectId: string | null = null;
  private enqueueSeq = 0;
  private disposed = false;

  constructor(options: PersistenceServiceOptions = {}) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.onBeforePersist = options.onBeforePersist;
    this.db = new CartografoIndexedDb({
      idbFactory: options.idbFactory,
      dbName: options.dbName,
      encodeMaskPngFn: options.encodeMaskPngFn,
      decodeMaskPngFn: options.decodeMaskPngFn,
      delayBeforeWriteMs: options.delayBeforeWriteMs
    });
  }

  subscribe(listener: (state: PersistenceState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): PersistenceState {
    return { ...this.state };
  }

  private setState(next: PersistenceState): void {
    if (
      this.state.status === next.status &&
      this.state.savedRevision === next.savedRevision &&
      this.state.errorMessage === next.errorMessage &&
      this.state.conflictRemoteRevision === next.conflictRemoteRevision
    ) {
      return;
    }
    this.state = { ...next };
    const snapshot = { ...this.state };
    for (const listener of Array.from(this.listeners)) {
      listener(snapshot);
    }
  }

  private getOrCreateQueue(projectId: string): ProjectQueue {
    let queue = this.queues.get(projectId);
    if (!queue) {
      queue = {
        timer: null,
        debouncedSnapshot: null,
        readySnapshot: null,
        latestEnqueuedSeq: 0,
        running: false,
        flushWaiters: []
      };
      this.queues.set(projectId, queue);
    }
    return queue;
  }

  private captureSnapshot(
    doc: MapDocument,
    extraAssets?: Map<string, Blob>
  ): SaveSnapshot {
    const id = doc.manifest.id;
    const canReuseTerrain = this.db.hasCachedTerrainVersion(id, doc.terrainVersion);
    const clonedDoc: MapDocument = {
      manifest: structuredClone(doc.manifest),
      terrain: canReuseTerrain
        ? {
            widthPx: doc.terrain.widthPx,
            heightPx: doc.terrain.heightPx,
            mask: doc.terrain.mask,
            height: doc.terrain.height,
            cover: doc.terrain.cover
          }
        : {
            widthPx: doc.terrain.widthPx,
            heightPx: doc.terrain.heightPx,
            mask: new Uint8Array(doc.terrain.mask),
            height: new Uint8Array(doc.terrain.height),
            cover: new Uint8Array(doc.terrain.cover)
          },
      theme: cloneTheme(doc.theme),
      terrainVersion: doc.terrainVersion
    };

    return {
      seq: ++this.enqueueSeq,
      revision: clonedDoc.manifest.revision,
      document: clonedDoc,
      extraAssets: extraAssets ? new Map(extraAssets) : undefined
    };
  }

  scheduleSave(doc: MapDocument, extraAssets?: Map<string, Blob>): void {
    if (this.disposed) return;

    const projectId = doc.manifest.id;
    this.activeProjectId = projectId;
    const queue = this.getOrCreateQueue(projectId);
    const snapshot = this.captureSnapshot(doc, extraAssets);
    queue.latestEnqueuedSeq = snapshot.seq;

    this.setState({
      status: 'saving',
      savedRevision: this.state.savedRevision
    });

    if (queue.timer !== null) {
      clearTimeout(queue.timer);
      queue.timer = null;
    }

    if (this.debounceMs <= 0) {
      queue.debouncedSnapshot = null;
      queue.readySnapshot = snapshot;
      void this.runProjectQueue(projectId);
      return;
    }

    queue.debouncedSnapshot = snapshot;
    queue.timer = setTimeout(() => {
      queue.timer = null;
      if (this.disposed) return;
      if (queue.debouncedSnapshot) {
        queue.readySnapshot = queue.debouncedSnapshot;
        queue.debouncedSnapshot = null;
      }
      void this.runProjectQueue(projectId);
    }, this.debounceMs);
  }

  flushNow(doc: MapDocument, extraAssets?: Map<string, Blob>): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    const projectId = doc.manifest.id;
    this.activeProjectId = projectId;
    const queue = this.getOrCreateQueue(projectId);
    const snapshot = this.captureSnapshot(doc, extraAssets);
    queue.latestEnqueuedSeq = snapshot.seq;

    if (queue.timer !== null) {
      clearTimeout(queue.timer);
      queue.timer = null;
    }
    queue.debouncedSnapshot = null;
    queue.readySnapshot = snapshot;

    this.setState({
      status: 'saving',
      savedRevision: this.state.savedRevision
    });

    return new Promise<void>((resolve) => {
      queue.flushWaiters.push({ targetSeq: snapshot.seq, resolve });
      void this.runProjectQueue(projectId);
    });
  }

  private resolveWaitersUpTo(queue: ProjectQueue, committedSeq: number): void {
    const remaining: FlushWaiter[] = [];
    for (const waiter of queue.flushWaiters) {
      if (waiter.targetSeq <= committedSeq) {
        waiter.resolve();
      } else {
        remaining.push(waiter);
      }
    }
    queue.flushWaiters = remaining;
  }

  private resolveAllWaiters(queue: ProjectQueue): void {
    const waiters = queue.flushWaiters.splice(0, queue.flushWaiters.length);
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  private clearPendingForProject(projectId: string): void {
    const queue = this.queues.get(projectId);
    if (!queue) return;
    if (queue.timer !== null) {
      clearTimeout(queue.timer);
      queue.timer = null;
    }
    queue.debouncedSnapshot = null;
    queue.readySnapshot = null;
    this.resolveAllWaiters(queue);
  }

  private applyPersistenceError(err: unknown): void {
    if (err instanceof ConflictError) {
      this.setState({
        status: 'conflict',
        savedRevision: this.state.savedRevision,
        conflictRemoteRevision: err.remoteRevision,
        errorMessage: CONFLICT_ERROR_MESSAGE
      });
      return;
    }
    if (isQuotaExceededError(err)) {
      this.setState({
        status: 'error',
        savedRevision: this.state.savedRevision,
        errorMessage: QUOTA_ERROR_MESSAGE
      });
      return;
    }
    if (isStorageUnavailableError(err)) {
      this.setState({
        status: 'error',
        savedRevision: this.state.savedRevision,
        errorMessage: UNAVAILABLE_ERROR_MESSAGE
      });
      return;
    }
    this.setState({
      status: 'error',
      savedRevision: this.state.savedRevision,
      errorMessage:
        err instanceof Error && err.message
          ? err.message
          : 'Errore durante il salvataggio locale.'
    });
  }

  private async runProjectQueue(projectId: string): Promise<void> {
    const queue = this.queues.get(projectId);
    if (!queue || queue.running || this.disposed) return;

    queue.running = true;
    try {
      while (queue.readySnapshot !== null && !this.disposed) {
        const job = queue.readySnapshot;
        queue.readySnapshot = null;

        try {
          if (this.onBeforePersist) {
            await this.onBeforePersist(job.document);
          }
          await this.db.saveProject(job.document, job.extraAssets);
          if (this.disposed) {
            this.resolveAllWaiters(queue);
            break;
          }

          const hasMoreQueued =
            queue.readySnapshot !== null ||
            queue.debouncedSnapshot !== null ||
            queue.timer !== null ||
            job.seq < queue.latestEnqueuedSeq;

          if (!hasMoreQueued && this.activeProjectId === projectId) {
            this.setState({
              status: 'saved',
              savedRevision: job.revision
            });
          }

          this.resolveWaitersUpTo(queue, job.seq);
        } catch (err) {
          if (!this.disposed && this.activeProjectId === projectId) {
            this.applyPersistenceError(err);
          }
          this.clearPendingForProject(projectId);
          break;
        }
      }
    } finally {
      queue.running = false;
      if (this.disposed) {
        this.resolveAllWaiters(queue);
      }
    }
  }

  async loadProject(
    id: string
  ): Promise<{ document: MapDocument; extraAssetBlobs: Map<string, Blob> } | null> {
    const loaded = await this.db.loadProject(id);
    if (loaded) {
      this.activeProjectId = loaded.document.manifest.id;
      this.setState({
        status: 'saved',
        savedRevision: loaded.document.manifest.revision
      });
    }
    return loaded;
  }

  async listProjects(): Promise<SavedProjectSummary[]> {
    return this.db.listProjects();
  }

  async deleteProject(id: string): Promise<void> {
    this.clearPendingForProject(id);
    await this.db.deleteProject(id);
    if (this.activeProjectId === id) {
      this.activeProjectId = null;
      this.setState({
        status: 'idle',
        savedRevision: 0
      });
    }
  }

  async saveAsCopy(
    doc: MapDocument,
    extraAssets?: Map<string, Blob>
  ): Promise<MapDocument> {
    const oldId = doc.manifest.id;
    this.clearPendingForProject(oldId);

    const copyManifest = structuredClone(doc.manifest);
    let nextId = safeRandomUUID();
    while (nextId === oldId) {
      nextId = safeRandomUUID();
    }
    copyManifest.id = nextId;

    const copyDoc: MapDocument = {
      manifest: copyManifest,
      terrain: {
        widthPx: doc.terrain.widthPx,
        heightPx: doc.terrain.heightPx,
        mask: new Uint8Array(doc.terrain.mask),
        height: new Uint8Array(doc.terrain.height),
        cover: new Uint8Array(doc.terrain.cover)
      },
      theme: cloneTheme(doc.theme),
      terrainVersion: doc.terrainVersion
    };

    this.activeProjectId = copyDoc.manifest.id;
    this.setState({
      status: 'saving',
      savedRevision: this.state.savedRevision
    });

    try {
      if (this.onBeforePersist) {
        await this.onBeforePersist(copyDoc);
      }
      await this.db.saveProject(copyDoc, extraAssets);
      this.setState({
        status: 'saved',
        savedRevision: copyDoc.manifest.revision
      });
      return copyDoc;
    } catch (err) {
      this.applyPersistenceError(err);
      throw err;
    }
  }

  async exportArchive(
    doc: MapDocument,
    extraAssets?: Map<string, Blob>
  ): Promise<Uint8Array> {
    return exportProjectArchive(doc, extraAssets);
  }

  async importArchive(bytes: Uint8Array): Promise<ArchiveImportResult> {
    let existingIds: Set<string>;
    try {
      existingIds = await this.db.getProjectIds();
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        existingIds = new Set<string>();
      } else {
        throw err;
      }
    }
    return importProjectArchive(bytes, existingIds);
  }

  dispose(): void {
    this.disposed = true;
    for (const queue of this.queues.values()) {
      if (queue.timer !== null) {
        clearTimeout(queue.timer);
        queue.timer = null;
      }
      queue.debouncedSnapshot = null;
      queue.readySnapshot = null;
      this.resolveAllWaiters(queue);
    }
    this.queues.clear();
    this.listeners.clear();
    this.db.close();
  }
}
