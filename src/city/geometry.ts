import { clampNumber, docToMaskX, docToMaskY } from '../model/coordinates';
import {
  BuildingObject,
  MapDocument,
  PathKind,
  PathObject,
  PlazaObject
} from '../model/document';
import { getRiverWorldSpinePoints } from '../render/riverRenderer';
import { CITY_MEDIEVAL_THEME, CityThemePalette, MapTheme } from '../theme/theme';

export interface OrientedBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
}

export interface NearestPolylineHit {
  dist: number;
  angleDeg: number;
  projX: number;
  projY: number;
  segmentIndex: number;
}

export interface NearestStreetHit extends NearestPolylineHit {
  path: PathObject;
}

export const URBAN_STREET_PATH_KINDS = new Set<PathKind>([
  'avenue',
  'road',
  'alley',
  'canal'
]);

export const URBAN_BLOCKING_PATH_KINDS = new Set<PathKind>([
  'avenue',
  'road',
  'alley',
  'canal',
  'river',
  'wall'
]);

/**
 * Deterministic Mulberry32 PRNG for reproducible urban districts and city layouts.
 */
export function createSeededRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getCityThemePalette(theme: MapTheme): CityThemePalette {
  if (theme.city) {
    return theme.city;
  }
  const fallback = CITY_MEDIEVAL_THEME.city!;
  return {
    renderStyle: fallback.renderStyle,
    roofPalette: [
      theme.colors.settlement,
      theme.colors.brick,
      theme.colors.stone,
      theme.colors.hill
    ],
    roofShadow: 'rgba(26, 22, 18, 0.30)',
    wallStone: theme.colors.stone || fallback.wallStone,
    streetFill: theme.colors.pathRoad || fallback.streetFill,
    streetBorder: theme.colors.ink || fallback.streetBorder,
    plazaFill: theme.colors.beach || fallback.plazaFill,
    canalWater: theme.colors.pathRiver || fallback.canalWater,
    parkGreen: theme.colors.meadow || fallback.parkGreen
  };
}

export function pickDeterministicRoofColor(theme: MapTheme, seed = 0): string {
  const palette = getCityThemePalette(theme).roofPalette;
  if (palette.length === 0) return theme.colors.settlement;
  const idx = Math.abs(Math.floor(seed)) % palette.length;
  return palette[idx];
}

