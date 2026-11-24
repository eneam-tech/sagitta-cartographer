import { getCityThemePalette } from '../city/geometry';
import { clampNumber } from '../model/coordinates';
import { PathObject, WallGateOpening, WallStyle } from '../model/document';
import { DEFAULT_THEME, MapTheme } from '../theme/theme';

export interface WallPoint2D {
  x: number;
  y: number;
}

interface WallSpan {
  points: WallPoint2D[];
  closedLoop: boolean;
}

interface GateJamb {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

interface GateSpanMarker {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  tx: number;
  ty: number;
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, '');
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean.slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length < 6) return [110, 102, 92];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function adjustHexBrightness(hex: string, factor: number): string {
  const [r, g, b] = parseHexRgb(hex);
  const nr = clampNumber(Math.round(r * factor), 0, 255);
  const ng = clampNumber(Math.round(g * factor), 0, 255);
  const nb = clampNumber(Math.round(b * factor), 0, 255);
  return `rgb(${nr}, ${ng}, ${nb})`;
}

function buildWallSpansAndGates(
  pts: readonly number[],
  wallClosed: boolean,
  gates: readonly WallGateOpening[] | undefined,
  scaleX: number,
  scaleY: number
): {
  spans: WallSpan[];
  jambs: GateJamb[];
  thresholds: GateSpanMarker[];
  corners: Array<{
    x: number;
    y: number;
    bx: number;
    by: number;
    turnRad: number;
  }>;
} {
  const rawCount = Math.floor(pts.length / 2);
  if (rawCount < 2) {
    return { spans: [], jambs: [], thresholds: [], corners: [] };
  }

  const baseVerts: WallPoint2D[] = [];
  for (let i = 0; i < rawCount; i += 1) {
    baseVerts.push({ x: pts[i * 2], y: pts[i * 2 + 1] });
  }

  const isClosed = Boolean(wallClosed) && baseVerts.length >= 3;
  const ringVerts: WallPoint2D[] = [...baseVerts];
  if (isClosed) {
    const first = baseVerts[0];
    const last = baseVerts[baseVerts.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) > 0.5) {
      ringVerts.push({ x: first.x, y: first.y });
    }
  }

  const segCount = ringVerts.length - 1;
  const segStartDist = new Float64Array(segCount);
  const segLenArr = new Float64Array(segCount);
  let totalLen = 0;
  for (let i = 0; i < segCount; i += 1) {
    segStartDist[i] = totalLen;
    const len = Math.hypot(
      ringVerts[i + 1].x - ringVerts[i].x,
      ringVerts[i + 1].y - ringVerts[i].y
    );
    segLenArr[i] = len;
    totalLen += len;
  }

  // Extract corner bisectors on un-cut wall corners for bastion spurs
  const corners: Array<{ x: number; y: number; bx: number; by: number; turnRad: number }> = [];
  const cornerVerts = isClosed ? baseVerts : ringVerts;
  const cornerLoopLen = cornerVerts.length;
  for (let i = 0; i < cornerLoopLen; i += 1) {
    if (!isClosed && (i === 0 || i === cornerLoopLen - 1)) continue;
    const prev = cornerVerts[(i - 1 + cornerLoopLen) % cornerLoopLen];
    const curr = cornerVerts[i];
    const next = cornerVerts[(i + 1) % cornerLoopLen];
    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    if (l1 < 2 || l2 < 2) continue;
    const u1x = d1x / l1;
    const u1y = d1y / l1;
    const u2x = d2x / l2;
    const u2y = d2y / l2;
    const dot = clampNumber(u1x * u2x + u1y * u2y, -1, 1);
    const turnRad = Math.acos(dot);
    if (turnRad < (20 * Math.PI) / 180) continue;
    // Left normals of incoming and outgoing segments averaged
    const n1x = -u1y;
    const n1y = u1x;
    const n2x = -u2y;
    const n2y = u2x;
    let bx = n1x + n2x;
    let by = n1y + n2y;
    const bLen = Math.hypot(bx, by);
    if (bLen < 1e-3) {
      bx = n1x;
      by = n1y;
    } else {
      bx /= bLen;
      by /= bLen;
    }
    corners.push({
      x: curr.x * scaleX,
      y: curr.y * scaleY,
      bx,
      by,
      turnRad
    });
  }

  const normalizedGates: Array<{ start: number; end: number }> = [];
  if (gates && gates.length > 0 && totalLen > 4) {
    const sorted = gates
      .map((g) => ({
        start: clampNumber(g.distanceDoc - g.halfWidthDoc, 0, totalLen),
        end: clampNumber(g.distanceDoc + g.halfWidthDoc, 0, totalLen)
      }))
      .filter((g) => g.end - g.start >= 2)
      .sort((a, b) => a.start - b.start);

    for (const g of sorted) {
      const prev = normalizedGates[normalizedGates.length - 1];
      if (prev && g.start <= prev.end + 2) {
        prev.end = Math.max(prev.end, g.end);
      } else {
        normalizedGates.push({ ...g });
      }
    }
  }

  const sampleAtDocDist = (d: number): { x: number; y: number; tx: number; ty: number } => {
    const clamped = clampNumber(d, 0, totalLen);
    let idx = 0;
    while (idx < segCount - 1 && segStartDist[idx + 1] < clamped) {
      idx += 1;
    }
    const len = segLenArr[idx];
    const t = len > 1e-6 ? clampNumber((clamped - segStartDist[idx]) / len, 0, 1) : 0;
    const a = ringVerts[idx];
    const b = ringVerts[idx + 1];
    return {
      x: (a.x + (b.x - a.x) * t) * scaleX,
      y: (a.y + (b.y - a.y) * t) * scaleY,
      tx: len > 1e-6 ? (b.x - a.x) / len : 1,
      ty: len > 1e-6 ? (b.y - a.y) / len : 0
    };
  };

  if (normalizedGates.length === 0) {
    const scaled = ringVerts.map((v) => ({ x: v.x * scaleX, y: v.y * scaleY }));
    if (isClosed) {
      // Remove duplicate final vertex so closePath() forms an exact miter corner at index 0
      scaled.pop();
    }
    return {
      spans: [{ points: scaled, closedLoop: isClosed }],
      jambs: [],
      thresholds: [],
      corners
    };
  }

  // Extract complement solid intervals `[solidStart, solidEnd]` around gate cuts
  const solidIntervals: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const gate of normalizedGates) {
    if (gate.start - cursor > 1.5) {
      solidIntervals.push({ start: cursor, end: gate.start });
    }
    cursor = Math.max(cursor, gate.end);
  }
  if (totalLen - cursor > 1.5) {
    solidIntervals.push({ start: cursor, end: totalLen });
  }

  const spans: WallSpan[] = solidIntervals.map((interval) => {
    const pStart = sampleAtDocDist(interval.start);
    const ptsOut: WallPoint2D[] = [{ x: pStart.x, y: pStart.y }];
    for (let i = 1; i < ringVerts.length - 1; i += 1) {
      const vd = segStartDist[i];
      if (vd > interval.start + 0.5 && vd < interval.end - 0.5) {
        ptsOut.push({ x: ringVerts[i].x * scaleX, y: ringVerts[i].y * scaleY });
      }
    }
    const pEnd = sampleAtDocDist(interval.end);
    ptsOut.push({ x: pEnd.x, y: pEnd.y });
    return { points: ptsOut, closedLoop: false };
  });

  // Merge closing corner back across index 0 when loop had a solid segment both at start and end
  if (
    isClosed &&
    spans.length >= 2 &&
    normalizedGates[0].start > 1.5 &&
    normalizedGates[normalizedGates.length - 1].end < totalLen - 1.5
  ) {
    const firstSpan = spans.shift()!;
    const lastSpan = spans[spans.length - 1];
    lastSpan.points.push(...firstSpan.points.slice(1));
  }

  const jambs: GateJamb[] = [];
  const thresholds: GateSpanMarker[] = [];
  for (const gate of normalizedGates) {
    const pA = sampleAtDocDist(gate.start);
    const pB = sampleAtDocDist(gate.end);
    jambs.push(pA, pB);
    thresholds.push({
      ax: pA.x,
      ay: pA.y,
      bx: pB.x,
      by: pB.y,
      tx: pA.tx,
      ty: pA.ty
    });
  }

  // Filter out corner bastion spurs that would land inside an open road gate
  const filteredCorners = corners.filter((c) => {
    for (const th of thresholds) {
      const mx = (th.ax + th.bx) * 0.5;
      const my = (th.ay + th.by) * 0.5;
      const gateR = Math.hypot(th.bx - th.ax, th.by - th.ay) * 0.65;
      if (Math.hypot(c.x - mx, c.y - my) < gateR) return false;
    }
    return true;
  });

  return { spans, jambs, thresholds, corners: filteredCorners };
}

