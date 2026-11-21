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
import {
  MAX_MASK_DIM_PX,
  MAX_MASK_PIXELS,
  clampPrintDimensions
} from '../../src/model/coordinates';
import {
  DEFAULT_LAYER_LABELS_ID,
  DEFAULT_LAYER_POI_ID,
  DEFAULT_LAYER_TERRAIN_ID,
  DEFAULT_LAYER_VECTORS_ID,
  createEmptyDocument
} from '../../src/model/document';
import { createSampleWorldDocument } from '../../src/model/sampleDocument';
import { createPathObject } from '../../src/objects/objectCommands';
import { ensureDocumentFontsLoaded } from '../../src/render/composeDocument';
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

interface RecordedCanvasCall {
  method: string;
  args: unknown[];
  globalAlpha: number;
  strokeStyle: unknown;
  fillStyle: unknown;
  lineWidth: number;
  lineDash: number[];
}

function createMockCanvas2DRecorder() {
  const calls: RecordedCanvasCall[] = [];
  const canvases: Array<{ width: number; height: number }> = [];

  const makeContext = () => {
    const stack: Array<{
      globalAlpha: number;
      strokeStyle: unknown;
      fillStyle: unknown;
      lineWidth: number;
      lineDash: number[];
    }> = [];
    let currentDash: number[] = [];

    const ctx: Record<string, unknown> = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      globalAlpha: 1,
      font: '',
      textBaseline: 'alphabetic',
      textAlign: 'start',
      lineCap: 'butt',
      lineJoin: 'miter',
      lineWidth: 1,
      strokeStyle: '#000',
      fillStyle: '#000',
      save: () => {
        stack.push({
          globalAlpha: ctx.globalAlpha as number,
          strokeStyle: ctx.strokeStyle,
          fillStyle: ctx.fillStyle,
          lineWidth: ctx.lineWidth as number,
          lineDash: [...currentDash]
        });
        record('save', []);
      },
      restore: () => {
        const prev = stack.pop();
        if (prev) {
          ctx.globalAlpha = prev.globalAlpha;
          ctx.strokeStyle = prev.strokeStyle;
          ctx.fillStyle = prev.fillStyle;
          ctx.lineWidth = prev.lineWidth;
          currentDash = prev.lineDash;
        }
        record('restore', []);
      },
      clearRect: (...args: unknown[]) => record('clearRect', args),
      fillRect: (...args: unknown[]) => record('fillRect', args),
      beginPath: () => record('beginPath', []),
      rect: (...args: unknown[]) => record('rect', args),
      clip: () => record('clip', []),
      translate: (...args: unknown[]) => record('translate', args),
      rotate: (...args: unknown[]) => record('rotate', args),
      moveTo: (...args: unknown[]) => record('moveTo', args),
      lineTo: (...args: unknown[]) => record('lineTo', args),
      stroke: () => record('stroke', []),
      setLineDash: (segments: number[]) => {
        currentDash = [...segments];
        record('setLineDash', [segments]);
      },
      drawImage: (...args: unknown[]) => record('drawImage', args),
      strokeText: (...args: unknown[]) => record('strokeText', args),
      fillText: (...args: unknown[]) => record('fillText', args),
      createImageData: (w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4)
      }),
      putImageData: (...args: unknown[]) => record('putImageData', args)
    };

    const record = (method: string, args: unknown[]) => {
      calls.push({
        method,
        args,
        globalAlpha: ctx.globalAlpha as number,
        strokeStyle: ctx.strokeStyle,
        fillStyle: ctx.fillStyle,
        lineWidth: ctx.lineWidth as number,
        lineDash: [...currentDash]
      });
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
        const validPng = encodeRgbaPng(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
        const buf = new ArrayBuffer(validPng.byteLength);
        new Uint8Array(buf).set(validPng);
        cb(new Blob([buf], { type: 'image/png' }));
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
      const landscapeResult = await exportDocumentToPdf(sampleDoc, {
        renderRasterPngFn: ({ doc: targetDoc, widthPx, heightPx }) => {
          const terrain = composeDocumentTerrainRgba(targetDoc);
          return encodeRgbaPng(terrain.rgba, terrain.width, terrain.height, widthPx, heightPx);
        }
      });

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

      // A4 verticale (210 x 297 mm) solo-terreno senza DOM né renderRasterPngFn + fallback nome file 'carta.pdf'
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

  it('reports missing assets, blocks active gestures, rejects objects without DOM/custom renderer, and guarantees cleanup hooks in finally on failure', async () => {
    // 0. Carta con oggetti senza DOM né renderRasterPngFn deve fallire esplicitamente invece di ignorare gli oggetti
    const sampleWithObjects = createSampleWorldDocument({ widthPx: 96, heightPx: 68 });
    await expect(exportDocumentToPdf(sampleWithObjects)).rejects.toThrow(
      'Impossibile esportare una carta contenente oggetti o etichette in un ambiente privo di superficie Canvas 2D (DOM) o renderer raster personalizzato.'
    );

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

  it('loads all unique font variants before rendering and honors optional matchesDocument freshness checks', async () => {
    const doc = createSampleWorldDocument({ widthPx: 120, heightPx: 84 });
    doc.manifest.objects.push({
      id: 'obj-sea-label',
      type: 'label',
      text: 'Mare di Vetro',
      x: 400,
      y: 350,
      fontId: 'spectral-italic',
      fontSize: 35,
      color: '#263C40',
      rotationDeg: 0
    });

    const loadCalls: Array<{ font: string; text?: string }> = [];
    let readyAccessed = false;
    const recorder = createMockCanvas2DRecorder();

    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'canvas') return recorder.makeCanvas();
        throw new Error(`Unexpected tag: ${tag}`);
      },
      fonts: {
        load: vi.fn(async (font: string, text?: string) => {
          loadCalls.push({ font, text });
          return [];
        }),
        get ready() {
          readyAccessed = true;
          return Promise.resolve();
        }
      }
    });

    await ensureDocumentFontsLoaded(doc);
    expect(readyAccessed).toBe(true);
    expect(loadCalls.map((c) => c.font)).toEqual([
      '600 32px "Spectral", Georgia, serif',
      'italic 400 32px "Spectral", Georgia, serif'
    ]);

    // Anche exportDocumentToPdf invoca ensureDocumentFontsLoaded prima del rendering Canvas 2D
    loadCalls.length = 0;
    await exportDocumentToPdf(doc, {
      ppi: 72,
      loadAssetsFn: async () => {
        const map: LoadedAssetMap = new Map();
        for (const entry of doc.manifest.assets) {
          map.set(entry.id, { entry, image: {} as HTMLImageElement });
        }
        return map;
      }
    });
    expect(loadCalls.length).toBe(2);

    // Controllo freschezza existingTerrainRenderer tramite matchesDocument(doc)
    const stalePixels = new Uint8ClampedArray(doc.terrain.widthPx * doc.terrain.heightPx * 4).fill(99);
    const staleRenderer: ITerrainRenderer & { matchesDocument: (d: typeof doc) => boolean } = {
      renderFull: vi.fn(),
      renderRegion: vi.fn(),
      getCanvas: () => null,
      getPixelData: () => ({
        width: doc.terrain.widthPx,
        height: doc.terrain.heightPx,
        rgba: stalePixels
      }),
      dispose: vi.fn(),
      matchesDocument: vi.fn(() => false)
    };

    const renderFullSpy = vi.spyOn(TerrainRenderer.prototype, 'renderFull');
    const disposeSpy = vi.spyOn(TerrainRenderer.prototype, 'dispose');

    const freshTerrain = composeDocumentTerrainRgba(doc, staleRenderer);
    expect(staleRenderer.matchesDocument).toHaveBeenCalledWith(doc);
    expect(renderFullSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(freshTerrain.rgba[0]).not.toBe(99);

    renderFullSpy.mockClear();
    disposeSpy.mockClear();
    staleRenderer.matchesDocument = vi.fn(() => true);
    const reusedTerrain = composeDocumentTerrainRgba(doc, staleRenderer);
    expect(staleRenderer.matchesDocument).toHaveBeenCalledWith(doc);
    expect(renderFullSpy).not.toHaveBeenCalled();
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(reusedTerrain.rgba[0]).toBe(99);

    // Verifica matchesDocument === false anche in composeDocumentToCanvas
    renderFullSpy.mockClear();
    disposeSpy.mockClear();
    staleRenderer.matchesDocument = vi.fn(() => false);
    composeDocumentToCanvas(doc, new Map(doc.manifest.assets.map((entry) => [entry.id, { entry, image: {} as HTMLImageElement }])), {
      widthPx: 200,
      heightPx: 141,
      existingTerrainRenderer: staleRenderer,
      targetCanvas: recorder.makeCanvas()
    });
    expect(staleRenderer.matchesDocument).toHaveBeenCalledWith(doc);
    expect(renderFullSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it(
    'exports exact PDF points and safe clamped raster dimensions for A3, A1, and 2000×2000 mm across 150/200/300 ppi',
    async () => {
      // 1. A3 (420 × 297 mm) a 300 ppi -> 1190.55 × 841.89 pt, raster 4961 × 3508 px
      const a3Doc = createEmptyDocument({
        title: 'Atlante A3',
        page: { widthMm: 420, heightMm: 297 },
        widthPx: 120,
        heightPx: 85
      });
      const a3Res = await exportDocumentToPdf(a3Doc, {
        ppi: 300,
        renderRasterPngFn: ({ widthPx, heightPx }) =>
          encodeRgbaPng(new Uint8Array([255, 255, 255, 255]), 1, 1, widthPx, heightPx)
      });

      expect(a3Res.pageWidthPt).toBeCloseTo(1190.55, 2);
      expect(a3Res.pageHeightPt).toBeCloseTo(841.89, 2);
      expect(a3Res.rasterWidthPx).toBe(4961);
      expect(a3Res.rasterHeightPx).toBe(3508);
      expect(a3Res.rasterWidthPx).toBeLessThanOrEqual(MAX_MASK_DIM_PX);
      expect(a3Res.rasterHeightPx).toBeLessThanOrEqual(MAX_MASK_DIM_PX);
      expect(a3Res.rasterWidthPx * a3Res.rasterHeightPx).toBeLessThanOrEqual(MAX_MASK_PIXELS);

      const loadedA3 = await PDFDocument.load(a3Res.bytes);
      const a3PageSize = loadedA3.getPage(0).getSize();
      expect(Math.abs(a3PageSize.width - 1190.55)).toBeLessThan(0.1);
      expect(Math.abs(a3PageSize.height - 841.89)).toBeLessThan(0.1);
      const a3Images = extractPageImageXObjects(loadedA3, 0);
      expect(a3Images).toHaveLength(1);
      expect(a3Images[0].width).toBe(4961);
      expect(a3Images[0].height).toBe(3508);

      // 2. A1 (841 × 594 mm) a 300 ppi -> clampPrintDimensions riduce entro 8192 px e 32M px mantenendo punti PDF esatti
      const a1Doc = createEmptyDocument({
        title: 'Mappa Murale A1',
        page: { widthMm: 841, heightMm: 594 },
        widthPx: 120,
        heightPx: 85
      });
      const expectedA1 = clampPrintDimensions(a1Doc.manifest.page, 300);
      expect(expectedA1.effectivePpi).toBeLessThan(300);
      expect(expectedA1.widthPx).toBeLessThanOrEqual(MAX_MASK_DIM_PX);
      expect(expectedA1.heightPx).toBeLessThanOrEqual(MAX_MASK_DIM_PX);
      expect(expectedA1.widthPx * expectedA1.heightPx).toBeLessThanOrEqual(MAX_MASK_PIXELS);

      const a1Res = await exportDocumentToPdf(a1Doc, {
        ppi: 300,
        renderRasterPngFn: ({ widthPx, heightPx }) =>
          encodeRgbaPng(new Uint8Array([255, 255, 255, 255]), 1, 1, widthPx, heightPx)
      });

      expect(a1Res.pageWidthPt).toBeCloseTo((841 * 72) / 25.4, 2);
      expect(a1Res.pageHeightPt).toBeCloseTo((594 * 72) / 25.4, 2);
      expect(a1Res.rasterWidthPx).toBe(expectedA1.widthPx);
      expect(a1Res.rasterHeightPx).toBe(expectedA1.heightPx);

      const loadedA1 = await PDFDocument.load(a1Res.bytes);
      const a1Images = extractPageImageXObjects(loadedA1, 0);
      expect(a1Images[0].width).toBe(expectedA1.widthPx);
      expect(a1Images[0].height).toBe(expectedA1.heightPx);

      // 3. Formato massimo 2000 × 2000 mm a 300 ppi -> dentro limiti sicuri
      const giantDoc = createEmptyDocument({
        title: 'Continente 2000',
        page: { widthMm: 2000, heightMm: 2000 },
        widthPx: 96,
        heightPx: 96
      });
      const expectedGiant = clampPrintDimensions(giantDoc.manifest.page, 300);
      const giantRes = await exportDocumentToPdf(giantDoc, {
        ppi: 300,
        renderRasterPngFn: ({ widthPx, heightPx }) =>
          encodeRgbaPng(new Uint8Array([255, 255, 255, 255]), 1, 1, widthPx, heightPx)
      });
      expect(giantRes.pageWidthPt).toBeCloseTo((2000 * 72) / 25.4, 2);
      expect(giantRes.pageHeightPt).toBeCloseTo((2000 * 72) / 25.4, 2);
      expect(giantRes.rasterWidthPx).toBe(expectedGiant.widthPx);
      expect(giantRes.rasterHeightPx).toBe(expectedGiant.heightPx);
      expect(giantRes.rasterWidthPx).toBeLessThanOrEqual(MAX_MASK_DIM_PX);
      expect(giantRes.rasterWidthPx * giantRes.rasterHeightPx).toBeLessThanOrEqual(MAX_MASK_PIXELS);

      // 4. Confronto PPI (150 vs 300 ppi) su A4: stessa pagina PDF in pt, pixel raster proporzionali
      const a4Doc = createEmptyDocument({
        page: { widthMm: 297, heightMm: 210 },
        widthPx: 96,
        heightPx: 68
      });
      const res150 = await exportDocumentToPdf(a4Doc, { ppi: 150 });
      const res300 = await exportDocumentToPdf(a4Doc, { ppi: 300 });
      expect(res150.pageWidthPt).toBeCloseTo(res300.pageWidthPt, 5);
      expect(res150.pageHeightPt).toBeCloseTo(res300.pageHeightPt, 5);
      expect(res150.rasterWidthPx).toBe(1754);
      expect(res150.rasterHeightPx).toBe(1240);
      expect(res300.rasterWidthPx).toBe(3508);
      expect(res300.rasterHeightPx).toBe(2480);
    },
    25000
  );

  it('honors terrain layer visibility/opacity, hides objects on invisible layers, and renders PathObject rivers and borders', async () => {
    const doc = createSampleWorldDocument({ widthPx: 148, heightPx: 105 });
    const river = createPathObject({
      id: 'path-river-1',
      kind: 'river',
      points: [400, 300, 900, 480, 1450, 720],
      theme: doc.theme
    });
    const border = createPathObject({
      id: 'path-border-1',
      kind: 'border',
      points: [600, 200, 1100, 360, 1600, 420],
      theme: doc.theme
    });
    doc.manifest.objects.push(river, border);

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

    // Caso 1: terreno visibile con opacità 0.45 + PathObject river/border
    const terrainLayer = doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)!;
    terrainLayer.opacity = 0.45;

    composeDocumentToCanvas(doc, fakeAssets, {
      widthPx: 800,
      heightPx: 566,
      targetCanvas: recorder.makeCanvas()
    });

    const fillRectCalls = recorder.calls.filter((c) => c.method === 'fillRect');
    expect(fillRectCalls.some((c) => c.fillStyle === '#FFFFFF')).toBe(true);

    const drawImageCalls = recorder.calls.filter((c) => c.method === 'drawImage');
    expect(drawImageCalls).toHaveLength(3); // 1 terreno + 2 timbri POI
    expect(drawImageCalls[0].globalAlpha).toBeCloseTo(0.45, 5);
    expect(drawImageCalls[1].globalAlpha).toBe(1);
    expect(drawImageCalls[2].globalAlpha).toBe(1);

    const strokeCalls = recorder.calls.filter((c) => c.method === 'stroke');
    const riverStrokes = strokeCalls.filter((c) => c.strokeStyle === doc.theme.colors.pathRiver);
    const borderStrokes = strokeCalls.filter((c) => c.strokeStyle === doc.theme.colors.pathBorder);
    expect(riverStrokes.length).toBeGreaterThan(1); // tapered river segment strokes
    expect(riverStrokes[riverStrokes.length - 1].lineWidth).toBeGreaterThan(
      riverStrokes[0].lineWidth
    );
    expect(borderStrokes).toHaveLength(1);
    expect(borderStrokes[0].lineDash.length).toBe(2);

    // Caso 2: terrainLayer.visible === false -> non renderizza il terreno ma disegna fondo carta e oggetti visibili
    recorder.calls.length = 0;
    const renderFullSpy = vi.spyOn(TerrainRenderer.prototype, 'renderFull');
    terrainLayer.visible = false;
    terrainLayer.opacity = 1;

    composeDocumentToCanvas(doc, fakeAssets, {
      widthPx: 800,
      heightPx: 566,
      targetCanvas: recorder.makeCanvas()
    });

    expect(renderFullSpy).not.toHaveBeenCalled();
    expect(recorder.calls.filter((c) => c.method === 'fillRect')).toHaveLength(1);
    expect(recorder.calls.filter((c) => c.method === 'drawImage')).toHaveLength(2); // solo 2 POI, nessun terreno
    expect(recorder.calls.filter((c) => c.method === 'fillText')).toHaveLength(1);
    expect(recorder.calls.filter((c) => c.method === 'stroke').length).toBeGreaterThan(0);

    // Caso 3: layer-vectors e layer-labels nascosti -> esclude PathObject e LabelObject
    recorder.calls.length = 0;
    doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_VECTORS_ID)!.visible = false;
    doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_LABELS_ID)!.visible = false;

    composeDocumentToCanvas(doc, fakeAssets, {
      widthPx: 800,
      heightPx: 566,
      targetCanvas: recorder.makeCanvas()
    });

    expect(recorder.calls.filter((c) => c.method === 'stroke')).toHaveLength(0);
    expect(recorder.calls.filter((c) => c.method === 'fillText')).toHaveLength(0);
    expect(recorder.calls.filter((c) => c.method === 'drawImage')).toHaveLength(2);

    // Caso 4 (Node senza DOM): PathObject su layer visibile rifiuta senza DOM né renderRasterPngFn;
    // se tutti gli oggetti sono su layer nascosti, esporta regolarmente il terreno (o carta pulita)
    vi.unstubAllGlobals();
    const pathOnlyDoc = createEmptyDocument({ widthPx: 96, heightPx: 68 });
    pathOnlyDoc.manifest.objects.push(
      createPathObject({
        id: 'path-visible-river',
        kind: 'river',
        points: [100, 100, 400, 300],
        theme: pathOnlyDoc.theme
      })
    );
    await expect(exportDocumentToPdf(pathOnlyDoc)).rejects.toThrow(
      'Impossibile esportare una carta contenente oggetti o etichette in un ambiente privo di superficie Canvas 2D (DOM) o renderer raster personalizzato.'
    );

    pathOnlyDoc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_VECTORS_ID)!.visible = false;
    pathOnlyDoc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)!.visible = false;
    const hiddenOnlyResult = await exportDocumentToPdf(pathOnlyDoc, { ppi: 150 });
    expect(hiddenOnlyResult.rasterWidthPx).toBe(1754);
    expect(hiddenOnlyResult.rasterHeightPx).toBe(1240);
    expect(hiddenOnlyResult.bytes.byteLength).toBeGreaterThan(0);

    // Con terreno visibile e opacity < 1 in Node fallback, i byte dell'immagine differiscono rispetto a opacity = 1
    pathOnlyDoc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)!.visible = true;
    pathOnlyDoc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)!.opacity = 1;
    const fullOpacityNodePdf = await PDFDocument.load(
      (await exportDocumentToPdf(pathOnlyDoc, { ppi: 72 })).bytes
    );
    pathOnlyDoc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)!.opacity = 0.5;
    const halfOpacityNodePdf = await PDFDocument.load(
      (await exportDocumentToPdf(pathOnlyDoc, { ppi: 72 })).bytes
    );
    expect(
      bytesEqual(
        extractPageImageXObjects(fullOpacityNodePdf, 0)[0].contents,
        extractPageImageXObjects(halfOpacityNodePdf, 0)[0].contents
      )
    ).toBe(false);

    // Anche il percorso composeDocumentToCanvas con layer-poi nascosto esclude i timbri
    doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_POI_ID)!.visible = false;
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'canvas') return recorder.makeCanvas();
        throw new Error(`Unexpected tag: ${tag}`);
      }
    });
    recorder.calls.length = 0;
    composeDocumentToCanvas(doc, fakeAssets, {
      widthPx: 800,
      heightPx: 566,
      targetCanvas: recorder.makeCanvas()
    });
    expect(recorder.calls.filter((c) => c.method === 'drawImage')).toHaveLength(0);
  });

  it('renders ExportPdfDialog PPI options, clamped giant-format notice, and hidden layers warning', () => {
    const a4Doc = createSampleWorldDocument({ widthPx: 96, heightPx: 68 });
    const a4Html = renderToStaticMarkup(createElement(ExportPdfDialog, { doc: a4Doc, ppi: 150 }));
    expect(a4Html).toContain('Risoluzione di stampa');
    expect(a4Html).toContain('150 ppi (Bozza / Veloce)');
    expect(a4Html).toContain('200 ppi (Bilanciato)');
    expect(a4Html).toContain('300 ppi (Stampa editoriale)');
    expect(a4Html).toContain('150 ppi · 1754 × 1240 px');
    expect(a4Html).not.toContain('livello nascosto');
    expect(a4Html).not.toContain('livelli nascosti');

    const a1Doc = createEmptyDocument({
      title: 'Regno A1',
      page: { widthMm: 841, heightMm: 594 },
      widthPx: 96,
      heightPx: 68
    });
    a1Doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_TERRAIN_ID)!.visible = false;
    a1Doc.manifest.layers.find((l) => l.id === DEFAULT_LAYER_VECTORS_ID)!.visible = false;

    const clampedA1 = clampPrintDimensions(a1Doc.manifest.page, 300);
    const a1Html = renderToStaticMarkup(createElement(ExportPdfDialog, { doc: a1Doc }));
    expect(a1Html).toContain('841 × 594 mm');
    expect(a1Html).toContain(
      `${clampedA1.effectivePpi} ppi · ${clampedA1.widthPx} × ${clampedA1.heightPx} px`
    );
    expect(a1Html).toContain('adattata automaticamente');
    expect(a1Html).toContain('2 livelli nascosti esclusi dalla stampa');
    expect(a1Html).toContain('Terreno e Rilievo');
    expect(a1Html).toContain('Fiumi e Strade');
  });
});
