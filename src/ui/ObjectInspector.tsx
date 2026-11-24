import { useEffect, useId, useRef, useState } from 'react';
import { getCityThemePalette } from '../city/geometry';
import { clampNumber } from '../model/coordinates';
import {
  BuildingObject,
  BuildingRenderStyle,
  BuildingShape,
  LabelObject,
  MapObject,
  PathObject,
  PlazaCenterpiece,
  PlazaObject,
  PlazaShape,
  StampObject,
  WallStyle,
  resolveObjectLayerId
} from '../model/document';
import {
  CITY_PATH_KIND_OPTIONS,
  DeleteObjectCommand,
  PATH_KIND_OPTIONS,
  commitObjectReorderInLayer,
  commitObjectUpdate,
  getDefaultObjectLabel,
  getDeleteObjectLabel,
  getPathKindDefaults,
  getPathKindLabel,
  getSameLayerAdjacentIndices,
  normalizeRotationDeg
} from '../objects/objectCommands';
import {
  PathColorControls,
  SyncedRangeField,
  normalizeColorHex
} from '../objects/uiControls';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { LABEL_ROLE_PRESETS } from '../theme/theme';

export interface ObjectInspectorProps {
  store: EditorStore;
  onAddLabelForStamp?: (stamp: StampObject) => void;
}

const LABEL_COLOR_SWATCHES = [
  { hex: '#263C40', name: 'Inchiostro' },
  { hex: '#17232D', name: 'Scuro' },
  { hex: '#F3EEDF', name: 'Pergamena' },
  { hex: '#8B493D', name: 'Terracotta' }
] as const;

const WALL_STYLE_OPTIONS: ReadonlyArray<{ id: WallStyle; label: string }> = [
  { id: 'stone', label: 'Pietra' },
  { id: 'palisade', label: 'Palizzata' },
  { id: 'bastion', label: 'Bastioni' },
  { id: 'low-wall', label: 'Muretto' }
];

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
  stacked?: boolean;
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
  stacked = false,
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

  const inputEl = (
    <input
      id={inputId}
      type="number"
      className="number-input tabular-nums"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={editing ? draft : formatNum(value)}
      style={
        stacked
          ? { width: '100%', fontVariantNumeric: 'tabular-nums' }
          : compact
            ? { width: '76px', fontVariantNumeric: 'tabular-nums' }
            : { width: '88px', fontVariantNumeric: 'tabular-nums' }
      }
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
  );

  if (stacked) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-1)' }}>
        <label
          htmlFor={inputId}
          style={{
            fontSize: '15px',
            lineHeight: '20px',
            fontWeight: 600,
            color: 'var(--ui-text)'
          }}
        >
          {label}{' '}
          <span
            style={{
              fontSize: '13px',
              lineHeight: '18px',
              fontWeight: 400,
              color: 'var(--ui-muted)'
            }}
          >
            ({unit})
          </span>
        </label>
        {inputEl}
      </div>
    );
  }

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
        {inputEl}
        <span className="unit-label">{unit}</span>
      </div>
    </div>
  );
}

interface StampInspectorFieldsProps {
  store: EditorStore;
  stamp: StampObject;
  disabled: boolean;
  onAddLabelForStamp?: (stamp: StampObject) => void;
}

