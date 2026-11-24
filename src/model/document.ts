import {
  DEFAULT_EXPORT_PPI,
  DocSpace,
  PageSizeMm,
  pageMmToInteractiveMaskDimensions,
  pageMmToSpace,
  validateMaskDimensions,
  validatePageSizeMm
} from './coordinates';
import { DEFAULT_CITY_THEME, DEFAULT_THEME, MapTheme, cloneTheme } from '../theme/theme';

export const SCHEMA_VERSION = 3;
export const RULES_VERSION = 2;

export const COVER_NATURAL = 0 as const;
export const COVER_FOREST = 1 as const;
export const COVER_FIELDS = 2 as const;
export const COVER_SAND = 3 as const;
export const COVER_BRICK = 4 as const;
export const COVER_SNOW = 5 as const;
export const COVER_SWAMP = 6 as const;
export const COVER_ROCK = 7 as const;
export const COVER_MEADOW = 8 as const;
export const COVER_LAVA = 9 as const;
export const MAX_COVER_CODE = 9;

export type CoverCode =
  | typeof COVER_NATURAL
  | typeof COVER_FOREST
  | typeof COVER_FIELDS
  | typeof COVER_SAND
  | typeof COVER_BRICK
  | typeof COVER_SNOW
  | typeof COVER_SWAMP
  | typeof COVER_ROCK
  | typeof COVER_MEADOW
  | typeof COVER_LAVA;

export type CoverToolId =
  | 'natural'
  | 'forest'
  | 'fields'
  | 'sand'
  | 'brick'
  | 'snow'
  | 'swamp'
  | 'rock'
  | 'meadow'
  | 'lava';

export interface CoverMaterialSpec {
  code: CoverCode;
  tool: CoverToolId;
  label: string;
  shortLabel: string;
  description: string;
}

export const COVER_MATERIALS: readonly CoverMaterialSpec[] = [
  {
    code: COVER_NATURAL,
    tool: 'natural',
    label: 'Naturale',
    shortLabel: 'Naturale',
    description: 'Terreno base reattivo alla quota (spiaggia, pianura, collina, montagna)'
  },
  {
    code: COVER_FOREST,
    tool: 'forest',
    label: 'Foresta',
    shortLabel: 'Foresta',
    description: 'Boschi e macchie alberate sensibili a quota e riva'
  },
  {
    code: COVER_FIELDS,
    tool: 'fields',
    label: 'Campi',
    shortLabel: 'Campi',
    description: 'Coltivi e terrazzamenti agricoli adattati al pendio'
  },
  {
    code: COVER_MEADOW,
    tool: 'meadow',
    label: 'Prateria',
    shortLabel: 'Prateria',
    description: 'Pascoli verdi, erba alta e radure aperte'
  },
  {
    code: COVER_SAND,
    tool: 'sand',
    label: 'Sabbia',
    shortLabel: 'Sabbia',
    description: 'Dune desertiche, banchi sabbiosi e litorali caldi'
  },
  {
    code: COVER_ROCK,
    tool: 'rock',
    label: 'Roccia',
    shortLabel: 'Roccia',
    description: 'Altipiani pietrosi, ghiaioni e falesie esposte'
  },
  {
    code: COVER_SNOW,
    tool: 'snow',
    label: 'Neve',
    shortLabel: 'Neve',
    description: 'Distese innevate, ghiacciai e tundra d’alta quota'
  },
  {
    code: COVER_SWAMP,
    tool: 'swamp',
    label: 'Palude',
    shortLabel: 'Palude',
    description: 'Acquitrini, torbiere e canneti di bassopiano'
  },
  {
    code: COVER_BRICK,
    tool: 'brick',
    label: 'Mattoni',
    shortLabel: 'Mattoni',
    description: 'Pavimentazione urbana, selciato, rovine e bastioni'
  },
  {
    code: COVER_LAVA,
    tool: 'lava',
    label: 'Lava',
    shortLabel: 'Lava',
    description: 'Basalto incandescente, colate laviche e fenditure sulfuree'
  }
] as const;

export const DEFAULT_LAYER_TERRAIN_ID = 'layer-terrain';
export const DEFAULT_LAYER_VECTORS_ID = 'layer-vectors';
export const DEFAULT_LAYER_BUILDINGS_ID = 'layer-buildings';
export const DEFAULT_LAYER_POI_ID = 'layer-poi';
export const DEFAULT_LAYER_LABELS_ID = 'layer-labels';

export type MapEnvironmentKind = 'world' | 'city';
export type LayerKind = 'terrain' | 'vector' | 'buildings' | 'poi' | 'labels' | 'custom';

