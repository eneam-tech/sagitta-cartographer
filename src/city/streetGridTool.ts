import { clampNumber } from '../model/coordinates';
import {
  BuildingRenderStyle,
  DEFAULT_LAYER_BUILDINGS_ID,
  DEFAULT_LAYER_VECTORS_ID,
  MapDocument,
  MapObject,
  PathObject,
  WallGateOpening,
  WallStyle,
  WallTowerShape,
  resolveObjectLayerId
} from '../model/document';
import { createBuildingObject, createPathObject } from '../objects/objectCommands';
import {
  URBAN_STREET_PATH_KINDS,
  createSeededRng,
  distPointToSegment,
  getCityThemePalette,
  getPathWorldPoints,
  sampleLandMaskAtDoc,
  segmentIntersection
} from './geometry';
import {
  DistrictPresetId,
  generateDistrictBuildingsAlongStroke
} from './smartDistrictBrush';
import { detectAutoWallSide } from './wallGeometry';

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
  wallStyle?: WallStyle;
  towerShape?: WallTowerShape;
  wallClosed?: boolean;
  wallSide?: 1 | -1;
  invertSide?: boolean;
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

    let allOnLand = true;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      if (!sampleLandMaskAtDoc(doc, ax + (bx - ax) * t, ay + (by - ay) * t)) {
        allOnLand = false;
        break;
      }
    }

    if (allOnLand) {
      if (current.length === 0) {
        current.push(ax, ay);
      }
      current.push(bx, by);
      continue;
    }

    for (let s = 0; s <= steps; s += 1) {
      if (i > 0 && s === 0) continue;
      const t = s / steps;
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      if (sampleLandMaskAtDoc(doc, px, py)) {
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

  return subPolylines;
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

function shortestAngleDiffRad(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function projectRayToRectBoundary(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { x: number; y: number; dist: number } {
  let bestT = Infinity;
  if (Math.abs(dx) > 1e-6) {
    const tx = dx > 0 ? (maxX - ox) / dx : (minX - ox) / dx;
    if (tx > 0 && tx < bestT) bestT = tx;
  }
  if (Math.abs(dy) > 1e-6) {
    const ty = dy > 0 ? (maxY - oy) / dy : (minY - oy) / dy;
    if (ty > 0 && ty < bestT) bestT = ty;
  }
  if (!Number.isFinite(bestT)) {
    return { x: ox, y: oy, dist: 0 };
  }
  return {
    x: clampNumber(ox + dx * bestT, minX, maxX),
    y: clampNumber(oy + dy * bestT, minY, maxY),
    dist: bestT
  };
}

function clipStepToRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { x: number; y: number; clipped: boolean } {
  if (bx >= minX && bx <= maxX && by >= minY && by <= maxY) {
    return { x: bx, y: by, clipped: false };
  }
  const dx = bx - ax;
  const dy = by - ay;
  let minT = 1;
  if (bx < minX && dx < -1e-6) minT = Math.min(minT, (minX - ax) / dx);
  if (bx > maxX && dx > 1e-6) minT = Math.min(minT, (maxX - ax) / dx);
  if (by < minY && dy < -1e-6) minT = Math.min(minT, (minY - ay) / dy);
  if (by > maxY && dy > 1e-6) minT = Math.min(minT, (maxY - ay) / dy);
  const t = clampNumber(minT, 0, 1);
  return {
    x: clampNumber(ax + dx * t, minX, maxX),
    y: clampNumber(ay + dy * t, minY, maxY),
    clipped: true
  };
}

function polylineLength(pts: readonly number[]): number {
  const n = Math.floor(pts.length / 2);
  let len = 0;
  for (let i = 0; i < n - 1; i += 1) {
    len += Math.hypot(pts[(i + 1) * 2] - pts[i * 2], pts[(i + 1) * 2 + 1] - pts[i * 2 + 1]);
  }
  return len;
}

interface OrganicSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  roadId: number;
  tier: 'avenue' | 'road' | 'alley';
  angle: number;
}

interface OrganicSprout {
  x: number;
  y: number;
  angle: number;
  parentRoadId: number;
  depth: number;
  tier: 'road' | 'alley';
}

/**
 * Generates an authentic non-grid organic medieval/historical city street network:
 * 1 to 4 curved main arterials (`avenue`) anchored to gates/hub, plus a dense
 * hierarchy of branching secondary roads (`road`) and irregular cut-through alleys (`alley`)
 * that snap seamlessly into T-junctions and irregular polygonal blocks.
 */
function generateOrganicStreetNetwork(
  doc: MapDocument,
  rect: { x: number; y: number; width: number; height: number },
  spacing: number,
  angleDeg: number,
  layerVec: string,
  rng: () => number
): PathObject[] {
  const pad = 8;
  const minX = clampNumber(rect.x + pad, 8, doc.manifest.space.width - 16);
  const minY = clampNumber(rect.y + pad, 8, doc.manifest.space.height - 16);
  const maxX = clampNumber(rect.x + rect.width - pad, minX + 24, doc.manifest.space.width - 8);
  const maxY = clampNumber(rect.y + rect.height - pad, minY + 24, doc.manifest.space.height - 8);
  const effW = maxX - minX;
  const effH = maxY - minY;
  const minDim = Math.min(effW, effH);
  const diag = Math.hypot(effW, effH);

  const areaUnits = (effW * effH) / Math.max(1, spacing * spacing);
  const arterialCount =
    areaUnits < 5.5
      ? rng() < 0.45
        ? 1
        : 2
      : areaUnits < 14
        ? rng() < 0.55
          ? 2
          : 3
        : rng() < 0.4
          ? 3
          : 4;

  // Pick a gently off-center focal crossroads hub on land
  let hubX = minX + effW * (0.42 + rng() * 0.16);
  let hubY = minY + effH * (0.42 + rng() * 0.16);
  if (!sampleLandMaskAtDoc(doc, hubX, hubY)) {
    hubX = minX + effW * 0.5;
    hubY = minY + effH * 0.5;
  }

  const segments: OrganicSegment[] = [];
  const builtPolylines: Array<{ pts: number[]; tier: 'avenue' | 'road' | 'alley'; width: number }> = [];
  let nextRoadId = 1;

  const registerPolyline = (pts: readonly number[], roadId: number, tier: 'avenue' | 'road' | 'alley') => {
    const count = Math.floor(pts.length / 2);
    for (let i = 0; i < count - 1; i += 1) {
      const ax = pts[i * 2];
      const ay = pts[i * 2 + 1];
      const bx = pts[(i + 1) * 2];
      const by = pts[(i + 1) * 2 + 1];
      if (Math.hypot(bx - ax, by - ay) < 0.5) continue;
      segments.push({
        ax,
        ay,
        bx,
        by,
        roadId,
        tier,
        angle: Math.atan2(by - ay, bx - ax)
      });
    }
  };

  const findFirstSegmentHit = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    ignoreRoadId: number,
    minT = 0.02
  ): { x: number; y: number; t: number; seg: OrganicSegment } | null => {
    let best: { x: number; y: number; t: number; seg: OrganicSegment } | null = null;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg.roadId === ignoreRoadId) continue;
      const hit = segmentIntersection(ax, ay, bx, by, seg.ax, seg.ay, seg.bx, seg.by);
      if (hit && hit.t >= minT && (!best || hit.t < best.t)) {
        best = { x: hit.x, y: hit.y, t: hit.t, seg };
      }
    }
    return best;
  };

  const findNearestGraphSegment = (
    px: number,
    py: number,
    maxDist: number,
    ignoreRoadId: number,
    minDist = 0
  ): { dist: number; projX: number; projY: number; seg: OrganicSegment } | null => {
    let best: { dist: number; projX: number; projY: number; seg: OrganicSegment } | null = null;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg.roadId === ignoreRoadId) continue;
      const hit = distPointToSegment(px, py, seg.ax, seg.ay, seg.bx, seg.by);
      if (hit.dist <= maxDist && hit.dist >= minDist && (!best || hit.dist < best.dist)) {
        best = { dist: hit.dist, projX: hit.projX, projY: hit.projY, seg };
      }
    }
    return best;
  };

  const hasCloseParallelOrJunction = (
    px: number,
    py: number,
    heading: number,
    minDist: number,
    ignoreRoadId: number
  ): boolean => {
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg.roadId === ignoreRoadId) continue;
      const hit = distPointToSegment(px, py, seg.ax, seg.ay, seg.bx, seg.by);
      if (hit.dist < minDist) {
        const diff = shortestAngleDiffRad(heading, seg.angle);
        const oppDiff = Math.abs(Math.PI - diff);
        if (Math.min(diff, oppDiff) < 0.62) {
          return true;
        }
      }
    }
    return false;
  };

  // Phase 1: Generate 1 to 4 sinuous primary arterials ('avenue')
  const baseDir = (angleDeg * Math.PI) / 180 + (rng() - 0.5) * 0.65;
  const usedEntryAngles: number[] = [];
  const arterialStep = clampNumber(spacing * 0.28, 18, 30);

  for (let aIdx = 0; aIdx < arterialCount; aIdx += 1) {
    let entryAngle: number;
    if (aIdx === 0) {
      entryAngle = baseDir + Math.PI;
    } else if (aIdx === 1) {
      entryAngle = baseDir + (rng() < 0.5 ? 1 : -1) * (Math.PI * 0.44 + rng() * 0.34);
    } else {
      entryAngle = baseDir + rng() * Math.PI * 2;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const candidate = baseDir + (Math.PI * 2 * (aIdx + attempt * 0.37)) / (arterialCount + 1) + (rng() - 0.5) * 0.35;
        if (usedEntryAngles.every((u) => shortestAngleDiffRad(candidate, u) >= 0.85)) {
          entryAngle = candidate;
          break;
        }
      }
    }
    usedEntryAngles.push(entryAngle);

    const startEdge = projectRayToRectBoundary(
      hubX,
      hubY,
      Math.cos(entryAngle),
      Math.sin(entryAngle),
      minX,
      minY,
      maxX,
      maxY
    );
    const targetHubX = hubX + (rng() - 0.5) * Math.min(28, minDim * 0.12);
    const targetHubY = hubY + (rng() - 0.5) * Math.min(28, minDim * 0.12);

    const roadId = nextRoadId++;
    const pts: number[] = [startEdge.x, startEdge.y];
    let cx = startEdge.x;
    let cy = startEdge.y;
    let heading = Math.atan2(targetHubY - cy, targetHubX - cx);
    let passedHub = false;
    let curveFreq = 0.08 + rng() * 0.08;
    let curvePhase = rng() * Math.PI * 2;
    let curveAmp = (rng() < 0.5 ? 1 : -1) * (0.045 + rng() * 0.055);
    const maxSteps = Math.ceil((diag * 1.4) / arterialStep);

    // Secondary converging arterials (#3, #4) often merge into an earlier main artery past the hub
    const stopAtCrossingAfterHub = aIdx >= 2 && rng() < 0.72;

    for (let step = 0; step < maxSteps; step += 1) {
      const distToHub = Math.hypot(targetHubX - cx, targetHubY - cy);
      if (!passedHub && distToHub < arterialStep * 1.4) {
        passedHub = true;
      }

      if (!passedHub) {
        const desired = Math.atan2(targetHubY - cy, targetHubX - cx);
        let delta = desired - heading;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        heading += clampNumber(delta * 0.35, -0.18, 0.18);
        heading += Math.sin(step * curveFreq + curvePhase) * curveAmp * 0.7;
      } else {
        heading += Math.sin(step * curveFreq + curvePhase) * curveAmp + (rng() - 0.5) * 0.045;
      }

      const rawNx = cx + Math.cos(heading) * arterialStep;
      const rawNy = cy + Math.sin(heading) * arterialStep;
      const clipped = clipStepToRect(cx, cy, rawNx, rawNy, minX, minY, maxX, maxY);

      if (stopAtCrossingAfterHub && step >= 3) {
        const hit = findFirstSegmentHit(cx, cy, clipped.x, clipped.y, roadId, 0.02);
        if (hit) {
          pts.push(hit.x, hit.y);
          break;
        }
      }

      pts.push(clipped.x, clipped.y);
      cx = clipped.x;
      cy = clipped.y;

      if (clipped.clipped) {
        usedEntryAngles.push(Math.atan2(cy - hubY, cx - hubX));
        break;
      }
    }

    if (pts.length >= 4 && polylineLength(pts) >= spacing * 0.55) {
      registerPolyline(pts, roadId, 'avenue');
      builtPolylines.push({ pts, tier: 'avenue', width: 13.5 });
    }
  }

  // Phase 2: Branch out interconnected secondary collector roads ('road') from the arterials
  const sproutQueue: OrganicSprout[] = [];

  const seedBranchSproutsAlongPolyline = (
    pts: readonly number[],
    roadId: number,
    depth: number,
    tier: 'road' | 'alley',
    intervalMin: number,
    intervalMax: number,
    bothSidesProbability: number
  ) => {
    const n = Math.floor(pts.length / 2);
    if (n < 2) return;
    let nextDist = spacing * (0.35 + rng() * 0.45);
    let accum = 0;

    for (let i = 0; i < n - 1; i += 1) {
      const ax = pts[i * 2];
      const ay = pts[i * 2 + 1];
      const bx = pts[(i + 1) * 2];
      const by = pts[(i + 1) * 2 + 1];
      const segLen = Math.hypot(bx - ax, by - ay);
      if (segLen < 1) continue;
      const segAngle = Math.atan2(by - ay, bx - ax);

      while (accum + segLen >= nextDist) {
        const localT = clampNumber((nextDist - accum) / segLen, 0.08, 0.92);
        const sx = ax + (bx - ax) * localT;
        const sy = ay + (by - ay) * localT;
        if (
          sx > minX + 14 &&
          sx < maxX - 14 &&
          sy > minY + 14 &&
          sy < maxY - 14 &&
          sampleLandMaskAtDoc(doc, sx, sy)
        ) {
          const firstSide = rng() < 0.5 ? 1 : -1;
          const sides = rng() < bothSidesProbability ? [firstSide, -firstSide] : [firstSide];
          for (const side of sides) {
            const offsetAngle = side * (Math.PI * 0.5 + (rng() - 0.5) * 0.68);
            sproutQueue.push({
              x: sx,
              y: sy,
              angle: segAngle + offsetAngle,
              parentRoadId: roadId,
              depth,
              tier
            });
          }
        }
        nextDist += spacing * (intervalMin + rng() * (intervalMax - intervalMin));
      }
      accum += segLen;
    }
  };

  for (let i = 0; i < builtPolylines.length; i += 1) {
    seedBranchSproutsAlongPolyline(
      builtPolylines[i].pts,
      i + 1,
      0,
      'road',
      0.5,
      1.05,
      0.42
    );
  }

  const maxCollectors = clampNumber(Math.round(areaUnits * 3.0), 12, 85);
  const collectorStep = clampNumber(spacing * 0.24, 15, 26);
  const collectorSnapRadius = clampNumber(spacing * 0.4, 22, 46);
  const minClearSpacing = spacing * 0.36;
  let generatedCollectors = 0;

  // Deterministic shuffled index cursor so branches interleave across all arterials rather than saturating one corner first
  const sproutOrder: OrganicSprout[] = [];
  while (sproutQueue.length > 0) {
    const idx = Math.floor(rng() * sproutQueue.length);
    sproutOrder.push(sproutQueue.splice(idx, 1)[0]);
  }

  while (sproutOrder.length > 0 && generatedCollectors < maxCollectors) {
    const sprout = sproutOrder.shift()!;
    const outCheckX = sprout.x + Math.cos(sprout.angle) * (minClearSpacing * 0.65);
    const outCheckY = sprout.y + Math.sin(sprout.angle) * (minClearSpacing * 0.65);
    if (hasCloseParallelOrJunction(outCheckX, outCheckY, sprout.angle, minClearSpacing * 0.85, sprout.parentRoadId)) {
      continue;
    }

    const roadId = nextRoadId++;
    const pts: number[] = [sprout.x, sprout.y];
    let cx = sprout.x;
    let cy = sprout.y;
    let heading = sprout.angle;
    const baseBend = (rng() - 0.5) * 0.14;
    let cumBend = 0;
    let connected = false;
    const maxRoadSteps = clampNumber(Math.ceil((spacing * 3.4) / collectorStep), 4, 24);

    for (let step = 0; step < maxRoadSteps; step += 1) {
      const turn = baseBend + (rng() - 0.5) * 0.18;
      if (Math.abs(cumBend + turn) <= 1.25) {
        heading += turn;
        cumBend += turn;
      }

      const rawNx = cx + Math.cos(heading) * collectorStep;
      const rawNy = cy + Math.sin(heading) * collectorStep;
      const clipped = clipStepToRect(cx, cy, rawNx, rawNy, minX, minY, maxX, maxY);

      const hit = findFirstSegmentHit(
        cx,
        cy,
        clipped.x,
        clipped.y,
        step === 0 ? sprout.parentRoadId : roadId,
        step === 0 ? 0.05 : 0.01
      );
      if (hit) {
        pts.push(hit.x, hit.y);
        connected = true;
        break;
      }

      if (!sampleLandMaskAtDoc(doc, clipped.x, clipped.y)) {
        connected = true;
        break;
      }

      // Snap organically into nearby perpendicular/angled streets to close irregular polygonal blocks
      if (step >= 2 && !clipped.clipped) {
        const near = findNearestGraphSegment(clipped.x, clipped.y, collectorSnapRadius, roadId);
        if (near) {
          const toProjAngle = Math.atan2(near.projY - cy, near.projX - cx);
          const turnToSnap = shortestAngleDiffRad(toProjAngle, heading);
          const crossAngle = shortestAngleDiffRad(toProjAngle, near.seg.angle);
          const oppCross = Math.abs(Math.PI - crossAngle);
          if (turnToSnap < 0.95 && Math.min(crossAngle, oppCross) > 0.42) {
            pts.push(near.projX, near.projY);
            connected = true;
            break;
          }
        }
      }

      if (
        step >= 1 &&
        hasCloseParallelOrJunction(clipped.x, clipped.y, heading, minClearSpacing * 0.78, roadId)
      ) {
        // Attempt graceful snap before terminating
        const near = findNearestGraphSegment(cx, cy, collectorSnapRadius * 1.35, roadId);
        if (near && Math.hypot(near.projX - cx, near.projY - cy) >= 6) {
          pts.push(near.projX, near.projY);
          connected = true;
        }
        break;
      }

      pts.push(clipped.x, clipped.y);
      cx = clipped.x;
      cy = clipped.y;

      if (clipped.clipped) {
        connected = true;
        break;
      }
    }

    // If terminated free, reach out generously to close polygons against nearby streets; drop most dangling stubs
    if (!connected && pts.length >= 4) {
      const near = findNearestGraphSegment(cx, cy, spacing * 0.96, roadId, 4);
      if (near) {
        const toProj = Math.atan2(near.projY - cy, near.projX - cx);
        if (shortestAngleDiffRad(toProj, heading) < 1.35) {
          const intercept = findFirstSegmentHit(cx, cy, near.projX, near.projY, roadId, 0.05);
          if (intercept) {
            pts.push(intercept.x, intercept.y);
          } else {
            pts.push(near.projX, near.projY);
          }
          connected = true;
        }
      }
    }

    const totalLen = polylineLength(pts);
    const acceptCollector = connected
      ? totalLen >= spacing * 0.34
      : totalLen >= spacing * 0.75 && rng() < 0.18;
    if (pts.length >= 4 && acceptCollector) {
      registerPolyline(pts, roadId, 'road');
      builtPolylines.push({ pts, tier: 'road', width: 8.5 });
      generatedCollectors += 1;

      if (sprout.depth < 2 && totalLen >= spacing * 0.7) {
        const childSprouts: OrganicSprout[] = [];
        const tempQueue = sproutQueue.length;
        seedBranchSproutsAlongPolyline(pts, roadId, sprout.depth + 1, 'road', 0.65, 1.25, 0.3);
        while (sproutQueue.length > tempQueue) {
          childSprouts.push(sproutQueue.pop()!);
        }
        for (const cs of childSprouts) {
          sproutOrder.push(cs);
        }
      }
    }
  }

  // Phase 3: Add sinuous short internal alleys ('alley') connecting across wide blocks
  const alleySprouts: OrganicSprout[] = [];
  for (let i = 0; i < builtPolylines.length; i += 1) {
    if (builtPolylines[i].tier === 'alley') continue;
    const tempBefore = sproutQueue.length;
    seedBranchSproutsAlongPolyline(
      builtPolylines[i].pts,
      i + 1,
      2,
      'alley',
      0.8,
      1.65,
      0.22
    );
    while (sproutQueue.length > tempBefore) {
      alleySprouts.push(sproutQueue.pop()!);
    }
  }

  const maxAlleys = clampNumber(Math.round(areaUnits * 1.8), 4, 45);
  const alleyStep = clampNumber(spacing * 0.2, 12, 20);
  let generatedAlleys = 0;

  while (alleySprouts.length > 0 && generatedAlleys < maxAlleys) {
    const idx = Math.floor(rng() * alleySprouts.length);
    const sprout = alleySprouts.splice(idx, 1)[0];
    const probeX = sprout.x + Math.cos(sprout.angle) * (spacing * 0.28);
    const probeY = sprout.y + Math.sin(sprout.angle) * (spacing * 0.28);
    if (hasCloseParallelOrJunction(probeX, probeY, sprout.angle, spacing * 0.28, sprout.parentRoadId)) {
      continue;
    }

    const roadId = nextRoadId++;
    const pts: number[] = [sprout.x, sprout.y];
    let cx = sprout.x;
    let cy = sprout.y;
    let heading = sprout.angle + (rng() - 0.5) * 0.22;
    let connected = false;
    const maxAlleySteps = clampNumber(Math.ceil((spacing * 1.9) / alleyStep), 3, 12);

    for (let step = 0; step < maxAlleySteps; step += 1) {
      heading += (rng() - 0.5) * 0.28;
      const clipped = clipStepToRect(
        cx,
        cy,
        cx + Math.cos(heading) * alleyStep,
        cy + Math.sin(heading) * alleyStep,
        minX,
        minY,
        maxX,
        maxY
      );
      const hit = findFirstSegmentHit(
        cx,
        cy,
        clipped.x,
        clipped.y,
        step === 0 ? sprout.parentRoadId : roadId,
        0.04
      );
      if (hit) {
        pts.push(hit.x, hit.y);
        connected = true;
        break;
      }
      if (!sampleLandMaskAtDoc(doc, clipped.x, clipped.y)) {
        connected = true;
        break;
      }
      if (step >= 1) {
        const near = findNearestGraphSegment(clipped.x, clipped.y, spacing * 0.34, roadId);
        if (near) {
          pts.push(near.projX, near.projY);
          connected = true;
          break;
        }
      }
      pts.push(clipped.x, clipped.y);
      cx = clipped.x;
      cy = clipped.y;
      if (clipped.clipped) {
        connected = true;
        break;
      }
    }

    if (connected && pts.length >= 4 && polylineLength(pts) >= spacing * 0.3) {
      registerPolyline(pts, roadId, 'alley');
      builtPolylines.push({ pts, tier: 'alley', width: 5.5 });
      generatedAlleys += 1;
    }
  }

  const outPaths: PathObject[] = [];
  for (const item of builtPolylines) {
    addClippedRoad(
      doc,
      item.pts,
      item.tier,
      item.width,
      layerVec,
      true,
      outPaths
    );
  }
  return outPaths;
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
  } else if (options.style === 'organic') {
    streets.push(
      ...generateOrganicStreetNetwork(doc, rect, spacing, options.angleDeg, layerVec, rng)
    );
  } else {
    const halfW = rect.width * 0.5;
    const halfH = rect.height * 0.5;
    const cols = Math.max(2, Math.round(rect.width / spacing) + 1);
    const rows = Math.max(2, Math.round(rect.height / spacing) + 1);

    // Horizontal-local streets (rotated by angleDeg)
    for (let r = 0; r < rows; r += 1) {
      const tY = rows === 1 ? 0.5 : r / (rows - 1);
      const baseY = -halfH + tY * rect.height;
      const isMain = r === Math.floor(rows / 2) || r === 0 || r === rows - 1;
      const pts: number[] = [];
      for (let s = 0; s <= 2; s += 1) {
        const tX = s / 2;
        const lx = -halfW + tX * rect.width;
        const [wx, wy] = toWorld(lx, baseY);
        pts.push(wx, wy);
      }
      addClippedRoad(
        doc,
        pts,
        isMain ? 'avenue' : 'road',
        isMain ? 14 : 8.5,
        layerVec,
        false,
        streets
      );
    }

    // Vertical-local streets (rotated by angleDeg)
    for (let c = 0; c < cols; c += 1) {
      const tX = cols === 1 ? 0.5 : c / (cols - 1);
      const baseX = -halfW + tX * rect.width;
      const isMain = c === Math.floor(cols / 2) || c === 0 || c === cols - 1;
      const pts: number[] = [];
      for (let s = 0; s <= 2; s += 1) {
        const tY = s / 2;
        const ly = -halfH + tY * rect.height;
        const [wx, wy] = toWorld(baseX, ly);
        pts.push(wx, wy);
      }
      addClippedRoad(
        doc,
        pts,
        isMain ? 'avenue' : 'road',
        isMain ? 14 : 8.5,
        layerVec,
        false,
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
 * Creates an architectural city wall (`stone`, `palisade`, `bastion`, or `low-wall`)
 * with corner-anchored & symmetrically subdivided towers, real road gate openings
 * (`wallGates`) flanked by twin gatehouses, and outward facing orientation.
 */
export function buildSmartCityWallObjects(
  doc: MapDocument,
  wallPointsDoc: readonly number[],
  options: SmartWallOptions
): MapObject[] {
  const rawCount = Math.floor(wallPointsDoc.length / 2);
  if (rawCount < 2) return [];

  const layerVec = resolveObjectLayerId(
    { type: 'path', layerId: options.vectorLayerId ?? DEFAULT_LAYER_VECTORS_ID },
    doc.manifest.layers
  );
  const layerBldg = resolveObjectLayerId(
    { type: 'building', layerId: options.buildingsLayerId ?? DEFAULT_LAYER_BUILDINGS_ID },
    doc.manifest.layers
  );

  const cityPalette = getCityThemePalette(doc.theme);
  const wallStyle: WallStyle = options.wallStyle ?? 'stone';
  const strokeWidth = clampNumber(options.strokeWidthDoc, 4, 30);

  // Detect or enforce polygonal ring closure without duplicate end vertex
  const cleanPts: number[] = [];
  for (let i = 0; i < rawCount; i += 1) {
    cleanPts.push(wallPointsDoc[i * 2], wallPointsDoc[i * 2 + 1]);
  }
  const endToStart = Math.hypot(
    cleanPts[(rawCount - 1) * 2] - cleanPts[0],
    cleanPts[(rawCount - 1) * 2 + 1] - cleanPts[1]
  );
  let wallClosed =
    options.wallClosed !== undefined
      ? Boolean(options.wallClosed) && rawCount >= 3
      : rawCount >= 4 && endToStart <= 18;
  if (wallClosed && endToStart <= 18 && rawCount >= 4) {
    cleanPts.pop();
    cleanPts.pop();
  }
  const vertexCount = Math.floor(cleanPts.length / 2);
  if (vertexCount < 2) return [];
  if (vertexCount < 3) wallClosed = false;

  const autoSide = detectAutoWallSide(cleanPts, wallClosed, doc);
  const resolvedWallSide: 1 | -1 = options.wallSide
    ? options.wallSide
    : options.invertSide
      ? autoSide === 1
        ? -1
        : 1
      : autoSide;

  // Center around wall's bounding box BEFORE projecting gates (distanceDoc is scale-invariant)
  const edgeCount = wallClosed ? vertexCount : vertexCount - 1;
  const edgeOffsets = new Array<number>(edgeCount);
  let totalPerimeter = 0;
  for (let ei = 0; ei < edgeCount; ei += 1) {
    const ni = (ei + 1) % vertexCount;
    edgeOffsets[ei] = totalPerimeter;
    totalPerimeter += Math.hypot(
      cleanPts[ni * 2] - cleanPts[ei * 2],
      cleanPts[ni * 2 + 1] - cleanPts[ei * 2 + 1]
    );
  }

  const wallColor =
    wallStyle === 'palisade'
      ? doc.theme.city?.renderStyle === 'ink-plan'
        ? '#A37952'
        : '#B57B48'
      : cityPalette.wallStone;
  const towerColor =
    wallStyle === 'palisade'
      ? '#B4693E'
      : cityPalette.roofPalette[0] ?? doc.theme.colors.settlement;
  const customStyle =
    options.renderStyle && options.renderStyle !== 'auto' ? options.renderStyle : undefined;
  const resolvedTowerShape: WallTowerShape =
    wallStyle === 'palisade' ? 'square' : options.towerShape ?? 'round';

  const wallGates: WallGateOpening[] = [];
  const gateCenters: Array<{ x: number; y: number; radius: number }> = [];
  const addedTowers: Array<{ x: number; y: number }> = [];
  const towerObjects: MapObject[] = [];

  const allowFortifications = wallStyle !== 'low-wall';
  const baseTowerSize =
    wallStyle === 'bastion'
      ? clampNumber(strokeWidth * 1.48, 16, 32)
      : wallStyle === 'palisade'
        ? clampNumber(strokeWidth * 1.25, 11, 22)
        : clampNumber(strokeWidth * 1.32, 14, 28);

  const canPlaceTower = (x: number, y: number, minTowerGap: number): boolean => {
    for (const g of gateCenters) {
      if (Math.hypot(x - g.x, y - g.y) < g.radius) return false;
    }
    for (const pt of addedTowers) {
      if (Math.hypot(x - pt.x, y - pt.y) < minTowerGap) return false;
    }
    return true;
  };

  // 1. Auto-detect road crossings -> real gate openings on the wall path + flanking twin towers
  if (allowFortifications && options.autoGates) {
    for (const obj of doc.manifest.objects) {
      if (obj.type !== 'path') continue;
      if (!URBAN_STREET_PATH_KINDS.has(obj.kind) || obj.kind === 'canal') continue;
      const roadPts = getPathWorldPoints(obj);
      const roadCount = Math.floor(roadPts.length / 2);

      for (let ei = 0; ei < edgeCount; ei += 1) {
        const ni = (ei + 1) % vertexCount;
        const ax = cleanPts[ei * 2];
        const ay = cleanPts[ei * 2 + 1];
        const bx = cleanPts[ni * 2];
        const by = cleanPts[ni * 2 + 1];
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

          const rdx = roadPts[(ri + 1) * 2] - roadPts[ri * 2];
          const rdy = roadPts[(ri + 1) * 2 + 1] - roadPts[ri * 2 + 1];
          const rLen = Math.hypot(rdx, rdy);
          const crossSin =
            rLen >= 1
              ? Math.max(0.45, Math.abs(wtx * (rdy / rLen) - wty * (rdx / rLen)))
              : 1;
          const gateHalfW = clampNumber((obj.strokeWidthDoc * 0.65 + 5.5) / crossSin, 11, 34);
          const distAlong = edgeOffsets[ei] + hit.t * wLen;
          // Only record opening if not kissing a wall vertex directly
          if (totalPerimeter > gateHalfW * 2) {
            wallGates.push({
              distanceDoc: Number(distAlong.toFixed(2)),
              halfWidthDoc: Number(gateHalfW.toFixed(2))
            });
          }

          const towerSize =
            wallStyle === 'palisade'
              ? clampNumber(strokeWidth * 1.48, 14, 26)
              : clampNumber(strokeWidth * 1.45, 16, 30);
          gateCenters.push({
            x: hit.x,
            y: hit.y,
            radius: gateHalfW + towerSize * 0.9
          });

          const towerOffset = gateHalfW + towerSize * 0.28;
          for (const side of [-1, 1]) {
            const gx = hit.x + wtx * towerOffset * side;
            const gy = hit.y + wty * towerOffset * side;
            addedTowers.push({ x: gx, y: gy });
            towerObjects.push(
              createBuildingObject({
                layerId: layerBldg,
                shape: resolvedTowerShape === 'square' ? 'rect' : 'tower',
                x: gx,
                y: gy,
                width: towerSize,
                height: towerSize,
                rotationDeg: wallAngleDeg,
                roofColor: towerColor,
                wallColor,
                ...(customStyle ? { renderStyle: customStyle } : {}),
                districtTag: 'gatehouse'
              })
            );
          }
        }
      }
    }
  }

  // 2. Corner-anchored towers + symmetric curtain subdivision
  if (allowFortifications && options.autoTowers) {
    const spacing = clampNumber(options.towerSpacingDoc, 45, 260);
    const cornerShape = resolvedTowerShape === 'square' ? 'rect' : 'tower';
    const minGap = Math.max(20, baseTowerSize * 1.1);

    // Phase A: Anchor towers at corners and open endpoints first
    for (let vi = 0; vi < vertexCount; vi += 1) {
      const px = cleanPts[vi * 2];
      const py = cleanPts[vi * 2 + 1];
      const isEndpoint = !wallClosed && (vi === 0 || vi === vertexCount - 1);
      const prevIdx = (vi - 1 + vertexCount) % vertexCount;
      const nextIdx = (vi + 1) % vertexCount;
      const inDx = px - cleanPts[prevIdx * 2];
      const inDy = py - cleanPts[prevIdx * 2 + 1];
      const outDx = cleanPts[nextIdx * 2] - px;
      const outDy = cleanPts[nextIdx * 2 + 1] - py;
      const inLen = Math.hypot(inDx, inDy);
      const outLen = Math.hypot(outDx, outDy);

      let placeAtVertex = isEndpoint;
      let rotDeg = 0;
      if (!isEndpoint && inLen >= 1 && outLen >= 1) {
        const uInX = inDx / inLen;
        const uInY = inDy / inLen;
        const uOutX = outDx / outLen;
        const uOutY = outDy / outLen;
        const turnAngle = Math.acos(clampNumber(uInX * uOutX + uInY * uOutY, -1, 1));
        if (turnAngle >= (16 * Math.PI) / 180 && wallStyle !== 'bastion') {
          placeAtVertex = true;
        }
        rotDeg = (Math.atan2(uInY + uOutY, uInX + uOutX) * 180) / Math.PI;
      } else if (vi === 0 && outLen >= 1) {
        rotDeg = (Math.atan2(outDy, outDx) * 180) / Math.PI;
      } else if (inLen >= 1) {
        rotDeg = (Math.atan2(inDy, inDx) * 180) / Math.PI;
      }

      if (placeAtVertex && canPlaceTower(px, py, minGap)) {
        addedTowers.push({ x: px, y: py });
        const cornerScale = wallStyle === 'bastion' ? 1.12 : 1.05;
        towerObjects.push(
          createBuildingObject({
            layerId: layerBldg,
            shape: cornerShape,
            x: px,
            y: py,
            width: Number((baseTowerSize * cornerScale).toFixed(2)),
            height: Number((baseTowerSize * cornerScale).toFixed(2)),
            rotationDeg: rotDeg,
            roofColor: towerColor,
            wallColor,
            ...(customStyle ? { renderStyle: customStyle } : {}),
            districtTag: 'wall-tower'
          })
        );
      }
    }

    // Phase B: Subdivide straight curtains symmetrically with intermediate towers
    for (let ei = 0; ei < edgeCount; ei += 1) {
      const ni = (ei + 1) % vertexCount;
      const ax = cleanPts[ei * 2];
      const ay = cleanPts[ei * 2 + 1];
      const bx = cleanPts[ni * 2];
      const by = cleanPts[ni * 2 + 1];
      const segLen = Math.hypot(bx - ax, by - ay);
      if (segLen < spacing * 1.18) continue;

      const angleDeg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      const subdivisions = Math.max(1, Math.round(segLen / spacing));
      if (subdivisions < 2) continue;

      for (let k = 1; k < subdivisions; k += 1) {
        const t = k / subdivisions;
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        if (canPlaceTower(px, py, minGap)) {
          addedTowers.push({ x: px, y: py });
          towerObjects.push(
            createBuildingObject({
              layerId: layerBldg,
              shape: cornerShape,
              x: px,
              y: py,
              width: baseTowerSize,
              height: baseTowerSize,
              rotationDeg: angleDeg,
              roofColor: towerColor,
              wallColor,
              ...(customStyle ? { renderStyle: customStyle } : {}),
              districtTag: 'wall-tower'
            })
          );
        }
      }
    }
  }

  wallGates.sort((a, b) => a.distanceDoc - b.distanceDoc);

  const wallPath = createPathObject({
    layerId: layerVec,
    kind: 'wall',
    points: cleanPts,
    strokeWidthDoc: strokeWidth,
    color: wallColor,
    theme: doc.theme,
    smooth: false,
    wallStyle,
    wallSide: resolvedWallSide,
    ...(wallClosed ? { wallClosed: true } : {}),
    ...(wallGates.length > 0 ? { wallGates } : {})
  });

  return [wallPath, ...towerObjects];
}
