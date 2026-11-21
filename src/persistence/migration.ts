import {
  DOC_UNITS_PER_MM,
  pageMmToSpace,
  validateMaskDimensions,
  validatePageSizeMm
} from '../model/coordinates';
import {
  AssetManifestEntry,
  COVER_NATURAL,
  DocumentManifest,
  LabelObject,
  MapLayer,
  MapObject,
  RULES_VERSION,
  SCHEMA_VERSION,
  StampObject,
  TerrainBuffers,
  ThemeRef,
  createDefaultLayers,
  isValidArchivePath,
  resolveObjectLayerId,
  validateDocumentManifest
} from '../model/document';
import {
  DEFAULT_THEME,
  DEFAULT_THEME_FONTS,
  V1_FLAT_THEME,
  getBuiltinThemeById
} from '../theme/theme';

const PLAINS_DEFAULT_HEIGHT = 64;

/**
 * Validates that a manifest schemaVersion is within the supported range [1, SCHEMA_VERSION].
 */
export function assertSupportedSchemaVersion(version: unknown): 1 | 2 | 3 {
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new Error(
      `Versione schema non valida o mancante (supportate: v1–v${SCHEMA_VERSION}).`
    );
  }
  if (version < 1 || version > SCHEMA_VERSION) {
    throw new Error(
      `Versione schema non supportata: trovata v${version}, supportate v1–v${SCHEMA_VERSION}.`
    );
  }
  return version as 1 | 2 | 3;
}

/**
 * Derives a deterministic unsigned 32-bit seed from document id and title when missing in v1.
 */
