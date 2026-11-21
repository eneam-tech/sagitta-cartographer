import { DirtyRectPx } from '../model/commands';
import { COVER_FIELDS, COVER_FOREST, MapDocument } from '../model/document';
import { MapTheme } from '../theme/theme';
import {
  BiomeWeights,
  EdtScratch,
  LAND_MASK_THRESHOLD,
  clampRectToBounds,
  classifyLandWeightsInto,
  computeCliffFactor,
  computeGradientStepPx,
  computeLocalDistanceFieldInto,
  createEdtScratch,
  expandAndClampRect,
  smoothstepRange
} from './classifier';
import { cellJitter, hash2DBipolar, hash2D, hash2DFloat, valueNoise2D } from './noise';
import { ITerrainRenderer } from './types';

const CHUNK_SIZE_PX = 256;
const TREE_CELL_DOC = 9.2;
const MAX_TREE_FOOTPRINT_DOC = 8.0;
const PARCEL_W_DOC = 36;
const PARCEL_H_DOC = 28;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface FieldShadeOut {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

interface ElevationLut {
  low: Float32Array;
  plain: Float32Array;
  hill: Float32Array;
  mountain: Float32Array;
  inlandR: Float32Array;
  inlandG: Float32Array;
  inlandB: Float32Array;
}

function buildElevationLut(
  theme: MapTheme,
  palette: ParsedThemePalette,
  out: ElevationLut
): void {
  const weights: BiomeWeights = { sea: 0, beach: 0, plain: 0, hill: 0, mountain: 0 };
  const farDist = theme.elevation.beachMaxCoastDistDoc + 100;

  for (let h = 0; h < 256; h += 1) {
    // Inland (coastalFactor === 0)
    classifyLandWeightsInto(h, farDist, theme, weights);
    const inlandPlain = weights.plain;
    const hillW = weights.hill;
    const mtnW = weights.mountain;

    // Coastal (coastalFactor === 1)
    classifyLandWeightsInto(h, 0, theme, weights);
    const lowW = weights.beach;

    out.low[h] = lowW;
    out.plain[h] = Math.max(0, inlandPlain - lowW);
    out.hill[h] = hillW;
    out.mountain[h] = mtnW;

    out.inlandR[h] =
      palette.land.r * inlandPlain + palette.hill.r * hillW + palette.mountain.r * mtnW;
    out.inlandG[h] =
      palette.land.g * inlandPlain + palette.hill.g * hillW + palette.mountain.g * mtnW;
    out.inlandB[h] =
      palette.land.b * inlandPlain + palette.hill.b * hillW + palette.mountain.b * mtnW;
  }
}

interface ParsedThemePalette {
  sea: RgbColor;
  seaShallow: RgbColor;
  seaBathymetry: RgbColor;
  beach: RgbColor;
  land: RgbColor;
  hill: RgbColor;
  mountain: RgbColor;
  mountainCrest: RgbColor;
  ink: RgbColor;
  forest: RgbColor;
  forestShadow: RgbColor;
  fields: RgbColor;
  fieldsFurrow: RgbColor;
  stone: RgbColor;
}

function parseHexRgb(hex: string): RgbColor {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 0;
    const g = parseInt(clean[1] + clean[1], 16) || 0;
    const b = parseInt(clean[2] + clean[2], 16) || 0;
    return { r, g, b };
  }
  const n = parseInt(clean.slice(0, 6), 16);
  if (!Number.isFinite(n)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff
  };
}

function parsePalette(theme: MapTheme): ParsedThemePalette {
  const c = theme.colors;
  return {
    sea: parseHexRgb(c.sea),
    seaShallow: parseHexRgb(c.seaShallow),
    seaBathymetry: parseHexRgb(c.seaBathymetry),
    beach: parseHexRgb(c.beach),
    land: parseHexRgb(c.land),
    hill: parseHexRgb(c.hill),
    mountain: parseHexRgb(c.mountain),
    mountainCrest: parseHexRgb(c.mountainCrest),
    ink: parseHexRgb(c.ink),
    forest: parseHexRgb(c.forest),
    forestShadow: parseHexRgb(c.forestShadow),
    fields: parseHexRgb(c.fields),
    fieldsFurrow: parseHexRgb(c.fieldsFurrow),
    stone: parseHexRgb(c.stone)
  };
}

function clampByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return v | 0;
}

function buildThemeSignature(theme: MapTheme): string {
  const c = theme.colors;
  const e = theme.elevation;
  return [
    theme.id,
    theme.version,
    theme.mode,
    c.sea,
    c.seaShallow,
    c.seaBathymetry,
    c.beach,
    c.land,
    c.hill,
    c.mountain,
    c.mountainCrest,
    c.ink,
    c.forest,
    c.forestShadow,
    c.fields,
    c.fieldsFurrow,
    c.stone,
    theme.coast.strokeWidthDoc,
    theme.coast.bathymetryOffsetDoc,
    e.beachMaxHeight,
    e.beachMaxCoastDistDoc,
    e.plainMaxHeight,
    e.hillMaxHeight,
    e.mountainMaxHeight,
    e.blendWidth
  ].join('|');
}

/**
 * Deterministic incremental terrain raster renderer.
 * Always keeps an RGBA Uint8ClampedArray available in Node/Vitest and browsers,
 * maintains an on-demand 256x256 HTMLCanvasElement tile grid for low-latency
 * interactive drawing, and lazily blits dirty tiles onto the full canvas on `getCanvas()`.
 */
export class TerrainRenderer implements ITerrainRenderer {
  private widthPx = 0;
  private heightPx = 0;
  private rgba: Uint8ClampedArray = new Uint8ClampedArray(0);
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private tilesX = 0;
  private tilesY = 0;
  private tileCanvases: (HTMLCanvasElement | null)[] = [];
  private tileCtxs: (CanvasRenderingContext2D | null)[] = [];
  private tileNeedsSync: Uint8Array = new Uint8Array(0);
  private dirtyFullTiles: Uint8Array = new Uint8Array(0);
  private fullCanvasDirty = false;
  private tileImageData: ImageData | null = null;

  private renderedDocId: string | null = null;
  private renderedTerrainVersion = -1;
  private renderedThemeKey = '';

  private edtScratch: EdtScratch = createEdtScratch(CHUNK_SIZE_PX + 128);
  private distWaterBuf: Float32Array = new Float32Array(0);
  private distLandBuf: Float32Array = new Float32Array(0);
  private readonly tmpWeights: BiomeWeights = {
    sea: 0,
    beach: 0,
    plain: 0,
    hill: 0,
    mountain: 0
  };
  private readonly tmpFieldOut: FieldShadeOut = { r: 0, g: 0, b: 0, alpha: 0 };
  private readonly tmpPlainRgb: RgbColor = { r: 0, g: 0, b: 0 };
  private readonly elevLut: ElevationLut = {
    low: new Float32Array(256),
    plain: new Float32Array(256),
    hill: new Float32Array(256),
    mountain: new Float32Array(256),
    inlandR: new Float32Array(256),
    inlandG: new Float32Array(256),
    inlandB: new Float32Array(256)
  };
  private disposed = false;

  /**
   * Returns true if this renderer's RGBA buffer and tile caches match the given
   * document dimensions, ID, terrainVersion, and theme terrain parameters.
   */
  matchesDocument(doc: MapDocument): boolean {
    if (this.disposed) return false;
    if (this.widthPx <= 0 || this.heightPx <= 0) return false;
    if (doc.terrain.widthPx !== this.widthPx || doc.terrain.heightPx !== this.heightPx) {
      return false;
    }
    if (this.renderedDocId !== doc.manifest.id) {
      return false;
    }
    if (this.renderedTerrainVersion !== doc.terrainVersion) {
      return false;
    }
    return this.renderedThemeKey === buildThemeSignature(doc.theme);
  }

