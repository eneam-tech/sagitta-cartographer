import { DirtyRectPx, TerrainPatchCommand } from '../model/commands';
import { MapDocument } from '../model/document';

export type TerrainBrushTool =
  | 'land'
  | 'water'
  | 'raise'
  | 'lower'
  | 'forest'
  | 'fields'
  | 'natural';

export type BiomeKind = 'sea' | 'beach' | 'plain' | 'hill' | 'mountain';

export interface BrushStrokeParams {
  tool: TerrainBrushTool;
  diameterDoc: number;
  intensity: number; // 0.05..1.0
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