export interface MapLayer {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export function createDefaultLayers(kind: MapEnvironmentKind = 'world'): MapLayer[] {
  if (kind === 'city') {
    return [
      {
        id: DEFAULT_LAYER_TERRAIN_ID,
        name: 'Suolo e Acque',
        kind: 'terrain',
        visible: true,
        locked: false,
        opacity: 1
      },
      {
        id: DEFAULT_LAYER_VECTORS_ID,
        name: 'Strade, Piazze e Mura',
        kind: 'vector',
        visible: true,
        locked: false,
        opacity: 1
      },
      {
        id: DEFAULT_LAYER_BUILDINGS_ID,
        name: 'Quartieri ed Edifici',
        kind: 'buildings',
        visible: true,
        locked: false,
        opacity: 1
      },
      {
        id: DEFAULT_LAYER_POI_ID,
        name: 'Luoghi e Monumenti',
        kind: 'poi',
        visible: true,
        locked: false,
        opacity: 1
      },
      {
        id: DEFAULT_LAYER_LABELS_ID,
        name: 'Nomi e Quartieri',
        kind: 'labels',
        visible: true,
        locked: false,
        opacity: 1
      }
    ];
  }
  return [
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
      opacity: 1
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
      opacity: 1
    }
  ];
}

export type StampRole = 'poi' | 'decorative';
export type PathKind =
  | 'river'
  | 'road'
  | 'border'
  | 'freehand'
  | 'avenue'
  | 'alley'
  | 'canal'
  | 'wall';

export type BuildingShape = 'rect' | 'l-shape' | 'courtyard' | 'tower' | 'cathedral' | 'market';
export type BuildingRenderStyle = 'roof-25d' | 'ink-plan';

export interface BuildingObject {
  id: string;
  type: 'building';
  layerId?: string;
  shape: BuildingShape;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  roofColor: string;
  wallColor?: string;
  roofAngleDeg?: number;
  renderStyle?: BuildingRenderStyle;
  districtTag?: string;
  seed?: number;
}

export type PlazaShape = 'rect' | 'circle' | 'octagon';
export type PlazaCenterpiece = 'none' | 'fountain' | 'obelisk' | 'market-stalls' | 'tree';

export interface PlazaObject {
  id: string;
  type: 'plaza';
  layerId?: string;
  shape: PlazaShape;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  fillColor: string;
  borderColor: string;
  centerpiece: PlazaCenterpiece;
}

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
  layerId?: string;
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
  layerId?: string;
  text: string;
  x: number;
  y: number;
  fontId: string;
  fontSize: number;
  color: string;
  rotationDeg: number;
}

export type WallStyle = 'stone' | 'palisade' | 'bastion' | 'low-wall';
export type WallTowerShape = 'round' | 'square';

export interface WallGateOpening {
  distanceDoc: number;
  halfWidthDoc: number;
}

export interface PathObject {
  id: string;
  type: 'path';
  layerId?: string;
  kind: PathKind;
  x: number;
  y: number;
  rotationDeg: number;
  points: number[];
  strokeWidthDoc: number;
  color: string;
  opacity?: number;
  dashed?: boolean;
  tapered?: boolean;
  smooth?: boolean;
  wallStyle?: WallStyle;
  wallSide?: 1 | -1;
  wallClosed?: boolean;
  wallGates?: WallGateOpening[];
}

export type MapObject = StampObject | LabelObject | PathObject | BuildingObject | PlazaObject;

export function defaultLayerIdForObject(obj: Pick<MapObject, 'type'>): string {
  if (obj.type === 'path' || obj.type === 'plaza') return DEFAULT_LAYER_VECTORS_ID;
  if (obj.type === 'building') return DEFAULT_LAYER_BUILDINGS_ID;
  if (obj.type === 'label') return DEFAULT_LAYER_LABELS_ID;
  return DEFAULT_LAYER_POI_ID;
}

export function resolveObjectLayerId(obj: Pick<MapObject, 'type' | 'layerId'>, layers: readonly MapLayer[]): string {
  if (obj.layerId && layers.some((layer) => layer.id === obj.layerId && layer.kind !== 'terrain')) {
    return obj.layerId;
  }
  const preferred = defaultLayerIdForObject(obj);
  if (layers.some((layer) => layer.id === preferred && layer.kind !== 'terrain')) {
    return preferred;
  }
  if (obj.type === 'building') {
    const byKind = layers.find((layer) => layer.kind === 'buildings');
    if (byKind) return byKind.id;
  }
  const fallback = layers.find((layer) => layer.kind !== 'terrain');
  return fallback ? fallback.id : DEFAULT_LAYER_POI_ID;
}

