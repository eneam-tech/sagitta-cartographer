import { useSyncExternalStore } from 'react';
import {
  CameraState,
  clampNumber,
  docDistToMaskPxX,
  docDistToMaskPxY,
  docToMaskX,
  docToMaskY,
  fitCameraToViewport,
  zoomAtPoint
} from '../model/coordinates';
import {
  DirtyRectPx,
  HistoryCommand,
  SetThemeCommand,
  SetTitleCommand,
  TerrainPatchCommand,
  TerrainTilePatch
} from '../model/commands';
import {
  COVER_FIELDS,
  COVER_FOREST,
  COVER_NATURAL,
  CoverToolId,
  CreateEmptyDocumentOptions,
  DEFAULT_LAYER_LABELS_ID,
  DEFAULT_LAYER_POI_ID,
  DEFAULT_LAYER_TERRAIN_ID,
  DEFAULT_LAYER_VECTORS_ID,
  MapDocument,
  PathKind,
  createEmptyDocument,
  defaultLayerIdForObject
} from '../model/document';
import { HistoryManager } from '../model/history';
import { MapTheme } from '../theme/theme';
import {
  ArchiveImportResult,
  IPersistenceService,
  PersistenceState,
  SavedProjectSummary
} from '../persistence/types';
import {
  BrushStrokeParams,
  ITerrainRenderer,
  ITerrainStrokeSession,
  StrokeCommitResult,
  TerrainBrushTool
} from '../terrain/types';

export type EditorTool =
  | 'hand'
  | 'select'
  | TerrainBrushTool
  | 'path'
  | 'poi'
  | 'label';

export type ElevationSubTool = 'raise' | 'lower' | 'flatten' | 'smooth';
export type CoverSubTool = CoverToolId;

export type EditorDialogKind =
  | 'newProject'
  | 'openProject'
  | 'exportPdf'
  | 'resizeCanvas'
  | 'shortcuts'
  | 'conflict'
  | 'storageError'
  | null;

export interface EditorStatusNotice {
  tone: 'info' | 'error' | 'success';
  text: string;
}

export interface CursorDocPoint {
  x: number;
  y: number;
}

export const MIN_BRUSH_DIAMETER_DOC = 10;
export const MAX_BRUSH_DIAMETER_DOC = 400;
export const DEFAULT_BRUSH_DIAMETER_DOC = 80;
export const MIN_BRUSH_INTENSITY = 0.05;
export const MAX_BRUSH_INTENSITY = 1.0;
export const DEFAULT_BRUSH_INTENSITY = 0.45;
export const MIN_CAMERA_SCALE = 0.08;
export const MAX_CAMERA_SCALE = 12;

export function isTerrainBrushTool(tool: EditorTool): tool is TerrainBrushTool {
  return (
    tool === 'land' ||
    tool === 'water' ||
    tool === 'raise' ||
    tool === 'lower' ||
    tool === 'flatten' ||
    tool === 'smooth' ||
    tool === 'forest' ||
    tool === 'fields' ||
    tool === 'sand' ||
    tool === 'brick' ||
    tool === 'snow' ||
    tool === 'swamp' ||
    tool === 'rock' ||
    tool === 'meadow' ||
    tool === 'lava' ||
    tool === 'natural'
  );
}

export function isLandRequiredBrush(tool: EditorTool): boolean {
  return (
    tool === 'raise' ||
    tool === 'lower' ||
    tool === 'flatten' ||
    tool === 'smooth' ||
    tool === 'forest' ||
    tool === 'fields' ||
    tool === 'sand' ||
    tool === 'brick' ||
    tool === 'snow' ||
    tool === 'swamp' ||
    tool === 'rock' ||
    tool === 'meadow' ||
    tool === 'lava' ||
    tool === 'natural'
  );
}

export function computeHasLand(doc: MapDocument): boolean {
  const { mask } = doc.terrain;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] > 0) return true;
  }
  return false;
}

export function isBrushSeaOnly(
  doc: MapDocument,
  docX: number,
  docY: number,
  diameterDoc: number
): boolean {
  const { space, terrain } = doc.manifest;
  if (docX < 0 || docY < 0 || docX > space.width || docY > space.height) {
    return false;
  }
  const { widthPx, heightPx, mask } = doc.terrain;
  if (widthPx <= 0 || heightPx <= 0 || mask.length === 0) return false;

  const cx = docToMaskX(docX, space, terrain);
  const cy = docToMaskY(docY, space, terrain);
  const rx = Math.max(0.5, docDistToMaskPxX(diameterDoc / 2, space, terrain));
  const ry = Math.max(0.5, docDistToMaskPxY(diameterDoc / 2, space, terrain));

  const minX = Math.max(0, Math.floor(cx - rx));
  const maxX = Math.min(widthPx - 1, Math.ceil(cx + rx));
  const minY = Math.max(0, Math.floor(cy - ry));
  const maxY = Math.min(heightPx - 1, Math.ceil(cy + ry));
  if (minX > maxX || minY > maxY) return false;

  const stepX = Math.max(1, Math.floor((maxX - minX) / 8));
  const stepY = Math.max(1, Math.floor((maxY - minY) / 8));

  const centerPxX = clampNumber(Math.round(cx), 0, widthPx - 1);
  const centerPxY = clampNumber(Math.round(cy), 0, heightPx - 1);
  if (mask[centerPxY * widthPx + centerPxX] > 0) {
    return false;
  }

  for (let y = minY; y <= maxY; y += stepY) {
    const dy = (y - cy) / ry;
    for (let x = minX; x <= maxX; x += stepX) {
      const dx = (x - cx) / rx;
      if (dx * dx + dy * dy <= 1.0) {
        if (mask[y * widthPx + x] > 0) {
          return false;
        }
      }
    }
  }
  return true;
}

function isEditableElement(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const node = el as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
    closest?: (selector: string) => unknown;
  };
  const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (node.isContentEditable === true) {
    return true;
  }
  if (typeof node.getAttribute === 'function') {
    const attr = node.getAttribute('contenteditable');
    if (attr === '' || attr === 'true' || attr === 'plaintext-only') {
      return true;
    }
  }
  if (typeof node.closest === 'function') {
    if (node.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')) {
      return true;
    }
  }
  return false;
}

