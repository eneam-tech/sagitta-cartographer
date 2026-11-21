import { DirtyRectPx, TerrainPatchCommand, TerrainTilePatch } from '../model/commands';
import {
  clampNumber,
  docDistToMaskPxX,
  docDistToMaskPxY,
  docToMaskX,
  docToMaskY
} from '../model/coordinates';
import { COVER_FIELDS, COVER_FOREST, COVER_NATURAL, CoverCode, MapDocument } from '../model/document';
import { smoothstepRange } from './classifier';
import { BrushStrokeParams, ITerrainStrokeSession, StrokeCommitResult, TerrainBrushTool } from './types';

export const BRUSH_TILE_SIZE_PX = 128;
const BASE_ELEVATION_STEP = 16;

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
      return 'Alza rilievo';
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
  private radiusDoc = 20;
  private intensity = 1;
  private stepDoc = 4;
  private lastDocX = 0;
  private lastDocY = 0;
  private distSinceLastStamp = 0;
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
    this.radiusDoc = diameterDoc * 0.5;
    this.intensity = clampNumber(Number.isFinite(params.intensity) ? params.intensity : 1, 0.05, 1.0);
    this.stepDoc = Math.max(1.5, this.radiusDoc * 0.2);
    this.lastDocX = startDocX;
    this.lastDocY = startDocY;
    this.distSinceLastStamp = 0;
    this.active = true;

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
    this.capturedTiles.clear();
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
    if (this.tool === 'raise' || this.tool === 'lower') {
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

    const cxPx = docToMaskX(cxDoc, space, doc.terrain);
    const cyPx = docToMaskY(cyDoc, space, doc.terrain);
    const rxPx = docDistToMaskPxX(this.radiusDoc, space, doc.terrain);
    const ryPx = docDistToMaskPxY(this.radiusDoc, space, doc.terrain);

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

    const tool = this.tool;
    const intensity = this.intensity;
    const targetCover: CoverCode =
      tool === 'forest' ? COVER_FOREST : tool === 'fields' ? COVER_FIELDS : COVER_NATURAL;

    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const tile = this.getOrCaptureTile(doc, tx, ty, tilesX);
        const x0 = Math.max(minX, tile.x);
        const x1 = Math.min(maxX, tile.x + tile.width - 1);
        const y0 = Math.max(minY, tile.y);
        const y1 = Math.min(maxY, tile.y + tile.height - 1);

        for (let py = y0; py <= y1; py += 1) {
          const dyDoc = (py + 0.5) * docPerPxY - cyDoc;
          const dySq = dyDoc * dyDoc;
          const docRow = py * widthPx;
          const tileRow = (py - tile.y) * tile.width - tile.x;

          for (let px = x0; px <= x1; px += 1) {
            const dxDoc = (px + 0.5) * docPerPxX - cxDoc;
            const distSq = dxDoc * dxDoc + dySq;
            if (distSq > radiusDoc * radiusDoc) continue;

            const distDoc = Math.sqrt(distSq);
            const idx = docRow + px;
            let modified = false;

            if (tool === 'land') {
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
            } else if (tool === 'water') {
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
            } else if (tool === 'raise' || tool === 'lower') {
              if (mask[idx] > 0) {
                const normDist = distDoc * invRadiusDoc;
                const falloff = 1 - smoothstepRange(0, 1, normDist);
                const delta = BASE_ELEVATION_STEP * intensity * falloff;
                if (delta > 0) {
                  const localIdx = tileRow + px;
                  const work = tile.workHeight!;
                  const prevFloat = work[localIdx];
                  const nextFloat =
                    tool === 'raise'
                      ? Math.min(255, prevFloat + delta)
                      : Math.max(0, prevFloat - delta);
                  work[localIdx] = nextFloat;
                  const nextByte = Math.round(nextFloat);
                  if (nextByte !== height[idx]) {
                    height[idx] = nextByte;
                    modified = true;
                  }
                }
              }
            } else {
              // forest | fields | natural
              if (mask[idx] > 0 && cover[idx] !== targetCover) {
                cover[idx] = targetCover;
                modified = true;
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
