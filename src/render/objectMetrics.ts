import { LoadedAssetMap } from '../assets/types';
import { LabelObject, MapDocument, StampObject } from '../model/document';
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
 * Shared canvas-2d object rendering routine used by PDF export and live preview
 * thumbnails so exported maps match the interactive map geometry, font metrics,
 * z-order, clockwise rotations, and page clipping.
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

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, pageWidthPx, pageHeightPx);
  ctx.clip();

  for (const obj of doc.manifest.objects) {
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
      if (!obj.text) continue;
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
    }
  }

  ctx.restore();
}
