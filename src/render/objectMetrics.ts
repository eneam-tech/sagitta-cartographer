import { LoadedAssetMap } from '../assets/types';
import {
  LabelObject,
  MapDocument,
  MapLayer,
  MapObject,
  PathObject,
  StampObject,
  createDefaultLayers,
  resolveObjectLayerId
} from '../model/document';
import { MapTheme, getFontSpec } from '../theme/theme';
import {
  drawBuildingToContext,
  drawPlazaToContext,
  drawUrbanPathSegmentsToContext
} from './cityRenderer';

export function resolveLabelFontCss(label: LabelObject, theme: MapTheme, scale = 1): string {
  const spec = getFontSpec(theme, label.fontId);
  const stylePart = spec.italic ? 'italic ' : '';
  const pxSize = Math.max(1, label.fontSize * scale);
  return `${stylePart}${spec.weight} ${pxSize}px ${spec.family}`;
}

export function resolveLabelHaloWidth(fontSize: number, scale = 1): number {
  return Math.max(1.5, fontSize * scale * 0.14);
}

export function getStampDrawRect(stamp: StampObject): { x: number; y: number; width: number; height: number } {
  return {
    x: -stamp.width / 2,
    y: -stamp.height / 2,
    width: stamp.width,
    height: stamp.height
  };
}

/**
 * Samples quadratic midpoint spline points `[x0, y0, ...]` into a polyline suitable for
 * crisp tapered or constant-width stroke rendering in Canvas2D and Konva.
 */
