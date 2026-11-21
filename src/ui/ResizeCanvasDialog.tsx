import { useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  CanvasResizeSnapshot,
  ResizeCanvasCommand
} from '../model/commands';
import {
  DEFAULT_INTERACTIVE_MAX_MASK_PIXELS,
  MAX_MASK_DIM_PX,
  MAX_PAGE_MM,
  MIN_MASK_DIM_PX,
  MIN_PAGE_MM,
  MaskDimensions,
  PAGE_PRESETS,
  PageSizeMm,
  ResizeAnchor,
  ResizeCanvasMode,
  computeAnchorOffset,
  pageMmToInteractiveMaskDimensions,
  pageMmToSpace,
  validatePageSizeMm
} from '../model/coordinates';
import { MapDocument, MapObject, cloneMapObject } from '../model/document';
import { resizeTerrainBuffers } from '../terrain';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { ModalDialog } from './Dialogs';
import { SwapOrientationIcon } from './icons';

const ANCHOR_ITEMS: ReadonlyArray<{
  id: ResizeAnchor;
  label: string;
  row: number;
  col: number;
}> = [
  { id: 'top-left', label: 'In alto a sinistra', row: 0, col: 0 },
  { id: 'top', label: 'In alto al centro', row: 0, col: 1 },
  { id: 'top-right', label: 'In alto a destra', row: 0, col: 2 },
  { id: 'left', label: 'Al centro a sinistra', row: 1, col: 0 },
  { id: 'center', label: 'Al centro', row: 1, col: 1 },
  { id: 'right', label: 'Al centro a destra', row: 1, col: 2 },
  { id: 'bottom-left', label: 'In basso a sinistra', row: 2, col: 0 },
  { id: 'bottom', label: 'In basso al centro', row: 2, col: 1 },
  { id: 'bottom-right', label: 'In basso a destra', row: 2, col: 2 }
];

/**
 * Computes transformed objects (`StampObject`, `LabelObject`, and `PathObject`
 * including relative vertices `points` and `strokeWidthDoc`) for a canvas resize.
 */
