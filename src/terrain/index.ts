import {
  DocSpace,
  ResizeAnchor,
  ResizeCanvasMode,
  computeAnchorOffset,
  docToMaskX,
  docToMaskY
} from '../model/coordinates';
import {
  COVER_NATURAL,
  CoverCode,
  MAX_COVER_CODE,
  MapDocument,
  TerrainBuffers
} from '../model/document';
import {
  CellClassification,
  ElevationGradient,
  LAND_MASK_THRESHOLD,
  classifyCell,
  computeCliffFactor,
  computeElevationGradient,
  computeLocalWaterDistancePx
} from './classifier';

export * from './types';
export {
  BRUSH_TILE_SIZE_PX,
  TerrainStrokeSession
} from './brush';
export { TerrainRenderer } from './renderer';
export {
  LAND_MASK_THRESHOLD,
  classifyCell,
  computeCliffFactor,
  computeElevationGradient,
  computeLocalLandDistancePx,
  computeLocalWaterDistancePx
} from './classifier';
export type {
  BiomeWeights,
  CellClassification,
  ElevationGradient
} from './classifier';
export {
  cellJitter,
  fbm2D,
  hash2D,
  hash2DBipolar,
  hash2DFloat,
  smoothstep01,
  valueNoise2D
} from './noise';
export type { CellJitterSample } from './noise';

export interface TerrainCellInspection {
  px: number;
  py: number;
  mask: number;
  height: number;
  cover: CoverCode;
  isLand: boolean;
  distToWaterDoc: number;
  classification: CellClassification;
  gradient: ElevationGradient;
  cliffFactor: number;
}

function docToClampedMaskCoords(
  doc: MapDocument,
  docX: number,
  docY: number
): { px: number; py: number } | null {
  const { space } = doc.manifest;
  const { widthPx, heightPx } = doc.terrain;
  if (
    !Number.isFinite(docX) ||
    !Number.isFinite(docY) ||
    docX < 0 ||
    docY < 0 ||
    docX > space.width ||
    docY > space.height
  ) {
    return null;
  }

  const px = Math.min(widthPx - 1, Math.max(0, Math.floor(docToMaskX(docX, space, doc.terrain))));
  const py = Math.min(heightPx - 1, Math.max(0, Math.floor(docToMaskY(docY, space, doc.terrain))));
  return { px, py };
}

/**
 * Returns true if the document-space point falls within the page and on land (`mask >= 128`).
 */
export function isPointOnLand(doc: MapDocument, docX: number, docY: number): boolean {
  const coords = docToClampedMaskCoords(doc, docX, docY);
  if (!coords) return false;
  const idx = coords.py * doc.terrain.widthPx + coords.px;
  return doc.terrain.mask[idx] >= LAND_MASK_THRESHOLD;
}

/**
 * Inspects terrain buffers, coastal distance, biome classification, local gradient,
 * and cliff factor at a document-space coordinate.
 */
export function inspectCellAtDoc(
  doc: MapDocument,
  docX: number,
  docY: number
): TerrainCellInspection | null {
  const coords = docToClampedMaskCoords(doc, docX, docY);
  if (!coords) return null;

  const { px, py } = coords;
  const { space } = doc.manifest;
  const { widthPx, heightPx, mask, height, cover } = doc.terrain;
  const idx = py * widthPx + px;

  const maskVal = mask[idx];
  const heightVal = height[idx];
  const coverVal = cover[idx] as CoverCode;

  const maxPxPerDoc = Math.max(widthPx / space.width, heightPx / space.height);
  const avgDocPerPx = 0.5 * (space.width / widthPx + space.height / heightPx);
  const maxSearchDoc = doc.theme.elevation.beachMaxCoastDistDoc + 4;
  const maxDistPx = Math.ceil(maxSearchDoc * maxPxPerDoc) + 2;

  const distWaterPx = computeLocalWaterDistancePx(
    mask,
    widthPx,
    heightPx,
    { x: px, y: py, width: 1, height: 1 },
    maxDistPx
  )[0];
  const distToWaterDoc = distWaterPx * avgDocPerPx;

  const classification = classifyCell(maskVal, heightVal, distToWaterDoc, doc.theme);
  const gradient = computeElevationGradient(height, widthPx, heightPx, px, py, space, doc.terrain);
  const cliffFactor = computeCliffFactor(heightVal, distToWaterDoc, gradient.slope);

  return {
    px,
    py,
    mask: maskVal,
    height: heightVal,
    cover: coverVal,
    isLand: maskVal >= LAND_MASK_THRESHOLD,
    distToWaterDoc,
    classification,
    gradient,
    cliffFactor
  };
}

