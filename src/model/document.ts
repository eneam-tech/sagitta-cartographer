import {
  DEFAULT_EXPORT_PPI,
  DocSpace,
  PageSizeMm,
  pageMmToMaskDimensions,
  pageMmToSpace,
  validateMaskDimensions,
  validatePageSizeMm
} from './coordinates';
import { DEFAULT_THEME, MapTheme, cloneTheme } from '../theme/theme';

export const SCHEMA_VERSION = 2;
export const RULES_VERSION = 1;

export const COVER_NATURAL = 0 as const;
export const COVER_FOREST = 1 as const;
export const COVER_FIELDS = 2 as const;
export type CoverCode = typeof COVER_NATURAL | typeof COVER_FOREST | typeof COVER_FIELDS;

export type StampRole = 'poi' | 'decorative';

export interface TerrainManifest {
  mask: string;
  height: string;
  cover: string;
  rulesVersion: number;
  seed: number;
  widthPx: number;
  heightPx: number;
}

export interface ThemeRef {
  id: string;
  version: number;
  file: string;
}

export interface AssetManifestEntry {
  id: string;
  path: string;
  mimeType: string;
  version: number;
  author: string;
  source: string;
  license: string;
  attribution?: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

export interface StampObject {
  id: string;
  type: 'stamp';
  role: StampRole;
  categoryId?: string;
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
}

export interface LabelObject {
  id: string;
  type: 'label';
  text: string;
  x: number;
  y: number;
  fontId: string;
  fontSize: number;
  color: string;
  rotationDeg: number;
}

export type MapObject = StampObject | LabelObject;

export interface DocumentManifest {
  schemaVersion: number;
  id: string;
  revision: number;
  kind: 'world';
  title: string;
  page: PageSizeMm;
  space: DocSpace;
  terrain: TerrainManifest;
  theme: ThemeRef;
  assets: AssetManifestEntry[];
  objects: MapObject[];
}

export interface TerrainBuffers {
  widthPx: number;
  heightPx: number;
  mask: Uint8Array;
  height: Uint8Array;
  cover: Uint8Array;
}

export interface MapDocument {
  manifest: DocumentManifest;
  terrain: TerrainBuffers;
  theme: MapTheme;
  terrainVersion: number;
}

export interface CreateEmptyDocumentOptions {
  id?: string;
  title?: string;
  page?: PageSizeMm;
  widthPx?: number;
  heightPx?: number;
  seed?: number;
  theme?: MapTheme;
  assets?: AssetManifestEntry[];
}

export function safeRandomUUID(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createEmptyDocument(options: CreateEmptyDocumentOptions = {}): MapDocument {
  const page: PageSizeMm = options.page ?? { widthMm: 297, heightMm: 210 };
  validatePageSizeMm(page);
  const space = pageMmToSpace(page);
  const defaultDims = pageMmToMaskDimensions(page, DEFAULT_EXPORT_PPI);
  const widthPx = options.widthPx ?? defaultDims.widthPx;
  const heightPx = options.heightPx ?? defaultDims.heightPx;
  validateMaskDimensions({ widthPx, heightPx });

  const totalCells = widthPx * heightPx;
  const theme = cloneTheme(options.theme ?? DEFAULT_THEME);
  const seed = ((options.seed ?? 173) >>> 0);

  return {
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      id: options.id ?? safeRandomUUID(),
      revision: 0,
      kind: 'world',
      title: options.title?.trim() || 'Nuova carta',
      page: { ...page },
      space,
      terrain: {
        mask: 'terrain/land.png',
        height: 'terrain/height.u8',
        cover: 'terrain/cover.u8',
        rulesVersion: RULES_VERSION,
        seed,
        widthPx,
        heightPx
      },
      theme: {
        id: theme.id,
        version: theme.version,
        file: 'theme/theme.json'
      },
      assets: options.assets ? options.assets.map((a) => ({ ...a })) : [],
      objects: []
    },
    terrain: {
      widthPx,
      heightPx,
      mask: new Uint8Array(totalCells),
      height: new Uint8Array(totalCells),
      cover: new Uint8Array(totalCells)
    },
    theme,
    terrainVersion: 0
  };
}

export function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Valore non valido per "${label}": atteso numero finito positivo.`);
  }
}

export function isValidArchivePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\')) return false;
  const parts = path.split('/');
  return parts.every((seg) => seg.length > 0 && seg !== '.' && seg !== '..');
}

export function isCoverCode(value: number): value is CoverCode {
  return value === COVER_NATURAL || value === COVER_FOREST || value === COVER_FIELDS;
}

export function validateDocumentManifest(raw: unknown): DocumentManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Manifest del documento non valido o assente.');
  }
  const m = raw as Record<string, unknown>;
  if (m.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Versione schema non supportata: ${String(m.schemaVersion)}.`);
  }
  if (typeof m.id !== 'string' || !m.id.trim()) {
    throw new Error('Identificativo documento mancante.');
  }
  if (typeof m.revision !== 'number' || !Number.isInteger(m.revision) || m.revision < 0) {
    throw new Error('Revisione del documento non valida.');
  }
  if (m.kind !== 'world') {
    throw new Error(`Tipo di mappa non supportato: ${String(m.kind)}.`);
  }
  if (typeof m.title !== 'string') {
    throw new Error('Titolo del documento non valido.');
  }
  const page = m.page as PageSizeMm | undefined;
  if (!page || typeof page !== 'object') {
    throw new Error('Dimensioni fisiche della pagina mancanti.');
  }
  validatePageSizeMm(page);

  const space = m.space as DocSpace | undefined;
  if (!space || typeof space !== 'object') {
    throw new Error('Spazio logico del documento mancante.');
  }
  assertFinitePositive(space.width, 'space.width');
  assertFinitePositive(space.height, 'space.height');

  const terrain = m.terrain as TerrainManifest | undefined;
  if (!terrain || typeof terrain !== 'object') {
    throw new Error('Metadati terreno mancanti.');
  }
  validateMaskDimensions({ widthPx: terrain.widthPx, heightPx: terrain.heightPx });
  if (!isValidArchivePath(terrain.mask) || !isValidArchivePath(terrain.height) || !isValidArchivePath(terrain.cover)) {
    throw new Error('Percorso terreno non valido nel manifest.');
  }
  if (!Number.isInteger(terrain.seed) || terrain.seed < 0 || terrain.seed > 0xffffffff) {
    throw new Error('Seed del terreno non valido.');
  }
  if (!Number.isInteger(terrain.rulesVersion) || terrain.rulesVersion < 1) {
    throw new Error('rulesVersion del terreno non valido.');
  }

  const theme = m.theme as ThemeRef | undefined;
  if (!theme || typeof theme !== 'object' || typeof theme.id !== 'string' || !isValidArchivePath(theme.file)) {
    throw new Error('Riferimento al tema non valido.');
  }

  if (!Array.isArray(m.assets) || !Array.isArray(m.objects)) {
    throw new Error('Elenchi assets o objects non validi.');
  }

  const assetIds = new Set<string>();
  for (const a of m.assets as AssetManifestEntry[]) {
    if (!a || typeof a.id !== 'string' || !a.id || assetIds.has(a.id)) {
      throw new Error(`Asset duplicato o non valido: ${String(a?.id)}.`);
    }
    if (!isValidArchivePath(a.path)) {
      throw new Error(`Percorso asset non valido: ${String(a.path)}.`);
    }
    assertFinitePositive(a.width, `asset(${a.id}).width`);
    assertFinitePositive(a.height, `asset(${a.id}).height`);
    if (!Number.isFinite(a.anchorX) || !Number.isFinite(a.anchorY)) {
      throw new Error(`Ancora asset non valida per ${a.id}.`);
    }
    assetIds.add(a.id);
  }

  const objectIds = new Set<string>();
  for (const obj of m.objects as MapObject[]) {
    if (!obj || typeof obj.id !== 'string' || !obj.id || objectIds.has(obj.id)) {
      throw new Error(`Identificativo oggetto duplicato o mancante: ${String(obj?.id)}.`);
    }
    objectIds.add(obj.id);
    if (!Number.isFinite(obj.x) || !Number.isFinite(obj.y) || !Number.isFinite(obj.rotationDeg)) {
      throw new Error(`Coordinate oggetto non finite per ${obj.id}.`);
    }
    if (obj.type === 'stamp') {
      assertFinitePositive(obj.width, `stamp(${obj.id}).width`);
      assertFinitePositive(obj.height, `stamp(${obj.id}).height`);
      if (typeof obj.assetId !== 'string' || !assetIds.has(obj.assetId)) {
        throw new Error(`Riferimento asset mancante "${String(obj.assetId)}" per lo sticker ${obj.id}.`);
      }
      if (obj.role !== 'poi' && obj.role !== 'decorative') {
        throw new Error(`Ruolo stamp non valido per ${obj.id}.`);
      }
    } else if (obj.type === 'label') {
      if (typeof obj.text !== 'string' || typeof obj.fontId !== 'string' || typeof obj.color !== 'string') {
        throw new Error(`Campi etichetta non validi per ${obj.id}.`);
      }
      assertFinitePositive(obj.fontSize, `label(${obj.id}).fontSize`);
    } else {
      throw new Error(`Tipo di oggetto non supportato: ${String((obj as { type?: unknown }).type)}.`);
    }
  }

  return raw as DocumentManifest;
}

export function cloneMapObject<T extends MapObject>(obj: T): T {
  return { ...obj };
}
