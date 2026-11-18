import { BUILTIN_POI_CATALOG } from '../assets/catalog';
import { COVER_FIELDS, COVER_FOREST, MapDocument, createEmptyDocument } from './document';
import { ptToDocUnits } from './coordinates';

/**
 * Creates a deterministic sample map matching the promontory & harbor review scene
 * for isolated Wave 1/Wave 2 development and automated tests.
 */
export function createSampleWorldDocument(options: { widthPx?: number; heightPx?: number } = {}): MapDocument {
  const towerItem = BUILTIN_POI_CATALOG.find((item) => item.id === 'poi-tower')!;
  const harborItem = BUILTIN_POI_CATALOG.find((item) => item.id === 'poi-harbor')!;

  const doc = createEmptyDocument({
    id: '9c42105f-ff0c-4401-9062-000000000001',
    title: 'Arcipelago delle Brume',
    widthPx: options.widthPx ?? 594,
    heightPx: options.heightPx ?? 420,
    seed: 173,
    assets: [towerItem.asset, harborItem.asset]
  });

  const { widthPx, heightPx, mask, height, cover } = doc.terrain;
  const cx = widthPx * 0.48;
  const cy = heightPx * 0.52;
  const rx = widthPx * 0.28;
  const ry = heightPx * 0.25;

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const dist = Math.hypot(nx, ny);
      if (dist <= 1.0) {
        const idx = y * widthPx + x;
        mask[idx] = 255;
        const elev = Math.round(Math.max(0, (1 - dist) * 240));
        height[idx] = Math.min(255, elev);
        if (elev >= 45 && elev <= 165 && nx < 0.25) {
          cover[idx] = COVER_FOREST;
        } else if (elev >= 32 && elev <= 100 && nx >= 0.25) {
          cover[idx] = COVER_FIELDS;
        }
      }
    }
  }

  doc.manifest.objects = [
    {
      id: 'obj-sample-harbor',
      type: 'stamp',
      role: 'poi',
      categoryId: harborItem.categoryId,
      assetId: harborItem.asset.id,
      x: doc.manifest.space.width * 0.74,
      y: doc.manifest.space.height * 0.52,
      width: harborItem.defaultWidthDoc,
      height: harborItem.defaultHeightDoc,
      rotationDeg: 0
    },
    {
      id: 'obj-sample-tower',
      type: 'stamp',
      role: 'poi',
      categoryId: towerItem.categoryId,
      assetId: towerItem.asset.id,
      x: doc.manifest.space.width * 0.48,
      y: doc.manifest.space.height * 0.44,
      width: towerItem.defaultWidthDoc,
      height: towerItem.defaultHeightDoc,
      rotationDeg: 0
    },
    {
      id: 'obj-sample-label',
      type: 'label',
      text: 'Porto delle Brume',
      x: doc.manifest.space.width * 0.72,
      y: doc.manifest.space.height * 0.59,
      fontId: 'spectral-semibold',
      fontSize: Number(ptToDocUnits(11).toFixed(2)),
      color: '#263C40',
      rotationDeg: 0
    }
  ];

  doc.manifest.revision = 1;
  doc.terrainVersion = 1;
  return doc;
}
