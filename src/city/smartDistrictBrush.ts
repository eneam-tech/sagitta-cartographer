import { clampNumber } from '../model/coordinates';
import {
  BuildingObject,
  BuildingRenderStyle,
  BuildingShape,
  DEFAULT_LAYER_BUILDINGS_ID,
  MapDocument,
  resolveObjectLayerId
} from '../model/document';
import { createBuildingObject } from '../objects/objectCommands';
import {
  OrientedBox,
  createSeededRng,
  distPointToSegment,
  findNearestUrbanStreet,
  getCityThemePalette,
  isBoxBlockedByExistingFeatures,
  pickDeterministicRoofColor,
  probeCoastlineAtDoc,
  sampleLandMaskAtDoc
} from './geometry';

export type DistrictPresetId =
  | 'residential'
  | 'dense-slums'
  | 'noble-manors'
  | 'market-quarter'
  | 'harbor-docks';

export interface DistrictPresetSpec {
  id: DistrictPresetId;
  label: string;
  description: string;
  baseWidthRange: readonly [number, number];
  aspectRange: readonly [number, number];
  spacingMultiplier: number;
  shapes: ReadonlyArray<{ shape: BuildingShape; weight: number }>;
}

export const DISTRICT_PRESETS: ReadonlyArray<DistrictPresetSpec> = [
  {
    id: 'residential',
    label: 'Quartiere borghese',
    description: 'Case a schiera e palazzetti regolari allineati al fronte stradale.',
    baseWidthRange: [26, 44],
    aspectRange: [0.58, 0.84],
    spacingMultiplier: 1.0,
    shapes: [
      { shape: 'rect', weight: 0.65 },
      { shape: 'l-shape', weight: 0.25 },
      { shape: 'courtyard', weight: 0.1 }
    ]
  },
  {
    id: 'dense-slums',
    label: 'Borgo fitto e vicoli',
    description: 'Casupole minute, fitte e leggermente irregolari per quartieri popolari.',
    baseWidthRange: [17, 30],
    aspectRange: [0.62, 0.92],
    spacingMultiplier: 0.72,
    shapes: [
      { shape: 'rect', weight: 0.76 },
      { shape: 'l-shape', weight: 0.2 },
      { shape: 'tower', weight: 0.04 }
    ]
  },
  {
    id: 'noble-manors',
    label: 'Palazzi nobiliari',
    description: 'Grandi residenze con corte interna, giardini e ali a L.',
    baseWidthRange: [44, 70],
    aspectRange: [0.68, 0.95],
    spacingMultiplier: 1.38,
    shapes: [
      { shape: 'courtyard', weight: 0.55 },
      { shape: 'l-shape', weight: 0.3 },
      { shape: 'rect', weight: 0.15 }
    ]
  },
  {
    id: 'market-quarter',
    label: 'Botteghe e mercato',
    description: 'Padiglioni commerciali, tettoie lunghe e botteghe intorno alle vie centrali.',
    baseWidthRange: [30, 52],
    aspectRange: [0.52, 0.78],
    spacingMultiplier: 1.05,
    shapes: [
      { shape: 'market', weight: 0.48 },
      { shape: 'rect', weight: 0.36 },
      { shape: 'l-shape', weight: 0.16 }
    ]
  },
  {
    id: 'harbor-docks',
    label: 'Magazzini portuali',
    description: 'Capannoni allungati allineati a banchine, fiumi e canali.',
    baseWidthRange: [36, 60],
    aspectRange: [0.42, 0.68],
    spacingMultiplier: 1.12,
    shapes: [
      { shape: 'rect', weight: 0.68 },
      { shape: 'market', weight: 0.22 },
      { shape: 'l-shape', weight: 0.1 }
    ]
  }
];

export function getDistrictPresetSpec(id: DistrictPresetId): DistrictPresetSpec {
  return DISTRICT_PRESETS.find((p) => p.id === id) ?? DISTRICT_PRESETS[0];
}

export interface SmartDistrictBrushParams {
  diameterDoc: number;
  density: number; // 0.2 .. 1.0
  buildingScale: number; // 0.6 .. 1.6
  irregularity: number; // 0.0 .. 1.0
  preset: DistrictPresetId;
  renderStyle?: 'auto' | BuildingRenderStyle;
  layerId?: string;
  seed?: number;
}

function pickWeightedShape(
  spec: DistrictPresetSpec,
  rng: () => number
): BuildingShape {
  let total = 0;
  for (const item of spec.shapes) total += item.weight;
  let roll = rng() * total;
  for (const item of spec.shapes) {
    roll -= item.weight;
    if (roll <= 0) return item.shape;
  }
  return spec.shapes[0].shape;
}