export function sampleSmoothPathPoints(points: readonly number[], subdivisionsPerSegment = 6): number[] {
  if (points.length <= 4) {
    return [...points];
  }
  const result: number[] = [points[0], points[1]];
  const vertexCount = Math.floor(points.length / 2);

  for (let i = 1; i < vertexCount - 1; i += 1) {
    const x0 = i === 1 ? points[0] : (points[(i - 1) * 2] + points[i * 2]) / 2;
    const y0 = i === 1 ? points[1] : (points[(i - 1) * 2 + 1] + points[i * 2 + 1]) / 2;
    const cx = points[i * 2];
    const cy = points[i * 2 + 1];
    const x1 = i === vertexCount - 2 ? points[(i + 1) * 2] : (cx + points[(i + 1) * 2]) / 2;
    const y1 = i === vertexCount - 2 ? points[(i + 1) * 2 + 1] : (cy + points[(i + 1) * 2 + 1]) / 2;

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

function drawTaperedRibbon(
  ctx: CanvasRenderingContext2D,
  pts: readonly number[],
  scaleX: number,
  scaleY: number,
  baseWidthPx: number,
  color: string
): void {
  const scaled: number[] = [];
  const rawCount = Math.floor(pts.length / 2);
  if (rawCount === 2) {
    // Subdivide a single 2-point straight segment so tapering stays continuous
    const x0 = pts[0] * scaleX;
    const y0 = pts[1] * scaleY;
    const x1 = pts[2] * scaleX;
    const y1 = pts[3] * scaleY;
    for (let s = 0; s <= 6; s += 1) {
      const t = s / 6;
      scaled.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  } else {
    for (let i = 0; i < rawCount; i += 1) {
      scaled.push(pts[i * 2] * scaleX, pts[i * 2 + 1] * scaleY);
    }
  }

  const n = Math.floor(scaled.length / 2);
  if (n < 2) return;

  const leftX = new Float64Array(n);
  const leftY = new Float64Array(n);
  const rightX = new Float64Array(n);
  const rightY = new Float64Array(n);

  for (let i = 0; i < n; i += 1) {
    const prevIdx = Math.max(0, i - 1);
    const nextIdx = Math.min(n - 1, i + 1);
    let dx = scaled[nextIdx * 2] - scaled[prevIdx * 2];
    let dy = scaled[nextIdx * 2 + 1] - scaled[prevIdx * 2 + 1];
    let len = Math.hypot(dx, dy);
    if (len < 1e-6 && i > 0) {
      dx = scaled[i * 2] - scaled[(i - 1) * 2];
      dy = scaled[i * 2 + 1] - scaled[(i - 1) * 2 + 1];
      len = Math.hypot(dx, dy);
    }
    const tx = len >= 1e-6 ? dx / len : 1;
    const ty = len >= 1e-6 ? dy / len : 0;

    const nx = -ty;
    const ny = tx;
    const t = i / (n - 1);
    const halfW = Math.max(0.4, baseWidthPx * (0.25 + 1.05 * t) * 0.5);
    const cx = scaled[i * 2];
    const cy = scaled[i * 2 + 1];
    leftX[i] = cx + nx * halfW;
    leftY[i] = cy + ny * halfW;
    rightX[i] = cx - nx * halfW;
    rightY[i] = cy - ny * halfW;
  }

  const endIdx = n - 1;
  const startHalfW = Math.hypot(leftX[0] - scaled[0], leftY[0] - scaled[1]);
  const endHalfW = Math.hypot(leftX[endIdx] - scaled[endIdx * 2], leftY[endIdx] - scaled[endIdx * 2 + 1]);

  const capSteps = 6;
  const startRightAngle = Math.atan2(rightY[0] - scaled[1], rightX[0] - scaled[0]);
  const endLeftAngle = Math.atan2(leftY[endIdx] - scaled[endIdx * 2 + 1], leftX[endIdx] - scaled[endIdx * 2]);

  ctx.beginPath();
  // Round cap at source (from right[0] around backward normal to left[0])
  ctx.moveTo(rightX[0], rightY[0]);
  for (let s = 1; s < capSteps; s += 1) {
    // -Math.PI sweep goes through (-tx, -ty) if left is (+90 deg) from +tangent; Wait: left = (-ty, tx) = +90 deg from (tx, ty) in screen Y-down!
    // Right is -90 deg from tangent, Left is +90 deg. Moving from Right (-90) through -tangent (+/-180) to Left (+90) sweeps -Math.PI!
    const angle = startRightAngle - (Math.PI * s) / capSteps;
    ctx.lineTo(scaled[0] + Math.cos(angle) * startHalfW, scaled[1] + Math.sin(angle) * startHalfW);
  }
  ctx.lineTo(leftX[0], leftY[0]);
  for (let i = 1; i < n; i += 1) {
    ctx.lineTo(leftX[i], leftY[i]);
  }
  // Round cap at mouth (from left[n-1] around forward +tangent to right[n-1])
  for (let s = 1; s < capSteps; s += 1) {
    const angle = endLeftAngle - (Math.PI * s) / capSteps;
    ctx.lineTo(
      scaled[endIdx * 2] + Math.cos(angle) * endHalfW,
      scaled[endIdx * 2 + 1] + Math.sin(angle) * endHalfW
    );
  }
  for (let i = endIdx; i >= 0; i -= 1) {
    ctx.lineTo(rightX[i], rightY[i]);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (typeof ctx.stroke === 'function') {
    ctx.strokeStyle = 'rgba(33, 21, 12, 0.36)';
    ctx.lineWidth = Math.max(0.85, baseWidthPx * 0.13);
    ctx.stroke();
  }
}

/**
 * Renders a single `PathObject` onto a Canvas2D context using `(scaleX, scaleY)`
 * from document units to canvas pixels. Handles smooth curves, borders (dashed),
 * rivers (continuous tapered polygon fill), and clockwise rotation.
 */
export function drawPathToContext(
  ctx: CanvasRenderingContext2D,
  path: PathObject,
  scaleX: number,
  scaleY: number,
  theme?: MapTheme
): void {
  if (path.points.length < 4) return;
  const pts = path.smooth !== false ? sampleSmoothPathPoints(path.points, 5) : path.points;
  const vertexCount = Math.floor(pts.length / 2);
  if (vertexCount < 2) return;

  const avgScale = (scaleX + scaleY) * 0.5;
  const baseWidthPx = Math.max(0.75, path.strokeWidthDoc * avgScale);
  const pathAlpha = path.opacity === undefined ? 1 : Math.min(1, Math.max(0, path.opacity));
  if (pathAlpha <= 0) return;

  ctx.save();
  ctx.globalAlpha *= pathAlpha;
  ctx.translate(path.x * scaleX, path.y * scaleY);
  ctx.rotate((path.rotationDeg * Math.PI) / 180);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = path.color;

  if (drawUrbanPathSegmentsToContext(ctx, path, pts, theme, scaleX, scaleY)) {
    ctx.restore();
    return;
  }

  if (path.tapered && vertexCount >= 2 && typeof ctx.fill === 'function' && typeof ctx.closePath === 'function') {
    drawTaperedRibbon(ctx, pts, scaleX, scaleY, baseWidthPx, path.color);
    ctx.restore();
    return;
  }

  if (path.dashed) {
    const dashDoc = Math.max(4, path.strokeWidthDoc * 2.2);
    const gapDoc = Math.max(3, path.strokeWidthDoc * 1.4);
    ctx.setLineDash([dashDoc * avgScale, gapDoc * avgScale]);
  } else {
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.moveTo(pts[0] * scaleX, pts[1] * scaleY);
  for (let i = 1; i < vertexCount; i += 1) {
    ctx.lineTo(pts[i * 2] * scaleX, pts[i * 2 + 1] * scaleY);
  }
  if (path.kind === 'road' && !path.dashed) {
    ctx.lineWidth = baseWidthPx + Math.max(1.8, avgScale * 2.4);
    ctx.strokeStyle = 'rgba(33, 21, 12, 0.56)';
    ctx.stroke();
    ctx.strokeStyle = path.color;
  }
  ctx.lineWidth = baseWidthPx;
  ctx.stroke();
  ctx.restore();
}

function drawSingleMapObject(
  ctx: CanvasRenderingContext2D,
  obj: MapObject,
  doc: MapDocument,
  assets: LoadedAssetMap,
  scaleX: number,
  scaleY: number
): void {
  if (obj.type === 'stamp') {
    const resource = assets.get(obj.assetId);
    if (!resource) {
      throw new Error(`Risorsa mancante durante il rendering dell'oggetto "${obj.id}": ${obj.assetId}.`);
    }
    ctx.save();
    ctx.translate(obj.x * scaleX, obj.y * scaleY);
    ctx.rotate((obj.rotationDeg * Math.PI) / 180);
    const w = obj.width * scaleX;
    const h = obj.height * scaleY;
    ctx.drawImage(resource.image, -w * resource.entry.anchorX, -h * resource.entry.anchorY, w, h);
    ctx.restore();
  } else if (obj.type === 'label') {
    if (!obj.text) return;
    const spec = getFontSpec(doc.theme, obj.fontId);
    ctx.save();
    ctx.translate(obj.x * scaleX, obj.y * scaleY);
    ctx.rotate((obj.rotationDeg * Math.PI) / 180);
    ctx.font = `${spec.italic ? 'italic ' : ''}${spec.weight} ${obj.fontSize * scaleY}px ${spec.family}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = resolveLabelHaloWidth(obj.fontSize, scaleY);
    ctx.strokeStyle = doc.theme.colors.labelHalo;
    ctx.strokeText(obj.text, 0, 0);
    ctx.fillStyle = obj.color;
    ctx.fillText(obj.text, 0, 0);
    ctx.restore();
  } else if (obj.type === 'path') {
    drawPathToContext(ctx, obj, scaleX, scaleY, doc.theme);
  } else if (obj.type === 'building') {
    drawBuildingToContext(ctx, obj, doc.theme, scaleX, scaleY);
  } else if (obj.type === 'plaza') {
    drawPlazaToContext(ctx, obj, doc.theme, scaleX, scaleY);
  }
}

/**
 * Shared canvas-2d object rendering routine used by PDF export and live preview
 * thumbnails so exported maps match the interactive map geometry, font metrics,
 * layer stacking/visibility/opacity, z-order, clockwise rotations, and page clipping.
 */
export function drawMapObjectsToContext(
  ctx: CanvasRenderingContext2D,
  doc: MapDocument,
  assets: LoadedAssetMap,
  scaleX: number,
  scaleY: number
): void {
  const pageWidthPx = doc.manifest.space.width * scaleX;
  const pageHeightPx = doc.manifest.space.height * scaleY;

  const layers: readonly MapLayer[] =
    doc.manifest.layers && doc.manifest.layers.length > 0
      ? doc.manifest.layers
      : createDefaultLayers();

  const objectsByLayer = new Map<string, MapObject[]>();
  for (const layer of layers) {
    if (layer.kind !== 'terrain') {
      objectsByLayer.set(layer.id, []);
    }
  }
  for (const obj of doc.manifest.objects) {
    const resolvedLayerId = resolveObjectLayerId(obj, layers);
    let bucket = objectsByLayer.get(resolvedLayerId);
    if (!bucket) {
      bucket = [];
      objectsByLayer.set(resolvedLayerId, bucket);
    }
    bucket.push(obj);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, pageWidthPx, pageHeightPx);
  ctx.clip();

  for (const layer of layers) {
    if (layer.kind === 'terrain' || !layer.visible || layer.opacity <= 0) {
      continue;
    }
    const items = objectsByLayer.get(layer.id);
    if (!items || items.length === 0) continue;

    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
    for (const obj of items) {
      drawSingleMapObject(ctx, obj, doc, assets, scaleX, scaleY);
    }
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Draws an antique cartographic inner border & subtle sepia edge vignette onto a
 * 2D canvas context strictly when the `regni-del-nord` Witcher atlas theme is active.
 */
export function drawAtlasFrameToContext(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
  theme: MapTheme
): void {
  if (theme.id !== 'regni-del-nord' || widthPx <= 0 || heightPx <= 0) {
    return;
  }
  const minDim = Math.min(widthPx, heightPx);
  const insetOuter = Math.max(4, minDim * 0.014);
  const insetInner = insetOuter + Math.max(2, minDim * 0.005);

  ctx.save();
  if (typeof ctx.createRadialGradient === 'function' && typeof ctx.fillRect === 'function') {
    const cx = widthPx * 0.5;
    const cy = heightPx * 0.5;
    const r0 = Math.hypot(widthPx, heightPx) * 0.34;
    const r1 = Math.hypot(widthPx, heightPx) * 0.56;
    const grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    grad.addColorStop(0, 'rgba(33, 21, 12, 0)');
    grad.addColorStop(1, 'rgba(33, 21, 12, 0.22)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, widthPx, heightPx);
  }

  ctx.strokeStyle = 'rgba(33, 21, 12, 0.72)';
  ctx.lineWidth = Math.max(1.2, minDim * 0.0022);
  ctx.strokeRect(insetOuter, insetOuter, widthPx - insetOuter * 2, heightPx - insetOuter * 2);

  ctx.strokeStyle = 'rgba(224, 187, 121, 0.72)';
  ctx.lineWidth = Math.max(0.8, minDim * 0.0014);
  ctx.strokeRect(insetInner, insetInner, widthPx - insetInner * 2, heightPx - insetInner * 2);
  ctx.restore();
}
