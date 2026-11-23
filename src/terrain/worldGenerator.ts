import { DirtyRectPx, TerrainPatchCommand, TerrainTilePatch } from '../model/commands';
import { clampNumber } from '../model/coordinates';
import {
  COVER_FIELDS,
  COVER_FOREST,
  COVER_MEADOW,
  COVER_NATURAL,
  COVER_ROCK,
  COVER_SAND,
  COVER_SNOW,
  COVER_SWAMP,
  CoverCode,
  MapDocument
} from '../model/document';
import { BRUSH_TILE_SIZE_PX } from './brush';
import { LAND_MASK_THRESHOLD, smoothstepRange } from './classifier';
import { fbm2D, ridgedFbm2D, valueNoise2D, warpedFbm2D } from './noise';

export type WorldGeneratorPresetId =
  | 'northern-realms'
  | 'skellige-archipelago'
  | 'continental-valley'
  | 'jagged-coast';

export interface WorldGeneratorPresetSpec {
  id: WorldGeneratorPresetId;
  label: string;
  description: string;
  defaultSeaLevelPercent: number;
  defaultMountainPercent: number;
  defaultRoughnessPercent: number;
  defaultBiomePercent: number;
}

export const WORLD_GENERATOR_PRESETS: readonly WorldGeneratorPresetSpec[] = [
  {
    id: 'northern-realms',
    label: 'Regni del Nord (The Witcher 3)',
    description:
      'Continente frastagliato affacciato sul mare occidentale con grande golfo, isolotti costieri, paludi e catene montuose a oriente.',
    defaultSeaLevelPercent: 40,
    defaultMountainPercent: 78,
    defaultRoughnessPercent: 76,
    defaultBiomePercent: 82
  },
  {
    id: 'skellige-archipelago',
    label: 'Arcipelago di Skellige',
    description:
      'Grappolo di isole aspre e scoscese con fiordi profondi, cime innevate e scogli battuti dai mari.',
    defaultSeaLevelPercent: 52,
    defaultMountainPercent: 84,
    defaultRoughnessPercent: 85,
    defaultBiomePercent: 74
  },
  {
    id: 'continental-valley',
    label: 'Valle Continentale',
    description:
      'Ampia regione interna di pianure coltivate, boschi secolari, bassopiani e corone montuose periferiche.',
    defaultSeaLevelPercent: 24,
    defaultMountainPercent: 68,
    defaultRoughnessPercent: 64,
    defaultBiomePercent: 86
  },
  {
    id: 'jagged-coast',
    label: 'Costa e Isole Frastagliate',
    description:
      'Lungo arco costiero ricco di baie, promontori rocciosi, golfi interni e arcipelaghi satelliti.',
    defaultSeaLevelPercent: 46,
    defaultMountainPercent: 72,
    defaultRoughnessPercent: 88,
    defaultBiomePercent: 78
  }
] as const;

export interface WorldGeneratorOptions {
  preset: WorldGeneratorPresetId;
  seed?: number;
  seaLevelPercent?: number;
  mountainStrengthPercent?: number;
  coastRoughnessPercent?: number;
  biomeRichnessPercent?: number;
}

export interface WorldGenerationResult {
  command: TerrainPatchCommand;
  dirtyRect: DirtyRectPx;
}

export function getWorldGeneratorPreset(presetId: WorldGeneratorPresetId): WorldGeneratorPresetSpec {
  return (
    WORLD_GENERATOR_PRESETS.find((p) => p.id === presetId) ?? WORLD_GENERATOR_PRESETS[0]
  );
}

