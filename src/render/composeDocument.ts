import { zlibSync } from 'fflate';
import { LoadedAssetMap } from '../assets/types';
import { MapDocument } from '../model/document';
import { TerrainRenderer } from '../terrain';
import { ITerrainRenderer } from '../terrain/types';
import { getFontSpec } from '../theme/theme';
import { drawMapObjectsToContext } from './objectMetrics';

export interface ComposeDocumentOptions {
  widthPx: number;
  heightPx: number;
  existingTerrainRenderer?: ITerrainRenderer;
  targetCanvas?: HTMLCanvasElement;
}

export interface TerrainRgbaBuffer {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeU32BE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeU32BE(chunk, 0, data.length);
  for (let i = 0; i < 4; i += 1) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  writeU32BE(chunk, 8 + data.length, crc);
  return chunk;
}

function assertPositiveInt(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Dimensione non valida per ${label}: ${value}.`);
  }
  return Math.max(1, Math.round(value));
}

function createTempCanvasWithPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Impossibile creare una superficie canvas temporanea senza DOM.');
  }
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = width;
  tmpCanvas.height = height;
  const tmpCtx = tmpCanvas.getContext('2d');
  if (!tmpCtx) {
    tmpCanvas.width = 0;
    tmpCanvas.height = 0;
    throw new Error('Contesto 2D non disponibile per la superficie terreno temporanea.');
  }
  const imgData = tmpCtx.createImageData(width, height);
  imgData.data.set(rgba);
  tmpCtx.putImageData(imgData, 0, 0);
  return tmpCanvas;
}

interface TerrainRendererFreshnessProbe {
  matchesDocument?: (doc: MapDocument) => boolean;
}

function isRendererFreshForDocument(
  renderer: ITerrainRenderer,
  doc: MapDocument
): boolean {
  const probe = renderer as unknown as TerrainRendererFreshnessProbe;
  if (typeof probe.matchesDocument === 'function') {
    return probe.matchesDocument(doc) !== false;
  }
  return true;
}

function hasMatchingPixelData(
  renderer: ITerrainRenderer,
  expectedWidth: number,
  expectedHeight: number
): boolean {
  const data = renderer.getPixelData();
  return (
    data.width === expectedWidth &&
    data.height === expectedHeight &&
    data.rgba.length === expectedWidth * expectedHeight * 4
  );
}

/**
 * Explicitly loads all unique font variants used by label objects (plus the
 * theme default font) via `document.fonts.load(...)` and awaits `document.fonts.ready`.
 */
export async function ensureDocumentFontsLoaded(doc: MapDocument): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    return;
  }

  const fontIds = new Set<string>([doc.theme.fonts.defaultFontId]);
  const sampleTextByFontId = new Map<string, string>();
  for (const obj of doc.manifest.objects) {
    if (obj.type === 'label') {
      fontIds.add(obj.fontId);
      if (obj.text) {
        const existing = sampleTextByFontId.get(obj.fontId) ?? '';
        sampleTextByFontId.set(obj.fontId, existing ? `${existing} ${obj.text}` : obj.text);
      }
    }
  }

  const descriptorSamples = new Map<string, string>();
  for (const fontId of fontIds) {
    const spec = getFontSpec(doc.theme, fontId);
    const descriptor = `${spec.italic ? 'italic ' : ''}${spec.weight} 32px ${spec.family}`;
    const sample = sampleTextByFontId.get(fontId) ?? '';
    const prev = descriptorSamples.get(descriptor) ?? '';
    const merged = sample ? (prev ? `${prev} ${sample}` : sample) : prev;
    descriptorSamples.set(descriptor, merged);
  }

  if (typeof document.fonts.load === 'function') {
    await Promise.allSettled(
      Array.from(descriptorSamples.entries(), ([descriptor, sample]) =>
        sample ? document.fonts.load(descriptor, sample) : document.fonts.load(descriptor)
      )
    );
  }

  if (document.fonts.ready) {
    await document.fonts.ready;
  }
}

/**
 * Produces the exact terrain RGBA buffer using `TerrainRenderer` (reusing
 * `existingTerrainRenderer` when dimensions and document freshness match,
 * otherwise creating and disposing a dedicated `TerrainRenderer` instance).
 */
export function composeDocumentTerrainRgba(
  doc: MapDocument,
  existingTerrainRenderer?: ITerrainRenderer
): TerrainRgbaBuffer {
  const expectedWidth = assertPositiveInt(doc.terrain.widthPx, 'terrain.widthPx');
  const expectedHeight = assertPositiveInt(doc.terrain.heightPx, 'terrain.heightPx');

  if (
    existingTerrainRenderer &&
    isRendererFreshForDocument(existingTerrainRenderer, doc) &&
    hasMatchingPixelData(existingTerrainRenderer, expectedWidth, expectedHeight)
  ) {
    const existing = existingTerrainRenderer.getPixelData();
    return {
      width: existing.width,
      height: existing.height,
      rgba: new Uint8ClampedArray(existing.rgba)
    };
  }

  const localRenderer = new TerrainRenderer();
  try {
    localRenderer.renderFull(doc);
    const data = localRenderer.getPixelData();
    if (
      data.width !== expectedWidth ||
      data.height !== expectedHeight ||
      data.rgba.length !== expectedWidth * expectedHeight * 4
    ) {
      throw new Error('Dimensioni del buffer terreno non coerenti con il documento.');
    }
    return {
      width: data.width,
      height: data.height,
      rgba: data.rgba
    };
  } finally {
    localRenderer.dispose();
  }
}

/**
 * Pure TypeScript RGBA-to-PNG encoder backed by `fflate.zlibSync` with optional
 * bilinear resampling so headless/Node environments can emit full print-size PNGs.
 */
export function encodeRgbaPng(
  rgba: Uint8Array | Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  targetWidth = srcWidth,
  targetHeight = srcHeight
): Uint8Array {
  const sW = assertPositiveInt(srcWidth, 'srcWidth');
  const sH = assertPositiveInt(srcHeight, 'srcHeight');
  const dW = assertPositiveInt(targetWidth, 'targetWidth');
  const dH = assertPositiveInt(targetHeight, 'targetHeight');

  if (rgba.length !== sW * sH * 4) {
    throw new Error(
      `Lunghezza buffer RGBA (${rgba.length}) non coerente con ${sW}×${sH}.`
    );
  }

  const dstStride = dW * 4;
  const raw = new Uint8Array((dstStride + 1) * dH);

  if (dW === sW && dH === sH) {
    for (let y = 0; y < dH; y += 1) {
      const rowOut = y * (dstStride + 1);
      raw[rowOut] = 0; // Filter None
      const rowIn = y * dstStride;
      raw.set(rgba.subarray(rowIn, rowIn + dstStride), rowOut + 1);
    }
  } else {
    const srcX0 = new Int32Array(dW);
    const srcX1 = new Int32Array(dW);
    const fx = new Float32Array(dW);
    for (let x = 0; x < dW; x += 1) {
      const gx = dW > 1 ? ((x + 0.5) / dW) * sW - 0.5 : 0;
      const clampedX = Math.max(0, Math.min(sW - 1, gx));
      const x0 = Math.floor(clampedX);
      srcX0[x] = x0;
      srcX1[x] = Math.min(sW - 1, x0 + 1);
      fx[x] = clampedX - x0;
    }

    const srcStride = sW * 4;
    for (let y = 0; y < dH; y += 1) {
      const rowOut = y * (dstStride + 1);
      raw[rowOut] = 0; // Filter None

      const gy = dH > 1 ? ((y + 0.5) / dH) * sH - 0.5 : 0;
      const clampedY = Math.max(0, Math.min(sH - 1, gy));
      const y0 = Math.floor(clampedY);
      const y1 = Math.min(sH - 1, y0 + 1);
      const fy = clampedY - y0;
      const oneMinusFy = 1 - fy;
      const row0 = y0 * srcStride;
      const row1 = y1 * srcStride;

      for (let x = 0; x < dW; x += 1) {
        const wx = fx[x];
        const oneMinusWx = 1 - wx;
        const w00 = oneMinusWx * oneMinusFy;
        const w10 = wx * oneMinusFy;
        const w01 = oneMinusWx * fy;
        const w11 = wx * fy;

        const i00 = row0 + srcX0[x] * 4;
        const i10 = row0 + srcX1[x] * 4;
        const i01 = row1 + srcX0[x] * 4;
        const i11 = row1 + srcX1[x] * 4;

        const outOff = rowOut + 1 + x * 4;
        raw[outOff] = Math.round(
          rgba[i00] * w00 + rgba[i10] * w10 + rgba[i01] * w01 + rgba[i11] * w11
        );
        raw[outOff + 1] = Math.round(
          rgba[i00 + 1] * w00 + rgba[i10 + 1] * w10 + rgba[i01 + 1] * w01 + rgba[i11 + 1] * w11
        );
        raw[outOff + 2] = Math.round(
          rgba[i00 + 2] * w00 + rgba[i10 + 2] * w10 + rgba[i01 + 2] * w01 + rgba[i11 + 2] * w11
        );
        raw[outOff + 3] = Math.round(
          rgba[i00 + 3] * w00 + rgba[i10 + 3] * w10 + rgba[i01 + 3] * w01 + rgba[i11 + 3] * w11
        );
      }
    }
  }

  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, dW);
  writeU32BE(ihdr, 4, dH);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // zlib compression
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // non-interlaced

  const compressed = zlibSync(raw, { level: 1 });
  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', compressed);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let pos = 0;
  out.set(PNG_SIGNATURE, pos);
  pos += PNG_SIGNATURE.length;
  out.set(ihdrChunk, pos);
  pos += ihdrChunk.length;
  out.set(idatChunk, pos);
  pos += idatChunk.length;
  out.set(iendChunk, pos);
  return out;
}

/**
 * Shared full-document compositor for live print previews and PDF export.
 * Reuses `TerrainRenderer` and `drawMapObjectsToContext` with strict page
 * clipping and never includes camera state, selection handles, cursors, or
 * registration marks.
 */
export function composeDocumentToCanvas(
  doc: MapDocument,
  assets: LoadedAssetMap,
  options: ComposeDocumentOptions
): HTMLCanvasElement {
  const widthPx = assertPositiveInt(options.widthPx, 'widthPx');
  const heightPx = assertPositiveInt(options.heightPx, 'heightPx');
  const terrainW = assertPositiveInt(doc.terrain.widthPx, 'terrain.widthPx');
  const terrainH = assertPositiveInt(doc.terrain.heightPx, 'terrain.heightPx');

  const ownsTargetCanvas = !options.targetCanvas;
  let targetCanvas: HTMLCanvasElement;
  if (options.targetCanvas) {
    targetCanvas = options.targetCanvas;
  } else if (typeof document !== 'undefined') {
    targetCanvas = document.createElement('canvas');
  } else {
    throw new Error('Composizione su canvas non disponibile in ambiente privo di DOM.');
  }

  targetCanvas.width = widthPx;
  targetCanvas.height = heightPx;

  const ctx = targetCanvas.getContext('2d');
  if (!ctx) {
    if (ownsTargetCanvas) {
      targetCanvas.width = 0;
      targetCanvas.height = 0;
    }
    throw new Error('Contesto 2D del canvas non disponibile per la composizione.');
  }

  let localRenderer: TerrainRenderer | null = null;
  let tempTerrainCanvas: HTMLCanvasElement | null = null;

  try {
    let terrainSource: HTMLCanvasElement | null = null;
    const canReuseExisting =
      options.existingTerrainRenderer !== undefined &&
      isRendererFreshForDocument(options.existingTerrainRenderer, doc);

    const existingCanvas = canReuseExisting
      ? options.existingTerrainRenderer?.getCanvas() ?? null
      : null;
    if (
      existingCanvas &&
      existingCanvas.width === terrainW &&
      existingCanvas.height === terrainH
    ) {
      terrainSource = existingCanvas;
    } else if (
      canReuseExisting &&
      options.existingTerrainRenderer &&
      hasMatchingPixelData(options.existingTerrainRenderer, terrainW, terrainH)
    ) {
      const data = options.existingTerrainRenderer.getPixelData();
      tempTerrainCanvas = createTempCanvasWithPixels(data.rgba, data.width, data.height);
      terrainSource = tempTerrainCanvas;
    } else {
      localRenderer = new TerrainRenderer();
      localRenderer.renderFull(doc);
      const localCanvas = localRenderer.getCanvas();
      if (
        localCanvas &&
        localCanvas.width === terrainW &&
        localCanvas.height === terrainH
      ) {
        terrainSource = localCanvas;
      } else {
        const data = localRenderer.getPixelData();
        if (
          data.width !== terrainW ||
          data.height !== terrainH ||
          data.rgba.length !== terrainW * terrainH * 4
        ) {
          throw new Error('Buffer terreno generato con dimensioni non valide.');
        }
        tempTerrainCanvas = createTempCanvasWithPixels(data.rgba, data.width, data.height);
        terrainSource = tempTerrainCanvas;
      }
    }

    ctx.save();
    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.beginPath();
    ctx.rect(0, 0, widthPx, heightPx);
    ctx.clip();

    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) {
      ctx.imageSmoothingQuality = 'high';
    }
    ctx.drawImage(terrainSource, 0, 0, widthPx, heightPx);

    const scaleX = widthPx / doc.manifest.space.width;
    const scaleY = heightPx / doc.manifest.space.height;
    drawMapObjectsToContext(ctx, doc, assets, scaleX, scaleY);
    ctx.restore();

    return targetCanvas;
  } catch (err) {
    if (ownsTargetCanvas) {
      targetCanvas.width = 0;
      targetCanvas.height = 0;
    }
    throw err;
  } finally {
    if (tempTerrainCanvas) {
      tempTerrainCanvas.width = 0;
      tempTerrainCanvas.height = 0;
      tempTerrainCanvas = null;
    }
    if (localRenderer) {
      localRenderer.dispose();
      localRenderer = null;
    }
  }
}
