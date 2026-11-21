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

/**
 * Renders a single `PathObject` onto a Canvas2D context using `(scaleX, scaleY)`
 * from document units to canvas pixels. Handles smooth curves, borders (dashed),
 * rivers (tapered from narrow source to wider mouth), and clockwise rotation.
 */
export function drawPathToContext(
  ctx: CanvasRenderingContext2D,
  path: PathObject,
  scaleX: number,
  scaleY: number
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

  if (path.tapered && vertexCount >= 2) {
    const steps = vertexCount - 1;
    for (let i = 0; i < steps; i += 1) {
      const t = (i + 0.5) / steps;
      const wFactor = 0.25 + 1.05 * t;
      ctx.beginPath();
      ctx.moveTo(pts[i * 2] * scaleX, pts[i * 2 + 1] * scaleY);
      ctx.lineTo(pts[(i + 1) * 2] * scaleX, pts[(i + 1) * 2 + 1] * scaleY);
      ctx.lineWidth = Math.max(0.75, baseWidthPx * wFactor);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (path.dashed) {
    ctx.setLineDash([Math.max(4, baseWidthPx * 2.2), Math.max(3, baseWidthPx * 1.4)]);
  } else {
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.moveTo(pts[0] * scaleX, pts[1] * scaleY);
  for (let i = 1; i < vertexCount; i += 1) {
    ctx.lineTo(pts[i * 2] * scaleX, pts[i * 2 + 1] * scaleY);
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
    drawPathToContext(ctx, obj, scaleX, scaleY);
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
