import { describe, expect, it } from 'vitest';
import {
  docToScreen,
  fitCameraToViewport,
  mmToPdfPoints,
  mmToPrintPx,
  ptToDocUnits,
  screenToDoc,
  zoomAtPoint
} from '../../src/model/coordinates';
import { createEmptyDocument, validateDocumentManifest } from '../../src/model/document';
import { HistoryManager } from '../../src/model/history';
import { SetTitleCommand, TerrainPatchCommand } from '../../src/model/commands';
import { decodeMaskPng, encodeMaskPng } from '../../src/core/png';
import { createSampleWorldDocument } from '../../src/model/sampleDocument';

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
});
