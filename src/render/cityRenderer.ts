import { getCityThemePalette } from '../city/geometry';
import { clampNumber } from '../model/coordinates';
import {
  BuildingObject,
  BuildingRenderStyle,
  PathObject,
  PlazaObject
} from '../model/document';
import { MapTheme } from '../theme/theme';

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean.slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return [140, 75, 62];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function adjustHexBrightness(hex: string, factor: number): string {
  const [r, g, b] = parseHexRgb(hex);
  const nr = clampNumber(Math.round(r * factor), 0, 255);
  const ng = clampNumber(Math.round(g * factor), 0, 255);
  const nb = clampNumber(Math.round(b * factor), 0, 255);
  return `rgb(${nr}, ${ng}, ${nb})`;
}

function traceLShapePath(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const cutX = w * 0.08;
  const cutY = h * 0.06;
  ctx.beginPath();
  ctx.moveTo(-hw, -hh);
  ctx.lineTo(hw, -hh);
  ctx.lineTo(hw, cutY);
  ctx.lineTo(cutX, cutY);
  ctx.lineTo(cutX, hh);
  ctx.lineTo(-hw, hh);
  ctx.closePath();
}

function traceCathedralPath(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const naveHalfH = h * 0.23;
  const transeptHalfW = w * 0.16;
  const crossX = w * 0.12;
  ctx.beginPath();
  ctx.moveTo(-hw, -naveHalfH);
  ctx.lineTo(crossX - transeptHalfW, -naveHalfH);
  ctx.lineTo(crossX - transeptHalfW, -hh);
  ctx.lineTo(crossX + transeptHalfW, -hh);
  ctx.lineTo(crossX + transeptHalfW, -naveHalfH);
  ctx.lineTo(hw, -naveHalfH);
  ctx.lineTo(hw, naveHalfH);
  ctx.lineTo(crossX + transeptHalfW, naveHalfH);
  ctx.lineTo(crossX + transeptHalfW, hh);
  ctx.lineTo(crossX - transeptHalfW, hh);
  ctx.lineTo(crossX - transeptHalfW, naveHalfH);
  ctx.lineTo(-hw, naveHalfH);
  ctx.closePath();
}

function tracePlazaShapePath(
  ctx: CanvasRenderingContext2D,
  shape: PlazaObject['shape'],
  w: number,
  h: number
): void {
  const hw = w * 0.5;
  const hh = h * 0.5;
  ctx.beginPath();
  if (shape === 'circle') {
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(0, 0, Math.min(hw, hh), 0, Math.PI * 2);
    }
    ctx.closePath();
    return;
  }
  if (shape === 'octagon') {
    const cx = hw * 0.42;
    const cy = hh * 0.42;
    ctx.moveTo(-hw + cx, -hh);
    ctx.lineTo(hw - cx, -hh);
    ctx.lineTo(hw, -hh + cy);
    ctx.lineTo(hw, hh - cy);
    ctx.lineTo(hw - cx, hh);
    ctx.lineTo(-hw + cx, hh);
    ctx.lineTo(-hw, hh - cy);
    ctx.lineTo(-hw, -hh + cy);
    ctx.closePath();
    return;
  }
  ctx.rect(-hw, -hh, w, h);
  ctx.closePath();
}

function drawInkHatchingOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strokeColor: string,
  lineWidthPx: number
): void {
  const span = w + h;
  const step = clampNumber(Math.min(w, h) * 0.22, 3.5, 7);
  ctx.save();
  ctx.beginPath();
  for (let d = -span; d <= span; d += step) {
    ctx.moveTo(d, -h);
    ctx.lineTo(d - h, h);
  }
  ctx.strokeStyle = strokeColor;
  ctx.globalAlpha *= 0.26;
  ctx.lineWidth = Math.max(0.6, lineWidthPx * 0.55);
  ctx.stroke();
  ctx.restore();
}

function traceShapeForBuilding(
  ctx: CanvasRenderingContext2D,
  building: BuildingObject,
  w: number,
  h: number
): void {
  const hw = w * 0.5;
  const hh = h * 0.5;
  if (building.shape === 'tower') {
    const r = Math.min(hw, hh);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.closePath();
  } else if (building.shape === 'l-shape') {
    traceLShapePath(ctx, w, h);
  } else if (building.shape === 'cathedral') {
    traceCathedralPath(ctx, w, h);
  } else {
    ctx.beginPath();
    ctx.rect(-hw, -hh, w, h);
    ctx.closePath();
  }
}