export function shouldIgnoreShortcut(target: EventTarget | null): boolean {
  if (isEditableElement(target)) return true;
  if (typeof document !== 'undefined' && isEditableElement(document.activeElement)) {
    return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Fallback leggeri per isolamento o integrazione progressiva                */
/* -------------------------------------------------------------------------- */

const FALLBACK_TILE_SIZE = 64;

interface FallbackTileSnapshot {
  tx: number;
  ty: number;
  x: number;
  y: number;
  width: number;
  height: number;
  beforeMask: Uint8Array;
  beforeHeight: Uint8Array;
  beforeCover: Uint8Array;
}

const TOOL_LABELS: Record<TerrainBrushTool, string> = {
  land: 'Pennellata Terra',
  water: 'Pennellata Acqua',
  raise: 'Alza rilievo',
  lower: 'Abbassa rilievo',
  flatten: 'Appiattisci rilievo',
  smooth: 'Ammorbidisci rilievo',
  forest: 'Copertura Foresta',
  fields: 'Copertura Campi',
  sand: 'Copertura Sabbia',
  brick: 'Copertura Mattoni',
  snow: 'Copertura Neve',
  swamp: 'Copertura Palude',
  rock: 'Copertura Roccia',
  meadow: 'Copertura Prateria',
  lava: 'Copertura Lava',
  natural: 'Copertura Naturale'
};

export class FallbackTerrainStrokeSession implements ITerrainStrokeSession {
  private active = false;
  private params: BrushStrokeParams | null = null;
  private lastDocX = 0;
  private lastDocY = 0;
  private tiles = new Map<string, FallbackTileSnapshot>();
  private dirtyRect: DirtyRectPx | null = null;

  isActive(): boolean {
    return this.active;
  }

  beginStroke(doc: MapDocument, params: BrushStrokeParams, startDocX: number, startDocY: number): DirtyRectPx | null {
    this.active = true;
    this.params = { ...params };
    this.lastDocX = startDocX;
    this.lastDocY = startDocY;
    this.tiles.clear();
    this.dirtyRect = null;
    return this.stampCircle(doc, startDocX, startDocY);
  }

  addPoint(doc: MapDocument, docX: number, docY: number): DirtyRectPx | null {
    if (!this.active || !this.params) return null;
    const dx = docX - this.lastDocX;
    const dy = docY - this.lastDocY;
    const dist = Math.hypot(dx, dy);
    const stepDoc = Math.max(1, this.params.diameterDoc * 0.14);
    const steps = Math.max(1, Math.ceil(dist / stepDoc));

    let combined: DirtyRectPx | null = null;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const px = this.lastDocX + dx * t;
      const py = this.lastDocY + dy * t;
      const rect = this.stampCircle(doc, px, py);
      if (rect) {
        combined = combined ? mergeRects(combined, rect) : rect;
      }
    }
    this.lastDocX = docX;
    this.lastDocY = docY;
    return combined;
  }

  commit(doc: MapDocument): StrokeCommitResult | null {
    if (!this.active || !this.params) return null;
    const params = this.params;
    const patches: TerrainTilePatch[] = [];
    const { widthPx, mask, height, cover } = doc.terrain;

    for (const tile of this.tiles.values()) {
      const len = tile.width * tile.height;
      const afterMask = new Uint8Array(len);
      const afterHeight = new Uint8Array(len);
      const afterCover = new Uint8Array(len);
      let changed = false;

      for (let row = 0; row < tile.height; row += 1) {
        const srcStart = (tile.y + row) * widthPx + tile.x;
        const dstStart = row * tile.width;
        afterMask.set(mask.subarray(srcStart, srcStart + tile.width), dstStart);
        afterHeight.set(height.subarray(srcStart, srcStart + tile.width), dstStart);
        afterCover.set(cover.subarray(srcStart, srcStart + tile.width), dstStart);
      }

      for (let i = 0; i < len; i += 1) {
        if (
          afterMask[i] !== tile.beforeMask[i] ||
          afterHeight[i] !== tile.beforeHeight[i] ||
          afterCover[i] !== tile.beforeCover[i]
        ) {
          changed = true;
          break;
        }
      }

      if (changed) {
        patches.push({
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
          beforeMask: tile.beforeMask,
          afterMask,
          beforeHeight: tile.beforeHeight,
          afterHeight,
          beforeCover: tile.beforeCover,
          afterCover
        });
      }
    }

    const dirtyRect = this.dirtyRect;
    this.reset();
    if (patches.length === 0 || !dirtyRect) return null;

    return {
      command: new TerrainPatchCommand(TOOL_LABELS[params.tool], dirtyRect, patches),
      dirtyRect
    };
  }

  cancel(doc: MapDocument): DirtyRectPx | null {
    if (!this.active) return null;
    const { widthPx, mask, height, cover } = doc.terrain;
    for (const tile of this.tiles.values()) {
      for (let row = 0; row < tile.height; row += 1) {
        const dstStart = (tile.y + row) * widthPx + tile.x;
        const srcStart = row * tile.width;
        mask.set(tile.beforeMask.subarray(srcStart, srcStart + tile.width), dstStart);
        height.set(tile.beforeHeight.subarray(srcStart, srcStart + tile.width), dstStart);
        cover.set(tile.beforeCover.subarray(srcStart, srcStart + tile.width), dstStart);
      }
    }
    const dirtyRect = this.dirtyRect;
    this.reset();
    return dirtyRect;
  }

  private reset(): void {
    this.active = false;
    this.params = null;
    this.tiles.clear();
    this.dirtyRect = null;
  }

  private ensureTile(doc: MapDocument, tx: number, ty: number): void {
    const key = `${tx},${ty}`;
    if (this.tiles.has(key)) return;

    const x = tx * FALLBACK_TILE_SIZE;
    const y = ty * FALLBACK_TILE_SIZE;
    const width = Math.min(FALLBACK_TILE_SIZE, doc.terrain.widthPx - x);
    const height = Math.min(FALLBACK_TILE_SIZE, doc.terrain.heightPx - y);
    if (width <= 0 || height <= 0) return;

    const len = width * height;
    const beforeMask = new Uint8Array(len);
    const beforeHeight = new Uint8Array(len);
    const beforeCover = new Uint8Array(len);

    const { widthPx, mask, height: hBuf, cover } = doc.terrain;
    for (let row = 0; row < height; row += 1) {
      const srcStart = (y + row) * widthPx + x;
      const dstStart = row * width;
      beforeMask.set(mask.subarray(srcStart, srcStart + width), dstStart);
      beforeHeight.set(hBuf.subarray(srcStart, srcStart + width), dstStart);
      beforeCover.set(cover.subarray(srcStart, srcStart + width), dstStart);
    }

    this.tiles.set(key, {
      tx,
      ty,
      x,
      y,
      width,
      height,
      beforeMask,
      beforeHeight,
      beforeCover
    });
  }

  private stampCircle(doc: MapDocument, docX: number, docY: number): DirtyRectPx | null {
    if (!this.params) return null;
    const { space, terrain } = doc.manifest;
    const cx = docToMaskX(docX, space, terrain);
    const cy = docToMaskY(docY, space, terrain);
    const rx = Math.max(0.5, docDistToMaskPxX(this.params.diameterDoc / 2, space, terrain));
    const ry = Math.max(0.5, docDistToMaskPxY(this.params.diameterDoc / 2, space, terrain));

    const minX = Math.max(0, Math.floor(cx - rx));
    const maxX = Math.min(doc.terrain.widthPx - 1, Math.ceil(cx + rx));
    const minY = Math.max(0, Math.floor(cy - ry));
    const maxY = Math.min(doc.terrain.heightPx - 1, Math.ceil(cy + ry));
    if (minX > maxX || minY > maxY) return null;

    const minTx = Math.floor(minX / FALLBACK_TILE_SIZE);
    const maxTx = Math.floor(maxX / FALLBACK_TILE_SIZE);
    const minTy = Math.floor(minY / FALLBACK_TILE_SIZE);
    const maxTy = Math.floor(maxY / FALLBACK_TILE_SIZE);
    for (let ty = minTy; ty <= maxTy; ty += 1) {
      for (let tx = minTx; tx <= maxTx; tx += 1) {
        this.ensureTile(doc, tx, ty);
      }
    }

    const { widthPx, mask, height, cover } = doc.terrain;
    const tool = this.params.tool;
    const deltaMax = Math.max(1, Math.round(this.params.intensity * 20));

    for (let y = minY; y <= maxY; y += 1) {
      const dy = (y - cy) / ry;
      for (let x = minX; x <= maxX; x += 1) {
        const dx = (x - cx) / rx;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1.0) continue;

        const idx = y * widthPx + x;
        const falloff = Math.max(0, 1 - Math.sqrt(d2));

        if (tool === 'land') {
          mask[idx] = 255;
        } else if (tool === 'water') {
          mask[idx] = 0;
          height[idx] = 0;
          cover[idx] = COVER_NATURAL;
        } else if (mask[idx] > 0) {
          if (tool === 'raise') {
            height[idx] = Math.min(255, height[idx] + Math.max(1, Math.round(deltaMax * falloff)));
          } else if (tool === 'lower') {
            height[idx] = Math.max(0, height[idx] - Math.max(1, Math.round(deltaMax * falloff)));
          } else if (tool === 'forest') {
            cover[idx] = COVER_FOREST;
          } else if (tool === 'fields') {
            cover[idx] = COVER_FIELDS;
          } else if (tool === 'natural') {
            cover[idx] = COVER_NATURAL;
          }
        }
      }
    }

    const rect: DirtyRectPx = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };
    this.dirtyRect = this.dirtyRect ? mergeRects(this.dirtyRect, rect) : rect;
    return rect;
  }
}

