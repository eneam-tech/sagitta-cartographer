import { clampNumber, docToMaskX, docToMaskY } from '../model/coordinates';
import { MapDocument, PathObject } from '../model/document';
import { DEFAULT_THEME, MapTheme } from '../theme/theme';

export type RiverRenderPass = 'full' | 'casing' | 'fill';

export interface RiverWorldOrigin {
  x: number;
  y: number;
  rotationDeg: number;
}

export interface DrawNaturalRiverOptions {
  pass?: RiverRenderPass;
  doc?: MapDocument;
  worldOrigin?: RiverWorldOrigin;
}

export interface NaturalRiverSpinePoint {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  t: number;
  dist: number;
  leftW: number;
  rightW: number;
  seaFade: number;
  estuaryBoost: number;
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, '');
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean.slice(0, 6);
  const parsed = Number.parseInt(full, 16);
  if (!Number.isFinite(parsed) || full.length < 6) {
    return [102, 152, 150];
  }
  return [(parsed >> 16) & 0xff, (parsed >> 8) & 0xff, parsed & 0xff];
}

function mixHexToRgb(hexA: string, hexB: string, t: number): [number, number, number] {
  const [ar, ag, ab] = parseHexRgb(hexA);
  const [br, bg, bb] = parseHexRgb(hexB);
  const u = clampNumber(t, 0, 1);
  return [
    Math.round(ar + (br - ar) * u),
    Math.round(ag + (bg - ag) * u),
    Math.round(ab + (bb - ab) * u)
  ];
}