/**
 * Renders a single `BuildingObject` either in 2.5D pitched-roof style (`'roof-25d'`)
 * with directional NW sunlight / SE shadows or flat engraved architectural style (`'ink-plan'`).
 */
export function drawBuildingToContext(
  ctx: CanvasRenderingContext2D,
  building: BuildingObject,
  theme: MapTheme,
  scaleX: number,
  scaleY: number,
  options?: { applyTransform?: boolean }
): void {
  const palette = getCityThemePalette(theme);
  const style: BuildingRenderStyle = building.renderStyle ?? palette.renderStyle;
  const w = Math.max(2, building.width * scaleX);
  const h = Math.max(2, building.height * scaleY);
  const hw = w * 0.5;
  const hh = h * 0.5;
  const avgScale = (scaleX + scaleY) * 0.5;
  const rad = (building.rotationDeg * Math.PI) / 180;
  const outlineW = clampNumber(avgScale * 1.15, 0.75, 2.2);

  // Transform world SE shadow vector into rotated local space so shadows always cast consistently to SE
  const shadowWorld = Math.max(2, Math.min(w, h) * 0.16);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const shLx = shadowWorld * (cos + sin);
  const shLy = shadowWorld * (-sin + cos);

  ctx.save();
  if (options?.applyTransform !== false) {
    ctx.translate(building.x * scaleX, building.y * scaleY);
    ctx.rotate(rad);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (style === 'ink-plan') {
    // Architectural plan view (engraved ink fill + crisp border + subtle hatching on larger footprints)
    ctx.save();
    ctx.translate(shLx * 0.35, shLy * 0.35);
    traceShapeForBuilding(ctx, building, w, h);
    ctx.fillStyle = palette.roofShadow;
    ctx.fill();
    ctx.restore();

    traceShapeForBuilding(ctx, building, w, h);
    ctx.fillStyle = building.roofColor;
    ctx.fill();

    if (building.shape === 'courtyard') {
      const cw = w * 0.44;
      const ch = h * 0.44;
      ctx.fillStyle = theme.colors.land;
      ctx.fillRect(-cw * 0.5, -ch * 0.5, cw, ch);
      ctx.strokeStyle = theme.colors.ink;
      ctx.lineWidth = outlineW * 0.85;
      ctx.strokeRect(-cw * 0.5, -ch * 0.5, cw, ch);
    }

    if (Math.min(w, h) >= 9 && typeof ctx.clip === 'function') {
      ctx.save();
      traceShapeForBuilding(ctx, building, w, h);
      ctx.clip();
      drawInkHatchingOverlay(ctx, w, h, theme.colors.labelHalo, outlineW);
      ctx.restore();
    }

    traceShapeForBuilding(ctx, building, w, h);
    ctx.strokeStyle = theme.colors.ink;
    ctx.lineWidth = outlineW;
    ctx.stroke();

    if (building.shape === 'cathedral') {
      ctx.beginPath();
      ctx.arc(w * 0.12, 0, Math.min(w, h) * 0.11, 0, Math.PI * 2);
      ctx.fillStyle = theme.colors.labelHalo;
      ctx.fill();
      ctx.strokeStyle = theme.colors.ink;
      ctx.lineWidth = outlineW * 0.8;
      ctx.stroke();
    }

    ctx.restore();
    return;
  }

  // Style 'roof-25d': SE cast shadow + lit/shaded roof facets + crisp ridge lines
  ctx.save();
  ctx.translate(shLx, shLy);
  traceShapeForBuilding(ctx, building, w, h);
  ctx.fillStyle = palette.roofShadow;
  ctx.fill();
  ctx.restore();

  const litRoof = adjustHexBrightness(building.roofColor, 1.13);
  const shadeRoof = adjustHexBrightness(building.roofColor, 0.78);
  const ridgeColor = adjustHexBrightness(building.roofColor, 1.24);
  const inkStroke = theme.colors.ink;

  if (building.shape === 'tower') {
    const r = Math.min(hw, hh);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = shadeRoof;
    ctx.fill();

    // Sunlit NW half-cone wedge
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, Math.PI * 0.72, Math.PI * 1.78, false);
    ctx.closePath();
    ctx.fillStyle = litRoof;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = inkStroke;
    ctx.lineWidth = outlineW;
    ctx.stroke();

    // Conical roof ribs & finial
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, 0);
    ctx.lineTo(r * 0.7, 0);
    ctx.moveTo(0, -r * 0.7);
    ctx.lineTo(0, r * 0.7);
    ctx.strokeStyle = 'rgba(20, 15, 12, 0.28)';
    ctx.lineWidth = Math.max(0.6, outlineW * 0.6);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.2, r * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = inkStroke;
    ctx.fill();
  } else if (building.shape === 'l-shape') {
    traceLShapePath(ctx, w, h);
    ctx.fillStyle = building.roofColor;
    ctx.fill();

    // Shaded lower-right slope
    ctx.beginPath();
    ctx.moveTo(-hw, hh);
    ctx.lineTo(w * 0.08, hh);
    ctx.lineTo(w * 0.08, h * 0.06);
    ctx.lineTo(hw, h * 0.06);
    ctx.lineTo(hw, -hh * 0.44);
    ctx.lineTo(-hw * 0.44, -hh * 0.44);
    ctx.lineTo(-hw * 0.44, hh);
    ctx.closePath();
    ctx.fillStyle = shadeRoof;
    ctx.fill();

    // Ridge lines
    ctx.beginPath();
    ctx.moveTo(-hw * 0.44, -hh * 0.44);
    ctx.lineTo(hw - h * 0.2, -hh * 0.44);
    ctx.moveTo(-hw * 0.44, -hh * 0.44);
    ctx.lineTo(-hw * 0.44, hh - w * 0.16);
    ctx.strokeStyle = ridgeColor;
    ctx.lineWidth = outlineW * 0.9;
    ctx.stroke();

    traceLShapePath(ctx, w, h);
    ctx.strokeStyle = inkStroke;
    ctx.lineWidth = outlineW;
    ctx.stroke();
  } else if (building.shape === 'courtyard') {
    ctx.fillStyle = litRoof;
    ctx.fillRect(-hw, -hh, w, h);

    // Bottom & right wing shading
    ctx.beginPath();
    ctx.moveTo(-hw, hh);
    ctx.lineTo(hw, hh);
    ctx.lineTo(hw, -hh);
    ctx.lineTo(hw * 0.44, -hh * 0.44);
    ctx.lineTo(-hw * 0.44, hh * 0.44);
    ctx.closePath();
    ctx.fillStyle = shadeRoof;
    ctx.fill();

    const cw = w * 0.46;
    const ch = h * 0.46;
    ctx.fillStyle = palette.plazaFill;
    ctx.fillRect(-cw * 0.5, -ch * 0.5, cw, ch);

    // Inner courtyard NW shadow
    ctx.fillStyle = palette.roofShadow;
    ctx.fillRect(-cw * 0.5, -ch * 0.5, cw, Math.max(2, ch * 0.26));
    ctx.fillRect(-cw * 0.5, -ch * 0.5, Math.max(2, cw * 0.24), ch);

    ctx.strokeStyle = inkStroke;
    ctx.lineWidth = outlineW * 0.85;
    ctx.strokeRect(-cw * 0.5, -ch * 0.5, cw, ch);
    ctx.lineWidth = outlineW;
    ctx.strokeRect(-hw, -hh, w, h);
  } else if (building.shape === 'cathedral') {
    traceCathedralPath(ctx, w, h);
    ctx.fillStyle = litRoof;
    ctx.fill();

    // Lower nave + right transept shading
    ctx.beginPath();
    ctx.moveTo(-hw, 0);
    ctx.lineTo(hw, 0);
    ctx.lineTo(hw, h * 0.23);
    ctx.lineTo(w * 0.28, h * 0.23);
    ctx.lineTo(w * 0.28, hh);
    ctx.lineTo(w * 0.12, hh);
    ctx.lineTo(w * 0.12, h * 0.23);
    ctx.lineTo(-hw, h * 0.23);
    ctx.closePath();
    ctx.fillStyle = shadeRoof;
    ctx.fill();

    // Crossing ridges & octagonal lantern tower
    ctx.beginPath();
    ctx.moveTo(-hw + h * 0.12, 0);
    ctx.lineTo(hw - h * 0.12, 0);
    ctx.moveTo(w * 0.12, -hh + w * 0.08);
    ctx.lineTo(w * 0.12, hh - w * 0.08);
    ctx.strokeStyle = ridgeColor;
    ctx.lineWidth = outlineW * 0.95;
    ctx.stroke();

    traceCathedralPath(ctx, w, h);
    ctx.strokeStyle = inkStroke;
    ctx.lineWidth = outlineW;
    ctx.stroke();

    const spireR = Math.max(3, Math.min(w, h) * 0.14);
    ctx.beginPath();
    ctx.arc(w * 0.12, 0, spireR, 0, Math.PI * 2);
    ctx.fillStyle = adjustHexBrightness(building.roofColor, 1.18);
    ctx.fill();
    ctx.strokeStyle = inkStroke;
    ctx.lineWidth = outlineW * 0.85;
    ctx.stroke();
  } else if (building.shape === 'market') {
    ctx.fillStyle = litRoof;
    ctx.fillRect(-hw, -hh, w, h);

    ctx.fillStyle = shadeRoof;
    ctx.fillRect(-hw, 0, w, hh);

    // Striped canopy awning ribs
    const ribs = Math.max(3, Math.floor(w / Math.max(6, h * 0.45)));
    ctx.fillStyle = adjustHexBrightness(building.roofColor, 1.28);
    for (let i = 0; i < ribs; i += 2) {
      const rx = -hw + (w * i) / ribs;
      const rw = w / ribs;
      ctx.fillRect(rx, -hh + outlineW * 0.4, rw * 0.72, h - outlineW * 0.8);
    }

    ctx.beginPath();
    ctx.moveTo(-hw, 0);
    ctx.lineTo(hw, 0);
    ctx.strokeStyle = inkStroke;
    ctx.lineWidth = Math.max(0.6, outlineW * 0.65);
    ctx.stroke();

    ctx.lineWidth = outlineW;
    ctx.strokeRect(-hw, -hh, w, h);
  } else {
    // Standard gabled / hipped rectangle house
    const useVerticalRidge = h > w * 1.15;
    if (useVerticalRidge) {
      ctx.fillStyle = litRoof;
      ctx.fillRect(-hw, -hh, hw, h);
      ctx.fillStyle = shadeRoof;
      ctx.fillRect(0, -hh, hw, h);
      const inset = Math.min(hh * 0.25, hw * 0.7);
      ctx.beginPath();
      ctx.moveTo(-hw, -hh);
      ctx.lineTo(0, -hh + inset);
      ctx.lineTo(hw, -hh);
      ctx.moveTo(0, -hh + inset);
      ctx.lineTo(0, hh - inset);
      ctx.lineTo(-hw, hh);
      ctx.moveTo(0, hh - inset);
      ctx.lineTo(hw, hh);
      ctx.strokeStyle = 'rgba(255, 245, 225, 0.35)';
      ctx.lineWidth = Math.max(0.6, outlineW * 0.65);
      ctx.stroke();
    } else {
      ctx.fillStyle = litRoof;
      ctx.fillRect(-hw, -hh, w, hh);
      ctx.fillStyle = shadeRoof;
      ctx.fillRect(-hw, 0, w, hh);
      const inset = Math.min(hw * 0.28, hh * 0.7);
      ctx.beginPath();
      ctx.moveTo(-hw, -hh);
      ctx.lineTo(-hw + inset, 0);
      ctx.lineTo(-hw, hh);
      ctx.moveTo(-hw + inset, 0);
      ctx.lineTo(hw - inset, 0);
      ctx.lineTo(hw, -hh);
      ctx.moveTo(hw - inset, 0);
      ctx.lineTo(hw, hh);
      ctx.strokeStyle = 'rgba(255, 245, 225, 0.35)';
      ctx.lineWidth = Math.max(0.6, outlineW * 0.65);
      ctx.stroke();
    }

    ctx.strokeStyle = inkStroke;
    ctx.lineWidth = outlineW;
    ctx.strokeRect(-hw, -hh, w, h);
  }

  ctx.restore();
}

