import { describe, expect, it } from 'vitest';
import {
  clampPrintDimensions,
  computeAnchorOffset,
  docToScreen,
  fitCameraToViewport,
  mmToPdfPoints,
  mmToPrintPx,
  PAGE_PRESETS,
  ptToDocUnits,
  screenToDoc,
  zoomAtPoint
} from '../../src/model/coordinates';
import {
  COVER_LAVA,
  COVER_MATERIALS,
  COVER_NATURAL,
  DEFAULT_LAYER_TERRAIN_ID,
  PathObject,
  SCHEMA_VERSION,
  createEmptyDocument,
  isCoverCode,
  validateDocumentManifest
} from '../../src/model/document';
import { HistoryManager } from '../../src/model/history';
import {
  AddLayerCommand,
  DeleteLayerCommand,
  ReorderLayersCommand,
  ResizeCanvasCommand,
  SetTitleCommand,
  TerrainPatchCommand,
  UpdateLayerCommand
} from '../../src/model/commands';
import { decodeMaskPng, encodeMaskPng } from '../../src/core/png';
import { createSampleWorldDocument } from '../../src/model/sampleDocument';
import { DEFAULT_THEME, MAP_THEMES, WITCHER_THEME, getDefaultLabelColor, normalizeTheme } from '../../src/theme/theme';

