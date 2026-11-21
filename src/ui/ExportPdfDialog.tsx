import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { disposeLoadedAssets, loadAssetsForDocument } from '../assets/catalog';
import { LoadedAssetMap } from '../assets/types';
import { buildPdfFilename, exportDocumentToPdf, triggerPdfDownload } from '../export/pdfExporter';
import { PdfExportResult } from '../export/types';
import {
  DEFAULT_EXPORT_PPI,
  clampPrintDimensions,
  mmToPdfPoints
} from '../model/coordinates';
import { MapDocument } from '../model/document';
import { composeDocumentToCanvas, ensureDocumentFontsLoaded } from '../render/composeDocument';
import { EditorSnapshot, EditorStore } from '../state/editorStore';
import { TerrainRenderer } from '../terrain';
import { ITerrainRenderer } from '../terrain/types';
import { ModalDialog } from './Dialogs';
import { AlertErrorIcon, ExportPdfIcon } from './icons';

export interface ExportPdfDialogProps {
  store?: EditorStore;
  doc?: MapDocument;
  extraAssetBlobs?: Map<string, Blob>;
  existingTerrainRenderer?: ITerrainRenderer;
  isGestureActive?: () => boolean;
  ppi?: number;
  onClose?: () => void;
  onExportSuccess?: (result: PdfExportResult) => void;
}

const PRINT_PPI_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 150, label: '150 ppi (Bozza / Veloce)' },
  { value: 200, label: '200 ppi (Bilanciato)' },
  { value: 300, label: '300 ppi (Stampa editoriale)' }
];

const PREVIEW_MAX_WIDTH_CSS = 440;
const PREVIEW_MAX_HEIGHT_CSS = 240;

const noopSubscribe = () => () => {};
const getNullSnapshot = (): EditorSnapshot | null => null;

function useOptionalEditorStore(store?: EditorStore): EditorSnapshot | null {
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : getNullSnapshot,
    store ? store.getSnapshot : getNullSnapshot
  );
}

function formatPtItalian(pt: number): string {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false
  }).format(pt);
}

function formatMmValue(mm: number): string {
  return Number.isInteger(mm)
    ? String(mm)
    : new Intl.NumberFormat('it-IT', {
        maximumFractionDigits: 1,
        useGrouping: false
      }).format(mm);
}

function getOrientationLabel(widthMm: number, heightMm: number): string {
  if (widthMm > heightMm) return 'Orizzontale';
  if (heightMm > widthMm) return 'Verticale';
  return 'Quadrato';
}

function computePreviewPixelSize(
  widthMm: number,
  heightMm: number,
  dpr: number
): { widthPx: number; heightPx: number } {
  const aspect = widthMm / heightMm;
  let cssW = PREVIEW_MAX_WIDTH_CSS;
  let cssH = cssW / aspect;
  if (cssH > PREVIEW_MAX_HEIGHT_CSS) {
    cssH = PREVIEW_MAX_HEIGHT_CSS;
    cssW = cssH * aspect;
  }
  const scale = Math.min(2, Math.max(1, dpr));
  return {
    widthPx: Math.max(1, Math.round(cssW * scale)),
    heightPx: Math.max(1, Math.round(cssH * scale))
  };
}

async function canvasToPreviewUrl(
  canvas: HTMLCanvasElement
): Promise<{ url: string; isObjectUrl: boolean }> {
  if (
    typeof canvas.toBlob === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png');
    });
    if (blob) {
      return { url: URL.createObjectURL(blob), isObjectUrl: true };
    }
  }
  return { url: canvas.toDataURL('image/png'), isObjectUrl: false };
}

