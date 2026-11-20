import { getCatalogItemById } from '../assets/catalog';
import { PoiCatalogItem } from '../assets/types';
import { HistoryCommand } from '../model/commands';
import { clampNumber } from '../model/coordinates';
import {
  AssetManifestEntry,
  LabelObject,
  MapDocument,
  MapObject,
  StampObject,
  cloneMapObject,
  safeRandomUUID
} from '../model/document';
import type { EditorStore } from '../state/editorStore';
import { LABEL_ROLE_PRESETS, MapTheme, getFontSpec } from '../theme/theme';

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
  return false;
}

export function getDefaultObjectLabel(obj: MapObject): string {
  if (obj.type === 'label') {
    return obj.text.trim() || 'Etichetta';
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
      (object.type === 'stamp'
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

  return {
    id: options.id ?? safeRandomUUID(),
    type: 'stamp',
    role: 'poi',
    categoryId: catalogItem.categoryId,
    assetId: catalogItem.asset.id,
    x: docX,
    y: docY,
    width: Math.max(4, width ?? catalogItem.defaultWidthDoc),
    height: Math.max(4, height ?? catalogItem.defaultHeightDoc),
    rotationDeg: normalizeRotationDeg(options.rotationDeg ?? 0)
  };
}

export interface CreateLabelObjectOptions {
  id?: string;
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

  return {
    id: options.id ?? safeRandomUUID(),
    type: 'label',
    text,
    x: docX,
    y: docY,
    fontId: fontSpec.id,
    fontSize: Math.max(4, Number(resolvedFontSize.toFixed(2))),
    color: options.color ?? theme.colors.ink,
    rotationDeg: normalizeRotationDeg(options.rotationDeg ?? 0)
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
