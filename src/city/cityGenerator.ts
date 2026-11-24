import { clampNumber } from '../model/coordinates';
import {
  BuildingRenderStyle,
  COVER_BRICK,
  COVER_FIELDS,
  COVER_FOREST,
  COVER_MEADOW,
  COVER_NATURAL,
  DEFAULT_LAYER_BUILDINGS_ID,
  DEFAULT_LAYER_LABELS_ID,
  DEFAULT_LAYER_VECTORS_ID,
  MapDocument,
  MapObject,
  TerrainBuffers,
  resolveObjectLayerId
} from '../model/document';
import {
  createBuildingObject,
  createLabelObject,
  createPathObject,
  createPlazaObject
} from '../objects/objectCommands';
import { fbm2D } from '../terrain/noise';
import {
  CITY_HARBOR_THEME,
  CITY_IMPERIAL_THEME,
  CITY_INKPLAN_THEME,
  CITY_MEDIEVAL_THEME,
  MapTheme,
  getDefaultLabelColor
} from '../theme/theme';
import {
  createSeededRng,
  getCityThemePalette,
  pickDeterministicRoofColor
} from './geometry';
import { generateDistrictBuildingsAlongStroke } from './smartDistrictBrush';
import {
  buildSmartCityWallObjects,
  generateStreetGridInRect
} from './streetGridTool';

export type CityGeneratorPresetId =
  | 'medieval-town'
  | 'imperial-grid'
  | 'harbor-canals'
  | 'ink-cadastre';

export type CityWaterfrontKind = 'none' | 'river' | 'harbor';

export interface CityGeneratorPresetSpec {
  id: CityGeneratorPresetId;
  label: string;
  description: string;
  theme: MapTheme;
  defaultSizePercent: number;
  defaultDensityPercent: number;
  defaultWaterfront: CityWaterfrontKind;
  defaultHasWalls: boolean;
}

export const CITY_GENERATOR_PRESETS: ReadonlyArray<CityGeneratorPresetSpec> = [
  {
    id: 'medieval-town',
    label: 'Borgo medievale murato',
    description:
      'Cinta muraria poligonale con torri e porte, strade organiche verso la piazza del mercato e cattedrale centrale.',
    theme: CITY_MEDIEVAL_THEME,
    defaultSizePercent: 68,
    defaultDensityPercent: 76,
    defaultWaterfront: 'river',
    defaultHasWalls: true
  },
  {
    id: 'imperial-grid',
    label: 'Città imperiale a griglia',
    description:
      'Impianto ortogonale a cardo e decumano intorno al foro monumentale, isolati ordinati e grandi corsi.',
    theme: CITY_IMPERIAL_THEME,
    defaultSizePercent: 74,
    defaultDensityPercent: 80,
    defaultWaterfront: 'none',
    defaultHasWalls: true
  },
  {
    id: 'harbor-canals',
    label: 'Città portuale e canali',
    description:
      'Baia portuale con darsena, canali navigabili, magazzini allineati alle banchine e moli esterni.',
    theme: CITY_HARBOR_THEME,
    defaultSizePercent: 72,
    defaultDensityPercent: 74,
    defaultWaterfront: 'harbor',
    defaultHasWalls: false
  },
  {
    id: 'ink-cadastre',
    label: 'Pianta catastale antica',
    description:
      'Planimetria storica ad alto contrasto in stile incisione con isolati pieni a inchiostro e campi circostanti.',
    theme: CITY_INKPLAN_THEME,
    defaultSizePercent: 70,
    defaultDensityPercent: 78,
    defaultWaterfront: 'river',
    defaultHasWalls: true
  }
];

export function getCityGeneratorPreset(id: CityGeneratorPresetId): CityGeneratorPresetSpec {
  return CITY_GENERATOR_PRESETS.find((p) => p.id === id) ?? CITY_GENERATOR_PRESETS[0];
}

export interface CityGeneratorOptions {
  preset: CityGeneratorPresetId;
  seed: number;
  citySizePercent: number; // 40..95
  densityPercent: number; // 35..100
  waterfront: CityWaterfrontKind;
  hasWalls: boolean;
}

