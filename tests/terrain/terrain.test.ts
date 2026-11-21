import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COVER_FIELDS,
  COVER_FOREST,
  COVER_NATURAL,
  MapDocument,
  createEmptyDocument
} from '../../src/model/document';
import { HistoryManager } from '../../src/model/history';
import { createSampleWorldDocument } from '../../src/model/sampleDocument';
import { DEFAULT_THEME, V1_FLAT_THEME, cloneTheme } from '../../src/theme/theme';
import {
  TerrainRenderer,
  TerrainStrokeSession,
  classifyCell,
  computeLocalWaterDistancePx,
  inspectCellAtDoc,
  isPointOnLand
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
});
