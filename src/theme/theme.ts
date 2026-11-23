import { ptToDocUnits } from '../model/coordinates';

export type ThemeMode = 'reactive' | 'flat';

export interface ThemeColors {
  sea: string;
  seaShallow: string;
  seaBathymetry: string;
  beach: string;
  land: string;
  hill: string;
  mountain: string;
  mountainCrest: string;
  ink: string;
  forest: string;
  forestShadow: string;
  fields: string;
  fieldsFurrow: string;
  stone: string;
  settlement: string;
  labelHalo: string;
  sand: string;
  sandShadow: string;
  brick: string;
  brickMortar: string;
  snow: string;
  snowShadow: string;
  swamp: string;
  swampWater: string;
  rock: string;
  rockShadow: string;
  meadow: string;
  meadowAccent: string;
  lava: string;
  lavaGlow: string;
  pathRiver: string;
  pathRoad: string;
  pathBorder: string;
}

export interface ElevationThresholds {
  beachMaxHeight: number;
  beachMaxCoastDistDoc: number;
  plainMaxHeight: number;
  hillMaxHeight: number;
  mountainMaxHeight: number;
  blendWidth: number;
}

export interface FontStyleSpec {
  id: string;
  label: string;
  family: string;
  weight: 400 | 600;
  italic: boolean;
  defaultSizeDoc: number;
}

export interface MapTheme {
  id: string;
  version: number;
  name: string;
  mode: ThemeMode;
  colors: ThemeColors;
  coast: {
    strokeWidthDoc: number;
    bathymetryOffsetDoc: number;
  };
  elevation: ElevationThresholds;
  fonts: {
    defaultFontId: string;
    presets: Record<string, FontStyleSpec>;
  };
}

export const DEFAULT_ELEVATION_THRESHOLDS: ElevationThresholds = {
  beachMaxHeight: 31,
  beachMaxCoastDistDoc: 12,
  plainMaxHeight: 111,
  hillMaxHeight: 191,
  mountainMaxHeight: 255,
  blendWidth: 10
};

export const DEFAULT_THEME_FONTS: MapTheme['fonts'] = {
  defaultFontId: 'spectral-semibold',
  presets: {
    'spectral-semibold': {
      id: 'spectral-semibold',
      label: 'Titolo / Città (Spectral SemiBold)',
      family: '"Spectral", Georgia, serif',
      weight: 600,
      italic: false,
      defaultSizeDoc: Number(ptToDocUnits(11).toFixed(2))
    },
    'spectral-regular': {
      id: 'spectral-regular',
      label: 'Testo carta (Spectral Regular)',
      family: '"Spectral", Georgia, serif',
      weight: 400,
      italic: false,
      defaultSizeDoc: Number(ptToDocUnits(11).toFixed(2))
    },
    'spectral-italic': {
      id: 'spectral-italic',
      label: 'Mare / Regione (Spectral Corsivo)',
      family: '"Spectral", Georgia, serif',
      weight: 400,
      italic: true,
      defaultSizeDoc: Number(ptToDocUnits(10).toFixed(2))
    }
  }
};

export const LABEL_ROLE_PRESETS = [
  { id: 'title', label: 'Titolo (16 pt)', fontId: 'spectral-semibold', fontSizeDoc: Number(ptToDocUnits(16).toFixed(2)) },
  { id: 'city', label: 'Città (11 pt)', fontId: 'spectral-semibold', fontSizeDoc: Number(ptToDocUnits(11).toFixed(2)) },
  { id: 'sea', label: 'Mare (10 pt corsivo)', fontId: 'spectral-italic', fontSizeDoc: Number(ptToDocUnits(10).toFixed(2)) }
] as const;

export const DEFAULT_THEME: MapTheme = {
  id: 'base',
  version: 2,
  name: 'Carta di stracci classica',
  mode: 'reactive',
  colors: {
    sea: '#A8C8C6',
    seaShallow: '#B8D4D2',
    seaBathymetry: '#7BA1A1',
    beach: '#EFE4C8',
    land: '#E8D8AF',
    hill: '#D9C598',
    mountain: '#B9B1AA',
    mountainCrest: '#EFE8DB',
    ink: '#263C40',
    forest: '#486953',
    forestShadow: '#334E3D',
    fields: '#D6C682',
    fieldsFurrow: '#9F8E52',
    stone: '#7B7880',
    settlement: '#8B493D',
    labelHalo: '#E8D8AF',
    sand: '#E4C97A',
    sandShadow: '#B8984C',
    brick: '#B86B58',
    brickMortar: '#7C4438',
    snow: '#F4F7F8',
    snowShadow: '#C5D5DD',
    swamp: '#6B7E5E',
    swampWater: '#4D6B68',
    rock: '#8C8986',
    rockShadow: '#5D5B59',
    meadow: '#A8B97E',
    meadowAccent: '#7F9A58',
    lava: '#C94A28',
    lavaGlow: '#F4A236',
    pathRiver: '#5E95A0',
    pathRoad: '#7D5C43',
    pathBorder: '#8E3B35'
  },
  coast: {
    strokeWidthDoc: 3.2,
    bathymetryOffsetDoc: 16
  },
  elevation: DEFAULT_ELEVATION_THRESHOLDS,
  fonts: DEFAULT_THEME_FONTS
};