function evaluatePresetLandPotential(
  preset: WorldGeneratorPresetId,
  u: number,
  v: number,
  coastField: number,
  detailField: number,
  roughness: number
): number {
  const nMix = coastField * 0.72 + detailField * 0.28;
  const coastPerturb = (nMix - 0.5) * (0.28 + 0.42 * roughness);

  if (preset === 'northern-realms') {
    // Open western ocean (left), broad jagged mainland (center/east), gulf estuary & coastal skerries
    let base = smoothstepRange(0.14, 0.56, u);
    // Gentle bay carving around center-west & northern cape (Pontar / Novigrad silhouette)
    const gulfDist = Math.hypot((u - 0.43) * 1.4, (v - 0.40) * 1.75);
    const northBayDist = Math.hypot((u - 0.30) * 1.6, (v - 0.16) * 1.5);
    const southPeninsula = Math.exp(-Math.pow((u - 0.36) / 0.22, 2) - Math.pow((v - 0.72) / 0.24, 2));
    base -= Math.exp(-gulfDist * gulfDist * 5.2) * 0.38;
    base -= Math.exp(-northBayDist * northBayDist * 6.5) * 0.28;
    base += southPeninsula * 0.26;
    // Soft frame framing top & western edges, while east & south continents anchor firmly
    if (v < 0.08) base -= smoothstepRange(0.08, 0.0, v) * 0.12;
    if (v > 0.94) base -= smoothstepRange(0.94, 1.0, v) * 0.10;
    if (u < 0.10) base -= smoothstepRange(0.10, 0.0, u) * 0.35;

    // Offshore western skerries / islands
    const isletBand = smoothstepRange(0.08, 0.22, u) * (1 - smoothstepRange(0.32, 0.44, u));
    const isletBoost =
      isletBand * smoothstepRange(0.64 - 0.1 * roughness, 0.86, nMix) * 0.48;
    return base + coastPerturb + isletBoost;
  }

  if (preset === 'skellige-archipelago') {
    // Cluster of jagged mountainous islands in open sea
    const centers: ReadonlyArray<readonly [number, number, number, number]> = [
      [0.50, 0.46, 0.24, 0.90], // Ard Skellig main island
      [0.26, 0.34, 0.12, 0.72], // NW island
      [0.74, 0.32, 0.13, 0.74], // NE island
      [0.32, 0.70, 0.13, 0.75], // SW island
      [0.68, 0.72, 0.12, 0.70], // SE island
      [0.48, 0.18, 0.09, 0.62]  // Northern islet
    ];
    let maxIsland = 0;
    for (let i = 0; i < centers.length; i += 1) {
      const [cx, cy, rad, weight] = centers[i];
      const d = Math.hypot((u - cx) * 1.1, cy - v) / rad;
      const lobe = Math.max(0, 1 - d * d) * weight;
      if (lobe > maxIsland) maxIsland = lobe;
    }
    const seaMargin =
      Math.min(u, 1 - u, v, 1 - v) < 0.05
        ? smoothstepRange(0.0, 0.05, Math.min(u, 1 - u, v, 1 - v))
        : 1;
    const skerryBoost = smoothstepRange(0.72 - 0.1 * roughness, 0.90, nMix) * 0.32;
    return maxIsland * seaMargin + coastPerturb * 0.92 + skerryBoost;
  }

  if (preset === 'continental-valley') {
    // Rich inland basin with optional western cove and perimeter mountain rim
    const cornerSea = Math.exp(-Math.pow((u - 0.10) / 0.16, 2) - Math.pow((v - 0.16) / 0.20, 2));
    const swSea = Math.exp(-Math.pow((u - 0.14) / 0.18, 2) - Math.pow((v - 0.84) / 0.18, 2));
    const base = 0.80 - cornerSea * 0.56 - swSea * 0.42;
    return base + coastPerturb * 0.72;
  }

  // 'jagged-coast': sweeping diagonal peninsula + bay + offshore islands
  const diag = smoothstepRange(0.18, 0.76, u * 0.68 + v * 0.55);
  const bay = Math.exp(-Math.pow((u - 0.54) / 0.18, 2) - Math.pow((v - 0.42) / 0.16, 2));
  const cape = Math.exp(-Math.pow((u - 0.34) / 0.17, 2) - Math.pow((v - 0.56) / 0.15, 2));
  const skerries =
    (1 - smoothstepRange(0.28, 0.52, u * 0.6 + v * 0.4)) *
    smoothstepRange(0.66 - 0.1 * roughness, 0.88, nMix) *
    0.44;
  return diag - bay * 0.34 + cape * 0.32 + coastPerturb * 1.05 + skerries;
}