export interface DocumentManifest {
  schemaVersion: number;
  id: string;
  revision: number;
  kind: MapEnvironmentKind;
  title: string;
  page: PageSizeMm;
  space: DocSpace;
  terrain: TerrainManifest;
  theme: ThemeRef;
  assets: AssetManifestEntry[];
  layers: MapLayer[];
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
  kind?: MapEnvironmentKind;
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
  const kind: MapEnvironmentKind = options.kind ?? 'world';
  const page: PageSizeMm = options.page ?? { widthMm: 297, heightMm: 210 };
  validatePageSizeMm(page);
  const space = pageMmToSpace(page);
  const defaultDims = pageMmToInteractiveMaskDimensions(page, DEFAULT_EXPORT_PPI);
  const widthPx = options.widthPx ?? defaultDims.widthPx;
  const heightPx = options.heightPx ?? defaultDims.heightPx;
  validateMaskDimensions({ widthPx, heightPx });

  const totalCells = widthPx * heightPx;
  const theme = cloneTheme(
    options.theme ?? (kind === 'city' ? DEFAULT_CITY_THEME : DEFAULT_THEME)
  );
  const seed = ((options.seed ?? 173) >>> 0);
  const mask = new Uint8Array(totalCells);
  const height = new Uint8Array(totalCells);
  const cover = new Uint8Array(totalCells);

  if (kind === 'city') {
    // Le mappe urbane partono con suolo pianeggiante edificabile anziché oceano vuoto
    mask.fill(255);
    height.fill(72);
  }

