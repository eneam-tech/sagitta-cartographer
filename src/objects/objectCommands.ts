import { getCatalogItemById } from '../assets/catalog';
import { PoiCatalogItem } from '../assets/types';
import { HistoryCommand } from '../model/commands';
import { clampNumber } from '../model/coordinates';
import {
  AssetManifestEntry,
  DEFAULT_LAYER_VECTORS_ID,
  LabelObject,
  MapDocument,
  MapLayer,
  MapObject,
  PathKind,
  PathObject,
  StampObject,
  cloneMapObject,
  resolveObjectLayerId,
  safeRandomUUID
} from '../model/document';
import type { EditorStore } from '../state/editorStore';
import { DEFAULT_THEME, LABEL_ROLE_PRESETS, MapTheme, getFontSpec } from '../theme/theme';

function cloneAssetEntry(entry: AssetManifestEntry): AssetManifestEntry {
  return { ...entry };
}

export function normalizeRotationDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const mod = ((deg % 360) + 360) % 360;
  const rounded = Math.round(mod * 10) / 10;
  if (rounded >= 360 || Object.is(rounded, -0)) {
    return 0;
  }
  return rounded;
}

export function areMapObjectsEqual(a: MapObject, b: MapObject): boolean {
  if (
    a.id !== b.id ||
    a.type !== b.type ||
    (a.layerId ?? undefined) !== (b.layerId ?? undefined) ||
    a.x !== b.x ||
    a.y !== b.y ||
    a.rotationDeg !== b.rotationDeg
  ) {
    return false;
  }
  if (a.type === 'stamp' && b.type === 'stamp') {
    return (
      a.role === b.role &&
      a.categoryId === b.categoryId &&
      a.assetId === b.assetId &&
      a.width === b.width &&
      a.height === b.height
    );
  }
  if (a.type === 'label' && b.type === 'label') {
    return (
      a.text === b.text &&
      a.fontId === b.fontId &&
      a.fontSize === b.fontSize &&
      a.color === b.color
    );
  }
  if (a.type === 'path' && b.type === 'path') {
    if (
      a.kind !== b.kind ||
      a.strokeWidthDoc !== b.strokeWidthDoc ||
      a.color !== b.color ||
      (a.opacity ?? 1) !== (b.opacity ?? 1) ||
      Boolean(a.dashed) !== Boolean(b.dashed) ||
      Boolean(a.tapered) !== Boolean(b.tapered) ||
      (a.smooth !== false) !== (b.smooth !== false) ||
      a.points.length !== b.points.length
    ) {
      return false;
    }
    for (let i = 0; i < a.points.length; i += 1) {
      if (a.points[i] !== b.points[i]) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export const PATH_KIND_OPTIONS: ReadonlyArray<{
  kind: PathKind;
  label: string;
}> = [
  { kind: 'river', label: 'Fiume' },
  { kind: 'road', label: 'Strada' },
  { kind: 'border', label: 'Confine' },
  { kind: 'freehand', label: 'Inchiostro libero' }
];

export function getPathKindLabel(kind: PathKind): string {
  const found = PATH_KIND_OPTIONS.find((opt) => opt.kind === kind);
  return found ? found.label : 'Tracciato';
}

export function getDeleteObjectLabel(obj: Pick<MapObject, 'type'>): string {
  if (obj.type === 'stamp') return 'Elimina simbolo';
  if (obj.type === 'label') return 'Elimina etichetta';
  return 'Elimina tracciato';
}

export function getDefaultObjectLabel(obj: MapObject): string {
  if (obj.type === 'label') {
    return obj.text.trim() || 'Etichetta';
  }
  if (obj.type === 'path') {
    return getPathKindLabel(obj.kind);
  }
  return getCatalogItemById(obj.assetId)?.name ?? obj.categoryId ?? obj.assetId;
}

/**
 * Adds a StampObject or LabelObject to `doc.manifest.objects` and automatically
 * registers built-in POI asset entries in `doc.manifest.assets` when needed.
 */
export class AddObjectCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'add-object';
  readonly label: string;
  readonly byteSize = 256;
  readonly affectsTerrain = false;

  private readonly objectSnapshot: MapObject;
  private readonly insertIndex?: number;
  private readonly explicitAssetEntry?: AssetManifestEntry;
  private didAddAsset = false;

  constructor(
    object: MapObject,
    insertIndex?: number,
    assetEntry?: AssetManifestEntry,
    label?: string
  ) {
    this.objectSnapshot = cloneMapObject(object);
    this.insertIndex = insertIndex;
    this.explicitAssetEntry = assetEntry ? cloneAssetEntry(assetEntry) : undefined;
    this.label =
      label ??
      (object.type === 'stamp' || object.type === 'path'
        ? `Aggiungi ${getDefaultObjectLabel(object)}`
        : 'Aggiungi etichetta');
  }

  apply(doc: MapDocument): void {
    if (this.objectSnapshot.type === 'stamp') {
      const assetId = this.objectSnapshot.assetId;
      const alreadyPresent = doc.manifest.assets.some((a) => a.id === assetId);
      if (!alreadyPresent) {
        const catalogEntry = getCatalogItemById(assetId)?.asset;
        const entryToRegister = this.explicitAssetEntry ?? catalogEntry;
        if (!entryToRegister) {
          throw new Error(
            `Impossibile registrare la risorsa "${assetId}" per lo sticker "${this.objectSnapshot.id}".`
          );
        }
        doc.manifest.assets.push(cloneAssetEntry(entryToRegister));
        this.didAddAsset = true;
      } else {
        this.didAddAsset = false;
      }
    }

    const existingIdx = doc.manifest.objects.findIndex((o) => o.id === this.objectSnapshot.id);
    if (existingIdx !== -1) {
      doc.manifest.objects[existingIdx] = cloneMapObject(this.objectSnapshot);
      return;
    }

    const targetIdx =
      this.insertIndex === undefined
        ? doc.manifest.objects.length
        : Math.round(clampNumber(this.insertIndex, 0, doc.manifest.objects.length));

    doc.manifest.objects.splice(targetIdx, 0, cloneMapObject(this.objectSnapshot));
  }

  revert(doc: MapDocument): void {
    const idx = doc.manifest.objects.findIndex((o) => o.id === this.objectSnapshot.id);
    if (idx !== -1) {
      doc.manifest.objects.splice(idx, 1);
    }

    if (this.objectSnapshot.type === 'stamp' && this.didAddAsset) {
      const assetId = this.objectSnapshot.assetId;
      const stillReferenced = doc.manifest.objects.some(
        (o) => o.type === 'stamp' && o.assetId === assetId
      );
      if (!stillReferenced) {
        const assetIdx = doc.manifest.assets.findIndex((a) => a.id === assetId);
        if (assetIdx !== -1) {
          doc.manifest.assets.splice(assetIdx, 1);
        }
      }
      this.didAddAsset = false;
    }
  }
}

export interface AddObjectsBatchOptions {
  label?: string;
  assetEntries?: readonly AssetManifestEntry[];
}

/**
 * Atomically inserts or reverts a batch of MapObjects (e.g., a scatter POI brush stroke)
 * as a single undo/redo step while keeping `doc.manifest.assets` coherent.
 */
export class AddObjectsBatchCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'add-objects-batch';
  readonly label: string;
  readonly byteSize: number;
  readonly affectsTerrain = false;

  private readonly objectSnapshots: MapObject[];
  private readonly explicitAssetsById = new Map<string, AssetManifestEntry>();
  private addedObjectIds: string[] = [];
  private addedAssetIds: string[] = [];

  constructor(
    objects: readonly MapObject[],
    labelOrOptions?: string | AddObjectsBatchOptions,
    assetEntries?: readonly AssetManifestEntry[]
  ) {
    this.objectSnapshots = objects.map((obj) => cloneMapObject(obj));
    this.byteSize = Math.max(256, this.objectSnapshots.length * 256);

    if (typeof labelOrOptions === 'string') {
      this.label = labelOrOptions;
      if (assetEntries) {
        for (const entry of assetEntries) {
          this.explicitAssetsById.set(entry.id, cloneAssetEntry(entry));
        }
      }
    } else {
      this.label = labelOrOptions?.label ?? 'Pennellata POI scatter';
      const entries = labelOrOptions?.assetEntries ?? assetEntries ?? [];
      for (const entry of entries) {
        this.explicitAssetsById.set(entry.id, cloneAssetEntry(entry));
      }
    }
  }

  isNoOp(): boolean {
    return this.objectSnapshots.length === 0;
  }

  apply(doc: MapDocument): void {
    this.addedObjectIds = [];
    this.addedAssetIds = [];

    for (const obj of this.objectSnapshots) {
      if (obj.type === 'stamp') {
        const assetId = obj.assetId;
        const alreadyPresent = doc.manifest.assets.some((a) => a.id === assetId);
        if (!alreadyPresent) {
          const catalogEntry = getCatalogItemById(assetId)?.asset;
          const entryToRegister = this.explicitAssetsById.get(assetId) ?? catalogEntry;
          if (!entryToRegister) {
            throw new Error(
              `Impossibile registrare la risorsa "${assetId}" per lo sticker "${obj.id}".`
            );
          }
          doc.manifest.assets.push(cloneAssetEntry(entryToRegister));
          this.addedAssetIds.push(assetId);
        }
      }

      if (!doc.manifest.objects.some((o) => o.id === obj.id)) {
        doc.manifest.objects.push(cloneMapObject(obj));
        this.addedObjectIds.push(obj.id);
      }
    }
  }

  revert(doc: MapDocument): void {
    if (this.addedObjectIds.length > 0) {
      const toRemove = new Set(this.addedObjectIds);
      doc.manifest.objects = doc.manifest.objects.filter((o) => !toRemove.has(o.id));
    }

    for (const assetId of this.addedAssetIds) {
      const stillReferenced = doc.manifest.objects.some(
        (o) => o.type === 'stamp' && o.assetId === assetId
      );
      if (!stillReferenced) {
        const assetIdx = doc.manifest.assets.findIndex((a) => a.id === assetId);
        if (assetIdx !== -1) {
          doc.manifest.assets.splice(assetIdx, 1);
        }
      }
    }

    this.addedObjectIds = [];
    this.addedAssetIds = [];
  }
}

/**
 * Updates a single MapObject atomically from a before-snapshot to an after-snapshot.
 * Safely acts as a no-op if the two snapshots are equal.
 */
export class UpdateObjectCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'update-object';
  readonly label: string;
  readonly byteSize = 384;
  readonly affectsTerrain = false;

  readonly objectId: string;
  private readonly prevSnapshot: MapObject;
  private readonly nextSnapshot: MapObject;

  constructor(
    objectId: string,
    prevSnapshot: MapObject,
    nextSnapshot: MapObject,
    label = 'Modifica oggetto'
  ) {
    if (prevSnapshot.id !== objectId || nextSnapshot.id !== objectId) {
      throw new Error(`Identificativo oggetto incoerente per UpdateObjectCommand ("${objectId}").`);
    }
    if (prevSnapshot.type !== nextSnapshot.type) {
      throw new Error(`Tipo oggetto incoerente per UpdateObjectCommand ("${objectId}").`);
    }
    this.objectId = objectId;
    this.prevSnapshot = cloneMapObject(prevSnapshot);
    this.nextSnapshot = cloneMapObject(nextSnapshot);
    this.label = label;
  }

  isNoOp(): boolean {
    return areMapObjectsEqual(this.prevSnapshot, this.nextSnapshot);
  }

  apply(doc: MapDocument): void {
    if (this.isNoOp()) return;
    const idx = doc.manifest.objects.findIndex((o) => o.id === this.objectId);
    if (idx !== -1) {
      doc.manifest.objects[idx] = cloneMapObject(this.nextSnapshot);
    }
  }

  revert(doc: MapDocument): void {
    if (this.isNoOp()) return;
    const idx = doc.manifest.objects.findIndex((o) => o.id === this.objectId);
    if (idx !== -1) {
      doc.manifest.objects[idx] = cloneMapObject(this.prevSnapshot);
    }
  }
}