function mergeRects(a: DirtyRectPx, b: DirtyRectPx): DirtyRectPx {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [168, 200, 198];
  const n = Number.parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class FallbackTerrainRenderer implements ITerrainRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;

  renderFull(doc: MapDocument): void {
    this.renderRegion(doc, {
      x: 0,
      y: 0,
      width: doc.terrain.widthPx,
      height: doc.terrain.heightPx
    });
  }

  renderRegion(doc: MapDocument, dirtyRect: DirtyRectPx): void {
    if (typeof document === 'undefined') return;
    const { widthPx, heightPx, mask, height: elev, cover } = doc.terrain;
    if (!this.canvas || this.width !== widthPx || this.height !== heightPx) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = widthPx;
      this.canvas.height = heightPx;
      this.ctx = this.canvas.getContext('2d');
      this.width = widthPx;
      this.height = heightPx;
    }
    if (!this.ctx) return;

    const x0 = Math.max(0, dirtyRect.x);
    const y0 = Math.max(0, dirtyRect.y);
    const x1 = Math.min(widthPx, dirtyRect.x + dirtyRect.width);
    const y1 = Math.min(heightPx, dirtyRect.y + dirtyRect.height);
    const rw = x1 - x0;
    const rh = y1 - y0;
    if (rw <= 0 || rh <= 0) return;

    const imgData = this.ctx.createImageData(rw, rh);
    const data = imgData.data;

    const seaRgb = hexToRgb(doc.theme.colors.sea);
    const beachRgb = hexToRgb(doc.theme.colors.beach);
    const landRgb = hexToRgb(doc.theme.colors.land);
    const hillRgb = hexToRgb(doc.theme.colors.hill);
    const mountainRgb = hexToRgb(doc.theme.colors.mountain);
    const forestRgb = hexToRgb(doc.theme.colors.forest);
    const fieldsRgb = hexToRgb(doc.theme.colors.fields);

    for (let row = 0; row < rh; row += 1) {
      const sy = y0 + row;
      for (let col = 0; col < rw; col += 1) {
        const sx = x0 + col;
        const srcIdx = sy * widthPx + sx;
        const dstIdx = (row * rw + col) * 4;

        if (mask[srcIdx] === 0) {
          data[dstIdx] = seaRgb[0];
          data[dstIdx + 1] = seaRgb[1];
          data[dstIdx + 2] = seaRgb[2];
          data[dstIdx + 3] = 255;
          continue;
        }

        const h = elev[srcIdx];
        let rgb = landRgb;
        if (h <= doc.theme.elevation.beachMaxHeight) {
          rgb = beachRgb;
        } else if (h > doc.theme.elevation.hillMaxHeight) {
          rgb = mountainRgb;
        } else if (h > doc.theme.elevation.plainMaxHeight) {
          rgb = hillRgb;
        }

        const cov = cover[srcIdx];
        if (cov === COVER_FOREST) {
          rgb = [
            Math.round(rgb[0] * 0.45 + forestRgb[0] * 0.55),
            Math.round(rgb[1] * 0.45 + forestRgb[1] * 0.55),
            Math.round(rgb[2] * 0.45 + forestRgb[2] * 0.55)
          ];
        } else if (cov === COVER_FIELDS) {
          rgb = [
            Math.round(rgb[0] * 0.4 + fieldsRgb[0] * 0.6),
            Math.round(rgb[1] * 0.4 + fieldsRgb[1] * 0.6),
            Math.round(rgb[2] * 0.4 + fieldsRgb[2] * 0.6)
          ];
        }

        data[dstIdx] = rgb[0];
        data[dstIdx + 1] = rgb[1];
        data[dstIdx + 2] = rgb[2];
        data[dstIdx + 3] = 255;
      }
    }

    this.ctx.putImageData(imgData, x0, y0);
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  getPixelData(): { width: number; height: number; rgba: Uint8ClampedArray } {
    if (!this.ctx || !this.canvas) {
      return { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };
    }
    const img = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    return { width: this.canvas.width, height: this.canvas.height, rgba: img.data };
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
  }
}

export class FallbackPersistenceService implements IPersistenceService {
  private state: PersistenceState = { status: 'idle', savedRevision: 0 };
  private listeners = new Set<(state: PersistenceState) => void>();
  private projects = new Map<string, { document: MapDocument; extraAssetBlobs: Map<string, Blob>; updatedAt: number }>();

