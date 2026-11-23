import { DirtyRectPx, TerrainPatchCommand, TerrainTilePatch } from '../model/commands';
import {
  clampNumber,
  docDistToMaskPxX,
  docDistToMaskPxY,
  docToMaskX,
  docToMaskY
} from '../model/coordinates';
import {
  COVER_BRICK,
  COVER_FIELDS,
  COVER_FOREST,
  COVER_LAVA,
  COVER_MEADOW,
  COVER_NATURAL,
  COVER_ROCK,
  COVER_SAND,
  COVER_SNOW,
  COVER_SWAMP,
  CoverCode,
  MapDocument
} from '../model/document';
import { LAND_MASK_THRESHOLD, smoothstepRange } from './classifier';
import { fbm2D, ridgedFbm2D, ridgedNoise2D, valueNoise2D, warpedFbm2D } from './noise';
import {
  BrushShapeMode,
  BrushStrokeParams,
  ITerrainStrokeSession,
  StrokeCommitResult,
  TerrainBrushTool
} from './types';

export const BRUSH_TILE_SIZE_PX = 128;
const BASE_ELEVATION_STEP = 16;
const SMOOTH_KERNEL = [1, 2, 1, 2, 4, 2, 1, 2, 1] as const;

function isElevationTool(tool: TerrainBrushTool): boolean {
  return (
    tool === 'raise' ||
    tool === 'plateau' ||
    tool === 'lower' ||
    tool === 'flatten' ||
    tool === 'smooth'
  );
}

function toolToCoverCode(tool: TerrainBrushTool): CoverCode | null {
  switch (tool) {
    case 'natural':
      return COVER_NATURAL;
    case 'forest':
      return COVER_FOREST;
    case 'fields':
      return COVER_FIELDS;
    case 'sand':
      return COVER_SAND;
    case 'brick':
      return COVER_BRICK;
    case 'snow':
      return COVER_SNOW;
    case 'swamp':
      return COVER_SWAMP;
    case 'rock':
      return COVER_ROCK;
    case 'meadow':
      return COVER_MEADOW;
    case 'lava':
      return COVER_LAVA;
    default:
      return null;
  }
}

interface CapturedTile {
  key: number;
  tx: number;
  ty: number;
  x: number;
  y: number;
  width: number;
  height: number;
  beforeMask: Uint8Array;
  beforeHeight: Uint8Array;
  beforeCover: Uint8Array;
  workHeight: Float32Array | null;
}

function getToolLabel(tool: TerrainBrushTool): string {
  switch (tool) {
    case 'land':
      return 'Pennello terra';
    case 'water':
      return 'Pennello acqua';
    case 'raise':
      return 'Alza picchi';
    case 'plateau':
      return 'Altopiano';
    case 'lower':
      return 'Abbassa rilievo';
    case 'flatten':
      return 'Appiattisci rilievo';
    case 'smooth':
      return 'Ammorbidisci rilievo';
    case 'forest':
      return 'Copertura foresta';
    case 'fields':
      return 'Copertura campi';
    case 'sand':
      return 'Copertura sabbia';
    case 'brick':
      return 'Copertura mattoni';
    case 'snow':
      return 'Copertura neve';
    case 'swamp':
      return 'Copertura palude';
    case 'rock':
      return 'Copertura roccia';
    case 'meadow':
      return 'Copertura prateria';
    case 'lava':
      return 'Copertura lava';
    case 'natural':
      return 'Rimuovi copertura';
  }
}