/**
 * Deletes a MapObject while preserving its original z-order index for undo.
 */
export class DeleteObjectCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'delete-object';
  readonly label: string;
  readonly byteSize = 256;
  readonly affectsTerrain = false;

  readonly objectId: string;
  private deletedObject: MapObject | null = null;
  private deletedIndex = 0;

  constructor(objectId: string, label = 'Elimina oggetto') {
    this.objectId = objectId;
    this.label = label;
  }

  apply(doc: MapDocument): void {
    const idx = doc.manifest.objects.findIndex((o) => o.id === this.objectId);
    if (idx === -1) return;
    this.deletedIndex = idx;
    this.deletedObject = cloneMapObject(doc.manifest.objects[idx]);
    doc.manifest.objects.splice(idx, 1);
  }

  revert(doc: MapDocument): void {
    if (!this.deletedObject) return;
    if (doc.manifest.objects.some((o) => o.id === this.objectId)) return;
    const insertAt = Math.min(this.deletedIndex, doc.manifest.objects.length);
    doc.manifest.objects.splice(insertAt, 0, cloneMapObject(this.deletedObject));
  }
}

/**
 * Moves an object within `doc.manifest.objects` (z-order) while keeping its `id` unchanged.
 */
export class ReorderObjectsCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'reorder-objects';
  readonly label: string;
  readonly byteSize = 128;
  readonly affectsTerrain = false;

  readonly objectId: string;
  readonly nextIndex: number;
  private prevIndex: number | null = null;

  constructor(objectId: string, nextIndex: number, label = 'Riordina oggetto') {
    this.objectId = objectId;
    this.nextIndex = nextIndex;
    this.label = label;
  }

  apply(doc: MapDocument): void {
    const len = doc.manifest.objects.length;
    if (len <= 1) return;
    const currentIndex = doc.manifest.objects.findIndex((o) => o.id === this.objectId);
    if (currentIndex === -1) return;

    const targetIndex = Math.round(clampNumber(this.nextIndex, 0, len - 1));
    this.prevIndex = currentIndex;
    if (currentIndex === targetIndex) return;

    const [moved] = doc.manifest.objects.splice(currentIndex, 1);
    doc.manifest.objects.splice(targetIndex, 0, moved);
  }

  revert(doc: MapDocument): void {
    const len = doc.manifest.objects.length;
    if (len <= 1 || this.prevIndex === null) return;
    const currentIndex = doc.manifest.objects.findIndex((o) => o.id === this.objectId);
    if (currentIndex === -1) return;

    const restoreIndex = Math.round(clampNumber(this.prevIndex, 0, len - 1));
    if (currentIndex === restoreIndex) return;

    const [moved] = doc.manifest.objects.splice(currentIndex, 1);
    doc.manifest.objects.splice(restoreIndex, 0, moved);
  }
}