function areBuildingCornersOnLand(
  doc: MapDocument,
  box: OrientedBox
): boolean {
  if (!sampleLandMaskAtDoc(doc, box.x, box.y)) return false;
  const rad = (box.rotationDeg * Math.PI) / 180;
  const ux = Math.cos(rad) * (box.width * 0.44);
  const uy = Math.sin(rad) * (box.width * 0.44);
  const vx = -Math.sin(rad) * (box.height * 0.44);
  const vy = Math.cos(rad) * (box.height * 0.44);

  return (
    sampleLandMaskAtDoc(doc, box.x + ux + vx, box.y + uy + vy) &&
    sampleLandMaskAtDoc(doc, box.x - ux + vx, box.y - uy + vy) &&
    sampleLandMaskAtDoc(doc, box.x - ux - vx, box.y - uy - vy) &&
    sampleLandMaskAtDoc(doc, box.x + ux - vx, box.y + uy - vy)
  );
}

function buildSpatialGridCandidates(
  strokePoints: ReadonlyArray<{ x: number; y: number }>,
  radiusDoc: number,
  stepDoc: number,
  maxWidth: number,
  maxHeight: number,
  rng: () => number
): Array<{ x: number; y: number }> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of strokePoints) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  minX = Math.max(12, Math.floor((minX - radiusDoc) / stepDoc) * stepDoc);
  minY = Math.max(12, Math.floor((minY - radiusDoc) / stepDoc) * stepDoc);
  maxX = Math.min(maxWidth - 12, Math.ceil((maxX + radiusDoc) / stepDoc) * stepDoc);
  maxY = Math.min(maxHeight - 12, Math.ceil((maxY + radiusDoc) / stepDoc) * stepDoc);

  const candidates: Array<{ x: number; y: number }> = [];
  const count = strokePoints.length;

  for (let gx = minX; gx <= maxX; gx += stepDoc) {
    for (let gy = minY; gy <= maxY; gy += stepDoc) {
      const cx = gx + (rng() - 0.5) * stepDoc * 0.65;
      const cy = gy + (rng() - 0.5) * stepDoc * 0.65;
      let minDist = Infinity;
      if (count === 1) {
        minDist = Math.hypot(cx - strokePoints[0].x, cy - strokePoints[0].y);
      } else {
        for (let i = 0; i < count - 1; i += 1) {
          const hit = distPointToSegment(
            cx,
            cy,
            strokePoints[i].x,
            strokePoints[i].y,
            strokePoints[i + 1].x,
            strokePoints[i + 1].y
          );
          if (hit.dist < minDist) minDist = hit.dist;
        }
      }
      if (minDist <= radiusDoc * 0.96) {
        candidates.push({ x: cx, y: cy });
      }
    }
  }

  // Shuffle deterministically so borders don't get biased exclusively top-left -> bottom-right
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }

  return candidates;
}

/**
 * Generates street-aligned, non-overlapping urban buildings inside a brush stroke.
 */
