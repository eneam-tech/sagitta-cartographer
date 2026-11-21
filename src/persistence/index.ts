export { PersistenceService } from './autosave';
export type { PersistenceServiceOptions } from './autosave';

export {
  CARTOGRAFO_DB_NAME,
  CARTOGRAFO_DB_VERSION,
  CartografoIndexedDb,
  ConflictError,
  StorageQuotaError,
  StorageUnavailableError,
  isQuotaExceededError,
  isStorageUnavailableError
} from './indexedDb';
export type {
  AssetBlobRecord,
  IndexedDbOptions,
  MaskPngDecoderFn,
  MaskPngEncoderFn,
  ProjectAssetKeyRef,
  ProjectRecord,
  TerrainBlobRecord
} from './indexedDb';

export {
  MAX_ARCHIVE_FILES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  buildLicensesText,
  exportProjectArchive,
  importProjectArchive,
  validateMapTheme
} from './archive';

export {
  assertSupportedSchemaVersion,
  deriveStableSeed,
  initializeV1TerrainBuffers,
  migrateManifestToV3,
  migrateManifestV1ToV2
} from './migration';

export type {
  ArchiveImportResult,
  IPersistenceService,
  PersistenceState,
  SaveStatus,
  SavedProjectSummary
} from './types';