export interface CreatePoiStampOptions {
  id?: string;
  layerId?: string;
  scale?: number;
  width?: number;
  height?: number;
  rotationDeg?: number;
}

/**
 * Creates a POI StampObject preserving the catalog item's natural aspect ratio.
 */
export function createPoiStampObject(
  catalogItem: PoiCatalogItem,
  docX: number,
  docY: number,
  options: CreatePoiStampOptions = {}
): StampObject {
  const aspect =
    catalogItem.asset.height > 0 ? catalogItem.asset.width / catalogItem.asset.height : 1;
  const scale =
    options.scale !== undefined && Number.isFinite(options.scale) && options.scale > 0
      ? options.scale
      : 1;

  let width = options.width;
  let height = options.height;

  if (width !== undefined && height === undefined) {
    height = Number((width / aspect).toFixed(2));
  } else if (height !== undefined && width === undefined) {
    width = Number((height * aspect).toFixed(2));
  } else if (width === undefined && height === undefined) {
    width = catalogItem.defaultWidthDoc;
    height = catalogItem.defaultHeightDoc;
  }

  const finalWidth = Math.max(4, Number(((width ?? catalogItem.defaultWidthDoc) * scale).toFixed(2)));
  const finalHeight = Math.max(4, Number(((height ?? catalogItem.defaultHeightDoc) * scale).toFixed(2)));

  return {
    id: options.id ?? safeRandomUUID(),
    type: 'stamp',
    ...(options.layerId !== undefined ? { layerId: options.layerId } : {}),
    role: 'poi',
    categoryId: catalogItem.categoryId,
    assetId: catalogItem.asset.id,
    x: docX,
    y: docY,
    width: finalWidth,
    height: finalHeight,
    rotationDeg: normalizeRotationDeg(options.rotationDeg ?? 0)
  };
}

