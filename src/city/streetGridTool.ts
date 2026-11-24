import { clampNumber } from '../model/coordinates';
import {
  BuildingRenderStyle,
  DEFAULT_LAYER_BUILDINGS_ID,
  DEFAULT_LAYER_VECTORS_ID,
  MapDocument,
  MapObject,
  PathObject,
  resolveObjectLayerId
} from '../model/document';
import { createBuildingObject, createPathObject } from '../objects/objectCommands';
import {
  URBAN_STREET_PATH_KINDS,
  createSeededRng,
  getCityThemePalette,
  getPathWorldPoints,
  sampleLandMaskAtDoc,
  segmentIntersection
} from './geometry';
import {
  DistrictPresetId,
  generateDistrictBuildingsAlongStroke
} from './smartDistrictBrush';

export type StreetGridStyle = 'orthogonal' | 'organic' | 'radial';

export interface StreetGridOptions {
  style: StreetGridStyle;
  spacingDoc: number;
  angleDeg: number;
  autoFillBuildings: boolean;
  districtPreset: DistrictPresetId;
  density: number;
  buildingScale: number;
  irregularity: number;
  renderStyle?: 'auto' | BuildingRenderStyle;
  vectorLayerId?: string;
  buildingsLayerId?: string;
  seed?: number;
}

export interface SmartWallOptions {
  strokeWidthDoc: number;
  towerSpacingDoc: number;
  autoTowers: boolean;
  autoGates: boolean;
  vectorLayerId?: string;
  buildingsLayerId?: string;
  renderStyle?: 'auto' | BuildingRenderStyle;
}

/**
 * Clips a polyline to consecutive land-only sub-polylines so roads automatically
 * stop at riverbanks, canals, and harbor coastlines.
 */
function clipPolylineToLand(
  doc: MapDocument,
  absPoints: readonly number[],
  stepDoc = 14
): number[][] {
  const count = Math.floor(absPoints.length / 2);
  if (count < 2) return [];

  const subPolylines: number[][] = [];
  let current: number[] = [];

  for (let i = 0; i < count - 1; i += 1) {
    const ax = absPoints[i * 2];
    const ay = absPoints[i * 2 + 1];
    const bx = absPoints[(i + 1) * 2];
    const by = absPoints[(i + 1) * 2 + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(segLen / stepDoc));

    for (let s = 0; s <= steps; s += 1) {
      if (i > 0 && s === 0) continue;
      const t = s / steps;
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      const onLand = sampleLandMaskAtDoc(doc, px, py);
      if (onLand) {
        current.push(px, py);
      } else if (current.length >= 4) {
        subPolylines.push(current);
        current = [];
      } else {
        current = [];
      }
    }
  }

  if (current.length >= 4) {
    subPolylines.push(current);
  }

  // Sub-sample gently to avoid excessive redundant collinear points
  return subPolylines.map((poly) => {
    const n = Math.floor(poly.length / 2);
    if (n <= 4) return poly;
    const out: number[] = [poly[0], poly[1]];
    for (let i = 1; i < n - 1; i += 2) {
      out.push(poly[i * 2], poly[i * 2 + 1]);
    }
    out.push(poly[(n - 1) * 2], poly[(n - 1) * 2 + 1]);
    return out;
  });
}

function addClippedRoad(
  doc: MapDocument,
  absPoints: readonly number[],
  kind: 'avenue' | 'road' | 'alley',
  strokeWidthDoc: number,
  layerId: string,
  smooth: boolean,
  outPaths: PathObject[]
): void {
  const clippedList = clipPolylineToLand(doc, absPoints);
  const cityPalette = getCityThemePalette(doc.theme);
  for (const poly of clippedList) {
    if (poly.length < 4) continue;
    outPaths.push(
      createPathObject({
        layerId,
        kind,
        points: poly,
        strokeWidthDoc,
        color: cityPalette.streetFill,
        theme: doc.theme,
        smooth
      })
    );
  }
}

/**
 * Generates an urban street grid (`orthogonal`, `organic`, or `radial`) inside
 * the dragged rectangle, optionally auto-filling adjacent blocks with aligned buildings.
 */
