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
  version: 1,
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
    labelHalo: '#E8D8AF'
  },
  coast: {
    strokeWidthDoc: 3.2,
    bathymetryOffsetDoc: 16
  },
  elevation: DEFAULT_ELEVATION_THRESHOLDS,
  fonts: DEFAULT_THEME_FONTS
};

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

export function getFontSpec(theme: MapTheme, fontId: string): FontStyleSpec {
  return (
    theme.fonts.presets[fontId] ??
    theme.fonts.presets[theme.fonts.defaultFontId] ??
    DEFAULT_THEME_FONTS.presets['spectral-semibold']
  );
}