export function resizeMapObjects(
  objects: readonly MapObject[],
  oldSpace: { width: number; height: number },
  newSpace: { width: number; height: number },
  mode: ResizeCanvasMode,
  anchor: ResizeAnchor
): MapObject[] {
  if (mode === 'expand-crop') {
    const { dx, dy } = computeAnchorOffset(
      oldSpace.width,
      oldSpace.height,
      newSpace.width,
      newSpace.height,
      anchor
    );
    return objects.map((obj) => {
      const cloned = cloneMapObject(obj);
      cloned.x = Number((cloned.x + dx).toFixed(2));
      cloned.y = Number((cloned.y + dy).toFixed(2));
      return cloned;
    });
  }

  const scaleX = newSpace.width / oldSpace.width;
  const scaleY = newSpace.height / oldSpace.height;
  const avgScale = (scaleX + scaleY) * 0.5;

  return objects.map((obj) => {
    const cloned = cloneMapObject(obj);
    cloned.x = Number((cloned.x * scaleX).toFixed(2));
    cloned.y = Number((cloned.y * scaleY).toFixed(2));

    if (cloned.type === 'stamp') {
      if (cloned.rotationDeg === 0 || Math.abs(scaleX - scaleY) < 1e-9) {
        cloned.width = Math.max(4, Number((cloned.width * scaleX).toFixed(2)));
        cloned.height = Math.max(4, Number((cloned.height * scaleY).toFixed(2)));
      } else {
        const rad = (cloned.rotationDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const effScaleW = Math.hypot(scaleX * cos, scaleY * sin);
        const effScaleH = Math.hypot(scaleX * sin, scaleY * cos);
        cloned.width = Math.max(4, Number((cloned.width * effScaleW).toFixed(2)));
        cloned.height = Math.max(4, Number((cloned.height * effScaleH).toFixed(2)));
      }
    } else if (cloned.type === 'label') {
      cloned.fontSize = Math.max(4, Number((cloned.fontSize * avgScale).toFixed(2)));
    } else if (cloned.type === 'path') {
      if (cloned.rotationDeg === 0 || Math.abs(scaleX - scaleY) < 1e-9) {
        cloned.points = cloned.points.map((coord, idx) =>
          Number((coord * (idx % 2 === 0 ? scaleX : scaleY)).toFixed(2))
        );
      } else {
        const rad = (cloned.rotationDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const nextPoints: number[] = [];
        for (let i = 0; i < cloned.points.length; i += 2) {
          const px = cloned.points[i];
          const py = cloned.points[i + 1];
          const wx = px * cos - py * sin;
          const wy = px * sin + py * cos;
          const sx = wx * scaleX;
          const sy = wy * scaleY;
          const nx = sx * cos + sy * sin;
          const ny = -sx * sin + sy * cos;
          nextPoints.push(Number(nx.toFixed(2)), Number(ny.toFixed(2)));
        }
        cloned.points = nextPoints;
      }
      cloned.strokeWidthDoc = Math.max(1, Number((cloned.strokeWidthDoc * avgScale).toFixed(2)));
    }
    return cloned;
  });
}

/**
 * Computes target terrain mask dimensions for a canvas resize.
 * In `expand-crop`, preserves the current pixel-per-doc-unit density whenever it
 * stays within interactive limits (`DEFAULT_INTERACTIVE_MAX_MASK_PIXELS` & `MAX_MASK_DIM_PX`),
 * otherwise falls back to `pageMmToInteractiveMaskDimensions` and returns `needsDensityResample`.
 */
export function computeTargetMaskDimensions(
  doc: MapDocument,
  nextPage: PageSizeMm,
  mode: ResizeCanvasMode
): MaskDimensions & { needsDensityResample: boolean } {
  if (mode === 'scale-content') {
    return {
      ...pageMmToInteractiveMaskDimensions(nextPage),
      needsDensityResample: false
    };
  }

  const prevSpace = doc.manifest.space;
  const nextSpace = pageMmToSpace(nextPage);
  const idealW = Math.max(
    MIN_MASK_DIM_PX,
    Math.round(nextSpace.width * (doc.terrain.widthPx / prevSpace.width))
  );
  const idealH = Math.max(
    MIN_MASK_DIM_PX,
    Math.round(nextSpace.height * (doc.terrain.heightPx / prevSpace.height))
  );

  if (
    idealW <= MAX_MASK_DIM_PX &&
    idealH <= MAX_MASK_DIM_PX &&
    idealW * idealH <= DEFAULT_INTERACTIVE_MAX_MASK_PIXELS
  ) {
    return { widthPx: idealW, heightPx: idealH, needsDensityResample: false };
  }

  return {
    ...pageMmToInteractiveMaskDimensions(nextPage),
    needsDensityResample: true
  };
}

/**
 * Builds an atomic, undoable `ResizeCanvasCommand` updating page dimensions,
 * logical space, terrain buffers (`mask`, `height`, `cover`), and all objects.
 */
export function buildResizeCanvasCommand(
  doc: MapDocument,
  options: {
    page: PageSizeMm;
    mode: ResizeCanvasMode;
    anchor: ResizeAnchor;
  }
): ResizeCanvasCommand {
  const nextPage: PageSizeMm = {
    widthMm: Math.round(options.page.widthMm),
    heightMm: Math.round(options.page.heightMm)
  };
  validatePageSizeMm(nextPage);

  const prevSpace = { ...doc.manifest.space };
  const nextSpace = pageMmToSpace(nextPage);
  const targetMask = computeTargetMaskDimensions(doc, nextPage, options.mode);

  let sourceTerrain = doc.terrain;
  if (options.mode === 'expand-crop' && targetMask.needsDensityResample) {
    // Riallinea prima la densità px/u dell'area originale alla densità della nuova tela
    // affinché la geografia mantenga la stessa scala fisica degli oggetti.
    const resampledPrevW = Math.max(
      1,
      Math.round((prevSpace.width / nextSpace.width) * targetMask.widthPx)
    );
    const resampledPrevH = Math.max(
      1,
      Math.round((prevSpace.height / nextSpace.height) * targetMask.heightPx)
    );
    sourceTerrain = resizeTerrainBuffers(
      doc.terrain,
      prevSpace,
      prevSpace,
      resampledPrevW,
      resampledPrevH,
      'scale-content',
      'center'
    );
  }

  const nextTerrain = resizeTerrainBuffers(
    sourceTerrain,
    prevSpace,
    nextSpace,
    targetMask.widthPx,
    targetMask.heightPx,
    options.mode,
    options.anchor
  );

  const nextObjects = resizeMapObjects(
    doc.manifest.objects,
    prevSpace,
    nextSpace,
    options.mode,
    options.anchor
  );

  const beforeSnapshot: CanvasResizeSnapshot = {
    page: { ...doc.manifest.page },
    space: prevSpace,
    terrain: doc.terrain,
    objects: doc.manifest.objects
  };

  const afterSnapshot: CanvasResizeSnapshot = {
    page: nextPage,
    space: nextSpace,
    terrain: nextTerrain,
    objects: nextObjects
  };

  const modeLabel =
    options.mode === 'scale-content' ? 'Scala contenuto' : 'Espandi/Ritaglia';
  const label = `Ridimensiona tela (${nextPage.widthMm}×${nextPage.heightMm} mm, ${modeLabel})`;

  return new ResizeCanvasCommand(beforeSnapshot, afterSnapshot, label);
}

function findMatchingPresetId(w: number, h: number): string {
  const match = PAGE_PRESETS.find(
    (p) => Math.round(p.page.widthMm) === w && Math.round(p.page.heightMm) === h
  );
  return match ? match.id : 'custom';
}

function AnchorCellGlyph({
  isSelected,
  dx,
  dy
}: {
  isSelected: boolean;
  dx: number;
  dy: number;
}) {
  if (isSelected) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
      </svg>
    );
  }
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: `rotate(${angle}deg)` }}
      aria-hidden="true"
    >
      <path d="M3.5 8h8.5" />
      <path d="m8.8 4.8 3.2 3.2-3.2 3.2" />
    </svg>
  );
}