/**
 * Deterministically generates a full landmass, sharp ridged mountain ranges,
 * coastal flats, and biome covers (forest, swamp, fields, meadow, sand, rock, snow)
 * wrapped in a single undoable `TerrainPatchCommand`.
 */
export function generateProceduralWorldTerrain(
  doc: MapDocument,
  options: WorldGeneratorOptions
): WorldGenerationResult {
  const presetSpec = getWorldGeneratorPreset(options.preset);
  const seed = ((options.seed ?? doc.manifest.terrain.seed ?? 173) >>> 0);
  const seaPercent = clampNumber(
    options.seaLevelPercent ?? presetSpec.defaultSeaLevelPercent,
    10,
    80
  );
  const mtnPercent = clampNumber(
    options.mountainStrengthPercent ?? presetSpec.defaultMountainPercent,
    10,
    100
  );
  const roughPercent = clampNumber(
    options.coastRoughnessPercent ?? presetSpec.defaultRoughnessPercent,
    10,
    100
  );
  const biomePercent = clampNumber(
    options.biomeRichnessPercent ?? presetSpec.defaultBiomePercent,
    0,
    100
  );

  const seaThreshold = 0.24 + (seaPercent / 100) * 0.50; // ~0.34..0.64
  const mtnStrength = 0.25 + (mtnPercent / 100) * 0.95;
  const roughness = roughPercent / 100;
  const biomeWeight = biomePercent / 100;

  const { widthPx, heightPx, mask, height, cover } = doc.terrain;
  const { space } = doc.manifest;

  const prevMask = new Uint8Array(mask);
  const prevHeight = new Uint8Array(height);
  const prevCover = new Uint8Array(cover);

  doc.manifest.terrain.seed = seed;

  const coastSeed = (seed ^ 0x47454e) >>> 0;
  const detailSeed = (seed ^ 0x444554) >>> 0;
  const ridgeSeed = (seed ^ 0x524944) >>> 0;
  const ridgeSpurSeed = (seed ^ 0x525350) >>> 0;
  const mtnZoneSeed = (seed ^ 0x4d5a4e) >>> 0;
  const forestSeed = (seed ^ 0x464f52) >>> 0;
  const fieldsSeed = (seed ^ 0x464c44) >>> 0;
  const swampSeed = (seed ^ 0x535750) >>> 0;
  const hillSeed = (seed ^ 0x48494c) >>> 0;

  const minDim = Math.max(200, Math.min(space.width, space.height));
  const invMacro = 3.2 / minDim;
  const invDetail = 9.0 / minDim;
  const invRidge = 4.2 / minDim;
  const invBiome = 6.5 / minDim;
  const aaWidth = Math.max(0.008, (space.width / widthPx) * 0.0035);

  for (let py = 0; py < heightPx; py += 1) {
    const docY = ((py + 0.5) / heightPx) * space.height;
    const v = (py + 0.5) / heightPx;
    const rowOff = py * widthPx;

    for (let px = 0; px < widthPx; px += 1) {
      const idx = rowOff + px;
      const docX = ((px + 0.5) / widthPx) * space.width;
      const u = (px + 0.5) / widthPx;

      const coastField = warpedFbm2D(coastSeed, docX * invMacro, docY * invMacro, 3);
      const detailField = valueNoise2D(detailSeed, docX * invDetail, docY * invDetail);
      const landPotential = evaluatePresetLandPotential(
        options.preset,
        u,
        v,
        coastField,
        detailField,
        roughness
      );

      const signed = landPotential - seaThreshold;
      if (signed <= -aaWidth) {
        mask[idx] = 0;
        height[idx] = 0;
        cover[idx] = COVER_NATURAL;
        continue;
      }

      const nextMask =
        signed >= aaWidth
          ? 255
          : Math.min(255, Math.max(0, Math.round(smoothstepRange(-aaWidth, aaWidth, signed) * 255)));
      mask[idx] = nextMask;

      if (nextMask < LAND_MASK_THRESHOLD) {
        height[idx] = 0;
        cover[idx] = COVER_NATURAL;
        continue;
      }

      // Compute sharp ridged mountain chains + organic foothills
      const inlandDepth = clampNumber(signed / 0.34, 0, 1);
      const hillBase = fbm2D(hillSeed, docX * invMacro * 1.35, docY * invMacro * 1.35, 3);
      const mtnClusterN = valueNoise2D(mtnZoneSeed, docX * invMacro * 1.1, docY * invMacro * 1.1);

      let macroBelt = mtnClusterN;
      if (options.preset === 'northern-realms') {
        // Bold eastern/SE ranges & northeastern peaks like Bald Mountain + Pontar highlands
        const eastWeight = smoothstepRange(0.40, 0.86, u);
        const sePeakCluster =
          Math.exp(-Math.pow((u - 0.72) / 0.22, 2) - Math.pow((v - 0.68) / 0.20, 2)) * 0.55;
        const neCluster =
          Math.exp(-Math.pow((u - 0.80) / 0.20, 2) - Math.pow((v - 0.24) / 0.20, 2)) * 0.45;
        macroBelt = mtnClusterN * 0.55 + eastWeight * 0.4 + sePeakCluster + neCluster;
      } else if (options.preset === 'continental-valley') {
        // Mountains rim the north/east borders while center stays rich fertile valley
        const edgeProx = Math.max(
          smoothstepRange(0.76, 0.98, u),
          smoothstepRange(0.24, 0.02, v),
          smoothstepRange(0.80, 0.98, v)
        );
        macroBelt = mtnClusterN * 0.45 + edgeProx * 0.65;
      }

      const beltMask = smoothstepRange(0.32, 0.84, macroBelt);
      const primaryRidge = ridgedFbm2D(ridgeSeed, docX * invRidge, docY * invRidge, 4);
      const spurRidge = ridgedFbm2D(ridgeSpurSeed, docX * invRidge * 2.1, docY * invRidge * 2.1, 2);
      const combinedRidge = primaryRidge * 0.78 + spurRidge * 0.22;

      const coastFade = smoothstepRange(0.01, 0.22, inlandDepth);
      const rollingHills = (14 + hillBase * 76) * Math.min(1, coastFade * 0.85 + 0.15);
      const mountainSpire =
        Math.pow(combinedRidge, 1.15) * 235 * mtnStrength * beltMask * coastFade;
      const spineProfile = 0.28 + 0.72 * smoothstepRange(0.28, 0.82, combinedRidge);

      const hFloat = rollingHills + mountainSpire * spineProfile;
      const nextHeight = clampNumber(Math.round(hFloat), 4, 255);
      height[idx] = nextHeight;

      // Biome cover synthesis
      let nextCover: CoverCode = COVER_NATURAL;
      if (biomeWeight > 0.05) {
        const thresholdShift = (1 - biomeWeight) * 0.28;
        if (nextHeight >= 224 - (1 - biomeWeight) * 14 && combinedRidge > 0.58) {
          nextCover = COVER_SNOW;
        } else if (nextHeight >= 188 && combinedRidge > 0.72) {
          nextCover = COVER_ROCK;
        } else {
          const forestN = fbm2D(forestSeed, docX * invBiome, docY * invBiome, 3);
          const swampN = fbm2D(swampSeed, docX * invBiome * 0.85, docY * invBiome * 0.85, 2);
          const fieldsN = fbm2D(fieldsSeed, docX * invBiome * 1.1, docY * invBiome * 1.1, 2);

          if (
            nextHeight >= 16 &&
            nextHeight <= 72 &&
            swampN > 0.64 + thresholdShift &&
            inlandDepth < 0.65
          ) {
            nextCover = COVER_SWAMP;
          } else if (nextHeight >= 18 && nextHeight <= 202 && forestN > 0.53 + thresholdShift) {
            nextCover = COVER_FOREST;
          } else if (
            nextHeight >= 26 &&
            nextHeight <= 108 &&
            inlandDepth > 0.14 &&
            fieldsN > 0.65 + thresholdShift
          ) {
            nextCover = detailField > 0.42 ? COVER_FIELDS : COVER_MEADOW;
          } else if (
            options.preset === 'northern-realms' &&
            inlandDepth < 0.08 &&
            nextHeight <= 22 &&
            fieldsN > 0.62
          ) {
            nextCover = COVER_SAND;
          }
        }
      }
      cover[idx] = nextCover;
    }
  }

  // Package changed 128x128 tiles cleanly into one undoable TerrainPatchCommand
  const tilesX = Math.ceil(widthPx / BRUSH_TILE_SIZE_PX);
  const tilesY = Math.ceil(heightPx / BRUSH_TILE_SIZE_PX);
  const patches: TerrainTilePatch[] = [];
  let minChangedX = widthPx;
  let minChangedY = heightPx;
  let maxChangedX = -1;
  let maxChangedY = -1;

  for (let ty = 0; ty < tilesY; ty += 1) {
    const tileY = ty * BRUSH_TILE_SIZE_PX;
    const th = Math.min(BRUSH_TILE_SIZE_PX, heightPx - tileY);
    for (let tx = 0; tx < tilesX; tx += 1) {
      const tileX = tx * BRUSH_TILE_SIZE_PX;
      const tw = Math.min(BRUSH_TILE_SIZE_PX, widthPx - tileX);
      let dirty = false;

      for (let ly = 0; ly < th; ly += 1) {
        const rowOff = (tileY + ly) * widthPx + tileX;
        for (let lx = 0; lx < tw; lx += 1) {
          const i = rowOff + lx;
          if (
            mask[i] !== prevMask[i] ||
            height[i] !== prevHeight[i] ||
            cover[i] !== prevCover[i]
          ) {
            dirty = true;
            const gx = tileX + lx;
            const gy = tileY + ly;
            if (gx < minChangedX) minChangedX = gx;
            if (gx > maxChangedX) maxChangedX = gx;
            if (gy < minChangedY) minChangedY = gy;
            if (gy > maxChangedY) maxChangedY = gy;
          }
        }
      }

      if (!dirty) continue;

      const cellCount = tw * th;
      const beforeMask = new Uint8Array(cellCount);
      const afterMask = new Uint8Array(cellCount);
      const beforeHeight = new Uint8Array(cellCount);
      const afterHeight = new Uint8Array(cellCount);
      const beforeCover = new Uint8Array(cellCount);
      const afterCover = new Uint8Array(cellCount);

      for (let ly = 0; ly < th; ly += 1) {
        const srcStart = (tileY + ly) * widthPx + tileX;
        const dstStart = ly * tw;
        beforeMask.set(prevMask.subarray(srcStart, srcStart + tw), dstStart);
        afterMask.set(mask.subarray(srcStart, srcStart + tw), dstStart);
        beforeHeight.set(prevHeight.subarray(srcStart, srcStart + tw), dstStart);
        afterHeight.set(height.subarray(srcStart, srcStart + tw), dstStart);
        beforeCover.set(prevCover.subarray(srcStart, srcStart + tw), dstStart);
        afterCover.set(cover.subarray(srcStart, srcStart + tw), dstStart);
      }

      patches.push({
        x: tileX,
        y: tileY,
        width: tw,
        height: th,
        beforeMask,
        afterMask,
        beforeHeight,
        afterHeight,
        beforeCover,
        afterCover
      });
    }
  }

  const dirtyRect: DirtyRectPx =
    maxChangedX >= minChangedX && maxChangedY >= minChangedY
      ? {
          x: minChangedX,
          y: minChangedY,
          width: maxChangedX - minChangedX + 1,
          height: maxChangedY - minChangedY + 1
        }
      : { x: 0, y: 0, width: widthPx, height: heightPx };

  const command = new TerrainPatchCommand(
    `Genera mondo: ${presetSpec.label}`,
    dirtyRect,
    patches
  );
  return { command, dirtyRect };
}