  /**
   * Draws only the 256x256 tiles intersecting `visibleDocRect` (or all tiles if
   * omitted) directly into `ctx` mapped onto `docSpace`, avoiding monolithic
   * full-canvas texture uploads during interactive strokes.
   */
  drawToCanvasContext(
    ctx: CanvasRenderingContext2D,
    docSpace: { width: number; height: number },
    visibleDocRect?: { x: number; y: number; width: number; height: number }
  ): void {
    if (
      this.disposed ||
      this.widthPx <= 0 ||
      this.heightPx <= 0 ||
      this.tilesX <= 0 ||
      this.tilesY <= 0 ||
      typeof document === 'undefined'
    ) {
      return;
    }

    if (
      !Number.isFinite(docSpace.width) ||
      !Number.isFinite(docSpace.height) ||
      docSpace.width <= 0 ||
      docSpace.height <= 0
    ) {
      return;
    }

    const scaleX = docSpace.width / this.widthPx;
    const scaleY = docSpace.height / this.heightPx;

    let tx0 = 0;
    let ty0 = 0;
    let tx1 = this.tilesX - 1;
    let ty1 = this.tilesY - 1;

    if (visibleDocRect) {
      if (
        !Number.isFinite(visibleDocRect.x) ||
        !Number.isFinite(visibleDocRect.y) ||
        !Number.isFinite(visibleDocRect.width) ||
        !Number.isFinite(visibleDocRect.height) ||
        visibleDocRect.width <= 0 ||
        visibleDocRect.height <= 0
      ) {
        return;
      }

      const visMinX = Math.max(0, Math.floor(visibleDocRect.x / scaleX));
      const visMinY = Math.max(0, Math.floor(visibleDocRect.y / scaleY));
      const visMaxX = Math.min(
        this.widthPx,
        Math.ceil((visibleDocRect.x + visibleDocRect.width) / scaleX)
      );
      const visMaxY = Math.min(
        this.heightPx,
        Math.ceil((visibleDocRect.y + visibleDocRect.height) / scaleY)
      );

      if (visMaxX <= visMinX || visMaxY <= visMinY) {
        return;
      }

      tx0 = Math.floor(visMinX / CHUNK_SIZE_PX);
      tx1 = Math.floor((visMaxX - 1) / CHUNK_SIZE_PX);
      ty0 = Math.floor(visMinY / CHUNK_SIZE_PX);
      ty1 = Math.floor((visMaxY - 1) / CHUNK_SIZE_PX);
    }

    for (let ty = ty0; ty <= ty1; ty += 1) {
      const tileY = ty * CHUNK_SIZE_PX;
      const tileH = Math.min(CHUNK_SIZE_PX, this.heightPx - tileY);
      const dy = tileY * scaleY;
      const dh = (tileY + tileH) * scaleY - dy;

      for (let tx = tx0; tx <= tx1; tx += 1) {
        const tileX = tx * CHUNK_SIZE_PX;
        const tileW = Math.min(CHUNK_SIZE_PX, this.widthPx - tileX);
        const tileCanvas = this.ensureTileSynced(tx, ty, tileX, tileY, tileW, tileH);
        if (!tileCanvas) continue;

        const dx = tileX * scaleX;
        const dw = (tileX + tileW) * scaleX - dx;
        ctx.drawImage(tileCanvas, dx, dy, dw, dh);
      }
    }
  }

  /**
   * Lazily synchronizes only dirty tiles onto the monolithic offscreen canvas
   * (used for PDF export / fallback) and returns it, or null without DOM.
   */
  getCanvas(): HTMLCanvasElement | null {
    if (
      this.disposed ||
      this.widthPx <= 0 ||
      this.heightPx <= 0 ||
      typeof document === 'undefined'
    ) {
      return null;
    }

    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.widthPx;
      this.canvas.height = this.heightPx;
      this.ctx = this.canvas.getContext('2d');
      this.dirtyFullTiles.fill(1);
      this.fullCanvasDirty = true;
    } else if (this.canvas.width !== this.widthPx || this.canvas.height !== this.heightPx) {
      this.canvas.width = this.widthPx;
      this.canvas.height = this.heightPx;
      this.ctx = this.canvas.getContext('2d');
      this.dirtyFullTiles.fill(1);
      this.fullCanvasDirty = true;
    }

    if (this.fullCanvasDirty && this.ctx) {
      for (let ty = 0; ty < this.tilesY; ty += 1) {
        const tileY = ty * CHUNK_SIZE_PX;
        const tileH = Math.min(CHUNK_SIZE_PX, this.heightPx - tileY);
        const rowOff = ty * this.tilesX;

        for (let tx = 0; tx < this.tilesX; tx += 1) {
          const idx = rowOff + tx;
          if (this.dirtyFullTiles[idx] === 0) continue;
          const tileX = tx * CHUNK_SIZE_PX;
          const tileW = Math.min(CHUNK_SIZE_PX, this.widthPx - tileX);
          this.putRgbaSubrect(this.ctx, tileX, tileY, tileW, tileH, tileX, tileY);
          this.dirtyFullTiles[idx] = 0;
        }
      }
      this.fullCanvasDirty = false;
    }