export interface ResizeCanvasDialogProps {
  store: EditorStore;
}

export function ResizeCanvasDialog({ store }: ResizeCanvasDialogProps) {
  const snap = useEditorStore(store);
  const { doc } = snap;
  const currentW = Math.round(doc.manifest.page.widthMm);
  const currentH = Math.round(doc.manifest.page.heightMm);

  const presetSelectRef = useRef<HTMLSelectElement>(null);
  const anchorBtnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const presetIdAttr = useId();
  const widthId = useId();
  const heightId = useId();

  const [widthInput, setWidthInput] = useState(String(currentW));
  const [heightInput, setHeightInput] = useState(String(currentH));
  const [mode, setMode] = useState<ResizeCanvasMode>('expand-crop');
  const [anchor, setAnchor] = useState<ResizeAnchor>('center');
  const [error, setError] = useState<string | null>(null);

  const parsedW = Number(widthInput);
  const parsedH = Number(heightInput);
  const isValidDims =
    Number.isFinite(parsedW) &&
    Number.isFinite(parsedH) &&
    Math.round(parsedW) >= MIN_PAGE_MM &&
    Math.round(parsedW) <= MAX_PAGE_MM &&
    Math.round(parsedH) >= MIN_PAGE_MM &&
    Math.round(parsedH) <= MAX_PAGE_MM;

  const targetW = isValidDims ? Math.round(parsedW) : currentW;
  const targetH = isValidDims ? Math.round(parsedH) : currentH;
  const activePresetId = findMatchingPresetId(targetW, targetH);
  const hasDimensionChange = isValidDims && (targetW !== currentW || targetH !== currentH);

  const liveMetrics = useMemo(() => {
    const page: PageSizeMm = { widthMm: targetW, heightMm: targetH };
    const space = pageMmToSpace(page);
    const mask = computeTargetMaskDimensions(doc, page, mode);
    return { page, space, mask };
  }, [doc, targetW, targetH, mode]);

  const activeAnchorInfo =
    ANCHOR_ITEMS.find((item) => item.id === anchor) ?? ANCHOR_ITEMS[4];

  const handlePresetChange = (nextPresetId: string) => {
    setError(null);
    if (nextPresetId === 'custom') return;
    const found = PAGE_PRESETS.find((p) => p.id === nextPresetId);
    if (found) {
      setWidthInput(String(found.page.widthMm));
      setHeightInput(String(found.page.heightMm));
    }
  };

  const handleSwapOrientation = () => {
    setWidthInput(heightInput);
    setHeightInput(widthInput);
    setError(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValidDims) {
      setError(
        `Inserisci dimensioni comprese tra ${MIN_PAGE_MM} e ${MAX_PAGE_MM} mm.`
      );
      return;
    }
    if (!hasDimensionChange) {
      store.closeDialog();
      return;
    }

    try {
      const command = buildResizeCanvasCommand(doc, {
        page: { widthMm: targetW, heightMm: targetH },
        mode,
        anchor
      });
      store.executeCommand(command);
      store.setStatusNotice({
        tone: 'success',
        text: `Tela ridimensionata a ${targetW} × ${targetH} mm.`
      });
      store.closeDialog();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossibile ridimensionare la tela.'
      );
    }
  };

  const handleAnchorKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    row: number,
    col: number
  ) => {
    if (mode === 'scale-content') return;
    let nextRow = row;
    let nextCol = col;
    if (e.key === 'ArrowRight') {
      nextCol = (col + 1) % 3;
    } else if (e.key === 'ArrowLeft') {
      nextCol = (col + 2) % 3;
    } else if (e.key === 'ArrowDown') {
      nextRow = (row + 1) % 3;
    } else if (e.key === 'ArrowUp') {
      nextRow = (row + 2) % 3;
    } else if (e.key === 'Home') {
      nextRow = 0;
      nextCol = 0;
    } else if (e.key === 'End') {
      nextRow = 2;
      nextCol = 2;
    } else {
      return;
    }
    e.preventDefault();
    const nextIdx = nextRow * 3 + nextCol;
    const nextItem = ANCHOR_ITEMS[nextIdx];
    if (nextItem) {
      setAnchor(nextItem.id);
      anchorBtnRefs.current[nextIdx]?.focus();
    }
  };

  // Anteprima proporzionale ancorata per confrontare vecchia e nuova tela nel box 116×80
  let oldRect: { x: number; y: number; width: number; height: number };
  let newRect: { x: number; y: number; width: number; height: number };
  let anchorDot: { x: number; y: number } | null = null;

  if (mode === 'expand-crop') {
    const { dx, dy } = computeAnchorOffset(currentW, currentH, targetW, targetH, anchor);
    const minX = Math.min(0, dx);
    const minY = Math.min(0, dy);
    const maxX = Math.max(targetW, dx + currentW);
    const maxY = Math.max(targetH, dy + currentH);
    const unionW = Math.max(1, maxX - minX);
    const unionH = Math.max(1, maxY - minY);
    const previewScale = Math.min(96 / unionW, 64 / unionH);
    const originX = (116 - unionW * previewScale) / 2 - minX * previewScale;
    const originY = (80 - unionH * previewScale) / 2 - minY * previewScale;

    oldRect = {
      x: originX + dx * previewScale,
      y: originY + dy * previewScale,
      width: Math.max(6, currentW * previewScale),
      height: Math.max(6, currentH * previewScale)
    };
    newRect = {
      x: originX,
      y: originY,
      width: Math.max(6, targetW * previewScale),
      height: Math.max(6, targetH * previewScale)
    };
    const anchorFactorX = activeAnchorInfo.col * 0.5;
    const anchorFactorY = activeAnchorInfo.row * 0.5;
    anchorDot = {
      x: newRect.x + newRect.width * anchorFactorX,
      y: newRect.y + newRect.height * anchorFactorY
    };
  } else {
    const maxBoxMm = Math.max(currentW, currentH, targetW, targetH, 1);
    const previewScale = Math.min(96 / maxBoxMm, 64 / maxBoxMm);
    const oldBoxW = Math.max(8, currentW * previewScale);
    const oldBoxH = Math.max(8, currentH * previewScale);
    const newBoxW = Math.max(8, targetW * previewScale);
    const newBoxH = Math.max(8, targetH * previewScale);
    oldRect = {
      x: (116 - oldBoxW) / 2,
      y: (80 - oldBoxH) / 2,
      width: oldBoxW,
      height: oldBoxH
    };
    newRect = {
      x: (116 - newBoxW) / 2,
      y: (80 - newBoxH) / 2,
      width: newBoxW,
      height: newBoxH
    };
  }

  return (
    <ModalDialog
      title="Ridimensiona tela"
      onClose={() => store.closeDialog()}
      initialFocusRef={presetSelectRef}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => store.closeDialog()}
          >
            Annulla
          </button>
          <button
            type="submit"
            form="resize-canvas-form"
            className="btn btn-primary"
            disabled={!isValidDims || !hasDimensionChange}
          >
            Applica ridimensionamento
          </button>
        </>
      }
    >
      <form id="resize-canvas-form" onSubmit={handleSubmit} className="panel-group">
        {/* Preset formato pagina */}
        <div className="form-field">
          <label className="field-label" htmlFor={presetIdAttr}>
            Formato predefinito
          </label>
          <select
            ref={presetSelectRef}
            id={presetIdAttr}
            className="select-input"
            value={activePresetId}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            {PAGE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            <option value="custom">Formato personalizzato (50–2000 mm)</option>
          </select>
        </div>

        {/* Larghezza, scambio orientamento, altezza */}
        <div className="resize-dims-row">
          <div className="form-field">
            <label className="field-label" htmlFor={widthId}>
              Larghezza (mm)
            </label>
            <input
              id={widthId}
              type="number"
              className="text-input tabular-nums"
              min={MIN_PAGE_MM}
              max={MAX_PAGE_MM}
              step={1}
              value={widthInput}
              onChange={(e) => {
                setWidthInput(e.target.value);
                setError(null);
              }}
            />
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-icon-only resize-swap-btn has-tooltip-top"
            aria-label="Scambia orientamento orizzontale e verticale"
            data-tooltip="Scambia L × A"
            onClick={handleSwapOrientation}
          >
            <SwapOrientationIcon size={18} />
          </button>

          <div className="form-field">
            <label className="field-label" htmlFor={heightId}>
              Altezza (mm)
            </label>
            <input
              id={heightId}
              type="number"
              className="text-input tabular-nums"
              min={MIN_PAGE_MM}
              max={MAX_PAGE_MM}
              step={1}
              value={heightInput}
              onChange={(e) => {
                setHeightInput(e.target.value);
                setError(null);
              }}
            />
          </div>
        </div>

        {/* Modalità ridimensionamento */}
        <div className="form-field">
          <span className="field-label">Modalità</span>
          <div className="segmented-group" role="group" aria-label="Modalità di ridimensionamento">
            <button
              type="button"
              className="segmented-btn"
              aria-pressed={mode === 'expand-crop'}
              onClick={() => setMode('expand-crop')}
            >
              Espandi / Ritaglia
            </button>
            <button
              type="button"
              className="segmented-btn"
              aria-pressed={mode === 'scale-content'}
              onClick={() => setMode('scale-content')}
            >
              Scala contenuto
            </button>
          </div>
          <p className="panel-hint">
            {mode === 'expand-crop'
              ? 'Mantiene la scala geografica: aggiunge mare o ritaglia i bordi rispetto all’ancora.'
              : 'Adatta proporzionalmente terreno, linee vettoriali e oggetti alle nuove dimensioni.'}
          </p>
        </div>

        {/* Griglia 3x3 ancore + Anteprima live */}
        <div className="resize-anchor-preview-grid">
          <div className="form-field">
            <span className="field-label">Ancora contenuto</span>
            <div
              className={`anchor-grid-3x3 ${mode === 'scale-content' ? 'is-disabled' : ''}`}
              role="radiogroup"
              aria-label="Griglia ancora a 9 punti"
              aria-disabled={mode === 'scale-content'}
            >
              {ANCHOR_ITEMS.map((item, idx) => {
                const isSelected = anchor === item.id;
                return (
                  <button
                    key={item.id}
                    ref={(el) => {
                      anchorBtnRefs.current[idx] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={item.label}
                    title={item.label}
                    tabIndex={mode === 'scale-content' ? -1 : isSelected ? 0 : -1}
                    disabled={mode === 'scale-content'}
                    className={`anchor-cell-btn ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => setAnchor(item.id)}
                    onKeyDown={(e) => handleAnchorKeyDown(e, item.row, item.col)}
                  >
                    <AnchorCellGlyph
                      isSelected={isSelected}
                      dx={item.col - activeAnchorInfo.col}
                      dy={item.row - activeAnchorInfo.row}
                    />
                  </button>
                );
              })}
            </div>
            <p className="panel-hint">
              {mode === 'scale-content'
                ? 'Disattivata in Scala contenuto.'
                : activeAnchorInfo.label}
            </p>
          </div>

          <div className="form-field">
            <span className="field-label">Anteprima live</span>
            <div className="resize-live-card">
              <div className="resize-live-diagram" aria-hidden="true">
                <svg viewBox="0 0 116 80" width="116" height="80">
                  <rect
                    x={newRect.x}
                    y={newRect.y}
                    width={newRect.width}
                    height={newRect.height}
                    fill="rgba(224, 187, 121, 0.14)"
                    stroke="#E0BB79"
                    strokeWidth="1.5"
                  />
                  <rect
                    x={oldRect.x}
                    y={oldRect.y}
                    width={oldRect.width}
                    height={oldRect.height}
                    fill="rgba(129, 147, 154, 0.18)"
                    stroke="#C0C9C9"
                    strokeWidth="1.2"
                    strokeDasharray="3 2"
                  />
                  {anchorDot ? (
                    <circle
                      cx={anchorDot.x}
                      cy={anchorDot.y}
                      r="2.8"
                      fill="#E0BB79"
                      stroke="#17232D"
                      strokeWidth="1"
                    />
                  ) : null}
                </svg>
              </div>
              <dl className="inspector-summary-grid resize-live-metrics">
                <dt className="inspector-summary-key">Attuale</dt>
                <dd className="inspector-summary-val">
                  {currentW} × {currentH} mm
                </dd>
                <dt className="inspector-summary-key">Nuovo</dt>
                <dd className="inspector-summary-val">
                  {targetW} × {targetH} mm
                </dd>
                <dt className="inspector-summary-key">Spazio</dt>
                <dd className="inspector-summary-val">
                  {liveMetrics.space.width} × {liveMetrics.space.height} u
                </dd>
                <dt className="inspector-summary-key">Raster</dt>
                <dd className="inspector-summary-val">
                  {liveMetrics.mask.widthPx} × {liveMetrics.mask.heightPx} px
                </dd>
              </dl>
            </div>
          </div>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </ModalDialog>
  );
}
