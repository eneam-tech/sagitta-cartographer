/**
 * Pure deterministic noise and hashing utilities anchored to uint32 seed
 * and document-space coordinates. Guarantees identical micro-details across
 * pan, zoom, undo/redo, partial region rendering, and print export.
 */

const INV_U32 = 1 / 4294967296;
const INV_HALF_U32 = 1 / 2147483647.5;

export function hash2D(seed: number, ix: number, iy: number): number {
  let h = (seed >>> 0) ^ Math.imul(ix | 0, 0x9e3779b1) ^ Math.imul(iy | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash2DFloat(seed: number, ix: number, iy: number): number {
  return hash2D(seed, ix, iy) * INV_U32;
}

export function hash2DBipolar(seed: number, ix: number, iy: number): number {
  return hash2D(seed, ix, iy) * INV_HALF_U32 - 1.0;
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

  const u = seed >>> 0;
  const mx0 = Math.imul(x0 | 0, 0x9e3779b1);
  const mx1 = Math.imul((x0 + 1) | 0, 0x9e3779b1);
  const my0 = Math.imul(y0 | 0, 0x85ebca77);
  const my1 = Math.imul((y0 + 1) | 0, 0x85ebca77);

  let h = u ^ mx0 ^ my0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  const n00 = ((h ^ (h >>> 16)) >>> 0) * INV_U32;

  h = u ^ mx1 ^ my0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  const n10 = ((h ^ (h >>> 16)) >>> 0) * INV_U32;

  h = u ^ mx0 ^ my1;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  const n01 = ((h ^ (h >>> 16)) >>> 0) * INV_U32;

  h = u ^ mx1 ^ my1;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  const n11 = ((h ^ (h >>> 16)) >>> 0) * INV_U32;

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

export function fastOrganicNoise2D(seed: number, x: number, y: number): number {
  const u = seed >>> 0;
  const n0 = valueNoise2D(u, x, y);
  const n1 = valueNoise2D((u + 0x9e3779b9) >>> 0, x * 2.03 + 3.1, y * 2.03 - 1.7);
  return n0 * 0.67 + n1 * 0.33;
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

export function ridgedNoise2D(seed: number, x: number, y: number): number {
  const t = 1 - Math.abs(2 * valueNoise2D(seed, x, y) - 1);
  return t * t;
}

export function ridgedFbm2D(seed: number, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let freq = 1.0;
  let amp = 0.5;
  let norm = 0;
  let weight = 1.0;
  let octSeed = seed >>> 0;

  for (let i = 0; i < octaves; i += 1) {
    let signal = ridgedNoise2D(octSeed, x * freq, y * freq);
    signal *= weight;
    weight = Math.min(1, Math.max(0.22, signal * 1.8));
    sum += signal * amp;
    norm += amp;
    freq *= 2.07;
    amp *= 0.5;
    octSeed = (octSeed + 0x9e3779b9) >>> 0;
  }

  return norm > 0 ? Math.min(1, Math.max(0, sum / norm)) : 0;
}

export function warpedFbm2D(seed: number, x: number, y: number, octaves = 3): number {
  const warpX = (fbm2D((seed ^ 0x51a1) >>> 0, x * 0.85, y * 0.85, 2) - 0.5) * 1.15;
  const warpY = (fbm2D((seed ^ 0x9b2c) >>> 0, x * 0.85 + 7.3, y * 0.85 - 4.1, 2) - 0.5) * 1.15;
  return fbm2D(seed >>> 0, x + warpX, y + warpY, octaves);
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
