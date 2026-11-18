import { PageSizeMm } from '../model/coordinates';
import { MapDocument } from '../model/document';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface PersistenceState {
  status: SaveStatus;
  savedRevision: number;
  errorMessage?: string;
  conflictRemoteRevision?: number;
}

export interface SavedProjectSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: number;
  page: PageSizeMm;
}

export interface ArchiveImportResult {
  document: MapDocument;
  extraAssetBlobs: Map<string, Blob>;
  wasMigratedFromV1: boolean;
  wasIdRemapped: boolean;
}

export interface IPersistenceService {
  subscribe(listener: (state: PersistenceState) => void): () => void;
  getState(): PersistenceState;
  scheduleSave(doc: MapDocument, extraAssets?: Map<string, Blob>): void;
  flushNow(doc: MapDocument, extraAssets?: Map<string, Blob>): Promise<void>;
  loadProject(id: string): Promise<{ document: MapDocument; extraAssetBlobs: Map<string, Blob> } | null>;
  listProjects(): Promise<SavedProjectSummary[]>;
  deleteProject(id: string): Promise<void>;
  saveAsCopy(doc: MapDocument, extraAssets?: Map<string, Blob>): Promise<MapDocument>;
  exportArchive(doc: MapDocument, extraAssets?: Map<string, Blob>): Promise<Uint8Array>;
  importArchive(bytes: Uint8Array): Promise<ArchiveImportResult>;
  dispose(): void;
}