export const WITCHER_THEME: MapTheme = {
  id: 'regni-del-nord',
  version: 2,
  name: 'Regni del Nord',
  mode: 'reactive',
  colors: {
    sea: '#5B898C',
    seaShallow: '#82B1AA',
    seaBathymetry: '#3D6469',
    beach: '#C7A96D',
    land: '#A68348',
    hill: '#846233',
    mountain: '#5A4125',
    mountainCrest: '#EADAB2',
    ink: '#21150C',
    forest: '#4A5428',
    forestShadow: '#272D14',
    fields: '#C6A95C',
    fieldsFurrow: '#806831',
    stone: '#3D2B1C',
    settlement: '#9E3224',
    labelHalo: '#1C120A',
    sand: '#D9BC76',
    sandShadow: '#A68846',
    brick: '#9E4B38',
    brickMortar: '#5E2B20',
    snow: '#ECE6D6',
    snowShadow: '#A9B2B2',
    swamp: '#4B5B44',
    swampWater: '#2F4E4E',
    rock: '#6C5D4F',
    rockShadow: '#3D3228',
    meadow: '#8A8946',
    meadowAccent: '#5B6329',
    lava: '#C8421E',
    lavaGlow: '#F5A536',
    pathRiver: '#6FA19F',
    pathRoad: '#E5D4B3',
    pathBorder: '#9A2E24'
  },
  coast: {
    strokeWidthDoc: 3.4,
    bathymetryOffsetDoc: 18
  },
  elevation: DEFAULT_ELEVATION_THRESHOLDS,
  fonts: DEFAULT_THEME_FONTS
};

export const NORDICA_THEME: MapTheme = {
  id: 'nordica',
  version: 2,
  name: 'Atlante boreale',
  mode: 'reactive',
  colors: {
    sea: '#85A3B3',
    seaShallow: '#9BB7C4',
    seaBathymetry: '#5F7E91',
    beach: '#DFE7E9',
    land: '#E6ECEE',
    hill: '#CBD6DB',
    mountain: '#98A4AE',
    mountainCrest: '#F7FAFB',
    ink: '#1C2B36',
    forest: '#325249',
    forestShadow: '#203832',
    fields: '#BFC499',
    fieldsFurrow: '#8A8F67',
    stone: '#6D7A84',
    settlement: '#7D4B46',
    labelHalo: '#E6ECEE',
    sand: '#DCDAC8',
    sandShadow: '#B5B29B',
    brick: '#9E625B',
    brickMortar: '#69403B',
    snow: '#F6FAFC',
    snowShadow: '#BFD2DF',
    swamp: '#5B6F68',
    swampWater: '#405B63',
    rock: '#7B8790',
    rockShadow: '#505B63',
    meadow: '#8EA88E',
    meadowAccent: '#68836B',
    lava: '#BF4A30',
    lavaGlow: '#F29F3D',
    pathRiver: '#4F84A3',
    pathRoad: '#6B5C50',
    pathBorder: '#8C3F45'
  },
  coast: {
    strokeWidthDoc: 3.2,
    bathymetryOffsetDoc: 16
  },
  elevation: DEFAULT_ELEVATION_THRESHOLDS,
  fonts: DEFAULT_THEME_FONTS
};

export const PERGAMENA_THEME: MapTheme = {
  id: 'pergamena',
  version: 2,
  name: 'Pergamena d’archivio',
  mode: 'reactive',
  colors: {
    sea: '#B5BDB0',
    seaShallow: '#C4CBBF',
    seaBathymetry: '#8D998C',
    beach: '#F3E8CE',
    land: '#EEDFBA',
    hill: '#DEC89C',
    mountain: '#BCAA92',
    mountainCrest: '#F6EEDF',
    ink: '#3A281E',
    forest: '#5A6D49',
    forestShadow: '#3F4F32',
    fields: '#DEC97F',
    fieldsFurrow: '#A68E49',
    stone: '#85776C',
    settlement: '#964935',
    labelHalo: '#EEDFBA',
    sand: '#EFE0AC',
    sandShadow: '#CBB679',
    brick: '#B0654A',
    brickMortar: '#75402E',
    snow: '#F5F0E6',
    snowShadow: '#D1C7B6',
    swamp: '#767E56',
    swampWater: '#5C6C5D',
    rock: '#8D8175',
    rockShadow: '#5F554B',
    meadow: '#B5BC7C',
    meadowAccent: '#8D9853',
    lava: '#C74F28',
    lavaGlow: '#F0A43A',
    pathRiver: '#698D8E',
    pathRoad: '#7C5338',
    pathBorder: '#9A3828'
  },
  coast: {
    strokeWidthDoc: 3.4,
    bathymetryOffsetDoc: 18
  },
  elevation: DEFAULT_ELEVATION_THRESHOLDS,
  fonts: DEFAULT_THEME_FONTS
};

