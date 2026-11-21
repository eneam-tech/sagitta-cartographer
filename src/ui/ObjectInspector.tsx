import { useEffect, useId, useRef, useState } from 'react';
import { clampNumber } from '../model/coordinates';
import {
  LabelObject,
  MapObject,
  PathObject,
  StampObject,
  resolveObjectLayerId
} from '../model/document';
import {
  DeleteObjectCommand,
  PATH_KIND_OPTIONS,
  commitObjectReorder,
  commitObjectUpdate,
  getDefaultObjectLabel,
  getDeleteObjectLabel,
  getPathKindLabel,
  normalizeRotationDeg
} from '../objects/objectCommands';
import { PathColorControls, SyncedRangeField } from '../objects/uiControls';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { LABEL_ROLE_PRESETS } from '../theme/theme';

export interface ObjectInspectorProps {
  store: EditorStore;
}

const LABEL_COLOR_SWATCHES = [
  { hex: '#263C40', name: 'Inchiostro' },
  { hex: '#17232D', name: 'Scuro' },
  { hex: '#F3EEDF', name: 'Pergamena' },
  { hex: '#8B493D', name: 'Terracotta' }
] as const;

function formatNum(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

interface CommittedNumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  compact?: boolean;
  disabled?: boolean;
  onCommit: (nextValue: number) => void;
}

function CommittedNumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  compact = false,
  disabled = false,
  onCommit
}: CommittedNumberFieldProps) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatNum(value));
  const cancelledRef = useRef(false);
  const skipNextBlurRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      setDraft(formatNum(value));
    }
  }, [value, editing]);

  const commitDraft = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (draft.trim() !== '' && Number.isFinite(parsed)) {
      const clamped = Number(clampNumber(parsed, min, max).toFixed(2));
      setDraft(formatNum(clamped));
      if (clamped !== value) {
        onCommit(clamped);
      }
    } else {
      setDraft(formatNum(value));
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--ui-space-2)'
      }}
    >
      <label
        htmlFor={inputId}
        style={{
          fontSize: '15px',
          lineHeight: '20px',
          fontWeight: 600,
          color: 'var(--ui-text)'
        }}
      >
        {label}
      </label>

      <div className="number-unit-wrap">
        <input
          id={inputId}
          type="number"
          className="number-input tabular-nums"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={editing ? draft : formatNum(value)}
          style={compact ? { width: '68px' } : { width: '82px' }}
          onFocus={() => {
            cancelledRef.current = false;
            skipNextBlurRef.current = false;
            setEditing(true);
            setDraft(formatNum(value));
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);

            const nativeEv = e.nativeEvent as Partial<InputEvent>;
            const isTyping =
              typeof nativeEv.inputType === 'string' &&
              (nativeEv.inputType.startsWith('insert') ||
                nativeEv.inputType.startsWith('delete') ||
                nativeEv.inputType === 'historyUndo' ||
                nativeEv.inputType === 'historyRedo');

            if (!isTyping && raw.trim() !== '') {
              const parsed = Number(raw.replace(',', '.'));
              if (Number.isFinite(parsed)) {
                const clamped = Number(clampNumber(parsed, min, max).toFixed(2));
                if (clamped !== value) {
                  onCommit(clamped);
                }
              }
            }
          }}
          onBlur={() => {
            setEditing(false);
            if (cancelledRef.current || skipNextBlurRef.current) {
              cancelledRef.current = false;
              skipNextBlurRef.current = false;
              return;
            }
            commitDraft();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              skipNextBlurRef.current = true;
              commitDraft();
              setEditing(false);
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cancelledRef.current = true;
              setDraft(formatNum(value));
              setEditing(false);
              e.currentTarget.blur();
            }
          }}
        />
        <span className="unit-label">{unit}</span>
      </div>
    </div>
  );
}

interface StampInspectorFieldsProps {
  store: EditorStore;
  stamp: StampObject;
  disabled: boolean;
}