    return this.canvas;
  }

  getPixelData(): { width: number; height: number; rgba: Uint8ClampedArray } {
    return {
      width: this.widthPx,
      height: this.heightPx,
      rgba: this.rgba
    };
  }

  dispose(): void {
    this.disposed = true;
    this.disposeTileCanvases();
    this.disposeFullCanvas();
    this.tileImageData = null;
    this.rgba = new Uint8ClampedArray(0);
    this.distWaterBuf = new Float32Array(0);
    this.distLandBuf = new Float32Array(0);
    this.edtScratch = {
      v: new Int32Array(0),
      z: new Float32Array(0),
      rowIn: new Float32Array(0),
      sqDist: new Float32Array(0)
    };
    this.widthPx = 0;
    this.heightPx = 0;
    this.renderedDocId = null;
    this.renderedTerrainVersion = -1;
    this.renderedThemeKey = '';
  }

  renderFull(doc: MapDocument): void {
    if (this.disposed) return;

    const { widthPx, heightPx, mask } = doc.terrain;
    this.ensureBackingBuffers(widthPx, heightPx);

    const palette = parsePalette(doc.theme);

    // Fast path for empty sea document
    let hasLandAny = false;
    for (let i = 0, len = mask.length; i < len; i += 1) {
      if (mask[i] > 0) {
        hasLandAny = true;
        break;
      }
    }

    if (!hasLandAny) {
      this.fillUniformSeaRect({ x: 0, y: 0, width: widthPx, height: heightPx }, palette.sea);
      this.markAllTilesDirty();
      this.markDocumentRendered(doc);
      return;
    }

    const fullRect: DirtyRectPx = { x: 0, y: 0, width: widthPx, height: heightPx };
    this.renderOutputRectInChunks(doc, fullRect, palette);
    this.markAllTilesDirty();
    this.markDocumentRendered(doc);
  }

  renderRegion(doc: MapDocument, dirtyRect: DirtyRectPx): void {
    if (this.disposed) return;

    const { widthPx, heightPx } = doc.terrain;
    const themeKey = buildThemeSignature(doc.theme);
    const docMismatch =
      this.widthPx !== widthPx ||
      this.heightPx !== heightPx ||
      this.renderedDocId !== doc.manifest.id ||
      this.renderedThemeKey !== themeKey;
    if (docMismatch) {
      this.renderFull(doc);
      return;
    }

    const clamped = clampRectToBounds(dirtyRect, widthPx, heightPx);
    if (!clamped) {
      this.renderedTerrainVersion = doc.terrainVersion;
      return;
    }

    const { padPx } = this.computeInfluencePadding(doc);
    const outRect = expandAndClampRect(clamped, padPx, widthPx, heightPx);
    if (!outRect) {
      this.renderedTerrainVersion = doc.terrainVersion;
      return;
    }

    const palette = parsePalette(doc.theme);
    this.renderOutputRectInChunks(doc, outRect, palette);
    this.syncCanvasRect(outRect);
    this.markDocumentRendered(doc, themeKey);
  }

  private markDocumentRendered(doc: MapDocument, themeKey = buildThemeSignature(doc.theme)): void {
    this.renderedDocId = doc.manifest.id;
    this.renderedTerrainVersion = doc.terrainVersion;
    this.renderedThemeKey = themeKey;
  }

  private markAllTilesDirty(): void {
    this.tileNeedsSync.fill(1);
    this.dirtyFullTiles.fill(1);
    this.fullCanvasDirty = true;
  }

  private disposeTileCanvases(): void {
    for (let i = 0; i < this.tileCanvases.length; i += 1) {
      const tc = this.tileCanvases[i];
      if (tc) {
        tc.width = 0;
        tc.height = 0;
        this.tileCanvases[i] = null;
      }
      this.tileCtxs[i] = null;
    }
    this.tileCanvases = [];
    this.tileCtxs = [];
    this.tileNeedsSync = new Uint8Array(0);
    this.dirtyFullTiles = new Uint8Array(0);
    this.tilesX = 0;
    this.tilesY = 0;
    this.fullCanvasDirty = false;
  }

  private disposeFullCanvas(): void {
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
      this.canvas = null;
    }
    this.ctx = null;
  }

  private ensureBackingBuffers(widthPx: number, heightPx: number): void {
    if (this.widthPx !== widthPx || this.heightPx !== heightPx) {
      this.disposeTileCanvases();
      this.disposeFullCanvas();
      this.tileImageData = null;

      this.widthPx = widthPx;
      this.heightPx = heightPx;
      this.rgba = new Uint8ClampedArray(widthPx * heightPx * 4);

      this.tilesX = Math.ceil(widthPx / CHUNK_SIZE_PX);
      this.tilesY = Math.ceil(heightPx / CHUNK_SIZE_PX);
      const tileCount = this.tilesX * this.tilesY;
      this.tileCanvases = new Array<HTMLCanvasElement | null>(tileCount).fill(null);
      this.tileCtxs = new Array<CanvasRenderingContext2D | null>(tileCount).fill(null);
      this.tileNeedsSync = new Uint8Array(tileCount);
      this.dirtyFullTiles = new Uint8Array(tileCount);
      this.fullCanvasDirty = false;
    }
  }

  private ensureTileContext(
    idx: number,
    tileW: number,
    tileH: number
  ): CanvasRenderingContext2D | null {
    let tileCanvas = this.tileCanvases[idx];
    let tileCtx = this.tileCtxs[idx];

    if (!tileCanvas) {
      tileCanvas = document.createElement('canvas');
      tileCanvas.width = tileW;
      tileCanvas.height = tileH;
      tileCtx = tileCanvas.getContext('2d');
      if (!tileCtx) {
        tileCanvas.width = 0;
        tileCanvas.height = 0;
        return null;
      }
      this.tileCanvases[idx] = tileCanvas;
      this.tileCtxs[idx] = tileCtx;
      return tileCtx;
    }

    if (tileCanvas.width !== tileW || tileCanvas.height !== tileH) {
      tileCanvas.width = tileW;
      tileCanvas.height = tileH;
      tileCtx = tileCanvas.getContext('2d');
      this.tileCtxs[idx] = tileCtx;
    }

    return tileCtx;
  }

  private ensureTileSynced(
    tx: number,
    ty: number,
    tileX: number,
    tileY: number,
    tileW: number,
    tileH: number
  ): HTMLCanvasElement | null {
    const idx = ty * this.tilesX + tx;
    const existing = this.tileCanvases[idx];
    if (existing && this.tileNeedsSync[idx] === 0) {
      return existing;
    }

    const tileCtx = this.ensureTileContext(idx, tileW, tileH);
    if (!tileCtx) return null;

    this.putRgbaSubrect(tileCtx, tileX, tileY, tileW, tileH, 0, 0);
    this.tileNeedsSync[idx] = 0;
    return this.tileCanvases[idx];
  }

  private putRgbaSubrect(
    targetCtx: CanvasRenderingContext2D,
    srcX: number,
    srcY: number,
    w: number,
    h: number,
    destX: number,
    destY: number
  ): void {
    if (w <= 0 || h <= 0) return;
    const maxW = Math.min(CHUNK_SIZE_PX, this.widthPx);
    const maxH = Math.min(CHUNK_SIZE_PX, this.heightPx);
    if (
      !this.tileImageData ||
      this.tileImageData.width !== maxW ||
      this.tileImageData.height !== maxH
    ) {
      this.tileImageData = targetCtx.createImageData(maxW, maxH);
    }

    const imgData = this.tileImageData;
    const dst = imgData.data;
    const src = this.rgba;
    const dstStride = maxW * 4;
    const srcStride = this.widthPx * 4;
    const rowBytes = w * 4;

    for (let row = 0; row < h; row += 1) {
      const srcStart = (srcY + row) * srcStride + srcX * 4;
      dst.set(src.subarray(srcStart, srcStart + rowBytes), row * dstStride);
    }

    if (w === maxW && h === maxH) {
      targetCtx.putImageData(imgData, destX, destY);
    } else {
      targetCtx.putImageData(imgData, destX, destY, 0, 0, w, h);
    }
  }

  private computeInfluencePadding(doc: MapDocument): {
    influenceDoc: number;
    padPx: number;
    treePadPx: number;
    maxTreeFootprintDoc: number;
  } {
    const { space } = doc.manifest;
    const { widthPx, heightPx } = doc.terrain;
    const maxPxPerDoc = Math.max(widthPx / space.width, heightPx / space.height);
    const avgDocPerPx = 0.5 * (space.width / widthPx + space.height / heightPx);

    const influenceDoc = Math.max(
      doc.theme.elevation.beachMaxCoastDistDoc + 3,
      doc.theme.coast.bathymetryOffsetDoc + 3,
      14
    );
    const maxTreeFootprintDoc = Math.max(MAX_TREE_FOOTPRINT_DOC, avgDocPerPx * 1.4);
    const padPx = Math.ceil(influenceDoc * maxPxPerDoc) + 2;
    const treePadPx = Math.ceil(maxTreeFootprintDoc * maxPxPerDoc) + 1;
    return { influenceDoc, padPx, treePadPx, maxTreeFootprintDoc };
  }

  private fillUniformSeaRect(rect: DirtyRectPx, sea: RgbColor): void {
    const { widthPx, rgba } = this;
    const sr = sea.r;
    const sg = sea.g;
    const sb = sea.b;

    for (let y = rect.y, yEnd = rect.y + rect.height; y < yEnd; y += 1) {
      let off = (y * widthPx + rect.x) * 4;
      for (let x = 0; x < rect.width; x += 1) {
        rgba[off] = sr;
        rgba[off + 1] = sg;
        rgba[off + 2] = sb;
        rgba[off + 3] = 255;
        off += 4;
      }
    }
  }

  private syncCanvasRect(rect: DirtyRectPx): void {
    if (rect.width <= 0 || rect.height <= 0 || this.tilesX <= 0 || this.tilesY <= 0) {
      return;
    }

    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(this.widthPx, rect.x + rect.width);
    const y1 = Math.min(this.heightPx, rect.y + rect.height);
    if (x1 <= x0 || y1 <= y0) return;

    const tx0 = Math.floor(x0 / CHUNK_SIZE_PX);
    const tx1 = Math.floor((x1 - 1) / CHUNK_SIZE_PX);
    const ty0 = Math.floor(y0 / CHUNK_SIZE_PX);
    const ty1 = Math.floor((y1 - 1) / CHUNK_SIZE_PX);
    const hasDom = typeof document !== 'undefined';

    for (let ty = ty0; ty <= ty1; ty += 1) {
      const tileY = ty * CHUNK_SIZE_PX;
      const tileH = Math.min(CHUNK_SIZE_PX, this.heightPx - tileY);
      const iy0 = Math.max(y0, tileY);
      const iy1 = Math.min(y1, tileY + tileH);
      const copyH = iy1 - iy0;
      const localY = iy0 - tileY;

      for (let tx = tx0; tx <= tx1; tx += 1) {
        const idx = ty * this.tilesX + tx;
        this.dirtyFullTiles[idx] = 1;
        this.fullCanvasDirty = true;

        if (!hasDom) continue;

        const tileX = tx * CHUNK_SIZE_PX;
        const tileW = Math.min(CHUNK_SIZE_PX, this.widthPx - tileX);
        const existing = this.tileCanvases[idx];

        if (!existing || this.tileNeedsSync[idx] === 1) {
          const tileCtx = this.ensureTileContext(idx, tileW, tileH);
          if (tileCtx) {
            this.putRgbaSubrect(tileCtx, tileX, tileY, tileW, tileH, 0, 0);
            this.tileNeedsSync[idx] = 0;
          }
        } else {
          const tileCtx = this.tileCtxs[idx];
          if (tileCtx) {
            const ix0 = Math.max(x0, tileX);
            const ix1 = Math.min(x1, tileX + tileW);
            const copyW = ix1 - ix0;
            const localX = ix0 - tileX;
            this.putRgbaSubrect(tileCtx, ix0, iy0, copyW, copyH, localX, localY);
          }
        }
      }
    }
  }

  private renderOutputRectInChunks(
    doc: MapDocument,
    outRect: DirtyRectPx,
    palette: ParsedThemePalette
  ): void {
    const { padPx, treePadPx, maxTreeFootprintDoc } = this.computeInfluencePadding(doc);
    if (doc.theme.mode !== 'flat') {
      buildElevationLut(doc.theme, palette, this.elevLut);
    }
    const xEnd = outRect.x + outRect.width;
    const yEnd = outRect.y + outRect.height;

    for (let cy = outRect.y; cy < yEnd; cy += CHUNK_SIZE_PX) {
      const ch = Math.min(CHUNK_SIZE_PX, yEnd - cy);
      for (let cx = outRect.x; cx < xEnd; cx += CHUNK_SIZE_PX) {
        const cw = Math.min(CHUNK_SIZE_PX, xEnd - cx);
        const chunkRect: DirtyRectPx = { x: cx, y: cy, width: cw, height: ch };
        this.renderChunk(doc, chunkRect, padPx, treePadPx, maxTreeFootprintDoc, palette);
      }
    }
  }

  private renderChunk(
    doc: MapDocument,
    chunkOutRect: DirtyRectPx,
    padPx: number,
    treePadPx: number,
    maxTreeFootprintDoc: number,
    palette: ParsedThemePalette
  ): void {
    const { space } = doc.manifest;
    const seed = doc.manifest.terrain.seed >>> 0;
    const { widthPx, heightPx, mask, height, cover } = doc.terrain;
    const theme = doc.theme;
    const isFlat = theme.mode === 'flat';

    const distOutRect = expandAndClampRect(chunkOutRect, treePadPx, widthPx, heightPx)!;
    const sampleRect = expandAndClampRect(distOutRect, padPx, widthPx, heightPx)!;

    // Scan sampleRect to see what terrain features exist locally
    let anyMaskNonZero = false;
    let anyWater = false;
    let anyLand = false;
    let anyForest = false;

    for (let sy = sampleRect.y, syEnd = sampleRect.y + sampleRect.height; sy < syEnd; sy += 1) {
      const rowOff = sy * widthPx;
      for (let sx = sampleRect.x, sxEnd = sampleRect.x + sampleRect.width; sx < sxEnd; sx += 1) {
        const idx = rowOff + sx;
        const m = mask[idx];
        if (m > 0) anyMaskNonZero = true;
        if (m < LAND_MASK_THRESHOLD) {
          anyWater = true;
        } else {
          anyLand = true;
          if (cover[idx] === COVER_FOREST) {
            anyForest = true;
          }
        }
      }
    }

    if (!anyMaskNonZero) {
      this.fillUniformSeaRect(chunkOutRect, palette.sea);
      return;
    }

    const distOutCells = distOutRect.width * distOutRect.height;
    if (this.distWaterBuf.length < distOutCells) {
      this.distWaterBuf = new Float32Array(distOutCells);
    }
    const chunkCells = chunkOutRect.width * chunkOutRect.height;
    if (this.distLandBuf.length < chunkCells) {
      this.distLandBuf = new Float32Array(chunkCells);
    }

    if (anyWater) {
      computeLocalDistanceFieldInto(
        mask,
        widthPx,
        heightPx,
        sampleRect,
        distOutRect,
        true,
        this.distWaterBuf,
        this.edtScratch
      );
    } else {
      this.distWaterBuf.fill(Number.POSITIVE_INFINITY, 0, distOutCells);
    }

    if (anyLand && anyWater) {
      const landSampleRect = expandAndClampRect(chunkOutRect, padPx, widthPx, heightPx)!;
      computeLocalDistanceFieldInto(
        mask,
        widthPx,
        heightPx,
        landSampleRect,
        chunkOutRect,
        false,
        this.distLandBuf,
        this.edtScratch
      );
    } else if (anyLand) {
      this.distLandBuf.fill(0, 0, chunkCells);
    } else {
      this.distLandBuf.fill(Number.POSITIVE_INFINITY, 0, chunkCells);
    }

    const docPerPxX = space.width / widthPx;
    const docPerPxY = space.height / heightPx;
    const avgDocPerPx = 0.5 * (docPerPxX + docPerPxY);
    const gradStepPx = computeGradientStepPx(space, doc.terrain);

    const bathyOffsetDoc = theme.coast.bathymetryOffsetDoc;
    const maxSeaGlowDoc = bathyOffsetDoc * 1.15 + 2;
    const halfStrokeDoc = Math.max(theme.coast.strokeWidthDoc * 0.5, 0.75 * avgDocPerPx);
    const strokeAaDoc = Math.max(0.8 * avgDocPerPx, 0.45);
    const strokeOuterDoc = halfStrokeDoc + strokeAaDoc;
    const strokeInnerDoc = Math.max(0, halfStrokeDoc - strokeAaDoc);
    const strokeLowResAtten =
      theme.coast.strokeWidthDoc < 1.5 * avgDocPerPx
        ? Math.max(0.45, theme.coast.strokeWidthDoc / (1.5 * avgDocPerPx))
        : 1.0;

    const paperSeed = (seed ^ 0x706170) >>> 0;
    const microSeed = (seed ^ 0x6d6963) >>> 0;
    const bathySeed = (seed ^ 0x626174) >>> 0;
    const parcelSeed = (seed ^ 0x706172) >>> 0;
    const warpSeed = (seed ^ 0x777270) >>> 0;
    const terraceSeed = (seed ^ 0x746572) >>> 0;
    const cliffSeed = (seed ^ 0x636c69) >>> 0;

    const beachMaxCoastDistDoc = theme.elevation.beachMaxCoastDistDoc;
    const hasBlendWidth = theme.elevation.blendWidth > 0;
    const distHw = Math.min(2.5, Math.max(0.5, beachMaxCoastDistDoc * 0.25));
    const coastBlendEdge0 = beachMaxCoastDistDoc - distHw + 0.05;
    const coastBlendEdge1 = beachMaxCoastDistDoc + distHw + 0.05;
    const maxBeachCheckDoc = hasBlendWidth ? coastBlendEdge1 : beachMaxCoastDistDoc;
    const lutLow = this.elevLut.low;
    const lutPlain = this.elevLut.plain;
    const lutHill = this.elevLut.hill;
    const lutMtn = this.elevLut.mountain;
    const lutInlandR = this.elevLut.inlandR;
    const lutInlandG = this.elevLut.inlandG;
    const lutInlandB = this.elevLut.inlandB;

    const bathyR1 = bathyOffsetDoc * 0.45;
    const bathyR2 = bathyOffsetDoc;
    const bathyLineW = Math.max(0.9, avgDocPerPx * 1.1);
    const bathyReach = bathyLineW + 0.85;

    const ox0 = chunkOutRect.x;
    const oy0 = chunkOutRect.y;
    const ow = chunkOutRect.width;
    const oh = chunkOutRect.height;
    const dw = distOutRect.width;
    const dOffX = ox0 - distOutRect.x;
    const dOffY = oy0 - distOutRect.y;

    const rgba = this.rgba;
    const seaR = palette.sea.r;
    const seaG = palette.sea.g;
    const seaB = palette.sea.b;

    for (let ly = 0; ly < oh; ly += 1) {
      const py = oy0 + ly;
      const docY = (py + 0.5) * docPerPxY;
      const docRow = py * widthPx;
      const distWRow = (dOffY + ly) * dw + dOffX;
      const distLRow = ly * ow;

      for (let lx = 0; lx < ow; lx += 1) {
        const px = ox0 + lx;
        const idx = docRow + px;
        const maskVal = mask[idx];
        const distLandDoc = this.distLandBuf[distLRow + lx] * avgDocPerPx;

        // Fast deep-sea path
        if (maskVal === 0 && distLandDoc > maxSeaGlowDoc) {
          const off = idx * 4;
          rgba[off] = seaR;
          rgba[off + 1] = seaG;
          rgba[off + 2] = seaB;
          rgba[off + 3] = 255;
          continue;
        }

        const docX = (px + 0.5) * docPerPxX;
        const distWaterDoc = this.distWaterBuf[distWRow + lx] * avgDocPerPx;

        // Sea contribution
        let sr = seaR;
        let sg = seaG;
        let sb = seaB;

        if (maskVal < 255 && distLandDoc <= maxSeaGlowDoc) {
          const shallowT = 1 - smoothstepRange(0, bathyOffsetDoc * 1.1, distLandDoc);
          if (shallowT > 0) {
            const st = shallowT * 0.85;
            sr += (palette.seaShallow.r - sr) * st;
            sg += (palette.seaShallow.g - sg) * st;
            sb += (palette.seaShallow.b - sb) * st;
          }

          if (
            bathyOffsetDoc > 2 &&
            (Math.abs(distLandDoc - bathyR1) <= bathyReach ||
              Math.abs(distLandDoc - bathyR2) <= bathyReach)
          ) {
            const wobble = (valueNoise2D(bathySeed, docX * 0.05, docY * 0.05) - 0.5) * 1.6;
            const dW = distLandDoc + wobble;
            const ring1 = 1 - smoothstepRange(0, bathyLineW, Math.abs(dW - bathyR1));
            const ring2 = 1 - smoothstepRange(0, bathyLineW, Math.abs(dW - bathyR2));
            const ringAlpha = Math.max(ring1 * 0.38, ring2 * 0.25);
            if (ringAlpha > 0) {
              sr += (palette.seaBathymetry.r - sr) * ringAlpha;
              sg += (palette.seaBathymetry.g - sg) * ringAlpha;
              sb += (palette.seaBathymetry.b - sb) * ringAlpha;
            }
          }
        }

        // Land contribution
        let lr = palette.land.r;
        let lg = palette.land.g;
        let lb = palette.land.b;

        if (maskVal > 0) {
          const hVal = height[idx];
          const cVal = cover[idx];

          if (isFlat) {
            const grain =
              (valueNoise2D(paperSeed, docX * 0.24, docY * 0.24) - 0.5) * 8 +
              hash2DBipolar(microSeed, Math.floor(docX), Math.floor(docY)) * 2.5;
            lr += grain;
            lg += grain;
            lb += grain;

            if (cVal === COVER_FIELDS && maskVal >= LAND_MASK_THRESHOLD) {
              evaluatePlainFieldsInto(
                docX,
                docY,
                parcelSeed,
                warpSeed,
                palette,
                this.tmpPlainRgb
              );
              lr += (this.tmpPlainRgb.r - lr) * 0.86;
              lg += (this.tmpPlainRgb.g - lg) * 0.86;
              lb += (this.tmpPlainRgb.b - lb) * 0.86;
            }
          } else {
            const lowW = lutLow[hVal];
            let wBeach = 0;
            let wPlain = lutPlain[hVal] + lowW;
            const wHill = lutHill[hVal];
            const wMtn = lutMtn[hVal];

            if (lowW > 0 && distWaterDoc <= maxBeachCheckDoc) {
              const coastalFactor = hasBlendWidth
                ? beachMaxCoastDistDoc <= 0
                  ? 0
                  : 1 - smoothstepRange(coastBlendEdge0, coastBlendEdge1, distWaterDoc)
                : 1;
              wBeach = lowW * coastalFactor;
              wPlain = lutPlain[hVal] + lowW * (1 - coastalFactor);
              lr =
                palette.beach.r * wBeach +
                palette.land.r * wPlain +
                palette.hill.r * wHill +
                palette.mountain.r * wMtn;
              lg =
                palette.beach.g * wBeach +
                palette.land.g * wPlain +
                palette.hill.g * wHill +
                palette.mountain.g * wMtn;
              lb =
                palette.beach.b * wBeach +
                palette.land.b * wPlain +
                palette.hill.b * wHill +
                palette.mountain.b * wMtn;
            } else {
              lr = lutInlandR[hVal];
              lg = lutInlandG[hVal];
              lb = lutInlandB[hVal];
            }

            // Fine rag-paper texture anchored to document coordinates
            const grain =
              (valueNoise2D(paperSeed, docX * 0.24, docY * 0.24) - 0.5) * 9 +
              hash2DBipolar(microSeed, Math.floor(docX), Math.floor(docY)) * 3;
            lr += grain;
            lg += grain * 0.95;
            lb += grain * 0.85;

            // Inline Sobel 3x3 gradient (zero allocation + flat fast path)
            const xm = px - gradStepPx >= 0 ? px - gradStepPx : 0;
            const xp = px + gradStepPx < widthPx ? px + gradStepPx : widthPx - 1;
            const ym = py - gradStepPx >= 0 ? py - gradStepPx : 0;
            const yp = py + gradStepPx < heightPx ? py + gradStepPx : heightPx - 1;

            const rM = ym * widthPx;
            const rC = py * widthPx;
            const rP = yp * widthPx;

            const h00 = height[rM + xm];
            const h10 = height[rM + px];
            const h20 = height[rM + xp];
            const h01 = height[rC + xm];
            const h21 = height[rC + xp];
            const h02 = height[rP + xm];
            const h12 = height[rP + px];
            const h22 = height[rP + xp];

            const dxRaw = h20 + 2 * h21 + h22 - (h00 + 2 * h01 + h02);
            const dyRaw = h02 + 2 * h12 + h22 - (h00 + 2 * h10 + h20);

            let slope = 0;
            let shade = 0;

            if (dxRaw !== 0 || dyRaw !== 0) {
              const spanDocX = (xp - xm) * docPerPxX;
              const spanDocY = (yp - ym) * docPerPxY;
              const gx = spanDocX > 0 ? dxRaw / (4 * spanDocX) : 0;
              const gy = spanDocY > 0 ? dyRaw / (4 * spanDocY) : 0;
              slope = Math.sqrt(gx * gx + gy * gy);
              const lightDot = (gx + gy) * 0.7071;
              shade = Math.tanh(lightDot * 0.28);

              const reliefStrength = 0.28 + 0.42 * wHill + 0.58 * wMtn;
              if (shade > 0) {
                const litT = shade * reliefStrength * 0.42;
                lr += (palette.mountainCrest.r - lr) * litT;
                lg += (palette.mountainCrest.g - lg) * litT;
                lb += (palette.mountainCrest.b - lb) * litT;
              } else if (shade < 0) {
                const shadowT = -shade * reliefStrength * 0.62;
                lr += (palette.stone.r - lr) * shadowT;
                lg += (palette.stone.g - lg) * shadowT;
                lb += (palette.stone.b - lb) * shadowT;
              }
            }

            // Illuminated mountain ridges and crests
            if (hVal > 195 && shade > -0.2) {
              const crestT =
                smoothstepRange(195, 245, hVal) *
                smoothstepRange(-0.2, 0.25, shade) *
                0.55;
              lr += (palette.mountainCrest.r - lr) * crestT;
              lg += (palette.mountainCrest.g - lg) * crestT;
              lb += (palette.mountainCrest.b - lb) * crestT;
            }

            // Contextual fields cover (plain parcels, hill contour furrows, mountain terraces)
            if (cVal === COVER_FIELDS && maskVal >= LAND_MASK_THRESHOLD) {
              const w = this.tmpWeights;
              w.beach = wBeach;
              w.plain = wPlain;
              w.hill = wHill;
              w.mountain = wMtn;
              evaluateReactiveFieldsInto(
                docX,
                docY,
                hVal,
                distWaterDoc,
                slope,
                w,
                parcelSeed,
                warpSeed,
                terraceSeed,
                palette,
                this.tmpPlainRgb,
                this.tmpFieldOut
              );
              const fieldAlpha = this.tmpFieldOut.alpha;
              if (fieldAlpha > 0) {
                const shadeMul = 1 + shade * 0.12;
                const fr = this.tmpFieldOut.r * shadeMul;
                const fg = this.tmpFieldOut.g * shadeMul;
                const fb = this.tmpFieldOut.b * shadeMul;
                lr += (fr - lr) * fieldAlpha;
                lg += (fg - lg) * fieldAlpha;
                lb += (fb - lb) * fieldAlpha;
              }
            }

            // Coastal cliff detection & rocky headland rendering
            if (distWaterDoc <= 5.5 && hVal >= 40) {
              const cliff = computeCliffFactor(hVal, distWaterDoc, slope);
              if (cliff > 0.02) {
                const striation = valueNoise2D(cliffSeed, docX * 0.35, docY * 0.35);
                const rockMix = cliff * (0.55 + 0.3 * striation);
                const targetR = shade < 0 ? palette.ink.r : palette.stone.r;
                const targetG = shade < 0 ? palette.ink.g : palette.stone.g;
                const targetB = shade < 0 ? palette.ink.b : palette.stone.b;
                lr += (targetR - lr) * rockMix;
                lg += (targetG - lg) * rockMix;
                lb += (targetB - lb) * rockMix;
              }
            }
          }
        }

        // Composite land & sea with mask antialiasing
        let outR: number;
        let outG: number;
        let outB: number;
        if (maskVal === 255) {
          outR = lr;
          outG = lg;
          outB = lb;
        } else if (maskVal === 0) {
          outR = sr;
          outG = sg;
          outB = sb;
        } else {
          const t = maskVal / 255;
          outR = sr + (lr - sr) * t;
          outG = sg + (lg - sg) * t;
          outB = sb + (lb - sb) * t;
        }

        // Coastline contour ink stroke (only where sea meets land, never at page borders)
        const signedCoastDist =
          maskVal >= LAND_MASK_THRESHOLD ? distWaterDoc : distLandDoc;
        if (signedCoastDist <= strokeOuterDoc) {
          const strokeT =
            (1 - smoothstepRange(strokeInnerDoc, strokeOuterDoc, signedCoastDist)) *
            0.88 *
            strokeLowResAtten;
          if (strokeT > 0) {
            outR += (palette.ink.r - outR) * strokeT;
            outG += (palette.ink.g - outG) * strokeT;
            outB += (palette.ink.b - outB) * strokeT;
          }
        }

        const off = idx * 4;
        rgba[off] = clampByte(outR);
        rgba[off + 1] = clampByte(outG);
        rgba[off + 2] = clampByte(outB);
        rgba[off + 3] = 255;
      }
    }

    // Forest canopies rendered deterministically in South-over-North painter's order
    if (anyForest) {
      this.renderForestCanopies(
        doc,
        chunkOutRect,
        distOutRect,
        docPerPxX,
        docPerPxY,
        avgDocPerPx,
        maxTreeFootprintDoc,
        palette
      );
    }
  }

  private renderForestCanopies(
    doc: MapDocument,
    chunkOutRect: DirtyRectPx,
    distOutRect: DirtyRectPx,
    docPerPxX: number,
    docPerPxY: number,
    avgDocPerPx: number,
    maxTreeFootprintDoc: number,
    palette: ParsedThemePalette
  ): void {
    const { space } = doc.manifest;
    const seed = doc.manifest.terrain.seed >>> 0;
    const { widthPx, heightPx, mask, height, cover } = doc.terrain;
    const theme = doc.theme;
    const isFlat = theme.mode === 'flat';
    const rgba = this.rgba;

    const ox0 = chunkOutRect.x;
    const oy0 = chunkOutRect.y;
    const ox1 = ox0 + chunkOutRect.width - 1;
    const oy1 = oy0 + chunkOutRect.height - 1;

    const minDocX = ox0 * docPerPxX - maxTreeFootprintDoc;
    const maxDocX = (ox1 + 1) * docPerPxX + maxTreeFootprintDoc;
    const minDocY = oy0 * docPerPxY - maxTreeFootprintDoc;
    const maxDocY = (oy1 + 1) * docPerPxY + maxTreeFootprintDoc;

    const gx0 = Math.floor(minDocX / TREE_CELL_DOC);
    const gx1 = Math.floor(maxDocX / TREE_CELL_DOC);
    const gy0 = Math.floor(minDocY / TREE_CELL_DOC);
    const gy1 = Math.floor(maxDocY / TREE_CELL_DOC);

    const gladeSeed = (seed ^ 0x474c44) >>> 0;
    const forestSalt = 0x464f52;
    const dw = distOutRect.width;

    for (let gy = gy0; gy <= gy1; gy += 1) {
      for (let gx = gx0; gx <= gx1; gx += 1) {
        const j = cellJitter(seed, gx, gy, forestSalt);
        const cxDoc = (gx + 0.16 + j.dx * 0.68) * TREE_CELL_DOC;
        const cyDoc = (gy + 0.16 + j.dy * 0.68) * TREE_CELL_DOC;

        if (
          cxDoc < minDocX ||
          cxDoc > maxDocX ||
          cyDoc < minDocY ||
          cyDoc > maxDocY ||
          cxDoc < 0 ||
          cxDoc >= space.width ||
          cyDoc < 0 ||
          cyDoc >= space.height
        ) {
          continue;
        }

        const cpx = Math.min(widthPx - 1, Math.max(0, Math.floor(cxDoc / docPerPxX)));
        const cpy = Math.min(heightPx - 1, Math.max(0, Math.floor(cyDoc / docPerPxY)));
        if (
          cpx < distOutRect.x ||
          cpx >= distOutRect.x + distOutRect.width ||
          cpy < distOutRect.y ||
          cpy >= distOutRect.y + distOutRect.height
        ) {
          continue;
        }
        const cIdx = cpy * widthPx + cpx;

        if (mask[cIdx] < LAND_MASK_THRESHOLD || cover[cIdx] !== COVER_FOREST) {
          continue;
        }

        const distIdx = (cpy - distOutRect.y) * dw + (cpx - distOutRect.x);
        const distWaterDoc = this.distWaterBuf[distIdx] * avgDocPerPx;
        const cHeight = height[cIdx];

        let density: number;
        let radiusDoc: number;
        let darkTint = 0;

        const glade = valueNoise2D(gladeSeed, cxDoc * 0.032, cyDoc * 0.032);

        if (isFlat) {
          density = 0.78 * (0.64 + 0.36 * glade);
          radiusDoc = 4.2 + j.r * 1.5;
        } else {
          const w = this.tmpWeights;
          classifyLandWeightsInto(cHeight, distWaterDoc, theme, w);

          const beachAllowed = distWaterDoc < 2.2 ? 0 : 0.16;
          const mountainAllowed = cHeight > 232 ? 0 : 0.14;

          density =
            (w.plain * 0.86 +
              w.hill * 0.42 +
              w.mountain * mountainAllowed +
              w.beach * beachAllowed) *
            (0.56 + 0.44 * glade);

          radiusDoc =
            w.plain * (4.1 + j.r * 1.6) +
            w.hill * (3.4 + j.r * 1.3) +
            w.mountain * (2.6 + j.r * 1.0) +
            w.beach * (2.5 + j.r * 1.1);

          darkTint = w.mountain * 0.25 + w.hill * 0.08;
        }

        if (j.v >= density) {
          continue;
        }

        const effRadiusDoc = Math.max(radiusDoc, avgDocPerPx * 0.8);
        const rxPx = effRadiusDoc / docPerPxX;
        const ryPx = effRadiusDoc / docPerPxY;
        const shOffDoc = Math.min(1.4, effRadiusDoc * 0.28);
        const maxExtentDoc = effRadiusDoc * 1.15 + shOffDoc;

        const pMinX = Math.max(ox0, Math.floor((cxDoc - maxExtentDoc) / docPerPxX));
        const pMaxX = Math.min(ox1, Math.ceil((cxDoc + maxExtentDoc) / docPerPxX));
        const pMinY = Math.max(oy0, Math.floor((cyDoc - maxExtentDoc) / docPerPxY));
        const pMaxY = Math.min(oy1, Math.ceil((cyDoc + maxExtentDoc) / docPerPxY));

        if (pMinX > pMaxX || pMinY > pMaxY) continue;

        const treeToneShift = (j.dx - 0.5) * 14 - darkTint * 16;
        const crownR = palette.forest.r + treeToneShift;
        const crownG = palette.forest.g + treeToneShift * 0.9;
        const crownB = palette.forest.b + treeToneShift * 0.7;

        const shR = palette.forestShadow.r - darkTint * 10;
        const shG = palette.forestShadow.g - darkTint * 10;
        const shB = palette.forestShadow.b - darkTint * 8;

        const lobePhase1 = j.r * 6.28318;
        const lobePhase2 = j.v * 6.28318;
        const cosP1 = Math.cos(lobePhase1);
        const sinP1 = Math.sin(lobePhase1);
        const cosP2 = Math.cos(lobePhase2);
        const sinP2 = Math.sin(lobePhase2);
        const canModulateLobes = rxPx >= 2.0 && ryPx >= 2.0;
        const maxCrownR = effRadiusDoc * 1.15;
        const maxCrownRSq = maxCrownR * maxCrownR;
        const maxShadowR = effRadiusDoc * 0.95;
        const maxShadowRSq = maxShadowR * maxShadowR;

        for (let py = pMinY; py <= pMaxY; py += 1) {
          const docY = (py + 0.5) * docPerPxY;
          const dy = docY - cyDoc;
          const dySq = dy * dy;
          const sdy = dy - shOffDoc;
          const sdySq = sdy * sdy;
          const docRow = py * widthPx;

          for (let px = pMinX; px <= pMaxX; px += 1) {
            const idx = docRow + px;
            if (mask[idx] < LAND_MASK_THRESHOLD || cover[idx] !== COVER_FOREST) {
              continue;
            }

            const docX = (px + 0.5) * docPerPxX;
            const dx = docX - cxDoc;
            const distSq = dx * dx + dySq;
            const sdx = dx - shOffDoc;
            const sDistSq = sdx * sdx + sdySq;

            if (distSq > maxCrownRSq && sDistSq > maxShadowRSq) {
              continue;
            }

            const off = idx * 4;
            let r = rgba[off];
            let g = rgba[off + 1];
            let b = rgba[off + 2];

            // SE ground shadow beneath canopy
            if (sDistSq < maxShadowRSq) {
              const sDist = Math.sqrt(sDistSq);
              const sAlpha = (1 - smoothstepRange(effRadiusDoc * 0.45, maxShadowR, sDist)) * 0.22;
              r += (shR - r) * sAlpha;
              g += (shG - g) * sAlpha;
              b += (shB - b) * sAlpha;
            }

            // Canopy body
            if (distSq <= maxCrownRSq) {
              const dist = Math.sqrt(distSq);
              let localR = effRadiusDoc;
              if (canModulateLobes && dist > 1e-4) {
                const invD = 1 / dist;
                const ux = dx * invD;
                const uy = dy * invD;
                const ux2 = ux * ux;
                const uy2 = uy * uy;
                const cos3 = 4 * ux2 * ux - 3 * ux;
                const sin3 = 3 * uy - 4 * uy2 * uy;
                const cos5 = (16 * ux2 * ux2 - 20 * ux2 + 5) * ux;
                const sin5 = (16 * uy2 * uy2 - 20 * uy2 + 5) * uy;
                const lobe3 = sin3 * cosP1 + cos3 * sinP1;
                const lobe5 = cos5 * cosP2 + sin5 * sinP2;
                localR *= 1 + 0.09 * lobe3 + 0.05 * lobe5;
              }

              const rNorm = dist / localR;
              if (rNorm <= 1.0) {
                const alpha = 1 - smoothstepRange(0.78, 1.0, rNorm);
                const nwDot = (-dx - dy) / (localR * 1.414);

                let tr = crownR;
                let tg = crownG;
                let tb = crownB;

                if (nwDot > 0.1) {
                  const hi = smoothstepRange(0.1, 0.85, nwDot) * 16;
                  tr += hi * 0.9;
                  tg += hi;
                  tb += hi * 0.65;
                } else if (nwDot < 0) {
                  const shT = smoothstepRange(0, -0.75, nwDot) * 0.78;
                  tr += (shR - tr) * shT;
                  tg += (shG - tg) * shT;
                  tb += (shB - tb) * shT;
                }

                // Subtle ink contour on SE lower rim of canopy
                if (rNorm > 0.7 && nwDot < 0.15) {
                  const rimT = smoothstepRange(0.7, 0.96, rNorm) * 0.28;
                  tr += (palette.ink.r - tr) * rimT;
                  tg += (palette.ink.g - tg) * rimT;
                  tb += (palette.ink.b - tb) * rimT;
                }

                r += (tr - r) * alpha;
                g += (tg - g) * alpha;
                b += (tb - b) * alpha;
              }
            }

            rgba[off] = clampByte(r);
            rgba[off + 1] = clampByte(g);
            rgba[off + 2] = clampByte(b);
          }
        }
      }
    }
  }
}