  return {
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      id: options.id ?? safeRandomUUID(),
      revision: 0,
      kind,
      title: options.title?.trim() || (kind === 'city' ? 'Nuova città' : 'Nuova carta'),
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
      layers: createDefaultLayers(kind),
      objects: []
    },
    terrain: {
      widthPx,
      heightPx,
      mask,
      height,
      cover
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
  return Number.isInteger(value) && value >= COVER_NATURAL && value <= MAX_COVER_CODE;
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
  if (m.kind !== 'world' && m.kind !== 'city') {
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
  if (!Array.isArray(m.layers) || m.layers.length === 0) {
    throw new Error('Elenco livelli mancante o vuoto nel manifest.');
  }

  const layerIds = new Set<string>();
  let terrainLayerCount = 0;
  for (const l of m.layers as MapLayer[]) {
    if (!l || typeof l.id !== 'string' || !l.id.trim() || layerIds.has(l.id)) {
      throw new Error(`Livello duplicato o non valido: ${String(l?.id)}.`);
    }
    if (typeof l.name !== 'string' || !l.name.trim()) {
      throw new Error(`Nome livello non valido per ${l.id}.`);
    }
    if (
      l.kind !== 'terrain' &&
      l.kind !== 'vector' &&
      l.kind !== 'buildings' &&
      l.kind !== 'poi' &&
      l.kind !== 'labels' &&
      l.kind !== 'custom'
    ) {
      throw new Error(`Tipo livello non valido per ${l.id}: ${String(l.kind)}.`);
    }
    if (typeof l.visible !== 'boolean' || typeof l.locked !== 'boolean') {
      throw new Error(`Flag visibilità/blocco non validi per il livello ${l.id}.`);
    }
    if (typeof l.opacity !== 'number' || !Number.isFinite(l.opacity) || l.opacity < 0 || l.opacity > 1) {
      throw new Error(`Opacità non valida per il livello ${l.id}.`);
    }
    if (l.kind === 'terrain') {
      terrainLayerCount += 1;
    }
    layerIds.add(l.id);
  }
  if (terrainLayerCount === 0) {
    throw new Error('Manifest privo del livello terreno obbligatorio.');
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
    if (obj.layerId !== undefined && (typeof obj.layerId !== 'string' || !layerIds.has(obj.layerId))) {
      throw new Error(`Riferimento layerId non valido "${String(obj.layerId)}" per l'oggetto ${obj.id}.`);
    }
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
    } else if (obj.type === 'path') {
      if (
        obj.kind !== 'river' &&
        obj.kind !== 'road' &&
        obj.kind !== 'border' &&
        obj.kind !== 'freehand' &&
        obj.kind !== 'avenue' &&
        obj.kind !== 'alley' &&
        obj.kind !== 'canal' &&
        obj.kind !== 'wall'
      ) {
        throw new Error(`Tipo tracciato non valido per ${obj.id}: ${String((obj as { kind?: unknown }).kind)}.`);
      }
      if (!Array.isArray(obj.points) || obj.points.length < 4 || obj.points.length % 2 !== 0) {
        throw new Error(`Vertici del tracciato non validi per ${obj.id}.`);
      }
      for (const coord of obj.points) {
        if (typeof coord !== 'number' || !Number.isFinite(coord)) {
          throw new Error(`Coordinata tracciato non finita per ${obj.id}.`);
        }
      }
      assertFinitePositive(obj.strokeWidthDoc, `path(${obj.id}).strokeWidthDoc`);
      if (typeof obj.color !== 'string' || !obj.color.trim()) {
        throw new Error(`Colore tracciato non valido per ${obj.id}.`);
      }
      if (
        obj.opacity !== undefined &&
        (typeof obj.opacity !== 'number' || !Number.isFinite(obj.opacity) || obj.opacity < 0 || obj.opacity > 1)
      ) {
        throw new Error(`Opacità tracciato non valida per ${obj.id}.`);
      }
      if (
        obj.wallStyle !== undefined &&
        obj.wallStyle !== 'stone' &&
        obj.wallStyle !== 'palisade' &&
        obj.wallStyle !== 'bastion' &&
        obj.wallStyle !== 'low-wall'
      ) {
        throw new Error(`Stile mura non valido per ${obj.id}: ${String(obj.wallStyle)}.`);
      }
      if (obj.wallSide !== undefined && obj.wallSide !== 1 && obj.wallSide !== -1) {
        throw new Error(`Orientamento mura non valido per ${obj.id}.`);
      }
      if (obj.wallClosed !== undefined && typeof obj.wallClosed !== 'boolean') {
        throw new Error(`Chiusura mura non valida per ${obj.id}.`);
      }
      if (obj.wallGates !== undefined) {
        if (!Array.isArray(obj.wallGates)) {
          throw new Error(`Elenco varchi mura non valido per ${obj.id}.`);
        }
        for (const g of obj.wallGates) {
          if (
            !g ||
            typeof g.distanceDoc !== 'number' ||
            !Number.isFinite(g.distanceDoc) ||
            g.distanceDoc < 0 ||
            typeof g.halfWidthDoc !== 'number' ||
            !Number.isFinite(g.halfWidthDoc) ||
            g.halfWidthDoc <= 0
          ) {
            throw new Error(`Varco mura non valido per ${obj.id}.`);
          }
        }
      }
    } else if (obj.type === 'building') {
      if (
        obj.shape !== 'rect' &&
        obj.shape !== 'l-shape' &&
        obj.shape !== 'courtyard' &&
        obj.shape !== 'tower' &&
        obj.shape !== 'cathedral' &&
        obj.shape !== 'market'
      ) {
        throw new Error(`Forma edificio non valida per ${obj.id}: ${String((obj as { shape?: unknown }).shape)}.`);
      }
      assertFinitePositive(obj.width, `building(${obj.id}).width`);
      assertFinitePositive(obj.height, `building(${obj.id}).height`);
      if (typeof obj.roofColor !== 'string' || !obj.roofColor.trim()) {
        throw new Error(`Colore tetto non valido per ${obj.id}.`);
      }
      if (
        obj.renderStyle !== undefined &&
        obj.renderStyle !== 'roof-25d' &&
        obj.renderStyle !== 'ink-plan'
      ) {
        throw new Error(`Stile edificio non valido per ${obj.id}.`);
      }
    } else if (obj.type === 'plaza') {
      if (obj.shape !== 'rect' && obj.shape !== 'circle' && obj.shape !== 'octagon') {
        throw new Error(`Forma piazza non valida per ${obj.id}: ${String((obj as { shape?: unknown }).shape)}.`);
      }
      assertFinitePositive(obj.width, `plaza(${obj.id}).width`);
      assertFinitePositive(obj.height, `plaza(${obj.id}).height`);
      if (typeof obj.fillColor !== 'string' || !obj.fillColor.trim()) {
        throw new Error(`Colore piazza non valido per ${obj.id}.`);
      }
      if (typeof obj.borderColor !== 'string' || !obj.borderColor.trim()) {
        throw new Error(`Colore bordo piazza non valido per ${obj.id}.`);
      }
      if (
        obj.centerpiece !== 'none' &&
        obj.centerpiece !== 'fountain' &&
        obj.centerpiece !== 'obelisk' &&
        obj.centerpiece !== 'market-stalls' &&
        obj.centerpiece !== 'tree'
      ) {
        throw new Error(`Elemento centrale piazza non valido per ${obj.id}.`);
      }
    } else {
      throw new Error(`Tipo di oggetto non supportato: ${String((obj as { type?: unknown }).type)}.`);
    }
  }

  return raw as DocumentManifest;
}

export function cloneMapObject<T extends MapObject>(obj: T): T {
  if (obj.type === 'path') {
    return {
      ...obj,
      points: [...obj.points],
      ...(obj.wallGates ? { wallGates: obj.wallGates.map((g) => ({ ...g })) } : {})
    };
  }
  return { ...obj };
}

export function cloneMapLayer(layer: MapLayer): MapLayer {
  return { ...layer };
}