function StampInspectorFields({ store, stamp, disabled }: StampInspectorFieldsProps) {
  const [keepRatio, setKeepRatio] = useState(true);
  const maxDim = Math.max(4000, store.getDocument().manifest.space.width * 2);

  const commitStampPatch = (patch: Partial<StampObject>, label: string) => {
    if (disabled) return;
    const next: StampObject = { ...stamp, ...patch };
    commitObjectUpdate(store, stamp, next, label);
  };

  const handleWidthCommit = (nextW: number) => {
    if (keepRatio && stamp.width > 0) {
      const ratio = stamp.height / stamp.width;
      const nextH = Math.max(4, Number((nextW * ratio).toFixed(2)));
      commitStampPatch({ width: nextW, height: nextH }, 'Ridimensiona simbolo');
    } else {
      commitStampPatch({ width: nextW }, 'Ridimensiona simbolo');
    }
  };

  const handleHeightCommit = (nextH: number) => {
    if (keepRatio && stamp.height > 0) {
      const ratio = stamp.width / stamp.height;
      const nextW = Math.max(4, Number((nextH * ratio).toFixed(2)));
      commitStampPatch({ width: nextW, height: nextH }, 'Ridimensiona simbolo');
    } else {
      commitStampPatch({ height: nextH }, 'Ridimensiona simbolo');
    }
  };

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--ui-space-2)'
        }}
      >
        <CommittedNumberField
          label="X"
          value={stamp.x}
          min={-maxDim}
          max={maxDim}
          step={10}
          unit="u"
          compact
          disabled={disabled}
          onCommit={(x) => commitStampPatch({ x }, 'Sposta simbolo')}
        />
        <CommittedNumberField
          label="Y"
          value={stamp.y}
          min={-maxDim}
          max={maxDim}
          step={10}
          unit="u"
          compact
          disabled={disabled}
          onCommit={(y) => commitStampPatch({ y }, 'Sposta simbolo')}
        />
      </div>

      <CommittedNumberField
        label="Larghezza"
        value={stamp.width}
        min={4}
        max={maxDim}
        step={4}
        unit="u"
        disabled={disabled}
        onCommit={handleWidthCommit}
      />

      <CommittedNumberField
        label="Altezza"
        value={stamp.height}
        min={4}
        max={maxDim}
        step={4}
        unit="u"
        disabled={disabled}
        onCommit={handleHeightCommit}
      />

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--ui-space-2)',
          minHeight: '36px',
          fontSize: '15px',
          lineHeight: '22px',
          color: 'var(--ui-text)',
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      >
        <input
          type="checkbox"
          checked={keepRatio}
          disabled={disabled}
          onChange={(e) => setKeepRatio(e.target.checked)}
          style={{ width: '16px', height: '16px', accentColor: 'var(--ui-accent)' }}
        />
        <span>Mantieni proporzioni</span>
      </label>

      <CommittedNumberField
        label="Rotazione"
        value={stamp.rotationDeg}
        min={-360}
        max={360}
        step={5}
        unit="°"
        disabled={disabled}
        onCommit={(deg) =>
          commitStampPatch({ rotationDeg: normalizeRotationDeg(deg) }, 'Ruota simbolo')
        }
      />
    </>
  );
}

interface LabelInspectorFieldsProps {
  store: EditorStore;
  labelObj: LabelObject;
  disabled: boolean;
}