export interface CreateLabelObjectOptions {
  id?: string;
  layerId?: string;
  scale?: number;
  fontId?: string;
  fontSize?: number;
  color?: string;
  rotationDeg?: number;
}

/**
 * Creates a LabelObject from a theme font preset or LABEL_ROLE_PRESETS entry.
 */
export function createLabelObject(
  text: string,
  docX: number,
  docY: number,
  theme: MapTheme,
  presetId?: string,
  options: CreateLabelObjectOptions = {}
): LabelObject {
  const rolePreset = presetId
    ? LABEL_ROLE_PRESETS.find((p) => p.id === presetId)
    : undefined;

  let resolvedFontId = options.fontId;
  let resolvedFontSize = options.fontSize;

  if (!resolvedFontId) {
    if (rolePreset) {
      resolvedFontId = rolePreset.fontId;
    } else if (presetId && theme.fonts.presets[presetId]) {
      resolvedFontId = presetId;
    } else {
      resolvedFontId = theme.fonts.defaultFontId;
    }
  }

  const fontSpec = getFontSpec(theme, resolvedFontId);
  if (resolvedFontSize === undefined) {
    resolvedFontSize = rolePreset ? rolePreset.fontSizeDoc : fontSpec.defaultSizeDoc;
  }

  const scale =
    options.scale !== undefined && Number.isFinite(options.scale) && options.scale > 0
      ? options.scale
      : 1;

  return {
    id: options.id ?? safeRandomUUID(),
    type: 'label',
    ...(options.layerId !== undefined ? { layerId: options.layerId } : {}),
    text,
    x: docX,
    y: docY,
    fontId: fontSpec.id,
    fontSize: Math.max(4, Number((resolvedFontSize * scale).toFixed(2))),
    color: options.color ?? theme.colors.ink,
    rotationDeg: normalizeRotationDeg(options.rotationDeg ?? 0)
  };
}