export function generateStreetGridInRect(
  doc: MapDocument,
  rect: { x: number; y: number; width: number; height: number },
  options: StreetGridOptions
): MapObject[] {
  const minDim = Math.min(rect.width, rect.height);
  if (minDim < 40) return [];

  const spacing = clampNumber(options.spacingDoc, 48, 260);
  const layerVec = resolveObjectLayerId(
    { type: 'path', layerId: options.vectorLayerId ?? DEFAULT_LAYER_VECTORS_ID },
    doc.manifest.layers
  );
  const layerBldg = resolveObjectLayerId(
    { type: 'building', layerId: options.buildingsLayerId ?? DEFAULT_LAYER_BUILDINGS_ID },
    doc.manifest.layers
  );

  const seed = ((options.seed ?? doc.manifest.terrain.seed) ^ Math.round(rect.x * 19 + rect.y * 41)) >>> 0;
  const rng = createSeededRng(seed);

  const cx = rect.x + rect.width * 0.5;
  const cy = rect.y + rect.height * 0.5;
  const rad = (options.angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const toWorld = (lx: number, ly: number): [number, number] => [
    clampNumber(cx + lx * cos - ly * sin, 8, doc.manifest.space.width - 8),
    clampNumber(cy + lx * sin + ly * cos, 8, doc.manifest.space.height - 8)
  ];

  const streets: PathObject[] = [];

  if (options.style === 'radial') {
    const maxR = Math.min(rect.width, rect.height) * 0.48;
    const ringCount = Math.max(1, Math.floor(maxR / spacing));
    for (let rIdx = 1; rIdx <= ringCount; rIdx += 1) {
      const r = (rIdx / ringCount) * maxR;
      const segments = Math.max(16, Math.round((2 * Math.PI * r) / 28));
      const pts: number[] = [];
      for (let s = 0; s <= segments; s += 1) {
        const theta = (Math.PI * 2 * s) / segments;
        const wobble = rIdx === 1 ? 0 : (rng() - 0.5) * 4;
        pts.push(
          clampNumber(cx + Math.cos(theta) * (r + wobble), 8, doc.manifest.space.width - 8),
          clampNumber(cy + Math.sin(theta) * (r + wobble), 8, doc.manifest.space.height - 8)
        );
      }
      addClippedRoad(
        doc,
        pts,
        rIdx === ringCount ? 'avenue' : 'road',
        rIdx === ringCount ? 14 : 9,
        layerVec,
        true,
        streets
      );
    }

    const spokeCount = clampNumber(Math.round((Math.PI * 2 * maxR) / (spacing * 1.45)), 4, 12);
    for (let k = 0; k < spokeCount; k += 1) {
      const theta = rad + (Math.PI * 2 * k) / spokeCount;
      const rStart = Math.min(spacing * 0.45, maxR * 0.25);
      const pts = [
        clampNumber(cx + Math.cos(theta) * rStart, 8, doc.manifest.space.width - 8),
        clampNumber(cy + Math.sin(theta) * rStart, 8, doc.manifest.space.height - 8),
        clampNumber(cx + Math.cos(theta) * maxR, 8, doc.manifest.space.width - 8),
        clampNumber(cy + Math.sin(theta) * maxR, 8, doc.manifest.space.height - 8)
      ];
      addClippedRoad(doc, pts, k % 2 === 0 ? 'avenue' : 'road', k % 2 === 0 ? 13 : 8.5, layerVec, false, streets);
    }
  } else {
    const halfW = rect.width * 0.5;
    const halfH = rect.height * 0.5;
    const cols = Math.max(2, Math.round(rect.width / spacing) + 1);
    const rows = Math.max(2, Math.round(rect.height / spacing) + 1);
    const organicAmp = options.style === 'organic' ? spacing * 0.14 : 0;

    // Horizontal-local streets (rotated by angleDeg)
    for (let r = 0; r < rows; r += 1) {
      const tY = rows === 1 ? 0.5 : r / (rows - 1);
      const baseY = -halfH + tY * rect.height;
      const isMain = r === Math.floor(rows / 2) || r === 0 || r === rows - 1;
      const subdivs = options.style === 'organic' ? Math.max(3, cols * 2) : 2;
      const pts: number[] = [];
      for (let s = 0; s <= subdivs; s += 1) {
        const tX = s / subdivs;
        const lx = -halfW + tX * rect.width;
        const jitterY =
          options.style === 'organic' && s > 0 && s < subdivs
            ? Math.sin(tX * Math.PI * 2 + r * 1.7 + seed) * organicAmp * 0.7 +
              (rng() - 0.5) * organicAmp
            : 0;
        const [wx, wy] = toWorld(lx, baseY + jitterY);
        pts.push(wx, wy);
      }
      addClippedRoad(
        doc,
        pts,
        isMain ? 'avenue' : 'road',
        isMain ? 14 : 8.5,
        layerVec,
        options.style === 'organic',
        streets
      );
    }

    // Vertical-local streets (rotated by angleDeg)
    for (let c = 0; c < cols; c += 1) {
      const tX = cols === 1 ? 0.5 : c / (cols - 1);
      const baseX = -halfW + tX * rect.width;
      const isMain = c === Math.floor(cols / 2) || c === 0 || c === cols - 1;
      const subdivs = options.style === 'organic' ? Math.max(3, rows * 2) : 2;
      const pts: number[] = [];
      for (let s = 0; s <= subdivs; s += 1) {
        const tY = s / subdivs;
        const ly = -halfH + tY * rect.height;
        const jitterX =
          options.style === 'organic' && s > 0 && s < subdivs
            ? Math.cos(tY * Math.PI * 2 + c * 2.1 + seed) * organicAmp * 0.7 +
              (rng() - 0.5) * organicAmp
            : 0;
        const [wx, wy] = toWorld(baseX + jitterX, ly);
        pts.push(wx, wy);
      }
      addClippedRoad(
        doc,
        pts,
        isMain ? 'avenue' : 'road',
        isMain ? 14 : 8.5,
        layerVec,
        options.style === 'organic',
        streets
      );
    }
  }

  if (!options.autoFillBuildings || streets.length === 0) {
    return streets;
  }

  // Create a virtual document snapshot with the new grid streets so auto-fill aligns buildings cleanly along them
  const virtualDoc: MapDocument = {
    ...doc,
    manifest: {
      ...doc.manifest,
      objects: [...doc.manifest.objects, ...streets]
    }
  };

  // Sweep grid corridor strips across the rect to fill every block cleanly
  const sweepStep = clampNumber(spacing * 0.7, 56, 120);
  const brushPoints: Array<{ x: number; y: number }> = [];
  for (let y = rect.y + sweepStep * 0.35; y <= rect.y + rect.height - sweepStep * 0.25; y += sweepStep) {
    const left = rect.x + sweepStep * 0.35;
    const right = Math.max(left, rect.x + rect.width - sweepStep * 0.35);
    const steps = Math.max(2, Math.ceil((right - left) / 65));
    for (let s = 0; s <= steps; s += 1) {
      brushPoints.push({ x: left + ((right - left) * s) / steps, y });
    }
  }

  const buildings = generateDistrictBuildingsAlongStroke(virtualDoc, brushPoints, {
    diameterDoc: clampNumber(spacing * 1.1, 70, 150),
    density: options.density,
    buildingScale: options.buildingScale,
    irregularity:
      options.style === 'orthogonal' ? Math.min(options.irregularity, 0.14) : options.irregularity,
    preset: options.districtPreset,
    renderStyle: options.renderStyle,
    layerId: layerBldg,
    seed: seed + 17
  });

  return [...streets, ...buildings];
}

/**
 * Creates a fortified city wall path together with bastion towers at corners/intervals
 * and twin gatehouse towers automatically placed where the wall crosses streets.
 */
export function buildSmartCityWallObjects(
  doc: MapDocument,
  wallPointsDoc: readonly number[],
  options: SmartWallOptions
): MapObject[] {
  if (wallPointsDoc.length < 4) return [];

  const layerVec = resolveObjectLayerId(
    { type: 'path', layerId: options.vectorLayerId ?? DEFAULT_LAYER_VECTORS_ID },
    doc.manifest.layers
  );
  const layerBldg = resolveObjectLayerId(
    { type: 'building', layerId: options.buildingsLayerId ?? DEFAULT_LAYER_BUILDINGS_ID },
    doc.manifest.layers
  );

  const cityPalette = getCityThemePalette(doc.theme);
  const strokeWidth = clampNumber(options.strokeWidthDoc, 6, 30);

  const wallPath = createPathObject({
    layerId: layerVec,
    kind: 'wall',
    points: wallPointsDoc,
    strokeWidthDoc: strokeWidth,
    color: cityPalette.wallStone,
    theme: doc.theme,
    smooth: false
  });

  const result: MapObject[] = [wallPath];
  const worldPts = getPathWorldPoints(wallPath);
  const vertexCount = Math.floor(worldPts.length / 2);
  if (vertexCount < 2) return result;

  const towerColor = cityPalette.roofPalette[0] ?? doc.theme.colors.settlement;
  const customStyle =
    options.renderStyle && options.renderStyle !== 'auto' ? options.renderStyle : undefined;

  const gateCenters: Array<{ x: number; y: number }> = [];
  const addedTowers: Array<{ x: number; y: number }> = [];

  const canPlaceTower = (x: number, y: number, minGap: number): boolean => {
    for (const pt of gateCenters) {
      if (Math.hypot(x - pt.x, y - pt.y) < minGap) return false;
    }
    for (const pt of addedTowers) {
      if (Math.hypot(x - pt.x, y - pt.y) < minGap * 0.85) return false;
    }
    return true;
  };

  // 1. Auto-detect road crossings and place twin gatehouse towers flanking the road opening
  if (options.autoGates) {
    for (const obj of doc.manifest.objects) {
      if (obj.type !== 'path') continue;
      if (!URBAN_STREET_PATH_KINDS.has(obj.kind) || obj.kind === 'canal') continue;
      const roadPts = getPathWorldPoints(obj);
      const roadCount = Math.floor(roadPts.length / 2);

      for (let wi = 0; wi < vertexCount - 1; wi += 1) {
        const ax = worldPts[wi * 2];
        const ay = worldPts[wi * 2 + 1];
        const bx = worldPts[(wi + 1) * 2];
        const by = worldPts[(wi + 1) * 2 + 1];
        const wLen = Math.hypot(bx - ax, by - ay);
        if (wLen < 1) continue;
        const wtx = (bx - ax) / wLen;
        const wty = (by - ay) / wLen;
        const wallAngleDeg = (Math.atan2(wty, wtx) * 180) / Math.PI;

        for (let ri = 0; ri < roadCount - 1; ri += 1) {
          const hit = segmentIntersection(
            ax,
            ay,
            bx,
            by,
            roadPts[ri * 2],
            roadPts[ri * 2 + 1],
            roadPts[(ri + 1) * 2],
            roadPts[(ri + 1) * 2 + 1]
          );
          if (!hit) continue;
          if (gateCenters.some((g) => Math.hypot(g.x - hit.x, g.y - hit.y) < 34)) {
            continue;
          }
          gateCenters.push({ x: hit.x, y: hit.y });
          const halfOpening = Math.max(12, obj.strokeWidthDoc * 0.72 + strokeWidth * 0.45);
          const towerSize = clampNumber(strokeWidth * 1.45, 16, 30);

          for (const side of [-1, 1]) {
            const gx = hit.x + wtx * halfOpening * side;
            const gy = hit.y + wty * halfOpening * side;
            addedTowers.push({ x: gx, y: gy });
            result.push(
              createBuildingObject({
                layerId: layerBldg,
                shape: 'tower',
                x: gx,
                y: gy,
                width: towerSize,
                height: towerSize,
                rotationDeg: wallAngleDeg,
                roofColor: towerColor,
                wallColor: cityPalette.wallStone,
                ...(customStyle ? { renderStyle: customStyle } : {}),
                districtTag: 'gatehouse'
              })
            );
          }
        }
      }
    }
  }

  // 2. Bastion towers along wall vertices & regular spacing
  if (options.autoTowers) {
    const spacing = clampNumber(options.towerSpacingDoc, 45, 260);
    const towerSize = clampNumber(strokeWidth * 1.32, 14, 28);
    let accumDist = 0;

    for (let i = 0; i < vertexCount - 1; i += 1) {
      const ax = worldPts[i * 2];
      const ay = worldPts[i * 2 + 1];
      const bx = worldPts[(i + 1) * 2];
      const by = worldPts[(i + 1) * 2 + 1];
      const segLen = Math.hypot(bx - ax, by - ay);
      if (segLen < 1) continue;
      const angleDeg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;

      if (i === 0 && canPlaceTower(ax, ay, 28)) {
        addedTowers.push({ x: ax, y: ay });
        result.push(
          createBuildingObject({
            layerId: layerBldg,
            shape: 'tower',
            x: ax,
            y: ay,
            width: towerSize,
            height: towerSize,
            rotationDeg: angleDeg,
            roofColor: towerColor,
            wallColor: cityPalette.wallStone,
            ...(customStyle ? { renderStyle: customStyle } : {}),
            districtTag: 'wall-tower'
          })
        );
      }

      const subSteps = Math.max(1, Math.ceil(segLen / 18));
      let prevX = ax;
      let prevY = ay;
      for (let s = 1; s <= subSteps; s += 1) {
        const t = s / subSteps;
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        accumDist += Math.hypot(px - prevX, py - prevY);
        prevX = px;
        prevY = py;
        if (accumDist >= spacing) {
          accumDist = 0;
          if (canPlaceTower(px, py, 28)) {
            addedTowers.push({ x: px, y: py });
            result.push(
              createBuildingObject({
                layerId: layerBldg,
                shape: 'tower',
                x: px,
                y: py,
                width: towerSize,
                height: towerSize,
                rotationDeg: angleDeg,
                roofColor: towerColor,
                wallColor: cityPalette.wallStone,
                ...(customStyle ? { renderStyle: customStyle } : {}),
                districtTag: 'wall-tower'
              })
            );
          }
        }
      }
    }

    const lastX = worldPts[(vertexCount - 1) * 2];
    const lastY = worldPts[(vertexCount - 1) * 2 + 1];
    if (canPlaceTower(lastX, lastY, 26)) {
      addedTowers.push({ x: lastX, y: lastY });
      result.push(
        createBuildingObject({
          layerId: layerBldg,
          shape: 'tower',
          x: lastX,
          y: lastY,
          width: towerSize,
          height: towerSize,
          rotationDeg: 0,
          roofColor: towerColor,
          wallColor: cityPalette.wallStone,
          ...(customStyle ? { renderStyle: customStyle } : {}),
          districtTag: 'wall-tower'
        })
      );
    }
  }

  return result;
}