/**
 * Renders a `PlazaObject` (flagstone square with curb border + centerpiece landmark).
 */
export function drawPlazaToContext(
  ctx: CanvasRenderingContext2D,
  plaza: PlazaObject,
  theme: MapTheme,
  scaleX: number,
  scaleY: number,
  options?: { applyTransform?: boolean }
): void {
  const palette = getCityThemePalette(theme);
  const w = Math.max(8, plaza.width * scaleX);
  const h = Math.max(8, plaza.height * scaleY);
  const minDim = Math.min(w, h);
  const avgScale = (scaleX + scaleY) * 0.5;
  const curbW = clampNumber(avgScale * 1.6, 1, 3.2);

  ctx.save();
  if (options?.applyTransform !== false) {
    ctx.translate(plaza.x * scaleX, plaza.y * scaleY);
    ctx.rotate((plaza.rotationDeg * Math.PI) / 180);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  tracePlazaShapePath(ctx, plaza.shape, w, h);
  ctx.fillStyle = plaza.fillColor || palette.plazaFill;
  ctx.fill();

  // Subtle flagstone cross & concentric guide marks
  ctx.save();
  ctx.strokeStyle = plaza.borderColor || palette.streetBorder;
  ctx.globalAlpha *= 0.22;
  ctx.lineWidth = Math.max(0.6, curbW * 0.5);
  ctx.beginPath();
  ctx.moveTo(-w * 0.34, 0);
  ctx.lineTo(w * 0.34, 0);
  ctx.moveTo(0, -h * 0.34);
  ctx.lineTo(0, h * 0.34);
  ctx.stroke();
  ctx.restore();

  tracePlazaShapePath(ctx, plaza.shape, w, h);
  ctx.strokeStyle = plaza.borderColor || palette.streetBorder;
  ctx.lineWidth = curbW;
  ctx.stroke();

  // Inner curb inlay
  if (minDim > 18) {
    tracePlazaShapePath(ctx, plaza.shape, w - curbW * 3.5, h - curbW * 3.5);
    ctx.save();
    ctx.strokeStyle = plaza.borderColor || palette.streetBorder;
    ctx.globalAlpha *= 0.45;
    ctx.lineWidth = Math.max(0.6, curbW * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  // Centerpiece landmarks
  if (plaza.centerpiece === 'fountain') {
    const r = Math.max(3.5, minDim * 0.16);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = palette.canalWater;
    ctx.fill();
    ctx.strokeStyle = theme.colors.ink;
    ctx.lineWidth = Math.max(0.8, curbW * 0.75);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = palette.plazaFill;
    ctx.fill();
    ctx.stroke();
  } else if (plaza.centerpiece === 'obelisk') {
    const s = Math.max(3, minDim * 0.14);
    ctx.fillStyle = palette.roofShadow;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 1.4, s * 1.1);
    ctx.lineTo(s * 0.8, s * 1.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = palette.wallStone;
    ctx.strokeStyle = theme.colors.ink;
    ctx.lineWidth = Math.max(0.8, curbW * 0.7);
    ctx.fillRect(-s * 0.55, -s * 0.55, s * 1.1, s * 1.1);
    ctx.strokeRect(-s * 0.55, -s * 0.55, s * 1.1, s * 1.1);
  } else if (plaza.centerpiece === 'market-stalls') {
    const colors = [palette.roofPalette[0] ?? '#9E4638', palette.roofPalette[1] ?? '#B35A43', '#D9C28E'];
    const sw = Math.max(3.5, minDim * 0.14);
    const sh = Math.max(2.5, minDim * 0.09);
    const offsets = [
      [-sw * 1.35, -sh * 1.6],
      [sw * 0.35, -sh * 1.6],
      [-sw * 1.35, sh * 0.65],
      [sw * 0.35, sh * 0.65]
    ];
    for (let i = 0; i < offsets.length; i += 1) {
      const [ox, oy] = offsets[i];
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(ox, oy, sw, sh);
      ctx.strokeStyle = theme.colors.ink;
      ctx.lineWidth = Math.max(0.6, curbW * 0.55);
      ctx.strokeRect(ox, oy, sw, sh);
    }
  } else if (plaza.centerpiece === 'tree') {
    const r = Math.max(4, minDim * 0.16);
    ctx.beginPath();
    ctx.arc(r * 0.25, r * 0.25, r, 0, Math.PI * 2);
    ctx.fillStyle = palette.roofShadow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = palette.parkGreen;
    ctx.fill();
    ctx.strokeStyle = theme.colors.ink;
    ctx.lineWidth = Math.max(0.8, curbW * 0.7);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Renders urban paths (`avenue`, `alley`, `canal`, `wall`).
 * Assumes ctx is ALREADY translated/rotated/alpha-applied by `drawPathToContext`,
 * receiving local coordinates `pts = [x0, y0, ...]`!
 * Returns true if the path kind was handled as an urban path.
 */
export function drawUrbanPathSegmentsToContext(
  ctx: CanvasRenderingContext2D,
  path: PathObject,
  pts: readonly number[],
  theme: MapTheme | undefined,
  scaleX: number,
  scaleY: number
): boolean {
  if (
    path.kind !== 'avenue' &&
    path.kind !== 'alley' &&
    path.kind !== 'canal' &&
    path.kind !== 'wall'
  ) {
    return false;
  }

  const vertexCount = Math.floor(pts.length / 2);
  if (vertexCount < 2) return true;

  const avgScale = (scaleX + scaleY) * 0.5;
  const baseWidthPx = Math.max(0.75, path.strokeWidthDoc * avgScale);
  const resolvedTheme = theme;
  const palette = resolvedTheme ? getCityThemePalette(resolvedTheme) : null;
  const inkColor = resolvedTheme?.colors.ink ?? '#263C40';

  const traceLine = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0] * scaleX, pts[1] * scaleY);
    for (let i = 1; i < vertexCount; i += 1) {
      ctx.lineTo(pts[i * 2] * scaleX, pts[i * 2 + 1] * scaleY);
    }
  };

  if (path.kind === 'avenue' || path.kind === 'alley') {
    const casingPx = path.kind === 'avenue' ? Math.max(2.0, avgScale * 2.4) : Math.max(1.2, avgScale * 1.4);
    traceLine();
    ctx.strokeStyle = palette?.streetBorder ?? 'rgba(33, 21, 12, 0.58)';
    ctx.lineWidth = baseWidthPx + casingPx;
    ctx.stroke();

    traceLine();
    ctx.strokeStyle = path.color || palette?.streetFill || '#EAE0C8';
    ctx.lineWidth = baseWidthPx;
    ctx.stroke();
    return true;
  }

  if (path.kind === 'canal') {
    // Masonry embankment along canal edges
    traceLine();
    ctx.strokeStyle = palette?.wallStone ?? '#6E665C';
    ctx.lineWidth = baseWidthPx + Math.max(2.6, avgScale * 3.2);
    ctx.stroke();

    // Dark ink inner rim
    traceLine();
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = baseWidthPx + Math.max(0.8, avgScale * 0.9);
    ctx.stroke();

    // Water channel core
    traceLine();
    ctx.strokeStyle = path.color || palette?.canalWater || '#5F939C';
    ctx.lineWidth = baseWidthPx;
    ctx.stroke();

    // Gentle highlight center filament
    if (baseWidthPx >= 5) {
      ctx.save();
      ctx.globalAlpha *= 0.25;
      traceLine();
      ctx.strokeStyle = '#EAF6F6';
      ctx.lineWidth = Math.max(1, baseWidthPx * 0.25);
      ctx.stroke();
      ctx.restore();
    }
    return true;
  }

  // City Wall ('wall'): SE shadow + ink perimeter + stone masonry core + battlements
  ctx.save();
  ctx.translate(Math.max(1.5, baseWidthPx * 0.18), Math.max(1.5, baseWidthPx * 0.18));
  traceLine();
  ctx.strokeStyle = palette?.roofShadow ?? 'rgba(20, 15, 12, 0.34)';
  ctx.lineWidth = baseWidthPx + Math.max(1.2, avgScale * 1.2);
  ctx.stroke();
  ctx.restore();

  traceLine();
  ctx.strokeStyle = inkColor;
  ctx.lineWidth = baseWidthPx + Math.max(1.8, avgScale * 2.0);
  ctx.stroke();

  traceLine();
  ctx.strokeStyle = path.color || palette?.wallStone || '#6E665C';
  ctx.lineWidth = baseWidthPx;
  ctx.stroke();

  // Battlement / merlon ticks perpendicular to wall center
  const tickStepPx = Math.max(5, baseWidthPx * 0.72);
  const tickHalfLen = baseWidthPx * 0.48;
  ctx.beginPath();
  let carry = 0;
  for (let i = 0; i < vertexCount - 1; i += 1) {
    const ax = pts[i * 2] * scaleX;
    const ay = pts[i * 2 + 1] * scaleY;
    const bx = pts[(i + 1) * 2] * scaleX;
    const by = pts[(i + 1) * 2 + 1] * scaleY;
    const dx = bx - ax;
    const dy = by - ay;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-3) continue;
    const nx = -dy / segLen;
    const ny = dx / segLen;
    let dist = tickStepPx - carry;
    while (dist <= segLen) {
      const t = dist / segLen;
      const px = ax + dx * t;
      const py = ay + dy * t;
      ctx.moveTo(px + nx * tickHalfLen * 0.45, py + ny * tickHalfLen * 0.45);
      ctx.lineTo(px + nx * tickHalfLen, py + ny * tickHalfLen);
      dist += tickStepPx;
    }
    carry = (carry + segLen) % tickStepPx;
  }
  ctx.strokeStyle = inkColor;
  ctx.lineWidth = Math.max(0.8, baseWidthPx * 0.14);
  ctx.stroke();

  return true;
}