function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = clampNumber(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Simplifies a flat polyline `[x0, y0, x1, y1, ...]` in document units
 * using iterative Ramer-Douglas-Peucker with tolerance `toleranceDoc`.
 */
export function simplifyPolyline(docPoints: number[], toleranceDoc: number): number[] {
  const vertexCount = Math.floor(docPoints.length / 2);
  if (vertexCount <= 0) return [];
  const validLen = vertexCount * 2;
  if (vertexCount <= 2 || !Number.isFinite(toleranceDoc) || toleranceDoc <= 0) {
    return docPoints.slice(0, validLen);
  }

  const keep = new Uint8Array(vertexCount);
  keep[0] = 1;
  keep[vertexCount - 1] = 1;

  const stack: Array<[number, number]> = [[0, vertexCount - 1]];
  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop()!;
    if (endIdx - startIdx <= 1) continue;

    const ax = docPoints[startIdx * 2];
    const ay = docPoints[startIdx * 2 + 1];
    const bx = docPoints[endIdx * 2];
    const by = docPoints[endIdx * 2 + 1];

    let maxDist = -1;
    let farthestIdx = -1;
    for (let i = startIdx + 1; i < endIdx; i += 1) {
      const dist = pointToSegmentDistance(
        docPoints[i * 2],
        docPoints[i * 2 + 1],
        ax,
        ay,
        bx,
        by
      );
      if (dist > maxDist) {
        maxDist = dist;
        farthestIdx = i;
      }
    }

    if (farthestIdx !== -1 && maxDist > toleranceDoc) {
      keep[farthestIdx] = 1;
      if (farthestIdx - startIdx > 1) stack.push([startIdx, farthestIdx]);
      if (endIdx - farthestIdx > 1) stack.push([farthestIdx, endIdx]);
    }
  }

  const result: number[] = [];
  for (let i = 0; i < vertexCount; i += 1) {
    if (keep[i]) {
      result.push(docPoints[i * 2], docPoints[i * 2 + 1]);
    }
  }
  return result;
}

