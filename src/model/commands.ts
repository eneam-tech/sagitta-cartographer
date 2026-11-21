import { DocSpace, PageSizeMm } from './coordinates';
import {
  MapDocument,
  MapLayer,
  MapObject,
  TerrainBuffers,
  cloneMapLayer,
  cloneMapObject,
  safeRandomUUID
} from './document';
import { MapTheme, cloneTheme } from '../theme/theme';

export interface DirtyRectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TerrainTilePatch {
  x: number;
  y: number;
  width: number;
  height: number;
  beforeMask: Uint8Array;
  afterMask: Uint8Array;
  beforeHeight: Uint8Array;
  afterHeight: Uint8Array;
  beforeCover: Uint8Array;
  afterCover: Uint8Array;
}

export interface HistoryCommand {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly byteSize: number;
  readonly affectsTerrain: boolean;
  readonly dirtyRect?: DirtyRectPx;
  apply(doc: MapDocument): void;
  revert(doc: MapDocument): void;
}

function writeTileSlices(
  doc: MapDocument,
  patches: TerrainTilePatch[],
  useAfter: boolean
): void {
  const { widthPx, mask, height, cover } = doc.terrain;
  for (const p of patches) {
    const srcM = useAfter ? p.afterMask : p.beforeMask;
    const srcH = useAfter ? p.afterHeight : p.beforeHeight;
    const srcC = useAfter ? p.afterCover : p.beforeCover;
    for (let row = 0; row < p.height; row += 1) {
      const dstStart = (p.y + row) * widthPx + p.x;
      const srcStart = row * p.width;
      mask.set(srcM.subarray(srcStart, srcStart + p.width), dstStart);
      height.set(srcH.subarray(srcStart, srcStart + p.width), dstStart);
      cover.set(srcC.subarray(srcStart, srcStart + p.width), dstStart);
    }
  }
}

export function computePatchesByteSize(patches: TerrainTilePatch[]): number {
  let bytes = 0;
  for (const p of patches) {
    bytes +=
      p.beforeMask.byteLength +
      p.afterMask.byteLength +
      p.beforeHeight.byteLength +
      p.afterHeight.byteLength +
      p.beforeCover.byteLength +
      p.afterCover.byteLength;
  }
  return bytes;
}

export class TerrainPatchCommand implements HistoryCommand {
  readonly id: string;
  readonly kind = 'terrain-patch';
  readonly label: string;
  readonly byteSize: number;
  readonly affectsTerrain = true;
  readonly dirtyRect: DirtyRectPx;
  private readonly patches: TerrainTilePatch[];

  constructor(label: string, dirtyRect: DirtyRectPx, patches: TerrainTilePatch[]) {
    this.id = safeRandomUUID();
    this.label = label;
    this.dirtyRect = dirtyRect;
    this.patches = patches;
    this.byteSize = computePatchesByteSize(patches);
  }

  apply(doc: MapDocument): void {
    writeTileSlices(doc, this.patches, true);
  }

  revert(doc: MapDocument): void {
    writeTileSlices(doc, this.patches, false);
  }
}

export class SetTitleCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'set-title';
  readonly label = 'Rinomina carta';
  readonly byteSize = 128;
  readonly affectsTerrain = false;

  constructor(private readonly prevTitle: string, private readonly nextTitle: string) {}

  apply(doc: MapDocument): void {
    doc.manifest.title = this.nextTitle;
  }

  revert(doc: MapDocument): void {
    doc.manifest.title = this.prevTitle;
  }
}