describe('Core module contracts', () => {
  it('converts physical page sizes to PDF points and print pixels accurately', () => {
    expect(mmToPrintPx(297, 300)).toBe(3508);
    expect(mmToPrintPx(210, 300)).toBe(2480);
    expect(mmToPdfPoints(297)).toBeCloseTo(841.89, 2);
    expect(mmToPdfPoints(210)).toBeCloseTo(595.28, 2);
    expect(ptToDocUnits(16)).toBeCloseTo(56.44, 2);
  });

  it('keeps cursor doc point invariant across zoomAtPoint and screenToDoc round-trip', () => {
    const cam0 = fitCameraToViewport({ width: 2970, height: 2100 }, 1100, 800);
    const cursorX = 432;
    const cursorY = 319;
    const docBefore = screenToDoc(cursorX, cursorY, cam0);
    const cam1 = zoomAtPoint(cam0, cursorX, cursorY, cam0.scale * 2.5);
    const docAfter = screenToDoc(cursorX, cursorY, cam1);
    expect(docAfter.x).toBeCloseTo(docBefore.x, 8);
    expect(docAfter.y).toBeCloseTo(docBefore.y, 8);
    const back = docToScreen(docAfter.x, docAfter.y, cam1);
    expect(back.x).toBeCloseTo(cursorX, 8);
    expect(back.y).toBeCloseTo(cursorY, 8);
  });

  it('losslessly encodes and decodes alpha mask PNGs', () => {
    const width = 48;
    const height = 32;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i += 1) {
      mask[i] = (i * 17) % 256;
    }
    const pngBytes = encodeMaskPng(mask, width, height);
    const decoded = decodeMaskPng(pngBytes);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(Array.from(decoded.mask)).toEqual(Array.from(mask));
  });

  it('rejects truncated or corrupted mask PNGs', () => {
    const pngBytes = encodeMaskPng(new Uint8Array(64 * 64), 64, 64);
    expect(() => decodeMaskPng(pngBytes.subarray(0, 20))).toThrow();
    const corrupted = new Uint8Array(pngBytes);
    corrupted[12] ^= 0xff;
    expect(() => decodeMaskPng(corrupted)).toThrow();
  });

  it('tracks revision, terrainVersion, and memory budget eviction in HistoryManager', () => {
    const doc = createEmptyDocument({ widthPx: 64, heightPx: 64 });
    const history = new HistoryManager(300);

    history.execute(doc, new SetTitleCommand(doc.manifest.title, 'Arcipelago'));
    expect(doc.manifest.revision).toBe(1);
    expect(doc.terrainVersion).toBe(0);

    const makePatch = (val: number) =>
      new TerrainPatchCommand(
        `Patch ${val}`,
        { x: 0, y: 0, width: 4, height: 4 },
        [
          {
            x: 0,
            y: 0,
            width: 4,
            height: 4,
            beforeMask: new Uint8Array(16),
            afterMask: new Uint8Array(16).fill(val),
            beforeHeight: new Uint8Array(16),
            afterHeight: new Uint8Array(16),
            beforeCover: new Uint8Array(16),
            afterCover: new Uint8Array(16)
          }
        ]
      );

    // Each patch is 16 * 6 = 96 bytes. 4 patches = 384 > 300 budget -> oldest evicted
    history.execute(doc, makePatch(10));
    history.execute(doc, makePatch(20));
    history.execute(doc, makePatch(30));
    history.execute(doc, makePatch(40));

    expect(doc.manifest.revision).toBe(5);
    expect(doc.terrainVersion).toBe(4);
    expect(history.currentRasterBytes).toBeLessThanOrEqual(300);
    expect(history.undoCount).toBeLessThan(5);

    history.undo(doc);
    expect(doc.manifest.revision).toBe(6);
    expect(doc.terrainVersion).toBe(5);
  });

  it('creates a valid sample world document passing manifest validation', () => {
    const sample = createSampleWorldDocument();
    expect(() => validateDocumentManifest(sample.manifest)).not.toThrow();
    expect(sample.manifest.objects).toHaveLength(3);
  });

  it('validates v3 schema layers, 10 cover materials, PathObject, 5 themes, and large page presets', () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(COVER_MATERIALS).toHaveLength(10);
    expect(isCoverCode(COVER_NATURAL)).toBe(true);
    expect(isCoverCode(COVER_LAVA)).toBe(true);
    expect(isCoverCode(10)).toBe(false);
    expect(MAP_THEMES).toHaveLength(5);
    expect(WITCHER_THEME.id).toBe('regni-del-nord');
    expect(getDefaultLabelColor(WITCHER_THEME)).toBe('#F5EAD0');
    expect(getDefaultLabelColor(DEFAULT_THEME)).toBe(DEFAULT_THEME.colors.ink);
    expect(PAGE_PRESETS.length).toBeGreaterThanOrEqual(7);

    const normalized = normalizeTheme({
      id: 'legacy',
      version: 1,
      name: 'Legacy',
      mode: 'reactive',
      colors: { land: '#E0D0A0' }
    });
    expect(normalized.colors.lava).toBeDefined();
    expect(normalized.colors.pathRiver).toBeDefined();

    const doc = createEmptyDocument({ page: { widthMm: 841, heightMm: 594 } });
    expect(doc.manifest.layers).toHaveLength(4);
    const river: PathObject = {
      id: 'path-river-1',
      type: 'path',
      kind: 'river',
      layerId: 'layer-vectors',
      x: 500,
      y: 400,
      rotationDeg: 0,
      points: [-100, -40, 0, 20, 120, 60],
      strokeWidthDoc: 12,
      color: normalized.colors.pathRiver,
      tapered: true,
      smooth: true
    };
    doc.manifest.objects.push(river);
    expect(() => validateDocumentManifest(doc.manifest)).not.toThrow();

    expect(computeAnchorOffset(2970, 2100, 4200, 2970, 'top-left')).toEqual({ dx: 0, dy: 0 });
    expect(computeAnchorOffset(2970, 2100, 4200, 2970, 'center')).toEqual({ dx: 615, dy: 435 });

    const clamped = clampPrintDimensions({ widthMm: 841, heightMm: 594 }, 300);
    expect(clamped.widthPx * clamped.heightPx).toBeLessThanOrEqual(32_000_000);
    expect(clamped.widthPx).toBeLessThanOrEqual(8192);
  });

  it('supports undo/redo for layer commands and ResizeCanvasCommand cleanly', () => {
    const doc = createEmptyDocument({ widthPx: 120, heightPx: 80 });
    const history = new HistoryManager();

    const customLayer = {
      id: 'layer-custom-1',
      name: 'Annotazioni',
      kind: 'custom' as const,
      visible: true,
      locked: false,
      opacity: 0.75
    };

    history.execute(doc, new AddLayerCommand(customLayer));
    expect(doc.manifest.layers).toHaveLength(5);
    expect(doc.manifest.layers[4].id).toBe('layer-custom-1');

    history.execute(
      doc,
      new UpdateLayerCommand(customLayer, { ...customLayer, visible: false, locked: true })
    );
    expect(doc.manifest.layers[4].visible).toBe(false);

    const prevOrder = [...doc.manifest.layers];
    const reordered = [prevOrder[0], prevOrder[4], prevOrder[1], prevOrder[2], prevOrder[3]];
    history.execute(doc, new ReorderLayersCommand(prevOrder, reordered));
    expect(doc.manifest.layers[1].id).toBe('layer-custom-1');

    // Terrain layer cannot be deleted
    history.execute(doc, new DeleteLayerCommand(DEFAULT_LAYER_TERRAIN_ID));
    expect(doc.manifest.layers.some((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)).toBe(true);

    history.undo(doc); // reorder
    history.undo(doc); // delete (no-op command still on stack)
    history.undo(doc); // update
    expect(doc.manifest.layers[4].visible).toBe(true);
    history.undo(doc); // add
    expect(doc.manifest.layers).toHaveLength(4);

    const before = {
      page: doc.manifest.page,
      space: doc.manifest.space,
      terrain: doc.terrain,
      objects: doc.manifest.objects
    };
    const afterTerrain = {
      widthPx: 180,
      heightPx: 120,
      mask: new Uint8Array(180 * 120),
      height: new Uint8Array(180 * 120),
      cover: new Uint8Array(180 * 120)
    };
    const resizeCmd = new ResizeCanvasCommand(before, {
      page: { widthMm: 420, heightMm: 297 },
      space: { width: 4200, height: 2970 },
      terrain: afterTerrain,
      objects: doc.manifest.objects
    });
    history.execute(doc, resizeCmd);
    expect(doc.manifest.page.widthMm).toBe(420);
    expect(doc.terrain.widthPx).toBe(180);
    expect(doc.terrainVersion).toBe(1);

    history.undo(doc);
    expect(doc.manifest.page.widthMm).toBe(297);
    expect(doc.terrain.widthPx).toBe(120);
    expect(doc.terrainVersion).toBe(2);
  });
});
