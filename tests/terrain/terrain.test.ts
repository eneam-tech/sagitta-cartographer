import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResizeCanvasCommand } from '../../src/model/commands';
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
  MapDocument,
  createEmptyDocument
} from '../../src/model/document';
import { HistoryManager } from '../../src/model/history';
import { createSampleWorldDocument } from '../../src/model/sampleDocument';
import { DEFAULT_THEME, V1_FLAT_THEME, WITCHER_THEME, cloneTheme } from '../../src/theme/theme';
import {
  TERRAIN_DIRTY_COVER,
  TERRAIN_DIRTY_FOREST,
  TERRAIN_DIRTY_HEIGHT,
  TerrainBrushTool,
  TerrainRenderer,
  TerrainStrokeSession,
  WORLD_GENERATOR_PRESETS,
  classifyCell,
  computeLocalWaterDistancePx,
  generateProceduralWorldTerrain,
  inspectCellAtDoc,
  isPointOnLand,
  resizeTerrainBuffers
} from '../../src/terrain';

function snapshotTerrain(doc: MapDocument) {
  return {
    mask: new Uint8Array(doc.terrain.mask),
    height: new Uint8Array(doc.terrain.height),
    cover: new Uint8Array(doc.terrain.cover)
  };
}

function countByteMismatches(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let mismatches = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) mismatches += 1;
  }
  return mismatches;
}

function countRgbDiffs(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  widthPx: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  let diffs = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const off = (y * widthPx + x) * 4;
      if (a[off] !== b[off] || a[off + 1] !== b[off + 1] || a[off + 2] !== b[off + 2]) {
        diffs += 1;
      }
    }
  }
  return diffs;
}