function unionDirtyRects(a: DirtyRectPx | null, b: DirtyRectPx | null): DirtyRectPx | null {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Interactive terrain brush stroke session with lazy 128x128 px tile snapshots,
 * arc-length interpolated stamping in document units, strict page clipping,
 * and byte-diff minimal TerrainPatchCommand creation.
 */
export class TerrainStrokeSession implements ITerrainStrokeSession {
  private active = false;
  private tool: TerrainBrushTool = 'land';
  private brushMode: BrushShapeMode = 'classic';
  private roughness = 0.65;
  private radiusDoc = 20;
  private intensity = 1;
  private stepDoc = 4;
  private lastDocX = 0;
  private lastDocY = 0;
  private distSinceLastStamp = 0;
  private flattenTargetHeight = 0;
  private plateauTargetHeight = 185;
  private smoothSnapshot = new Float32Array(0);
  private capturedTiles = new Map<number, CapturedTile>();

  isActive(): boolean {
    return this.active;
  }

  getCapturedTileCount(): number {
    return this.capturedTiles.size;
  }

  beginStroke(
    doc: MapDocument,
    params: BrushStrokeParams,
    startDocX: number,
    startDocY: number
  ): DirtyRectPx | null {
    this.reset();

    const diameterDoc = Number.isFinite(params.diameterDoc) ? Math.max(1, params.diameterDoc) : 40;
    this.tool = params.tool;
    this.brushMode = params.brushMode === 'smart' ? 'smart' : 'classic';
    this.roughness = clampNumber(
      params.roughness !== undefined && Number.isFinite(params.roughness) ? params.roughness : 0.65,
      0,
      1
    );
    this.radiusDoc = diameterDoc * 0.5;
    this.intensity = clampNumber(Number.isFinite(params.intensity) ? params.intensity : 1, 0.05, 1.0);
    this.stepDoc = Math.max(1.5, this.radiusDoc * 0.2);
    this.lastDocX = startDocX;
    this.lastDocY = startDocY;
    this.distSinceLastStamp = 0;
    this.active = true;

    if (this.tool === 'flatten') {
      this.flattenTargetHeight =
        params.targetHeight !== undefined && Number.isFinite(params.targetHeight)
          ? clampNumber(params.targetHeight, 0, 255)
          : this.sampleTargetHeightAtStart(doc, startDocX, startDocY);
    } else if (this.tool === 'plateau') {
      this.plateauTargetHeight =
        params.targetHeight !== undefined && Number.isFinite(params.targetHeight)
          ? clampNumber(params.targetHeight, 20, 255)
          : 185;
    }

    return this.stampAt(doc, startDocX, startDocY);
  }

  addPoint(doc: MapDocument, docX: number, docY: number): DirtyRectPx | null {
    if (!this.active) return null;

    const dx = docX - this.lastDocX;
    const dy = docY - this.lastDocY;
    const segLen = Math.hypot(dx, dy);
    if (segLen <= 1e-6) return null;

    const ux = dx / segLen;
    const uy = dy / segLen;
    let d = this.stepDoc - this.distSinceLastStamp;
    let stampedAny = false;
    let dirty: DirtyRectPx | null = null;

    while (d <= segLen) {
      const sx = this.lastDocX + ux * d;
      const sy = this.lastDocY + uy * d;
      const stampDirty = this.stampAt(doc, sx, sy);
      dirty = unionDirtyRects(dirty, stampDirty);
      stampedAny = true;
      d += this.stepDoc;
    }

    if (stampedAny) {
      this.distSinceLastStamp = segLen - (d - this.stepDoc);
    } else {
      this.distSinceLastStamp += segLen;
    }

    this.lastDocX = docX;
    this.lastDocY = docY;
    return dirty;
  }

  commit(doc: MapDocument): StrokeCommitResult | null {
    if (!this.active) return null;

    const { widthPx, mask, height, cover } = doc.terrain;
    const patches: TerrainTilePatch[] = [];

    let minChangedX = widthPx;
    let minChangedY = doc.terrain.heightPx;
    let maxChangedX = -1;
    let maxChangedY = -1;

    for (const tile of this.capturedTiles.values()) {
      let tileHasDiff = false;
      const tw = tile.width;
      const th = tile.height;

      for (let ly = 0; ly < th; ly += 1) {
        const docRow = (tile.y + ly) * widthPx + tile.x;
        const tileRow = ly * tw;
        for (let lx = 0; lx < tw; lx += 1) {
          const dIdx = docRow + lx;
          const tIdx = tileRow + lx;
          if (
            mask[dIdx] !== tile.beforeMask[tIdx] ||
            height[dIdx] !== tile.beforeHeight[tIdx] ||
            cover[dIdx] !== tile.beforeCover[tIdx]
          ) {
            tileHasDiff = true;
            const gx = tile.x + lx;
            const gy = tile.y + ly;
            if (gx < minChangedX) minChangedX = gx;
            if (gx > maxChangedX) maxChangedX = gx;
            if (gy < minChangedY) minChangedY = gy;
            if (gy > maxChangedY) maxChangedY = gy;
          }
        }
      }

      if (!tileHasDiff) continue;

      const cellCount = tw * th;
      const afterMask = new Uint8Array(cellCount);
      const afterHeight = new Uint8Array(cellCount);
      const afterCover = new Uint8Array(cellCount);

      for (let ly = 0; ly < th; ly += 1) {
        const docStart = (tile.y + ly) * widthPx + tile.x;
        const dstStart = ly * tw;
        afterMask.set(mask.subarray(docStart, docStart + tw), dstStart);
        afterHeight.set(height.subarray(docStart, docStart + tw), dstStart);
        afterCover.set(cover.subarray(docStart, docStart + tw), dstStart);
      }

      patches.push({
        x: tile.x,
        y: tile.y,
        width: tw,
        height: th,
        beforeMask: tile.beforeMask,
        afterMask,
        beforeHeight: tile.beforeHeight,
        afterHeight,
        beforeCover: tile.beforeCover,
        afterCover
      });
    }

    const label = getToolLabel(this.tool);
    this.reset();

    if (patches.length === 0 || maxChangedX < minChangedX || maxChangedY < minChangedY) {
      return null;
    }

    const dirtyRect: DirtyRectPx = {
      x: minChangedX,
      y: minChangedY,
      width: maxChangedX - minChangedX + 1,
      height: maxChangedY - minChangedY + 1
    };

    const command = new TerrainPatchCommand(label, dirtyRect, patches);
    return { command, dirtyRect };
  }

  cancel(doc: MapDocument): DirtyRectPx | null {
    if (!this.active) return null;

    const { widthPx, heightPx, mask, height, cover } = doc.terrain;
    let minChangedX = widthPx;
    let minChangedY = heightPx;
    let maxChangedX = -1;
    let maxChangedY = -1;

    for (const tile of this.capturedTiles.values()) {
      const tw = tile.width;
      const th = tile.height;

      for (let ly = 0; ly < th; ly += 1) {
        const docRow = (tile.y + ly) * widthPx + tile.x;
        const tileRow = ly * tw;
        for (let lx = 0; lx < tw; lx += 1) {
          const dIdx = docRow + lx;
          const tIdx = tileRow + lx;
          if (
            mask[dIdx] !== tile.beforeMask[tIdx] ||
            height[dIdx] !== tile.beforeHeight[tIdx] ||
            cover[dIdx] !== tile.beforeCover[tIdx]
          ) {
            const gx = tile.x + lx;
            const gy = tile.y + ly;
            if (gx < minChangedX) minChangedX = gx;
            if (gx > maxChangedX) maxChangedX = gx;
            if (gy < minChangedY) minChangedY = gy;
            if (gy > maxChangedY) maxChangedY = gy;
          }
        }
      }

      for (let ly = 0; ly < th; ly += 1) {
        const docStart = (tile.y + ly) * widthPx + tile.x;
        const srcStart = ly * tw;
        mask.set(tile.beforeMask.subarray(srcStart, srcStart + tw), docStart);
        height.set(tile.beforeHeight.subarray(srcStart, srcStart + tw), docStart);
        cover.set(tile.beforeCover.subarray(srcStart, srcStart + tw), docStart);
      }
    }

    this.reset();

    if (maxChangedX < minChangedX || maxChangedY < minChangedY) {
      return null;
    }

    return {
      x: minChangedX,
      y: minChangedY,
      width: maxChangedX - minChangedX + 1,
      height: maxChangedY - minChangedY + 1
    };
  }

  private reset(): void {
    this.active = false;
    this.brushMode = 'classic';
    this.roughness = 0.65;
    this.flattenTargetHeight = 0;
    this.plateauTargetHeight = 185;
    this.capturedTiles.clear();
    if (this.smoothSnapshot.length > 65536) {
      this.smoothSnapshot = new Float32Array(0);
    }
  }

  private sampleTargetHeightAtStart(doc: MapDocument, startDocX: number, startDocY: number): number {
    const { space } = doc.manifest;
    const { widthPx, heightPx, mask, height } = doc.terrain;
    if (widthPx <= 0 || heightPx <= 0) return 0;

    const cxPx = clampNumber(Math.floor(docToMaskX(startDocX, space, doc.terrain)), 0, widthPx - 1);
    const cyPx = clampNumber(Math.floor(docToMaskY(startDocY, space, doc.terrain)), 0, heightPx - 1);
    const centerIdx = cyPx * widthPx + cxPx;
    if (mask[centerIdx] >= LAND_MASK_THRESHOLD) {
      return height[centerIdx];
    }

    const rxPx = docDistToMaskPxX(this.radiusDoc, space, doc.terrain);
    const ryPx = docDistToMaskPxY(this.radiusDoc, space, doc.terrain);
    const minX = Math.max(0, Math.floor(cxPx - rxPx) - 1);
    const maxX = Math.min(widthPx - 1, Math.ceil(cxPx + rxPx) + 1);
    const minY = Math.max(0, Math.floor(cyPx - ryPx) - 1);
    const maxY = Math.min(heightPx - 1, Math.ceil(cyPx + ryPx) + 1);
    const docPerPxX = space.width / widthPx;
    const docPerPxY = space.height / heightPx;
    const radiusSq = this.radiusDoc * this.radiusDoc;

    let bestDistSq = Number.POSITIVE_INFINITY;
    let bestHeight = height[centerIdx];
    for (let py = minY; py <= maxY; py += 1) {
      const dyDoc = (py + 0.5) * docPerPxY - startDocY;
      const dySq = dyDoc * dyDoc;
      const rowOff = py * widthPx;
      for (let px = minX; px <= maxX; px += 1) {
        const idx = rowOff + px;
        if (mask[idx] < LAND_MASK_THRESHOLD) continue;
        const dxDoc = (px + 0.5) * docPerPxX - startDocX;
        const distSq = dxDoc * dxDoc + dySq;
        if (distSq <= radiusSq && distSq < bestDistSq) {
          bestDistSq = distSq;
          bestHeight = height[idx];
        }
      }
    }
    return bestHeight;
  }

  private populateSmoothSnapshot(
    doc: MapDocument,
    sMinX: number,
    sMinY: number,
    sMaxX: number,
    sMaxY: number,
    tilesX: number
  ): number {
    const snapW = sMaxX - sMinX + 1;
    const snapH = sMaxY - sMinY + 1;
    const needed = snapW * snapH;
    if (this.smoothSnapshot.length < needed) {
      this.smoothSnapshot = new Float32Array(needed);
    }

    const snap = this.smoothSnapshot;
    const { widthPx, heightPx, height } = doc.terrain;
    const stx0 = Math.floor(sMinX / BRUSH_TILE_SIZE_PX);
    const stx1 = Math.floor(sMaxX / BRUSH_TILE_SIZE_PX);
    const sty0 = Math.floor(sMinY / BRUSH_TILE_SIZE_PX);
    const sty1 = Math.floor(sMaxY / BRUSH_TILE_SIZE_PX);

    for (let sty = sty0; sty <= sty1; sty += 1) {
      const tileY = sty * BRUSH_TILE_SIZE_PX;
      const tileH = Math.min(BRUSH_TILE_SIZE_PX, heightPx - tileY);
      const iy0 = Math.max(sMinY, tileY);
      const iy1 = Math.min(sMaxY, tileY + tileH - 1);

      for (let stx = stx0; stx <= stx1; stx += 1) {
        const tileX = stx * BRUSH_TILE_SIZE_PX;
        const tileW = Math.min(BRUSH_TILE_SIZE_PX, widthPx - tileX);
        const ix0 = Math.max(sMinX, tileX);
        const ix1 = Math.min(sMaxX, tileX + tileW - 1);
        const len = ix1 - ix0 + 1;
        const work = this.capturedTiles.get(sty * tilesX + stx)?.workHeight ?? null;

        for (let py = iy0; py <= iy1; py += 1) {
          const dstRow = (py - sMinY) * snapW + (ix0 - sMinX);
          if (work) {
            const srcRow = (py - tileY) * tileW + (ix0 - tileX);
            for (let i = 0; i < len; i += 1) {
              snap[dstRow + i] = work[srcRow + i];
            }
          } else {
            const srcRow = py * widthPx + ix0;
            for (let i = 0; i < len; i += 1) {
              snap[dstRow + i] = height[srcRow + i];
            }
          }
        }
      }
    }

    return snapW;
  }

  private getOrCaptureTile(doc: MapDocument, tx: number, ty: number, tilesX: number): CapturedTile {
    const key = ty * tilesX + tx;
    const existing = this.capturedTiles.get(key);
    if (existing) return existing;

    const { widthPx, heightPx, mask, height, cover } = doc.terrain;
    const x = tx * BRUSH_TILE_SIZE_PX;
    const y = ty * BRUSH_TILE_SIZE_PX;
    const width = Math.min(BRUSH_TILE_SIZE_PX, widthPx - x);
    const heightTile = Math.min(BRUSH_TILE_SIZE_PX, heightPx - y);
    const cellCount = width * heightTile;

    const beforeMask = new Uint8Array(cellCount);
    const beforeHeight = new Uint8Array(cellCount);
    const beforeCover = new Uint8Array(cellCount);

    for (let ly = 0; ly < heightTile; ly += 1) {
      const srcStart = (y + ly) * widthPx + x;
      const dstStart = ly * width;
      beforeMask.set(mask.subarray(srcStart, srcStart + width), dstStart);
      beforeHeight.set(height.subarray(srcStart, srcStart + width), dstStart);
      beforeCover.set(cover.subarray(srcStart, srcStart + width), dstStart);
    }

    let workHeight: Float32Array | null = null;
    if (isElevationTool(this.tool)) {
      workHeight = new Float32Array(cellCount);
      for (let i = 0; i < cellCount; i += 1) {
        workHeight[i] = beforeHeight[i];
      }
    }

    const tile: CapturedTile = {
      key,
      tx,
      ty,
      x,
      y,
      width,
      height: heightTile,
      beforeMask,
      beforeHeight,
      beforeCover,
      workHeight
    };
    this.capturedTiles.set(key, tile);
    return tile;
  }

  private stampAt(doc: MapDocument, cxDoc: number, cyDoc: number): DirtyRectPx | null {
    const { space } = doc.manifest;
    const { widthPx, heightPx, mask, height, cover } = doc.terrain;

    const tool = this.tool;
    const isSmart = this.brushMode === 'smart';
    const roughness = this.roughness;
    const reachScale = isSmart && (tool === 'land' || tool === 'water') ? 1.32 : 1.0;
    const reachRadiusDoc = this.radiusDoc * reachScale;

    const cxPx = docToMaskX(cxDoc, space, doc.terrain);
    const cyPx = docToMaskY(cyDoc, space, doc.terrain);
    const rxPx = docDistToMaskPxX(reachRadiusDoc, space, doc.terrain);
    const ryPx = docDistToMaskPxY(reachRadiusDoc, space, doc.terrain);

    const minX = Math.max(0, Math.floor(cxPx - rxPx) - 1);
    const maxX = Math.min(widthPx - 1, Math.ceil(cxPx + rxPx) + 1);
    const minY = Math.max(0, Math.floor(cyPx - ryPx) - 1);
    const maxY = Math.min(heightPx - 1, Math.ceil(cyPx + ryPx) + 1);

    if (minX > maxX || minY > maxY) {
      return null;
    }

    const docPerPxX = space.width / widthPx;
    const docPerPxY = space.height / heightPx;
    const avgDocPerPx = 0.5 * (docPerPxX + docPerPxY);
    const radiusDoc = this.radiusDoc;
    const invRadiusDoc = 1 / radiusDoc;
    const reachRadiusSq = reachRadiusDoc * reachRadiusDoc;
    const radiusSq = radiusDoc * radiusDoc;
    const aaDoc = Math.min(radiusDoc * 0.3, Math.max(avgDocPerPx * 1.5, 0.8));
    const innerEdgeDoc = Math.max(0, radiusDoc - aaDoc);

    const tilesX = Math.ceil(widthPx / BRUSH_TILE_SIZE_PX);
    const tx0 = Math.floor(minX / BRUSH_TILE_SIZE_PX);
    const tx1 = Math.floor(maxX / BRUSH_TILE_SIZE_PX);
    const ty0 = Math.floor(minY / BRUSH_TILE_SIZE_PX);
    const ty1 = Math.floor(maxY / BRUSH_TILE_SIZE_PX);

    let changedMinX = widthPx;
    let changedMinY = heightPx;
    let changedMaxX = -1;
    let changedMaxY = -1;

    const intensity = this.intensity;
    const targetCover = toolToCoverCode(tool);
    const flattenTarget = this.flattenTargetHeight;
    const plateauTarget = this.plateauTargetHeight;

    const docSeed = doc.manifest.terrain.seed >>> 0;
    const coastSeed = (docSeed ^ 0x434f41) >>> 0;
    const detailSeed = (docSeed ^ 0x444554) >>> 0;
    const reliefSeed = (docSeed ^ 0x52454c) >>> 0;
    const peakSeed = (docSeed ^ 0x504541) >>> 0;
    const peakDetailSeed = (docSeed ^ 0x504532) >>> 0;
    const plateauSeed = (docSeed ^ 0x504c41) >>> 0;
    const coverSeed = (docSeed ^ 0x434f56) >>> 0;

    const ridgeFreq = Math.min(0.032, Math.max(0.011, 1.9 / Math.max(55, radiusDoc)));
    const coastFreq = 2.4 / Math.max(24, radiusDoc);
    const coverFreq = 3.1 / Math.max(24, radiusDoc);

    let sMinX = 0;
    let sMinY = 0;
    let snapW = 0;
    if (tool === 'smooth') {
      sMinX = Math.max(0, minX - 1);
      sMinY = Math.max(0, minY - 1);
      const sMaxX = Math.min(widthPx - 1, maxX + 1);
      const sMaxY = Math.min(heightPx - 1, maxY + 1);
      snapW = this.populateSmoothSnapshot(doc, sMinX, sMinY, sMaxX, sMaxY, tilesX);
    }
    const snap = this.smoothSnapshot;

    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const tile = this.getOrCaptureTile(doc, tx, ty, tilesX);
        const x0 = Math.max(minX, tile.x);
        const x1 = Math.min(maxX, tile.x + tile.width - 1);
        const y0 = Math.max(minY, tile.y);
        const y1 = Math.min(maxY, tile.y + tile.height - 1);

        for (let py = y0; py <= y1; py += 1) {
          const docY = (py + 0.5) * docPerPxY;
          const dyDoc = docY - cyDoc;
          const dySq = dyDoc * dyDoc;
          const docRow = py * widthPx;
          const tileRow = (py - tile.y) * tile.width - tile.x;

          for (let px = x0; px <= x1; px += 1) {
            const docX = (px + 0.5) * docPerPxX;
            const dxDoc = docX - cxDoc;
            const distSq = dxDoc * dxDoc + dySq;
            if (distSq > reachRadiusSq) continue;
            if (!isSmart && distSq > radiusSq) continue;

            const distDoc = Math.sqrt(distSq);
            const normDist = distDoc * invRadiusDoc;
            const idx = docRow + px;
            let modified = false;

            if (tool === 'land') {
              if (!isSmart) {
                const edgeAlpha =
                  distDoc <= innerEdgeDoc ? 1 : 1 - smoothstepRange(innerEdgeDoc, radiusDoc, distDoc);
                const alpha = edgeAlpha * intensity;
                if (alpha > 0) {
                  const prevMask = mask[idx];
                  const nextMask =
                    prevMask >= 255
                      ? 255
                      : Math.min(255, Math.max(prevMask, Math.round(prevMask + (255 - prevMask) * alpha)));
                  if (nextMask !== prevMask) {
                    mask[idx] = nextMask;
                    if (prevMask === 0) {
                      height[idx] = 0;
                      cover[idx] = COVER_NATURAL;
                    }
                    modified = true;
                  }
                }
              } else {
                const warpVal = warpedFbm2D(coastSeed, docX * coastFreq, docY * coastFreq, 3);
                const fineJagged = valueNoise2D(
                  detailSeed,
                  docX * coastFreq * 3.1,
                  docY * coastFreq * 3.1
                );
                const nCombined = warpVal * 0.72 + fineJagged * 0.28;
                const edgeOffset = (nCombined - 0.5) * roughness * 0.62;
                const perturbedNorm = normDist + edgeOffset;
                const isletThreshold = 0.8 - 0.14 * roughness;
                const inIslet =
                  roughness > 0.22 &&
                  normDist > 0.84 &&
                  normDist <= 1.32 &&
                  nCombined > isletThreshold;

                let edgeAlpha = 0;
                if (perturbedNorm <= 1.0) {
                  edgeAlpha =
                    perturbedNorm <= 0.84 ? 1 : 1 - smoothstepRange(0.84, 1.0, perturbedNorm);
                } else if (inIslet) {
                  edgeAlpha = smoothstepRange(isletThreshold, isletThreshold + 0.14, nCombined);
                }

                const alpha = edgeAlpha * intensity;
                if (alpha > 0.02) {
                  const prevMask = mask[idx];
                  const nextMask =
                    prevMask >= 255
                      ? 255
                      : Math.min(
                          255,
                          Math.max(
                            prevMask,
                            Math.round(prevMask + (255 - prevMask) * (edgeAlpha > 0.45 ? 1 : alpha))
                          )
                        );
                  if (nextMask !== prevMask) {
                    mask[idx] = nextMask;
                    if (prevMask === 0) {
                      cover[idx] = COVER_NATURAL;
                      height[idx] = 0;
                    }
                    // Context-aware emerging land relief: gentle beach near shore, organic rolling plain inland
                    if (prevMask < LAND_MASK_THRESHOLD && nextMask >= LAND_MASK_THRESHOLD) {
                      const depth = Math.max(0, 1.0 - perturbedNorm);
                      const reliefN = fbm2D(reliefSeed, docX * 0.015, docY * 0.015, 3);
                      const baseH =
                        depth < 0.16
                          ? 5 + depth * 90 + reliefN * 8
                          : 18 + Math.min(0.85, depth) * 32 + reliefN * 26;
                      height[idx] = Math.min(72, Math.max(4, Math.round(baseH)));
                    }
                    modified = true;
                  }
                }
              }
            } else if (tool === 'water') {
              if (!isSmart) {
                const edgeAlpha =
                  distDoc <= innerEdgeDoc ? 1 : 1 - smoothstepRange(innerEdgeDoc, radiusDoc, distDoc);
                const alpha = edgeAlpha * intensity;
                if (alpha > 0) {
                  const prevMask = mask[idx];
                  if (prevMask > 0) {
                    const nextMask = Math.max(0, Math.floor(prevMask * (1 - alpha)));
                    if (nextMask !== prevMask) {
                      mask[idx] = nextMask;
                      if (nextMask === 0) {
                        height[idx] = 0;
                        cover[idx] = COVER_NATURAL;
                      }
                      modified = true;
                    }
                  }
                }
              } else {
                const warpVal = warpedFbm2D(coastSeed, docX * coastFreq, docY * coastFreq, 3);
                const fineJagged = valueNoise2D(
                  detailSeed,
                  docX * coastFreq * 3.1,
                  docY * coastFreq * 3.1
                );
                const nCombined = warpVal * 0.72 + fineJagged * 0.28;
                const edgeOffset = (nCombined - 0.5) * roughness * 0.58;
                const perturbedNorm = normDist + edgeOffset;

                if (perturbedNorm <= 1.0) {
                  const edgeAlpha =
                    perturbedNorm <= 0.84 ? 1 : 1 - smoothstepRange(0.84, 1.0, perturbedNorm);
                  const alpha = edgeAlpha * intensity;
                  if (alpha > 0) {
                    const prevMask = mask[idx];
                    if (prevMask > 0) {
                      const nextMask =
                        edgeAlpha > 0.45 && intensity >= 0.8
                          ? 0
                          : Math.max(0, Math.floor(prevMask * (1 - alpha)));
                      if (nextMask !== prevMask) {
                        mask[idx] = nextMask;
                        if (nextMask === 0) {
                          height[idx] = 0;
                          cover[idx] = COVER_NATURAL;
                        }
                        modified = true;
                      }
                    }
                  }
                } else if (perturbedNorm <= 1.18 && mask[idx] >= LAND_MASK_THRESHOLD) {
                  // Smart shore grading: plains taper into sandy coves, mountains become sheer coastal cliffs
                  const prevH = height[idx];
                  if (prevH > 18 && prevH <= 135) {
                    const targetShore = Math.round(14 + (perturbedNorm - 1.0) * 150);
                    if (targetShore < prevH) {
                      const shoreBlend = (1 - smoothstepRange(1.0, 1.18, perturbedNorm)) * 0.55;
                      const nextH = Math.max(0, Math.round(prevH + (targetShore - prevH) * shoreBlend));
                      if (nextH !== prevH) {
                        height[idx] = nextH;
                        modified = true;
                      }
                    }
                  }
                }
              }
            } else if (tool === 'raise') {
              if (mask[idx] >= LAND_MASK_THRESHOLD && normDist <= 1) {
                const radial = Math.pow(1 - normDist, 1.45);
                const ridge = ridgedFbm2D(peakSeed, docX * ridgeFreq, docY * ridgeFreq, 4);
                const spur = ridgedNoise2D(
                  peakDetailSeed,
                  docX * ridgeFreq * 2.3,
                  docY * ridgeFreq * 2.3
                );
                const ridgeComb = ridge * 0.78 + spur * 0.22;
                const localMax = 132 + 123 * Math.pow(ridgeComb, 0.92);
                const localIdx = tileRow + px;
                const work = tile.workHeight!;
                const prevFloat = work[localIdx];
                if (prevFloat < localMax) {
                  const ridgeGain = 0.72 + 0.95 * ridgeComb;
                  const headroom = (localMax - prevFloat) / Math.max(45, localMax - 90);
                  const asymptote =
                    prevFloat < 95 ? 1.0 : Math.pow(clampNumber(headroom, 0, 1), 0.72);
                  const delta = BASE_ELEVATION_STEP * 1.38 * intensity * radial * ridgeGain * asymptote;
                  if (delta > 0) {
                    const nextFloat = Math.min(localMax, prevFloat + delta);
                    work[localIdx] = nextFloat;
                    const nextByte = Math.round(nextFloat);
                    if (nextByte !== height[idx]) {
                      height[idx] = nextByte;
                      modified = true;
                    }
                  }
                }
              }
            } else if (tool === 'plateau') {
              if (mask[idx] >= LAND_MASK_THRESHOLD) {
                const edgeWarp = isSmart
                  ? (warpedFbm2D(plateauSeed, docX * coastFreq, docY * coastFreq, 2) - 0.5) *
                    roughness *
                    0.34
                  : 0;
                const effNorm = normDist + edgeWarp;
                if (effNorm <= 1.0) {
                  const profile =
                    effNorm <= 0.68 ? 1.0 : 1 - smoothstepRange(0.68, 1.0, effNorm);
                  const blend = clampNumber(profile * Math.min(1, intensity * 1.15), 0, 1);
                  if (blend > 0) {
                    const localIdx = tileRow + px;
                    const work = tile.workHeight!;
                    const prevFloat = work[localIdx];
                    const nextFloat = prevFloat + (plateauTarget - prevFloat) * blend;
                    work[localIdx] = nextFloat;
                    const nextByte = Math.min(255, Math.max(0, Math.round(nextFloat)));
                    if (nextByte !== height[idx]) {
                      height[idx] = nextByte;
                      modified = true;
                    }
                  }
                }
              }
            } else if (tool === 'lower') {
              if (mask[idx] >= LAND_MASK_THRESHOLD && normDist <= 1) {
                const falloff = 1 - smoothstepRange(0, 1, normDist);
                const ridgeMod = isSmart
                  ? 0.72 + 0.48 * (1 - ridgedFbm2D(peakSeed, docX * ridgeFreq, docY * ridgeFreq, 3))
                  : 1;
                const delta = BASE_ELEVATION_STEP * intensity * falloff * ridgeMod;
                if (delta > 0) {
                  const localIdx = tileRow + px;
                  const work = tile.workHeight!;
                  const prevFloat = work[localIdx];
                  const nextFloat = Math.max(0, prevFloat - delta);
                  work[localIdx] = nextFloat;
                  const nextByte = Math.round(nextFloat);
                  if (nextByte !== height[idx]) {
                    height[idx] = nextByte;
                    modified = true;
                  }
                }
              }
            } else if (tool === 'flatten') {
              if (mask[idx] >= LAND_MASK_THRESHOLD && normDist <= 1) {
                const falloff = 1 - smoothstepRange(0, 1, normDist);
                const blend = clampNumber(falloff * intensity, 0, 1);
                if (blend > 0) {
                  const localIdx = tileRow + px;
                  const work = tile.workHeight!;
                  const prevFloat = work[localIdx];
                  const nextFloat = prevFloat + (flattenTarget - prevFloat) * blend;
                  work[localIdx] = nextFloat;
                  const nextByte = Math.min(255, Math.max(0, Math.round(nextFloat)));
                  if (nextByte !== height[idx]) {
                    height[idx] = nextByte;
                    modified = true;
                  }
                }
              }
            } else if (tool === 'smooth') {
              if (mask[idx] >= LAND_MASK_THRESHOLD && normDist <= 1) {
                const falloff = 1 - smoothstepRange(0, 1, normDist);
                const blend = clampNumber(falloff * intensity, 0, 1);
                if (blend > 0) {
                  let sum = 0;
                  let wSum = 0;
                  let kIdx = 0;
                  for (let ky = -1; ky <= 1; ky += 1) {
                    const ny = py + ky;
                    if (ny < 0 || ny >= heightPx) {
                      kIdx += 3;
                      continue;
                    }
                    const nMaskRow = ny * widthPx;
                    const nSnapRow = (ny - sMinY) * snapW - sMinX;
                    for (let kx = -1; kx <= 1; kx += 1) {
                      const w = SMOOTH_KERNEL[kIdx];
                      kIdx += 1;
                      const nx = px + kx;
                      if (nx < 0 || nx >= widthPx) continue;
                      if (mask[nMaskRow + nx] < LAND_MASK_THRESHOLD) continue;
                      sum += snap[nSnapRow + nx] * w;
                      wSum += w;
                    }
                  }

                  if (wSum > 0) {
                    const avg = sum / wSum;
                    const localIdx = tileRow + px;
                    const work = tile.workHeight!;
                    const prevFloat = work[localIdx];
                    const nextFloat = prevFloat + (avg - prevFloat) * blend;
                    work[localIdx] = nextFloat;
                    const nextByte = Math.min(255, Math.max(0, Math.round(nextFloat)));
                    if (nextByte !== height[idx]) {
                      height[idx] = nextByte;
                      modified = true;
                    }
                  }
                }
              }
            } else if (targetCover !== null) {
              if (mask[idx] >= LAND_MASK_THRESHOLD && normDist <= 1) {
                let allowCover = true;
                const hVal = height[idx];

                if (isSmart) {
                  // Organic brush boundary (bricks remain crisp architectural stamps)
                  const edgeStart = targetCover === COVER_BRICK ? 0.85 : 0.62;
                  if (normDist > edgeStart) {
                    const edgeN = warpedFbm2D(coverSeed, docX * coverFreq, docY * coverFreq, 2);
                    const edgeProgress = (normDist - edgeStart) / (1 - edgeStart);
                    const threshold = 0.25 + edgeProgress * 0.62;
                    if (edgeN < threshold) {
                      allowCover = false;
                    }
                  }

                  // Context-aware adaptation to existing elevation & biome
                  if (allowCover) {
                    if (targetCover === COVER_FOREST && hVal > 238) {
                      allowCover = false;
                    } else if (targetCover === COVER_FIELDS && hVal > 205) {
                      allowCover = false;
                    } else if (targetCover === COVER_SWAMP) {
                      if (hVal > 185) {
                        allowCover = false;
                      } else if (hVal > 72 && hVal <= 145) {
                        const sinkT = (1 - smoothstepRange(0.3, 1.0, normDist)) * 0.45;
                        const nextH = Math.max(36, Math.round(hVal - (hVal - 56) * sinkT));
                        if (nextH !== hVal) {
                          height[idx] = nextH;
                          modified = true;
                        }
                      }
                    } else if (targetCover === COVER_ROCK && cover[idx] !== COVER_ROCK && hVal < 85) {
                      const gritN = valueNoise2D(reliefSeed, docX * 0.14, docY * 0.14);
                      const nextH = Math.min(130, hVal + Math.round(4 + gritN * 8));
                      if (nextH !== hVal) {
                        height[idx] = nextH;
                        modified = true;
                      }
                    }
                  }
                }

                if (allowCover && cover[idx] !== targetCover) {
                  cover[idx] = targetCover;
                  modified = true;
                }
              }
            }

            if (modified) {
              if (px < changedMinX) changedMinX = px;
              if (px > changedMaxX) changedMaxX = px;
              if (py < changedMinY) changedMinY = py;
              if (py > changedMaxY) changedMaxY = py;
            }
          }
        }
      }
    }

    if (changedMaxX < changedMinX || changedMaxY < changedMinY) {
      return null;
    }

    return {
      x: changedMinX,
      y: changedMinY,
      width: changedMaxX - changedMinX + 1,
      height: changedMaxY - changedMinY + 1
    };
  }
}