  subscribe(listener: (state: PersistenceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): PersistenceState {
    return this.state;
  }

  scheduleSave(doc: MapDocument, extraAssets?: Map<string, Blob>): void {
    void this.flushNow(doc, extraAssets);
  }

  async flushNow(doc: MapDocument, extraAssets?: Map<string, Blob>): Promise<void> {
    this.projects.set(doc.manifest.id, {
      document: doc,
      extraAssetBlobs: extraAssets ? new Map(extraAssets) : new Map(),
      updatedAt: Date.now()
    });
    this.state = {
      status: 'saved',
      savedRevision: doc.manifest.revision
    };
    this.emit();
  }

  async loadProject(id: string): Promise<{ document: MapDocument; extraAssetBlobs: Map<string, Blob> } | null> {
    const found = this.projects.get(id);
    return found ? { document: found.document, extraAssetBlobs: found.extraAssetBlobs } : null;
  }

  async listProjects(): Promise<SavedProjectSummary[]> {
    return Array.from(this.projects.values())
      .map((entry) => ({
        id: entry.document.manifest.id,
        title: entry.document.manifest.title,
        revision: entry.document.manifest.revision,
        updatedAt: entry.updatedAt,
        page: { ...entry.document.manifest.page }
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
  }

  async saveAsCopy(doc: MapDocument, extraAssets?: Map<string, Blob>): Promise<MapDocument> {
    const copy = createEmptyDocument({
      title: `${doc.manifest.title} (copia)`,
      page: { ...doc.manifest.page },
      widthPx: doc.terrain.widthPx,
      heightPx: doc.terrain.heightPx,
      seed: doc.manifest.terrain.seed,
      theme: doc.theme,
      assets: doc.manifest.assets
    });
    copy.terrain.mask.set(doc.terrain.mask);
    copy.terrain.height.set(doc.terrain.height);
    copy.terrain.cover.set(doc.terrain.cover);
    copy.manifest.objects = doc.manifest.objects.map((o) => ({ ...o }));
    copy.manifest.revision = 1;
    await this.flushNow(copy, extraAssets);
    return copy;
  }

  async exportArchive(doc: MapDocument): Promise<Uint8Array> {
    return new TextEncoder().encode(JSON.stringify(doc.manifest));
  }

  async importArchive(): Promise<ArchiveImportResult> {
    throw new Error('Servizio di importazione archivio non collegato.');
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* EditorStore                                                                */
/* -------------------------------------------------------------------------- */

export interface EditorStoreOptions {
  initialDocument?: MapDocument;
  initialExtraAssets?: Map<string, Blob>;
  strokeSession?: ITerrainStrokeSession;
  renderer?: ITerrainRenderer;
  persistence?: IPersistenceService;
  maxHistoryBytes?: number;
}

export type InspectorTab = 'tool' | 'layers' | 'objects';
export type PoiBrushMode = 'single' | 'scatter';

export interface EditorSnapshot {
  doc: MapDocument;
  activeTool: EditorTool;
  lastElevationTool: ElevationSubTool;
  lastCoverTool: CoverSubTool;
  brushDiameterDoc: number;
  brushIntensity: number;
  inspectorTab: InspectorTab;
  activeLayerId: string;
  poiPlacementScale: number;
  poiBrushMode: PoiBrushMode;
  poiScatterRadiusDoc: number;
  poiScatterDensity: number;
  pathKind: PathKind;
  pathStrokeWidthDoc: number;
  pathColor: string;
  pathSmooth: boolean;
  pathDashed: boolean;
  pathTapered: boolean;
  camera: CameraState;
  viewportSize: { width: number; height: number };
  hasInitialFit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  nextUndoLabel?: string;
  nextRedoLabel?: string;
  selectedObjectId: string | null;
  activePoiId: string | null;
  hasLand: boolean;
  spacePanActive: boolean;
  seaOnlyHintVisible: boolean;
  activeDialog: EditorDialogKind;
  propertiesDrawerOpen: boolean;
  persistenceState: PersistenceState;
  statusNotice: EditorStatusNotice | null;
  terrainRenderTick: number;
  documentVersionTick: number;
}

export class EditorStore {
  private doc: MapDocument;
  private extraAssetBlobs: Map<string, Blob>;
  private readonly history: HistoryManager;
  private readonly strokeSession: ITerrainStrokeSession;
  private readonly renderer: ITerrainRenderer;
  private readonly persistence: IPersistenceService;
  private unsubPersistence: (() => void) | null = null;

  private activeTool: EditorTool = 'land';
  private lastElevationTool: ElevationSubTool = 'raise';
  private lastCoverTool: CoverSubTool = 'forest';
  private brushDiameterDoc = DEFAULT_BRUSH_DIAMETER_DOC;
  private brushIntensity = DEFAULT_BRUSH_INTENSITY;

  private inspectorTab: InspectorTab = 'tool';
  private activeLayerId = DEFAULT_LAYER_TERRAIN_ID;
  private poiPlacementScale = 1.0;
  private poiBrushMode: PoiBrushMode = 'single';
  private poiScatterRadiusDoc = 140;
  private poiScatterDensity = 4;
  private pathKind: PathKind = 'river';
  private pathStrokeWidthDoc = 14;
  private pathColor: string;
  private pathSmooth = true;
  private pathDashed = false;
  private pathTapered = true;

  private camera: CameraState = { offsetX: 0, offsetY: 0, scale: 1 };
  private viewportSize = { width: 0, height: 0 };
  private hasInitialFit = false;

  private selectedObjectId: string | null = null;
  private activePoiId: string | null = null;
  private hasLand = false;
  private spacePanActive = false;
  private seaOnlyHintVisible = false;
  private activeDialog: EditorDialogKind = null;
  private propertiesDrawerOpen = false;
  private persistenceState: PersistenceState;
  private statusNotice: EditorStatusNotice | null = null;
  private terrainRenderTick = 0;
  private documentVersionTick = 0;
  private lastAlertedStatus: PersistenceState['status'] = 'idle';

  private listeners = new Set<() => void>();
  private terrainRedrawListeners = new Set<() => void>();
  private cursorListeners = new Set<() => void>();
  private cursorDoc: CursorDocPoint | null = null;
  private snapshot: EditorSnapshot;

  constructor(options: EditorStoreOptions = {}) {
    this.doc = options.initialDocument ?? createEmptyDocument();
    this.extraAssetBlobs = options.initialExtraAssets ? new Map(options.initialExtraAssets) : new Map();
    this.pathColor = this.doc.theme.colors.pathRiver;
    this.ensureValidActiveLayer();
    this.history = new HistoryManager(options.maxHistoryBytes);
    this.strokeSession = options.strokeSession ?? new FallbackTerrainStrokeSession();
    this.renderer = options.renderer ?? new FallbackTerrainRenderer();
    this.persistence = options.persistence ?? new FallbackPersistenceService();
    this.persistenceState = this.persistence.getState();
    this.hasLand = computeHasLand(this.doc);

    this.renderer.renderFull(this.doc);
    this.terrainRenderTick = 1;

    this.snapshot = this.buildSnapshot();

    this.unsubPersistence = this.persistence.subscribe((nextState) => {
      const prevStatus = this.lastAlertedStatus;
      this.persistenceState = nextState;
      this.lastAlertedStatus = nextState.status;

      if (nextState.status === 'conflict' && prevStatus !== 'conflict') {
        this.activeDialog = 'conflict';
      } else if (nextState.status === 'error' && prevStatus !== 'error') {
        const msg = nextState.errorMessage?.toLowerCase() ?? '';
        if (msg.includes('spazio') || msg.includes('quota')) {
          this.activeDialog = 'storageError';
        }
      }
      this.notify();
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeTerrainRedraw = (listener: () => void): (() => void) => {
    this.terrainRedrawListeners.add(listener);
    return () => {
      this.terrainRedrawListeners.delete(listener);
    };
  };

  subscribeCursor = (listener: () => void): (() => void) => {
    this.cursorListeners.add(listener);
    return () => {
      this.cursorListeners.delete(listener);
    };
  };

  getCursorDoc = (): CursorDocPoint | null => {
    return this.cursorDoc;
  };

  setCursorDoc(point: CursorDocPoint | null): void {
    if (!point) {
      if (this.cursorDoc === null) return;
      this.cursorDoc = null;
      for (const listener of this.cursorListeners) {
        listener();
      }
      return;
    }
    const nextX = Math.round(point.x);
    const nextY = Math.round(point.y);
    if (
      this.cursorDoc &&
      Math.round(this.cursorDoc.x) === nextX &&
      Math.round(this.cursorDoc.y) === nextY
    ) {
      return;
    }
    this.cursorDoc = { x: point.x, y: point.y };
    for (const listener of this.cursorListeners) {
      listener();
    }
  }

  getSnapshot = (): EditorSnapshot => {
    return this.snapshot;
  };

  getDocument(): MapDocument {
    return this.doc;
  }

  getRenderer(): ITerrainRenderer {
    return this.renderer;
  }

  getStrokeSession(): ITerrainStrokeSession {
    return this.strokeSession;
  }

  getPersistence(): IPersistenceService {
    return this.persistence;
  }

  getExtraAssetBlobs(): Map<string, Blob> {
    return this.extraAssetBlobs;
  }

  getEffectiveTool(): EditorTool {
    return this.spacePanActive ? 'hand' : this.activeTool;
  }

  /* ---------------------------------------------------------------------- */
  /* Strumenti, pennello e stato UI                                         */
  /* ---------------------------------------------------------------------- */

  setTool(tool: EditorTool): void {
    if (this.strokeSession.isActive()) {
      this.cancelTerrainStroke();
    }
    this.activeTool = tool;
    if (tool === 'raise' || tool === 'lower' || tool === 'flatten' || tool === 'smooth') {
      this.lastElevationTool = tool;
    } else if (
      tool === 'forest' ||
      tool === 'fields' ||
      tool === 'sand' ||
      tool === 'brick' ||
      tool === 'snow' ||
      tool === 'swamp' ||
      tool === 'rock' ||
      tool === 'meadow' ||
      tool === 'lava' ||
      tool === 'natural'
    ) {
      this.lastCoverTool = tool;
    }
    if (!isLandRequiredBrush(tool)) {
      this.seaOnlyHintVisible = false;
    }
    if (tool === 'poi' && this.activePoiId === null) {
      this.activePoiId = 'poi-settlement';
    }

    const layers = this.doc.manifest.layers;
    const currentLayer = layers.find((l) => l.id === this.activeLayerId);
    if (!currentLayer || currentLayer.kind !== 'custom') {
      let semanticId: string | null = null;
      if (isTerrainBrushTool(tool)) {
        semanticId = DEFAULT_LAYER_TERRAIN_ID;
      } else if (tool === 'path') {
        semanticId = DEFAULT_LAYER_VECTORS_ID;
      } else if (tool === 'poi') {
        semanticId = DEFAULT_LAYER_POI_ID;
      } else if (tool === 'label') {
        semanticId = DEFAULT_LAYER_LABELS_ID;
      }
      if (semanticId && layers.some((l) => l.id === semanticId)) {
        this.activeLayerId = semanticId;
      }
    }
    this.notify();
  }

  setInspectorTab(tab: InspectorTab): void {
    if (this.inspectorTab === tab) return;
    this.inspectorTab = tab;
    this.notify();
  }

  setActiveLayerId(layerId: string): void {
    if (!this.doc.manifest.layers.some((l) => l.id === layerId)) return;
    if (this.activeLayerId === layerId) return;
    this.activeLayerId = layerId;
    this.notify();
  }

  private ensureValidActiveLayer(): void {
    const layers = this.doc.manifest.layers;
    if (!layers.some((l) => l.id === this.activeLayerId)) {
      const firstEditable = layers.find((l) => l.kind !== 'terrain') ?? layers[0];
      if (firstEditable) {
        this.activeLayerId = firstEditable.id;
      }
    }
  }

  resolveTargetLayerIdForNewObject(type: 'stamp' | 'label' | 'path'): string {
    const layers = this.doc.manifest.layers;
    const active = layers.find((l) => l.id === this.activeLayerId);
    if (active && active.kind === 'custom') {
      return active.id;
    }
    const preferredId = defaultLayerIdForObject({ type });
    const preferred = layers.find((l) => l.id === preferredId && l.kind !== 'terrain');
    if (preferred) return preferred.id;
    const firstNonTerrain = layers.find((l) => l.kind !== 'terrain');
    return firstNonTerrain ? firstNonTerrain.id : DEFAULT_LAYER_POI_ID;
  }

  isLayerEditable(layerId: string): boolean {
    const layer = this.doc.manifest.layers.find((l) => l.id === layerId);
    if (!layer) return true;
    return layer.visible && !layer.locked;
  }

  isTerrainLayerEditable(): boolean {
    const terrainLayer =
      this.doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_TERRAIN_ID || l.kind === 'terrain');
    if (!terrainLayer) return true;
    return terrainLayer.visible && !terrainLayer.locked;
  }

  setPoiPlacementScale(scale: number): void {
    if (!Number.isFinite(scale)) return;
    const clamped = Math.round(clampNumber(scale, 0.4, 2.5) * 100) / 100;
    if (clamped === this.poiPlacementScale) return;
    this.poiPlacementScale = clamped;
    this.notify();
  }

  setPoiBrushMode(mode: PoiBrushMode): void {
    if (this.poiBrushMode === mode) return;
    this.poiBrushMode = mode;
    this.notify();
  }

  setPoiScatterRadiusDoc(radiusDoc: number): void {
    if (!Number.isFinite(radiusDoc)) return;
    const clamped = Math.round(clampNumber(radiusDoc, 40, 360));
    if (clamped === this.poiScatterRadiusDoc) return;
    this.poiScatterRadiusDoc = clamped;
    this.notify();
  }

  setPoiScatterDensity(density: number): void {
    if (!Number.isFinite(density)) return;
    const clamped = Math.round(clampNumber(density, 2, 8));
    if (clamped === this.poiScatterDensity) return;
    this.poiScatterDensity = clamped;
    this.notify();
  }

  setPathKind(kind: PathKind): void {
    this.pathKind = kind;
    const c = this.doc.theme.colors;
    if (kind === 'river') {
      this.pathStrokeWidthDoc = 14;
      this.pathColor = c.pathRiver;
      this.pathSmooth = true;
      this.pathDashed = false;
      this.pathTapered = true;
    } else if (kind === 'road') {
      this.pathStrokeWidthDoc = 9;
      this.pathColor = c.pathRoad;
      this.pathSmooth = true;
      this.pathDashed = false;
      this.pathTapered = false;
    } else if (kind === 'border') {
      this.pathStrokeWidthDoc = 7;
      this.pathColor = c.pathBorder;
      this.pathSmooth = true;
      this.pathDashed = true;
      this.pathTapered = false;
    } else {
      this.pathStrokeWidthDoc = 6;
      this.pathColor = c.ink;
      this.pathSmooth = true;
      this.pathDashed = false;
      this.pathTapered = false;
    }
    this.notify();
  }

  setPathStrokeWidthDoc(widthDoc: number): void {
    if (!Number.isFinite(widthDoc)) return;
    const clamped = Math.round(clampNumber(widthDoc, 2, 60) * 10) / 10;
    if (clamped === this.pathStrokeWidthDoc) return;
    this.pathStrokeWidthDoc = clamped;
    this.notify();
  }

  setPathColor(color: string): void {
    if (!color || color === this.pathColor) return;
    this.pathColor = color;
    this.notify();
  }

  setPathSmooth(smooth: boolean): void {
    if (this.pathSmooth === smooth) return;
    this.pathSmooth = smooth;
    this.notify();
  }

  setPathDashed(dashed: boolean): void {
    if (this.pathDashed === dashed) return;
    this.pathDashed = dashed;
    this.notify();
  }

  setPathTapered(tapered: boolean): void {
    if (this.pathTapered === tapered) return;
    this.pathTapered = tapered;
    this.notify();
  }

  setTheme(theme: MapTheme): void {
    if (this.doc.theme.id === theme.id && JSON.stringify(this.doc.theme.colors) === JSON.stringify(theme.colors)) {
      return;
    }
    this.executeCommand(new SetThemeCommand(this.doc.theme, theme, this.doc));
  }

  selectElevationGroup(): void {
    this.setTool(this.lastElevationTool);
  }

  selectCoverGroup(): void {
    this.setTool(this.lastCoverTool);
  }

  setBrushDiameter(diameterDoc: number): void {
    if (!Number.isFinite(diameterDoc)) return;
    const clamped = Math.round(clampNumber(diameterDoc, MIN_BRUSH_DIAMETER_DOC, MAX_BRUSH_DIAMETER_DOC));
    if (clamped === this.brushDiameterDoc) return;
    this.brushDiameterDoc = clamped;
    this.notify();
  }

  setBrushIntensity(intensity: number): void {
    if (!Number.isFinite(intensity)) return;
    const clamped = clampNumber(intensity, MIN_BRUSH_INTENSITY, MAX_BRUSH_INTENSITY);
    const rounded = Math.round(clamped * 100) / 100;
    if (rounded === this.brushIntensity) return;
    this.brushIntensity = rounded;
    this.notify();
  }

  setBrushIntensityPercent(percent: number): void {
    if (!Number.isFinite(percent)) return;
    this.setBrushIntensity(percent / 100);
  }

  selectObject(id: string | null): void {
    if (this.selectedObjectId === id) return;
    this.selectedObjectId = id;
    this.notify();
  }

  setActivePoiId(poiId: string | null): void {
    if (this.activePoiId === poiId) return;
    this.activePoiId = poiId;
    if (poiId !== null && this.activeTool !== 'poi') {
      this.activeTool = 'poi';
    }
    this.notify();
  }

  setHasDrawnLand(value: boolean): void {
    if (this.hasLand === value) return;
    this.hasLand = value;
    this.notify();
  }

  setSpacePanActive(active: boolean): void {
    if (this.spacePanActive === active) return;
    this.spacePanActive = active;
    if (active) {
      this.seaOnlyHintVisible = false;
    }
    this.notify();
  }

  updateCursorSeaHint(docX: number, docY: number): void {
    const tool = this.getEffectiveTool();
    const shouldShow =
      isLandRequiredBrush(tool) && isBrushSeaOnly(this.doc, docX, docY, this.brushDiameterDoc);
    if (shouldShow === this.seaOnlyHintVisible) return;
    this.seaOnlyHintVisible = shouldShow;
    this.notify();
  }

  clearCursorSeaHint(): void {
    if (!this.seaOnlyHintVisible) return;
    this.seaOnlyHintVisible = false;
    this.notify();
  }

  openDialog(dialog: Exclude<EditorDialogKind, null>): void {
    if (this.strokeSession.isActive()) {
      this.cancelTerrainStroke();
    }
    this.activeDialog = dialog;
    this.notify();
  }

  closeDialog(): void {
    if (this.activeDialog === null) return;
    this.activeDialog = null;
    this.notify();
  }

  setPropertiesDrawerOpen(open: boolean): void {
    if (this.propertiesDrawerOpen === open) return;
    this.propertiesDrawerOpen = open;
    this.notify();
  }

  togglePropertiesDrawer(): void {
    this.setPropertiesDrawerOpen(!this.propertiesDrawerOpen);
  }

  setStatusNotice(notice: EditorStatusNotice | null): void {
    this.statusNotice = notice;
    this.notify();
  }

  /* ---------------------------------------------------------------------- */
  /* Camera                                                                 */
  /* ---------------------------------------------------------------------- */

  setViewportSize(width: number, height: number): void {
    const safeW = Math.max(0, Math.round(width));
    const safeH = Math.max(0, Math.round(height));
    const sizeChanged = safeW !== this.viewportSize.width || safeH !== this.viewportSize.height;
    this.viewportSize = { width: safeW, height: safeH };

    if (!this.hasInitialFit && safeW > 0 && safeH > 0) {
      this.camera = fitCameraToViewport(this.doc.manifest.space, safeW, safeH, 48);
      this.hasInitialFit = true;
      this.notify();
      return;
    }

    if (sizeChanged) {
      this.notify();
    }
  }

  fitCamera(): void {
    const w = this.viewportSize.width || 960;
    const h = this.viewportSize.height || 640;
    this.camera = fitCameraToViewport(this.doc.manifest.space, w, h, 48);
    this.hasInitialFit = true;
    this.notify();
  }

  setCamera(nextCamera: CameraState): void {
    this.camera = {
      offsetX: nextCamera.offsetX,
      offsetY: nextCamera.offsetY,
      scale: clampNumber(nextCamera.scale, MIN_CAMERA_SCALE, MAX_CAMERA_SCALE)
    };
    this.notify();
  }

  panBy(deltaX: number, deltaY: number): void {
    this.camera = {
      ...this.camera,
      offsetX: this.camera.offsetX + deltaX,
      offsetY: this.camera.offsetY + deltaY
    };
    this.notify();
  }

  zoomAt(cssX: number, cssY: number, requestedScale: number): void {
    this.camera = zoomAtPoint(
      this.camera,
      cssX,
      cssY,
      requestedScale,
      MIN_CAMERA_SCALE,
      MAX_CAMERA_SCALE
    );
    this.notify();
  }

  zoomIn(): void {
    const cx = (this.viewportSize.width || 960) / 2;
    const cy = (this.viewportSize.height || 640) / 2;
    this.zoomAt(cx, cy, this.camera.scale * 1.25);
  }

  zoomOut(): void {
    const cx = (this.viewportSize.width || 960) / 2;
    const cy = (this.viewportSize.height || 640) / 2;
    this.zoomAt(cx, cy, this.camera.scale / 1.25);
  }

  /* ---------------------------------------------------------------------- */
  /* Comandi, Cronologia e Ciclo Pennello                                   */
  /* ---------------------------------------------------------------------- */

  executeCommand(command: HistoryCommand, options: { alreadyApplied?: boolean } = {}): void {
    const result = this.history.execute(this.doc, command, options);
    this.documentVersionTick += 1;

    if (result.command.kind === 'resize-canvas') {
      this.renderer.renderFull(this.doc);
      this.terrainRenderTick += 1;
      this.hasLand = computeHasLand(this.doc);
      this.notifyTerrainRedraw();
      this.fitCamera();
    } else if (result.affectsTerrain) {
      if (result.dirtyRect && options.alreadyApplied !== true) {
        this.renderer.renderRegion(this.doc, result.dirtyRect);
      } else if (!result.dirtyRect && options.alreadyApplied !== true) {
        this.renderer.renderFull(this.doc);
      }
      this.terrainRenderTick += 1;
      this.hasLand = computeHasLand(this.doc);
      this.notifyTerrainRedraw();
    }

    this.ensureValidActiveLayer();
    if (this.selectedObjectId && !this.doc.manifest.objects.some((o) => o.id === this.selectedObjectId)) {
      this.selectedObjectId = null;
    }

    this.persistence.scheduleSave(this.doc, this.extraAssetBlobs);
    this.notify();
  }

  setTitle(nextTitle: string): void {
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === this.doc.manifest.title) return;
    this.executeCommand(new SetTitleCommand(this.doc.manifest.title, trimmed));
  }

  undo(): boolean {
    if (this.strokeSession.isActive()) {
      this.cancelTerrainStroke();
    }
    const result = this.history.undo(this.doc);
    if (!result) return false;

    this.documentVersionTick += 1;
    if (result.command.kind === 'resize-canvas') {
      this.renderer.renderFull(this.doc);
      this.terrainRenderTick += 1;
      this.hasLand = computeHasLand(this.doc);
      this.notifyTerrainRedraw();
      this.fitCamera();
    } else if (result.affectsTerrain) {
      if (result.dirtyRect) {
        this.renderer.renderRegion(this.doc, result.dirtyRect);
      } else {
        this.renderer.renderFull(this.doc);
      }
      this.terrainRenderTick += 1;
      this.hasLand = computeHasLand(this.doc);
      this.notifyTerrainRedraw();
    }
    this.ensureValidActiveLayer();
    if (this.selectedObjectId && !this.doc.manifest.objects.some((o) => o.id === this.selectedObjectId)) {
      this.selectedObjectId = null;
    }
    this.persistence.scheduleSave(this.doc, this.extraAssetBlobs);
    this.notify();
    return true;
  }

  redo(): boolean {
    if (this.strokeSession.isActive()) {
      this.cancelTerrainStroke();
    }
    const result = this.history.redo(this.doc);
    if (!result) return false;

    this.documentVersionTick += 1;
    if (result.command.kind === 'resize-canvas') {
      this.renderer.renderFull(this.doc);
      this.terrainRenderTick += 1;
      this.hasLand = computeHasLand(this.doc);
      this.notifyTerrainRedraw();
      this.fitCamera();
    } else if (result.affectsTerrain) {
      if (result.dirtyRect) {
        this.renderer.renderRegion(this.doc, result.dirtyRect);
      } else {
        this.renderer.renderFull(this.doc);
      }
      this.terrainRenderTick += 1;
      this.hasLand = computeHasLand(this.doc);
      this.notifyTerrainRedraw();
    }
    this.ensureValidActiveLayer();
    if (this.selectedObjectId && !this.doc.manifest.objects.some((o) => o.id === this.selectedObjectId)) {
      this.selectedObjectId = null;
    }
    this.persistence.scheduleSave(this.doc, this.extraAssetBlobs);
    this.notify();
    return true;
  }

  beginTerrainStroke(docX: number, docY: number): boolean {
    const tool = this.getEffectiveTool();
    if (!isTerrainBrushTool(tool)) return false;

    if (!this.isTerrainLayerEditable()) {
      this.statusNotice = {
        tone: 'info',
        text: 'Il livello «Terreno e Rilievo» è bloccato o nascosto.'
      };
      this.notify();
      return false;
    }

    if (tool === 'land' && !this.hasLand) {
      this.hasLand = true;
    }
    if (isLandRequiredBrush(tool) && isBrushSeaOnly(this.doc, docX, docY, this.brushDiameterDoc)) {
      this.seaOnlyHintVisible = true;
    } else {
      this.seaOnlyHintVisible = false;
    }

    const effectiveIntensity =
      tool === 'raise' || tool === 'lower' || tool === 'flatten' || tool === 'smooth'
        ? this.brushIntensity
        : 1.0;

    const dirtyRect = this.strokeSession.beginStroke(
      this.doc,
      {
        tool,
        diameterDoc: this.brushDiameterDoc,
        intensity: effectiveIntensity
      },
      docX,
      docY
    );
    if (dirtyRect) {
      this.renderer.renderRegion(this.doc, dirtyRect);
      this.terrainRenderTick += 1;
      this.notifyTerrainRedraw();
    }
    this.notify();
    return true;
  }

  moveTerrainStroke(docX: number, docY: number): void {
    if (!this.strokeSession.isActive()) return;
    this.updateCursorSeaHint(docX, docY);
    const dirtyRect = this.strokeSession.addPoint(this.doc, docX, docY);
    if (dirtyRect) {
      this.renderer.renderRegion(this.doc, dirtyRect);
      this.terrainRenderTick += 1;
      this.notifyTerrainRedraw();
    }
  }

  commitTerrainStroke(): void {
    if (!this.strokeSession.isActive()) return;
    const result = this.strokeSession.commit(this.doc);
    if (!result) {
      this.hasLand = computeHasLand(this.doc);
      this.notify();
      return;
    }
    this.renderer.renderRegion(this.doc, result.dirtyRect);
    this.terrainRenderTick += 1;
    this.notifyTerrainRedraw();
    this.executeCommand(result.command, { alreadyApplied: true });
  }

  cancelTerrainStroke(): void {
    if (!this.strokeSession.isActive()) return;
    const dirtyRect = this.strokeSession.cancel(this.doc);
    if (dirtyRect) {
      this.renderer.renderRegion(this.doc, dirtyRect);
      this.terrainRenderTick += 1;
      this.notifyTerrainRedraw();
    }
    this.hasLand = computeHasLand(this.doc);
    this.notify();
  }

  /* ---------------------------------------------------------------------- */
  /* Progetti, Persistenza ed Archivio                                      */
  /* ---------------------------------------------------------------------- */

  newProject(options: CreateEmptyDocumentOptions): void {
    const nextDoc = createEmptyDocument(options);
    this.loadDocument(nextDoc);
    this.activeTool = 'land';
    this.activeLayerId = DEFAULT_LAYER_TERRAIN_ID;
    this.ensureValidActiveLayer();
    this.brushDiameterDoc = DEFAULT_BRUSH_DIAMETER_DOC;
    this.brushIntensity = DEFAULT_BRUSH_INTENSITY;
    this.activeDialog = null;
    this.persistence.scheduleSave(this.doc, this.extraAssetBlobs);
    this.notify();
  }

  loadDocument(doc: MapDocument, extraAssets?: Map<string, Blob>): void {
    if (this.strokeSession.isActive()) {
      this.strokeSession.cancel(this.doc);
    }
    this.history.clear();
    this.doc = doc;
    this.extraAssetBlobs = extraAssets ? new Map(extraAssets) : new Map();
    this.selectedObjectId = null;
    this.seaOnlyHintVisible = false;
    this.statusNotice = null;
    this.setCursorDoc(null);
    this.hasLand = computeHasLand(this.doc);
    this.ensureValidActiveLayer();
    if (this.pathKind === 'river') this.pathColor = this.doc.theme.colors.pathRiver;
    else if (this.pathKind === 'road') this.pathColor = this.doc.theme.colors.pathRoad;
    else if (this.pathKind === 'border') this.pathColor = this.doc.theme.colors.pathBorder;
    else this.pathColor = this.doc.theme.colors.ink;
    this.documentVersionTick += 1;
    this.renderer.renderFull(this.doc);
    this.terrainRenderTick += 1;
    this.notifyTerrainRedraw();
    this.hasInitialFit = false;
    if (this.viewportSize.width > 0 && this.viewportSize.height > 0) {
      this.camera = fitCameraToViewport(
        this.doc.manifest.space,
        this.viewportSize.width,
        this.viewportSize.height,
        48
      );
      this.hasInitialFit = true;
    }
    this.notify();
  }

  async listProjects(): Promise<SavedProjectSummary[]> {
    return this.persistence.listProjects();
  }

  async openLocalProject(id: string): Promise<boolean> {
    const loaded = await this.persistence.loadProject(id);
    if (!loaded) {
      this.statusNotice = { tone: 'error', text: 'Impossibile aprire la carta selezionata.' };
      this.notify();
      return false;
    }
    this.loadDocument(loaded.document, loaded.extraAssetBlobs);
    this.activeDialog = null;
    this.notify();
    return true;
  }

  async deleteLocalProject(id: string): Promise<void> {
    await this.persistence.deleteProject(id);
    this.notify();
  }

  async downloadArchive(): Promise<Uint8Array | null> {
    try {
      if (this.strokeSession.isActive()) {
        this.commitTerrainStroke();
      }
      const bytes = await this.persistence.exportArchive(this.doc, this.extraAssetBlobs);
      if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const safeName =
          this.doc.manifest.title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9àèéìòù_-]+/gi, '-')
            .replace(/^-+|-+$/g, '') || 'carta';
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        const blob = new Blob([buffer], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      return bytes;
    } catch (err) {
      this.statusNotice = {
        tone: 'error',
        text:
          err instanceof Error && err.message
            ? err.message
            : 'Errore durante la creazione dell’archivio.'
      };
      this.notify();
      return null;
    }
  }

  async importArchiveFile(bytes: Uint8Array): Promise<ArchiveImportResult | null> {
    try {
      const result = await this.persistence.importArchive(bytes);
      this.loadDocument(result.document, result.extraAssetBlobs);
      this.persistence.scheduleSave(this.doc, this.extraAssetBlobs);
      this.statusNotice = {
        tone: 'success',
        text: result.wasIdRemapped
          ? 'Archivio importato come nuova copia indipendente.'
          : 'Archivio importato correttamente.'
      };
      this.notify();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Archivio non valido o incompleto.';
      this.statusNotice = { tone: 'error', text: message };
      this.notify();
      return null;
    }
  }

  async saveAsCopyOnConflict(): Promise<void> {
    const copy = await this.persistence.saveAsCopy(this.doc, this.extraAssetBlobs);
    this.loadDocument(copy, this.extraAssetBlobs);
    this.activeDialog = null;
    this.statusNotice = { tone: 'success', text: 'Copia indipendente salvata.' };
    this.notify();
  }

  /* ---------------------------------------------------------------------- */
  /* Scorciatoie tastiera unificate                                         */
  /* ---------------------------------------------------------------------- */

  handleKeyDown(e: {
    key: string;
    code?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    target: EventTarget | null;
    preventDefault?: () => void;
  }): boolean {
    if (shouldIgnoreShortcut(e.target)) {
      return false;
    }

    const ctrlOrMeta = Boolean(e.ctrlKey || e.metaKey);

    if (e.key === 'Escape') {
      if (this.strokeSession.isActive()) {
        e.preventDefault?.();
        this.cancelTerrainStroke();
        return true;
      }
      if (this.activeDialog !== null) {
        e.preventDefault?.();
        this.closeDialog();
        return true;
      }
      if (this.propertiesDrawerOpen) {
        e.preventDefault?.();
        this.setPropertiesDrawerOpen(false);
        return true;
      }
      if (this.selectedObjectId !== null) {
        e.preventDefault?.();
        this.selectObject(null);
        return true;
      }
      return false;
    }

    if (this.activeDialog !== null) {
      return false;
    }

    const lower = e.key.toLowerCase();

    if (ctrlOrMeta && !e.altKey) {
      if (lower === 'z' && !e.shiftKey) {
        e.preventDefault?.();
        this.undo();
        return true;
      }
      if ((lower === 'z' && e.shiftKey) || (lower === 'y' && !e.shiftKey)) {
        e.preventDefault?.();
        this.redo();
        return true;
      }
      return false;
    }

    if (e.altKey) return false;

    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault?.();
      this.setSpacePanActive(true);
      return true;
    }

    switch (lower) {
      case 'h':
        this.setTool('hand');
        return true;
      case 'v':
        this.setTool('select');
        return true;
      case 'b':
      case 'l':
        this.setTool('land');
        return true;
      case 'w':
        this.setTool('water');
        return true;
      case 'e':
        this.selectElevationGroup();
        return true;
      case 'c':
        this.selectCoverGroup();
        return true;
      case 'r':
        this.setTool('path');
        return true;
      case 'p':
        this.setTool('poi');
        return true;
      case 't':
        this.setTool('label');
        return true;
      case '[':
        e.preventDefault?.();
        this.setBrushDiameter(Math.round(this.brushDiameterDoc * 0.85));
        return true;
      case ']':
        e.preventDefault?.();
        this.setBrushDiameter(Math.round(this.brushDiameterDoc * 1.15));
        return true;
      case '?':
        e.preventDefault?.();
        this.openDialog('shortcuts');
        return true;
      default:
        return false;
    }
  }

  handleKeyUp(e: { key: string; code?: string }): void {
    if (e.code === 'Space' || e.key === ' ') {
      this.setSpacePanActive(false);
    }
  }

  dispose(): void {
    this.unsubPersistence?.();
    this.unsubPersistence = null;
    this.listeners.clear();
    this.terrainRedrawListeners.clear();
    this.cursorListeners.clear();
  }

  private buildSnapshot(): EditorSnapshot {
    return {
      doc: this.doc,
      activeTool: this.activeTool,
      lastElevationTool: this.lastElevationTool,
      lastCoverTool: this.lastCoverTool,
      brushDiameterDoc: this.brushDiameterDoc,
      brushIntensity: this.brushIntensity,
      inspectorTab: this.inspectorTab,
      activeLayerId: this.activeLayerId,
      poiPlacementScale: this.poiPlacementScale,
      poiBrushMode: this.poiBrushMode,
      poiScatterRadiusDoc: this.poiScatterRadiusDoc,
      poiScatterDensity: this.poiScatterDensity,
      pathKind: this.pathKind,
      pathStrokeWidthDoc: this.pathStrokeWidthDoc,
      pathColor: this.pathColor,
      pathSmooth: this.pathSmooth,
      pathDashed: this.pathDashed,
      pathTapered: this.pathTapered,
      camera: this.camera,
      viewportSize: this.viewportSize,
      hasInitialFit: this.hasInitialFit,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      nextUndoLabel: this.history.nextUndoLabel,
      nextRedoLabel: this.history.nextRedoLabel,
      selectedObjectId: this.selectedObjectId,
      activePoiId: this.activePoiId,
      hasLand: this.hasLand,
      spacePanActive: this.spacePanActive,
      seaOnlyHintVisible: this.seaOnlyHintVisible,
      activeDialog: this.activeDialog,
      propertiesDrawerOpen: this.propertiesDrawerOpen,
      persistenceState: this.persistenceState,
      statusNotice: this.statusNotice,
      terrainRenderTick: this.terrainRenderTick,
      documentVersionTick: this.documentVersionTick
    };
  }

  private notifyTerrainRedraw(): void {
    for (const listener of this.terrainRedrawListeners) {
      listener();
    }
  }

  private notify(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function useEditorStore(store: EditorStore): EditorSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function attachEditorKeyboardListeners(store: EditorStore): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const onKeyDown = (e: KeyboardEvent) => {
    store.handleKeyDown(e);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    store.handleKeyUp(e);
  };
  const onBlur = () => {
    store.setSpacePanActive(false);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