export function deriveStableSeed(id: string, title = ''): number {
  const input = `${id}\0${title}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Initializes v2 height and cover rasters from a v1 land mask:
 * land (mask > 0) starts at plains height 64, sea (mask === 0) at 0, cover all COVER_NATURAL (0).
 */
export function initializeV1TerrainBuffers(
  mask: Uint8Array,
  widthPx: number,
  heightPx: number
): TerrainBuffers {
  validateMaskDimensions({ widthPx, heightPx });
  const expectedLength = widthPx * heightPx;
  if (mask.length !== expectedLength) {
    throw new Error(
      `Dimensione maschera (${mask.length}) non coerente con ${widthPx}×${heightPx}.`
    );
  }

  const height = new Uint8Array(expectedLength);
  const cover = new Uint8Array(expectedLength);
  cover.fill(COVER_NATURAL);

  for (let i = 0; i < expectedLength; i += 1) {
    if (mask[i] > 0) {
      height[i] = PLAINS_DEFAULT_HEIGHT;
    }
  }

  return {
    widthPx,
    heightPx,
    mask: new Uint8Array(mask),
    height,
    cover
  };
}

function normalizeV1AssetEntry(raw: unknown): AssetManifestEntry {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Voce asset non valida nel manifest v1.');
  }
  const a = raw as Record<string, unknown>;
  const id = typeof a.id === 'string' ? a.id : '';
  const path = typeof a.path === 'string' ? a.path : '';
  return {
    id,
    path,
    mimeType: typeof a.mimeType === 'string' && a.mimeType ? a.mimeType : 'image/svg+xml',
    version: typeof a.version === 'number' && Number.isInteger(a.version) && a.version >= 1 ? a.version : 1,
    author: typeof a.author === 'string' && a.author ? a.author : 'Sconosciuto',
    source: typeof a.source === 'string' && a.source ? a.source : 'v1-import',
    license: typeof a.license === 'string' && a.license ? a.license : 'Unspecified',
    ...(typeof a.attribution === 'string' ? { attribution: a.attribution } : {}),
    width: typeof a.width === 'number' ? a.width : 128,
    height: typeof a.height === 'number' ? a.height : 128,
    anchorX: typeof a.anchorX === 'number' ? a.anchorX : 0.5,
    anchorY: typeof a.anchorY === 'number' ? a.anchorY : 0.5
  };
}

function normalizeV1Object(raw: unknown, layers: readonly MapLayer[]): MapObject {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Oggetto non valido nel manifest v1.');
  }
  const obj = raw as Record<string, unknown>;
  const rawLayerId = typeof obj.layerId === 'string' ? obj.layerId : undefined;
  if (obj.type === 'stamp') {
    const stamp: StampObject = {
      id: obj.id as string,
      type: 'stamp',
      layerId: resolveObjectLayerId({ type: 'stamp', layerId: rawLayerId }, layers),
      role: obj.role === undefined ? 'decorative' : (obj.role as StampObject['role']),
      ...(typeof obj.categoryId === 'string' ? { categoryId: obj.categoryId } : {}),
      assetId: obj.assetId as string,
      x: obj.x as number,
      y: obj.y as number,
      width: obj.width as number,
      height: obj.height as number,
      rotationDeg: typeof obj.rotationDeg === 'number' ? obj.rotationDeg : 0
    };
    return stamp;
  }

  if (obj.type === 'label') {
    const label: LabelObject = {
      id: obj.id as string,
      type: 'label',
      layerId: resolveObjectLayerId({ type: 'label', layerId: rawLayerId }, layers),
      text: obj.text as string,
      x: obj.x as number,
      y: obj.y as number,
      fontId:
        typeof obj.fontId === 'string' && obj.fontId
          ? obj.fontId
          : DEFAULT_THEME_FONTS.defaultFontId,
      fontSize: obj.fontSize as number,
      color: typeof obj.color === 'string' && obj.color ? obj.color : DEFAULT_THEME.colors.ink,
      rotationDeg: typeof obj.rotationDeg === 'number' ? obj.rotationDeg : 0
    };
    return label;
  }

  throw new Error(`Tipo di oggetto non supportato nel manifest v1: ${String(obj.type)}.`);
}

function normalizeThemeRef(rawThemeInput: unknown, fallbackId: string): ThemeRef {
  if (
    rawThemeInput !== undefined &&
    (typeof rawThemeInput !== 'object' || rawThemeInput === null || Array.isArray(rawThemeInput))
  ) {
    throw new Error('Riferimento al tema non valido.');
  }
  const rawTheme = (rawThemeInput as Record<string, unknown> | undefined) ?? {};
  if (
    rawTheme.file !== undefined &&
    (typeof rawTheme.file !== 'string' || !isValidArchivePath(rawTheme.file))
  ) {
    throw new Error('Riferimento al tema non valido.');
  }
  const id =
    typeof rawTheme.id === 'string' && rawTheme.id.trim() ? rawTheme.id : fallbackId;
  const builtin = getBuiltinThemeById(id);
  const version =
    typeof rawTheme.version === 'number' &&
    Number.isInteger(rawTheme.version) &&
    rawTheme.version >= 1
      ? rawTheme.version
      : (builtin?.version ?? DEFAULT_THEME.version);
  const file = typeof rawTheme.file === 'string' ? rawTheme.file : 'theme/theme.json';
  return { id, version, file };
}

function normalizeLayerEntries(rawLayers: unknown[]): MapLayer[] {
  return rawLayers.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry as MapLayer;
    }
    const cloned = structuredClone(entry) as Record<string, unknown>;
    if (cloned.visible === undefined) cloned.visible = true;
    if (cloned.locked === undefined) cloned.locked = false;
    if (cloned.opacity === undefined) cloned.opacity = 1;
    return cloned as unknown as MapLayer;
  });
}

function normalizeV2Object(raw: unknown, layers: readonly MapLayer[]): MapObject {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Oggetto non valido nel manifest v2.');
  }
  const obj = structuredClone(raw) as Record<string, unknown>;
  if (obj.type === 'stamp') {
    if (obj.role === undefined) {
      obj.role = 'decorative';
    }
    if (obj.rotationDeg === undefined) {
      obj.rotationDeg = 0;
    }
  } else if (obj.type === 'label') {
    if (typeof obj.fontId !== 'string' || !obj.fontId) {
      obj.fontId = DEFAULT_THEME_FONTS.defaultFontId;
    }
    if (typeof obj.color !== 'string' || !obj.color) {
      obj.color = DEFAULT_THEME.colors.ink;
    }
    if (obj.rotationDeg === undefined) {
      obj.rotationDeg = 0;
    }
  } else if (obj.type === 'path') {
    if (obj.rotationDeg === undefined) {
      obj.rotationDeg = 0;
    }
  } else {
    throw new Error(`Tipo di oggetto non supportato: ${String(obj.type)}.`);
  }

  obj.layerId = resolveObjectLayerId(
    {
      type: obj.type as MapObject['type'],
      layerId: typeof obj.layerId === 'string' ? obj.layerId : undefined
    },
    layers
  );

  return obj as unknown as MapObject;
}

function normalizeOptionalV3Fields(raw: unknown): unknown {
  const cloned = structuredClone(raw) as Record<string, unknown>;
  if (cloned.theme && typeof cloned.theme === 'object' && !Array.isArray(cloned.theme)) {
    const themeRef = cloned.theme as Record<string, unknown>;
    if (themeRef.version === undefined && typeof themeRef.id === 'string') {
      themeRef.version =
        getBuiltinThemeById(themeRef.id)?.version ?? DEFAULT_THEME.version;
    }
  }
  if (Array.isArray(cloned.layers)) {
    cloned.layers = normalizeLayerEntries(cloned.layers);
  }
  if (Array.isArray(cloned.objects)) {
    cloned.objects = cloned.objects.map((rawObj) => {
      if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
        return rawObj;
      }
      const obj = rawObj as Record<string, unknown>;
      if (
        (obj.type === 'stamp' || obj.type === 'label' || obj.type === 'path') &&
        obj.rotationDeg === undefined
      ) {
        obj.rotationDeg = 0;
      }
      return obj;
    });
  }
  return cloned;
}

function resolvePageAndSpace(
  rawPage: unknown,
  rawSpace: unknown
): { page: DocumentManifest['page']; space: DocumentManifest['space'] } {
  let page: DocumentManifest['page'] | undefined;
  let space: DocumentManifest['space'] | undefined;

  if (rawPage !== undefined) {
    if (!rawPage || typeof rawPage !== 'object' || Array.isArray(rawPage)) {
      throw new Error('Dimensioni fisiche della pagina mancanti.');
    }
    const p = rawPage as Record<string, unknown>;
    page = { widthMm: p.widthMm as number, heightMm: p.heightMm as number };
    validatePageSizeMm(page);
  }

  if (rawSpace !== undefined) {
    if (!rawSpace || typeof rawSpace !== 'object' || Array.isArray(rawSpace)) {
      throw new Error('Spazio logico non valido nel manifest.');
    }
    const s = rawSpace as Record<string, unknown>;
    if (
      typeof s.width !== 'number' ||
      typeof s.height !== 'number' ||
      !Number.isFinite(s.width) ||
      !Number.isFinite(s.height) ||
      s.width <= 0 ||
      s.height <= 0
    ) {
      throw new Error('Spazio logico non valido nel manifest.');
    }
    space = { width: s.width, height: s.height };
  }

  if (!page && space) {
    page = {
      widthMm: space.width / DOC_UNITS_PER_MM,
      heightMm: space.height / DOC_UNITS_PER_MM
    };
    validatePageSizeMm(page);
  }

  if (!page) {
    page = { widthMm: 297, heightMm: 210 };
  }

  if (!space) {
    space = pageMmToSpace(page);
  }

  return { page, space };
}

function migrateV1ToV3(
  m: Record<string, unknown>,
  fallbackDims?: { widthPx: number; heightPx: number }
): DocumentManifest {
  if (typeof m.id !== 'string' || !m.id.trim()) {
    throw new Error('Identificativo documento mancante nel manifest v1.');
  }
  if (m.kind !== undefined && m.kind !== 'world') {
    throw new Error(`Tipo di mappa non supportato: ${String(m.kind)}.`);
  }
  if (m.title !== undefined && typeof m.title !== 'string') {
    throw new Error('Titolo del documento non valido nel manifest v1.');
  }
  const title = typeof m.title === 'string' ? m.title : 'Nuova carta';

  const revision = m.revision === undefined ? 0 : m.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    throw new Error('Revisione del documento non valida nel manifest v1.');
  }

  const { page, space } = resolvePageAndSpace(m.page, m.space);

  const rawTerrain =
    m.terrain && typeof m.terrain === 'object' ? (m.terrain as Record<string, unknown>) : {};
  const maskPath =
    typeof rawTerrain.mask === 'string'
      ? rawTerrain.mask
      : typeof m.mask === 'string'
        ? m.mask
        : 'terrain/land.png';
  const heightPath =
    typeof rawTerrain.height === 'string' && isValidArchivePath(rawTerrain.height)
      ? rawTerrain.height
      : 'terrain/height.u8';
  const coverPath =
    typeof rawTerrain.cover === 'string' && isValidArchivePath(rawTerrain.cover)
      ? rawTerrain.cover
      : 'terrain/cover.u8';

  const widthPx =
    typeof rawTerrain.widthPx === 'number' ? rawTerrain.widthPx : fallbackDims?.widthPx;
  const heightPx =
    typeof rawTerrain.heightPx === 'number' ? rawTerrain.heightPx : fallbackDims?.heightPx;

  if (widthPx === undefined || heightPx === undefined) {
    throw new Error('Dimensioni della maschera terreno mancanti nel manifest v1.');
  }
  validateMaskDimensions({ widthPx, heightPx });

  const seed =
    typeof rawTerrain.seed === 'number' &&
    Number.isInteger(rawTerrain.seed) &&
    rawTerrain.seed >= 0 &&
    rawTerrain.seed <= 0xffffffff
      ? rawTerrain.seed
      : deriveStableSeed(m.id, title);

  const rulesVersion =
    typeof rawTerrain.rulesVersion === 'number' &&
    Number.isInteger(rawTerrain.rulesVersion) &&
    rawTerrain.rulesVersion >= 1
      ? rawTerrain.rulesVersion
      : RULES_VERSION;

  const rawTheme =
    m.theme && typeof m.theme === 'object' ? (m.theme as Record<string, unknown>) : {};
  if (
    rawTheme.file !== undefined &&
    (typeof rawTheme.file !== 'string' || !isValidArchivePath(rawTheme.file))
  ) {
    throw new Error('Riferimento al tema non valido.');
  }
  const themeFile =
    typeof rawTheme.file === 'string' ? rawTheme.file : 'theme/theme.json';

  if (m.assets !== undefined && !Array.isArray(m.assets)) {
    throw new Error('Elenco assets non valido nel manifest v1.');
  }
  if (m.objects !== undefined && !Array.isArray(m.objects)) {
    throw new Error('Elenco objects non valido nel manifest v1.');
  }

  const layers = createDefaultLayers();
  const assets = ((m.assets as unknown[]) ?? []).map(normalizeV1AssetEntry);
  const objects = ((m.objects as unknown[]) ?? []).map((obj) =>
    normalizeV1Object(obj, layers)
  );

  const migrated: DocumentManifest = {
    schemaVersion: SCHEMA_VERSION,
    id: m.id,
    revision,
    kind: 'world',
    title,
    page,
    space,
    terrain: {
      mask: maskPath,
      height: heightPath,
      cover: coverPath,
      rulesVersion,
      seed,
      widthPx,
      heightPx
    },
    theme: {
      id: V1_FLAT_THEME.id,
      version: V1_FLAT_THEME.version,
      file: themeFile
    },
    assets,
    layers,
    objects
  };

  return validateDocumentManifest(migrated);
}

function migrateV2ToV3(
  m: Record<string, unknown>,
  fallbackDims?: { widthPx: number; heightPx: number }
): DocumentManifest {
  if (typeof m.id !== 'string' || !m.id.trim()) {
    throw new Error('Identificativo documento mancante.');
  }
  if (m.kind !== undefined && m.kind !== 'world') {
    throw new Error(`Tipo di mappa non supportato: ${String(m.kind)}.`);
  }
  if (m.title !== undefined && typeof m.title !== 'string') {
    throw new Error('Titolo del documento non valido.');
  }
  const title = typeof m.title === 'string' ? m.title : 'Nuova carta';

  const revision = m.revision === undefined ? 0 : m.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    throw new Error('Revisione del documento non valida.');
  }

  const { page, space } = resolvePageAndSpace(m.page, m.space);

  if (!m.terrain || typeof m.terrain !== 'object' || Array.isArray(m.terrain)) {
    throw new Error('Metadati terreno mancanti.');
  }
  const rawTerrain = m.terrain as Record<string, unknown>;
  const maskPath = rawTerrain.mask === undefined ? 'terrain/land.png' : (rawTerrain.mask as string);
  const heightPath =
    rawTerrain.height === undefined ? 'terrain/height.u8' : (rawTerrain.height as string);
  const coverPath =
    rawTerrain.cover === undefined ? 'terrain/cover.u8' : (rawTerrain.cover as string);

  const widthPx =
    typeof rawTerrain.widthPx === 'number' ? rawTerrain.widthPx : fallbackDims?.widthPx;
  const heightPx =
    typeof rawTerrain.heightPx === 'number' ? rawTerrain.heightPx : fallbackDims?.heightPx;
  if (widthPx === undefined || heightPx === undefined) {
    throw new Error('Dimensioni della maschera terreno mancanti nel manifest v2.');
  }
  validateMaskDimensions({ widthPx, heightPx });

  const seed =
    rawTerrain.seed === undefined ? deriveStableSeed(m.id, title) : (rawTerrain.seed as number);
  const rulesVersion =
    rawTerrain.rulesVersion === undefined ? 1 : (rawTerrain.rulesVersion as number);

  if (m.assets !== undefined && !Array.isArray(m.assets)) {
    throw new Error('Elenchi assets o objects non validi.');
  }
  if (m.objects !== undefined && !Array.isArray(m.objects)) {
    throw new Error('Elenchi assets o objects non validi.');
  }

  let layers: MapLayer[];
  if (m.layers === undefined || m.layers === null) {
    layers = createDefaultLayers();
  } else if (Array.isArray(m.layers)) {
    layers = normalizeLayerEntries(m.layers);
  } else {
    throw new Error('Elenco livelli mancante o vuoto nel manifest.');
  }

  const assets = structuredClone((m.assets as AssetManifestEntry[] | undefined) ?? []);
  const objects = ((m.objects as unknown[]) ?? []).map((obj) =>
    normalizeV2Object(obj, layers)
  );

  const migrated: DocumentManifest = {
    schemaVersion: SCHEMA_VERSION,
    id: m.id,
    revision,
    kind: 'world',
    title,
    page,
    space,
    terrain: {
      mask: maskPath,
      height: heightPath,
      cover: coverPath,
      rulesVersion,
      seed,
      widthPx,
      heightPx
    },
    theme: normalizeThemeRef(m.theme, DEFAULT_THEME.id),
    assets,
    layers,
    objects
  };

  return validateDocumentManifest(migrated);
}

/**
 * Migrates a v1 or v2 document manifest to schemaVersion 3 without mutating the input.
 * Accepts already-v3 manifests by normalizing optional fields, validating, and returning a deep clone.
 */
export function migrateManifestToV3(
  raw: unknown,
  fallbackDims?: { widthPx: number; heightPx: number }
): DocumentManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Manifest del documento non valido o assente.');
  }

  const m = raw as Record<string, unknown>;
  const version = assertSupportedSchemaVersion(m.schemaVersion);

  if (version === SCHEMA_VERSION) {
    return validateDocumentManifest(normalizeOptionalV3Fields(raw));
  }
  if (version === 2) {
    return migrateV2ToV3(m, fallbackDims);
  }
  return migrateV1ToV3(m, fallbackDims);
}

/**
 * Backward-compatible alias that migrates v1/v2 manifests to the current v3 schema.
 */
export function migrateManifestV1ToV2(
  raw: unknown,
  fallbackDims?: { widthPx: number; heightPx: number }
): DocumentManifest {
  return migrateManifestToV3(raw, fallbackDims);
}