export interface CreatePathObjectOptions {
  id?: string;
  layerId?: string;
  kind: PathKind;
  points: readonly number[];
  strokeWidthDoc?: number;
  color?: string;
  theme?: MapTheme;
  opacity?: number;
  dashed?: boolean;
  tapered?: boolean;
  smooth?: boolean;
  rotationDeg?: number;
}

function getPathKindDefaults(kind: PathKind, theme: MapTheme): {
  strokeWidthDoc: number;
  color: string;
  smooth: boolean;
  dashed: boolean;
  tapered: boolean;
} {
  const c = theme.colors;
  if (kind === 'river') {
    return { strokeWidthDoc: 14, color: c.pathRiver, smooth: true, dashed: false, tapered: true };
  }
  if (kind === 'road') {
    return { strokeWidthDoc: 9, color: c.pathRoad, smooth: true, dashed: false, tapered: false };
  }
  if (kind === 'border') {
    return { strokeWidthDoc: 7, color: c.pathBorder, smooth: true, dashed: true, tapered: false };
  }
  return { strokeWidthDoc: 6, color: c.ink, smooth: true, dashed: false, tapered: false };
}

/**
 * Creates a PathObject centered on the bounding box of `options.points`,
 * storing relative vertex coordinates around `(x, y)` for uniform Konva transforms.
 */
export function createPathObject(options: CreatePathObjectOptions): PathObject {
  const rawCount = Math.floor(options.points.length / 2);
  if (rawCount < 1) {
    throw new Error('Un tracciato richiede almeno un punto valido.');
  }

  const normalizedAbs: number[] = [];
  for (let i = 0; i < rawCount; i += 1) {
    const px = options.points[i * 2];
    const py = options.points[i * 2 + 1];
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      throw new Error('Coordinate non finite nel tracciato.');
    }
    normalizedAbs.push(px, py);
  }
  if (rawCount === 1) {
    normalizedAbs.push(normalizedAbs[0] + 0.5, normalizedAbs[1]);
  }

  const count = normalizedAbs.length / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < count; i += 1) {
    const px = normalizedAbs[i * 2];
    const py = normalizedAbs[i * 2 + 1];
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  const cx = Number(((minX + maxX) / 2).toFixed(2));
  const cy = Number(((minY + maxY) / 2).toFixed(2));
  const relativePoints: number[] = [];
  for (let i = 0; i < count; i += 1) {
    relativePoints.push(
      Number((normalizedAbs[i * 2] - cx).toFixed(2)),
      Number((normalizedAbs[i * 2 + 1] - cy).toFixed(2))
    );
  }

  const defaults = getPathKindDefaults(options.kind, options.theme ?? DEFAULT_THEME);
  const strokeWidthDoc = Math.max(
    1,
    Number((options.strokeWidthDoc ?? defaults.strokeWidthDoc).toFixed(2))
  );
  const opacity =
    options.opacity !== undefined
      ? Number(clampNumber(options.opacity, 0, 1).toFixed(2))
      : 1;

  return {
    id: options.id ?? safeRandomUUID(),
    type: 'path',
    layerId: options.layerId ?? DEFAULT_LAYER_VECTORS_ID,
    kind: options.kind,
    x: cx,
    y: cy,
    rotationDeg: normalizeRotationDeg(options.rotationDeg ?? 0),
    points: relativePoints,
    strokeWidthDoc,
    color: options.color?.trim() ? options.color : defaults.color,
    opacity,
    dashed: options.dashed ?? defaults.dashed,
    tapered: options.tapered ?? defaults.tapered,
    smooth: options.smooth ?? defaults.smooth
  };
}

