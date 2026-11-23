import { DirtyRectPx } from '../model/commands';
import { DocSpace, MaskDimensions } from '../model/coordinates';
import { MapTheme } from '../theme/theme';
import { BiomeKind } from './types';

export const LAND_MASK_THRESHOLD = 128;

const INF_DIST = 1e9;
const INF_SQ = 1e12;

export interface BiomeWeights {
  sea: number;
  beach: number;
  plain: number;
  hill: number;
  mountain: number;
}

export interface CellClassification {
  biome: BiomeKind;
  weights: BiomeWeights;
}

export interface ElevationGradient {
  gx: number;
  gy: number;
  slope: number;
}

export interface EdtScratch {
  v: Int32Array;
  z: Float32Array;
  rowIn: Float32Array;
  sqDist: Float32Array;
}

export function createEdtScratch(initialDim = 512): EdtScratch {
  return {
    v: new Int32Array(initialDim),
    z: new Float32Array(initialDim + 1),
    rowIn: new Float32Array(initialDim),
    sqDist: new Float32Array(initialDim * initialDim)
  };
}

function ensureEdtScratch(scratch: EdtScratch, sw: number, sh: number): void {
  const maxDim = Math.max(sw, sh);
  if (scratch.v.length < maxDim) {
    scratch.v = new Int32Array(maxDim);
    scratch.z = new Float32Array(maxDim + 1);
    scratch.rowIn = new Float32Array(maxDim);
  }
  const neededCells = sw * sh;
  if (scratch.sqDist.length < neededCells) {
    scratch.sqDist = new Float32Array(neededCells);
  }
}

export function smoothstepRange(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) {
    return x >= edge1 ? 1 : 0;
  }
  const t = (x - edge0) / (edge1 - edge0);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Computes smooth transition weights into a reusable BiomeWeights object (zero allocation).
 * Assumes cell is already on land (`mask >= LAND_MASK_THRESHOLD`) and `theme.mode === 'reactive'`.
 */
export function classifyLandWeightsInto(
  heightValue: number,
  distToWaterDoc: number,
  theme: MapTheme,
  outWeights: BiomeWeights
): BiomeKind {
  const { beachMaxHeight, beachMaxCoastDistDoc, plainMaxHeight, hillMaxHeight, blendWidth } =
    theme.elevation;

  let biome: BiomeKind;
  if (heightValue <= beachMaxHeight && distToWaterDoc <= beachMaxCoastDistDoc) {
    biome = 'beach';
  } else if (heightValue <= plainMaxHeight) {
    biome = 'plain';
  } else if (heightValue <= hillMaxHeight) {
    biome = 'hill';
  } else {
    biome = 'mountain';
  }

  outWeights.sea = 0;
  if (blendWidth <= 0) {
    outWeights.beach = biome === 'beach' ? 1 : 0;
    outWeights.plain = biome === 'plain' ? 1 : 0;
    outWeights.hill = biome === 'hill' ? 1 : 0;
    outWeights.mountain = biome === 'mountain' ? 1 : 0;
    return biome;
  }

  const hw = blendWidth * 0.5;
  const distHw = Math.min(2.5, Math.max(0.5, beachMaxCoastDistDoc * 0.25));
  const coastalFactor =
    beachMaxCoastDistDoc <= 0
      ? 0
      : 1 -
        smoothstepRange(
          beachMaxCoastDistDoc - distHw + 0.05,
          beachMaxCoastDistDoc + distHw + 0.05,
          distToWaterDoc
        );

  const lowBand = 1 - smoothstepRange(beachMaxHeight + 0.5 - hw, beachMaxHeight + 0.5 + hw, heightValue);
  const abovePlain = smoothstepRange(plainMaxHeight + 0.5 - hw, plainMaxHeight + 0.5 + hw, heightValue);
  const mountainBand = smoothstepRange(hillMaxHeight + 0.5 - hw, hillMaxHeight + 0.5 + hw, heightValue);
  const hillBand = Math.max(0, abovePlain - mountainBand);
  const plainBand = Math.max(0, 1 - lowBand - abovePlain);

  let beach = lowBand * coastalFactor;
  let plain = plainBand + lowBand * (1 - coastalFactor);
  let hill = hillBand;
  let mountain = mountainBand;

  const total = beach + plain + hill + mountain;
  if (total > 0 && Math.abs(total - 1) > 1e-6) {
    const inv = 1 / total;
    beach *= inv;
    plain *= inv;
    hill *= inv;
    mountain *= inv;
  }

  outWeights.beach = beach;
  outWeights.plain = plain;
  outWeights.hill = hill;
  outWeights.mountain = mountain;
  return biome;
}