export function ExportPdfDialog({
  store,
  doc: docProp,
  extraAssetBlobs: extraAssetBlobsProp,
  existingTerrainRenderer: existingRendererProp,
  isGestureActive: isGestureActiveProp,
  ppi = DEFAULT_EXPORT_PPI,
  onClose,
  onExportSuccess
}: ExportPdfDialogProps) {
  const snap = useOptionalEditorStore(store);
  const doc = docProp ?? snap?.doc;

  const ppiSelectId = useId();
  const ppiNoticeId = useId();
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const isExportingRef = useRef(false);
  const mountedRef = useRef(true);
  const exportRunIdRef = useRef(0);
  const previewUrlRef = useRef<{ url: string; isObjectUrl: boolean } | null>(null);

  const [selectedPpi, setSelectedPpi] = useState<number>(ppi);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const extraAssetBlobs = extraAssetBlobsProp ?? store?.getExtraAssetBlobs();
  const storeRenderer = store?.getRenderer();
  const existingTerrainRenderer =
    existingRendererProp ??
    (storeRenderer instanceof TerrainRenderer ? storeRenderer : undefined);

  useEffect(() => {
    setSelectedPpi(ppi);
  }, [ppi]);

  const revokeCurrentPreview = () => {
    const current = previewUrlRef.current;
    if (current?.isObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(current.url);
    }
    previewUrlRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      exportRunIdRef.current += 1;
      revokeCurrentPreview();
    };
  }, []);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let loadedAssets: LoadedAssetMap | null = null;
    let offscreenCanvas: HTMLCanvasElement | null = null;

    setIsPreviewLoading(true);
    setPreviewError(null);
    revokeCurrentPreview();
    setPreviewUrl(null);

    const generatePreview = async () => {
      try {
        await ensureDocumentFontsLoaded(doc);
        loadedAssets = await loadAssetsForDocument(doc, extraAssetBlobs);
        if (cancelled) return;

        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const { widthPx, heightPx } = computePreviewPixelSize(
          doc.manifest.page.widthMm,
          doc.manifest.page.heightMm,
          dpr
        );

        offscreenCanvas = composeDocumentToCanvas(doc, loadedAssets, {
          widthPx,
          heightPx,
          existingTerrainRenderer
        });

        const generated = await canvasToPreviewUrl(offscreenCanvas);
        if (cancelled) {
          if (
            generated.isObjectUrl &&
            typeof URL !== 'undefined' &&
            typeof URL.revokeObjectURL === 'function'
          ) {
            URL.revokeObjectURL(generated.url);
          }
          return;
        }

        previewUrlRef.current = generated;
        setPreviewUrl(generated.url);
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : 'Impossibile generare l’anteprima della pagina.';
          setPreviewError(message);
        }
      } finally {
        if (offscreenCanvas) {
          offscreenCanvas.width = 0;
          offscreenCanvas.height = 0;
          offscreenCanvas = null;
        }
        if (loadedAssets) {
          disposeLoadedAssets(loadedAssets);
          loadedAssets = null;
        }
        if (!cancelled) {
          setIsPreviewLoading(false);
        }
      }
    };

    void generatePreview();

    return () => {
      cancelled = true;
      revokeCurrentPreview();
    };
  }, [
    doc,
    doc?.manifest.revision,
    doc?.terrainVersion,
    doc?.manifest.page.widthMm,
    doc?.manifest.page.heightMm,
    doc?.manifest.layers,
    extraAssetBlobs,
    existingTerrainRenderer
  ]);

  if (!doc) return null;

  const { page, title } = doc.manifest;
  const orientation = getOrientationLabel(page.widthMm, page.heightMm);
  const {
    widthPx: rasterWidthPx,
    heightPx: rasterHeightPx,
    effectivePpi
  } = clampPrintDimensions(page, selectedPpi);
  const isPpiClamped = effectivePpi < Math.round(selectedPpi);
  const hiddenLayers = (doc.manifest.layers ?? []).filter((layer) => !layer.visible);
  const pageWidthPt = mmToPdfPoints(page.widthMm);
  const pageHeightPt = mmToPdfPoints(page.heightMm);
  const filename = buildPdfFilename(title);
  const activeError = exportError ?? previewError;

  const handleClose = () => {
    exportRunIdRef.current += 1;
    revokeCurrentPreview();
    setPreviewUrl(null);
    if (onClose) {
      onClose();
    } else {
      store?.closeDialog();
    }
  };

  const handleExport = async () => {
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    const runId = exportRunIdRef.current + 1;
    exportRunIdRef.current = runId;

    setIsExporting(true);
    setExportError(null);

    try {
      const gestureCheck =
        isGestureActiveProp ??
        (store ? () => store.getStrokeSession().isActive() : undefined);

      const result = await exportDocumentToPdf(doc, {
        ppi: selectedPpi,
        extraAssetBlobs,
        existingTerrainRenderer,
        isGestureActive: gestureCheck
      });

      if (!mountedRef.current || exportRunIdRef.current !== runId) {
        return;
      }

      triggerPdfDownload(result);
      store?.setStatusNotice({
        tone: 'success',
        text: `PDF esportato: ${result.filename}`
      });
      onExportSuccess?.(result);
      handleClose();
    } catch (err) {
      if (mountedRef.current && exportRunIdRef.current === runId) {
        const message =
          err instanceof Error
            ? err.message
            : 'Impossibile completare l’esportazione del PDF.';
        setExportError(message);
      }
    } finally {
      isExportingRef.current = false;
      if (mountedRef.current) {
        setIsExporting(false);
      }
    }
  };

  return (
    <ModalDialog
      title="Esporta PDF"
      onClose={handleClose}
      initialFocusRef={exportBtnRef}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
          >
            Annulla
          </button>
          <button
            ref={exportBtnRef}
            type="button"
            className="btn btn-primary"
            disabled={isExporting}
            aria-busy={isExporting}
            onClick={() => void handleExport()}
          >
            <ExportPdfIcon size={18} />
            <span>{isExporting ? 'Esportazione…' : 'Esporta PDF'}</span>
          </button>
        </>
      }
    >
      <div
        className="swatch-frame"
        style={{
          padding: 'var(--ui-space-3)',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 168
        }}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Anteprima della pagina completa pronta per la stampa"
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: PREVIEW_MAX_HEIGHT_CSS,
              aspectRatio: `${page.widthMm} / ${page.heightMm}`,
              objectFit: 'contain',
              borderRadius: 2,
              boxShadow: '0 8px 20px rgba(8, 13, 18, 0.55)'
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              maxWidth: 300,
              aspectRatio: `${page.widthMm} / ${page.heightMm}`,
              maxHeight: PREVIEW_MAX_HEIGHT_CSS,
              display: 'grid',
              placeItems: 'center',
              padding: 'var(--ui-space-3)',
              border: '1px dashed var(--ui-line-subtle)',
              borderRadius: 'var(--ui-radius-control)',
              color: 'var(--ui-muted)',
              fontSize: 13,
              lineHeight: '18px',
              textAlign: 'center'
            }}
          >
            {isPreviewLoading
              ? 'Preparazione anteprima…'
              : previewError
                ? 'Anteprima non disponibile.'
                : 'Nessuna anteprima disponibile.'}
          </div>
        )}
      </div>

      <div className="form-field">
        <label className="field-label" htmlFor={ppiSelectId}>
          Risoluzione di stampa
        </label>
        <select
          id={ppiSelectId}
          className="select-input"
          value={selectedPpi}
          disabled={isExporting}
          aria-describedby={isPpiClamped ? ppiNoticeId : undefined}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next) && next > 0) {
              setSelectedPpi(next);
              setExportError(null);
            }
          }}
        >
          {PRINT_PPI_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
          {!PRINT_PPI_OPTIONS.some((opt) => opt.value === selectedPpi) ? (
            <option value={selectedPpi}>{selectedPpi} ppi (Personalizzato)</option>
          ) : null}
        </select>
        {isPpiClamped ? (
          <p
            id={ppiNoticeId}
            role="status"
            className="panel-hint"
            style={{ color: 'var(--ui-text)' }}
          >
            Per il formato {formatMmValue(page.widthMm)} × {formatMmValue(page.heightMm)} mm, la
            risoluzione effettiva viene adattata automaticamente da{' '}
            <span className="tabular-nums">{Math.round(selectedPpi)}</span> a{' '}
            <span className="tabular-nums">{effectivePpi} ppi</span> (
            <span className="tabular-nums">
              {rasterWidthPx} × {rasterHeightPx} px
            </span>
            ) per restare entro i limiti sicuri di stampa.
          </p>
        ) : null}
      </div>

      <dl
        className="inspector-summary-grid"
        style={{
          margin: 0,
          padding: 'var(--ui-space-3)',
          backgroundColor: 'var(--ui-raised)',
          border: 'var(--ui-border-w) solid var(--ui-line-subtle)',
          borderRadius: 'var(--ui-radius-control)'
        }}
      >
        <dt className="inspector-summary-key">Orientamento</dt>
        <dd className="inspector-summary-val" style={{ margin: 0 }}>
          {orientation}
        </dd>

        <dt className="inspector-summary-key">Formato fisico</dt>
        <dd className="inspector-summary-val tabular-nums" style={{ margin: 0 }}>
          {formatMmValue(page.widthMm)} × {formatMmValue(page.heightMm)} mm
        </dd>

        <dt className="inspector-summary-key">Risoluzione</dt>
        <dd className="inspector-summary-val tabular-nums" style={{ margin: 0 }}>
          {effectivePpi} ppi · {rasterWidthPx} × {rasterHeightPx} px
        </dd>

        <dt className="inspector-summary-key">Formato pagina PDF</dt>
        <dd className="inspector-summary-val tabular-nums" style={{ margin: 0 }}>
          {formatPtItalian(pageWidthPt)} × {formatPtItalian(pageHeightPt)} pt
        </dd>

        <dt className="inspector-summary-key">Nome file</dt>
        <dd
          className="inspector-summary-val"
          style={{
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={filename}
        >
          {filename}
        </dd>
      </dl>

      {hiddenLayers.length > 0 ? (
        <p
          role="status"
          style={{
            margin: 0,
            padding: 'var(--ui-space-2) var(--ui-space-3)',
            backgroundColor: 'rgba(23, 35, 45, 0.55)',
            border: 'var(--ui-border-w) solid var(--ui-line-subtle)',
            borderRadius: 'var(--ui-radius-control)',
            color: 'var(--ui-muted)',
            fontSize: 13,
            lineHeight: '18px'
          }}
        >
          {hiddenLayers.length === 1
            ? `1 livello nascosto escluso dalla stampa: «${hiddenLayers[0].name}».`
            : `${hiddenLayers.length} livelli nascosti esclusi dalla stampa: ${hiddenLayers
                .map((l) => `«${l.name}»`)
                .join(', ')}.`}
        </p>
      ) : null}

      {activeError ? (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--ui-space-2)',
            padding: 'var(--ui-space-3)',
            backgroundColor: 'rgba(23, 35, 45, 0.72)',
            border: 'var(--ui-border-w) solid var(--ui-error)',
            borderRadius: 'var(--ui-radius-control)',
            color: 'var(--ui-error)',
            fontSize: 13,
            lineHeight: '18px',
            fontWeight: 600
          }}
        >
          <AlertErrorIcon size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{activeError}</span>
        </div>
      ) : null}
    </ModalDialog>
  );
}
