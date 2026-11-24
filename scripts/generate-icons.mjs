import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.allocUnsafe(12 + len);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const s1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const s2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const s3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
  const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(hasNeg && hasPos);
}

function distToTriangleEdges(px, py, ax, ay, bx, by, cx, cy) {
  return Math.min(
    distToSegment(px, py, ax, ay, bx, by),
    distToSegment(px, py, bx, by, cx, cy),
    distToSegment(px, py, cx, cy, ax, ay)
  );
}

function mixColor(base, overlay, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  return [
    base[0] * (1 - a) + overlay[0] * a,
    base[1] * (1 - a) + overlay[1] * a,
    base[2] * (1 - a) + overlay[2] * a
  ];
}

function renderSagittaIcon(size, safeScale) {
  const rgba = new Uint8Array(size * size * 4);
  const bgSlate = [23, 35, 45];
  const raisedSlate = [34, 50, 63];
  const brass = [224, 187, 121];
  const brassDeep = [173, 134, 71];
  const parchment = [243, 238, 223];
  const mutedLine = [129, 147, 154];

  const invSize = 1 / size;
  const invScale = 1 / safeScale;
  const aa = 1.6 * invSize * invScale;

  // Freccia «Sagitta» orientata verso Nord-Est (-45 deg / 45 deg)
  const tip = [0.27, -0.27];
  const tail = [-0.24, 0.24];
  const wingTop = [-0.04, -0.17];
  const wingBottom = [0.17, 0.04];
  const notch = [-0.06, 0.06];
  const fletchA1 = [-0.2, 0.14];
  const fletchA2 = [-0.28, 0.14];
  const fletchB1 = [-0.14, 0.2];
  const fletchB2 = [-0.14, 0.28];

  for (let y = 0; y < size; y += 1) {
    const ny = ((y + 0.5) * invSize - 0.5) * invScale;
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) * invSize - 0.5) * invScale;
      const r = Math.hypot(nx, ny);

      // Sfondo radiale leggero su ardesia
      const bgMix = Math.max(0, 1 - Math.hypot(nx * safeScale, ny * safeScale) * 1.45);
      let col = mixColor(bgSlate, raisedSlate, bgMix * 0.65);

      // Anello esterno e anello interno della bussola
      const outerRing = Math.abs(r - 0.37) - 0.011;
      if (outerRing < aa) {
        col = mixColor(col, brass, Math.max(0, Math.min(1, (aa - outerRing) / aa)));
      }
      const innerRing = Math.abs(r - 0.315) - 0.0045;
      if (innerRing < aa) {
        col = mixColor(col, mutedLine, 0.72 * Math.max(0, Math.min(1, (aa - innerRing) / aa)));
      }

      // Tacche cardinali N/E/S/W sull'anello
      const tickDist = Math.min(
        distToSegment(nx, ny, 0, -0.415, 0, -0.325),
        distToSegment(nx, ny, 0.415, 0, 0.325, 0),
        distToSegment(nx, ny, 0, 0.415, 0, 0.325),
        distToSegment(nx, ny, -0.415, 0, -0.325, 0)
      ) - 0.008;
      if (tickDist < aa) {
        col = mixColor(col, brass, Math.max(0, Math.min(1, (aa - tickDist) / aa)));
      }

      // Asta e impennaggio della freccia Sagitta
      const shaftDist = distToSegment(nx, ny, tail[0], tail[1], notch[0], notch[1]) - 0.013;
      if (shaftDist < aa) {
        col = mixColor(col, parchment, Math.max(0, Math.min(1, (aa - shaftDist) / aa)));
      }
      const fletchDist = Math.min(
        distToSegment(nx, ny, fletchA1[0], fletchA1[1], fletchA2[0], fletchA2[1]),
        distToSegment(nx, ny, fletchB1[0], fletchB1[1], fletchB2[0], fletchB2[1]),
        distToSegment(nx, ny, tail[0] + 0.055, tail[1] - 0.055, tail[0] - 0.015, tail[1] - 0.055),
        distToSegment(nx, ny, tail[0] + 0.055, tail[1] - 0.055, tail[0] + 0.055, tail[1] + 0.015)
      ) - 0.0085;
      if (fletchDist < aa) {
        col = mixColor(col, brass, Math.max(0, Math.min(1, (aa - fletchDist) / aa)));
      }

      // Punta sfaccettata della Sagitta (metà chiara avorio, metà ottone)
      const inUpper = pointInTriangle(
        nx,
        ny,
        tip[0],
        tip[1],
        wingTop[0],
        wingTop[1],
        notch[0],
        notch[1]
      );
      const upperEdge = distToTriangleEdges(
        nx,
        ny,
        tip[0],
        tip[1],
        wingTop[0],
        wingTop[1],
        notch[0],
        notch[1]
      );
      const upperSigned = inUpper ? -upperEdge : upperEdge;
      if (upperSigned < aa) {
        col = mixColor(col, parchment, Math.max(0, Math.min(1, (aa - upperSigned) / aa)));
      }

      const inLower = pointInTriangle(
        nx,
        ny,
        tip[0],
        tip[1],
        notch[0],
        notch[1],
        wingBottom[0],
        wingBottom[1]
      );
      const lowerEdge = distToTriangleEdges(
        nx,
        ny,
        tip[0],
        tip[1],
        notch[0],
        notch[1],
        wingBottom[0],
        wingBottom[1]
      );
      const lowerSigned = inLower ? -lowerEdge : lowerEdge;
      if (lowerSigned < aa) {
        col = mixColor(col, brass, Math.max(0, Math.min(1, (aa - lowerSigned) / aa)));
      }

      // Spina dorsale sottile sulla punta
      const spine = distToSegment(nx, ny, notch[0], notch[1], tip[0], tip[1]) - 0.0035;
      if (spine < aa) {
        col = mixColor(col, brassDeep, 0.7 * Math.max(0, Math.min(1, (aa - spine) / aa)));
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(col[0]);
      rgba[idx + 1] = Math.round(col[1]);
      rgba[idx + 2] = Math.round(col[2]);
      rgba[idx + 3] = 255;
    }
  }

  return encodeRgbaPng(size, size, rgba);
}

const targets = [
  { path: 'public/icons/icon-180.png', size: 180, safeScale: 1.0 },
  { path: 'public/icons/icon-192.png', size: 192, safeScale: 1.0 },
  { path: 'public/icons/icon-512.png', size: 512, safeScale: 1.0 },
  { path: 'public/icons/icon-maskable-512.png', size: 512, safeScale: 0.72 }
];

for (const item of targets) {
  const absPath = resolve(process.cwd(), item.path);
  mkdirSync(dirname(absPath), { recursive: true });
  const png = renderSagittaIcon(item.size, item.safeScale);
  writeFileSync(absPath, png);
  console.log(`Generata icona ${item.path} (${png.byteLength} byte)`);
}