/**
 * Computes discrete biome classification and smooth transition weights around
 * elevation thresholds (31, 111, 191) and coastal beach distance (12 doc units).
 */
export function classifyCell(
  maskValue: number,
  heightValue: number,
  distToWaterDoc: number,
  theme: MapTheme
): CellClassification {
  if (maskValue < LAND_MASK_THRESHOLD) {
    return {
      biome: 'sea',
      weights: { sea: 1, beach: 0, plain: 0, hill: 0, mountain: 0 }
    };
  }

  if (theme.mode === 'flat') {
    return {
      biome: 'plain',
      weights: { sea: 0, beach: 0, plain: 1, hill: 0, mountain: 0 }
    };
  }

  const weights: BiomeWeights = { sea: 0, beach: 0, plain: 0, hill: 0, mountain: 0 };
  const biome = classifyLandWeightsInto(heightValue, distToWaterDoc, theme, weights);
  return { biome, weights };
}

export function clampRectToBounds(
  rect: DirtyRectPx,
  widthPx: number,
  heightPx: number
): DirtyRectPx | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(widthPx, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(heightPx, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function expandAndClampRect(
  rect: DirtyRectPx,
  padPx: number,
  widthPx: number,
  heightPx: number
): DirtyRectPx | null {
  const pad = Math.max(0, Math.ceil(padPx));
  return clampRectToBounds(
    {
      x: rect.x - pad,
      y: rect.y - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2
    },
    widthPx,
    heightPx
  );
}

/**
 * Computes exact 2D Euclidean distance (in pixels) to either water cells
 * (`targetIsWater = true`, i.e. `mask < 128`) or land cells (`targetIsWater = false`,
 * i.e. `mask >= 128`) strictly within the page bounds `[0, widthPx) x [0, heightPx)`.
 * Page borders are never treated as water.
 */
export function computeLocalDistanceFieldInto(
  mask: Uint8Array,
  widthPx: number,
  _heightPx: number,
  sampleRect: DirtyRectPx,
  outRect: DirtyRectPx,
  targetIsWater: boolean,
  outDistPx: Float32Array,
  scratch: EdtScratch
): void {
  const sx = sampleRect.x;
  const sy = sampleRect.y;
  const sw = sampleRect.width;
  const sh = sampleRect.height;

  ensureEdtScratch(scratch, sw, sh);
  const sqDist = scratch.sqDist;
  const v = scratch.v;
  const z = scratch.z;
  const rowIn = scratch.rowIn;

  // Pass 1: Row-major cache-friendly 1D vertical distance sweep inside sampleRect
  // Row 0 downward initialization
  {
    const srcRow = sy * widthPx + sx;
    if (targetIsWater) {
      for (let cx = 0; cx < sw; cx += 1) {
        sqDist[cx] = mask[srcRow + cx] < LAND_MASK_THRESHOLD ? 0 : INF_DIST;
      }
    } else {
      for (let cx = 0; cx < sw; cx += 1) {
        sqDist[cx] = mask[srcRow + cx] >= LAND_MASK_THRESHOLD ? 0 : INF_DIST;
      }
    }
  }

  for (let cy = 1; cy < sh; cy += 1) {
    const srcRow = (sy + cy) * widthPx + sx;
    const dstRow = cy * sw;
    const prevRow = dstRow - sw;
    if (targetIsWater) {
      for (let cx = 0; cx < sw; cx += 1) {
        sqDist[dstRow + cx] =
          mask[srcRow + cx] < LAND_MASK_THRESHOLD ? 0 : sqDist[prevRow + cx] + 1;
      }
    } else {
      for (let cx = 0; cx < sw; cx += 1) {
        sqDist[dstRow + cx] =
          mask[srcRow + cx] >= LAND_MASK_THRESHOLD ? 0 : sqDist[prevRow + cx] + 1;
      }
    }
  }

  // Upward sweep using rowIn as previous-row linear vertical distance buffer
  {
    const lastOff = (sh - 1) * sw;
    for (let cx = 0; cx < sw; cx += 1) {
      const d = sqDist[lastOff + cx];
      rowIn[cx] = d;
      sqDist[lastOff + cx] = d >= INF_DIST ? INF_SQ : d * d;
    }
  }

  for (let cy = sh - 2; cy >= 0; cy -= 1) {
    const rowOff = cy * sw;
    for (let cx = 0; cx < sw; cx += 1) {
      const dUp = sqDist[rowOff + cx];
      const dDown = rowIn[cx] + 1;
      const best = dUp < dDown ? dUp : dDown;
      rowIn[cx] = best;
      sqDist[rowOff + cx] = best >= INF_DIST ? INF_SQ : best * best;
    }
  }

  // Pass 2: 1D horizontal Felzenszwalb-Huttenlocher parabola lower envelope
  // Note: horizontal rows are independent, so we only sweep rows inside outRect.
  const offX = outRect.x - sx;
  const offY = outRect.y - sy;
  const ow = outRect.width;
  const oh = outRect.height;

  for (let cy = offY, cyEnd = offY + oh; cy < cyEnd; cy += 1) {
    const rowOff = cy * sw;
    let firstFinite = -1;
    let allZero = true;
    for (let cx = 0; cx < sw; cx += 1) {
      const val = sqDist[rowOff + cx];
      rowIn[cx] = val;
      if (val < INF_SQ && firstFinite === -1) {
        firstFinite = cx;
      }
      if (val !== 0) {
        allZero = false;
      }
    }

    if (allZero || firstFinite === -1) {
      continue;
    }

    let k = 0;
    v[0] = firstFinite;
    z[0] = -1e20;
    z[1] = 1e20;

    for (let q = firstFinite + 1; q < sw; q += 1) {
      const fq = rowIn[q];
      if (fq >= INF_SQ) continue;

      const qq = fq + q * q;
      let vk = v[k];
      let s = (qq - (rowIn[vk] + vk * vk)) / (2 * (q - vk));
      while (s <= z[k]) {
        k -= 1;
        vk = v[k];
        s = (qq - (rowIn[vk] + vk * vk)) / (2 * (q - vk));
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = 1e20;
    }

    k = 0;
    for (let q = 0; q < sw; q += 1) {
      while (z[k + 1] < q) {
        k += 1;
      }
      const dx = q - v[k];
      sqDist[rowOff + q] = dx * dx + rowIn[v[k]];
    }
  }

  // Slice outRect from sampleRect
  for (let oy = 0; oy < oh; oy += 1) {
    const srcRow = (offY + oy) * sw + offX;
    const dstRow = oy * ow;
    for (let ox = 0; ox < ow; ox += 1) {
      const sq = sqDist[srcRow + ox];
      outDistPx[dstRow + ox] = sq >= INF_SQ ? Number.POSITIVE_INFINITY : Math.sqrt(sq);
    }
  }
}

/**
 * Computes pixel distance from each cell in `region` to the nearest water cell
 * (`mask < 128`) within an expanded search window of `maxDistPx`.
 * Returns a `Float32Array` of length `region.width * region.height` (or empty if clamped region is empty).
 */
export function computeLocalWaterDistancePx(
  mask: Uint8Array,
  widthPx: number,
  heightPx: number,
  region: DirtyRectPx,
  maxDistPx = 32,
  scratch?: EdtScratch
): Float32Array {
  const outRect = clampRectToBounds(region, widthPx, heightPx);
  if (!outRect) {
    return new Float32Array(0);
  }
  const sampleRect = expandAndClampRect(outRect, maxDistPx, widthPx, heightPx)!;
  const result = new Float32Array(outRect.width * outRect.height);
  const localScratch = scratch ?? createEdtScratch(Math.max(sampleRect.width, sampleRect.height));
  computeLocalDistanceFieldInto(
    mask,
    widthPx,
    heightPx,
    sampleRect,
    outRect,
    true,
    result,
    localScratch
  );
  return result;
}

/**
 * Computes pixel distance from each cell in `region` to the nearest land cell
 * (`mask >= 128`) within an expanded search window of `maxDistPx`.
 */
export function computeLocalLandDistancePx(
  mask: Uint8Array,
  widthPx: number,
  heightPx: number,
  region: DirtyRectPx,
  maxDistPx = 32,
  scratch?: EdtScratch
): Float32Array {
  const outRect = clampRectToBounds(region, widthPx, heightPx);
  if (!outRect) {
    return new Float32Array(0);
  }
  const sampleRect = expandAndClampRect(outRect, maxDistPx, widthPx, heightPx)!;
  const result = new Float32Array(outRect.width * outRect.height);
  const localScratch = scratch ?? createEdtScratch(Math.max(sampleRect.width, sampleRect.height));
  computeLocalDistanceFieldInto(
    mask,
    widthPx,
    heightPx,
    sampleRect,
    outRect,
    false,
    result,
    localScratch
  );
  return result;
}

export function computeGradientStepPx(space: DocSpace, terrain: MaskDimensions): number {
  const pxPerDoc = Math.min(terrain.widthPx / space.width, terrain.heightPx / space.height);
  return Math.max(1, Math.min(2, Math.round(1.5 * pxPerDoc)));
}

/**
 * Computes resolution-independent elevation gradient (height units per document unit)
 * via 3x3 smoothed finite differences, replicating page edge values to avoid false border shading.
 */
export function computeElevationGradient(
  height: Uint8Array,
  widthPx: number,
  heightPx: number,
  px: number,
  py: number,
  space: DocSpace,
  terrain: MaskDimensions,
  stepPx?: number
): ElevationGradient {
  const s = stepPx ?? computeGradientStepPx(space, terrain);
  const xm = px - s >= 0 ? px - s : 0;
  const xp = px + s < widthPx ? px + s : widthPx - 1;
  const ym = py - s >= 0 ? py - s : 0;
  const yp = py + s < heightPx ? py + s : heightPx - 1;

  const rowM = ym * widthPx;
  const rowC = py * widthPx;
  const rowP = yp * widthPx;

  const h00 = height[rowM + xm];
  const h10 = height[rowM + px];
  const h20 = height[rowM + xp];
  const h01 = height[rowC + xm];
  const h21 = height[rowC + xp];
  const h02 = height[rowP + xm];
  const h12 = height[rowP + px];
  const h22 = height[rowP + xp];

  const dxRaw = h20 + 2 * h21 + h22 - (h00 + 2 * h01 + h02);
  const dyRaw = h02 + 2 * h12 + h22 - (h00 + 2 * h10 + h20);

  const spanDocX = ((xp - xm) / widthPx) * space.width;
  const spanDocY = ((yp - ym) / heightPx) * space.height;

  const gx = spanDocX > 0 ? dxRaw / (4 * spanDocX) : 0;
  const gy = spanDocY > 0 ? dyRaw / (4 * spanDocY) : 0;
  return { gx, gy, slope: Math.hypot(gx, gy) };
}

/**
 * Detects coastal cliffs: elevated terrain immediately adjacent to water
 * or steep coastal drop-offs (0 = gentle shore/inland, 1 = pronounced rocky cliff).
 */
export function computeCliffFactor(
  heightValue: number,
  distToWaterDoc: number,
  slope: number
): number {
  if (distToWaterDoc > 5.5 || heightValue < 40) {
    return 0;
  }
  const prox = 1 - smoothstepRange(1.2, 5.5, distToWaterDoc);
  const elevCliff = smoothstepRange(72, 130, heightValue);
  const slopeCliff = smoothstepRange(3.5, 11.0, slope) * smoothstepRange(40, 85, heightValue);
  const strength = elevCliff > slopeCliff ? elevCliff : slopeCliff;
  const factor = prox * strength;
  return factor > 1 ? 1 : factor;
}