export function normalizeAngleDegSigned(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

export function sampleLandMaskAtDoc(doc: MapDocument, docX: number, docY: number): boolean {
  const { space, terrain } = doc.manifest;
  if (docX < 0 || docY < 0 || docX > space.width || docY > space.height) {
    return false;
  }
  const px = clampNumber(
    Math.floor(docToMaskX(docX, space, doc.terrain)),
    0,
    terrain.widthPx - 1
  );
  const py = clampNumber(
    Math.floor(docToMaskY(docY, space, doc.terrain)),
    0,
    terrain.heightPx - 1
  );
  return doc.terrain.mask[py * doc.terrain.widthPx + px] > 127;
}

/**
 * Estimates whether water lies near `(docX, docY)` and returns an approximate tangent angle
 * along the shore if water is found nearby.
 */
export function probeCoastlineAtDoc(
  doc: MapDocument,
  docX: number,
  docY: number,
  probeRadiusDoc = 26
): { nearWater: boolean; shoreAngleDeg: number | null } {
  const samples = 8;
  let waterVx = 0;
  let waterVy = 0;
  let waterHits = 0;

  for (let i = 0; i < samples; i += 1) {
    const theta = (Math.PI * 2 * i) / samples;
    const sx = docX + Math.cos(theta) * probeRadiusDoc;
    const sy = docY + Math.sin(theta) * probeRadiusDoc;
    if (!sampleLandMaskAtDoc(doc, sx, sy)) {
      waterHits += 1;
      waterVx += Math.cos(theta);
      waterVy += Math.sin(theta);
    }
  }

  if (waterHits === 0 || (Math.abs(waterVx) < 1e-4 && Math.abs(waterVy) < 1e-4)) {
    return { nearWater: waterHits > 0, shoreAngleDeg: null };
  }

  // Tangent along waterfront is perpendicular to outward water vector
  const shoreAngleDeg = (Math.atan2(waterVy, waterVx) * 180) / Math.PI + 90;
  return { nearWater: true, shoreAngleDeg };
}

export function getPathWorldPoints(path: PathObject): number[] {
  const count = Math.floor(path.points.length / 2);
  if (count === 0) return [];
  const rad = (path.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out = new Array<number>(count * 2);
  for (let i = 0; i < count; i += 1) {
    const lx = path.points[i * 2];
    const ly = path.points[i * 2 + 1];
    out[i * 2] = path.x + lx * cos - ly * sin;
    out[i * 2 + 1] = path.y + lx * sin + ly * cos;
  }
  return out;
}

export function distPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { dist: number; projX: number; projY: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) {
    return { dist: Math.hypot(px - ax, py - ay), projX: ax, projY: ay, t: 0 };
  }
  const t = clampNumber(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return { dist: Math.hypot(px - projX, py - projY), projX, projY, t };
}

export function closestPointOnWorldPoints(
  px: number,
  py: number,
  pts: readonly number[]
): NearestPolylineHit | null {
  const count = Math.floor(pts.length / 2);
  if (count < 2) return null;

  let bestDist = Infinity;
  let bestProjX = pts[0];
  let bestProjY = pts[1];
  let bestAngleDeg = 0;
  let bestSeg = 0;

  for (let i = 0; i < count - 1; i += 1) {
    const ax = pts[i * 2];
    const ay = pts[i * 2 + 1];
    const bx = pts[(i + 1) * 2];
    const by = pts[(i + 1) * 2 + 1];
    const hit = distPointToSegment(px, py, ax, ay, bx, by);
    if (hit.dist < bestDist) {
      bestDist = hit.dist;
      bestProjX = hit.projX;
      bestProjY = hit.projY;
      bestAngleDeg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      bestSeg = i;
    }
  }

  return {
    dist: bestDist,
    angleDeg: bestAngleDeg,
    projX: bestProjX,
    projY: bestProjY,
    segmentIndex: bestSeg
  };
}

export function closestPointOnPolyline(
  px: number,
  py: number,
  path: PathObject
): NearestPolylineHit | null {
  return closestPointOnWorldPoints(px, py, getPathWorldPoints(path));
}

export function findNearestUrbanStreet(
  doc: MapDocument,
  docX: number,
  docY: number,
  maxDistDoc = 140
): NearestStreetHit | null {
  let best: NearestStreetHit | null = null;
  for (const obj of doc.manifest.objects) {
    if (obj.type !== 'path') continue;
    if (!URBAN_STREET_PATH_KINDS.has(obj.kind) || obj.kind === 'canal') continue;
    const hit = closestPointOnPolyline(docX, docY, obj);
    if (hit && hit.dist <= maxDistDoc && (!best || hit.dist < best.dist)) {
      best = { ...hit, path: obj };
    }
  }
  return best;
}

export function segmentIntersection(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): { x: number; y: number; t: number; u: number } | null {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-8) return null;

  const qpx = cx - ax;
  const qpy = cy - ay;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return {
    x: ax + t * rx,
    y: ay + t * ry,
    t,
    u
  };
}

function getBoxAxesAndCorners(box: OrientedBox): {
  corners: ReadonlyArray<{ x: number; y: number }>;
  axes: ReadonlyArray<{ x: number; y: number }>;
} {
  const rad = (box.rotationDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const vx = -uy;
  const vy = ux;
  const hw = box.width * 0.5;
  const hh = box.height * 0.5;

  return {
    axes: [
      { x: ux, y: uy },
      { x: vx, y: vy }
    ],
    corners: [
      { x: box.x + ux * hw + vx * hh, y: box.y + uy * hw + vy * hh },
      { x: box.x - ux * hw + vx * hh, y: box.y - uy * hw + vy * hh },
      { x: box.x - ux * hw - vx * hh, y: box.y - uy * hw - vy * hh },
      { x: box.x + ux * hw - vx * hh, y: box.y + uy * hw - vy * hh }
    ]
  };
}

/**
 * Exact Separating Axis Theorem (SAT) overlap check for two oriented rectangles
 * with optional spacing padding between buildings.
 */
export function doOrientedRectsOverlap(
  a: OrientedBox,
  b: OrientedBox,
  paddingDoc = 2
): boolean {
  const maxHalfA = Math.hypot(a.width * 0.5, a.height * 0.5);
  const maxHalfB = Math.hypot(b.width * 0.5, b.height * 0.5);
  if (Math.hypot(a.x - b.x, a.y - b.y) > maxHalfA + maxHalfB + paddingDoc) {
    return false;
  }

  const paddedA: OrientedBox = {
    ...a,
    width: a.width + paddingDoc,
    height: a.height + paddingDoc
  };
  const paddedB: OrientedBox = {
    ...b,
    width: b.width + paddingDoc,
    height: b.height + paddingDoc
  };

  const geomA = getBoxAxesAndCorners(paddedA);
  const geomB = getBoxAxesAndCorners(paddedB);
  const axes = [...geomA.axes, ...geomB.axes];

  for (const axis of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    for (const c of geomA.corners) {
      const p = c.x * axis.x + c.y * axis.y;
      if (p < minA) minA = p;
      if (p > maxA) maxA = p;
    }

    let minB = Infinity;
    let maxB = -Infinity;
    for (const c of geomB.corners) {
      const p = c.x * axis.x + c.y * axis.y;
      if (p < minB) minB = p;
      if (p > maxB) maxB = p;
    }

    if (maxA <= minB || maxB <= minA) {
      return false;
    }
  }

  return true;
}

export function isPointInsidePlaza(
  px: number,
  py: number,
  plaza: PlazaObject,
  paddingDoc = 0
): boolean {
  const dx = px - plaza.x;
  const dy = py - plaza.y;
  const rad = (-plaza.rotationDeg * Math.PI) / 180;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const hw = plaza.width * 0.5 + paddingDoc;
  const hh = plaza.height * 0.5 + paddingDoc;
  if (plaza.shape === 'circle') {
    const rx = Math.max(1, hw);
    const ry = Math.max(1, hh);
    return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
  }
  return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}

export function isBoxBlockedByExistingFeatures(
  doc: MapDocument,
  candidate: OrientedBox,
  candidateRadiusDoc: number,
  extraBoxes: readonly OrientedBox[] = [],
  paddingDoc = 2.5
): boolean {
  for (const box of extraBoxes) {
    if (doOrientedRectsOverlap(candidate, box, paddingDoc)) {
      return true;
    }
  }

  for (const obj of doc.manifest.objects) {
    if (obj.type === 'building') {
      if (doOrientedRectsOverlap(candidate, obj, paddingDoc)) {
        return true;
      }
    } else if (obj.type === 'plaza') {
      if (doOrientedRectsOverlap(candidate, obj, candidateRadiusDoc * 0.35 + 4)) {
        return true;
      }
    } else if (obj.type === 'path' && URBAN_BLOCKING_PATH_KINDS.has(obj.kind)) {
      const hit = closestPointOnPolyline(candidate.x, candidate.y, obj);
      if (hit) {
        const minClear = obj.strokeWidthDoc * 0.56 + candidateRadiusDoc + 2.5;
        if (hit.dist < minClear) {
          return true;
        }
      }
    }
  }

  return false;
}

export function findOverlappingBuildingIdsForPlaza(
  doc: MapDocument,
  plaza: PlazaObject,
  marginDoc = 3
): string[] {
  const ids: string[] = [];
  for (const obj of doc.manifest.objects) {
    if (obj.type !== 'building') continue;
    const building = obj as BuildingObject;
    if (doOrientedRectsOverlap(plaza, building, marginDoc)) {
      ids.push(building.id);
    }
  }
  return ids;
}

function findSnapPointOnFilteredNetwork(
  doc: MapDocument,
  docX: number,
  docY: number,
  snapRadiusDoc: number,
  allowedKinds: ReadonlySet<PathKind>,
  includePlazas: boolean
): { x: number; y: number; snapped: boolean } {
  let bestDist = snapRadiusDoc;
  let bestX = docX;
  let bestY = docY;
  let snapped = false;

  for (const obj of doc.manifest.objects) {
    if (obj.type === 'path' && allowedKinds.has(obj.kind)) {
      const pts =
        obj.kind === 'river' ? getRiverWorldSpinePoints(obj) : getPathWorldPoints(obj);
      const count = Math.floor(pts.length / 2);
      if (count < 2) continue;
      // Prioritize endpoints first with slight bonus for crisp confluence / junction snaps
      for (const idx of [0, count - 1]) {
        const vx = pts[idx * 2];
        const vy = pts[idx * 2 + 1];
        const d = Math.hypot(docX - vx, docY - vy) * 0.8;
        if (d < bestDist) {
          bestDist = d;
          bestX = vx;
          bestY = vy;
          snapped = true;
        }
      }
      const hit = closestPointOnWorldPoints(docX, docY, pts);
      if (hit && hit.dist < bestDist) {
        bestDist = hit.dist;
        bestX = hit.projX;
        bestY = hit.projY;
        snapped = true;
      }
    } else if (includePlazas && obj.type === 'plaza') {
      const hw = obj.width * 0.5;
      const hh = obj.height * 0.5;
      const rad = (obj.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const toWorld = (lx: number, ly: number) => ({
        x: obj.x + lx * cos - ly * sin,
        y: obj.y + lx * sin + ly * cos
      });
      const cardinals = [
        toWorld(0, -hh + 1.5),
        toWorld(hw - 1.5, 0),
        toWorld(0, hh - 1.5),
        toWorld(-hw + 1.5, 0)
      ];
      for (const pt of cardinals) {
        const d = Math.hypot(docX - pt.x, docY - pt.y) * 0.82;
        if (d < bestDist) {
          bestDist = d;
          bestX = pt.x;
          bestY = pt.y;
          snapped = true;
        }
      }

      // Also project along rotated plaza edges for non-cardinal entering streets
      const dx = docX - obj.x;
      const dy = docY - obj.y;
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      const edges: ReadonlyArray<readonly [number, number, number, number]> = [
        [-hw, -hh, hw, -hh],
        [hw, -hh, hw, hh],
        [hw, hh, -hw, hh],
        [-hw, hh, -hw, -hh]
      ];
      for (const [ax, ay, bx, by] of edges) {
        const edgeHit = distPointToSegment(localX, localY, ax, ay, bx, by);
        if (edgeHit.dist < bestDist) {
          // Nudge 1.5u inward so the street enters cleanly inside the plaza perimeter
          const lenToCenter = Math.hypot(edgeHit.projX, edgeHit.projY) || 1;
          const insetX = edgeHit.projX - (edgeHit.projX / lenToCenter) * 1.5;
          const insetY = edgeHit.projY - (edgeHit.projY / lenToCenter) * 1.5;
          const wp = toWorld(insetX, insetY);
          bestDist = edgeHit.dist;
          bestX = wp.x;
          bestY = wp.y;
          snapped = true;
        }
      }
    }
  }

  return { x: bestX, y: bestY, snapped };
}

const URBAN_SNAP_KINDS = new Set<PathKind>(['avenue', 'road', 'alley', 'canal', 'wall']);
const ROAD_SNAP_KINDS = new Set<PathKind>(['avenue', 'road', 'alley']);
const RIVER_SNAP_KINDS = new Set<PathKind>(['river']);
const CANAL_SNAP_KINDS = new Set<PathKind>(['canal']);

/**
 * Snaps a point to the nearest endpoint or segment of existing streets/canals/plaza
 * perimeters when drawing roads or walls manually.
 */
export function findSnapPointOnUrbanPaths(
  doc: MapDocument,
  docX: number,
  docY: number,
  snapRadiusDoc = 20
): { x: number; y: number; snapped: boolean } {
  return findSnapPointOnFilteredNetwork(
    doc,
    docX,
    docY,
    snapRadiusDoc,
    URBAN_SNAP_KINDS,
    true
  );
}

/**
 * Context-aware snap for any vector path tool (`river` -> parent river centerlines,
 * `road`/`avenue`/`alley` -> roads & plazas, `canal` -> canals, `wall` -> walls & roads).
 */
export function findSnapPointForPathKind(
  doc: MapDocument,
  docX: number,
  docY: number,
  kind: PathKind,
  snapRadiusDoc?: number
): { x: number; y: number; snapped: boolean } {
  if (kind === 'river') {
    return findSnapPointOnFilteredNetwork(
      doc,
      docX,
      docY,
      snapRadiusDoc ?? 24,
      RIVER_SNAP_KINDS,
      false
    );
  }
  if (kind === 'road' || kind === 'avenue' || kind === 'alley') {
    return findSnapPointOnFilteredNetwork(
      doc,
      docX,
      docY,
      snapRadiusDoc ?? 20,
      ROAD_SNAP_KINDS,
      true
    );
  }
  if (kind === 'canal') {
    return findSnapPointOnFilteredNetwork(
      doc,
      docX,
      docY,
      snapRadiusDoc ?? 20,
      CANAL_SNAP_KINDS,
      false
    );
  }
  if (kind === 'wall') {
    return findSnapPointOnUrbanPaths(doc, docX, docY, snapRadiusDoc ?? 18);
  }
  return { x: docX, y: docY, snapped: false };
}