function traceWallSpans(
  ctx: CanvasRenderingContext2D,
  spans: readonly WallSpan[],
  offsetSidePx = 0,
  wallSide: 1 | -1 = 1
): void {
  ctx.beginPath();
  for (const span of spans) {
    const pts = span.points;
    if (pts.length < 2) continue;

    if (Math.abs(offsetSidePx) < 1e-3) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      if (span.closedLoop) {
        ctx.closePath();
      }
      continue;
    }

    // Normal-offset polyline trace along wallSide
    const shifted: WallPoint2D[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i += 1) {
      const prev = span.closedLoop ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
      const next = span.closedLoop ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy);
      const nx = len >= 1e-4 ? (-dy / len) * wallSide : 0;
      const ny = len >= 1e-4 ? (dx / len) * wallSide : -1;
      shifted.push({
        x: pts[i].x + nx * offsetSidePx,
        y: pts[i].y + ny * offsetSidePx
      });
    }
    ctx.moveTo(shifted[0].x, shifted[0].y);
    for (let i = 1; i < shifted.length; i += 1) {
      ctx.lineTo(shifted[i].x, shifted[i].y);
    }
    if (span.closedLoop) {
      ctx.closePath();
    }
  }
}

function sampleAlongSpans(
  spans: readonly WallSpan[],
  stepPx: number,
  initialOffsetPx: number,
  endMarginPx: number,
  callback: (cx: number, cy: number, tx: number, ty: number, index: number) => void
): void {
  const safeStep = Math.max(0.8, stepPx);
  let sampleIdx = 0;

  for (const span of spans) {
    const pts = span.points;
    const edgeCount = span.closedLoop ? pts.length : pts.length - 1;
    if (edgeCount <= 0) continue;

    let spanTotal = 0;
    const edges: Array<{ ax: number; ay: number; dx: number; dy: number; tx: number; ty: number; len: number }> = [];
    for (let i = 0; i < edgeCount; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) continue;
      edges.push({ ax: a.x, ay: a.y, dx, dy, tx: dx / len, ty: dy / len, len });
      spanTotal += len;
    }
    if (spanTotal < 1e-3) continue;

    const maxSampleDist = span.closedLoop
      ? spanTotal - Math.min(safeStep * 0.35, endMarginPx)
      : Math.max(initialOffsetPx * 0.5, spanTotal - endMarginPx);
    let targetDist = Math.min(initialOffsetPx, maxSampleDist);
    if (targetDist < 0 || maxSampleDist <= 0) continue;

    let accum = 0;
    let edgeIdx = 0;
    while (edgeIdx < edges.length && targetDist <= maxSampleDist + 1e-4) {
      const e = edges[edgeIdx];
      while (targetDist <= accum + e.len + 1e-4 && targetDist <= maxSampleDist + 1e-4) {
        const localT = clampNumber((targetDist - accum) / e.len, 0, 1);
        callback(
          e.ax + e.dx * localT,
          e.ay + e.dy * localT,
          e.tx,
          e.ty,
          sampleIdx
        );
        sampleIdx += 1;
        targetDist += safeStep;
      }
      accum += e.len;
      edgeIdx += 1;
    }
  }
}