function carveWaterChannel(
  mask: Uint8Array,
  height: Uint8Array,
  cover: Uint8Array,
  w: number,
  h: number,
  waterfront: CityWaterfrontKind,
  seed: number
): void {
  const noiseSeed = (seed ^ 0x9e3779b9) >>> 0;

  for (let py = 0; py < h; py += 1) {
    const ny = py / h;
    for (let px = 0; px < w; px += 1) {
      const nx = px / w;
      const idx = py * w + px;

      if (waterfront === 'harbor') {
        const edgeJitter = (fbm2D(noiseSeed, nx * 5.2, ny * 5.2, 3) * 2 - 1) * 0.065;
        const harborCoastY = 0.72 + Math.sin(nx * Math.PI * 1.4) * 0.055 + edgeJitter;
        // Curved inner basin harbor indent
        const dockDist = Math.hypot((nx - 0.5) * 1.35, ny - 0.77);
        const inHarbor = ny > harborCoastY || dockDist < 0.16;
        if (inHarbor) {
          mask[idx] = 0;
          height[idx] = 0;
          cover[idx] = COVER_NATURAL;
          continue;
        }
      } else if (waterfront === 'river') {
        const meander =
          0.73 +
          Math.sin(nx * Math.PI * 1.85 + 0.4) * 0.085 +
          (fbm2D(noiseSeed, nx * 4, ny * 4, 2) * 2 - 1) * 0.025;
        const halfWidthNorm = 0.036 + Math.sin(nx * Math.PI) * 0.012;
        if (Math.abs(ny - meander) < halfWidthNorm) {
          mask[idx] = 0;
          height[idx] = 0;
          cover[idx] = COVER_NATURAL;
          continue;
        }
      }

      mask[idx] = 255;
      const dx = nx - 0.5;
      const dy = ny - 0.48;
      const dist = Math.hypot(dx, dy);
      const hillF = fbm2D(noiseSeed, nx * 4.5 + 11, ny * 4.5 + 3, 3) * 2 - 1;
      // Gentle elevation rise away from harbor/river, kept mostly plains/gentle hills so terrain looks warm
      const elev = clampNumber(
        Math.round(68 + dist * 34 + hillF * 18),
        38,
        145
      );
      height[idx] = elev;

      if (dist > 0.36) {
        const patch = fbm2D(noiseSeed, nx * 8, ny * 8, 2) * 2 - 1;
        if (patch > 0.28) {
          cover[idx] = COVER_FOREST;
        } else if (patch < -0.14) {
          cover[idx] = COVER_FIELDS;
        } else {
          cover[idx] = COVER_MEADOW;
        }
      } else if (dist < 0.12) {
        cover[idx] = COVER_BRICK;
      } else {
        cover[idx] = COVER_NATURAL;
      }
    }
  }
}

/**
 * Generates a complete procedural fantasy city (waterfront terrain, street network,
 * plazas, fortified walls + towers + gatehouses, landmarks, aligned district blocks,
 * and Italian cartographic labels) in memory ready for atomic replacement.
 */
