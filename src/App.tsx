import { useCallback, useEffect, useRef, useState } from 'react';
import { BUILTIN_POI_CATALOG } from './assets/catalog';
import { encodeMaskPng } from './core/png';
import { MapViewport, ViewportLayersHandle } from './canvas/MapViewport';
import { exportDocumentToPdf } from './export';
import { createEmptyDocument, MapObject } from './model/document';
import { ptToDocUnits } from './model/coordinates';
import {
  createLabelObject,
  createPoiStampObject,
  InlineLabelEditor,
  InlineLabelEditRequest,
  LayersPanel,
  ObjectInspector,
  ObjectListPanel,
  ObjectsLayerController,
  PathToolPanel,
  PoiLibraryPanel
} from './objects';
import { PersistenceService } from './persistence';
import { EditorStore, attachEditorKeyboardListeners } from './state/editorStore';
import { TerrainRenderer, TerrainStrokeSession } from './terrain';
import { DialogsHost } from './ui/Dialogs';
import { ExportPdfDialog } from './ui/ExportPdfDialog';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { StatusBar } from './ui/StatusBar';
import { ToolRail } from './ui/ToolRail';
import { TopBar } from './ui/TopBar';

export interface MapEditorDebugHandle {
  store: EditorStore;
  getDocument: () => ReturnType<EditorStore['getDocument']>;
  simulateStorageQuotaError: () => void;
}

declare global {
  interface Window {
    __MAP_EDITOR_DEBUG__?: MapEditorDebugHandle;
  }
}

interface BenchmarkPassStats {
  frames: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
  workMedianMs: number;
  workP95Ms: number;
  workMaxMs: number;
  scale: number;
}

interface BenchmarkReport {
  objectCount: number;
  userAgent: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  normalZoom: BenchmarkPassStats;
  zoomedIn: BenchmarkPassStats;
  pngEncodeMs: number;
  pngBytes: number;
  pdfExportMs: number;
  pdfBytes: number;
  pdfPageWidthPt: number;
  pdfPageHeightPt: number;
  jsHeapUsedMiB: number | null;
  jsHeapLimitMiB: number | null;
}