const PARCEL_COS = [1, Math.SQRT1_2, 0, -Math.SQRT1_2];
const PARCEL_SIN = [0, Math.SQRT1_2, 1, Math.SQRT1_2];

function evaluatePlainFieldsInto(
  docX: number,
  docY: number,
  parcelSeed: number,
  warpSeed: number,
  palette: ParsedThemePalette,
  out: RgbColor
): void {
  const wx = docX + (valueNoise2D(warpSeed, docX * 0.045, docY * 0.045) - 0.5) * 4.5;
  const wy = docY + (valueNoise2D((warpSeed + 17) >>> 0, docX * 0.045, docY * 0.045) - 0.5) * 4.5;

  const row = Math.floor(wy / PARCEL_H_DOC);
  const rowShift = hash2DFloat(parcelSeed, 0, row) * PARCEL_W_DOC * 0.65;
  const sx = wx + rowShift;
  const col = Math.floor(sx / PARCEL_W_DOC);

  const localX = sx - col * PARCEL_W_DOC;
  const localY = wy - row * PARCEL_H_DOC;

  const h = hash2D((parcelSeed + 31) >>> 0, col, row);
  const angleIdx = h & 3;
  const proj = docX * PARCEL_COS[angleIdx] + docY * PARCEL_SIN[angleIdx];
  const furrowWave = 0.5 + 0.5 * Math.sin(proj * ((Math.PI * 2) / 4.2));

  const toneShift = (((h >>> 8) & 0xff) / 255 - 0.5) * 14;
  const edgeDist = Math.min(localX, PARCEL_W_DOC - localX, localY, PARCEL_H_DOC - localY);
  const borderT = 1 - smoothstepRange(0, 1.4, edgeDist);

  const mixT = Math.min(1, furrowWave * 0.72 + borderT * 0.6);
  out.r = palette.fields.r + (palette.fieldsFurrow.r - palette.fields.r) * mixT + toneShift;
  out.g = palette.fields.g + (palette.fieldsFurrow.g - palette.fields.g) * mixT + toneShift * 0.85;
  out.b = palette.fields.b + (palette.fieldsFurrow.b - palette.fields.b) * mixT + toneShift * 0.5;
}

