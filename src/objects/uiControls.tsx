import { useEffect, useId, useRef, useState } from 'react';
import { clampNumber } from '../model/coordinates';
import { MapTheme } from '../theme/theme';

export function formatTabularNum(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function normalizeColorHex(color: string, fallback = '#263C40'): string {
  const trimmed = color.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const shortMatch = /^#([0-9A-Fa-f]{3})$/.exec(trimmed);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback.toUpperCase();
}

export interface SyncedRangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  disabled?: boolean;
  /**
   * When true, dragging the range slider keeps a local draft until pointer release
   * so undo history receives a single atomic command per drag gesture.
   */
  deferDragCommit?: boolean;
  onChange: (nextValue: number) => void;
}

/**
 * Synchronized range slider and tabular-nums numeric input adhering to the 36 px
 * control baseline and `DESIGN-EDITOR-MAPPE.md` typography tokens.
 */
export function SyncedRangeField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
  deferDragCommit = false,
  onChange
}: SyncedRangeFieldProps) {
  const rangeId = useId();
  const numId = useId();
  const [numEditing, setNumEditing] = useState(false);
  const [numDraft, setNumDraft] = useState(() => formatTabularNum(value));
  const [dragDraft, setDragDraft] = useState<number | null>(null);
  const draggingRangeRef = useRef(false);
  const dragInitialValRef = useRef(value);
  const cancelledNumRef = useRef(false);
  const skipNumBlurRef = useRef(false);

  useEffect(() => {
    if (!numEditing) {
      setNumDraft(formatTabularNum(value));
    }
    if (!draggingRangeRef.current) {
      setDragDraft(null);
    }
  }, [value, numEditing]);

  const effectiveValue = dragDraft !== null ? dragDraft : value;

  const commitNumDraft = () => {
    const parsed = Number(numDraft.replace(',', '.'));
    if (numDraft.trim() !== '' && Number.isFinite(parsed)) {
      const clamped = Number(clampNumber(parsed, min, max).toFixed(2));
      setNumDraft(formatTabularNum(clamped));
      if (clamped !== value) {
        onChange(clamped);
      }
    } else {
      setNumDraft(formatTabularNum(value));
    }
  };

  const finishRangeDrag = () => {
    if (!draggingRangeRef.current) return;
    draggingRangeRef.current = false;
    if (dragDraft !== null && dragDraft !== dragInitialValRef.current) {
      onChange(dragDraft);
    }
    setDragDraft(null);
  };

  return (
    <div className="slider-field">
      <div className="slider-header">
        <label className="field-label" htmlFor={numId}>
          {label}
        </label>
        <div className="number-unit-wrap">
          <input
            id={numId}
            type="number"
            className="number-input tabular-nums"
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            value={numEditing ? numDraft : formatTabularNum(effectiveValue)}
            onFocus={() => {
              cancelledNumRef.current = false;
              skipNumBlurRef.current = false;
              setNumEditing(true);
              setNumDraft(formatTabularNum(effectiveValue));
            }}
            onChange={(e) => {
              const raw = e.target.value;
              setNumDraft(raw);
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
                    onChange(clamped);
                  }
                }
              }
            }}
            onBlur={() => {
              setNumEditing(false);
              if (cancelledNumRef.current || skipNumBlurRef.current) {
                cancelledNumRef.current = false;
                skipNumBlurRef.current = false;
                return;
              }
              commitNumDraft();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                skipNumBlurRef.current = true;
                commitNumDraft();
                setNumEditing(false);
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelledNumRef.current = true;
                setNumDraft(formatTabularNum(value));
                setNumEditing(false);
                e.currentTarget.blur();
              }
            }}
          />
          <span className="unit-label">{unit}</span>
        </div>
      </div>
      <input
        id={rangeId}
        type="range"
        className="range-input"
        aria-label={`${label} (${unit})`}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={effectiveValue}
        onPointerDown={() => {
          if (deferDragCommit && !disabled) {
            draggingRangeRef.current = true;
            dragInitialValRef.current = value;
          }
        }}
        onPointerUp={finishRangeDrag}
        onPointerCancel={finishRangeDrag}
        onBlur={finishRangeDrag}
        onChange={(e) => {
          const nextVal = Number(e.target.value);
          if (!Number.isFinite(nextVal)) return;
          if (deferDragCommit && draggingRangeRef.current) {
            setDragDraft(nextVal);
          } else {
            onChange(nextVal);
          }
        }}
      />
    </div>
  );
}

export interface ThemePathSwatch {
  key: string;
  label: string;
  hex: string;
}

export function getThemePathSwatches(theme: MapTheme): ThemePathSwatch[] {
  const c = theme.colors;
  return [
    { key: 'pathRiver', label: 'Fiume', hex: c.pathRiver },
    { key: 'pathRoad', label: 'Strada', hex: c.pathRoad },
    { key: 'pathBorder', label: 'Confine', hex: c.pathBorder },
    { key: 'ink', label: 'Inchiostro', hex: c.ink },
    { key: 'settlement', label: 'Insediamento', hex: c.settlement },
    { key: 'forest', label: 'Foresta', hex: c.forest }
  ];
}

export interface PathColorControlsProps {
  theme: MapTheme;
  color: string;
  disabled?: boolean;
  onChangeColor: (nextHex: string) => void;
}

/**
 * Theme quick-swatch row paired with a native `<input type="color">` picker
 * for vector path tools and the path object inspector.
 */
export function PathColorControls({
  theme,
  color,
  disabled = false,
  onChangeColor
}: PathColorControlsProps) {
  const colorInputId = useId();
  const swatches = getThemePathSwatches(theme);
  const normalizedColor = normalizeColorHex(color, theme.colors.pathRiver);

  return (
    <div className="form-field">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--ui-space-2)'
        }}
      >
        <label htmlFor={colorInputId} className="field-label">
          Colore
        </label>
        <span
          className="tabular-nums"
          style={{
            fontSize: '13px',
            lineHeight: '18px',
            color: 'var(--ui-muted)'
          }}
        >
          {normalizedColor}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--ui-space-1)'
        }}
      >
        {swatches.map((swatch) => {
          const swatchHex = normalizeColorHex(swatch.hex);
          const isSelected = normalizedColor === swatchHex;
          return (
            <button
              key={swatch.key}
              type="button"
              className="has-tooltip-top"
              disabled={disabled}
              aria-label={`Colore ${swatch.label} (${swatchHex})`}
              aria-pressed={isSelected}
              data-tooltip={`${swatch.label} (${swatchHex})`}
              onClick={() => onChangeColor(swatchHex)}
              style={{
                width: '36px',
                height: '36px',
                minWidth: '36px',
                minHeight: '36px',
                padding: 0,
                borderRadius: 'var(--ui-radius-control)',
                backgroundColor: swatchHex,
                border: isSelected ? '2px solid var(--ui-accent)' : '1px solid var(--ui-line)',
                boxShadow: isSelected ? '0 0 0 1px var(--ui-bench)' : 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1
              }}
            />
          );
        })}

        <input
          id={colorInputId}
          type="color"
          aria-label="Colore personalizzato"
          disabled={disabled}
          value={normalizedColor}
          onChange={(e) => onChangeColor(e.target.value.toUpperCase())}
          style={{
            width: '44px',
            height: '36px',
            minWidth: '44px',
            minHeight: '36px',
            padding: '2px',
            borderRadius: 'var(--ui-radius-control)',
            border: '1px solid var(--ui-line)',
            backgroundColor: 'var(--ui-raised)',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        />
      </div>
    </div>
  );
}