function summarizeFrameTimes(
  samples: number[],
  workSamples: number[],
  scale: number
): BenchmarkPassStats {
  if (samples.length === 0) {
    return {
      frames: 0,
      medianMs: 0,
      p95Ms: 0,
      maxMs: 0,
      meanMs: 0,
      workMedianMs: 0,
      workP95Ms: 0,
      workMaxMs: 0,
      scale
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const medianIdx = Math.floor(sorted.length * 0.5);
  const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  const sortedWork = [...workSamples].sort((a, b) => a - b);
  const wMedIdx = Math.floor(sortedWork.length * 0.5);
  const wP95Idx = Math.min(sortedWork.length - 1, Math.floor(sortedWork.length * 0.95));

  return {
    frames: sorted.length,
    medianMs: Number(sorted[medianIdx].toFixed(2)),
    p95Ms: Number(sorted[p95Idx].toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    meanMs: Number((sum / sorted.length).toFixed(2)),
    workMedianMs: sortedWork.length > 0 ? Number(sortedWork[wMedIdx].toFixed(2)) : 0,
    workP95Ms: sortedWork.length > 0 ? Number(sortedWork[wP95Idx].toFixed(2)) : 0,
    workMaxMs: sortedWork.length > 0 ? Number(sortedWork[sortedWork.length - 1].toFixed(2)) : 0,
    scale: Number(scale.toFixed(4))
  };
}

function runBrushPassForDuration(
  store: EditorStore,
  durationMs: number
): Promise<BenchmarkPassStats> {
  return new Promise((resolve) => {
    const doc = store.getDocument();
    const { width, height } = doc.manifest.space;
    const scale = store.getSnapshot().camera.scale;
    const frameDeltas: number[] = [];
    const workSamples: number[] = [];

    store.setTool('raise');
    store.setBrushDiameter(96);
    store.setBrushIntensity(0.4);

    const startX = width * 0.28;
    const startY = height * 0.48;
    store.beginTerrainStroke(startX, startY);

    let startTime = 0;
    let prevFrame = 0;
    let step = 0;

    const tick = (now: number) => {
      if (startTime === 0) {
        startTime = now;
        prevFrame = now;
        requestAnimationFrame(tick);
        return;
      }

      const dt = now - prevFrame;
      prevFrame = now;
      frameDeltas.push(dt);

      step += 1;
      const t = step * 0.08;
      const x = width * (0.28 + 0.44 * (0.5 + 0.5 * Math.sin(t)));
      const y = height * (0.38 + 0.24 * Math.cos(t * 1.3));
      const workStart = performance.now();
      store.moveTerrainStroke(x, y);
      workSamples.push(performance.now() - workStart);

      if (now - startTime >= durationMs) {
        store.commitTerrainStroke();
        resolve(summarizeFrameTimes(frameDeltas, workSamples, scale));
        return;
      }
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });
}

function populateBenchmarkMap(store: EditorStore, symbolCount = 2000): void {
  const doc = createEmptyDocument({
    title: 'Benchmark 2000 simboli',
    seed: 173
  });

  // Registra tutti gli asset POI built-in e disegna un continente centrale
  doc.manifest.assets = BUILTIN_POI_CATALOG.map((item) => ({ ...item.asset }));
  const { widthPx, heightPx, mask, height, cover } = doc.terrain;
  const cx = widthPx * 0.5;
  const cy = heightPx * 0.5;
  const rx = widthPx * 0.38;
  const ry = heightPx * 0.36;

  for (let py = 0; py < heightPx; py += 1) {
    const ny = (py - cy) / ry;
    const rowOff = py * widthPx;
    for (let px = 0; px < widthPx; px += 1) {
      const nx = (px - cx) / rx;
      const dist = Math.hypot(nx, ny);
      if (dist <= 1.0) {
        const idx = rowOff + px;
        mask[idx] = 255;
        const elev = Math.min(255, Math.round((1 - dist) * 230));
        height[idx] = elev;
        if (elev >= 40 && elev <= 165) {
          cover[idx] = nx < 0 ? 1 : 2;
        }
      }
    }
  }

  const objects: MapObject[] = [];
  const cols = 50;
  const rows = 40;
  const { width: docW, height: docH } = doc.manifest.space;
  const marginX = docW * 0.14;
  const marginY = docH * 0.14;
  const spanX = docW - marginX * 2;
  const spanY = docH - marginY * 2;

  for (let i = 0; i < symbolCount; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols) % rows;
    const x = Number((marginX + (col / (cols - 1)) * spanX).toFixed(2));
    const y = Number((marginY + (row / (rows - 1)) * spanY).toFixed(2));
    if (i % 20 === 0) {
      objects.push(
        createLabelObject(`Luogo ${i + 1}`, x, y, doc.theme, undefined, {
          fontSize: Number(ptToDocUnits(9).toFixed(2))
        })
      );
    } else {
      const item = BUILTIN_POI_CATALOG[i % BUILTIN_POI_CATALOG.length];
      objects.push(createPoiStampObject(item, x, y));
    }
  }

  doc.manifest.objects = objects;
  doc.manifest.revision = 1;
  doc.terrainVersion = 1;
  store.loadDocument(doc);
}

export default function App() {
  const [store, setStore] = useState<EditorStore | null>(null);
  const [inlineLabelSession, setInlineLabelSession] = useState<InlineLabelEditRequest | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkReport, setBenchmarkReport] = useState<BenchmarkReport | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const objectsControllerRef = useRef<ObjectsLayerController | null>(null);
  const persistenceRef = useRef<PersistenceService | null>(null);

  const qaMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('qa') === '1';

  useEffect(() => {
    let cancelled = false;

    const strokeSession = new TerrainStrokeSession();
    const renderer = new TerrainRenderer();
    const persistence = new PersistenceService({ debounceMs: 350 });
    persistenceRef.current = persistence;

    const editorStore = new EditorStore({
      initialDocument: createEmptyDocument({ title: 'Nuova carta' }),
      strokeSession,
      renderer,
      persistence
    });

    setStore(editorStore);

    const detachKeyboard = attachEditorKeyboardListeners(editorStore);
    const onDeleteKeyDown = (e: KeyboardEvent) => {
      objectsControllerRef.current?.handleKeyDown(e);
    };
    window.addEventListener('keydown', onDeleteKeyDown);

    window.__MAP_EDITOR_DEBUG__ = {
      store: editorStore,
      getDocument: () => editorStore.getDocument(),
      simulateStorageQuotaError: () => {
        const internal = persistence as unknown as {
          setState?: (state: { status: 'error'; savedRevision: number; errorMessage: string }) => void;
        };
        if (typeof internal.setState === 'function') {
          internal.setState({
            status: 'error',
            savedRevision: editorStore.getSnapshot().persistenceState.savedRevision,
            errorMessage: 'Spazio locale esaurito. Scarica una copia del progetto.'
          });
        }
      }
    };

    void persistence
      .listProjects()
      .then(async (projects) => {
        if (cancelled || projects.length === 0) return;
        const currentDoc = editorStore.getDocument();
        if (currentDoc.manifest.revision > 0 || editorStore.getStrokeSession().isActive()) {
          return;
        }
        await editorStore.openLocalProject(projects[0].id);
      })
      .catch(() => {
        // IndexedDB non disponibile: mantiene la carta vuota in memoria
      });

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onDeleteKeyDown);
      detachKeyboard();
      if (window.__MAP_EDITOR_DEBUG__?.store === editorStore) {
        delete window.__MAP_EDITOR_DEBUG__;
      }
      objectsControllerRef.current?.dispose();
      objectsControllerRef.current = null;
      persistenceRef.current = null;
      editorStore.dispose();
      persistence.dispose();
      renderer.dispose();
    };
  }, []);

  const handleLayersReady = useCallback(
    (layers: ViewportLayersHandle | null) => {
      objectsControllerRef.current?.dispose();
      objectsControllerRef.current = null;
      if (!layers || !store) return;
      objectsControllerRef.current = new ObjectsLayerController({
        layers,
        store,
        onRequestInlineLabelEdit: (req) => setInlineLabelSession(req)
      });
    },
    [store]
  );

  const handleCloseInlineEditor = useCallback(() => {
    setInlineLabelSession(null);
  }, []);

  const handleSimulateQuotaError = () => {
    window.__MAP_EDITOR_DEBUG__?.simulateStorageQuotaError();
  };

  const handleRestoreStorageState = () => {
    if (!store || !persistenceRef.current) return;
    const internal = persistenceRef.current as unknown as {
      setState?: (state: { status: 'saved'; savedRevision: number }) => void;
    };
    if (typeof internal.setState === 'function') {
      internal.setState({
        status: 'saved',
        savedRevision: store.getDocument().manifest.revision
      });
    }
    store.closeDialog();
  };

  const handleRunBenchmark = async () => {
    if (!store || benchmarkRunning) return;
    setBenchmarkRunning(true);
    setBenchmarkError(null);
    setBenchmarkReport(null);

    try {
      populateBenchmarkMap(store, 2000);
      store.fitCamera();
      await new Promise((r) => setTimeout(r, 150));

      const normalZoom = await runBrushPassForDuration(store, 10_000);

      const vp = store.getSnapshot().viewportSize;
      store.zoomAt(vp.width / 2 || 480, vp.height / 2 || 320, 2.5);
      await new Promise((r) => setTimeout(r, 150));

      const zoomedIn = await runBrushPassForDuration(store, 10_000);

      const currentDoc = store.getDocument();
      const pngStart = performance.now();
      const maskPngBytes = encodeMaskPng(
        currentDoc.terrain.mask,
        currentDoc.terrain.widthPx,
        currentDoc.terrain.heightPx
      );
      const pngEncodeMs = Number((performance.now() - pngStart).toFixed(1));

      const renderer = store.getRenderer();
      const exportStart = performance.now();
      const pdfRes = await exportDocumentToPdf(currentDoc, {
        ppi: 300,
        extraAssetBlobs: store.getExtraAssetBlobs(),
        existingTerrainRenderer: renderer instanceof TerrainRenderer ? renderer : undefined
      });
      const pdfExportMs = Number((performance.now() - exportStart).toFixed(1));

      const mem = (
        performance as unknown as {
          memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
        }
      ).memory;

      setBenchmarkReport({
        objectCount: currentDoc.manifest.objects.length,
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio || 1,
        normalZoom,
        zoomedIn,
        pngEncodeMs,
        pngBytes: maskPngBytes.byteLength,
        pdfExportMs,
        pdfBytes: pdfRes.bytes.byteLength,
        pdfPageWidthPt: Number(pdfRes.pageWidthPt.toFixed(2)),
        pdfPageHeightPt: Number(pdfRes.pageHeightPt.toFixed(2)),
        jsHeapUsedMiB: mem ? Number((mem.usedJSHeapSize / (1024 * 1024)).toFixed(1)) : null,
        jsHeapLimitMiB: mem ? Number((mem.jsHeapSizeLimit / (1024 * 1024)).toFixed(1)) : null
      });
    } catch (err) {
      setBenchmarkError(err instanceof Error ? err.message : String(err));
    } finally {
      setBenchmarkRunning(false);
    }
  };

  if (!store) {
    return (
      <div className="editor-shell" aria-busy="true">
        <div
          style={{
            gridColumn: '1 / -1',
            gridRow: '1 / -1',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--ui-text)'
          }}
        >
          Preparazione del tavolo da disegno…
        </div>
      </div>
    );
  }

  return (
    <div className="editor-shell">
      <TopBar store={store} />
      <div className="editor-workspace">
        <ToolRail store={store} />
        <MapViewport
          store={store}
          onLayersReady={handleLayersReady}
          onObjectPointerDown={(ctx) => objectsControllerRef.current?.handlePointerDown(ctx) ?? false}
          onObjectPointerMove={(ctx) => objectsControllerRef.current?.handlePointerMove(ctx)}
          onObjectPointerUp={(ctx) => objectsControllerRef.current?.handlePointerUp(ctx)}
          onObjectDoubleClick={(ctx) => objectsControllerRef.current?.handleDoubleClick(ctx)}
          onCursorDocMove={(pt) => objectsControllerRef.current?.setCursorDocPoint(pt)}
          inlineEditorSlot={
            <InlineLabelEditor
              store={store}
              session={inlineLabelSession}
              onClose={handleCloseInlineEditor}
            />
          }
        />
        <PropertiesPanel
          store={store}
          layersSlot={<LayersPanel store={store} />}
          pathToolSlot={<PathToolPanel store={store} />}
          poiLibrarySlot={<PoiLibraryPanel store={store} />}
          objectInspectorSlot={<ObjectInspector store={store} />}
          objectListSlot={<ObjectListPanel store={store} />}
        />
      </div>
      <StatusBar store={store} />
      <DialogsHost store={store} exportPdfDialogSlot={<ExportPdfDialog store={store} />} />

      {qaMode ? (
        <div
          data-testid="qa-harness"
          style={{
            position: 'fixed',
            right: 12,
            bottom: 44,
            zIndex: 150,
            background: '#17232D',
            border: '1px solid #81939A',
            borderRadius: 6,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxWidth: 360,
            fontSize: 12,
            color: '#F3EEDF'
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary btn-compact" onClick={handleSimulateQuotaError}>
              Simula errore quota
            </button>
            <button type="button" className="btn btn-secondary btn-compact" onClick={handleRestoreStorageState}>
              Ripristina storage
            </button>
            <button
              type="button"
              className="btn btn-primary btn-compact"
              disabled={benchmarkRunning}
              onClick={() => void handleRunBenchmark()}
            >
              {benchmarkRunning ? 'Benchmark in corso…' : 'Benchmark 2000 simboli'}
            </button>
          </div>
          {benchmarkError ? <div style={{ color: '#FFB3A6' }}>{benchmarkError}</div> : null}
          {benchmarkReport ? (
            <pre
              data-testid="qa-benchmark-result"
              style={{ margin: 0, maxHeight: 180, overflow: 'auto', fontSize: 11 }}
            >
              {JSON.stringify(benchmarkReport, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
