import { clampNumber } from '../model/coordinates';
import { MapDocument } from '../model/document';
import { simplifyPolyline } from '../objects/objectCommands';

export type WallDrawMode = 'polyline' | 'arc' | 'freehand';

/**
 * Constrains segment endpoint `(bx, by)` relative to `(ax, ay)` to discrete angular increments
 * (default 15 degrees) while preserving exact Euclidean segment length.
 */
export function snapWallSegmentAngle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  incrementDeg = 15
): { x: number; y: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return { x: bx, y: by };
  const stepRad = (incrementDeg * Math.PI) / 180;
  const snapped = Math.round(Math.atan2(dy, dx) / stepRad) * stepRad;
  return {
    x: Number((ax + Math.cos(snapped) * len).toFixed(2)),
    y: Number((ay + Math.sin(snapped) * len).toFixed(2))
  };
}

/**
 * Generates either a smooth circular arc or an evenly faceted polygonal masonry arc
 * passing from `A=(ax, ay)` through `C=(cx, cy)` to `B=(bx, by)`.
 */
export function buildCircularArcPoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  options?: { faceted?: boolean; facetLengthDoc?: number }
): number[] {
  const chordLen = Math.hypot(bx - ax, by - ay);
  if (chordLen < 2) return [ax, ay, bx, by];

  const d = 2 * (ax * (cy - by) + cx * (by - ay) + bx * (ay - cy));
  if (Math.abs(d) < 1e-3) {
    return [
      Number(ax.toFixed(2)),
      Number(ay.toFixed(2)),
      Number(bx.toFixed(2)),
      Number(by.toFixed(2))
    ];
  }

  const a2 = ax * ax + ay * ay;
  const c2 = cx * cx + cy * cy;
  const b2 = bx * bx + by * by;
  const ux = (a2 * (cy - by) + c2 * (by - ay) + b2 * (ay - cy)) / d;
  const uy = (a2 * (bx - cx) + c2 * (ax - bx) + b2 * (cx - ax)) / d;
  const radius = Math.hypot(ax - ux, ay - uy);

  if (!Number.isFinite(radius) || radius < 4 || radius > 16000) {
    return [
      Number(ax.toFixed(2)),
      Number(ay.toFixed(2)),
      Number(cx.toFixed(2)),
      Number(cy.toFixed(2)),
      Number(bx.toFixed(2)),
      Number(by.toFixed(2))
    ];
  }

  const angA = Math.atan2(ay - uy, ax - ux);
  const angC = Math.atan2(cy - uy, cx - ux);
  const angB = Math.atan2(by - uy, bx - ux);
  const tau = Math.PI * 2;
  const ccw = (from: number, to: number) => (((to - from) % tau) + tau) % tau;
  const sweepAC = ccw(angA, angC);
  const sweepAB = ccw(angA, angB);
  const sweep = sweepAC <= sweepAB ? sweepAB : -(tau - sweepAB);
  const arcLen = Math.abs(sweep) * radius;

  const faceted = Boolean(options?.faceted);
  const steps = faceted
    ? clampNumber(Math.round(arcLen / (options?.facetLengthDoc ?? 68)), 2, 24)
    : clampNumber(Math.ceil(arcLen / 16), 6, 48);

  const pts: number[] = [Number(ax.toFixed(2)), Number(ay.toFixed(2))];
  for (let i = 1; i < steps; i += 1) {
    const theta = angA + (sweep * i) / steps;
    pts.push(
      Number((ux + Math.cos(theta) * radius).toFixed(2)),
      Number((uy + Math.sin(theta) * radius).toFixed(2))
    );
  }
  pts.push(Number(bx.toFixed(2)), Number(by.toFixed(2)));
  return pts;
}

/**
 * Rectifies a hand-drawn wall gesture into crisp architectural straight curtains
 * (filtering hand tremor, merging near-collinear angles, and auto-detecting ring closure).
 */
