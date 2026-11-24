import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  CITY_GENERATOR_PRESETS,
  CityGeneratorPresetId,
  CityWaterfrontKind,
  getCityGeneratorPreset
} from '../city/cityGenerator';
import { clampNumber } from '../model/coordinates';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { ModalDialog } from './Dialogs';
import { CityEnvIcon } from './icons';

export interface GenerateCityDialogProps {
  store: EditorStore;
}

const WATERFRONT_OPTIONS: ReadonlyArray<{ id: CityWaterfrontKind; label: string }> = [
  { id: 'none', label: 'Nessuna' },
  { id: 'river', label: 'Fiume' },
  { id: 'harbor', label: 'Porto e canali' }
];

export function GenerateCityDialog({ store }: GenerateCityDialogProps) {
  const snap = useEditorStore(store);
  const formId = useId();
  const seedInputId = useId();
  const sizeId = useId();
  const densityId = useId();
  const submitBtnRef = useRef<HTMLButtonElement>(null);

  const initialPreset: CityGeneratorPresetId =
    snap.doc.theme.city?.renderStyle === 'ink-plan'
      ? 'ink-cadastre'
      : 'medieval-town';
  const initialSpec = getCityGeneratorPreset(initialPreset);

  const [preset, setPreset] = useState<CityGeneratorPresetId>(initialPreset);
  const [seed, setSeed] = useState<number>(snap.doc.manifest.terrain.seed || 7309);
  const [citySizePercent, setCitySizePercent] = useState<number>(initialSpec.defaultSizePercent);
  const [densityPercent, setDensityPercent] = useState<number>(initialSpec.defaultDensityPercent);
  const [waterfront, setWaterfront] = useState<CityWaterfrontKind>(initialSpec.defaultWaterfront);
  const [hasWalls, setHasWalls] = useState<boolean>(initialSpec.defaultHasWalls);
  const [applyPresetTheme, setApplyPresetTheme] = useState<boolean>(true);

  const selectedSpec = getCityGeneratorPreset(preset);

  const handleSelectPreset = (nextId: CityGeneratorPresetId) => {
    const spec = getCityGeneratorPreset(nextId);
    setPreset(nextId);
    setCitySizePercent(spec.defaultSizePercent);
    setDensityPercent(spec.defaultDensityPercent);
    setWaterfront(spec.defaultWaterfront);
    setHasWalls(spec.defaultHasWalls);
  };

  const handleRandomSeed = () => {
    setSeed(Math.floor(1 + Math.random() * 999998));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const themeOverride = applyPresetTheme ? selectedSpec.theme : undefined;
    store.generateCity(
      {
        preset,
        seed: Math.max(1, Math.round(Number.isFinite(seed) ? seed : 7309)),
        citySizePercent,
        densityPercent,
        waterfront,
        hasWalls
      },
      themeOverride
    );
  };

  return (
    <ModalDialog
      title="Genera città"
      onClose={() => store.closeDialog()}
      initialFocusRef={submitBtnRef}
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
            ref={submitBtnRef}
            type="submit"
            form={formId}
            className="btn btn-primary"
          >
            <CityEnvIcon size={18} />
            <span>Genera città</span>
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-4)' }}
      >
        <p className="panel-hint">
          Genera l’impianto urbano completo con isolati, strade allineate, piazze, corsi d’acqua, edifici e fortificazioni. Annullabile in un solo passaggio.
        </p>

        <div className="form-field">
          <span className="field-label">Modello urbano</span>
          <div className="generate-preset-grid" role="group" aria-label="Modello urbano">
            {CITY_GENERATOR_PRESETS.map((spec) => {
              const selected = preset === spec.id;
              return (
                <button
                  key={spec.id}
                  type="button"
                  className="generate-preset-card"
                  aria-pressed={selected}
                  onClick={() => handleSelectPreset(spec.id)}
                >
                  <span className="generate-preset-title">{spec.label}</span>
                  <span className="generate-preset-desc">{spec.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="form-field">
          <div className="slider-header">
            <label htmlFor={seedInputId} className="field-label">
              Seme procedurale (Seed)
            </label>
          </div>
          <div style={{ display: 'flex', gap: 'var(--ui-space-2)', alignItems: 'center' }}>
            <input
              id={seedInputId}
              type="number"
              className="text-input tabular-nums"
              min={1}
              max={999999999}
              step={1}
              value={seed}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                setSeed(Number.isFinite(parsed) ? clampNumber(parsed, 1, 999999999) : 1);
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRandomSeed}
            >
              Casuale
            </button>
          </div>
        </div>

        <div className="form-field">
          <div className="slider-header">
            <label htmlFor={sizeId} className="field-label">
              Ampiezza città
            </label>
            <span className="slider-value tabular-nums">{citySizePercent}%</span>
          </div>
          <input
            id={sizeId}
            type="range"
            className="range-input"
            min={40}
            max={95}
            step={1}
            value={citySizePercent}
            onChange={(e) => setCitySizePercent(Number(e.target.value))}
          />
        </div>

        <div className="form-field">
          <div className="slider-header">
            <label htmlFor={densityId} className="field-label">
              Densità isolati
            </label>
            <span className="slider-value tabular-nums">{densityPercent}%</span>
          </div>
          <input
            id={densityId}
            type="range"
            className="range-input"
            min={35}
            max={100}
            step={1}
            value={densityPercent}
            onChange={(e) => setDensityPercent(Number(e.target.value))}
          />
        </div>

        <div className="form-field">
          <span className="field-label">Acqua e fronte portuale</span>
          <div
            className="segmented-group"
            style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
            role="group"
            aria-label="Acqua nella città"
          >
            {WATERFRONT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="segmented-btn"
                aria-pressed={waterfront === opt.id}
                onClick={() => setWaterfront(opt.id)}
                style={{ fontSize: '13px', lineHeight: '18px' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-1)' }}>
          <label className="pencil-check-row">
            <input
              type="checkbox"
              checked={hasWalls}
              onChange={(e) => setHasWalls(e.target.checked)}
            />
            <span>Mura cittadine con torri e porte</span>
          </label>

          <label className="pencil-check-row">
            <input
              type="checkbox"
              checked={applyPresetTheme}
              onChange={(e) => setApplyPresetTheme(e.target.checked)}
            />
            <span>Applica lo stile urbano del modello ({selectedSpec.theme.name})</span>
          </label>
        </div>
      </form>
    </ModalDialog>
  );
}
