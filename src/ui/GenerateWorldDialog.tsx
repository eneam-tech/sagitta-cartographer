import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { clampNumber } from '../model/coordinates';
import { EditorStore, useEditorStore } from '../state/editorStore';
import {
  WORLD_GENERATOR_PRESETS,
  WorldGeneratorPresetId,
  getWorldGeneratorPreset
} from '../terrain/worldGenerator';
import { WITCHER_THEME } from '../theme/theme';
import { ModalDialog } from './Dialogs';
import { GenerateWorldIcon } from './icons';

export interface GenerateWorldDialogProps {
  store: EditorStore;
}

export function GenerateWorldDialog({ store }: GenerateWorldDialogProps) {
  const snap = useEditorStore(store);
  const formId = useId();
  const seedInputId = useId();
  const seaId = useId();
  const mountainId = useId();
  const roughnessId = useId();
  const biomeId = useId();
  const submitBtnRef = useRef<HTMLButtonElement>(null);

  const initialPreset: WorldGeneratorPresetId = 'northern-realms';
  const initialSpec = getWorldGeneratorPreset(initialPreset);

  const [preset, setPreset] = useState<WorldGeneratorPresetId>(initialPreset);
  const [seed, setSeed] = useState<number>(snap.doc.manifest.terrain.seed || 4219);
  const [seaLevelPercent, setSeaLevelPercent] = useState<number>(initialSpec.defaultSeaLevelPercent);
  const [mountainStrengthPercent, setMountainStrengthPercent] = useState<number>(
    initialSpec.defaultMountainPercent
  );
  const [coastRoughnessPercent, setCoastRoughnessPercent] = useState<number>(
    initialSpec.defaultRoughnessPercent
  );
  const [biomeRichnessPercent, setBiomeRichnessPercent] = useState<number>(
    initialSpec.defaultBiomePercent
  );
  const [applyWitcherTheme, setApplyWitcherTheme] = useState<boolean>(
    snap.doc.theme.id !== WITCHER_THEME.id
  );

  const handleSelectPreset = (nextId: WorldGeneratorPresetId) => {
    const spec = getWorldGeneratorPreset(nextId);
    setPreset(nextId);
    setSeaLevelPercent(spec.defaultSeaLevelPercent);
    setMountainStrengthPercent(spec.defaultMountainPercent);
    setCoastRoughnessPercent(spec.defaultRoughnessPercent);
    setBiomeRichnessPercent(spec.defaultBiomePercent);
    if (nextId === 'northern-realms' && snap.doc.theme.id !== WITCHER_THEME.id) {
      setApplyWitcherTheme(true);
    }
  };

  const handleRandomSeed = () => {
    const nextSeed = Math.floor(1 + Math.random() * 999998);
    setSeed(nextSeed);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (applyWitcherTheme && snap.doc.theme.id !== WITCHER_THEME.id) {
      store.setTheme(WITCHER_THEME);
    }
    store.generateWorld({
      preset,
      seed: Math.max(1, Math.round(Number.isFinite(seed) ? seed : 4219)),
      seaLevelPercent,
      mountainStrengthPercent,
      coastRoughnessPercent,
      biomeRichnessPercent
    });
  };

  return (
    <ModalDialog
      title="Genera continente"
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
            <GenerateWorldIcon size={18} />
            <span>Genera continente</span>
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
          Sintetizza un continente completo con coste frastagliate, catene montuose a picchi e biomi naturali. L’intera generazione è annullabile in un solo passaggio.
        </p>

        <div className="form-field">
          <span className="field-label">Modello di continente</span>
          <div
            className="generate-preset-grid"
            role="group"
            aria-label="Modello di continente"
          >
            {WORLD_GENERATOR_PRESETS.map((spec) => {
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
            <label htmlFor={seaId} className="field-label">
              Livello del mare
            </label>
            <span className="slider-value tabular-nums">{seaLevelPercent}%</span>
          </div>
          <input
            id={seaId}
            type="range"
            className="range-input"
            min={10}
            max={70}
            step={1}
            value={seaLevelPercent}
            onChange={(e) => setSeaLevelPercent(Number(e.target.value))}
          />
        </div>

        <div className="form-field">
          <div className="slider-header">
            <label htmlFor={mountainId} className="field-label">
              Forza catene montuose
            </label>
            <span className="slider-value tabular-nums">{mountainStrengthPercent}%</span>
          </div>
          <input
            id={mountainId}
            type="range"
            className="range-input"
            min={20}
            max={100}
            step={1}
            value={mountainStrengthPercent}
            onChange={(e) => setMountainStrengthPercent(Number(e.target.value))}
          />
        </div>

        <div className="form-field">
          <div className="slider-header">
            <label htmlFor={roughnessId} className="field-label">
              Frastagliatura costa
            </label>
            <span className="slider-value tabular-nums">{coastRoughnessPercent}%</span>
          </div>
          <input
            id={roughnessId}
            type="range"
            className="range-input"
            min={10}
            max={100}
            step={1}
            value={coastRoughnessPercent}
            onChange={(e) => setCoastRoughnessPercent(Number(e.target.value))}
          />
        </div>

        <div className="form-field">
          <div className="slider-header">
            <label htmlFor={biomeId} className="field-label">
              Ricchezza biomi
            </label>
            <span className="slider-value tabular-nums">{biomeRichnessPercent}%</span>
          </div>
          <input
            id={biomeId}
            type="range"
            className="range-input"
            min={0}
            max={100}
            step={1}
            value={biomeRichnessPercent}
            onChange={(e) => setBiomeRichnessPercent(Number(e.target.value))}
          />
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--ui-space-2)',
            minHeight: '36px',
            fontSize: '15px',
            lineHeight: '22px',
            color: 'var(--ui-text)',
            cursor: 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={applyWitcherTheme}
            onChange={(e) => setApplyWitcherTheme(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: 'var(--ui-accent)' }}
          />
          <span>Applica tema «Regni del Nord» (stile The Witcher 3)</span>
        </label>
      </form>
    </ModalDialog>
  );
}