function evaluateReactiveFieldsInto(
  docX: number,
  docY: number,
  heightVal: number,
  distWaterDoc: number,
  slope: number,
  w: BiomeWeights,
  parcelSeed: number,
  warpSeed: number,
  terraceSeed: number,
  palette: ParsedThemePalette,
  plainRgb: RgbColor,
  out: FieldShadeOut
): void {
  evaluatePlainFieldsInto(docX, docY, parcelSeed, warpSeed, palette, plainRgb);

  // Contour-aligned furrows on hills
  let hillR = plainRgb.r;
  let hillG = plainRgb.g;
  let hillB = plainRgb.b;
  if (w.hill > 0.01) {
    const slopeWeight = smoothstepRange(0.18, 0.75, slope);
    const contourNoise = (valueNoise2D((warpSeed + 99) >>> 0, docX * 0.04, docY * 0.04) - 0.5) * 1.4;
    const contourWave = 0.5 + 0.5 * Math.sin(heightVal * 0.72 + contourNoise);
    const cR = palette.fields.r + (palette.fieldsFurrow.r - palette.fields.r) * (contourWave * 0.78);
    const cG = palette.fields.g + (palette.fieldsFurrow.g - palette.fields.g) * (contourWave * 0.78);
    const cB = palette.fields.b + (palette.fieldsFurrow.b - palette.fields.b) * (contourWave * 0.78);
    hillR = plainRgb.r + (cR - plainRgb.r) * slopeWeight;
    hillG = plainRgb.g + (cG - plainRgb.g) * slopeWeight;
    hillB = plainRgb.b + (cB - plainRgb.b) * slopeWeight;
  }

  // Discontinuous mountain terraces
  let mtnAlpha = 0;
  let mtnR = palette.fields.r;
  let mtnG = palette.fields.g;
  let mtnB = palette.fields.b;
  if (w.mountain > 0.01) {
    const pocket = smoothstepRange(0.46, 0.7, valueNoise2D(terraceSeed, docX * 0.055, docY * 0.055));
    const crestFade = 1 - smoothstepRange(205, 235, heightVal);
    const steepFade = 1 - smoothstepRange(5.5, 11.0, slope);
    mtnAlpha = pocket * crestFade * steepFade * 0.78;
    const stepWave = Math.pow(0.5 + 0.5 * Math.sin(heightVal * 0.85), 1.45);
    mtnR = palette.fields.r + (palette.stone.r - palette.fields.r) * (stepWave * 0.68);
    mtnG = palette.fields.g + (palette.stone.g - palette.fields.g) * (stepWave * 0.68);
    mtnB = palette.fields.b + (palette.stone.b - palette.fields.b) * (stepWave * 0.68);
  }

  // Beach attenuation keeping shoreline sand bright and legible
  const beachFade = distWaterDoc < 3.0 ? 0 : 0.25 * smoothstepRange(3.0, 8.0, distWaterDoc);

  out.alpha =
    w.plain * 0.86 +
    w.hill * 0.74 +
    w.mountain * mtnAlpha +
    w.beach * beachFade;

  const nonMtnWeight = w.plain + w.hill + w.beach;
  const totalW = nonMtnWeight + w.mountain;
  out.r =
    totalW > 0
      ? ((plainRgb.r * w.plain + hillR * w.hill + plainRgb.r * w.beach) + mtnR * w.mountain) / totalW
      : plainRgb.r;
  out.g =
    totalW > 0
      ? ((plainRgb.g * w.plain + hillG * w.hill + plainRgb.g * w.beach) + mtnG * w.mountain) / totalW
      : plainRgb.g;
  out.b =
    totalW > 0
      ? ((plainRgb.b * w.plain + hillB * w.hill + plainRgb.b * w.beach) + mtnB * w.mountain) / totalW
      : plainRgb.b;
}