export const VULCANICA_THEME: MapTheme = {
  id: 'vulcanica',
  version: 2,
  name: 'Terra d’ossidiana',
  mode: 'reactive',
  colors: {
    sea: '#667E8A',
    seaShallow: '#79929E',
    seaBathymetry: '#445C68',
    beach: '#C7BCB0',
    land: '#BCB1A4',
    hill: '#A19589',
    mountain: '#7A716B',
    mountainCrest: '#E6DDD0',
    ink: '#1F1B1A',
    forest: '#455E4B',
    forestShadow: '#2C4032',
    fields: '#BDA875',
    fieldsFurrow: '#877548',
    stone: '#6E6966',
    settlement: '#914635',
    labelHalo: '#D4CAC0',
    sand: '#CFC0A1',
    sandShadow: '#A39273',
    brick: '#A35847',
    brickMortar: '#6B362B',
    snow: '#E9ECEE',
    snowShadow: '#B4BCC2',
    swamp: '#5F6956',
    swampWater: '#465858',
    rock: '#78726E',
    rockShadow: '#4D4845',
    meadow: '#8F9C72',
    meadowAccent: '#69784E',
    lava: '#D44820',
    lavaGlow: '#FFA733',
    pathRiver: '#527E91',
    pathRoad: '#6B5242',
    pathBorder: '#A3392E'
  },
  coast: {
    strokeWidthDoc: 3.4,
    bathymetryOffsetDoc: 16
  },
  elevation: DEFAULT_ELEVATION_THRESHOLDS,
  fonts: DEFAULT_THEME_FONTS
};

export const MAP_THEMES: readonly MapTheme[] = [
  DEFAULT_THEME,
  WITCHER_THEME,
  NORDICA_THEME,
  PERGAMENA_THEME,
  VULCANICA_THEME
] as const;

export const V1_FLAT_THEME: MapTheme = {
  ...DEFAULT_THEME,
  id: 'v1-flat',
  version: 1,
  name: 'Tema v1 piatto preservato',
  mode: 'flat'
};

export function cloneTheme(theme: MapTheme): MapTheme {
  return JSON.parse(JSON.stringify(theme)) as MapTheme;
}

export function getBuiltinThemeById(id: string): MapTheme | undefined {
  if (id === V1_FLAT_THEME.id) return V1_FLAT_THEME;
  return MAP_THEMES.find((t) => t.id === id);
}

/**
 * Fills any v2/v3 missing color/font/threshold fields on an imported theme using
 * matching built-in theme values or DEFAULT_THEME defaults.
 */
export function normalizeTheme(raw: unknown): MapTheme {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Tema non valido.');
  }
  const t = raw as Partial<MapTheme>;
  const fallback = getBuiltinThemeById(typeof t.id === 'string' ? t.id : '') ?? DEFAULT_THEME;
  return cloneTheme({
    id: typeof t.id === 'string' && t.id.trim() ? t.id : fallback.id,
    version: typeof t.version === 'number' && Number.isInteger(t.version) && t.version >= 1 ? t.version : fallback.version,
    name: typeof t.name === 'string' && t.name.trim() ? t.name : fallback.name,
    mode: t.mode === 'flat' ? 'flat' : 'reactive',
    colors: {
      ...DEFAULT_THEME.colors,
      ...fallback.colors,
      ...(t.colors ?? {})
    },
    coast: {
      ...DEFAULT_THEME.coast,
      ...fallback.coast,
      ...(t.coast ?? {})
    },
    elevation: {
      ...DEFAULT_THEME.elevation,
      ...fallback.elevation,
      ...(t.elevation ?? {})
    },
    fonts: {
      defaultFontId: t.fonts?.defaultFontId ?? fallback.fonts.defaultFontId,
      presets: {
        ...DEFAULT_THEME_FONTS.presets,
        ...(t.fonts?.presets ?? {})
      }
    }
  });
}

export function getFontSpec(theme: MapTheme, fontId: string): FontStyleSpec {
  return (
    theme.fonts.presets[fontId] ??
    theme.fonts.presets[theme.fonts.defaultFontId] ??
    DEFAULT_THEME_FONTS.presets['spectral-semibold']
  );
}

function hexLuminance(hex: string): number {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return 1;
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Picks crisp ivory text when the theme's label halo is dark (e.g. Witcher 3 style),
 * otherwise uses theme ink.
 */
export function getDefaultLabelColor(theme: MapTheme): string {
  return hexLuminance(theme.colors.labelHalo) < 0.35 ? '#F5EAD0' : theme.colors.ink;
}