function clampInt(val: number, min: number, max: number): number {
  if (val <= min) return min;
  if (val >= max) return max;
  return val;
}

function clampByteRounded(val: number): number {
  const r = Math.round(val);
  if (r <= 0) return 0;
  if (r >= 255) return 255;
  return r;
}

/**
 * Resizes terrain buffers (mask, height, cover) either by anchoring/cropping
 * (`expand-crop`, filling newly exposed margins with sea `0`) or by proportional
 * resampling (`scale-content`, using nearest-neighbor for discrete cover codes 0..9).
 */
export function resizeTerrainBuffers(
  before: TerrainBuffers,
  beforeSpace: DocSpace,
  newSpace: DocSpace,
  newWidthPx: number,
  newHeightPx: number,
  mode: ResizeCanvasMode,
  anchor: ResizeAnchor
): TerrainBuffers {
  if (!Number.isInteger(newWidthPx) || !Number.isInteger(newHeightPx) || newWidthPx <= 0 || newHeightPx <= 0) {
    throw new Error(`Dimensioni buffer terreno non valide (${newWidthPx} × ${newHeightPx}).`);
  }
  if (
    !Number.isFinite(beforeSpace.width) ||
    !Number.isFinite(beforeSpace.height) ||
    beforeSpace.width <= 0 ||
    beforeSpace.height <= 0 ||
    !Number.isFinite(newSpace.width) ||
    !Number.isFinite(newSpace.height) ||
    newSpace.width <= 0 ||
    newSpace.height <= 0
  ) {
    throw new Error('Spazio logico non valido per il ridimensionamento del terreno.');
  }

  const totalCells = newWidthPx * newHeightPx;
  const mask = new Uint8Array(totalCells);
  const height = new Uint8Array(totalCells);
  const cover = new Uint8Array(totalCells);

  const srcW = before.widthPx;
  const srcH = before.heightPx;
  if (srcW <= 0 || srcH <= 0) {
    return { widthPx: newWidthPx, heightPx: newHeightPx, mask, height, cover };
  }

  if (mode === 'expand-crop') {
    const { dx, dy } = computeAnchorOffset(
      beforeSpace.width,
      beforeSpace.height,
      newSpace.width,
      newSpace.height,
      anchor
    );
    const offsetX = Math.round(docToMaskX(dx, newSpace, { widthPx: newWidthPx, heightPx: newHeightPx }));
    const offsetY = Math.round(docToMaskY(dy, newSpace, { widthPx: newWidthPx, heightPx: newHeightPx }));

    const dstX0 = Math.max(0, offsetX);
    const dstY0 = Math.max(0, offsetY);
    const dstX1 = Math.min(newWidthPx, offsetX + srcW);
    const dstY1 = Math.min(newHeightPx, offsetY + srcH);

    if (dstX1 > dstX0 && dstY1 > dstY0) {
      const copyW = dstX1 - dstX0;
      const srcX0 = dstX0 - offsetX;
      for (let py = dstY0; py < dstY1; py += 1) {
        const sy = py - offsetY;
        const srcStart = sy * srcW + srcX0;
        const dstStart = py * newWidthPx + dstX0;
        mask.set(before.mask.subarray(srcStart, srcStart + copyW), dstStart);
        height.set(before.height.subarray(srcStart, srcStart + copyW), dstStart);
        cover.set(before.cover.subarray(srcStart, srcStart + copyW), dstStart);
      }
    }

    return { widthPx: newWidthPx, heightPx: newHeightPx, mask, height, cover };
  }

  // 'scale-content'
  if (newWidthPx === srcW && newHeightPx === srcH) {
    mask.set(before.mask);
    height.set(before.height);
    cover.set(before.cover);
    return { widthPx: newWidthPx, heightPx: newHeightPx, mask, height, cover };
  }

  const nnXMap = new Int32Array(newWidthPx);
  for (let dx = 0; dx < newWidthPx; dx += 1) {
    nnXMap[dx] = clampInt(Math.floor(((dx + 0.5) / newWidthPx) * srcW), 0, srcW - 1);
  }

  const scaleX = newWidthPx / srcW;
  const scaleY = newHeightPx / srcH;

  if (scaleX >= 0.5 && scaleY >= 0.5) {
    // Bilinear resampling for mask & height, nearest-neighbor for discrete cover codes
    const x0Map = new Int32Array(newWidthPx);
    const x1Map = new Int32Array(newWidthPx);
    const wxMap = new Float32Array(newWidthPx);

    for (let dx = 0; dx < newWidthPx; dx += 1) {
      const sx = ((dx + 0.5) / newWidthPx) * srcW - 0.5;
      const ix0 = Math.floor(sx);
      const frac = sx - ix0;
      x0Map[dx] = clampInt(ix0, 0, srcW - 1);
      x1Map[dx] = clampInt(ix0 + 1, 0, srcW - 1);
      wxMap[dx] = frac;
    }

    const srcMask = before.mask;
    const srcHeight = before.height;
    const srcCover = before.cover;

    for (let dy = 0; dy < newHeightPx; dy += 1) {
      const sy = ((dy + 0.5) / newHeightPx) * srcH - 0.5;
      const iy0 = Math.floor(sy);
      const wy = sy - iy0;
      const y0 = clampInt(iy0, 0, srcH - 1);
      const y1 = clampInt(iy0 + 1, 0, srcH - 1);
      const nnY = clampInt(Math.floor(((dy + 0.5) / newHeightPx) * srcH), 0, srcH - 1);

      const row0 = y0 * srcW;
      const row1 = y1 * srcW;
      const nnRow = nnY * srcW;
      const dstRow = dy * newWidthPx;
      const wy0 = 1 - wy;
      const wy1 = wy;

      for (let dx = 0; dx < newWidthPx; dx += 1) {
        const x0 = x0Map[dx];
        const x1 = x1Map[dx];
        const wx1 = wxMap[dx];
        const wx0 = 1 - wx1;

        const w00 = wx0 * wy0;
        const w10 = wx1 * wy0;
        const w01 = wx0 * wy1;
        const w11 = wx1 * wy1;

        const i00 = row0 + x0;
        const i10 = row0 + x1;
        const i01 = row1 + x0;
        const i11 = row1 + x1;

        const m00 = srcMask[i00];
        const m10 = srcMask[i10];
        const m01 = srcMask[i01];
        const m11 = srcMask[i11];

        const outMask = clampByteRounded(m00 * w00 + m10 * w10 + m01 * w01 + m11 * w11);
        const dstIdx = dstRow + dx;
        mask[dstIdx] = outMask;

        if (outMask === 0) {
          height[dstIdx] = 0;
          cover[dstIdx] = COVER_NATURAL;
          continue;
        }

        // Preserve coastal elevation cleanly by weighting land corners when present
        let hSum = 0;
        let hWeight = 0;
        if (m00 >= LAND_MASK_THRESHOLD) {
          hSum += srcHeight[i00] * w00;
          hWeight += w00;
        }
        if (m10 >= LAND_MASK_THRESHOLD) {
          hSum += srcHeight[i10] * w10;
          hWeight += w10;
        }
        if (m01 >= LAND_MASK_THRESHOLD) {
          hSum += srcHeight[i01] * w01;
          hWeight += w01;
        }
        if (m11 >= LAND_MASK_THRESHOLD) {
          hSum += srcHeight[i11] * w11;
          hWeight += w11;
        }

        const outHeight =
          hWeight > 0
            ? clampByteRounded(hSum / hWeight)
            : clampByteRounded(
                srcHeight[i00] * w00 +
                  srcHeight[i10] * w10 +
                  srcHeight[i01] * w01 +
                  srcHeight[i11] * w11
              );
        height[dstIdx] = outHeight;

        const rawCover = srcCover[nnRow + nnXMap[dx]];
        cover[dstIdx] = rawCover <= MAX_COVER_CODE ? rawCover : COVER_NATURAL;
      }
    }

    return { widthPx: newWidthPx, heightPx: newHeightPx, mask, height, cover };
  }

  // Box/area averaging for >2x downscale on mask & height, nearest-neighbor for cover
  const invScaleX = srcW / newWidthPx;
  const invScaleY = srcH / newHeightPx;
  const srcMask = before.mask;
  const srcHeight = before.height;
  const srcCover = before.cover;

  for (let dy = 0; dy < newHeightPx; dy += 1) {
    const sy0f = dy * invScaleY;
    const sy1f = (dy + 1) * invScaleY;
    const sy0 = clampInt(Math.floor(sy0f), 0, srcH - 1);
    const sy1 = clampInt(Math.ceil(sy1f) - 1, sy0, srcH - 1);
    const nnY = clampInt(Math.floor(((dy + 0.5) / newHeightPx) * srcH), 0, srcH - 1);
    const nnRow = nnY * srcW;
    const dstRow = dy * newWidthPx;

    for (let dx = 0; dx < newWidthPx; dx += 1) {
      const sx0f = dx * invScaleX;
      const sx1f = (dx + 1) * invScaleX;
      const sx0 = clampInt(Math.floor(sx0f), 0, srcW - 1);
      const sx1 = clampInt(Math.ceil(sx1f) - 1, sx0, srcW - 1);

      let totalArea = 0;
      let maskSum = 0;
      let allHeightSum = 0;
      let landArea = 0;
      let landHeightSum = 0;

      for (let sy = sy0; sy <= sy1; sy += 1) {
        const wy = Math.min(sy + 1, sy1f) - Math.max(sy, sy0f);
        if (wy <= 0) continue;
        const rowOff = sy * srcW;

        for (let sx = sx0; sx <= sx1; sx += 1) {
          const wx = Math.min(sx + 1, sx1f) - Math.max(sx, sx0f);
          if (wx <= 0) continue;
          const area = wx * wy;
          const idx = rowOff + sx;
          const m = srcMask[idx];
          const h = srcHeight[idx];

          totalArea += area;
          maskSum += m * area;
          allHeightSum += h * area;
          if (m >= LAND_MASK_THRESHOLD) {
            landArea += area;
            landHeightSum += h * area;
          }
        }
      }

      const dstIdx = dstRow + dx;
      const outMask = totalArea > 0 ? clampByteRounded(maskSum / totalArea) : 0;
      mask[dstIdx] = outMask;

      if (outMask === 0) {
        height[dstIdx] = 0;
        cover[dstIdx] = COVER_NATURAL;
        continue;
      }

      height[dstIdx] =
        landArea > 0
          ? clampByteRounded(landHeightSum / landArea)
          : totalArea > 0
            ? clampByteRounded(allHeightSum / totalArea)
            : 0;

      const rawCover = srcCover[nnRow + nnXMap[dx]];
      cover[dstIdx] = rawCover <= MAX_COVER_CODE ? rawCover : COVER_NATURAL;
    }
  }

  return { widthPx: newWidthPx, heightPx: newHeightPx, mask, height, cover };
}
