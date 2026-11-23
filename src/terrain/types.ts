import { DirtyRectPx, TerrainPatchCommand } from '../model/commands';
import { MapDocument } from '../model/document';

export type TerrainBrushTool =
  | 'land'
  | 'water'
  | 'raise'
  | 'plateau'
  | 'lower'
  | 'flatten'
  | 'smooth'
  | 'natural'
  | 'forest'
  | 'fields'
  | 'sand'
  | 'brick'
  | 'snow'
  | 'swamp'
  | 'rock'
  | 'meadow'
  | 'lava';

export type BiomeKind = 'sea' | 'beach' | 'plain' | 'hill' | 'mountain';
export type BrushShapeMode = 'smart' | 'classic';

export interface BrushStrokeParams {
  tool: TerrainBrushTool;
  diameterDoc: number;
  intensity: number; // 0.05..1.0
  targetHeight?: number; // 0..255 optional target elevation for 'flatten' and 'plateau'
  brushMode?: BrushShapeMode;
  roughness?: number; // 0..1 organic coastline / edge roughness
}

export interface StrokeCommitResult {
  command: TerrainPatchCommand;
  dirtyRect: DirtyRectPx;
}

export interface ITerrainStrokeSession {
  beginStroke(doc: MapDocument, params: BrushStrokeParams, startDocX: number, startDocY: number): DirtyRectPx | null;
  addPoint(doc: MapDocument, docX: number, docY: number): DirtyRectPx | null;
  commit(doc: MapDocument): StrokeCommitResult | null;
  cancel(doc: MapDocument): DirtyRectPx | null;
  isActive(): boolean;
}

export interface ITerrainRenderer {
  renderFull(doc: MapDocument): void;
  renderRegion(doc: MapDocument, dirtyRect: DirtyRectPx): void;
  getCanvas(): HTMLCanvasElement | null;
  getPixelData(): { width: number; height: number; rgba: Uint8ClampedArray };
  dispose(): void;
}
