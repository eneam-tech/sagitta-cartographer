import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadedAssetMap } from '../../src/assets/types';
import {
  ExportPdfDialog,
  buildPdfFilename,
  composeDocumentTerrainRgba,
  composeDocumentToCanvas,
  encodeRgbaPng,
  exportDocumentToPdf,
  triggerPdfDownload
} from '../../src/export';
import { createEmptyDocument } from '../../src/model/document';
import { createSampleWorldDocument } from '../../src/model/sampleDocument';
import { EditorStore } from '../../src/state/editorStore';
import { TerrainRenderer } from '../../src/terrain';
import { ITerrainRenderer } from '../../src/terrain/types';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function extractPageImageXObjects(
  pdfDoc: PDFDocument,
  pageIndex = 0
): Array<{ width: number; height: number; contents: Uint8Array }> {
  const page = pdfDoc.getPage(pageIndex);
  const resources = page.node.Resources();
  if (!resources) return [];
  const xObjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xObjects) return [];

  const images: Array<{ width: number; height: number; contents: Uint8Array }> = [];
  for (const [, ref] of xObjects.entries()) {
    const obj = pdfDoc.context.lookup(ref);
    if (obj instanceof PDFRawStream) {
      const subtype = obj.dict.lookup(PDFName.of('Subtype'));
      if (subtype === PDFName.of('Image')) {
        const wObj = obj.dict.lookup(PDFName.of('Width'));
        const hObj = obj.dict.lookup(PDFName.of('Height'));
        images.push({
          width: wObj instanceof PDFNumber ? wObj.asNumber() : 0,
          height: hObj instanceof PDFNumber ? hObj.asNumber() : 0,
          contents: new Uint8Array(obj.contents)
        });
      }
    }
  }
  return images;
}

function createMockCanvas2DRecorder() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const canvases: Array<{ width: number; height: number }> = [];

  const makeContext = () => {
    const ctx: Record<string, unknown> = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      font: '',
      textBaseline: 'alphabetic',
      textAlign: 'start',
      lineJoin: 'miter',
      lineWidth: 1,
      strokeStyle: '#000',
      fillStyle: '#000',
      save: () => calls.push({ method: 'save', args: [] }),
      restore: () => calls.push({ method: 'restore', args: [] }),
      clearRect: (...args: unknown[]) => calls.push({ method: 'clearRect', args }),
      beginPath: () => calls.push({ method: 'beginPath', args: [] }),
      rect: (...args: unknown[]) => calls.push({ method: 'rect', args }),
      clip: () => calls.push({ method: 'clip', args: [] }),
      translate: (...args: unknown[]) => calls.push({ method: 'translate', args }),
      rotate: (...args: unknown[]) => calls.push({ method: 'rotate', args }),
      drawImage: (...args: unknown[]) => calls.push({ method: 'drawImage', args }),
      strokeText: (...args: unknown[]) => calls.push({ method: 'strokeText', args }),
      fillText: (...args: unknown[]) => calls.push({ method: 'fillText', args }),
      createImageData: (w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4)
      }),
      putImageData: (...args: unknown[]) => calls.push({ method: 'putImageData', args })
    };
    return ctx as unknown as CanvasRenderingContext2D;
  };

  const makeCanvas = (options?: { failToBlob?: boolean }) => {
    const state = { width: 0, height: 0 };
    canvases.push(state);
    const canvasObj = {
      get width() {
        return state.width;
      },
      set width(v: number) {
        state.width = v;
      },
      get height() {
        return state.height;
      },
      set height(v: number) {
        state.height = v;
      },
      getContext: (kind: string) => (kind === '2d' ? makeContext() : null),
      toBlob: (cb: (blob: Blob | null) => void) => {
        if (options?.failToBlob) {
          cb(null);
          return;
        }
        cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
      }
    };
    return canvasObj as unknown as HTMLCanvasElement;
  };

  return { calls, canvases, makeCanvas };
}

