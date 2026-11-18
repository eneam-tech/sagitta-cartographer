import { MapDocument, safeRandomUUID } from './document';
import { MapTheme, cloneTheme } from '../theme/theme';

export interface DirtyRectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TerrainTilePatch {
  x: number;
  y: number;
  width: number;
  height: number;
  beforeMask: Uint8Array;
  afterMask: Uint8Array;
  beforeHeight: Uint8Array;
  afterHeight: Uint8Array;
  beforeCover: Uint8Array;
  afterCover: Uint8Array;
}

export interface HistoryCommand {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly byteSize: number;
  readonly affectsTerrain: boolean;
  readonly dirtyRect?: DirtyRectPx;
  apply(doc: MapDocument): void;
  revert(doc: MapDocument): void;
}

function writeTileSlices(
  doc: MapDocument,
  patches: TerrainTilePatch[],
  useAfter: boolean
): void {
  const { widthPx, mask, height, cover } = doc.terrain;
  for (const p of patches) {
    const srcM = useAfter ? p.afterMask : p.beforeMask;
    const srcH = useAfter ? p.afterHeight : p.beforeHeight;
    const srcC = useAfter ? p.afterCover : p.beforeCover;
    for (let row = 0; row < p.height; row += 1) {
      const dstStart = (p.y + row) * widthPx + p.x;
      const srcStart = row * p.width;
      mask.set(srcM.subarray(srcStart, srcStart + p.width), dstStart);
      height.set(srcH.subarray(srcStart, srcStart + p.width), dstStart);
      cover.set(srcC.subarray(srcStart, srcStart + p.width), dstStart);
    }
  }
}

export function computePatchesByteSize(patches: TerrainTilePatch[]): number {
  let bytes = 0;
  for (const p of patches) {
    bytes +=
      p.beforeMask.byteLength +
      p.afterMask.byteLength +
      p.beforeHeight.byteLength +
      p.afterHeight.byteLength +
      p.beforeCover.byteLength +
      p.afterCover.byteLength;
  }
  return bytes;
}

export class TerrainPatchCommand implements HistoryCommand {
  readonly id: string;
  readonly kind = 'terrain-patch';
  readonly label: string;
  readonly byteSize: number;
  readonly affectsTerrain = true;
  readonly dirtyRect: DirtyRectPx;
  private readonly patches: TerrainTilePatch[];

  constructor(label: string, dirtyRect: DirtyRectPx, patches: TerrainTilePatch[]) {
    this.id = safeRandomUUID();
    this.label = label;
    this.dirtyRect = dirtyRect;
    this.patches = patches;
    this.byteSize = computePatchesByteSize(patches);
  }

  apply(doc: MapDocument): void {
    writeTileSlices(doc, this.patches, true);
  }

  revert(doc: MapDocument): void {
    writeTileSlices(doc, this.patches, false);
  }
}

export class SetTitleCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'set-title';
  readonly label = 'Rinomina carta';
  readonly byteSize = 128;
  readonly affectsTerrain = false;

  constructor(private readonly prevTitle: string, private readonly nextTitle: string) {}

  apply(doc: MapDocument): void {
    doc.manifest.title = this.nextTitle;
  }

  revert(doc: MapDocument): void {
    doc.manifest.title = this.prevTitle;
  }
}

export class SetThemeCommand implements HistoryCommand {
  readonly id = safeRandomUUID();
  readonly kind = 'set-theme';
  readonly label = 'Cambia tema della carta';
  readonly byteSize = 4096;
  readonly affectsTerrain = true;
  readonly dirtyRect?: DirtyRectPx;
  private readonly prevTheme: MapTheme;
  private readonly nextTheme: MapTheme;

  constructor(prevTheme: MapTheme, nextTheme: MapTheme, doc?: MapDocument) {
    this.prevTheme = cloneTheme(prevTheme);
    this.nextTheme = cloneTheme(nextTheme);
    if (doc) {
      this.dirtyRect = {
        x: 0,
        y: 0,
        width: doc.terrain.widthPx,
        height: doc.terrain.heightPx
      };
    }
  }

  apply(doc: MapDocument): void {
    doc.theme = cloneTheme(this.nextTheme);
    doc.manifest.theme = {
      id: this.nextTheme.id,
      version: this.nextTheme.version,
      file: 'theme/theme.json'
    };
  }

  revert(doc: MapDocument): void {
    doc.theme = cloneTheme(this.prevTheme);
    doc.manifest.theme = {
      id: this.prevTheme.id,
      version: this.prevTheme.version,
      file: 'theme/theme.json'
    };
  }
}