export class SetThemeCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'set-theme';
  readonly label = 'Cambia tema della carta';
  readonly byteSize = 4096;
  readonly affectsTerrain = true;
  readonly dirtyRect?: DirtyRectPx;
  private readonly prevTheme: MapTheme;
  private readonly nextTheme: MapTheme;

  constructor(prevTheme: MapTheme, nextTheme: MapTheme, doc?: MapDocument) {
    this.prevTheme = cloneTheme(prevTheme);
    this.nextTheme = cloneTheme(nextTheme);
    if (doc) {
      this.dirtyRect = {
        x: 0,
        y: 0,
        width: doc.terrain.widthPx,
        height: doc.terrain.heightPx
      };
    }
  }

  apply(doc: MapDocument): void {
    doc.theme = cloneTheme(this.nextTheme);
    doc.manifest.theme = {
      id: this.nextTheme.id,
      version: this.nextTheme.version,
      file: 'theme/theme.json'
    };
  }

  revert(doc: MapDocument): void {
    doc.theme = cloneTheme(this.prevTheme);
    doc.manifest.theme = {
      id: this.prevTheme.id,
      version: this.prevTheme.version,
      file: 'theme/theme.json'
    };
  }
}

export interface CanvasResizeSnapshot {
  page: PageSizeMm;
  space: DocSpace;
  terrain: TerrainBuffers;
  objects: MapObject[];
}

function cloneResizeSnapshot(s: CanvasResizeSnapshot): CanvasResizeSnapshot {
  return {
    page: { ...s.page },
    space: { ...s.space },
    terrain: {
      widthPx: s.terrain.widthPx,
      heightPx: s.terrain.heightPx,
      mask: new Uint8Array(s.terrain.mask),
      height: new Uint8Array(s.terrain.height),
      cover: new Uint8Array(s.terrain.cover)
    },
    objects: s.objects.map((o) => cloneMapObject(o))
  };
}

function applyResizeSnapshot(doc: MapDocument, snap: CanvasResizeSnapshot): void {
  doc.manifest.page = { ...snap.page };
  doc.manifest.space = { ...snap.space };
  doc.manifest.terrain.widthPx = snap.terrain.widthPx;
  doc.manifest.terrain.heightPx = snap.terrain.heightPx;
  doc.terrain = {
    widthPx: snap.terrain.widthPx,
    heightPx: snap.terrain.heightPx,
    mask: new Uint8Array(snap.terrain.mask),
    height: new Uint8Array(snap.terrain.height),
    cover: new Uint8Array(snap.terrain.cover)
  };
  doc.manifest.objects = snap.objects.map((o) => cloneMapObject(o));
}

export class ResizeCanvasCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'resize-canvas';
  readonly label: string;
  readonly byteSize: number;
  readonly affectsTerrain = true;
  private readonly before: CanvasResizeSnapshot;
  private readonly after: CanvasResizeSnapshot;

  constructor(before: CanvasResizeSnapshot, after: CanvasResizeSnapshot, label = 'Ridimensiona tela') {
    this.before = cloneResizeSnapshot(before);
    this.after = cloneResizeSnapshot(after);
    this.label = label;
    this.byteSize =
      before.terrain.mask.byteLength * 3 + after.terrain.mask.byteLength * 3;
  }

  apply(doc: MapDocument): void {
    applyResizeSnapshot(doc, this.after);
  }

  revert(doc: MapDocument): void {
    applyResizeSnapshot(doc, this.before);
  }
}

export class AddLayerCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'add-layer';
  readonly label: string;
  readonly byteSize = 512;
  readonly affectsTerrain = false;
  private readonly layer: MapLayer;
  private readonly insertIndex?: number;

  constructor(layer: MapLayer, insertIndex?: number, label = 'Aggiungi livello') {
    this.layer = cloneMapLayer(layer);
    this.insertIndex = insertIndex;
    this.label = label;
  }

  apply(doc: MapDocument): void {
    if (doc.manifest.layers.some((l) => l.id === this.layer.id)) return;
    const idx =
      this.insertIndex === undefined
        ? doc.manifest.layers.length
        : Math.max(1, Math.min(doc.manifest.layers.length, this.insertIndex));
    doc.manifest.layers.splice(idx, 0, cloneMapLayer(this.layer));
  }

  revert(doc: MapDocument): void {
    const idx = doc.manifest.layers.findIndex((l) => l.id === this.layer.id);
    if (idx >= 0) {
      doc.manifest.layers.splice(idx, 1);
    }
  }
}