export function rectifyFreehandWallPolyline(
  rawPoints: readonly number[],
  options?: { strokeWidthDoc?: number; closeThresholdDoc?: number }
): { points: number[]; closed: boolean } {
  const count = Math.floor(rawPoints.length / 2);
  if (count < 2) {
    return { points: [...rawPoints], closed: false };
  }

  let totalLen = 0;
  for (let i = 0; i < count - 1; i += 1) {
    totalLen += Math.hypot(
      rawPoints[(i + 1) * 2] - rawPoints[i * 2],
      rawPoints[(i + 1) * 2 + 1] - rawPoints[i * 2 + 1]
    );
  }

  const closeThresh = options?.closeThresholdDoc ?? 28;
  const endDist = Math.hypot(
    rawPoints[(count - 1) * 2] - rawPoints[0],
    rawPoints[(count - 1) * 2 + 1] - rawPoints[1]
  );
  let closed = totalLen >= 90 && endDist <= closeThresh;

  const working: number[] = [];
  const limit = closed ? count - 1 : count;
  for (let i = 0; i < limit; i += 1) {
    working.push(rawPoints[i * 2], rawPoints[i * 2 + 1]);
  }
  if (closed && Math.hypot(working[working.length - 2] - working[0], working[working.length - 1] - working[1]) < 8 && working.length >= 6) {
    working.pop();
    working.pop();
  }

  const tol = clampNumber((options?.strokeWidthDoc ?? 13) * 1.15, 11, 24);
  const rdp = simplifyPolyline(working.length >= 4 ? working : [...rawPoints], tol);
  let verts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < Math.floor(rdp.length / 2); i += 1) {
    verts.push({ x: rdp[i * 2], y: rdp[i * 2 + 1] });
  }

  if (verts.length < 3) {
    closed = false;
  }

  // Merge collinear chains (< 16 deg deviation) and tiny short stubs (< 24 u)
  const minCornerAngleRad = (16 * Math.PI) / 180;
  let changed = true;
  let passes = 0;
  while (changed && passes < 6 && verts.length >= 3) {
    changed = false;
    passes += 1;
    const nextVerts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < verts.length; i += 1) {
      if (!closed && (i === 0 || i === verts.length - 1)) {
        nextVerts.push(verts[i]);
        continue;
      }
      const prev = verts[(i - 1 + verts.length) % verts.length];
      const curr = verts[i];
      const next = verts[(i + 1) % verts.length];
      const ax = curr.x - prev.x;
      const ay = curr.y - prev.y;
      const bx = next.x - curr.x;
      const by = next.y - curr.y;
      const lenA = Math.hypot(ax, ay);
      const lenB = Math.hypot(bx, by);
      if (lenA < 22 || lenB < 22) {
        if (verts.length > (closed ? 3 : 2)) {
          changed = true;
          continue;
        }
      }
      if (lenA >= 1 && lenB >= 1) {
        const dot = clampNumber((ax * bx + ay * by) / (lenA * lenB), -1, 1);
        const turnAngle = Math.acos(dot);
        if (turnAngle < minCornerAngleRad && verts.length > (closed ? 3 : 2)) {
          changed = true;
          continue;
        }
      }
      nextVerts.push(curr);
    }
    verts = nextVerts;
  }

  if (verts.length < 3) closed = false;

  const out: number[] = [];
  for (const v of verts) {
    out.push(Number(v.x.toFixed(2)), Number(v.y.toFixed(2)));
  }
  return { points: out, closed };
}

/**
 * Computes which side of a wall polyline faces outward from the fortified town (`+1` = left normal,
 * `-1` = right normal in Canvas2D Y-down coordinates), using polygon winding when closed or existing
 * city structures / canvas center when open.
 */
export function detectAutoWallSide(
  worldPoints: readonly number[],
  closed: boolean,
  doc: MapDocument
): 1 | -1 {
  const count = Math.floor(worldPoints.length / 2);
  if (count < 2) return 1;

  if (closed && count >= 3) {
    let signedArea2 = 0;
    for (let i = 0; i < count; i += 1) {
      const x0 = worldPoints[i * 2];
      const y0 = worldPoints[i * 2 + 1];
      const x1 = worldPoints[((i + 1) % count) * 2];
      const y1 = worldPoints[((i + 1) % count) * 2 + 1];
      signedArea2 += x0 * y1 - x1 * y0;
    }
    if (Math.abs(signedArea2) > 1e-2) {
      // Y-down clockwise (signedArea2 > 0) has interior on LEFT (+1) => outward is RIGHT (-1)
      return signedArea2 > 0 ? -1 : 1;
    }
  }

  // Open wall: point away from centroid of urban buildings/plazas (fallback: page center)
  let sumX = 0;
  let sumY = 0;
  let weightCount = 0;
  for (const obj of doc.manifest.objects) {
    if (obj.type === 'building' || obj.type === 'plaza') {
      sumX += obj.x;
      sumY += obj.y;
      weightCount += 1;
    }
  }
  const refX = weightCount > 0 ? sumX / weightCount : doc.manifest.space.width * 0.5;
  const refY = weightCount > 0 ? sumY / weightCount : doc.manifest.space.height * 0.5;

  let dotSum = 0;
  for (let i = 0; i < count - 1; i += 1) {
    const ax = worldPoints[i * 2];
    const ay = worldPoints[i * 2 + 1];
    const bx = worldPoints[(i + 1) * 2];
    const by = worldPoints[(i + 1) * 2 + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen < 1) continue;
    const midX = (ax + bx) * 0.5;
    const midY = (ay + by) * 0.5;
    const lx = -(by - ay) / segLen;
    const ly = (bx - ax) / segLen;
    dotSum += ((refX - midX) * lx + (refY - midY) * ly) * segLen;
  }

  // If city center lies on LEFT side (+), outward side is RIGHT (-1)
  return dotSum >= 0 ? -1 : 1;
}