export function generateDistrictBuildingsAlongStroke(
  doc: MapDocument,
  strokePoints: ReadonlyArray<{ x: number; y: number }>,
  params: SmartDistrictBrushParams
): BuildingObject[] {
  if (strokePoints.length === 0) return [];

  const preset = getDistrictPresetSpec(params.preset);
  const density = clampNumber(params.density, 0.2, 1.0);
  const scale = clampNumber(params.buildingScale, 0.55, 1.7);
  const irregularity = clampNumber(params.irregularity, 0, 1);
  const radiusDoc = clampNumber(params.diameterDoc * 0.5, 12, 260);
  const layerId =
    params.layerId ??
    doc.manifest.layers.find((l) => l.kind === 'buildings')?.id ??
    DEFAULT_LAYER_BUILDINGS_ID;

  const resolvedLayerId = resolveObjectLayerId(
    { type: 'building', layerId },
    doc.manifest.layers
  );

  const seedBase =
    ((params.seed ?? doc.manifest.terrain.seed) ^
      Math.round(strokePoints[0].x * 13 + strokePoints[0].y * 37) ^
      doc.manifest.objects.length * 101) >>>
    0;
  const rng = createSeededRng(seedBase);

  const avgWidth =
    ((preset.baseWidthRange[0] + preset.baseWidthRange[1]) * 0.5) * scale;
  const stepDoc = clampNumber(
    (avgWidth * 0.85 * preset.spacingMultiplier) / (0.48 + density * 0.72),
    18,
    92
  );

  const candidates = buildSpatialGridCandidates(
    strokePoints,
    radiusDoc,
    stepDoc,
    doc.manifest.space.width,
    doc.manifest.space.height,
    rng
  );

  const placedBoxes: OrientedBox[] = [];
  const created: BuildingObject[] = [];
  const cityPalette = getCityThemePalette(doc.theme);
  const customStyle =
    params.renderStyle && params.renderStyle !== 'auto'
      ? params.renderStyle
      : undefined;
  const buildingGapDoc = irregularity < 0.25 ? 2.2 : 3.2;
  const maxPerStroke = 150;

  for (const pt of candidates) {
    if (created.length >= maxPerStroke) break;
    if (rng() > 0.35 + density * 0.68) continue;

    const shape = pickWeightedShape(preset, rng);
    const width =
      (preset.baseWidthRange[0] +
        rng() * (preset.baseWidthRange[1] - preset.baseWidthRange[0])) *
      scale;
    const aspect =
      preset.aspectRange[0] +
      rng() * (preset.aspectRange[1] - preset.aspectRange[0]);
    let finalWidth = Number(clampNumber(width, 12, 110).toFixed(1));
    let finalHeight = Number(clampNumber(width * aspect, 12, 110).toFixed(1));
    if (shape === 'tower') {
      const side = Math.min(finalWidth, finalHeight) * 0.78;
      finalWidth = Number(clampNumber(side, 14, 42).toFixed(1));
      finalHeight = finalWidth;
    } else if (shape === 'courtyard') {
      finalHeight = Number(clampNumber(finalWidth * (0.78 + rng() * 0.2), 20, 110).toFixed(1));
    }

    const nearestStreet = findNearestUrbanStreet(doc, pt.x, pt.y, 145);
    let baseAngleDeg = 0;
    let cx = pt.x;
    let cy = pt.y;

    if (nearestStreet) {
      baseAngleDeg = nearestStreet.angleDeg;
      const curbClearance =
        nearestStreet.path.strokeWidthDoc * 0.56 + finalHeight * 0.5 + 3.5;
      // Gently snap lot front closer to curb if very near road centerline
      if (nearestStreet.dist < curbClearance + 22 && nearestStreet.dist > 1) {
        const vx = pt.x - nearestStreet.projX;
        const vy = pt.y - nearestStreet.projY;
        const len = Math.hypot(vx, vy);
        if (len > 0.5) {
          const targetDist = Math.max(curbClearance, len);
          cx = nearestStreet.projX + (vx / len) * targetDist;
          cy = nearestStreet.projY + (vy / len) * targetDist;
        }
      }
    } else if (params.preset === 'harbor-docks') {
      const coast = probeCoastlineAtDoc(doc, pt.x, pt.y, 44);
      if (coast.shoreAngleDeg !== null) {
        baseAngleDeg = coast.shoreAngleDeg;
      }
    } else {
      // Subtle local spatial neighborhood angle so freehand neighborhoods still feel coherent
      const cellX = Math.floor(pt.x / 220);
      const cellY = Math.floor(pt.y / 220);
      baseAngleDeg = ((cellX * 37 + cellY * 53) % 45) - 22;
    }

    // Occasional 90-deg orthogonal lot variation on corners
    const orthoFlip = !nearestStreet && rng() < 0.28 ? 90 : 0;
    const angleJitter = (rng() - 0.5) * 26 * irregularity;
    const rotationDeg = baseAngleDeg + orthoFlip + angleJitter;

    const candidateBox: OrientedBox = {
      x: cx,
      y: cy,
      width: finalWidth,
      height: finalHeight,
      rotationDeg
    };

    if (!areBuildingCornersOnLand(doc, candidateBox)) continue;
    if (
      candidateBox.x < 14 ||
      candidateBox.y < 14 ||
      candidateBox.x > doc.manifest.space.width - 14 ||
      candidateBox.y > doc.manifest.space.height - 14
    ) {
      continue;
    }

    const candidateRadius = Math.hypot(finalWidth * 0.45, finalHeight * 0.45);
    if (
      isBoxBlockedByExistingFeatures(
        doc,
        candidateBox,
        candidateRadius,
        placedBoxes,
        buildingGapDoc
      )
    ) {
      continue;
    }

    const buildingSeed = (seedBase ^ Math.round(cx * 31 + cy * 79) ^ created.length) >>> 0;
    const roofColor = pickDeterministicRoofColor(
      doc.theme,
      Math.floor(rng() * cityPalette.roofPalette.length) + created.length
    );

    const bldg = createBuildingObject({
      layerId: resolvedLayerId,
      shape,
      x: candidateBox.x,
      y: candidateBox.y,
      width: finalWidth,
      height: finalHeight,
      rotationDeg,
      roofColor,
      ...(customStyle ? { renderStyle: customStyle } : {}),
      districtTag: params.preset,
      seed: buildingSeed
    });

    placedBoxes.push(candidateBox);
    created.push(bldg);
  }

  return created;
}

/**
 * Finds IDs of buildings touched by an eraser brush stroke.
 */
export function findBuildingsInBrushStroke(
  doc: MapDocument,
  strokePoints: ReadonlyArray<{ x: number; y: number }>,
  diameterDoc: number
): string[] {
  if (strokePoints.length === 0) return [];
  const radius = Math.max(6, diameterDoc * 0.5);
  const count = strokePoints.length;
  const hitIds: string[] = [];

  for (const obj of doc.manifest.objects) {
    if (obj.type !== 'building') continue;
    let minDist = Infinity;
    if (count === 1) {
      minDist = Math.hypot(obj.x - strokePoints[0].x, obj.y - strokePoints[0].y);
    } else {
      for (let i = 0; i < count - 1; i += 1) {
        const hit = distPointToSegment(
          obj.x,
          obj.y,
          strokePoints[i].x,
          strokePoints[i].y,
          strokePoints[i + 1].x,
          strokePoints[i + 1].y
        );
        if (hit.dist < minDist) minDist = hit.dist;
      }
    }
    if (minDist <= radius + Math.min(obj.width, obj.height) * 0.35) {
      hitIds.push(obj.id);
    }
  }

  return hitIds;
}