export class UpdateLayerCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'update-layer';
  readonly label: string;
  readonly byteSize = 512;
  readonly affectsTerrain = false;
  private readonly prevLayer: MapLayer;
  private readonly nextLayer: MapLayer;

  constructor(prevLayer: MapLayer, nextLayer: MapLayer, label = 'Modifica livello') {
    this.prevLayer = cloneMapLayer(prevLayer);
    this.nextLayer = cloneMapLayer(nextLayer);
    this.label = label;
  }

  apply(doc: MapDocument): void {
    const idx = doc.manifest.layers.findIndex((l) => l.id === this.prevLayer.id);
    if (idx >= 0) {
      doc.manifest.layers[idx] = cloneMapLayer(this.nextLayer);
    }
  }

  revert(doc: MapDocument): void {
    const idx = doc.manifest.layers.findIndex((l) => l.id === this.nextLayer.id);
    if (idx >= 0) {
      doc.manifest.layers[idx] = cloneMapLayer(this.prevLayer);
    }
  }
}

export class DeleteLayerCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'delete-layer';
  readonly label: string;
  readonly byteSize = 2048;
  readonly affectsTerrain = false;
  private readonly layerId: string;
  private readonly fallbackLayerId?: string;
  private prevLayersSnapshot: MapLayer[] = [];
  private prevObjectsSnapshot: MapObject[] = [];

  constructor(layerId: string, options: { fallbackLayerId?: string; label?: string } = {}) {
    this.layerId = layerId;
    this.fallbackLayerId = options.fallbackLayerId;
    this.label = options.label ?? 'Elimina livello';
  }

  apply(doc: MapDocument): void {
    const idx = doc.manifest.layers.findIndex((l) => l.id === this.layerId);
    if (idx < 0 || doc.manifest.layers[idx].kind === 'terrain' || doc.manifest.layers.length <= 1) {
      return;
    }
    this.prevLayersSnapshot = doc.manifest.layers.map(cloneMapLayer);
    this.prevObjectsSnapshot = doc.manifest.objects.map(cloneMapObject);

    doc.manifest.layers.splice(idx, 1);
    if (this.fallbackLayerId && doc.manifest.layers.some((l) => l.id === this.fallbackLayerId)) {
      for (const obj of doc.manifest.objects) {
        if (obj.layerId === this.layerId) {
          obj.layerId = this.fallbackLayerId;
        }
      }
    } else {
      doc.manifest.objects = doc.manifest.objects.filter((obj) => obj.layerId !== this.layerId);
    }
  }

  revert(doc: MapDocument): void {
    if (this.prevLayersSnapshot.length === 0) return;
    doc.manifest.layers = this.prevLayersSnapshot.map(cloneMapLayer);
    doc.manifest.objects = this.prevObjectsSnapshot.map(cloneMapObject);
  }
}

export class ReorderLayersCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'reorder-layers';
  readonly label: string;
  readonly byteSize = 1024;
  readonly affectsTerrain = false;
  private readonly prevOrder: MapLayer[];
  private readonly nextOrder: MapLayer[];

  constructor(prevOrder: readonly MapLayer[], nextOrder: readonly MapLayer[], label = 'Riordina livelli') {
    this.prevOrder = prevOrder.map(cloneMapLayer);
    this.nextOrder = nextOrder.map(cloneMapLayer);
    this.label = label;
  }

  apply(doc: MapDocument): void {
    doc.manifest.layers = this.nextOrder.map(cloneMapLayer);
  }

  revert(doc: MapDocument): void {
    doc.manifest.layers = this.prevOrder.map(cloneMapLayer);
  }
}