export function generateProceduralCity(
  doc: MapDocument,
  options: CityGeneratorOptions,
  themeOverride?: MapTheme
): { terrain: TerrainBuffers; objects: MapObject[]; theme: MapTheme } {
  const activeTheme = themeOverride ?? doc.theme;
  const seed = (Math.floor(options.seed) || 1) >>> 0;
  const rng = createSeededRng(seed);

  const sizeFactor = clampNumber(options.citySizePercent / 100, 0.4, 0.95);
  const densityFactor = clampNumber(options.densityPercent / 100, 0.35, 1.0);

  const widthPx = doc.terrain.widthPx;
  const heightPx = doc.terrain.heightPx;
  const totalCells = widthPx * heightPx;
  const mask = new Uint8Array(totalCells);
  const height = new Uint8Array(totalCells);
  const cover = new Uint8Array(totalCells);

  carveWaterChannel(mask, height, cover, widthPx, heightPx, options.waterfront, seed);

  const terrain: TerrainBuffers = {
    widthPx,
    heightPx,
    mask,
    height,
    cover
  };

  const docW = doc.manifest.space.width;
  const docH = doc.manifest.space.height;
  const cityPalette = getCityThemePalette(activeTheme);
  const renderStyleOverride: BuildingRenderStyle | undefined =
    options.preset === 'ink-cadastre' && cityPalette.renderStyle !== 'ink-plan'
      ? 'ink-plan'
      : undefined;

  const layerVec = resolveObjectLayerId(
    { type: 'path', layerId: DEFAULT_LAYER_VECTORS_ID },
    doc.manifest.layers
  );
  const layerBldg = resolveObjectLayerId(
    { type: 'building', layerId: DEFAULT_LAYER_BUILDINGS_ID },
    doc.manifest.layers
  );
  const layerLabels = resolveObjectLayerId(
    { type: 'label', layerId: DEFAULT_LAYER_LABELS_ID },
    doc.manifest.layers
  );

  const centerX = docW * 0.5;
  const centerY = options.waterfront === 'harbor' ? docH * 0.44 : docH * 0.46;
  const coreRadiusX = docW * 0.34 * sizeFactor;
  const coreRadiusY = docH * 0.33 * sizeFactor;

  const virtualDoc: MapDocument = {
    ...doc,
    terrain,
    theme: activeTheme,
    manifest: {
      ...doc.manifest,
      objects: []
    }
  };

  // 1. Plazas (Central Market / Forum + optional Secondary Square)
  const mainPlazaSize = clampNumber(Math.min(docW, docH) * 0.068, 72, 118);
  const mainPlaza = createPlazaObject({
    layerId: layerVec,
    shape: options.preset === 'imperial-grid' ? 'octagon' : 'rect',
    x: centerX,
    y: centerY,
    width: mainPlazaSize,
    height: options.preset === 'imperial-grid' ? mainPlazaSize : mainPlazaSize * 0.78,
    fillColor: cityPalette.plazaFill,
    borderColor: cityPalette.streetBorder,
    centerpiece:
      options.preset === 'imperial-grid'
        ? 'obelisk'
        : options.preset === 'harbor-canals'
          ? 'market-stalls'
          : 'fountain'
  });
  virtualDoc.manifest.objects.push(mainPlaza);

  if (options.waterfront === 'harbor') {
    const quayPlaza = createPlazaObject({
      layerId: layerVec,
      shape: 'rect',
      x: centerX - coreRadiusX * 0.16,
      y: docH * 0.63,
      width: mainPlazaSize * 1.15,
      height: mainPlazaSize * 0.56,
      fillColor: cityPalette.plazaFill,
      borderColor: cityPalette.streetBorder,
      centerpiece: 'market-stalls'
    });
    virtualDoc.manifest.objects.push(quayPlaza);
  }

  // 2. Canal branches in harbor mode
  if (options.waterfront === 'harbor') {
    const canalLeft = createPathObject({
      layerId: layerVec,
      kind: 'canal',
      points: [
        docW * 0.32,
        docH * 0.24,
        docW * 0.34,
        docH * 0.48,
        docW * 0.39,
        docH * 0.72
      ],
      strokeWidthDoc: 16,
      color: cityPalette.canalWater,
      theme: activeTheme,
      smooth: true
    });
    const canalRight = createPathObject({
      layerId: layerVec,
      kind: 'canal',
      points: [
        docW * 0.67,
        docH * 0.26,
        docW * 0.65,
        docH * 0.5,
        docW * 0.61,
        docH * 0.72
      ],
      strokeWidthDoc: 16,
      color: cityPalette.canalWater,
      theme: activeTheme,
      smooth: true
    });
    virtualDoc.manifest.objects.push(canalLeft, canalRight);
  }

  // 3. Road Network tailored to preset
  const gridRect = {
    x: centerX - coreRadiusX,
    y: centerY - coreRadiusY,
    width: coreRadiusX * 2,
    height: coreRadiusY * 2
  };
  const gridStyle =
    options.preset === 'imperial-grid'
      ? 'orthogonal'
      : options.preset === 'medieval-town'
        ? 'radial'
        : 'organic';

  const gridPaths = generateStreetGridInRect(virtualDoc, gridRect, {
    style: gridStyle,
    spacingDoc: options.preset === 'imperial-grid' ? 96 : 108,
    angleDeg: options.preset === 'imperial-grid' ? 0 : Math.round((rng() - 0.5) * 18),
    autoFillBuildings: false,
    districtPreset: 'residential',
    density: densityFactor,
    buildingScale: 1,
    irregularity: 0.35,
    ...(renderStyleOverride ? { renderStyle: renderStyleOverride } : {}),
    vectorLayerId: layerVec,
    buildingsLayerId: layerBldg,
    seed
  });
  virtualDoc.manifest.objects.push(...gridPaths);

  // Add outward arterial highways extending beyond the urban core so walls auto-spawn gatehouses cleanly
  const highwayAngles =
    options.preset === 'imperial-grid'
      ? [0, 90, 180, 270]
      : [20, 145, 215, 330];
  for (const deg of highwayAngles) {
    if (options.waterfront === 'harbor' && deg > 35 && deg < 145) continue;
    const rad = (deg * Math.PI) / 180;
    const r0 = mainPlazaSize * 0.45;
    const r1 = Math.min(docW, docH) * 0.47;
    const midBend = options.preset === 'imperial-grid' ? 0 : (rng() - 0.5) * 28;
    const px0 = clampNumber(centerX + Math.cos(rad) * r0, 16, docW - 16);
    const py0 = clampNumber(centerY + Math.sin(rad) * r0, 16, docH - 16);
    const pxMid = clampNumber(
      centerX + Math.cos(rad) * (r0 + r1) * 0.5 - Math.sin(rad) * midBend,
      16,
      docW - 16
    );
    const pyMid = clampNumber(
      centerY + Math.sin(rad) * (r0 + r1) * 0.5 + Math.cos(rad) * midBend,
      16,
      docH - 16
    );
    const px1 = clampNumber(centerX + Math.cos(rad) * r1, 16, docW - 16);
    const py1 = clampNumber(centerY + Math.sin(rad) * r1, 16, docH - 16);
    virtualDoc.manifest.objects.push(
      createPathObject({
        layerId: layerVec,
        kind: 'avenue',
        points: [px0, py0, pxMid, pyMid, px1, py1],
        strokeWidthDoc: 15,
        color: cityPalette.streetFill,
        theme: activeTheme,
        smooth: options.preset !== 'imperial-grid'
      })
    );
  }

  // 4. Optional Fortified Perimeter Wall with Automatic Bastions & Gatehouses
  if (options.hasWalls) {
    const wallVertices: number[] = [];
    const wallSides = options.preset === 'imperial-grid' ? 4 : 9;
    const startAngle = options.preset === 'imperial-grid' ? Math.PI * 0.25 : 0;
    const wallRx = coreRadiusX * 0.94;
    const wallRy = coreRadiusY * 0.92;
    const isHarbor = options.waterfront === 'harbor';
    const count = isHarbor ? wallSides - 1 : wallSides + 1;

    for (let i = 0; i < count; i += 1) {
      const idx = isHarbor ? i : i % wallSides;
      const theta = isHarbor
        ? Math.PI * 0.22 - (Math.PI * 1.44 * idx) / (wallSides - 2)
        : startAngle + (Math.PI * 2 * idx) / wallSides;
      const jitterR = options.preset === 'imperial-grid' ? 1 : 0.93 + rng() * 0.12;
      wallVertices.push(
        clampNumber(centerX + Math.cos(theta) * wallRx * jitterR, 28, docW - 28),
        clampNumber(centerY + Math.sin(theta) * wallRy * jitterR, 28, docH - 28)
      );
    }

    const wallObjects = buildSmartCityWallObjects(virtualDoc, wallVertices, {
      strokeWidthDoc: 13,
      towerSpacingDoc: 108,
      autoTowers: true,
      autoGates: true,
      vectorLayerId: layerVec,
      buildingsLayerId: layerBldg,
      ...(renderStyleOverride ? { renderStyle: renderStyleOverride } : {})
    });
    virtualDoc.manifest.objects.push(...wallObjects);
  }

  // 5. Landmark Buildings (Cathedral / Citadel Courtyard & Covered Market)
  const landmarkOffsets = [
    {
      dx: -mainPlazaSize * 0.92,
      dy: -mainPlazaSize * 0.25,
      shape: 'cathedral' as const,
      w: 62,
      h: 40,
      rot: 0
    },
    {
      dx: mainPlazaSize * 0.95,
      dy: 0,
      shape: 'market' as const,
      w: 52,
      h: 32,
      rot: 90
    },
    {
      dx: 0,
      dy: -mainPlazaSize * 0.92,
      shape: 'courtyard' as const,
      w: 58,
      h: 48,
      rot: 0
    }
  ];

  for (let i = 0; i < landmarkOffsets.length; i += 1) {
    const lm = landmarkOffsets[i];
    virtualDoc.manifest.objects.push(
      createBuildingObject({
        layerId: layerBldg,
        shape: lm.shape,
        x: centerX + lm.dx,
        y: centerY + lm.dy,
        width: lm.w,
        height: lm.h,
        rotationDeg: lm.rot,
        roofColor: pickDeterministicRoofColor(activeTheme, i),
        wallColor: cityPalette.wallStone,
        ...(renderStyleOverride ? { renderStyle: renderStyleOverride } : {}),
        districtTag: 'landmark'
      })
    );
  }

  // 6. Populate Urban Core & Outskirts with Street-Aligned District Strokes
  const strokePts: Array<{ x: number; y: number }> = [];
  const stepY = 74;
  for (let y = centerY - coreRadiusY * 0.85; y <= centerY + coreRadiusY * 0.85; y += stepY) {
    const x0 = centerX - coreRadiusX * 0.85;
    const x1 = centerX + coreRadiusX * 0.85;
    for (let s = 0; s <= 4; s += 1) {
      const px = x0 + ((x1 - x0) * s) / 4;
      // Keep buildings focused inside elliptical core
      const normDist = Math.hypot((px - centerX) / (coreRadiusX * 0.92), (y - centerY) / (coreRadiusY * 0.92));
      if (normDist <= 1.02) {
        strokePts.push({ x: px, y });
      }
    }
  }

  const districtPreset =
    options.waterfront === 'harbor'
      ? 'harbor-docks'
      : options.preset === 'imperial-grid'
        ? 'residential'
        : 'dense-slums';

  const buildings = generateDistrictBuildingsAlongStroke(virtualDoc, strokePts, {
    diameterDoc: 112,
    density: densityFactor,
    buildingScale: options.preset === 'medieval-town' ? 0.92 : 1.0,
    irregularity: options.preset === 'imperial-grid' ? 0.12 : 0.36,
    preset: districtPreset,
    ...(renderStyleOverride ? { renderStyle: renderStyleOverride } : {}),
    layerId: layerBldg,
    seed: seed + 77
  });
  virtualDoc.manifest.objects.push(...buildings);

  // 7. Cartographic City Labels in Italian
  const labelColor = getDefaultLabelColor(activeTheme);
  const titleFont = activeTheme.fonts.defaultFontId;
  const subFont = activeTheme.fonts.presets['spectral-italic']
    ? 'spectral-italic'
    : titleFont;

  const labels: Array<{ text: string; x: number; y: number; scale: number; italic?: boolean }> = [
    {
      text: options.preset === 'imperial-grid' ? 'Foro Imperiale' : 'Piazza del Mercato',
      x: centerX - 58,
      y: centerY + mainPlazaSize * 0.5 + 8,
      scale: 0.95
    },
    {
      text: 'Cattedrale',
      x: centerX - mainPlazaSize * 0.95 - 32,
      y: centerY - mainPlazaSize * 0.25 + 24,
      scale: 0.82
    },
    {
      text: options.preset === 'imperial-grid' ? 'Quartiere dei Patrizi' : 'Borgo Vecchio',
      x: centerX - coreRadiusX * 0.52,
      y: centerY - coreRadiusY * 0.56,
      scale: 0.86
    },
    {
      text:
        options.waterfront === 'harbor'
          ? 'Darsena del Porto'
          : options.waterfront === 'river'
            ? 'Riva del Fiume'
            : 'Quartiere degli Artigiani',
      x: centerX + coreRadiusX * 0.12,
      y: options.waterfront === 'none' ? centerY + coreRadiusY * 0.45 : docH * 0.72,
      scale: 0.88,
      italic: options.waterfront !== 'none'
    }
  ];

  for (const item of labels) {
    virtualDoc.manifest.objects.push(
      createLabelObject(
        item.text,
        clampNumber(item.x, 24, docW - 140),
        clampNumber(item.y, 20, docH - 42),
        activeTheme,
        undefined,
        {
          layerId: layerLabels,
          fontId: item.italic ? subFont : titleFont,
          scale: item.scale,
          color: labelColor
        }
      )
    );
  }

  return {
    terrain,
    objects: virtualDoc.manifest.objects,
    theme: activeTheme
  };
}
