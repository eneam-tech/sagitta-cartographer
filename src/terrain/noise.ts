/**
 * Pure deterministic noise and hashing utilities anchored to uint32 seed
 * and document-space coordinates. Guarantees identical micro-details across
 * pan, zoom, undo/redo, partial region rendering, and print export.
 */

export function hash2D(seed: number, ix: number, iy: number): number {
  let h = (seed >>> 0) ^ Math.imul(ix | 0, 0x9e3779b1) ^ Math.imul(iy | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash2DFloat(seed: number, ix: number, iy: number): number {
  return hash2D(seed, ix, iy) / 4294967296;
}

export function hash2DBipolar(seed: number, ix: number, iy: number): number {
  return (hash2D(seed, ix, iy) / 2147483647.5) - 1.0;
}

export function smoothstep01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

export function valueNoise2D(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = hash2DFloat(seed, x0, y0);
  const n10 = hash2DFloat(seed, x0 + 1, y0);
  const n01 = hash2DFloat(seed, x0, y0 + 1);
  const n11 = hash2DFloat(seed, x0 + 1, y0 + 1);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

export function fbm2D(seed: number, x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1.0;
  let norm = 0;
  let octSeed = seed >>> 0;

  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise2D(octSeed, x * freq, y * freq) * amp;
    norm += amp;
    freq *= 2.03;
    amp *= 0.5;
    octSeed = (octSeed + 0x9e3779b9) >>> 0;
  }

  return norm > 0 ? sum / norm : 0;
}

export interface CellJitterSample {
  dx: number;
  dy: number;
  r: number;
  v: number;
}

export function cellJitter(
  seed: number,
  cellX: number,
  cellY: number,
  salt = 0
): CellJitterSample {
  const baseSeed = (seed ^ Math.imul(salt | 0, 0x27d4eb2d)) >>> 0;
  const h1 = hash2D(baseSeed, cellX, cellY);
  const h2 = hash2D((baseSeed + 0x6c078965) >>> 0, cellX, cellY);
  return {
    dx: (h1 & 0xffff) / 65536,
    dy: ((h1 >>> 16) & 0xffff) / 65536,
    r: (h2 & 0xffff) / 65536,
    v: ((h2 >>> 16) & 0xffff) / 65536
  };
}