function traceDiamondBastion(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  reachPx: number,
  halfSpanPx: number
): void {
  const px = -by;
  const py = bx;
  ctx.beginPath();
  ctx.moveTo(cx + bx * reachPx, cy + by * reachPx);
  ctx.lineTo(cx + bx * (reachPx * 0.25) + px * halfSpanPx, cy + by * (reachPx * 0.25) + py * halfSpanPx);
  ctx.lineTo(cx - bx * (halfSpanPx * 0.35), cy - by * (halfSpanPx * 0.35));
  ctx.lineTo(cx + bx * (reachPx * 0.25) - px * halfSpanPx, cy + by * (reachPx * 0.25) - py * halfSpanPx);
  ctx.closePath();
}

/**
 * Renders architectural fortifications (`stone`, `palisade`, `bastion`, `low-wall`) onto a Canvas2D context
 * with rigid stone miter joins, directional lighting, real road gate cutouts + jambs, outward crenellations,
 * bastion spurs, and timber palisade logs matching both 2.5D roofs and engraved ink plans.
 */
export function drawArchitecturalWallToContext(
  ctx: CanvasRenderingContext2D,
  path: PathObject,
  pts: readonly number[],
  theme: MapTheme | undefined,
  scaleX: number,
  scaleY: number,
  pass: 'full' | 'casing' | 'fill' = 'full',
  wallCasingPhase: 'shadow' | 'ink' | 'both' = 'both'
): void {
  const avgScale = (scaleX + scaleY) * 0.5;
  const wallStyle: WallStyle = path.wallStyle ?? 'stone';
  const wallSide: 1 | -1 = path.wallSide ?? 1;
  const resolvedTheme = theme ?? DEFAULT_THEME;
  const palette = getCityThemePalette(resolvedTheme);
  const isInkPlan = palette.renderStyle === 'ink-plan';
  const inkColor = resolvedTheme.colors.ink;
  const shadowColor = palette.roofShadow;
  const defaultStone = palette.wallStone;

  const baseWidthPx = Math.max(0.75, path.strokeWidthDoc * avgScale);
  const bodyWidthPx =
    wallStyle === 'bastion'
      ? baseWidthPx * 1.18
      : wallStyle === 'low-wall'
        ? Math.max(1.2, baseWidthPx * 0.62)
        : baseWidthPx;
  const defaultPalisade = isInkPlan ? '#A37952' : '#B57B48';
  const wallFillColor =
    wallStyle === 'palisade'
      ? path.color &&
        path.color.toUpperCase() !== '#8A5C38' &&
        path.color.toUpperCase() !== '#5D5246'
        ? path.color
        : defaultPalisade
      : path.color || defaultStone;

  const { spans, jambs, thresholds, corners } = buildWallSpansAndGates(
    pts,
    Boolean(path.wallClosed),
    path.wallGates,
    scaleX,
    scaleY
  );
  if (spans.length === 0) return;

  ctx.save();
  ctx.lineJoin = wallStyle === 'palisade' ? 'round' : 'miter';
  ctx.lineCap = 'butt';
  ctx.miterLimit = 3.2;

  const bastionReachPx = bodyWidthPx * 1.52;
  const bastionHalfSpanPx = bodyWidthPx * 0.94;

  // --- PASS 1: CASING (SE Shadows, Glacis berm, Ink Outer Perimeter) ---
  if (pass === 'casing' || pass === 'full') {
    const shDist =
      wallStyle === 'low-wall'
        ? Math.max(1, bodyWidthPx * 0.16)
        : Math.max(1.8, bodyWidthPx * 0.22);

    if (wallCasingPhase !== 'ink') {
      ctx.save();
      ctx.translate(shDist, shDist);
      traceWallSpans(ctx, spans);
      ctx.strokeStyle = shadowColor;
      ctx.lineWidth = bodyWidthPx + Math.max(1.2, avgScale * 1.2);
      ctx.stroke();

      if (wallStyle === 'bastion') {
        ctx.fillStyle = shadowColor;
        for (const c of corners) {
          traceDiamondBastion(
            ctx,
            c.x,
            c.y,
            c.bx * wallSide,
            c.by * wallSide,
            bastionReachPx,
            bastionHalfSpanPx
          );
          ctx.fill();
        }
      }
      ctx.restore();

      // Subtle outer glacis / embankment along stone & bastion fortifications
      if ((wallStyle === 'stone' || wallStyle === 'bastion') && !isInkPlan) {
        ctx.save();
        ctx.globalAlpha *= wallStyle === 'bastion' ? 0.34 : 0.24;
        traceWallSpans(ctx, spans, bodyWidthPx * 0.24, wallSide);
        ctx.strokeStyle = adjustHexBrightness(wallFillColor, 0.72);
        ctx.lineWidth = bodyWidthPx * 0.74;
        ctx.stroke();
        ctx.restore();
      }
    }

    if (wallCasingPhase !== 'shadow') {
      const inkPad = wallStyle === 'low-wall' ? Math.max(1.2, avgScale * 1.3) : Math.max(1.8, avgScale * 2.1);
      traceWallSpans(ctx, spans);
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = bodyWidthPx + inkPad;
      ctx.stroke();

      if (wallStyle === 'bastion') {
        for (const c of corners) {
          traceDiamondBastion(
            ctx,
            c.x,
            c.y,
            c.bx * wallSide,
            c.by * wallSide,
            bastionReachPx,
            bastionHalfSpanPx
          );
          ctx.strokeStyle = inkColor;
          ctx.lineWidth = inkPad;
          ctx.stroke();
        }
      }
    }
  }

  // --- PASS 2: FILL (Stone masonry + merlons, Palisade logs, Bastion spurs, Dry-stone, Gates) ---
  if (pass === 'fill' || pass === 'full') {
    if (wallStyle === 'palisade') {
      const woodBase = wallFillColor;
      const woodWalk = isInkPlan ? resolvedTheme.colors.labelHalo : adjustHexBrightness(woodBase, 0.8);
      const woodLit = adjustHexBrightness(woodBase, 1.18);
      const woodDark = adjustHexBrightness(woodBase, 0.62);

      // 1. Interior earth berm & raised timber catwalk beam
      traceWallSpans(ctx, spans, -bodyWidthPx * 0.18, wallSide);
      ctx.strokeStyle = woodWalk;
      ctx.lineWidth = bodyWidthPx * 0.44;
      ctx.stroke();

      // Catwalk plank cross-ribs
      const plankStep = Math.max(3.6, bodyWidthPx * 0.52);
      ctx.beginPath();
      sampleAlongSpans(spans, plankStep, plankStep * 0.5, plankStep * 0.35, (cx, cy, tx, ty) => {
        const ox = -ty * wallSide;
        const oy = tx * wallSide;
        const rx = cx - ox * (bodyWidthPx * 0.18);
        const ry = cy - oy * (bodyWidthPx * 0.18);
        ctx.moveTo(rx - ox * bodyWidthPx * 0.17, ry - oy * bodyWidthPx * 0.17);
        ctx.lineTo(rx + ox * bodyWidthPx * 0.17, ry + oy * bodyWidthPx * 0.17);
      });
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = Math.max(0.55, avgScale * 0.68);
      ctx.stroke();

      // 2. Dense row of individual overhead round timber stakes along outward edge
      const logRadiusBase = clampNumber(bodyWidthPx * 0.25, 1.4, 5.4);
      const logStep = logRadiusBase * 1.54;
      sampleAlongSpans(spans, logStep, logRadiusBase * 0.9, logRadiusBase * 0.9, (px, py, tx, ty, logIdx) => {
        const ox = -ty * wallSide;
        const oy = tx * wallSide;
        const hash = Math.abs(Math.sin(logIdx * 12.9898) * 43758.5453) % 1;
        const r = logRadiusBase * (0.88 + hash * 0.24);
        const cx = px + ox * (bodyWidthPx * 0.18);
        const cy = py + oy * (bodyWidthPx * 0.18);

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = isInkPlan ? woodBase : hash > 0.45 ? woodLit : woodBase;
        ctx.fill();
        ctx.strokeStyle = inkColor;
        ctx.lineWidth = clampNumber(avgScale * 0.72, 0.55, 1.2);
        ctx.stroke();

        if (!isInkPlan && r >= 2.0) {
          ctx.beginPath();
          ctx.arc(cx - r * 0.22, cy - r * 0.22, r * 0.32, 0, Math.PI * 2);
          ctx.fillStyle = woodDark;
          ctx.fill();
        }
      });
    } else if (wallStyle === 'low-wall') {
      // Dry-stone perimeter wall (narrow masonry blocks, mortar seams, lit top crest, no battlements)
      traceWallSpans(ctx, spans);
      ctx.strokeStyle = wallFillColor;
      ctx.lineWidth = bodyWidthPx;
      ctx.stroke();

      // Stone block joints
      const stoneStep = Math.max(4, bodyWidthPx * 1.15);
      ctx.beginPath();
      sampleAlongSpans(spans, stoneStep, stoneStep * 0.4, stoneStep * 0.35, (px, py, tx, ty) => {
        const nx = -ty;
        const ny = tx;
        ctx.moveTo(px - nx * bodyWidthPx * 0.44, py - ny * bodyWidthPx * 0.44);
        ctx.lineTo(px + nx * bodyWidthPx * 0.44, py + ny * bodyWidthPx * 0.44);
      });
      ctx.strokeStyle = inkColor;
      ctx.globalAlpha *= 0.65;
      ctx.lineWidth = Math.max(0.65, avgScale * 0.8);
      ctx.stroke();
      ctx.globalAlpha /= 0.65;

      if (!isInkPlan) {
        traceWallSpans(ctx, spans);
        ctx.strokeStyle = adjustHexBrightness(wallFillColor, 1.16);
        ctx.lineWidth = Math.max(0.8, bodyWidthPx * 0.28);
        ctx.stroke();
      }
    } else {
      // 'stone' or 'bastion' fortified masonry wall
      const stoneBody = wallFillColor;
      const stoneWalk = adjustHexBrightness(stoneBody, 0.82);
      const stoneCrest = adjustHexBrightness(stoneBody, 1.18);

      // 1. Outward glacis hatching along 'bastion' curtains
      if (wallStyle === 'bastion') {
        const hatchStep = Math.max(3.6, bodyWidthPx * 0.36);
        const hatchLen = bodyWidthPx * 0.48;
        ctx.beginPath();
        sampleAlongSpans(spans, hatchStep, hatchStep * 0.4, hatchStep * 0.3, (px, py, tx, ty) => {
          const ox = -ty * wallSide;
          const oy = tx * wallSide;
          const sx = px + ox * (bodyWidthPx * 0.5);
          const sy = py + oy * (bodyWidthPx * 0.5);
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + ox * hatchLen, sy + oy * hatchLen);
        });
        ctx.strokeStyle = inkColor;
        ctx.globalAlpha *= 0.42;
        ctx.lineWidth = Math.max(0.6, avgScale * 0.75);
        ctx.stroke();
        ctx.globalAlpha /= 0.42;
      }

      // 2. Main stone curtain core
      traceWallSpans(ctx, spans);
      ctx.strokeStyle = isInkPlan
        ? adjustHexBrightness(resolvedTheme.colors.labelHalo, 0.89)
        : stoneBody;
      ctx.lineWidth = bodyWidthPx;
      ctx.stroke();

      // 3. Recessed interior wall-walk (camminamento di ronda) shifted toward inner side
      traceWallSpans(ctx, spans, -bodyWidthPx * 0.14, wallSide);
      ctx.strokeStyle = isInkPlan ? resolvedTheme.colors.labelHalo : stoneWalk;
      ctx.lineWidth = bodyWidthPx * 0.46;
      ctx.stroke();

      // Thin ink separation line between parapet and wall-walk
      traceWallSpans(ctx, spans, bodyWidthPx * 0.09, wallSide);
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = clampNumber(avgScale * 0.75, 0.6, 1.3);
      ctx.stroke();

      // 4. Transverse ashlar stone joint ticks across the wall-walk
      const ashlarStep = Math.max(5.5, bodyWidthPx * 0.82);
      ctx.beginPath();
      sampleAlongSpans(spans, ashlarStep, ashlarStep * 0.45, ashlarStep * 0.35, (px, py, tx, ty) => {
        const ox = -ty * wallSide;
        const oy = tx * wallSide;
        const cx = px - ox * (bodyWidthPx * 0.14);
        const cy = py - oy * (bodyWidthPx * 0.14);
        ctx.moveTo(cx - ox * bodyWidthPx * 0.2, cy - oy * bodyWidthPx * 0.2);
        ctx.lineTo(cx + ox * bodyWidthPx * 0.2, cy + oy * bodyWidthPx * 0.2);
      });
      ctx.save();
      ctx.globalAlpha *= 0.38;
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = Math.max(0.6, avgScale * 0.7);
      ctx.stroke();
      ctx.restore();

      // 5. Real rectangular merlons / battlements seated along outward parapet edge (continuous across arcs)
      const merlonPeriod = Math.max(5.8, bodyWidthPx * 0.78);
      const merlonHalfL = merlonPeriod * 0.28;
      const merlonThick = clampNumber(bodyWidthPx * 0.3, 2.0, 7.2);
      sampleAlongSpans(spans, merlonPeriod, merlonPeriod * 0.45, merlonHalfL * 0.85, (px, py, tx, ty) => {
        const ox = -ty * wallSide;
        const oy = tx * wallSide;
        const cx = px + ox * (bodyWidthPx * 0.32);
        const cy = py + oy * (bodyWidthPx * 0.32);
        const halfT = merlonThick * 0.5;

        ctx.beginPath();
        ctx.moveTo(cx - tx * merlonHalfL - ox * halfT, cy - ty * merlonHalfL - oy * halfT);
        ctx.lineTo(cx + tx * merlonHalfL - ox * halfT, cy + ty * merlonHalfL - oy * halfT);
        ctx.lineTo(cx + tx * merlonHalfL + ox * halfT, cy + ty * merlonHalfL + oy * halfT);
        ctx.lineTo(cx - tx * merlonHalfL + ox * halfT, cy - ty * merlonHalfL + oy * halfT);
        ctx.closePath();

        if (!isInkPlan && typeof ctx.fill === 'function') {
          ctx.fillStyle = stoneCrest;
          ctx.fill();
          ctx.strokeStyle = inkColor;
          ctx.lineWidth = clampNumber(avgScale * 0.72, 0.55, 1.2);
          ctx.stroke();
        } else if (typeof ctx.fill === 'function') {
          ctx.fillStyle = inkColor;
          ctx.fill();
          ctx.strokeStyle = inkColor;
          ctx.lineWidth = clampNumber(avgScale * 0.75, 0.6, 1.2);
          ctx.stroke();
        }
      });

      // 6. Angular diamond bastion spurs at convex/bent fortress corners
      if (wallStyle === 'bastion' && typeof ctx.fill === 'function') {
        const reach = bastionReachPx;
        const halfSpan = bastionHalfSpanPx;
        for (const c of corners) {
          const bx = c.bx * wallSide;
          const by = c.by * wallSide;
          const px = -by;
          const py = bx;
          const tipX = c.x + bx * reach;
          const tipY = c.y + by * reach;
          const wing1X = c.x + bx * (reach * 0.25) + px * halfSpan;
          const wing1Y = c.y + by * (reach * 0.25) + py * halfSpan;
          const backX = c.x - bx * (halfSpan * 0.35);
          const backY = c.y - by * (halfSpan * 0.35);

          traceDiamondBastion(ctx, c.x, c.y, bx, by, reach, halfSpan);
          ctx.fillStyle = isInkPlan ? stoneBody : stoneCrest;
          ctx.fill();

          if (!isInkPlan) {
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(wing1X, wing1Y);
            ctx.lineTo(backX, backY);
            ctx.closePath();
            ctx.fillStyle = stoneWalk;
            ctx.fill();
          } else {
            // Crisp inner recessed bastion gun-deck for engraved ink plan
            traceDiamondBastion(ctx, c.x, c.y, bx, by, reach * 0.66, halfSpan * 0.56);
            ctx.fillStyle = resolvedTheme.colors.labelHalo;
            ctx.fill();
            ctx.strokeStyle = inkColor;
            ctx.lineWidth = clampNumber(avgScale * 0.75, 0.6, 1.2);
            ctx.stroke();
          }

          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(backX, backY);
          ctx.strokeStyle = inkColor;
          ctx.lineWidth = clampNumber(avgScale * 0.7, 0.6, 1.2);
          ctx.stroke();

          traceDiamondBastion(ctx, c.x, c.y, bx, by, reach, halfSpan);
          ctx.strokeStyle = inkColor;
          ctx.lineWidth = clampNumber(avgScale * 1.1, 0.85, 1.8);
          ctx.stroke();
        }
      }
    }

    // Gate openings: faint paved threshold + crisp masonry/timber jamb caps at cut curtain ends
    if (thresholds.length > 0 && typeof ctx.stroke === 'function') {
      ctx.save();
      ctx.globalAlpha *= 0.28;
      ctx.beginPath();
      for (const th of thresholds) {
        const nx = -th.ty;
        const ny = th.tx;
        const off = bodyWidthPx * 0.34;
        ctx.moveTo(th.ax + nx * off, th.ay + ny * off);
        ctx.lineTo(th.bx + nx * off, th.by + ny * off);
        ctx.moveTo(th.ax - nx * off, th.ay - ny * off);
        ctx.lineTo(th.bx - nx * off, th.by - ny * off);
      }
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = clampNumber(avgScale * 0.85, 0.7, 1.5);
      if (typeof ctx.setLineDash === 'function') {
        ctx.setLineDash([3 * avgScale, 3 * avgScale]);
      }
      ctx.stroke();
      if (typeof ctx.setLineDash === 'function') {
        ctx.setLineDash([]);
      }
      ctx.restore();

      const jambHalfW = bodyWidthPx * 0.56;
      const jambHalfLen = Math.max(1.5, avgScale * 1.8);
      for (const j of jambs) {
        const nx = -j.ty;
        const ny = j.tx;
        ctx.beginPath();
        ctx.moveTo(j.x - j.tx * jambHalfLen - nx * jambHalfW, j.y - j.ty * jambHalfLen - ny * jambHalfW);
        ctx.lineTo(j.x + j.tx * jambHalfLen - nx * jambHalfW, j.y + j.ty * jambHalfLen - ny * jambHalfW);
        ctx.lineTo(j.x + j.tx * jambHalfLen + nx * jambHalfW, j.y + j.ty * jambHalfLen + ny * jambHalfW);
        ctx.lineTo(j.x - j.tx * jambHalfLen + nx * jambHalfW, j.y - j.ty * jambHalfLen + ny * jambHalfW);
        ctx.closePath();
        if (typeof ctx.fill === 'function') {
          ctx.fillStyle = adjustHexBrightness(wallFillColor, 1.15);
          ctx.fill();
        }
        ctx.strokeStyle = inkColor;
        ctx.lineWidth = clampNumber(avgScale * 0.9, 0.7, 1.4);
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}