describe('PDF export & shared document composition', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it(
    'exports valid A4 landscape and portrait PDFs with exact physical dimensions at 300 ppi',
    async () => {
      const sampleDoc = createSampleWorldDocument();
      const landscapeResult = await exportDocumentToPdf(sampleDoc);

      expect(landscapeResult.filename).toBe('arcipelago-delle-brume.pdf');
      expect(landscapeResult.rasterWidthPx).toBe(3508);
      expect(landscapeResult.rasterHeightPx).toBe(2480);
      expect(landscapeResult.pageWidthPt).toBeCloseTo(841.89, 2);
      expect(landscapeResult.pageHeightPt).toBeCloseTo(595.28, 2);

      const loadedLandscape = await PDFDocument.load(landscapeResult.bytes);
      expect(loadedLandscape.getPageCount()).toBe(1);
      const landscapeSize = loadedLandscape.getPage(0).getSize();
      expect(Math.abs(landscapeSize.width - 841.89)).toBeLessThan(0.1);
      expect(Math.abs(landscapeSize.height - 595.28)).toBeLessThan(0.1);

      const landscapeImages = extractPageImageXObjects(loadedLandscape, 0);
      expect(landscapeImages).toHaveLength(1);
      expect(landscapeImages[0].width).toBe(3508);
      expect(landscapeImages[0].height).toBe(2480);

      // A4 verticale (210 x 297 mm) e verifica fallback nome file 'carta.pdf' con titolo vuoto
      const portraitDoc = createEmptyDocument({
        page: { widthMm: 210, heightMm: 297 },
        widthPx: 210,
        heightPx: 297
      });
      portraitDoc.manifest.title = '   ';
      const portraitResult = await exportDocumentToPdf(portraitDoc);

      expect(portraitResult.filename).toBe('carta.pdf');
      expect(portraitResult.rasterWidthPx).toBe(2480);
      expect(portraitResult.rasterHeightPx).toBe(3508);

      const loadedPortrait = await PDFDocument.load(portraitResult.bytes);
      expect(loadedPortrait.getPageCount()).toBe(1);
      const portraitSize = loadedPortrait.getPage(0).getSize();
      expect(Math.abs(portraitSize.width - 595.28)).toBeLessThan(0.1);
      expect(Math.abs(portraitSize.height - 841.89)).toBeLessThan(0.1);

      const portraitImages = extractPageImageXObjects(loadedPortrait, 0);
      expect(portraitImages).toHaveLength(1);
      expect(portraitImages[0].width).toBe(2480);
      expect(portraitImages[0].height).toBe(3508);

      expect(buildPdfFilename('Nuova carta')).toBe('nuova-carta.pdf');
      expect(buildPdfFilename('Città di Èlite — ÀÈÌÒÙ')).toBe('citta-di-elite-aeiou.pdf');
      expect(buildPdfFilename('Mappa', 'archivio-tavolo')).toBe('archivio-tavolo.pdf');
    },
    15000
  );

  it(
    'produces byte-identical composition PNGs regardless of camera zoom, pan, or object selection',
    async () => {
      const doc = createSampleWorldDocument();
      const store = new EditorStore({ initialDocument: doc });
      store.setViewportSize(1280, 800);

      const capturedPngs: Uint8Array[] = [];
      const exportBefore = await exportDocumentToPdf(store.getDocument(), {
        renderRasterPngFn: ({ doc: targetDoc, widthPx, heightPx }) => {
          const terrain = composeDocumentTerrainRgba(targetDoc);
          const png = encodeRgbaPng(terrain.rgba, terrain.width, terrain.height, widthPx, heightPx);
          capturedPngs.push(png);
          return png;
        }
      });

      // Simula vista molto ingrandita sul porto, pan e selezione attiva
      store.setTool('select');
      store.zoomAt(640, 400, 8.5);
      store.panBy(-480, -320);
      store.selectObject('obj-sample-harbor');
      expect(store.getSnapshot().selectedObjectId).toBe('obj-sample-harbor');
      expect(store.getSnapshot().camera.scale).toBeGreaterThan(5);

      const exportAfter = await exportDocumentToPdf(store.getDocument(), {
        renderRasterPngFn: ({ doc: targetDoc, widthPx, heightPx }) => {
          const terrain = composeDocumentTerrainRgba(targetDoc);
          const png = encodeRgbaPng(terrain.rgba, terrain.width, terrain.height, widthPx, heightPx);
          capturedPngs.push(png);
          return png;
        }
      });

      expect(capturedPngs).toHaveLength(2);
      expect(bytesEqual(capturedPngs[0], capturedPngs[1])).toBe(true);

      const pdfBefore = await PDFDocument.load(exportBefore.bytes);
      const pdfAfter = await PDFDocument.load(exportAfter.bytes);
      const xObjsBefore = extractPageImageXObjects(pdfBefore, 0);
      const xObjsAfter = extractPageImageXObjects(pdfAfter, 0);
      expect(xObjsBefore).toHaveLength(1);
      expect(xObjsAfter).toHaveLength(1);
      expect(bytesEqual(xObjsBefore[0].contents, xObjsAfter[0].contents)).toBe(true);
    },
    15000
  );

  it('composes terrain and objects via shared pipeline with clipping, renderer reuse, and zero handles', () => {
    const doc = createSampleWorldDocument({ widthPx: 148, heightPx: 105 });
    const recorder = createMockCanvas2DRecorder();

    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'canvas') return recorder.makeCanvas();
        throw new Error(`Unexpected tag: ${tag}`);
      }
    });

    const fakeAssets: LoadedAssetMap = new Map();
    for (const entry of doc.manifest.assets) {
      fakeAssets.set(entry.id, {
        entry,
        image: { id: entry.id } as unknown as HTMLImageElement
      });
    }

    // Caso 1: senza existingTerrainRenderer -> crea TerrainRenderer temporaneo e lo dispone
    const renderFullSpy = vi.spyOn(TerrainRenderer.prototype, 'renderFull');
    const disposeSpy = vi.spyOn(TerrainRenderer.prototype, 'dispose');
    const targetCanvas = recorder.makeCanvas();
    const out = composeDocumentToCanvas(doc, fakeAssets, {
      widthPx: 800,
      heightPx: 566,
      targetCanvas
    });

    expect(out).toBe(targetCanvas);
    expect(renderFullSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);

    const rectCalls = recorder.calls.filter((c) => c.method === 'rect');
    const clipCalls = recorder.calls.filter((c) => c.method === 'clip');
    expect(
      rectCalls.some(
        (c) => c.args[0] === 0 && c.args[1] === 0 && c.args[2] === 800 && c.args[3] === 566
      )
    ).toBe(true);
    expect(clipCalls.length).toBeGreaterThanOrEqual(2);

    const drawImageCalls = recorder.calls.filter((c) => c.method === 'drawImage');
    // 1 drawImage per terreno + 2 timbri POI (porto, torre)
    expect(drawImageCalls).toHaveLength(3);
    expect(drawImageCalls[0].args.slice(1)).toEqual([0, 0, 800, 566]);

    const fillTextCalls = recorder.calls.filter((c) => c.method === 'fillText');
    expect(fillTextCalls).toHaveLength(1);
    expect(fillTextCalls[0].args[0]).toBe('Porto delle Brume');

    // Caso 2: con existingTerrainRenderer a dimensioni coincidenti -> riutilizza e NON dispone
    renderFullSpy.mockClear();
    disposeSpy.mockClear();
    const existingCanvas = recorder.makeCanvas();
    existingCanvas.width = doc.terrain.widthPx;
    existingCanvas.height = doc.terrain.heightPx;
    const existingRenderer: ITerrainRenderer = {
      renderFull: vi.fn(),
      renderRegion: vi.fn(),
      getCanvas: () => existingCanvas,
      getPixelData: () => ({
        width: doc.terrain.widthPx,
        height: doc.terrain.heightPx,
        rgba: new Uint8ClampedArray(doc.terrain.widthPx * doc.terrain.heightPx * 4)
      }),
      dispose: vi.fn()
    };

    composeDocumentToCanvas(doc, fakeAssets, {
      widthPx: 400,
      heightPx: 283,
      existingTerrainRenderer: existingRenderer,
      targetCanvas: recorder.makeCanvas()
    });
    expect(renderFullSpy).not.toHaveBeenCalled();
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(existingRenderer.dispose).not.toHaveBeenCalled();
  });

  it('reports missing assets, blocks active gestures, and guarantees cleanup hooks in finally on failure', async () => {
    // 1. Risorsa referenziata da stamp mancante
    const docMissingStamp = createSampleWorldDocument({ widthPx: 96, heightPx: 68 });
    docMissingStamp.manifest.objects.push({
      id: 'obj-missing',
      type: 'stamp',
      role: 'poi',
      assetId: 'missing-citadel',
      x: 500,
      y: 400,
      width: 96,
      height: 96,
      rotationDeg: 0
    });
    await expect(exportDocumentToPdf(docMissingStamp)).rejects.toThrow(/missing-citadel/);

    // 2. Risorsa custom dichiarata nel manifest senza file blob allegato
    const docMissingFile = createEmptyDocument({ widthPx: 96, heightPx: 68 });
    docMissingFile.manifest.assets.push({
      id: 'custom-crest',
      path: 'assets/missing-crest.svg',
      mimeType: 'image/svg+xml',
      version: 1,
      author: 'Cartografo',
      source: 'test',
      license: 'CC0-1.0',
      width: 64,
      height: 64,
      anchorX: 0.5,
      anchorY: 0.5
    });
    await expect(exportDocumentToPdf(docMissingFile)).rejects.toThrow(
      /assets\/missing-crest\.svg/
    );

    // Con extraAssetBlobs valorizzato, la stessa risorsa custom viene risolta correttamente
    const extraBlobs = new Map<string, Blob>([
      [
        'assets/missing-crest.svg',
        new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>'], {
          type: 'image/svg+xml'
        })
      ]
    ]);
    const resolvedCustom = await exportDocumentToPdf(docMissingFile, {
      ppi: 72,
      extraAssetBlobs: extraBlobs
    });
    expect(resolvedCustom.bytes.byteLength).toBeGreaterThan(0);

    // 3. Gesto attivo blocca l'esportazione
    const cleanDoc = createEmptyDocument({ widthPx: 96, heightPx: 68 });
    await expect(
      exportDocumentToPdf(cleanDoc, { isGestureActive: () => true })
    ).rejects.toThrow(/gesto/i);

    // 4. In caso di fallimento durante rendering, hook di rilascio e revokeObjectURL vengono invocati nel finally
    const revokeSpy = vi.fn();
    const disposeAssetsHook = vi.fn((assets: LoadedAssetMap) => {
      for (const res of assets.values()) {
        if (res.objectUrl) revokeSpy(res.objectUrl);
      }
    });
    const onDisposeTemporaryResources = vi.fn();

    await expect(
      exportDocumentToPdf(cleanDoc, {
        loadAssetsFn: async () => {
          const map: LoadedAssetMap = new Map();
          map.set('temp-asset', {
            entry: {
              id: 'temp-asset',
              path: 'assets/temp.svg',
              mimeType: 'image/svg+xml',
              version: 1,
              author: 'Cartografo',
              source: 'test',
              license: 'CC0-1.0',
              width: 32,
              height: 32,
              anchorX: 0.5,
              anchorY: 0.5
            },
            image: {} as HTMLImageElement,
            objectUrl: 'blob:temp-asset-url'
          });
          return map;
        },
        disposeAssetsFn: disposeAssetsHook,
        renderRasterPngFn: () => {
          throw new Error('Errore simulato durante la rasterizzazione PNG');
        },
        onDisposeTemporaryResources
      })
    ).rejects.toThrow('Errore simulato durante la rasterizzazione PNG');

    expect(disposeAssetsHook).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:temp-asset-url');
    expect(onDisposeTemporaryResources).toHaveBeenCalledTimes(1);

    // 5. In ambiente DOM simulato, un fallimento di toBlob azzera il canvas temporaneo e dispone il renderer locale
    const recorder = createMockCanvas2DRecorder();
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'canvas') return recorder.makeCanvas({ failToBlob: true });
        throw new Error(`Unexpected tag: ${tag}`);
      },
      fonts: { ready: Promise.resolve() }
    });

    const localDisposeSpy = vi.spyOn(TerrainRenderer.prototype, 'dispose');
    const onDomCleanup = vi.fn();

    await expect(
      exportDocumentToPdf(cleanDoc, {
        loadAssetsFn: async () => new Map(),
        disposeAssetsFn: disposeAssetsHook,
        onDisposeTemporaryResources: onDomCleanup
      })
    ).rejects.toThrow(/codificare l’immagine PNG/i);

    expect(localDisposeSpy).toHaveBeenCalledTimes(1);
    expect(onDomCleanup).toHaveBeenCalledTimes(1);
    expect(recorder.canvases.length).toBeGreaterThanOrEqual(1);
    for (const c of recorder.canvases) {
      expect(c.width).toBe(0);
      expect(c.height).toBe(0);
    }
  });

  it('triggers browser PDF download and revokes Object URL after 1000 ms', () => {
    vi.useFakeTimers();
    const clicked: string[] = [];
    const appended: unknown[] = [];
    const removed: unknown[] = [];
    const linkMock = {
      href: '',
      download: '',
      click: () => clicked.push(linkMock.download)
    };

    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'a') return linkMock;
        throw new Error(`Unexpected tag: ${tag}`);
      },
      body: {
        appendChild: (node: unknown) => appended.push(node),
        removeChild: (node: unknown) => removed.push(node)
      }
    });

    const createObjectURL = vi.fn(() => 'blob:pdf-download-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    triggerPdfDownload({
      bytes: new Uint8Array([37, 80, 68, 70]),
      filename: 'arcipelago-delle-brume.pdf',
      pageWidthPt: 841.89,
      pageHeightPt: 595.28,
      rasterWidthPx: 3508,
      rasterHeightPx: 2480
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual(['arcipelago-delle-brume.pdf']);
    expect(appended).toHaveLength(1);
    expect(removed).toHaveLength(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pdf-download-url');
  });

  it('renders ExportPdfDialog with Italian physical/print summary and primary/secondary actions', () => {
    const landscapeDoc = createSampleWorldDocument({ widthPx: 96, heightPx: 68 });
    const landscapeHtml = renderToStaticMarkup(
      createElement(ExportPdfDialog, { doc: landscapeDoc })
    );

    expect(landscapeHtml).toContain('Esporta PDF');
    expect(landscapeHtml).toContain('Annulla');
    expect(landscapeHtml).toContain('Orizzontale');
    expect(landscapeHtml).toContain('297 × 210 mm');
    expect(landscapeHtml).toContain('300 ppi · 3508 × 2480 px');
    expect(landscapeHtml).toContain('841,9 × 595,3 pt');
    expect(landscapeHtml).toContain('arcipelago-delle-brume.pdf');

    const portraitDoc = createEmptyDocument({
      title: 'Regno del Nord',
      page: { widthMm: 210, heightMm: 297 },
      widthPx: 64,
      heightPx: 90
    });
    const portraitHtml = renderToStaticMarkup(
      createElement(ExportPdfDialog, { doc: portraitDoc })
    );

    expect(portraitHtml).toContain('Verticale');
    expect(portraitHtml).toContain('210 × 297 mm');
    expect(portraitHtml).toContain('300 ppi · 2480 × 3508 px');
    expect(portraitHtml).toContain('595,3 × 841,9 pt');
    expect(portraitHtml).toContain('regno-del-nord.pdf');
  });
});
