import { docToMaskX, docToMaskY } from '../model/coordinates';
import { CoverCode, MapDocument } from '../model/document';
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