/**
 * Executes an UpdateObjectCommand on EditorStore only if `prevSnapshot` and `nextSnapshot` differ.
 * Returns true if a command was recorded, false if skipped as a no-op.
 */
export function commitObjectUpdate(
  store: EditorStore,
  prevSnapshot: MapObject,
  nextSnapshot: MapObject,
  label = 'Modifica oggetto'
): boolean {
  if (areMapObjectsEqual(prevSnapshot, nextSnapshot)) {
    return false;
  }
  const cmd = new UpdateObjectCommand(prevSnapshot.id, prevSnapshot, nextSnapshot, label);
  if (cmd.isNoOp()) {
    return false;
  }
  store.executeCommand(cmd);
  return true;
}

/**
 * Reorders an object in `EditorStore` only if its target index differs from its current index.
 */
export function commitObjectReorder(
  store: EditorStore,
  objectId: string,
  nextIndex: number,
  label?: string
): boolean {
  const objects = store.getDocument().manifest.objects;
  const currentIndex = objects.findIndex((o) => o.id === objectId);
  if (currentIndex === -1 || objects.length <= 1) return false;
  const clamped = Math.round(clampNumber(nextIndex, 0, objects.length - 1));
  if (clamped === currentIndex) return false;
  const defaultLabel = clamped > currentIndex ? 'Porta avanti' : 'Porta indietro';
  store.executeCommand(new ReorderObjectsCommand(objectId, clamped, label ?? defaultLabel));
  return true;
}

export interface SameLayerAdjacentIndices {
  docIndex: number;
  resolvedLayerId: string;
  prevSameLayerIndex: number | null;
  nextSameLayerIndex: number | null;
}

/**
 * Finds the previous and next indices in `objects` belonging to the same effective
 * layer as `objectId`, preventing no-op reorders across objects on different layers.
 */
export function getSameLayerAdjacentIndices(
  objects: readonly MapObject[],
  layers: readonly MapLayer[],
  objectId: string
): SameLayerAdjacentIndices | null {
  const docIndex = objects.findIndex((o) => o.id === objectId);
  if (docIndex === -1) return null;

  const resolvedLayerId = resolveObjectLayerId(objects[docIndex], layers);
  let prevSameLayerIndex: number | null = null;
  let nextSameLayerIndex: number | null = null;

  for (let i = docIndex - 1; i >= 0; i -= 1) {
    if (resolveObjectLayerId(objects[i], layers) === resolvedLayerId) {
      prevSameLayerIndex = i;
      break;
    }
  }
  for (let i = docIndex + 1; i < objects.length; i += 1) {
    if (resolveObjectLayerId(objects[i], layers) === resolvedLayerId) {
      nextSameLayerIndex = i;
      break;
    }
  }

  return {
    docIndex,
    resolvedLayerId,
    prevSameLayerIndex,
    nextSameLayerIndex
  };
}

/**
 * Reorders `objectId` one visual step forward or backward among objects sharing
 * the same effective layer.
 */
export function commitObjectReorderInLayer(
  store: EditorStore,
  objectId: string,
  direction: 'forward' | 'backward'
): boolean {
  const doc = store.getDocument();
  const adj = getSameLayerAdjacentIndices(doc.manifest.objects, doc.manifest.layers, objectId);
  if (!adj) return false;

  const targetIndex = direction === 'forward' ? adj.nextSameLayerIndex : adj.prevSameLayerIndex;
  if (targetIndex === null) return false;

  return commitObjectReorder(
    store,
    objectId,
    targetIndex,
    direction === 'forward' ? 'Porta avanti' : 'Porta indietro'
  );
}