function StampInspectorFields({
  store,
  stamp,
  disabled,
  onAddLabelForStamp
}: StampInspectorFieldsProps) {
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
          stacked
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
          stacked
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

      {onAddLabelForStamp ? (
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          disabled={disabled}
          onClick={() => onAddLabelForStamp(stamp)}
        >
          Aggiungi etichetta
        </button>
      ) : null}
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

const BUILDING_SHAPE_INSPECTOR_OPTIONS: ReadonlyArray<{ id: BuildingShape; label: string }> = [
  { id: 'rect', label: 'Casa' },
  { id: 'l-shape', label: 'Palazzo a L' },
  { id: 'courtyard', label: 'Cortile' },
  { id: 'tower', label: 'Torre' },
  { id: 'cathedral', label: 'Cattedrale' },
  { id: 'market', label: 'Mercato' }
];

const BUILDING_RENDER_OPTIONS: ReadonlyArray<{
  id: 'auto' | BuildingRenderStyle;
  label: string;
}> = [
  { id: 'auto', label: 'Stile carta' },
  { id: 'roof-25d', label: 'Tetti 2.5D' },
  { id: 'ink-plan', label: 'Planimetria' }
];

const PLAZA_SHAPE_INSPECTOR_OPTIONS: ReadonlyArray<{ id: PlazaShape; label: string }> = [
  { id: 'rect', label: 'Rettangolare' },
  { id: 'circle', label: 'Circolare' },
  { id: 'octagon', label: 'Ottagonale' }
];

const PLAZA_CENTERPIECE_INSPECTOR_OPTIONS: ReadonlyArray<{
  id: PlazaCenterpiece;
  label: string;
}> = [
  { id: 'none', label: 'Libera' },
  { id: 'fountain', label: 'Fontana' },
  { id: 'obelisk', label: 'Obelisco' },
  { id: 'market-stalls', label: 'Bancarelle' },
  { id: 'tree', label: 'Albero' }
];

interface BuildingInspectorFieldsProps {
  store: EditorStore;
  building: BuildingObject;
  disabled: boolean;
}

function BuildingInspectorFields({
  store,
  building,
  disabled
}: BuildingInspectorFieldsProps) {
  const doc = store.getDocument();
  const palette = getCityThemePalette(doc.theme);
  const maxDim = Math.max(4000, doc.manifest.space.width * 2);
  const colorInputId = useId();
  const normalizedRoof = normalizeColorHex(
    building.roofColor,
    palette.roofPalette[0] ?? '#9E4638'
  );

  const commitBuildingPatch = (patch: Partial<BuildingObject>, actionLabel: string) => {
    if (disabled) return;
    const next: BuildingObject = { ...building, ...patch };
    commitObjectUpdate(store, building, next, actionLabel);
  };

  return (
    <>
      <div className="form-field">
        <span className="field-label">Pianta edificio</span>
        <div className="city-shape-grid" role="group" aria-label="Pianta edificio">
          {BUILDING_SHAPE_INSPECTOR_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="segmented-btn"
              disabled={disabled}
              aria-pressed={building.shape === opt.id}
              onClick={() =>
                commitBuildingPatch({ shape: opt.id }, `Cambia pianta in ${opt.label}`)
              }
              style={{ fontSize: '13px', lineHeight: '18px' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--ui-space-2)'
        }}
      >
        <CommittedNumberField
          label="X"
          value={building.x}
          min={-maxDim}
          max={maxDim}
          step={10}
          unit="u"
          stacked
          disabled={disabled}
          onCommit={(x) => commitBuildingPatch({ x }, 'Sposta edificio')}
        />
        <CommittedNumberField
          label="Y"
          value={building.y}
          min={-maxDim}
          max={maxDim}
          step={10}
          unit="u"
          stacked
          disabled={disabled}
          onCommit={(y) => commitBuildingPatch({ y }, 'Sposta edificio')}
        />
      </div>

      <CommittedNumberField
        label="Larghezza"
        value={building.width}
        min={8}
        max={maxDim}
        step={2}
        unit="u"
        disabled={disabled}
        onCommit={(width) => commitBuildingPatch({ width }, 'Ridimensiona edificio')}
      />

      <CommittedNumberField
        label="Profondità"
        value={building.height}
        min={8}
        max={maxDim}
        step={2}
        unit="u"
        disabled={disabled}
        onCommit={(height) => commitBuildingPatch({ height }, 'Ridimensiona edificio')}
      />

      <CommittedNumberField
        label="Rotazione"
        value={building.rotationDeg}
        min={-360}
        max={360}
        step={5}
        unit="°"
        disabled={disabled}
        onCommit={(deg) =>
          commitBuildingPatch({ rotationDeg: normalizeRotationDeg(deg) }, 'Ruota edificio')
        }
      />

      <div className="form-field">
        <div className="slider-header">
          <label htmlFor={colorInputId} className="field-label">
            Colore tetto
          </label>
          <input
            id={colorInputId}
            type="color"
            disabled={disabled}
            value={normalizedRoof}
            onChange={(e) =>
              commitBuildingPatch(
                { roofColor: normalizeColorHex(e.target.value) },
                'Cambia colore tetto'
              )
            }
            style={{
              width: '36px',
              height: '32px',
              padding: '2px',
              backgroundColor: 'var(--ui-raised)',
              border: '1px solid var(--ui-line)',
              borderRadius: 'var(--ui-radius-control)',
              cursor: disabled ? 'not-allowed' : 'pointer'
            }}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {palette.roofPalette.map((hex) => {
            const isSel = normalizedRoof === normalizeColorHex(hex);
            return (
              <button
                key={hex}
                type="button"
                disabled={disabled}
                aria-label={`Colore ${hex}`}
                aria-pressed={isSel}
                onClick={() =>
                  commitBuildingPatch({ roofColor: hex }, 'Cambia colore tetto')
                }
                style={{
                  width: '32px',
                  height: '32px',
                  minWidth: '32px',
                  minHeight: '32px',
                  padding: 0,
                  backgroundColor: hex,
                  border: isSel ? '2px solid var(--ui-accent)' : '1px solid var(--ui-line)',
                  borderRadius: 'var(--ui-radius-control)',
                  cursor: disabled ? 'not-allowed' : 'pointer'
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="form-field">
        <span className="field-label">Resa grafica</span>
        <div
          className="segmented-group"
          style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
          role="group"
          aria-label="Resa grafica edificio"
        >
          {BUILDING_RENDER_OPTIONS.map((opt) => {
            const activeStyle = building.renderStyle ?? 'auto';
            return (
              <button
                key={opt.id}
                type="button"
                className="segmented-btn"
                disabled={disabled}
                aria-pressed={activeStyle === opt.id}
                onClick={() =>
                  commitBuildingPatch(
                    { renderStyle: opt.id === 'auto' ? undefined : opt.id },
                    `Cambia resa in ${opt.label}`
                  )
                }
                style={{ fontSize: '13px', lineHeight: '18px', padding: '0 4px' }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

interface PlazaInspectorFieldsProps {
  store: EditorStore;
  plaza: PlazaObject;
  disabled: boolean;
}

function PlazaInspectorFields({ store, plaza, disabled }: PlazaInspectorFieldsProps) {
  const doc = store.getDocument();
  const maxDim = Math.max(4000, doc.manifest.space.width * 2);
  const fillInputId = useId();
  const normalizedFill = normalizeColorHex(plaza.fillColor, '#DDD1B8');

  const commitPlazaPatch = (patch: Partial<PlazaObject>, actionLabel: string) => {
    if (disabled) return;
    const next: PlazaObject = { ...plaza, ...patch };
    commitObjectUpdate(store, plaza, next, actionLabel);
  };

  return (
    <>
      <div className="form-field">
        <span className="field-label">Forma piazza</span>
        <div
          className="segmented-group"
          style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
          role="group"
          aria-label="Forma della piazza"
        >
          {PLAZA_SHAPE_INSPECTOR_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="segmented-btn"
              disabled={disabled}
              aria-pressed={plaza.shape === opt.id}
              onClick={() =>
                commitPlazaPatch({ shape: opt.id }, `Cambia forma in ${opt.label}`)
              }
              style={{ fontSize: '13px', lineHeight: '18px', padding: '0 4px' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--ui-space-2)'
        }}
      >
        <CommittedNumberField
          label="X"
          value={plaza.x}
          min={-maxDim}
          max={maxDim}
          step={10}
          unit="u"
          stacked
          disabled={disabled}
          onCommit={(x) => commitPlazaPatch({ x }, 'Sposta piazza')}
        />
        <CommittedNumberField
          label="Y"
          value={plaza.y}
          min={-maxDim}
          max={maxDim}
          step={10}
          unit="u"
          stacked
          disabled={disabled}
          onCommit={(y) => commitPlazaPatch({ y }, 'Sposta piazza')}
        />
      </div>

      <CommittedNumberField
        label="Larghezza"
        value={plaza.width}
        min={20}
        max={maxDim}
        step={4}
        unit="u"
        disabled={disabled}
        onCommit={(width) => commitPlazaPatch({ width }, 'Ridimensiona piazza')}
      />

      <CommittedNumberField
        label="Altezza"
        value={plaza.height}
        min={20}
        max={maxDim}
        step={4}
        unit="u"
        disabled={disabled}
        onCommit={(height) => commitPlazaPatch({ height }, 'Ridimensiona piazza')}
      />

      <CommittedNumberField
        label="Rotazione"
        value={plaza.rotationDeg}
        min={-360}
        max={360}
        step={5}
        unit="°"
        disabled={disabled}
        onCommit={(deg) =>
          commitPlazaPatch({ rotationDeg: normalizeRotationDeg(deg) }, 'Ruota piazza')
        }
      />

      <div className="form-field">
        <span className="field-label">Elemento centrale</span>
        <div className="city-preset-list" role="group" aria-label="Elemento centrale piazza">
          {PLAZA_CENTERPIECE_INSPECTOR_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="segmented-btn city-preset-btn"
              disabled={disabled}
              aria-pressed={plaza.centerpiece === opt.id}
              onClick={() =>
                commitPlazaPatch({ centerpiece: opt.id }, `Imposta ${opt.label}`)
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-field">
        <div className="slider-header">
          <label htmlFor={fillInputId} className="field-label">
            Pavimentazione
          </label>
          <input
            id={fillInputId}
            type="color"
            disabled={disabled}
            value={normalizedFill}
            onChange={(e) =>
              commitPlazaPatch(
                { fillColor: normalizeColorHex(e.target.value) },
                'Cambia colore piazza'
              )
            }
            style={{
              width: '36px',
              height: '32px',
              padding: '2px',
              backgroundColor: 'var(--ui-raised)',
              border: '1px solid var(--ui-line)',
              borderRadius: 'var(--ui-radius-control)',
              cursor: disabled ? 'not-allowed' : 'pointer'
            }}
          />
        </div>
      </div>
    </>
  );
}

interface PathInspectorFieldsProps {
  store: EditorStore;
  pathObj: PathObject;
  disabled: boolean;
}

function PathInspectorFields({ store, pathObj, disabled }: PathInspectorFieldsProps) {
  const doc = store.getDocument();
  const theme = doc.theme;
  const isUrbanPath =
    doc.manifest.kind === 'city' ||
    pathObj.kind === 'avenue' ||
    pathObj.kind === 'alley' ||
    pathObj.kind === 'canal' ||
    pathObj.kind === 'wall';
  const kindOptions = isUrbanPath ? CITY_PATH_KIND_OPTIONS : PATH_KIND_OPTIONS;

  const commitPathPatch = (patch: Partial<PathObject>, actionLabel: string) => {
    if (disabled) return;
    const next: PathObject = { ...pathObj, ...patch };
    commitObjectUpdate(store, pathObj, next, actionLabel);
  };

  const opacityPercent = Math.round(clampNumber(pathObj.opacity ?? 1, 0, 1) * 100);
  const currentWallStyle: WallStyle = pathObj.wallStyle ?? 'stone';
  const palette = getCityThemePalette(theme);
  const defaultStoneColor = getPathKindDefaults('wall', theme).color.toUpperCase();
  const defaultStonePaletteColor = palette.wallStone.toUpperCase();
  const palisadeColor = palette.renderStyle === 'ink-plan' ? '#A37952' : '#B57B48';
  const currentColorUpper = pathObj.color.toUpperCase();

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
        <div className="city-shape-grid" role="group" aria-label="Stile tracciato">
          {kindOptions.map((opt) => {
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

      {pathObj.kind === 'wall' ? (
        <div className="form-field">
          <div className="slider-header">
            <span className="field-label">Stile fortificazione</span>
            <span
              style={{
                fontSize: '13px',
                lineHeight: '18px',
                color: 'var(--ui-muted)'
              }}
            >
              {WALL_STYLE_OPTIONS.find((s) => s.id === currentWallStyle)?.label ?? 'Pietra'}
            </span>
          </div>
          <div className="city-shape-grid" role="group" aria-label="Stile fortificazione mura">
            {WALL_STYLE_OPTIONS.map((opt) => {
              const isActive = currentWallStyle === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className="segmented-btn"
                  disabled={disabled}
                  aria-pressed={isActive}
                  onClick={() => {
                    const patch: Partial<PathObject> = { wallStyle: opt.id };
                    if (
                      opt.id === 'palisade' &&
                      (currentColorUpper === defaultStoneColor ||
                        currentColorUpper === defaultStonePaletteColor)
                    ) {
                      patch.color = palisadeColor;
                    } else if (
                      opt.id !== 'palisade' &&
                      (currentColorUpper === '#B57B48' ||
                        currentColorUpper === '#A37952' ||
                        currentColorUpper === '#8A5C38' ||
                        currentColorUpper === '#5D5246')
                    ) {
                      patch.color = getPathKindDefaults('wall', theme).color;
                    }
                    commitPathPatch(patch, `Cambia fortificazione in ${opt.label}`);
                  }}
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
          <button
            type="button"
            className="segmented-btn"
            disabled={disabled}
            onClick={() =>
              commitPathPatch(
                { wallSide: (pathObj.wallSide ?? 1) === 1 ? -1 : 1 },
                'Inverti lato esterno mura'
              )
            }
            style={{
              marginTop: 'var(--ui-space-1)',
              minHeight: '36px',
              padding: '4px 10px',
              fontSize: '13px',
              lineHeight: '18px',
              color: 'var(--ui-text)'
            }}
          >
            Inverti lato esterno
          </button>
        </div>
      ) : null}

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
            onChange={(e) => {
              const nextTapered = e.target.checked;
              commitPathPatch(
                {
                  tapered: nextTapered,
                  ...(nextTapered && pathObj.dashed ? { dashed: false } : {})
                },
                'Modifica affusolatura tracciato'
              );
            }}
            style={{ width: '16px', height: '16px', accentColor: 'var(--ui-accent)' }}
          />
          <span>Affusolato</span>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--ui-space-2)',
              minHeight: '36px',
              fontSize: '15px',
              lineHeight: '22px',
              color: pathObj.tapered ? 'var(--ui-muted)' : 'var(--ui-text)',
              opacity: pathObj.tapered ? 0.65 : 1,
              cursor: disabled || pathObj.tapered ? 'not-allowed' : 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={Boolean(pathObj.dashed) && !pathObj.tapered}
              disabled={disabled || Boolean(pathObj.tapered)}
              onChange={(e) =>
                commitPathPatch({ dashed: e.target.checked }, 'Modifica tratteggio tracciato')
              }
              style={{ width: '16px', height: '16px', accentColor: 'var(--ui-accent)' }}
            />
            <span>Tratteggiato</span>
          </label>
          {pathObj.tapered ? (
            <span
              style={{
                paddingLeft: '24px',
                fontSize: '13px',
                lineHeight: '18px',
                color: 'var(--ui-muted)'
              }}
            >
              Non disponibile con tratto affusolato
            </span>
          ) : null}
        </div>
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
export function ObjectInspector({ store, onAddLabelForStamp }: ObjectInspectorProps) {
  const snap = useEditorStore(store);
  const layerSelectId = useId();
  const objects = snap.doc.manifest.objects;
  const layers = snap.doc.manifest.layers;
  const selectedId = snap.selectedObjectId;
  const adjacent = selectedId
    ? getSameLayerAdjacentIndices(objects, layers, selectedId)
    : null;
  const docIndex = adjacent ? adjacent.docIndex : -1;
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

  const canMoveForward = layerEditable && adjacent?.nextSameLayerIndex !== null;
  const canMoveBackward = layerEditable && adjacent?.prevSameLayerIndex !== null;

  const headingText =
    selectedObject.type === 'label' ? 'Etichetta' : displayName;
  const subheadingText =
    selectedObject.type === 'stamp'
      ? 'Simbolo POI'
      : selectedObject.type === 'label'
        ? displayName
        : selectedObject.type === 'building'
          ? 'Edificio architettonico'
          : selectedObject.type === 'plaza'
            ? 'Piazza cittadina'
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
            if (!store.isLayerEditable(nextLayerId)) return;
            const nextObj: MapObject = { ...selectedObject, layerId: nextLayerId };
            commitObjectUpdate(store, selectedObject, nextObj, 'Sposta oggetto su livello');
          }}
        >
          {nonTerrainLayers.map((layer) => {
            const targetEditable = layer.visible && !layer.locked;
            const isCurrent = layer.id === currentLayerId;
            const statusSuffix = !layer.visible && layer.locked
              ? ' (nascosto, bloccato)'
              : !layer.visible
                ? ' (nascosto)'
                : layer.locked
                  ? ' (bloccato)'
                  : '';
            return (
              <option
                key={layer.id}
                value={layer.id}
                disabled={!isCurrent && !targetEditable}
              >
                {layer.name}
                {statusSuffix}
              </option>
            );
          })}
        </select>
      </div>

      {selectedObject.type === 'stamp' ? (
        <StampInspectorFields
          store={store}
          stamp={selectedObject}
          disabled={!layerEditable}
          onAddLabelForStamp={onAddLabelForStamp}
        />
      ) : selectedObject.type === 'label' ? (
        <LabelInspectorFields store={store} labelObj={selectedObject} disabled={!layerEditable} />
      ) : selectedObject.type === 'building' ? (
        <BuildingInspectorFields
          store={store}
          building={selectedObject}
          disabled={!layerEditable}
        />
      ) : selectedObject.type === 'plaza' ? (
        <PlazaInspectorFields store={store} plaza={selectedObject} disabled={!layerEditable} />
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
            commitObjectReorderInLayer(store, selectedObject.id, 'forward')
          }
        >
          Porta avanti
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          disabled={!canMoveBackward}
          onClick={() =>
            commitObjectReorderInLayer(store, selectedObject.id, 'backward')
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