function rgbToRgbaString(rgb: [number, number, number], alpha: number): string {
  const a = clampNumber(alpha, 0, 1);
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a.toFixed(3)})`;
}

function hexWithAlpha(hex: string, alpha: number): string {
  return rgbToRgbaString(parseHexRgb(hex), alpha);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clampNumber((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hashStringSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function hashInt1D(n: number, seed: number): number {
  let x = (Math.imul(n, 374761393) + Math.imul(seed, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x = x ^ (x >>> 16);
  return ((x >>> 0) / 4294967295) * 2 - 1;
}

function valueNoise1D(x: number, seed: number): number {
  const i0 = Math.floor(x);
  const f = x - i0;
  const u = f * f * (3 - 2 * f);
  const a = hashInt1D(i0, seed);
  const b = hashInt1D(i0 + 1, seed);
  return a + (b - a) * u;
}

function fbm1D(x: number, seed: number): number {
  return 0.68 * valueNoise1D(x, seed) + 0.32 * valueNoise1D(x * 2.13 + 17.3, seed + 97);
}

/**
 * Smooths raw control vertices `[x0, y0, ...]` with quadratic midpoint Bézier subdivision
 * while preserving exact first and last endpoints.
 */
function sampleSmoothRiverInput(points: readonly number[], subdivisionsPerSegment = 5): number[] {
  const count = Math.floor(points.length / 2);
  if (count <= 2) {
    return [...points];
  }
  const result: number[] = [points[0], points[1]];
  for (let i = 1; i < count - 1; i += 1) {
    const x0 = i === 1 ? points[0] : (points[(i - 1) * 2] + points[i * 2]) * 0.5;
    const y0 = i === 1 ? points[1] : (points[(i - 1) * 2 + 1] + points[i * 2 + 1]) * 0.5;
    const cx = points[i * 2];
    const cy = points[i * 2 + 1];
    const x1 = i === count - 2 ? points[(i + 1) * 2] : (cx + points[(i + 1) * 2]) * 0.5;
    const y1 = i === count - 2 ? points[(i + 1) * 2 + 1] : (cy + points[(i + 1) * 2 + 1]) * 0.5;

    for (let s = 1; s <= subdivisionsPerSegment; s += 1) {
      const t = s / subdivisionsPerSegment;
      const mt = 1 - t;
      result.push(
        mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
        mt * mt * y0 + 2 * mt * t * cy + t * t * y1
      );
    }
  }
  return result;
}

function sampleLandFractionAroundWorldPoint(doc: MapDocument, wx: number, wy: number): number {
  const { space, terrain } = doc.manifest;
  const { widthPx, heightPx, mask } = doc.terrain;
  if (widthPx <= 0 || heightPx <= 0 || terrain.widthPx <= 0) return 1;

  const offsets: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [-6, 0],
    [6, 0],
    [0, -6],
    [0, 6]
  ];
  let landHits = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    const sx = clampNumber(wx + offsets[i][0], 0, space.width);
    const sy = clampNumber(wy + offsets[i][1], 0, space.height);
    const mx = clampNumber(Math.floor(docToMaskX(sx, space, doc.terrain)), 0, widthPx - 1);
    const my = clampNumber(Math.floor(docToMaskY(sy, space, doc.terrain)), 0, heightPx - 1);
    if (mask[my * widthPx + mx] > 127) {
      landHits += 1;
    }
  }
  return landHits / offsets.length;
}

/**
 * Computes an organic, deterministically meandered river centerline spine in the path's
 * local coordinate space (`(x, y)` centered around `path.x, path.y`), keeping exact endpoints
 * pinned so tributary confluences remain watertight across zoom, pan, and PDF export.
 */
export function buildNaturalRiverSpine(
  path: PathObject,
  doc?: MapDocument,
  worldOrigin?: RiverWorldOrigin
): { points: NaturalRiverSpinePoint[]; coastEnterIdx: number; mouthEndIdx: number } {
  const rawPts = path.smooth !== false ? sampleSmoothRiverInput(path.points, 5) : [...path.points];
  const rawCount = Math.floor(rawPts.length / 2);
  if (rawCount < 2) {
    return { points: [], coastEnterIdx: -1, mouthEndIdx: -1 };
  }

  // Compute cumulative arc length of smoothed input polyline
  const rawDist = new Float64Array(rawCount);
  let totalLen = 0;
  for (let i = 1; i < rawCount; i += 1) {
    totalLen += Math.hypot(
      rawPts[i * 2] - rawPts[(i - 1) * 2],
      rawPts[i * 2 + 1] - rawPts[(i - 1) * 2 + 1]
    );
    rawDist[i] = totalLen;
  }

  if (totalLen < 0.5) {
    return { points: [], coastEnterIdx: -1, mouthEndIdx: -1 };
  }

  // Resample uniformly along arc length so straight user drags gain natural organic bends
  const stepDoc = clampNumber(totalLen / 88, 3.5, 8.5);
  const sampleCount = clampNumber(Math.ceil(totalLen / stepDoc) + 1, 8, 150);

  const seedInput =
    path.id === '__path-preview__'
      ? `preview:${Math.round((path.points[0] ?? 0) * 0.5)},${Math.round((path.points[1] ?? 0) * 0.5)}`
      : path.id;
  const seed = hashStringSeed(seedInput);

  const xs = new Float64Array(sampleCount);
  const ys = new Float64Array(sampleCount);
  const dists = new Float64Array(sampleCount);

  let segCursor = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const targetD = (totalLen * i) / (sampleCount - 1);
    while (segCursor < rawCount - 2 && rawDist[segCursor + 1] < targetD) {
      segCursor += 1;
    }
    const d0 = rawDist[segCursor];
    const d1 = rawDist[segCursor + 1];
    const span = d1 - d0;
    const localT = span > 1e-6 ? clampNumber((targetD - d0) / span, 0, 1) : 0;
    const ax = rawPts[segCursor * 2];
    const ay = rawPts[segCursor * 2 + 1];
    const bx = rawPts[(segCursor + 1) * 2];
    const by = rawPts[(segCursor + 1) * 2 + 1];
    xs[i] = ax + (bx - ax) * localT;
    ys[i] = ay + (by - ay) * localT;
    dists[i] = targetD;
  }

  // Displace interior points perpendicularly for natural geological meandering while pinning endpoints
  if (path.smooth !== false && totalLen >= 22) {
    const meanderAmp = Math.min(path.strokeWidthDoc * 1.15, totalLen * 0.052, 15);
    const shiftedX = new Float64Array(xs);
    const shiftedY = new Float64Array(ys);

    for (let i = 1; i < sampleCount - 1; i += 1) {
      const prevIdx = Math.max(0, i - 1);
      const nextIdx = Math.min(sampleCount - 1, i + 1);
      const dx = xs[nextIdx] - xs[prevIdx];
      const dy = ys[nextIdx] - ys[prevIdx];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = -dy / len;
      const ny = dx / len;
      const t = i / (sampleCount - 1);
      const endpointPin = Math.pow(Math.sin(Math.PI * t), 0.85);
      const broadCurve = fbm1D(dists[i] * 0.011 + 1.7, seed + 17) * 0.72;
      const localBend = fbm1D(dists[i] * 0.028 + 3.1, seed) * 0.48;
      const lateral = (broadCurve + localBend) * meanderAmp * endpointPin;
      shiftedX[i] += nx * lateral;
      shiftedY[i] += ny * lateral;
    }
    for (let i = 1; i < sampleCount - 1; i += 1) {
      xs[i] = shiftedX[i];
      ys[i] = shiftedY[i];
    }
  }

  // Recompute refined tangents, normals, and arc length after meander
  const refinedDist = new Float64Array(sampleCount);
  for (let i = 1; i < sampleCount; i += 1) {
    refinedDist[i] =
      refinedDist[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  const refinedTotalLen = Math.max(1, refinedDist[sampleCount - 1]);

  // Sample coastline crossing dynamically along the spine (never stale if mask is painted in place)
  const origin = worldOrigin ?? {
    x: path.x,
    y: path.y,
    rotationDeg: path.rotationDeg
  };
  const rad = (origin.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const seaFades = new Float64Array(sampleCount);
  let coastEnterIdx = -1;
  let mouthEndIdx = -1;

  if (doc) {
    const landFrac = new Float64Array(sampleCount);
    let sawLandAlongRiver = false;
    for (let i = 0; i < sampleCount; i += 1) {
      const wx = origin.x + xs[i] * cos - ys[i] * sin;
      const wy = origin.y + xs[i] * sin + ys[i] * cos;
      const lf = sampleLandFractionAroundWorldPoint(doc, wx, wy);
      landFrac[i] = lf;
      if (lf >= 0.4) {
        sawLandAlongRiver = true;
      }
    }

    // Only apply coastal mouth fading on a TRUE terminal ocean discharge:
    // walk backwards from sampleCount - 1 while over water so inland bays never erase downstream reaches.
    if (sawLandAlongRiver && landFrac[sampleCount - 1] < 0.45) {
      let terminalWaterStart = sampleCount - 1;
      while (terminalWaterStart > 0 && landFrac[terminalWaterStart - 1] < 0.45) {
        terminalWaterStart -= 1;
      }
      if (terminalWaterStart > 0) {
        coastEnterIdx = terminalWaterStart - 1;
        mouthEndIdx = terminalWaterStart;
        let waterDist = 0;
        for (let i = terminalWaterStart; i < sampleCount; i += 1) {
          waterDist += refinedDist[i] - refinedDist[i - 1];
          seaFades[i] = smoothstep(0, 26, waterDist);
          mouthEndIdx = i;
          if (waterDist >= 26) {
            break;
          }
        }
      }
    }
  }

  const spine: NaturalRiverSpinePoint[] = new Array(sampleCount);
  const halfBase = path.strokeWidthDoc * 0.5;

  for (let i = 0; i < sampleCount; i += 1) {
    const prevIdx = Math.max(0, i - 1);
    const nextIdx = Math.min(sampleCount - 1, i + 1);
    let dx = xs[nextIdx] - xs[prevIdx];
    let dy = ys[nextIdx] - ys[prevIdx];
    let len = Math.hypot(dx, dy);
    if (len < 1e-6 && i > 0) {
      dx = xs[i] - xs[i - 1];
      dy = ys[i] - ys[i - 1];
      len = Math.hypot(dx, dy);
    }
    const tx = len >= 1e-6 ? dx / len : 1;
    const ty = len >= 1e-6 ? dy / len : 0;
    const nx = -ty;
    const ny = tx;

    const t = i / (sampleCount - 1);
    const dist = refinedDist[i];
    const baseFactor = path.tapered ? 0.10 + 0.90 * Math.pow(t, 0.88) : 0.86;
    const noiseEnvelope = path.tapered ? smoothstep(0.04, 0.25, t) : 1;
    const bankJitterL = 1 + 0.14 * noiseEnvelope * fbm1D(dist * 0.052, seed + 193);
    const bankJitterR = 1 + 0.14 * noiseEnvelope * fbm1D(dist * 0.052, seed + 547);

    const seaFade = seaFades[i];
    const estuaryBoost = 1 + 0.22 * smoothstep(0.05, 0.55, seaFade);

    const rawW = halfBase * baseFactor * estuaryBoost;
    const minTip = path.tapered ? 0.18 : 0.45;
    spine[i] = {
      x: xs[i],
      y: ys[i],
      tx,
      ty,
      nx,
      ny,
      t,
      dist: (dist / refinedTotalLen) * totalLen,
      leftW: Math.max(minTip, rawW * bankJitterL),
      rightW: Math.max(minTip, rawW * bankJitterR),
      seaFade,
      estuaryBoost
    };
  }

  return { points: spine, coastEnterIdx, mouthEndIdx };
}

/**
 * Returns the meandered river centerline in world document coordinates `[x0, y0, ...]`
 * so interactive tributary snapping and hit-testing follow the organic river path.
 */
export function getRiverWorldSpinePoints(path: PathObject): number[] {
  const { points } = buildNaturalRiverSpine(path);
  if (points.length < 2) return [...path.points];
  const rad = (path.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out = new Array<number>(points.length * 2);
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    out[i * 2] = path.x + p.x * cos - p.y * sin;
    out[i * 2 + 1] = path.y + p.x * sin + p.y * cos;
  }
  return out;
}

function traceRiverRibbonPath(
  ctx: CanvasRenderingContext2D,
  spine: readonly NaturalRiverSpinePoint[],
  scaleX: number,
  scaleY: number,
  options: {
    expandLeftPx: (pt: NaturalRiverSpinePoint) => number;
    expandRightPx: (pt: NaturalRiverSpinePoint) => number;
    widthScale?: number;
    centerShiftScale?: number;
    offsetX?: number;
    offsetY?: number;
    pointedStart?: boolean;
    mouthExtendPx?: number;
    roundEndCap?: boolean;
  }
): void {
  const n = spine.length;
  const widthScale = options.widthScale ?? 1;
  const centerShiftScale = options.centerShiftScale ?? 0;
  const offX = options.offsetX ?? 0;
  const offY = options.offsetY ?? 0;

  const leftX = new Float64Array(n);
  const leftY = new Float64Array(n);
  const rightX = new Float64Array(n);
  const rightY = new Float64Array(n);

  for (let i = 0; i < n; i += 1) {
    const p = spine[i];
    const avgW = (p.leftW + p.rightW) * 0.5;
    const shift = centerShiftScale * avgW;
    const cx = (p.x + p.nx * shift) * scaleX + offX;
    const cy = (p.y + p.ny * shift) * scaleY + offY;
    const lw = Math.max(0.15, p.leftW * widthScale * scaleX + options.expandLeftPx(p));
    const rw = Math.max(0.15, p.rightW * widthScale * scaleY + options.expandRightPx(p));
    leftX[i] = cx + p.nx * lw;
    leftY[i] = cy + p.ny * lw;
    rightX[i] = cx - p.nx * rw;
    rightY[i] = cy - p.ny * rw;
  }

  const endIdx = n - 1;
  const mouthExt = options.mouthExtendPx ?? 0;
  const endCenterX =
    spine[endIdx].x * scaleX + offX + spine[endIdx].tx * mouthExt;
  const endCenterY =
    spine[endIdx].y * scaleY + offY + spine[endIdx].ty * mouthExt;

  if (mouthExt > 0) {
    leftX[endIdx] += spine[endIdx].tx * mouthExt;
    leftY[endIdx] += spine[endIdx].ty * mouthExt;
    rightX[endIdx] += spine[endIdx].tx * mouthExt;
    rightY[endIdx] += spine[endIdx].ty * mouthExt;
  }

  ctx.beginPath();
  if (options.pointedStart) {
    const sx = spine[0].x * scaleX + offX - spine[0].tx * Math.min(2.2, scaleX * 1.4);
    const sy = spine[0].y * scaleY + offY - spine[0].ty * Math.min(2.2, scaleY * 1.4);
    ctx.moveTo(sx, sy);
    ctx.lineTo(leftX[0], leftY[0]);
  } else {
    ctx.moveTo(rightX[0], rightY[0]);
    ctx.lineTo(leftX[0], leftY[0]);
  }

  for (let i = 1; i < n; i += 1) {
    ctx.lineTo(leftX[i], leftY[i]);
  }

  if (options.roundEndCap !== false) {
    const endHalfW = Math.hypot(leftX[endIdx] - endCenterX, leftY[endIdx] - endCenterY);
    const endLeftAngle = Math.atan2(leftY[endIdx] - endCenterY, leftX[endIdx] - endCenterX);
    const capSteps = 4;
    for (let s = 1; s < capSteps; s += 1) {
      const angle = endLeftAngle - (Math.PI * s) / capSteps;
      ctx.lineTo(
        endCenterX + Math.cos(angle) * endHalfW,
        endCenterY + Math.sin(angle) * endHalfW
      );
    }
  }

  for (let i = endIdx; i >= 0; i -= 1) {
    ctx.lineTo(rightX[i], rightY[i]);
  }

  ctx.closePath();
}

function buildMouthFadeFillStyle(
  ctx: CanvasRenderingContext2D,
  spine: readonly NaturalRiverSpinePoint[],
  coastEnterIdx: number,
  mouthEndIdx: number,
  scaleX: number,
  scaleY: number,
  baseHex: string,
  baseAlpha: number,
  stopFadeAt: number
): string | CanvasGradient | null {
  if (
    coastEnterIdx < 0 ||
    mouthEndIdx <= coastEnterIdx ||
    typeof ctx.createLinearGradient !== 'function'
  ) {
    return null;
  }
  const p0 = spine[coastEnterIdx];
  const p1 = spine[mouthEndIdx];
  const x0 = p0.x * scaleX;
  const y0 = p0.y * scaleY;
  const x1 = p1.x * scaleX;
  const y1 = p1.y * scaleY;
  if (Math.hypot(x1 - x0, y1 - y0) < 2) {
    return null;
  }
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, hexWithAlpha(baseHex, baseAlpha));
  grad.addColorStop(clampNumber(stopFadeAt, 0.25, 1), hexWithAlpha(baseHex, 0));
  return grad;
}

function fillRibbonWithOptionalSeaFade(
  ctx: CanvasRenderingContext2D,
  spine: readonly NaturalRiverSpinePoint[],
  coastEnterIdx: number,
  mouthEndIdx: number,
  scaleX: number,
  scaleY: number,
  hexColor: string,
  baseAlpha: number,
  stopFadeAt: number,
  ribbonOpts: {
    expandLeftPx: (pt: NaturalRiverSpinePoint) => number;
    expandRightPx: (pt: NaturalRiverSpinePoint) => number;
    widthScale?: number;
    centerShiftScale?: number;
    offsetX?: number;
    offsetY?: number;
    pointedStart?: boolean;
    mouthExtendPx?: number;
  }
): void {
  const hasSeaFade = coastEnterIdx >= 0 && mouthEndIdx > coastEnterIdx;
  const gradSupported = typeof ctx.createLinearGradient === 'function';

  if (!hasSeaFade || !gradSupported) {
    ctx.save();
    traceRiverRibbonPath(ctx, spine, scaleX, scaleY, {
      ...ribbonOpts,
      roundEndCap: true
    });
    if (baseAlpha < 1) {
      ctx.globalAlpha *= baseAlpha;
    }
    ctx.fillStyle = hexColor;
    ctx.fill();
    ctx.restore();
    return;
  }

  // Split upstream solid land reach from coastal exit so upstream meanders never fade prematurely
  if (coastEnterIdx > 1) {
    const landSlice = spine.slice(0, coastEnterIdx + 1);
    ctx.save();
    traceRiverRibbonPath(ctx, landSlice, scaleX, scaleY, {
      ...ribbonOpts,
      mouthExtendPx: 0,
      roundEndCap: false
    });
    if (baseAlpha < 1) {
      ctx.globalAlpha *= baseAlpha;
    }
    ctx.fillStyle = hexColor;
    ctx.fill();
    ctx.restore();
  }

  const mouthStart = coastEnterIdx > 1 ? coastEnterIdx : 0;
  const mouthSlice = spine.slice(mouthStart, mouthEndIdx + 1);
  if (mouthSlice.length >= 2) {
    const grad = buildMouthFadeFillStyle(
      ctx,
      spine,
      coastEnterIdx,
      mouthEndIdx,
      scaleX,
      scaleY,
      hexColor,
      baseAlpha,
      stopFadeAt
    );
    ctx.save();
    traceRiverRibbonPath(ctx, mouthSlice, scaleX, scaleY, {
      ...ribbonOpts,
      pointedStart: coastEnterIdx <= 1 ? ribbonOpts.pointedStart : false,
      roundEndCap: true
    });
    if (grad) {
      ctx.fillStyle = grad;
    } else {
      if (baseAlpha < 1) ctx.globalAlpha *= baseAlpha;
      ctx.fillStyle = hexColor;
    }
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Renders a natural continent-style river in either full, casing-only (valley shadow & banks),
 * or fill-only (main stream, deep thalweg channel, flow highlights) pass so tributary confluences
 * unite cleanly without dividing bank lines and mouths integrate gently into coastal waters.
 */
export function drawNaturalRiverToContext(
  ctx: CanvasRenderingContext2D,
  path: PathObject,
  scaleX: number,
  scaleY: number,
  theme: MapTheme = DEFAULT_THEME,
  options?: DrawNaturalRiverOptions
): void {
  const { points: spine, coastEnterIdx, mouthEndIdx } = buildNaturalRiverSpine(
    path,
    options?.doc,
    options?.worldOrigin
  );
  if (spine.length < 2) return;

  const pass: RiverRenderPass = options?.pass ?? 'full';
  const avgScale = (scaleX + scaleY) * 0.5;
  const baseWidthPx = Math.max(0.75, path.strokeWidthDoc * avgScale);
  const canFill = typeof ctx.fill === 'function' && typeof ctx.closePath === 'function';
  if (!canFill) return;

  const seaStopsEntering = coastEnterIdx >= 0;

  if (pass === 'casing' || pass === 'full') {
    const recessRgb = mixHexToRgb(theme.colors.ink, theme.colors.hill, 0.36);
    const bankInkRgb = mixHexToRgb(theme.colors.ink, theme.colors.seaBathymetry, 0.25);
    const bankInkHex = `#${bankInkRgb
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')}`;
    const recessHex = `#${recessRgb
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')}`;

    // 1. Incised valley / bank shadow carving river into surrounding terrain
    fillRibbonWithOptionalSeaFade(
      ctx,
      spine,
      coastEnterIdx,
      mouthEndIdx,
      scaleX,
      scaleY,
      recessHex,
      0.22,
      0.56,
      {
        expandLeftPx: (pt) => avgScale * (1.2 + 2.4 * pt.t),
        expandRightPx: (pt) => avgScale * (1.6 + 3.0 * pt.t),
        offsetX: clampNumber(avgScale * 0.7, 0.45, 1.6),
        offsetY: clampNumber(avgScale * 0.8, 0.5, 1.8),
        pointedStart: path.tapered,
        mouthExtendPx: seaStopsEntering ? 0 : avgScale * 0.8
      }
    );

    // 2. Crisp cartographic ink riverbank outline tapering softly at spring and opening at sea mouth
    fillRibbonWithOptionalSeaFade(
      ctx,
      spine,
      coastEnterIdx,
      mouthEndIdx,
      scaleX,
      scaleY,
      bankInkHex,
      0.78,
      0.48,
      {
        expandLeftPx: (pt) => clampNumber(avgScale * (0.55 + 0.95 * pt.t), 0.55, 2.0),
        expandRightPx: (pt) => clampNumber(avgScale * (0.62 + 1.05 * pt.t), 0.6, 2.2),
        pointedStart: path.tapered,
        mouthExtendPx: seaStopsEntering ? 0 : avgScale * 0.35
      }
    );
  }

  if (pass === 'fill' || pass === 'full') {
    // 1. Primary water channel
    fillRibbonWithOptionalSeaFade(
      ctx,
      spine,
      coastEnterIdx,
      mouthEndIdx,
      scaleX,
      scaleY,
      path.color,
      1,
      0.96,
      {
        expandLeftPx: () => 0,
        expandRightPx: () => 0,
        pointedStart: path.tapered,
        mouthExtendPx: seaStopsEntering ? 0 : avgScale * 1.15
      }
    );

    // 2. Deeper central thalweg channel for dimensional depth instead of flat fill
    const thalwegRgb = mixHexToRgb(path.color, theme.colors.seaBathymetry, 0.5);
    const thalwegHex = `#${thalwegRgb
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')}`;
    fillRibbonWithOptionalSeaFade(
      ctx,
      spine,
      coastEnterIdx,
      mouthEndIdx,
      scaleX,
      scaleY,
      thalwegHex,
      0.52,
      0.8,
      {
        widthScale: 0.54,
        centerShiftScale: -0.1,
        expandLeftPx: () => 0,
        expandRightPx: () => 0,
        pointedStart: path.tapered,
        mouthExtendPx: seaStopsEntering ? 0 : avgScale * 0.6
      }
    );

    // 3. Delicate current flow shimmer filaments along medium/wide land reaches
    if (baseWidthPx >= 4.2 && typeof ctx.stroke === 'function') {
      const highlightRgb = mixHexToRgb(theme.colors.seaShallow, '#FAF6EC', 0.58);
      const highlightHex = rgbToRgbaString(highlightRgb, 1);
      const startIdx = Math.floor(spine.length * 0.16);
      const landEndLimit = coastEnterIdx >= 0 ? coastEnterIdx : Math.ceil(spine.length * 0.94);
      const endIdx = Math.min(Math.ceil(spine.length * 0.94), landEndLimit);

      if (endIdx - startIdx >= 3) {
        ctx.save();
        ctx.beginPath();
        let started = false;
        for (let i = startIdx; i < endIdx; i += 1) {
          const p = spine[i];
          if (p.seaFade > 0.25) break;
          const avgW = (p.leftW + p.rightW) * 0.5;
          if (avgW * avgScale * 2 < 3.4) continue;
          const hx = (p.x + p.nx * avgW * 0.16) * scaleX;
          const hy = (p.y + p.ny * avgW * 0.16) * scaleY;
          if (!started) {
            ctx.moveTo(hx, hy);
            started = true;
          } else {
            ctx.lineTo(hx, hy);
          }
        }
        if (started) {
          if (typeof ctx.setLineDash === 'function') {
            ctx.setLineDash([7 * avgScale, 12 * avgScale]);
          }
          ctx.lineCap = 'round';
          ctx.globalAlpha *= 0.34;
          ctx.strokeStyle = highlightHex;
          ctx.lineWidth = clampNumber(baseWidthPx * 0.14, 0.65, 1.5);
          ctx.stroke();
          if (typeof ctx.setLineDash === 'function') {
            ctx.setLineDash([]);
          }
        }
        ctx.restore();
      }
    }
  }
}