function LabelInspectorFields({ store, labelObj, disabled }: LabelInspectorFieldsProps) {
  const textId = useId();
  const hexId = useId();

  const [textEditing, setTextEditing] = useState(false);
  const [textDraft, setTextDraft] = useState(labelObj.text);
  const textCancelledRef = useRef(false);
  const textSkipBlurRef = useRef(false);

  const [hexEditing, setHexEditing] = useState(false);
  const [hexDraft, setHexDraft] = useState(labelObj.color.toUpperCase());
  const hexCancelledRef = useRef(false);
  const hexSkipBlurRef = useRef(false);

  useEffect(() => {
    if (!textEditing) {
      setTextDraft(labelObj.text);
    }
  }, [labelObj.id, labelObj.text, textEditing]);

  useEffect(() => {
    if (!hexEditing) {
      setHexDraft(labelObj.color.toUpperCase());
    }
  }, [labelObj.id, labelObj.color, hexEditing]);

  const commitLabelPatch = (patch: Partial<LabelObject>, actionLabel: string) => {
    if (disabled) return;
    const next: LabelObject = { ...labelObj, ...patch };
    commitObjectUpdate(store, labelObj, next, actionLabel);
  };

  const commitTextDraft = () => {
    const trimmed = textDraft.trim();
    if (trimmed.length === 0) {
      setTextDraft(labelObj.text);
      return;
    }
    if (trimmed !== labelObj.text) {
      commitLabelPatch({ text: trimmed }, 'Rinomina etichetta');
    }
    setTextDraft(trimmed);
  };

  const commitHexDraft = () => {
    const clean = hexDraft.trim();
    const normalized = clean.startsWith('#') ? clean : `#${clean}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
      const upper = normalized.toUpperCase();
      setHexDraft(upper);
      if (upper !== labelObj.color.toUpperCase()) {
        commitLabelPatch({ color: upper }, 'Cambia colore etichetta');
      }
    } else {
      setHexDraft(labelObj.color.toUpperCase());
    }
  };

  return (
    <>
      <div className="form-field">
        <label htmlFor={textId} className="field-label">
          Testo
        </label>
        <input
          id={textId}
          type="text"
          className="text-input"
          disabled={disabled}
          value={textEditing ? textDraft : labelObj.text}
          onFocus={() => {
            textCancelledRef.current = false;
            textSkipBlurRef.current = false;
            setTextEditing(true);
            setTextDraft(labelObj.text);
          }}
          onChange={(e) => setTextDraft(e.target.value)}
          onBlur={() => {
            setTextEditing(false);
            if (textCancelledRef.current || textSkipBlurRef.current) {
              textCancelledRef.current = false;
              textSkipBlurRef.current = false;
              return;
            }
            commitTextDraft();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              textSkipBlurRef.current = true;
              commitTextDraft();
              setTextEditing(false);
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              textCancelledRef.current = true;
              setTextDraft(labelObj.text);
              setTextEditing(false);
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      <div className="form-field">
        <span className="field-label">Stile rapido</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-1)' }}>
          {LABEL_ROLE_PRESETS.map((preset) => {
            const isActive =
              labelObj.fontId === preset.fontId &&
              Math.abs(labelObj.fontSize - preset.fontSizeDoc) < 0.5;
            return (
              <button
                key={preset.id}
                type="button"
                className="segmented-btn"
                disabled={disabled}
                aria-pressed={isActive}
                onClick={() =>
                  commitLabelPatch(
                    { fontId: preset.fontId, fontSize: preset.fontSizeDoc },
                    `Applica stile ${preset.label}`
                  )
                }
                style={{
                  textAlign: 'left',
                  fontSize: '13px',
                  lineHeight: '18px',
                  padding: '0 var(--ui-space-2)'
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <CommittedNumberField
        label="Dimensione"
        value={labelObj.fontSize}
        min={8}
        max={400}
        step={1}
        unit="u"
        disabled={disabled}
        onCommit={(fontSize) => commitLabelPatch({ fontSize }, 'Ridimensiona etichetta')}
      />

      <div className="form-field">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--ui-space-2)'
          }}
        >
          <label htmlFor={hexId} className="field-label">
            Colore
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ui-space-1)' }}>
            {LABEL_COLOR_SWATCHES.map((swatch) => {
              const isSelected = labelObj.color.toUpperCase() === swatch.hex.toUpperCase();
              return (
                <button
                  key={swatch.hex}
                  type="button"
                  className="has-tooltip-top"
                  disabled={disabled}
                  aria-label={`Colore ${swatch.name} (${swatch.hex})`}
                  aria-pressed={isSelected}
                  data-tooltip={`${swatch.name} (${swatch.hex})`}
                  onClick={() =>
                    commitLabelPatch({ color: swatch.hex }, 'Cambia colore etichetta')
                  }
                  style={{
                    width: '36px',
                    height: '36px',
                    minWidth: '36px',
                    minHeight: '36px',
                    padding: 0,
                    borderRadius: 'var(--ui-radius-control)',
                    backgroundColor: swatch.hex,
                    border: isSelected
                      ? '2px solid var(--ui-accent)'
                      : '1px solid var(--ui-line)',
                    boxShadow: isSelected ? '0 0 0 1px var(--ui-bench)' : 'none',
                    cursor: disabled ? 'not-allowed' : 'pointer'
                  }}
                />
              );
            })}
          </div>
        </div>

        <input
          id={hexId}
          type="text"
          className="text-input tabular-nums"
          aria-label="Colore esadecimale"
          placeholder="#263C40"
          disabled={disabled}
          value={hexEditing ? hexDraft : labelObj.color.toUpperCase()}
          onFocus={() => {
            hexCancelledRef.current = false;
            hexSkipBlurRef.current = false;
            setHexEditing(true);
            setHexDraft(labelObj.color.toUpperCase());
          }}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={() => {
            setHexEditing(false);
            if (hexCancelledRef.current || hexSkipBlurRef.current) {
              hexCancelledRef.current = false;
              hexSkipBlurRef.current = false;
              return;
            }
            commitHexDraft();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              hexSkipBlurRef.current = true;
              commitHexDraft();
              setHexEditing(false);
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              hexCancelledRef.current = true;
              setHexDraft(labelObj.color.toUpperCase());
              setHexEditing(false);
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      <CommittedNumberField
        label="Rotazione"
        value={labelObj.rotationDeg}
        min={-360}
        max={360}
        step={5}
        unit="°"
        disabled={disabled}
        onCommit={(deg) =>
          commitLabelPatch({ rotationDeg: normalizeRotationDeg(deg) }, 'Ruota etichetta')
        }
      />
    </>
  );
}

interface PathInspectorFieldsProps {
  store: EditorStore;
  pathObj: PathObject;
  disabled: boolean;
}

function PathInspectorFields({ store, pathObj, disabled }: PathInspectorFieldsProps) {
  const theme = store.getDocument().theme;

  const commitPathPatch = (patch: Partial<PathObject>, actionLabel: string) => {
    if (disabled) return;
    const next: PathObject = { ...pathObj, ...patch };
    commitObjectUpdate(store, pathObj, next, actionLabel);
  };

  const opacityPercent = Math.round(clampNumber(pathObj.opacity ?? 1, 0, 1) * 100);

  return (
    <>
      <div className="form-field">
        <div className="slider-header">
          <span className="field-label">Stile</span>
          <span
            style={{
              fontSize: '13px',
              lineHeight: '18px',
              color: 'var(--ui-muted)'
            }}
          >
            {getPathKindLabel(pathObj.kind)}
          </span>
        </div>
        <div className="segmented-group" role="group" aria-label="Stile tracciato">
          {PATH_KIND_OPTIONS.map((opt) => {
            const isActive = pathObj.kind === opt.kind;
            return (
              <button
                key={opt.kind}
                type="button"
                className="segmented-btn"
                disabled={disabled}
                aria-pressed={isActive}
                onClick={() =>
                  commitPathPatch({ kind: opt.kind }, `Cambia stile in ${opt.label}`)
                }
                style={{
                  minHeight: '36px',
                  padding: '4px 8px',
                  fontSize: '13px',
                  lineHeight: '18px',
                  color: isActive ? 'var(--ui-accent)' : 'var(--ui-text)'
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <SyncedRangeField
        label="Spessore"
        value={pathObj.strokeWidthDoc}
        min={2}
        max={60}
        step={0.5}
        unit="u"
        disabled={disabled}
        deferDragCommit={true}
        onChange={(strokeWidthDoc) =>
          commitPathPatch({ strokeWidthDoc }, 'Modifica spessore tracciato')
        }
      />

      <PathColorControls
        theme={theme}
        color={pathObj.color}
        disabled={disabled}
        onChangeColor={(color) => commitPathPatch({ color }, 'Cambia colore tracciato')}
      />

      <SyncedRangeField
        label="Opacità"
        value={opacityPercent}
        min={0}
        max={100}
        step={1}
        unit="%"
        disabled={disabled}
        deferDragCommit={true}
        onChange={(pct) =>
          commitPathPatch(
            { opacity: Number(clampNumber(pct / 100, 0, 1).toFixed(2)) },
            'Modifica opacità tracciato'
          )
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-1)' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--ui-space-2)',
            minHeight: '36px',
            fontSize: '15px',
            lineHeight: '22px',
            color: 'var(--ui-text)',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={pathObj.smooth !== false}
            disabled={disabled}
            onChange={(e) =>
              commitPathPatch({ smooth: e.target.checked }, 'Modifica curvatura tracciato')
            }
            style={{ width: '16px', height: '16px', accentColor: 'var(--ui-accent)' }}
          />
          <span>Curva morbida</span>
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--ui-space-2)',
            minHeight: '36px',
            fontSize: '15px',
            lineHeight: '22px',
            color: 'var(--ui-text)',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={Boolean(pathObj.tapered)}
            disabled={disabled}
            onChange={(e) =>
              commitPathPatch({ tapered: e.target.checked }, 'Modifica affusolatura tracciato')
            }
            style={{ width: '16px', height: '16px', accentColor: 'var(--ui-accent)' }}
          />
          <span>Affusolato</span>
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--ui-space-2)',
            minHeight: '36px',
            fontSize: '15px',
            lineHeight: '22px',
            color: 'var(--ui-text)',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={Boolean(pathObj.dashed)}
            disabled={disabled}
            onChange={(e) =>
              commitPathPatch({ dashed: e.target.checked }, 'Modifica tratteggio tracciato')
            }
            style={{ width: '16px', height: '16px', accentColor: 'var(--ui-accent)' }}
          />
          <span>Tratteggiato</span>
        </label>
      </div>

      <CommittedNumberField
        label="Rotazione"
        value={pathObj.rotationDeg}
        min={-360}
        max={360}
        step={5}
        unit="°"
        disabled={disabled}
        onCommit={(deg) =>
          commitPathPatch({ rotationDeg: normalizeRotationDeg(deg) }, 'Ruota tracciato')
        }
      />
    </>
  );
}

/**
 * Property inspector for the currently selected StampObject, LabelObject, or PathObject.
 * Includes layer reassignment via `<select>` and atomic edits via `UpdateObjectCommand` /
 * `ReorderObjectsCommand` / `DeleteObjectCommand`.
 */
export function ObjectInspector({ store }: ObjectInspectorProps) {
  const snap = useEditorStore(store);
  const layerSelectId = useId();
  const objects = snap.doc.manifest.objects;
  const layers = snap.doc.manifest.layers;
  const selectedId = snap.selectedObjectId;
  const docIndex = selectedId ? objects.findIndex((o) => o.id === selectedId) : -1;
  const selectedObject: MapObject | null = docIndex >= 0 ? objects[docIndex] : null;

  if (!selectedObject) {
    if (snap.activeTool === 'select') {
      return (
        <p className="panel-empty-hint">
          Fai clic su un simbolo, un tracciato o un’etichetta della mappa, oppure scegli un elemento nell’elenco Oggetti.
        </p>
      );
    }
    return null;
  }

  const displayName = getDefaultObjectLabel(selectedObject);
  const nonTerrainLayers = layers.filter((l) => l.kind !== 'terrain');
  const currentLayerId = resolveObjectLayerId(selectedObject, layers);
  const currentLayer = layers.find((l) => l.id === currentLayerId);
  const layerEditable = currentLayer ? currentLayer.visible && !currentLayer.locked : true;

  const canMoveForward = layerEditable && docIndex < objects.length - 1;
  const canMoveBackward = layerEditable && docIndex > 0;

  const headingText =
    selectedObject.type === 'stamp'
      ? displayName
      : selectedObject.type === 'label'
        ? 'Etichetta'
        : displayName;
  const subheadingText =
    selectedObject.type === 'stamp'
      ? 'Simbolo POI'
      : selectedObject.type === 'label'
        ? displayName
        : 'Tracciato vettoriale';

  return (
    <div className="panel-group">
      <div className="slider-header">
        <div style={{ minWidth: 0 }}>
          <h3
            className="panel-subheading"
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {headingText}
          </h3>
          <span className="panel-hint">{subheadingText}</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-compact"
          onClick={() => store.selectObject(null)}
        >
          Deseleziona
        </button>
      </div>

      {!layerEditable ? (
        <p
          role="status"
          style={{
            margin: 0,
            padding: 'var(--ui-space-2)',
            backgroundColor: 'rgba(23, 35, 45, 0.55)',
            border: '1px solid var(--ui-line-subtle)',
            borderRadius: 'var(--ui-radius-control)',
            fontSize: '13px',
            lineHeight: '18px',
            color: 'var(--ui-error)'
          }}
        >
          Il livello «{currentLayer?.name ?? 'Oggetti'}» è bloccato o nascosto. Sbloccalo per modificare l’oggetto.
        </p>
      ) : null}

      <div className="form-field">
        <label htmlFor={layerSelectId} className="field-label">
          Livello
        </label>
        <select
          id={layerSelectId}
          className="select-input"
          value={currentLayerId}
          disabled={!layerEditable}
          onChange={(e) => {
            const nextLayerId = e.target.value;
            if (!nextLayerId || nextLayerId === currentLayerId) return;
            const nextObj: MapObject = { ...selectedObject, layerId: nextLayerId };
            commitObjectUpdate(store, selectedObject, nextObj, 'Sposta oggetto su livello');
          }}
        >
          {nonTerrainLayers.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name}
            </option>
          ))}
        </select>
      </div>

      {selectedObject.type === 'stamp' ? (
        <StampInspectorFields store={store} stamp={selectedObject} disabled={!layerEditable} />
      ) : selectedObject.type === 'label' ? (
        <LabelInspectorFields store={store} labelObj={selectedObject} disabled={!layerEditable} />
      ) : (
        <PathInspectorFields store={store} pathObj={selectedObject} disabled={!layerEditable} />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--ui-space-2)',
          paddingTop: 'var(--ui-space-2)',
          borderTop: '1px solid var(--ui-line-subtle)'
        }}
      >
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          disabled={!canMoveForward}
          onClick={() =>
            commitObjectReorder(store, selectedObject.id, docIndex + 1, 'Porta avanti')
          }
        >
          Porta avanti
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          disabled={!canMoveBackward}
          onClick={() =>
            commitObjectReorder(store, selectedObject.id, docIndex - 1, 'Porta indietro')
          }
        >
          Porta indietro
        </button>
      </div>

      <button
        type="button"
        className="btn btn-secondary btn-compact"
        disabled={!layerEditable}
        onClick={() =>
          store.executeCommand(
            new DeleteObjectCommand(
              selectedObject.id,
              getDeleteObjectLabel(selectedObject)
            )
          )
        }
        style={{
          color: 'var(--ui-error)',
          borderColor: 'rgba(255, 179, 166, 0.45)'
        }}
      >
        Elimina
      </button>
    </div>
  );
}