describe('Terrain engine & reactive rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('classifies the 5 elevation/coastal strips accurately and treats land at page borders as inland', () => {
    // 1485 x 1050 px on 2970 x 2100 doc space => 2 doc units per pixel
    const doc = createEmptyDocument({ widthPx: 1485, heightPx: 1050, seed: 42 });
    const { widthPx, heightPx, mask, height } = doc.terrain;
    const docPerPx = doc.manifest.space.width / widthPx; // 2 u/px

    // Sea on left [0, 100 u); land from x = 100 u to right edge (2970 u), full height [0, heightPx)
    for (let py = 0; py < heightPx; py += 1) {
      for (let px = 0; px < widthPx; px += 1) {
        const docX = (px + 0.5) * docPerPx;
        if (docX < 100) continue;
        const idx = py * widthPx + px;
        mask[idx] = 255;

        if (docX < 112) {
          height[idx] = 16; // Strip 1: coastal beach (<= 31 within 12 u of water)
        } else if (docX < 200) {
          height[idx] = 64; // Strip 2: plain (32..111)
        } else if (docX < 300) {
          height[idx] = 144; // Strip 3: hill (112..191)
        } else if (docX < 400) {
          height[idx] = 224; // Strip 4: mountain (192..255)
        } else {
          height[idx] = 16; // Strip 5: inland low plain (> 12 u from sea) up to right border
        }
      }
    }

    const midY = 1050;
    expect(isPointOnLand(doc, 50, midY)).toBe(false);
    expect(isPointOnLand(doc, 105, midY)).toBe(true);
    expect(isPointOnLand(doc, -5, midY)).toBe(false);
    expect(isPointOnLand(doc, doc.manifest.space.width + 5, midY)).toBe(false);

    // 5 strips verification
    expect(inspectCellAtDoc(doc, 105, midY)?.classification.biome).toBe('beach');
    expect(inspectCellAtDoc(doc, 150, midY)?.classification.biome).toBe('plain');
    expect(inspectCellAtDoc(doc, 250, midY)?.classification.biome).toBe('hill');
    expect(inspectCellAtDoc(doc, 350, midY)?.classification.biome).toBe('mountain');
    expect(inspectCellAtDoc(doc, 500, midY)?.classification.biome).toBe('plain');

    // Page borders touching land at height 16 must NOT generate beach
    expect(inspectCellAtDoc(doc, doc.manifest.space.width - 1, midY)?.classification.biome).toBe(
      'plain'
    );
    expect(inspectCellAtDoc(doc, 600, 1)?.classification.biome).toBe('plain');
    expect(inspectCellAtDoc(doc, 600, doc.manifest.space.height - 1)?.classification.biome).toBe(
      'plain'
    );

    // Threshold precision checks
    expect(classifyCell(127, 16, 4, DEFAULT_THEME).biome).toBe('sea');
    expect(classifyCell(128, 31, 12, DEFAULT_THEME).biome).toBe('beach');
    expect(classifyCell(255, 31, 12.1, DEFAULT_THEME).biome).toBe('plain');
    expect(classifyCell(255, 32, 2, DEFAULT_THEME).biome).toBe('plain');
    expect(classifyCell(255, 111, 40, DEFAULT_THEME).biome).toBe('plain');
    expect(classifyCell(255, 112, 40, DEFAULT_THEME).biome).toBe('hill');
    expect(classifyCell(255, 191, 40, DEFAULT_THEME).biome).toBe('hill');
    expect(classifyCell(255, 192, 40, DEFAULT_THEME).biome).toBe('mountain');
    expect(classifyCell(255, 224, 40, V1_FLAT_THEME).biome).toBe('plain');

    // Lowering the mountain strip crosses thresholds back through hill -> plain -> beach (near coast)
    const session = new TerrainStrokeSession();
    // Apply lower on a coastal mountain patch at x = 105, y = 500 first raised to 224
    const coastalIdx = Math.floor(500 / docPerPx) * widthPx + Math.floor(105 / docPerPx);
    height[coastalIdx] = 224;
    expect(inspectCellAtDoc(doc, 105, 500)?.classification.biome).toBe('mountain');

    const applyLowerPass = () => {
      session.beginStroke(doc, { tool: 'lower', diameterDoc: 24, intensity: 1.0 }, 105, 480);
      session.addPoint(doc, 105, 520);
      session.commit(doc);
    };

    applyLowerPass(); // 224 -> ~144 (hill)
    const afterFirst = inspectCellAtDoc(doc, 105, 500)!;
    expect(afterFirst.height).toBeLessThanOrEqual(191);
    expect(afterFirst.height).toBeGreaterThan(111);
    expect(afterFirst.classification.biome).toBe('hill');

    applyLowerPass(); // ~144 -> ~64 (plain)
    const afterSecond = inspectCellAtDoc(doc, 105, 500)!;
    expect(afterSecond.height).toBeLessThanOrEqual(111);
    expect(afterSecond.height).toBeGreaterThan(31);
    expect(afterSecond.classification.biome).toBe('plain');

    applyLowerPass(); // ~64 -> <= 31 (beach near sea)
    const afterThird = inspectCellAtDoc(doc, 105, 500)!;
    expect(afterThird.height).toBeLessThanOrEqual(31);
    expect(afterThird.classification.biome).toBe('beach');
  });

  it('renders reactive forest across elevations and guarantees pixel-identical renderRegion vs renderFull', () => {
    const doc = createEmptyDocument({ widthPx: 594, heightPx: 420, seed: 173 });
    const { widthPx, mask, height, cover } = doc.terrain;

    // Create a broad island covering pixels [120..470] x [90..330] at plain height 64 with forest cover
    for (let y = 90; y < 330; y += 1) {
      for (let x = 120; x < 470; x += 1) {
        const idx = y * widthPx + x;
        mask[idx] = 255;
        height[idx] = 64;
        if (x >= 180 && x < 400 && y >= 130 && y < 290) {
          cover[idx] = COVER_FOREST;
        }
      }
    }

    const renderer = new TerrainRenderer();
    renderer.renderFull(doc);
    const plainPixels = new Uint8ClampedArray(renderer.getPixelData().rgba);

    // Raise central forested sub-area [210..370] x [150..270] to hill (144) WITHOUT changing cover
    for (let y = 150; y < 270; y += 1) {
      for (let x = 210; x < 370; x += 1) {
        height[y * widthPx + x] = 144;
      }
    }
    renderer.renderRegion(doc, { x: 210, y: 150, width: 160, height: 120 });
    const hillPixels = new Uint8ClampedArray(renderer.getPixelData().rgba);
    expect(countRgbDiffs(plainPixels, hillPixels, widthPx, 215, 155, 365, 265)).toBeGreaterThan(
      500
    );

    // Raise further to mountain (224) with sloped edges so hillshading + sparse alpine forest activate
    for (let y = 160; y < 260; y += 1) {
      for (let x = 220; x < 360; x += 1) {
        const ridge = Math.min(240, 195 + Math.round(Math.max(0, 1 - Math.abs(x - 290) / 70) * 45));
        height[y * widthPx + x] = ridge;
      }
    }
    renderer.renderRegion(doc, { x: 220, y: 160, width: 140, height: 100 });
    const mountainPixels = new Uint8ClampedArray(renderer.getPixelData().rgba);
    expect(
      countRgbDiffs(hillPixels, mountainPixels, widthPx, 225, 165, 355, 255)
    ).toBeGreaterThan(500);

    // Incremental renderRegion after a brush stroke must match a fresh renderFull bit-for-bit
    const session = new TerrainStrokeSession();
    const d1 = session.beginStroke(doc, { tool: 'fields', diameterDoc: 120, intensity: 1.0 }, 1100, 1050);
    const d2 = session.addPoint(doc, 1600, 1050);
    const commitRes = session.commit(doc)!;
    expect(commitRes).not.toBeNull();
    expect(d1 || d2).toBeTruthy();

    renderer.renderRegion(doc, commitRes.dirtyRect);

    const fullRenderer = new TerrainRenderer();
    fullRenderer.renderFull(doc);

    const partialData = renderer.getPixelData().rgba;
    const fullData = fullRenderer.getPixelData().rgba;
    expect(partialData.length).toBe(fullData.length);

    let mismatches = 0;
    for (let i = 0; i < fullData.length; i += 1) {
      if (partialData[i] !== fullData[i]) {
        mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);

    renderer.dispose();
    fullRenderer.dispose();
  });

  it('handles forest, fields, and natural covers correctly and skips sea-only strokes', () => {
    const doc = createEmptyDocument({ widthPx: 594, heightPx: 420, seed: 91 });
    const { widthPx, heightPx, mask, height, cover } = doc.terrain;

    // Right half is land (x >= 280), with plain on top and hill on bottom
    for (let y = 60; y < 360; y += 1) {
      for (let x = 280; x < 540; x += 1) {
        const idx = y * widthPx + x;
        mask[idx] = 255;
        height[idx] = y < 210 ? 64 : 150 + Math.round(((y - 210) / 150) * 35);
      }
    }

    const session = new TerrainStrokeSession();

    // 1) Sea-only cover or elevation strokes must return null on commit
    session.beginStroke(doc, { tool: 'forest', diameterDoc: 100, intensity: 1.0 }, 300, 500);
    session.addPoint(doc, 500, 900);
    expect(session.commit(doc)).toBeNull();

    session.beginStroke(doc, { tool: 'raise', diameterDoc: 100, intensity: 1.0 }, 300, 500);
    expect(session.commit(doc)).toBeNull();

    // 2) Forest across sea, plain, and hill leaves sea completely intact
    session.beginStroke(doc, { tool: 'forest', diameterDoc: 200, intensity: 1.0 }, 1100, 600);
    session.addPoint(doc, 1600, 1400);
    const forestRes = session.commit(doc)!;
    expect(forestRes).not.toBeNull();

    let sawSeaUntouched = false;
    let sawPlainForest = false;
    let sawHillForest = false;
    let seaCorrupted = 0;
    for (let y = 60; y < 360; y += 1) {
      for (let x = 200; x < 420; x += 1) {
        const idx = y * widthPx + x;
        if (mask[idx] === 0) {
          if (cover[idx] !== COVER_NATURAL || height[idx] !== 0) {
            seaCorrupted += 1;
          }
          sawSeaUntouched = true;
        } else if (cover[idx] === COVER_FOREST) {
          if (height[idx] <= 111) sawPlainForest = true;
          if (height[idx] >= 112) sawHillForest = true;
        }
      }
    }
    expect(seaCorrupted).toBe(0);
    expect(sawSeaUntouched).toBe(true);
    expect(sawPlainForest).toBe(true);
    expect(sawHillForest).toBe(true);

    // 3) Fields overwrites half of the forested region
    session.beginStroke(doc, { tool: 'fields', diameterDoc: 160, intensity: 1.0 }, 1600, 700);
    session.addPoint(doc, 1600, 1400);
    const fieldsRes = session.commit(doc)!;
    expect(fieldsRes).not.toBeNull();

    let sawRemainingForest = false;
    let sawOverwrittenFields = false;
    for (let i = 0; i < widthPx * heightPx; i += 1) {
      if (cover[i] === COVER_FOREST) sawRemainingForest = true;
      if (cover[i] === COVER_FIELDS) sawOverwrittenFields = true;
    }
    expect(sawRemainingForest).toBe(true);
    expect(sawOverwrittenFields).toBe(true);

    // 4) Natural clears cover while preserving height and mask
    const preNaturalHeight = new Uint8Array(height);
    const preNaturalMask = new Uint8Array(mask);
    session.beginStroke(doc, { tool: 'natural', diameterDoc: 140, intensity: 1.0 }, 1600, 900);
    const naturalRes = session.commit(doc)!;
    expect(naturalRes).not.toBeNull();

    expect(countByteMismatches(height, preNaturalHeight)).toBe(0);
    expect(countByteMismatches(mask, preNaturalMask)).toBe(0);
    const centerIdx = Math.floor(900 / 5) * widthPx + Math.floor(1600 / 5);
    expect(cover[centerIdx]).toBe(COVER_NATURAL);
  });

  it('enforces land/water rules, lazy tiles, single-click circle, page clipping, cancel, and undo/redo', () => {
    // Full A4 300 ppi resolution check for lazy tiling & clipping
    const hiResDoc = createEmptyDocument({ widthPx: 3508, heightPx: 2480, seed: 77 });
    const session = new TerrainStrokeSession();

    // Stationary click near top-left page corner (clips strictly to page, captures minimal 128x128 tiles)
    const dirtyCorner = session.beginStroke(
      hiResDoc,
      { tool: 'land', diameterDoc: 80, intensity: 1.0 },
      10,
      10
    );
    expect(dirtyCorner).not.toBeNull();
    expect(dirtyCorner!.x).toBe(0);
    expect(dirtyCorner!.y).toBe(0);
    expect(session.getCapturedTileCount()).toBe(1); // 1 lazy 128x128 tile instead of 560 tiles!
    const cornerCommit = session.commit(hiResDoc)!;
    expect(cornerCommit).not.toBeNull();

    // Stationary click in center produces a symmetric circular island starting at height 0 / cover 0
    const doc = createEmptyDocument({ widthPx: 594, heightPx: 420, seed: 173 });
    const history = new HistoryManager();

    const snap0 = snapshotTerrain(doc);

    // Stroke 1: circular island at center (1485, 1050), diameter 200 u (radius 100 u)
    session.beginStroke(doc, { tool: 'land', diameterDoc: 200, intensity: 1.0 }, 1485, 1050);
    const res1 = session.commit(doc)!;
    expect(res1).not.toBeNull();
    history.execute(doc, res1.command, { alreadyApplied: true });

    expect(isPointOnLand(doc, 1485, 1050)).toBe(true);
    expect(isPointOnLand(doc, 1485 + 85, 1050)).toBe(true);
    expect(isPointOnLand(doc, 1485 - 85, 1050)).toBe(true);
    expect(isPointOnLand(doc, 1485, 1050 + 85)).toBe(true);
    expect(isPointOnLand(doc, 1485, 1050 - 85)).toBe(true);
    expect(isPointOnLand(doc, 1485 + 115, 1050)).toBe(false);
    expect(isPointOnLand(doc, 1485 + 80, 1050 + 80)).toBe(false); // hypot(80,80) = 113.1 > 100

    // Newly emerged land starts at mask 255 (>= 128), height 0, cover 0
    const centerInsp = inspectCellAtDoc(doc, 1485, 1050)!;
    expect(centerInsp.mask).toBe(255);
    expect(centerInsp.height).toBe(0);
    expect(centerInsp.cover).toBe(COVER_NATURAL);

    // Stroke 2: raise center & paint forest
    session.beginStroke(doc, { tool: 'raise', diameterDoc: 100, intensity: 1.0 }, 1450, 1050);
    session.addPoint(doc, 1520, 1050);
    const res2 = session.commit(doc)!;
    history.execute(doc, res2.command, { alreadyApplied: true });
    expect(inspectCellAtDoc(doc, 1485, 1050)!.height).toBeGreaterThan(20);

    session.beginStroke(doc, { tool: 'forest', diameterDoc: 100, intensity: 1.0 }, 1485, 1050);
    const res3 = session.commit(doc)!;
    history.execute(doc, res3.command, { alreadyApplied: true });
    expect(inspectCellAtDoc(doc, 1485, 1050)!.cover).toBe(COVER_FOREST);

    // Pre-existing land painted again with `land` preserves height & cover
    const heightBeforeReland = inspectCellAtDoc(doc, 1485, 1050)!.height;
    session.beginStroke(doc, { tool: 'land', diameterDoc: 240, intensity: 1.0 }, 1485, 1050);
    const resReland = session.commit(doc)!;
    if (resReland) {
      history.execute(doc, resReland.command, { alreadyApplied: true });
    }
    expect(inspectCellAtDoc(doc, 1485, 1050)!.height).toBe(heightBeforeReland);
    expect(inspectCellAtDoc(doc, 1485, 1050)!.cover).toBe(COVER_FOREST);

    // Water carving across center resets height & cover to 0 where mask becomes 0
    session.beginStroke(doc, { tool: 'water', diameterDoc: 60, intensity: 1.0 }, 1485, 1050);
    const resWater = session.commit(doc)!;
    history.execute(doc, resWater.command, { alreadyApplied: true });
    const carvedInsp = inspectCellAtDoc(doc, 1485, 1050)!;
    expect(carvedInsp.mask).toBe(0);
    expect(carvedInsp.height).toBe(0);
    expect(carvedInsp.cover).toBe(COVER_NATURAL);

    const snapFinal = snapshotTerrain(doc);

    // Cancel mid-stroke must restore exact pre-stroke buffers
    session.beginStroke(doc, { tool: 'raise', diameterDoc: 120, intensity: 1.0 }, 1450, 1050);
    session.addPoint(doc, 1540, 1050);
    const cancelRect = session.cancel(doc);
    expect(cancelRect).not.toBeNull();
    expect(session.isActive()).toBe(false);
    expect(Array.from(doc.terrain.mask)).toEqual(Array.from(snapFinal.mask));
    expect(Array.from(doc.terrain.height)).toEqual(Array.from(snapFinal.height));
    expect(Array.from(doc.terrain.cover)).toEqual(Array.from(snapFinal.cover));

    // Undo all commands back to initial empty snapshot bit-for-bit
    while (history.canUndo) {
      history.undo(doc);
    }
    expect(Array.from(doc.terrain.mask)).toEqual(Array.from(snap0.mask));
    expect(Array.from(doc.terrain.height)).toEqual(Array.from(snap0.height));
    expect(Array.from(doc.terrain.cover)).toEqual(Array.from(snap0.cover));

    // Redo all commands back to final snapshot bit-for-bit
    while (history.canRedo) {
      history.redo(doc);
    }
    expect(Array.from(doc.terrain.mask)).toEqual(Array.from(snapFinal.mask));
    expect(Array.from(doc.terrain.height)).toEqual(Array.from(snapFinal.height));
    expect(Array.from(doc.terrain.cover)).toEqual(Array.from(snapFinal.cover));
  });

  it('keeps raise/lower effect independent of pointer event density and computes exact local water distance', () => {
    const setupIsland = () => {
      const d = createEmptyDocument({ widthPx: 594, heightPx: 420, seed: 5 });
      for (let y = 100; y < 320; y += 1) {
        for (let x = 100; x < 494; x += 1) {
          d.terrain.mask[y * 594 + x] = 255;
        }
      }
      return d;
    };

    // Sparse pointer events (2 points across 600 u) vs dense events (60 points across 600 u)
    const docSparse = setupIsland();
    const sSparse = new TerrainStrokeSession();
    sSparse.beginStroke(docSparse, { tool: 'raise', diameterDoc: 80, intensity: 0.7 }, 1100, 1050);
    sSparse.addPoint(docSparse, 1700, 1050);
    sSparse.commit(docSparse);

    const docDense = setupIsland();
    const sDense = new TerrainStrokeSession();
    sDense.beginStroke(docDense, { tool: 'raise', diameterDoc: 80, intensity: 0.7 }, 1100, 1050);
    for (let i = 1; i <= 60; i += 1) {
      sDense.addPoint(docDense, 1100 + i * 10, 1050);
    }
    sDense.commit(docDense);

    expect(Array.from(docSparse.terrain.height)).toEqual(Array.from(docDense.terrain.height));

    // Verify computeLocalWaterDistancePx exact Euclidean distance on diagonal
    const w = 64;
    const h = 64;
    const mask = new Uint8Array(w * h).fill(255);
    mask[10 * w + 10] = 0; // single water pixel at (10, 10)
    const dists = computeLocalWaterDistancePx(mask, w, h, { x: 10, y: 10, width: 10, height: 10 }, 16);
    expect(dists[0]).toBeCloseTo(0, 5); // (10,10) -> 0
    expect(dists[3 * 10 + 4]).toBeCloseTo(5, 5); // (14,13) -> hypot(4,3) = 5
  });

  it('renders 240x240 dirtyRect on full 3508x2480 canvas rapidly and matches chunked renderFull bit-for-bit across 256x256 seams', () => {
    const doc = createEmptyDocument({ widthPx: 3508, heightPx: 2480, seed: 173 });
    const session = new TerrainStrokeSession();

    // Straddle the 256x256 internal renderer chunk boundary around px (256, 256) -> doc (217, 217)
    // as well as (512, 512) -> doc (434, 434)
    session.beginStroke(doc, { tool: 'land', diameterDoc: 180, intensity: 1.0 }, 175, 190);
    session.addPoint(doc, 275, 255);
    session.commit(doc);

    session.beginStroke(doc, { tool: 'raise', diameterDoc: 120, intensity: 1.0 }, 200, 210);
    session.addPoint(doc, 240, 230);
    session.commit(doc);

    const renderer = new TerrainRenderer();
    renderer.renderFull(doc);

    // Apply forest across the 256x256 chunk seam and test incremental renderRegion speed & bit-exactness
    session.beginStroke(doc, { tool: 'forest', diameterDoc: 120, intensity: 1.0 }, 190, 210);
    session.addPoint(doc, 250, 225);
    const forestRes = session.commit(doc)!;
    expect(forestRes).not.toBeNull();

    const t0 = performance.now();
    renderer.renderRegion(doc, {
      x: Math.max(0, forestRes.dirtyRect.x - 40),
      y: Math.max(0, forestRes.dirtyRect.y - 40),
      width: 240,
      height: 240
    });
    const elapsedMs = performance.now() - t0;
    expect(elapsedMs).toBeLessThan(100);

    const fullRef = new TerrainRenderer();
    fullRef.renderFull(doc);
    expect(countByteMismatches(renderer.getPixelData().rgba, fullRef.getPixelData().rgba)).toBe(0);

    renderer.dispose();
    fullRef.dispose();
    expect(renderer.getPixelData().rgba.length).toBe(0);
    expect(renderer.getCanvas()).toBeNull();
  });

  it('tracks document freshness via matchesDocument across terrainVersion, id, theme, size, and dispose', () => {
    const doc = createEmptyDocument({ widthPx: 594, heightPx: 420, seed: 173 });
    const renderer = new TerrainRenderer();

    expect(renderer.matchesDocument(doc)).toBe(false);

    renderer.renderFull(doc);
    expect(renderer.matchesDocument(doc)).toBe(true);

    // terrainVersion bump invalidates freshness until renderRegion or renderFull catches up
    const session = new TerrainStrokeSession();
    session.beginStroke(doc, { tool: 'land', diameterDoc: 80, intensity: 1.0 }, 400, 400);
    const res = session.commit(doc)!;
    expect(res).not.toBeNull();
    doc.terrainVersion += 1;
    expect(renderer.matchesDocument(doc)).toBe(false);

    renderer.renderRegion(doc, res.dirtyRect);
    expect(renderer.matchesDocument(doc)).toBe(true);

    // Empty / out-of-bounds dirtyRect with matching id & theme also keeps terrainVersion current
    doc.terrainVersion += 1;
    expect(renderer.matchesDocument(doc)).toBe(false);
    renderer.renderRegion(doc, { x: -50, y: -50, width: 10, height: 10 });
    expect(renderer.matchesDocument(doc)).toBe(true);

    // Document ID change invalidates freshness and recovers on renderRegion / renderFull
    const prevId = doc.manifest.id;
    doc.manifest.id = 'other-document-id';
    expect(renderer.matchesDocument(doc)).toBe(false);
    renderer.renderFull(doc);
    expect(renderer.matchesDocument(doc)).toBe(true);

    doc.manifest.id = prevId;
    expect(renderer.matchesDocument(doc)).toBe(false);
    renderer.renderRegion(doc, res.dirtyRect);
    expect(renderer.matchesDocument(doc)).toBe(true);

    // Theme change (both preset switch and inline color mutation) invalidates freshness
    doc.theme = V1_FLAT_THEME;
    expect(renderer.matchesDocument(doc)).toBe(false);
    renderer.renderFull(doc);
    expect(renderer.matchesDocument(doc)).toBe(true);

    const mutatedTheme = cloneTheme(V1_FLAT_THEME);
    mutatedTheme.colors.sea = '#112233';
    doc.theme = mutatedTheme;
    expect(renderer.matchesDocument(doc)).toBe(false);
    renderer.renderFull(doc);
    expect(renderer.matchesDocument(doc)).toBe(true);

    // Dimension mismatch invalidates freshness
    const otherDimDoc = createEmptyDocument({ id: doc.manifest.id, widthPx: 300, heightPx: 210 });
    otherDimDoc.terrainVersion = doc.terrainVersion;
    otherDimDoc.theme = doc.theme;
    expect(renderer.matchesDocument(otherDimDoc)).toBe(false);

    // Disposed renderer never matches
    renderer.dispose();
    expect(renderer.matchesDocument(doc)).toBe(false);
  });

  it('maintains 256x256 tile canvases incrementally, culls drawToCanvasContext, blits lazily in getCanvas, and cleans up on dispose', () => {
    interface MockCanvasRecord {
      width: number;
      height: number;
      rgba: Uint8ClampedArray;
      putImageDataCalls: Array<{ dx: number; dy: number; dirtyW: number; dirtyH: number }>;
      drawImageCalls: Array<{ src: MockCanvasRecord; dx: number; dy: number; dw: number; dh: number }>;
      canvas: HTMLCanvasElement;
    }

    const createdCanvases: MockCanvasRecord[] = [];
    const makeMockCanvas = (): MockCanvasRecord => {
      const record: MockCanvasRecord = {
        width: 0,
        height: 0,
        rgba: new Uint8ClampedArray(0),
        putImageDataCalls: [],
        drawImageCalls: [],
        canvas: null as unknown as HTMLCanvasElement
      };

      const ctx = {
        createImageData: (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4)
        }),
        putImageData: (
          imgData: ImageData,
          dx: number,
          dy: number,
          dirtyX = 0,
          dirtyY = 0,
          dirtyW = imgData.width,
          dirtyH = imgData.height
        ) => {
          record.putImageDataCalls.push({ dx, dy, dirtyW, dirtyH });
          for (let sy = dirtyY; sy < dirtyY + dirtyH; sy += 1) {
            const dstY = dy + sy;
            if (dstY < 0 || dstY >= record.height) continue;
            for (let sx = dirtyX; sx < dirtyX + dirtyW; sx += 1) {
              const dstX = dx + sx;
              if (dstX < 0 || dstX >= record.width) continue;
              const sOff = (sy * imgData.width + sx) * 4;
              const dOff = (dstY * record.width + dstX) * 4;
              record.rgba[dOff] = imgData.data[sOff];
              record.rgba[dOff + 1] = imgData.data[sOff + 1];
              record.rgba[dOff + 2] = imgData.data[sOff + 2];
              record.rgba[dOff + 3] = imgData.data[sOff + 3];
            }
          }
        },
        drawImage: (srcCanvas: HTMLCanvasElement, dx: number, dy: number, dw: number, dh: number) => {
          const srcRec = createdCanvases.find((c) => c.canvas === srcCanvas)!;
          record.drawImageCalls.push({ src: srcRec, dx, dy, dw, dh });
        }
      } as unknown as CanvasRenderingContext2D;

      const canvasObj = {
        get width() {
          return record.width;
        },
        set width(v: number) {
          record.width = v;
          record.rgba = new Uint8ClampedArray(Math.max(0, record.width) * Math.max(0, record.height) * 4);
        },
        get height() {
          return record.height;
        },
        set height(v: number) {
          record.height = v;
          record.rgba = new Uint8ClampedArray(Math.max(0, record.width) * Math.max(0, record.height) * 4);
        },
        getContext: (kind: string) => (kind === '2d' ? ctx : null)
      } as unknown as HTMLCanvasElement;

      record.canvas = canvasObj;
      createdCanvases.push(record);
      return record;
    };

    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'canvas') return makeMockCanvas().canvas;
        throw new Error(`Unexpected tag: ${tag}`);
      }
    });

    // 600 x 400 -> 3 x 2 grid of <=256x256 tiles: widths [256, 256, 88], heights [256, 144]
    const doc = createEmptyDocument({ widthPx: 600, heightPx: 400, seed: 42 });
    const session = new TerrainStrokeSession();
    session.beginStroke(doc, { tool: 'land', diameterDoc: 240, intensity: 1.0 }, 400, 400);
    session.commit(doc);

    const renderer = new TerrainRenderer();
    renderer.renderFull(doc);

    // renderFull must NOT allocate the 600x400 monolithic canvas or unused tiles upfront
    expect(createdCanvases).toHaveLength(0);

    // drawToCanvasContext with a visible rect inside tile (0, 0) creates & draws only 1 tile
    const viewportRecord = makeMockCanvas();
    viewportRecord.canvas.width = 600;
    viewportRecord.canvas.height = 400;
    const viewportCtx = viewportRecord.canvas.getContext('2d')!;
    const scaleX = doc.manifest.space.width / 600;
    const scaleY = doc.manifest.space.height / 400;

    renderer.drawToCanvasContext(viewportCtx, doc.manifest.space, {
      x: 0,
      y: 0,
      width: 200 * scaleX,
      height: 200 * scaleY
    });

    const tileCanvasesAfterCulledDraw = createdCanvases.filter((c) => c !== viewportRecord);
    expect(tileCanvasesAfterCulledDraw).toHaveLength(1);
    expect(tileCanvasesAfterCulledDraw[0].width).toBe(256);
    expect(tileCanvasesAfterCulledDraw[0].height).toBe(256);
    expect(viewportRecord.drawImageCalls).toHaveLength(1);

    // Drawing full docSpace populates all 6 tiles with <=256x256 dimensions & contiguous coverage
    viewportRecord.drawImageCalls.length = 0;
    renderer.drawToCanvasContext(viewportCtx, doc.manifest.space);
    const allTiles = createdCanvases.filter((c) => c !== viewportRecord);
    expect(allTiles).toHaveLength(6);
    for (const t of allTiles) {
      expect(t.width).toBeLessThanOrEqual(256);
      expect(t.height).toBeLessThanOrEqual(256);
    }
    expect(viewportRecord.drawImageCalls).toHaveLength(6);

    // Verify contiguous dest rects across the 3x2 grid
    const totalCoveredArea = viewportRecord.drawImageCalls.reduce((sum, c) => sum + c.dw * c.dh, 0);
    expect(totalCoveredArea).toBeCloseTo(doc.manifest.space.width * doc.manifest.space.height, 4);

    // Verify getCanvas() lazily creates the 600x400 canvas and matches RGBA buffer bit-for-bit
    const fullCanvas = renderer.getCanvas()!;
    expect(fullCanvas).not.toBeNull();
    const fullRecord = createdCanvases.find((c) => c.canvas === fullCanvas)!;
    expect(fullRecord.width).toBe(600);
    expect(fullRecord.height).toBe(400);
    expect(countByteMismatches(fullRecord.rgba, renderer.getPixelData().rgba)).toBe(0);

    // Reset call counters and apply a small brush stroke strictly inside tile (0, 0)
    fullRecord.putImageDataCalls.length = 0;
    for (const t of allTiles) {
      t.putImageDataCalls.length = 0;
    }

    session.beginStroke(doc, { tool: 'raise', diameterDoc: 40, intensity: 1.0 }, 400, 400);
    const raiseRes = session.commit(doc)!;
    expect(raiseRes).not.toBeNull();
    doc.terrainVersion += 1;
    renderer.renderRegion(doc, raiseRes.dirtyRect);

    // Monolithic canvas must NEVER be touched during renderRegion
    expect(fullRecord.putImageDataCalls).toHaveLength(0);

    // Only tile (0, 0) (1-4 tiles max) was updated with partial <=256x256 ImageData
    const updatedTiles = allTiles.filter((t) => t.putImageDataCalls.length > 0);
    expect(updatedTiles.length).toBeGreaterThanOrEqual(1);
    expect(updatedTiles.length).toBeLessThanOrEqual(4);
    for (const ut of updatedTiles) {
      for (const call of ut.putImageDataCalls) {
        expect(call.dirtyW).toBeLessThanOrEqual(256);
        expect(call.dirtyH).toBeLessThanOrEqual(256);
      }
    }

    // Calling getCanvas() after renderRegion blits ONLY the dirty tiles (not all 6)
    renderer.getCanvas();
    expect(fullRecord.putImageDataCalls.length).toBe(updatedTiles.length);
    expect(countByteMismatches(fullRecord.rgba, renderer.getPixelData().rgba)).toBe(0);

    // Calling getCanvas() again without further edits does zero extra blits
    fullRecord.putImageDataCalls.length = 0;
    renderer.getCanvas();
    expect(fullRecord.putImageDataCalls).toHaveLength(0);

    // dispose() frees full canvas and every 256x256 tile canvas
    renderer.dispose();
    expect(fullRecord.width).toBe(0);
    expect(fullRecord.height).toBe(0);
    for (const t of allTiles) {
      expect(t.width).toBe(0);
      expect(t.height).toBe(0);
    }
  });

  it('renders sample world document and flat theme cleanly', () => {
    const sample = createSampleWorldDocument();
    const renderer = new TerrainRenderer();
    renderer.renderFull(sample);
    const reactiveRgba = new Uint8ClampedArray(renderer.getPixelData().rgba);
    expect(reactiveRgba.length).toBe(sample.terrain.widthPx * sample.terrain.heightPx * 4);

    sample.theme = V1_FLAT_THEME;
    renderer.renderFull(sample);
    const flatRgba = renderer.getPixelData().rgba;
    expect(countByteMismatches(reactiveRgba, flatRgba)).toBeGreaterThan(1000);
    renderer.dispose();
  });

  it('supports flatten (auto-sampled & explicit target), smooth (3x3 land-only minimal patches), and land mask >= 128 guard', () => {
    const doc = createEmptyDocument({ widthPx: 297, heightPx: 210, seed: 11 });
    const { widthPx, mask, height, cover } = doc.terrain;
    const session = new TerrainStrokeSession();

    // Sea on x < 60, fractional AA water edge at x = 60..64 (mask = 100 < 128), land at x >= 65
    for (let y = 20; y < 190; y += 1) {
      for (let x = 60; x < 260; x += 1) {
        const idx = y * widthPx + x;
        if (x < 65) {
          mask[idx] = 100; // < LAND_MASK_THRESHOLD (128)
          height[idx] = 10;
        } else {
          mask[idx] = 255;
          height[idx] = x < 120 ? 150 : x < 180 ? 40 : 230;
        }
      }
    }

    // 1) All elevation & cover tools must ignore mask < 128 (sea & sub-threshold edge)
    session.beginStroke(doc, { tool: 'raise', diameterDoc: 80, intensity: 1.0 }, 620, 1050);
    session.commit(doc);
    session.beginStroke(doc, { tool: 'brick', diameterDoc: 80, intensity: 1.0 }, 620, 1050);
    session.commit(doc);
    for (let y = 20; y < 190; y += 1) {
      const edgeIdx = y * widthPx + 62;
      expect(height[edgeIdx]).toBe(10);
      expect(cover[edgeIdx]).toBe(COVER_NATURAL);
      expect(height[y * widthPx + 30]).toBe(0);
      expect(cover[y * widthPx + 30]).toBe(COVER_NATURAL);
    }

    // 2) Flatten without targetHeight samples height at start point (x=100 px -> 1000 u, h=150)
    // and flattens valley (40) & peak (230) toward 150 while keeping sea untouched
    session.beginStroke(doc, { tool: 'flatten', diameterDoc: 160, intensity: 1.0 }, 1000, 1050);
    session.addPoint(doc, 2150, 1050);
    const flattenRes = session.commit(doc)!;
    expect(flattenRes).not.toBeNull();
    expect(height[105 * widthPx + 150]).toBe(150);
    expect(height[105 * widthPx + 200]).toBe(150);
    expect(height[105 * widthPx + 30]).toBe(0);

    // Flatten with explicit targetHeight when starting on coastal water near land
    session.beginStroke(
      doc,
      { tool: 'flatten', diameterDoc: 100, intensity: 1.0, targetHeight: 92 },
      640,
      1050
    );
    session.addPoint(doc, 720, 1050);
    const explicitFlattenRes = session.commit(doc)!;
    expect(explicitFlattenRes).not.toBeNull();
    expect(height[105 * widthPx + 66]).toBe(92);
    expect(height[105 * widthPx + 62]).toBe(10); // mask=100 untouched

    // Flatten starting on water adjacent to land samples nearest land height when targetHeight omitted
    const coastalSampleDoc = createEmptyDocument({ widthPx: 297, heightPx: 210, seed: 12 });
    for (let y = 40; y < 160; y += 1) {
      for (let x = 100; x < 220; x += 1) {
        coastalSampleDoc.terrain.mask[y * 297 + x] = 255;
        coastalSampleDoc.terrain.height[y * 297 + x] = x < 110 ? 120 : 40;
      }
    }
    session.beginStroke(
      coastalSampleDoc,
      { tool: 'flatten', diameterDoc: 240, intensity: 1.0 },
      950,
      1000
    );
    session.addPoint(coastalSampleDoc, 1450, 1000);
    session.commit(coastalSampleDoc);
    expect(coastalSampleDoc.terrain.height[100 * 297 + 130]).toBe(120);

    // 3) Smooth: flat terrain yields null (minimal patch skipping), spike smooths isotropically without dragging coast down
    const smoothDoc = createEmptyDocument({ widthPx: 297, heightPx: 210, seed: 13 });
    for (let y = 40; y < 170; y += 1) {
      for (let x = 40; x < 250; x += 1) {
        smoothDoc.terrain.mask[y * 297 + x] = 255;
        smoothDoc.terrain.height[y * 297 + x] = 80;
      }
    }
    // Flat interior + flat coastline (3x3 excludes water, so coast stays 80!) -> must produce null commit
    session.beginStroke(smoothDoc, { tool: 'smooth', diameterDoc: 120, intensity: 1.0 }, 1500, 1050);
    expect(session.commit(smoothDoc)).toBeNull();
    session.beginStroke(smoothDoc, { tool: 'smooth', diameterDoc: 120, intensity: 1.0 }, 410, 1050);
    expect(session.commit(smoothDoc)).toBeNull();

    // Introduce isolated spike at (150, 105) -> 240; click exact pixel center (1505, 1055)
    smoothDoc.terrain.height[105 * 297 + 150] = 240;
    const smoothDirty = session.beginStroke(
      smoothDoc,
      { tool: 'smooth', diameterDoc: 120, intensity: 1.0 },
      1505,
      1055
    );
    expect(smoothDirty).not.toBeNull();
    const smoothCommit = session.commit(smoothDoc)!;
    expect(smoothCommit).not.toBeNull();
    // Minimal dirtyRect tightly encloses only the 3x3 region around the spike (149..151 x 104..106)
    expect(smoothCommit.dirtyRect).toEqual({ x: 149, y: 104, width: 3, height: 3 });
    // Center: dist=0 => exact (4*240 + 12*80)/16 = 120; isotropic 4-way symmetry on cardinal & diagonal neighbors
    expect(smoothDoc.terrain.height[105 * 297 + 150]).toBe(120);
    const cLeft = smoothDoc.terrain.height[105 * 297 + 149];
    const cRight = smoothDoc.terrain.height[105 * 297 + 151];
    const cTop = smoothDoc.terrain.height[104 * 297 + 150];
    const cBot = smoothDoc.terrain.height[106 * 297 + 150];
    expect(cLeft).toBe(99);
    expect(cRight).toBe(cLeft);
    expect(cTop).toBe(cLeft);
    expect(cBot).toBe(cLeft);
    const dNW = smoothDoc.terrain.height[104 * 297 + 149];
    const dSE = smoothDoc.terrain.height[106 * 297 + 151];
    expect(dNW).toBe(89);
    expect(dSE).toBe(dNW);
  });

  it('responds distinctly to brush intensity (0.2 vs 0.85) across raise, lower, flatten, and smooth', () => {
    const makeIsland = (initialH: number) => {
      const d = createEmptyDocument({ widthPx: 297, heightPx: 210, seed: 21 });
      for (let y = 30; y < 180; y += 1) {
        for (let x = 30; x < 267; x += 1) {
          const idx = y * 297 + x;
          d.terrain.mask[idx] = 255;
          d.terrain.height[idx] = initialH;
        }
      }
      return d;
    };

    const runPass = (
      doc: MapDocument,
      tool: 'raise' | 'lower' | 'flatten' | 'smooth',
      intensity: number,
      targetHeight?: number
    ) => {
      const s = new TerrainStrokeSession();
      s.beginStroke(doc, { tool, diameterDoc: 120, intensity, targetHeight }, 900, 1050);
      s.addPoint(doc, 1800, 1050);
      s.commit(doc);
      return doc.terrain.height[105 * 297 + 135];
    };

    // Raise: 0.85 raises substantially more than 0.2
    const raiseLow = runPass(makeIsland(20), 'raise', 0.2);
    const raiseHigh = runPass(makeIsland(20), 'raise', 0.85);
    expect(raiseLow).toBeGreaterThan(20);
    expect(raiseHigh).toBeGreaterThan(raiseLow + 40);

    // Lower: 0.85 lowers substantially more than 0.2
    const lowerLow = runPass(makeIsland(220), 'lower', 0.2);
    const lowerHigh = runPass(makeIsland(220), 'lower', 0.85);
    expect(lowerLow).toBeLessThan(220);
    expect(lowerHigh).toBeLessThan(lowerLow - 40);

    // Flatten: 0.85 converges substantially closer to targetHeight than 0.2
    const flatLow = runPass(makeIsland(40), 'flatten', 0.2, 200);
    const flatHigh = runPass(makeIsland(40), 'flatten', 0.85, 200);
    expect(flatLow).toBeGreaterThan(40);
    expect(flatHigh).toBeGreaterThan(flatLow + 30);

    // Smooth: 0.85 pulls spike down closer to neighborhood than 0.2
    const spikeLowDoc = makeIsland(60);
    spikeLowDoc.terrain.height[105 * 297 + 135] = 240;
    const spikeHighDoc = makeIsland(60);
    spikeHighDoc.terrain.height[105 * 297 + 135] = 240;
    const s = new TerrainStrokeSession();
    s.beginStroke(spikeLowDoc, { tool: 'smooth', diameterDoc: 80, intensity: 0.2 }, 1350, 1050);
    s.commit(spikeLowDoc);
    s.beginStroke(spikeHighDoc, { tool: 'smooth', diameterDoc: 80, intensity: 0.85 }, 1350, 1050);
    s.commit(spikeHighDoc);
    expect(spikeLowDoc.terrain.height[105 * 297 + 135]).toBeLessThan(240);
    expect(spikeHighDoc.terrain.height[105 * 297 + 135]).toBeLessThan(
      spikeLowDoc.terrain.height[105 * 297 + 135] - 40
    );
  });

  it('paints and renders all 10 cover materials (0..9) distinctly and seamlessly across the 256px chunk boundary (x=255..257)', () => {
    const coverCases: ReadonlyArray<{ tool: TerrainBrushTool; code: CoverCode }> = [
      { tool: 'natural', code: COVER_NATURAL },
      { tool: 'forest', code: COVER_FOREST },
      { tool: 'fields', code: COVER_FIELDS },
      { tool: 'sand', code: COVER_SAND },
      { tool: 'brick', code: COVER_BRICK },
      { tool: 'snow', code: COVER_SNOW },
      { tool: 'swamp', code: COVER_SWAMP },
      { tool: 'rock', code: COVER_ROCK },
      { tool: 'meadow', code: COVER_MEADOW },
      { tool: 'lava', code: COVER_LAVA }
    ];

    const widthPx = 512;
    const heightPx = 320;
    const doc = createEmptyDocument({ widthPx, heightPx, seed: 314 });
    const session = new TerrainStrokeSession();

    // Land patch straddling both x=255..257 and y=255..257 chunk boundaries
    for (let y = 160; y < 300; y += 1) {
      for (let x = 180; x < 340; x += 1) {
        const idx = y * widthPx + x;
        doc.terrain.mask[idx] = 255;
        doc.terrain.height[idx] = 72;
      }
    }

    const patchSamples = new Map<CoverCode, Uint8ClampedArray>();
    const fullRenderer = new TerrainRenderer();
    const regionRenderer = new TerrainRenderer();
    const docPerPxX = doc.manifest.space.width / widthPx;
    const docPerPxY = doc.manifest.space.height / heightPx;

    for (const { tool, code } of coverCases) {
      // Pre-fill with another cover when testing 'natural' so stroke actively writes 0
      if (code === COVER_NATURAL) {
        session.beginStroke(doc, { tool: 'lava', diameterDoc: 700, intensity: 1.0 }, 256 * docPerPxX, 240 * docPerPxY);
        session.commit(doc);
      }

      session.beginStroke(
        doc,
        { tool, diameterDoc: 700, intensity: 1.0 },
        256 * docPerPxX,
        240 * docPerPxY
      );
      const res = session.commit(doc)!;
      expect(res).not.toBeNull();
      expect(doc.terrain.cover[240 * widthPx + 255]).toBe(code);
      expect(doc.terrain.cover[240 * widthPx + 256]).toBe(code);
      expect(doc.terrain.cover[240 * widthPx + 257]).toBe(code);
      expect(doc.terrain.cover[10 * widthPx + 10]).toBe(COVER_NATURAL); // sea untouched

      // 1) renderFull splits chunks at x=256 and y=256
      fullRenderer.renderFull(doc);
      const fullRgba = new Uint8ClampedArray(fullRenderer.getPixelData().rgba);
      patchSamples.set(code, fullRgba);

      // 2) Render regionRenderer with a different cover inside [240..272)x[240..272), then restore and renderRegion across both 256px seams
      const sentinelCode: CoverCode = code === COVER_LAVA ? COVER_SNOW : COVER_LAVA;
      for (let py = 240; py < 272; py += 1) {
        for (let px = 240; px < 272; px += 1) {
          doc.terrain.cover[py * widthPx + px] = sentinelCode;
        }
      }
      regionRenderer.renderFull(doc);
      expect(
        countRgbDiffs(fullRgba, regionRenderer.getPixelData().rgba, widthPx, 244, 244, 268, 268)
      ).toBeGreaterThan(100);

      for (let py = 240; py < 272; py += 1) {
        for (let px = 240; px < 272; px += 1) {
          doc.terrain.cover[py * widthPx + px] = code;
        }
      }
      regionRenderer.renderRegion(doc, { x: 240, y: 240, width: 32, height: 32 });
      const regionRgba = regionRenderer.getPixelData().rgba;

      const seamMismatches = countRgbDiffs(
        fullRgba,
        regionRgba,
        widthPx,
        240,
        240,
        272,
        272
      );
      expect(seamMismatches).toBe(0);
    }

    // Verify every pair of materials among 0..9 renders distinctly
    for (let i = 0; i < coverCases.length; i += 1) {
      for (let j = i + 1; j < coverCases.length; j += 1) {
        const a = patchSamples.get(coverCases[i].code)!;
        const b = patchSamples.get(coverCases[j].code)!;
        const diffs = countRgbDiffs(a, b, widthPx, 210, 180, 310, 280);
        expect(diffs).toBeGreaterThan(2000);
      }
    }

    fullRenderer.dispose();
    regionRenderer.dispose();
  });

  it('reallocates TerrainRenderer tile grid and caches cleanly on resize and undo', () => {
    const createdCanvases: Array<{ width: number; height: number; canvas: HTMLCanvasElement }> = [];
    const makeMockCanvas = () => {
      const rec = {
        width: 0,
        height: 0,
        rgba: new Uint8ClampedArray(0),
        canvas: null as unknown as HTMLCanvasElement
      };
      const ctx = {
        createImageData: (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4)
        }),
        putImageData: (
          imgData: ImageData,
          dx: number,
          dy: number,
          dirtyX = 0,
          dirtyY = 0,
          dirtyW = imgData.width,
          dirtyH = imgData.height
        ) => {
          for (let sy = dirtyY; sy < dirtyY + dirtyH; sy += 1) {
            const dstY = dy + sy;
            if (dstY < 0 || dstY >= rec.height) continue;
            for (let sx = dirtyX; sx < dirtyX + dirtyW; sx += 1) {
              const dstX = dx + sx;
              if (dstX < 0 || dstX >= rec.width) continue;
              const sOff = (sy * imgData.width + sx) * 4;
              const dOff = (dstY * rec.width + dstX) * 4;
              rec.rgba[dOff] = imgData.data[sOff];
              rec.rgba[dOff + 1] = imgData.data[sOff + 1];
              rec.rgba[dOff + 2] = imgData.data[sOff + 2];
              rec.rgba[dOff + 3] = imgData.data[sOff + 3];
            }
          }
        },
        drawImage: () => {}
      } as unknown as CanvasRenderingContext2D;

      rec.canvas = {
        get width() {
          return rec.width;
        },
        set width(v: number) {
          rec.width = v;
          rec.rgba = new Uint8ClampedArray(Math.max(0, rec.width) * Math.max(0, rec.height) * 4);
        },
        get height() {
          return rec.height;
        },
        set height(v: number) {
          rec.height = v;
          rec.rgba = new Uint8ClampedArray(Math.max(0, rec.width) * Math.max(0, rec.height) * 4);
        },
        getContext: (kind: string) => (kind === '2d' ? ctx : null)
      } as unknown as HTMLCanvasElement;
      createdCanvases.push(rec);
      return rec;
    };

    vi.stubGlobal('document', {
      createElement: () => makeMockCanvas().canvas
    });

    const doc = createEmptyDocument({ widthPx: 600, heightPx: 400, seed: 55 });
    const session = new TerrainStrokeSession();
    session.beginStroke(doc, { tool: 'land', diameterDoc: 300, intensity: 1.0 }, 1485, 1050);
    session.commit(doc);

    const renderer = new TerrainRenderer();
    renderer.renderFull(doc);
    const vpCtx = makeMockCanvas().canvas.getContext('2d')!;
    renderer.drawToCanvasContext(vpCtx, doc.manifest.space);
    const initialFullCanvas = renderer.getCanvas()!;
    const initialCanvasesSnapshot = createdCanvases.filter((c) => c.canvas !== vpCtx.canvas);
    expect(initialFullCanvas.width).toBe(600);
    expect(initialFullCanvas.height).toBe(400);
    const initialRgba = new Uint8ClampedArray(renderer.getPixelData().rgba);

    // Resize smaller via ResizeCanvasCommand (300x200) and re-render
    const history = new HistoryManager();
    const newSpace = { width: 1485, height: 1050 };
    const resizedTerrain = resizeTerrainBuffers(
      doc.terrain,
      doc.manifest.space,
      newSpace,
      300,
      200,
      'expand-crop',
      'center'
    );
    history.execute(
      doc,
      new ResizeCanvasCommand(
        {
          page: doc.manifest.page,
          space: doc.manifest.space,
          terrain: doc.terrain,
          objects: doc.manifest.objects
        },
        {
          page: { widthMm: 148.5, heightMm: 105 },
          space: newSpace,
          terrain: resizedTerrain,
          objects: doc.manifest.objects
        }
      )
    );

    renderer.renderFull(doc);
    expect(renderer.matchesDocument(doc)).toBe(true);
    expect(renderer.getPixelData().width).toBe(300);
    expect(renderer.getPixelData().height).toBe(200);
    expect(renderer.getPixelData().rgba.length).toBe(300 * 200 * 4);
    for (const oldRec of initialCanvasesSnapshot) {
      expect(oldRec.width).toBe(0);
      expect(oldRec.height).toBe(0);
    }

    const resizedFullCanvas = renderer.getCanvas()!;
    expect(resizedFullCanvas).not.toBe(initialFullCanvas);
    expect(resizedFullCanvas.width).toBe(300);
    expect(resizedFullCanvas.height).toBe(200);
    renderer.drawToCanvasContext(vpCtx, doc.manifest.space);

    // Undo resize back to 600x400 and verify exact recovery
    history.undo(doc);
    renderer.renderFull(doc);
    expect(renderer.getPixelData().width).toBe(600);
    expect(renderer.getPixelData().height).toBe(400);
    expect(countByteMismatches(renderer.getPixelData().rgba, initialRgba)).toBe(0);
    expect(renderer.getCanvas()!.width).toBe(600);
    expect(renderer.getCanvas()!.height).toBe(400);
    renderer.dispose();
  });

  it('resizes terrain buffers via expand-crop and scale-content (nearest-neighbor cover, clean mask/height)', () => {
    const beforeSpace = { width: 1000, height: 800 };
    const before = {
      widthPx: 100,
      heightPx: 80,
      mask: new Uint8Array(100 * 80),
      height: new Uint8Array(100 * 80),
      cover: new Uint8Array(100 * 80)
    };

    // Left land patch has COVER_FOREST (1), right land patch has COVER_LAVA (9)
    for (let y = 20; y < 60; y += 1) {
      for (let x = 20; x < 80; x += 1) {
        const idx = y * 100 + x;
        before.mask[idx] = 255;
        before.height[idx] = x < 50 ? 80 : 180;
        before.cover[idx] = x < 50 ? COVER_FOREST : COVER_LAVA;
      }
    }

    // 1) expand-crop with 'center' anchor
    const expanded = resizeTerrainBuffers(
      before,
      beforeSpace,
      { width: 2000, height: 1600 },
      200,
      160,
      'expand-crop',
      'center'
    );
    expect(expanded.widthPx).toBe(200);
    expect(expanded.heightPx).toBe(160);
    // Old (0,0) shifts to (50, 40) -> old (20,20) lands at (70, 60)
    expect(expanded.mask[60 * 200 + 70]).toBe(255);
    expect(expanded.height[60 * 200 + 70]).toBe(80);
    expect(expanded.cover[60 * 200 + 70]).toBe(COVER_FOREST);
    expect(expanded.cover[60 * 200 + 100]).toBe(COVER_LAVA);
    // Margin filled with sea (0)
    expect(expanded.mask[10 * 200 + 10]).toBe(0);
    expect(expanded.height[10 * 200 + 10]).toBe(0);
    expect(expanded.cover[10 * 200 + 10]).toBe(COVER_NATURAL);

    // expand-crop with 'bottom-right' anchor
    const brExpanded = resizeTerrainBuffers(
      before,
      beforeSpace,
      { width: 1500, height: 1200 },
      150,
      120,
      'expand-crop',
      'bottom-right'
    );
    // Old (20,20) shifts by (+50, +40) -> (70, 60)
    expect(brExpanded.mask[60 * 150 + 70]).toBe(255);
    expect(brExpanded.cover[60 * 150 + 129]).toBe(COVER_LAVA);
    expect(brExpanded.mask[10 * 150 + 10]).toBe(0);

    // 2) scale-content upscale (2x)
    const upscaled = resizeTerrainBuffers(
      before,
      beforeSpace,
      { width: 2000, height: 1600 },
      200,
      160,
      'scale-content',
      'center'
    );
    for (let i = 0; i < upscaled.cover.length; i += 1) {
      const c = upscaled.cover[i];
      // Nearest-neighbor MUST NEVER blend COVER_FOREST (1) and COVER_LAVA (9) into intermediate codes (e.g. 5)
      expect(c === COVER_NATURAL || c === COVER_FOREST || c === COVER_LAVA).toBe(true);
    }
    expect(upscaled.mask[80 * 200 + 60]).toBe(255);
    expect(upscaled.height[80 * 200 + 60]).toBe(80);
    expect(upscaled.cover[80 * 200 + 60]).toBe(COVER_FOREST);
    expect(upscaled.height[80 * 200 + 130]).toBe(180);
    expect(upscaled.cover[80 * 200 + 130]).toBe(COVER_LAVA);
    expect(upscaled.mask[10 * 200 + 10]).toBe(0);

    // 3) scale-content >2x downscale (100x80 -> 25x20)
    const downscaled = resizeTerrainBuffers(
      before,
      beforeSpace,
      { width: 250, height: 200 },
      25,
      20,
      'scale-content',
      'top-left'
    );
    for (let i = 0; i < downscaled.cover.length; i += 1) {
      const c = downscaled.cover[i];
      expect(c === COVER_NATURAL || c === COVER_FOREST || c === COVER_LAVA).toBe(true);
    }
    expect(downscaled.mask[10 * 25 + 8]).toBe(255);
    expect(downscaled.height[10 * 25 + 8]).toBe(80);
    expect(downscaled.cover[10 * 25 + 8]).toBe(COVER_FOREST);
    expect(downscaled.mask[10 * 25 + 16]).toBe(255);
    expect(downscaled.height[10 * 25 + 16]).toBe(180);
    expect(downscaled.cover[10 * 25 + 16]).toBe(COVER_LAVA);
    expect(downscaled.mask[2 * 25 + 2]).toBe(0);
  });

  it('sculpts jagged peaked ridges with raise (never plateauing at 255) and flat mesas with dedicated plateau tool', () => {
    const doc = createEmptyDocument({ widthPx: 256, heightPx: 256 });
    doc.terrain.mask.fill(255);
    doc.terrain.height.fill(40);
    doc.terrain.cover.fill(COVER_NATURAL);

    const session = new TerrainStrokeSession();
    const cx = doc.manifest.space.width * 0.5;
    const cy = doc.manifest.space.height * 0.5;

    // 15 repeated high-intensity passes of `raise` across center
    for (let pass = 0; pass < 15; pass += 1) {
      session.beginStroke(
        doc,
        { tool: 'raise', diameterDoc: 280, intensity: 1.0, brushMode: 'smart', roughness: 0.65 },
        cx - 40,
        cy
      );
      session.addPoint(doc, cx + 40, cy);
      session.commit(doc);
    }

    // Analyze center disk
    const heights: number[] = [];
    let maxH = 0;
    let exact255 = 0;
    for (let y = 96; y < 160; y += 1) {
      for (let x = 96; x < 160; x += 1) {
        const h = doc.terrain.height[y * 256 + x];
        heights.push(h);
        if (h > maxH) maxH = h;
        if (h === 255) exact255 += 1;
      }
    }
    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    const variance =
      heights.reduce((acc, h) => acc + (h - mean) * (h - mean), 0) / heights.length;
    const stdDev = Math.sqrt(variance);
    const frac255 = exact255 / heights.length;

    expect(maxH).toBeGreaterThan(200);
    expect(stdDev).toBeGreaterThan(15);
    expect(frac255).toBeLessThan(0.15);

    // Now test dedicated `plateau` tool on a flat island quadrant
    const pDoc = createEmptyDocument({ widthPx: 256, heightPx: 256 });
    pDoc.terrain.mask.fill(255);
    pDoc.terrain.height.fill(40);
    pDoc.terrain.cover.fill(COVER_NATURAL);
    const beforePlateau = snapshotTerrain(pDoc);

    for (let pass = 0; pass < 4; pass += 1) {
      session.beginStroke(
        pDoc,
        {
          tool: 'plateau',
          diameterDoc: 260,
          intensity: 1.0,
          brushMode: 'smart',
          roughness: 0.5,
          targetHeight: 190
        },
        cx,
        cy
      );
      const res = session.commit(pDoc);
      if (pass === 0) {
        expect(res).not.toBeNull();
      }
    }

    const coreSamples: number[] = [];
    for (let y = 122; y <= 134; y += 1) {
      for (let x = 122; x <= 134; x += 1) {
        coreSamples.push(pDoc.terrain.height[y * 256 + x]);
      }
    }
    const coreMin = Math.min(...coreSamples);
    const coreMax = Math.max(...coreSamples);
    expect(coreMin).toBeGreaterThanOrEqual(182);
    expect(coreMax).toBeLessThanOrEqual(196);

    // Undo / Redo check for single plateau stroke
    const pDoc2 = createEmptyDocument({ widthPx: 256, heightPx: 256 });
    pDoc2.terrain.mask.fill(255);
    pDoc2.terrain.height.fill(40);
    session.beginStroke(
      pDoc2,
      {
        tool: 'plateau',
        diameterDoc: 200,
        intensity: 0.85,
        brushMode: 'smart',
        targetHeight: 190
      },
      cx,
      cy
    );
    const commitRes = session.commit(pDoc2)!;
    const afterStroke = snapshotTerrain(pDoc2);
    const history = new HistoryManager();
    history.execute(pDoc2, commitRes.command, { alreadyApplied: true });
    history.undo(pDoc2);
    expect(countByteMismatches(pDoc2.terrain.height, beforePlateau.height)).toBe(0);
    history.redo(pDoc2);
    expect(countByteMismatches(pDoc2.terrain.height, afterStroke.height)).toBe(0);
  });

  it('produces ragged coastlines and context-aware relief/covers in smart brush mode, matching renderRegion vs renderFull', () => {
    const doc = createEmptyDocument({ widthPx: 256, heightPx: 256 });
    doc.theme = cloneTheme(WITCHER_THEME);
    const session = new TerrainStrokeSession();
    const cx = doc.manifest.space.width * 0.5;
    const cy = doc.manifest.space.height * 0.5;

    // 1. Smart land paint creates land with organic relief (height > 0) and rough coastline
    session.beginStroke(
      doc,
      { tool: 'land', diameterDoc: 420, intensity: 1.0, brushMode: 'smart', roughness: 0.75 },
      cx,
      cy
    );
    session.commit(doc);

    let landCells = 0;
    let positiveHeightCells = 0;
    let perimeterDiffersFromCircle = false;
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 256; x += 1) {
        const i = y * 256 + x;
        if (doc.terrain.mask[i] >= 128) {
          landCells += 1;
          if (doc.terrain.height[i] > 0) positiveHeightCells += 1;
        }
      }
    }
    expect(landCells).toBeGreaterThan(200);
    expect(positiveHeightCells).toBeGreaterThan(landCells * 0.7);

    // Check coastline isn't an exact smooth circle
    const ringRadius = (doc.manifest.space.width * 0.5) / 256;
    const testRDoc = 200;
    const angles = 24;
    const ringStates: boolean[] = [];
    for (let a = 0; a < angles; a += 1) {
      const ang = (a / angles) * Math.PI * 2;
      const cell = inspectCellAtDoc(doc, cx + Math.cos(ang) * testRDoc, cy + Math.sin(ang) * testRDoc)!;
      ringStates.push(cell.mask >= 128);
    }
    if (ringRadius > 0) {
      perimeterDiffersFromCircle = ringStates.some(Boolean) && ringStates.some((v) => !v);
    }
    expect(perimeterDiffersFromCircle).toBe(true);

    // 2. Smart raise vs smart water cliff/shore grading
    doc.terrain.mask.fill(255);
    doc.terrain.height.fill(190); // high mountain block
    session.beginStroke(
      doc,
      { tool: 'water', diameterDoc: 160, intensity: 1.0, brushMode: 'smart', roughness: 0.65 },
      cx,
      cy
    );
    session.commit(doc);
    // Center carved to 0, nearby mountain cliff stays > 160
    expect(inspectCellAtDoc(doc, cx, cy)!.mask).toBe(0);
    expect(inspectCellAtDoc(doc, cx + 105, cy)!.height).toBeGreaterThan(160);

    // 3. Smart Forest / Fields / Sand near shore on WITCHER_THEME produce zero region vs full mismatch
    doc.terrain.mask.fill(0);
    session.beginStroke(
      doc,
      { tool: 'land', diameterDoc: 500, intensity: 1.0, brushMode: 'smart', roughness: 0.6 },
      cx,
      cy
    );
    session.commit(doc);
    session.beginStroke(
      doc,
      { tool: 'forest', diameterDoc: 180, intensity: 1.0, brushMode: 'smart' },
      cx - 80,
      cy
    );
    const forestRes = session.commit(doc)!;
    session.beginStroke(
      doc,
      { tool: 'fields', diameterDoc: 180, intensity: 1.0, brushMode: 'smart' },
      cx + 80,
      cy
    );
    const fieldsRes = session.commit(doc)!;
    session.beginStroke(
      doc,
      { tool: 'sand', diameterDoc: 140, intensity: 1.0, brushMode: 'smart' },
      cx,
      cy + 80
    );
    const sandRes = session.commit(doc)!;

    expect(inspectCellAtDoc(doc, cx - 80, cy)!.cover).toBe(COVER_FOREST);
    expect(inspectCellAtDoc(doc, cx + 80, cy)!.cover).toBe(COVER_FIELDS);
    expect(inspectCellAtDoc(doc, cx, cy + 80)!.cover).toBe(COVER_SAND);

    const dirtyAll = {
      x: Math.min(forestRes.dirtyRect.x, fieldsRes.dirtyRect.x, sandRes.dirtyRect.x),
      y: Math.min(forestRes.dirtyRect.y, fieldsRes.dirtyRect.y, sandRes.dirtyRect.y),
      width: 256,
      height: 256
    };
    const rRegion = new TerrainRenderer();
    rRegion.renderFull(doc);
    rRegion.renderRegion(doc, {
      x: Math.max(0, dirtyAll.x),
      y: Math.max(0, dirtyAll.y),
      width: Math.min(256 - Math.max(0, dirtyAll.x), dirtyAll.width),
      height: Math.min(256 - Math.max(0, dirtyAll.y), dirtyAll.height)
    });
    const rFull = new TerrainRenderer();
    rFull.renderFull(doc);
    expect(countByteMismatches(rRegion.getPixelData().rgba, rFull.getPixelData().rgba)).toBe(0);
    rRegion.dispose();
    rFull.dispose();
  });

  it('generates deterministic continents across all 4 presets with 1-step undo/redo', () => {
    for (const preset of WORLD_GENERATOR_PRESETS) {
      const docA = createEmptyDocument({ widthPx: 192, heightPx: 192 });
      const docB = createEmptyDocument({ widthPx: 192, heightPx: 192 });
      const opts = {
        preset: preset.id,
        seed: 4219,
        seaLevelPercent: preset.defaultSeaLevelPercent,
        mountainStrengthPercent: preset.defaultMountainPercent,
        coastRoughnessPercent: preset.defaultRoughnessPercent,
        biomeRichnessPercent: preset.defaultBiomePercent
      };

      const resA = generateProceduralWorldTerrain(docA, opts);
      const resB = generateProceduralWorldTerrain(docB, opts);
      expect(countByteMismatches(docA.terrain.mask, docB.terrain.mask)).toBe(0);
      expect(countByteMismatches(docA.terrain.height, docB.terrain.height)).toBe(0);
      expect(countByteMismatches(docA.terrain.cover, docB.terrain.cover)).toBe(0);

      let landCount = 0;
      let seaCount = 0;
      let maxH = 0;
      const coversSeen = new Set<number>();
      for (let i = 0; i < docA.terrain.mask.length; i += 1) {
        if (docA.terrain.mask[i] >= 128) {
          landCount += 1;
          if (docA.terrain.height[i] > maxH) maxH = docA.terrain.height[i];
          coversSeen.add(docA.terrain.cover[i]);
        } else {
          seaCount += 1;
        }
      }
      expect(landCount).toBeGreaterThan(200);
      expect(seaCount).toBeGreaterThan(200);
      expect(maxH).toBeGreaterThan(150);
      expect(coversSeen.size).toBeGreaterThanOrEqual(3);

      // 1-step undo back to empty ocean, redo restores bit-identically
      const generatedSnap = snapshotTerrain(docA);
      const history = new HistoryManager();
      history.execute(docA, resA.command, { alreadyApplied: true });
      expect(history.undo(docA)).not.toBeNull();
      expect(docA.terrain.mask.every((v) => v === 0)).toBe(true);
      expect(history.redo(docA)).not.toBeNull();
      expect(countByteMismatches(docA.terrain.mask, generatedSnap.mask)).toBe(0);
      expect(countByteMismatches(docA.terrain.height, generatedSnap.height)).toBe(0);
      expect(countByteMismatches(docA.terrain.cover, generatedSnap.cover)).toBe(0);
      expect(resB.dirtyRect.width).toBeGreaterThan(0);
    }
  });

  it('maintains channel-aware renderRegion bit-parity against renderFull and renders interactive 1754x1240 drags quickly', () => {
    const doc = createEmptyDocument({ widthPx: 1754, heightPx: 1240 });
    doc.theme = cloneTheme(WITCHER_THEME);
    const session = new TerrainStrokeSession();
    const renderer = new TerrainRenderer();
    renderer.renderFull(doc);

    const cx = doc.manifest.space.width * 0.5;
    const cy = doc.manifest.space.height * 0.5;

    // Paint initial continent under center so land covers & height strokes have real coastal + forest neighbors
    session.beginStroke(
      doc,
      { tool: 'land', diameterDoc: 900, intensity: 1.0, brushMode: 'smart', roughness: 0.7 },
      cx,
      cy
    );
    const baseDirty = session.commit(doc)!.dirtyRect;
    renderer.renderRegion(doc, baseDirty);

    // 10-step smart forest drag + 10-step raise drag + 10-step fields drag with tight channel masks
    const runTimedDrag = (
      tool: TerrainBrushTool,
      channels: number,
      x0: number,
      y0: number,
      x1: number,
      y1: number
    ) => {
      const t0 = performance.now();
      const firstDirty = session.beginStroke(
        doc,
        { tool, diameterDoc: 200, intensity: 0.85, brushMode: 'smart', roughness: 0.65 },
        x0,
        y0
      );
      if (firstDirty) renderer.renderRegion(doc, firstDirty, channels);
      for (let s = 1; s <= 10; s += 1) {
        const f = s / 10;
        const d = session.addPoint(doc, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
        if (d) renderer.renderRegion(doc, d, channels);
      }
      session.commit(doc);
      return performance.now() - t0;
    };

    const forestMs = runTimedDrag(
      'forest',
      TERRAIN_DIRTY_COVER | TERRAIN_DIRTY_FOREST,
      cx - 220,
      cy - 80,
      cx + 120,
      cy + 80
    );
    const raiseMs = runTimedDrag(
      'raise',
      TERRAIN_DIRTY_HEIGHT,
      cx - 120,
      cy - 120,
      cx + 180,
      cy + 60
    );
    const fieldsMs = runTimedDrag(
      'fields',
      TERRAIN_DIRTY_COVER | TERRAIN_DIRTY_HEIGHT | TERRAIN_DIRTY_FOREST,
      cx - 80,
      cy + 40,
      cx + 220,
      cy + 140
    );

    const avgPerStepMs = (forestMs + raiseMs + fieldsMs) / 33;
    expect(avgPerStepMs).toBeLessThan(65);

    const refRenderer = new TerrainRenderer();
    refRenderer.renderFull(doc);
    expect(
      countByteMismatches(renderer.getPixelData().rgba, refRenderer.getPixelData().rgba)
    ).toBe(0);

    renderer.dispose();
    refRenderer.dispose();
  });

  it('adapts all smart cover brushes intelligently to shores, slopes, peaks, basins, parcels, blocks, and sea contact', () => {
    const doc = createEmptyDocument({ widthPx: 256, heightPx: 256 });
    const session = new TerrainStrokeSession();
    const cx = doc.manifest.space.width * 0.5;
    const cy = doc.manifest.space.height * 0.5;

    // 1. Foresta avoids extreme alpine peak (> 218), preserves outer brick towns, and stays off immediate surf sand
    doc.terrain.mask.fill(255);
    doc.terrain.height.fill(40);
    doc.terrain.cover.fill(COVER_NATURAL);
    // Clear left 24px into sea for coastal shore check
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        doc.terrain.mask[y * 256 + x] = 0;
        doc.terrain.height[y * 256 + x] = 0;
      }
    }
    // Place low sandy shore right at x=64..68 (within shoreNearPx)
    for (let y = 100; y <= 156; y += 1) {
      for (let x = 64; x <= 66; x += 1) {
        doc.terrain.height[y * 256 + x] = 20;
      }
    }
    // Alpine peak block inside outer edge of stroke around x=165..175, y=120..136
    for (let y = 118; y <= 138; y += 1) {
      for (let x = 165; x <= 178; x += 1) {
        doc.terrain.height[y * 256 + x] = 230;
      }
    }
    // Brick settlement cell inside outer edge at x=186..194, y=124..132 (normDist ~ 0.72 > 0.48)
    for (let y = 124; y <= 132; y += 1) {
      for (let x = 186; x <= 194; x += 1) {
        doc.terrain.cover[y * 256 + x] = COVER_BRICK;
      }
    }

    const shoreCenterDocX = (128 / 256) * doc.manifest.space.width;
    const shoreCenterDocY = (128 / 256) * doc.manifest.space.height;
    session.beginStroke(
      doc,
      { tool: 'forest', diameterDoc: 2000, intensity: 1.0, brushMode: 'smart', roughness: 0.75 },
      shoreCenterDocX,
      shoreCenterDocY
    );
    session.commit(doc);

    expect(doc.terrain.cover[128 * 256 + 128]).toBe(COVER_FOREST); // interior plain gets forest
    expect(doc.terrain.cover[128 * 256 + 64]).toBe(COVER_NATURAL); // immediate low surf shore preserved
    expect(doc.terrain.cover[128 * 256 + 170]).toBe(COVER_NATURAL); // extreme alpine peak kept free
    expect(doc.terrain.cover[128 * 256 + 190]).toBe(COVER_BRICK); // outer masonry preserved

    // 2. Campi refuses steep slopes (> 28) / high peaks (> 175) outside click core while settling moderate plain
    doc.terrain.mask.fill(255);
    doc.terrain.cover.fill(COVER_NATURAL);
    doc.terrain.height.fill(50);
    for (let y = 110; y <= 145; y += 1) {
      for (let x = 160; x <= 185; x += 1) {
        doc.terrain.height[y * 256 + x] = 190;
      }
    }
    session.beginStroke(
      doc,
      { tool: 'fields', diameterDoc: 1600, intensity: 1.0, brushMode: 'smart', roughness: 0.7 },
      cx,
      cy
    );
    session.commit(doc);
    expect(doc.terrain.cover[128 * 256 + 128]).toBe(COVER_FIELDS);
    expect(doc.terrain.cover[128 * 256 + 172]).toBe(COVER_NATURAL);

    // 3. Sabbia grades moderate coastal strip downward toward natural beach level
    doc.terrain.mask.fill(255);
    doc.terrain.cover.fill(COVER_NATURAL);
    doc.terrain.height.fill(70);
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 90; x += 1) {
        doc.terrain.mask[y * 256 + x] = 0;
        doc.terrain.height[y * 256 + x] = 0;
      }
    }
    const coastClickX = (92 / 256) * doc.manifest.space.width;
    session.beginStroke(
      doc,
      { tool: 'sand', diameterDoc: 280, intensity: 1.0, brushMode: 'smart', roughness: 0.6 },
      coastClickX,
      cy
    );
    session.commit(doc);
    expect(doc.terrain.cover[128 * 256 + 92]).toBe(COVER_SAND);
    expect(doc.terrain.height[128 * 256 + 92]).toBeLessThan(70);

    // 4. Palude depresses wet lowland basins & avoids high mountains
    doc.terrain.mask.fill(255);
    doc.terrain.cover.fill(COVER_NATURAL);
    doc.terrain.height.fill(90);
    doc.terrain.height[128 * 256 + 170] = 200;
    session.beginStroke(
      doc,
      { tool: 'swamp', diameterDoc: 1500, intensity: 1.0, brushMode: 'smart', roughness: 0.65 },
      cx,
      cy
    );
    session.commit(doc);
    expect(doc.terrain.cover[128 * 256 + 128]).toBe(COVER_SWAMP);
    expect(doc.terrain.height[128 * 256 + 128]).toBeLessThan(90);
    expect(doc.terrain.cover[128 * 256 + 170]).toBe(COVER_NATURAL);

    // 5. Lava cools into COVER_ROCK crust at direct contact with sea
    doc.terrain.mask.fill(255);
    doc.terrain.cover.fill(COVER_NATURAL);
    doc.terrain.height.fill(60);
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 100; x += 1) {
        doc.terrain.mask[y * 256 + x] = 0;
        doc.terrain.height[y * 256 + x] = 0;
      }
    }
    const lavaOriginX = (130 / 256) * doc.manifest.space.width;
    session.beginStroke(
      doc,
      { tool: 'lava', diameterDoc: 1000, intensity: 1.0, brushMode: 'smart', roughness: 0.3 },
      lavaOriginX,
      cy
    );
    session.commit(doc);
    expect(doc.terrain.cover[128 * 256 + 130]).toBe(COVER_LAVA);
    let shoreRock = 0;
    let shoreLava = 0;
    for (let y = 105; y <= 150; y += 1) {
      const c = doc.terrain.cover[y * 256 + 100];
      if (c === COVER_ROCK) shoreRock += 1;
      if (c === COVER_LAVA) shoreLava += 1;
    }
    expect(shoreRock).toBeGreaterThan(0);
    expect(shoreLava).toBe(0);

    // 6. Classic mode paints full uniform circles across any elevation
    doc.terrain.mask.fill(255);
    doc.terrain.cover.fill(COVER_NATURAL);
    doc.terrain.height.fill(230);
    session.beginStroke(
      doc,
      { tool: 'forest', diameterDoc: 200, intensity: 1.0, brushMode: 'classic' },
      cx,
      cy
    );
    session.commit(doc);
    expect(doc.terrain.cover[128 * 256 + 128]).toBe(COVER_FOREST);
  });
});
