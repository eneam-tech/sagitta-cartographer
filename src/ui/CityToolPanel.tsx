import { useId } from 'react';
import { getCityThemePalette } from '../city/geometry';
import { DISTRICT_PRESETS, DistrictPresetId } from '../city/smartDistrictBrush';
import { StreetGridStyle } from '../city/streetGridTool';
import {
  BuildingRenderStyle,
  BuildingShape,
  PlazaCenterpiece,
  PlazaShape
} from '../model/document';
import { getBuildingShapeLabel, getPlazaShapeLabel } from '../objects/objectCommands';
import { SyncedRangeField, normalizeColorHex } from '../objects/uiControls';
import { EditorStore, UrbanStreetKind, useEditorStore } from '../state/editorStore';
import { CityEnvIcon } from './icons';

export interface CityToolPanelProps {
  store: EditorStore;
}

const BUILDING_SHAPE_OPTIONS: ReadonlyArray<{ id: BuildingShape; label: string }> = [
  { id: 'rect', label: 'Casa' },
  { id: 'l-shape', label: 'Palazzo a L' },
  { id: 'courtyard', label: 'Corte interna' },
  { id: 'tower', label: 'Torre' },
  { id: 'cathedral', label: 'Cattedrale' },
  { id: 'market', label: 'Mercato' }
];

const RENDER_STYLE_OPTIONS: ReadonlyArray<{
  id: 'auto' | BuildingRenderStyle;
  label: string;
}> = [
  { id: 'auto', label: 'Stile carta' },
  { id: 'roof-25d', label: 'Tetti 2.5D' },
  { id: 'ink-plan', label: 'Planimetria' }
];

const STREET_KIND_OPTIONS: ReadonlyArray<{
  id: UrbanStreetKind;
  label: string;
  desc: string;
}> = [
  { id: 'avenue', label: 'Viale', desc: 'Corso principale ampio con bordo marcato.' },
  { id: 'road', label: 'Strada', desc: 'Via urbana ordinaria cui i quartieri si allineano.' },
  { id: 'alley', label: 'Vicolo', desc: 'Passaggio stretto tra isolati interni.' },
  { id: 'canal', label: 'Canale', desc: 'Via d’acqua con banchine in pietra.' }
];

const GRID_STYLE_OPTIONS: ReadonlyArray<{
  id: StreetGridStyle;
  label: string;
  desc: string;
}> = [
  { id: 'orthogonal', label: 'Ortogonale', desc: 'Cardo e decumano ad angolo retto.' },
  { id: 'organic', label: 'Organica', desc: 'Assi curvi con vie secondarie irregolari.' },
  { id: 'radial', label: 'Radiale', desc: 'Anelli concentrici e raggi dal centro.' }
];

const PLAZA_SHAPE_OPTIONS: ReadonlyArray<{ id: PlazaShape; label: string }> = [
  { id: 'rect', label: 'Rettangolare' },
  { id: 'circle', label: 'Circolare' },
  { id: 'octagon', label: 'Ottagonale' }
];

const PLAZA_CENTERPIECE_OPTIONS: ReadonlyArray<{
  id: PlazaCenterpiece;
  label: string;
}> = [
  { id: 'none', label: 'Libera' },
  { id: 'fountain', label: 'Fontana' },
  { id: 'obelisk', label: 'Obelisco' },
  { id: 'market-stalls', label: 'Bancarelle' },
  { id: 'tree', label: 'Albero monumentale' }
];

export function CityToolPanel({ store }: CityToolPanelProps) {
  const snap = useEditorStore(store);
  const roofColorInputId = useId();
  const { activeTool, doc } = snap;
  const palette = getCityThemePalette(doc.theme);

  if (activeTool === 'district') {
    const activePreset =
      DISTRICT_PRESETS.find((p) => p.id === snap.districtPreset) ?? DISTRICT_PRESETS[0];

    return (
      <div className="panel-group">
        <h3 className="panel-subheading">Quartiere intelligente</h3>

        <div className="form-field">
          <span className="field-label">Azione pennello</span>
          <div className="segmented-group" role="group" aria-label="Azione pennello quartiere">
            <button
              type="button"
              className="segmented-btn"
              aria-pressed={snap.districtMode === 'paint'}
              onClick={() => store.setDistrictMode('paint')}
            >
              Dipingi case
            </button>
            <button
              type="button"
              className="segmented-btn"
              aria-pressed={snap.districtMode === 'erase'}
              onClick={() => store.setDistrictMode('erase')}
            >
              Cancella edifici
            </button>
          </div>
        </div>

        <p className="panel-hint">
          {snap.districtMode === 'erase'
            ? 'Trascina sopra gli edifici esistenti per demolirli senza toccare strade, piazze e mura.'
            : activePreset.description}
        </p>

        {snap.districtMode === 'paint' ? (
          <div className="form-field">
            <span className="field-label">Tipologia di quartiere</span>
            <div className="city-preset-list" role="group" aria-label="Tipologia di quartiere">
              {DISTRICT_PRESETS.map((preset) => {
                const selected = snap.districtPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className="segmented-btn city-preset-btn"
                    aria-pressed={selected}
                    onClick={() => store.setDistrictPreset(preset.id as DistrictPresetId)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <SyncedRangeField
          label="Diametro pennello"
          value={snap.districtDiameterDoc}
          min={28}
          max={320}
          step={4}
          unit="u"
          onChange={(v) => store.setDistrictDiameterDoc(v)}
        />

        {snap.districtMode === 'paint' ? (
          <>
            <SyncedRangeField
              label="Densità edificazione"
              value={Math.round(snap.districtDensity * 100)}
              min={20}
              max={100}
              step={5}
              unit="%"
              onChange={(v) => store.setDistrictDensityPercent(v)}
            />

            <SyncedRangeField
              label="Scala edifici"
              value={Math.round(snap.districtBuildingScale * 100)}
              min={60}
              max={160}
              step={5}
              unit="%"
              onChange={(v) => store.setDistrictBuildingScale(v / 100)}
            />

            <SyncedRangeField
              label="Irregolarità organica"
              value={Math.round(snap.districtIrregularity * 100)}
              min={0}
              max={100}
              step={5}
              unit="%"
              onChange={(v) => store.setDistrictIrregularityPercent(v)}
            />

            <div className="form-field">
              <span className="field-label">Resa grafica</span>
              <div
                className="segmented-group"
                style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
                role="group"
                aria-label="Resa grafica quartiere"
              >
                {RENDER_STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="segmented-btn"
                    aria-pressed={snap.districtRenderStyle === opt.id}
                    onClick={() => store.setDistrictRenderStyle(opt.id)}
                    style={{ fontSize: '13px', lineHeight: '18px', padding: '0 4px' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => store.openDialog('generateCity')}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <CityEnvIcon size={18} />
          <span>Genera città…</span>
        </button>
      </div>
    );
  }

  if (activeTool === 'building') {
    const normalizedRoof = normalizeColorHex(
      snap.buildingRoofColor,
      palette.roofPalette[0] ?? '#9E4638'
    );

    return (
      <div className="panel-group">
        <h3 className="panel-subheading">Edificio singolo</h3>
        <p className="panel-hint">
          {getBuildingShapeLabel(snap.buildingShape)}. Fai clic sulla carta per posizionare l’edificio.
        </p>

        <div className="form-field">
          <span className="field-label">Pianta edificio</span>
          <div className="city-shape-grid" role="group" aria-label="Pianta edificio">
            {BUILDING_SHAPE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="segmented-btn"
                aria-pressed={snap.buildingShape === opt.id}
                onClick={() => store.setBuildingShape(opt.id)}
                style={{ fontSize: '13px', lineHeight: '18px' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <SyncedRangeField
          label="Larghezza"
          value={snap.buildingWidthDoc}
          min={12}
          max={160}
          step={2}
          unit="u"
          onChange={(v) => store.setBuildingWidthDoc(v)}
        />

        <SyncedRangeField
          label="Profondità"
          value={snap.buildingHeightDoc}
          min={12}
          max={160}
          step={2}
          unit="u"
          onChange={(v) => store.setBuildingHeightDoc(v)}
        />

        <SyncedRangeField
          label="Rotazione"
          value={snap.buildingRotationDeg}
          min={0}
          max={355}
          step={5}
          unit="°"
          onChange={(v) => store.setBuildingRotationDeg(v)}
        />

        <label className="pencil-check-row">
          <input
            type="checkbox"
            checked={snap.buildingAutoAlign}
            onChange={(e) => store.setBuildingAutoAlign(e.target.checked)}
          />
          <span>Allinea automaticamente alle strade vicine</span>
        </label>

        <div className="form-field">
          <div className="slider-header">
            <label htmlFor={roofColorInputId} className="field-label">
              Colore tetto / inchiostro
            </label>
            <input
              id={roofColorInputId}
              type="color"
              value={normalizedRoof}
              onChange={(e) => store.setBuildingRoofColor(normalizeColorHex(e.target.value))}
              aria-label="Colore personalizzato edificio"
              style={{
                width: '36px',
                height: '32px',
                padding: '2px',
                backgroundColor: 'var(--ui-raised)',
                border: '1px solid var(--ui-line)',
                borderRadius: 'var(--ui-radius-control)',
                cursor: 'pointer'
              }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {palette.roofPalette.map((hex) => {
              const selected = normalizedRoof === normalizeColorHex(hex);
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Colore ${hex}`}
                  aria-pressed={selected}
                  onClick={() => store.setBuildingRoofColor(hex)}
                  style={{
                    width: '32px',
                    height: '32px',
                    minWidth: '32px',
                    minHeight: '32px',
                    padding: 0,
                    backgroundColor: hex,
                    border: selected ? '2px solid var(--ui-accent)' : '1px solid var(--ui-line)',
                    borderRadius: 'var(--ui-radius-control)',
                    cursor: 'pointer'
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
            {RENDER_STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="segmented-btn"
                aria-pressed={snap.buildingRenderStyle === opt.id}
                onClick={() => store.setBuildingRenderStyle(opt.id)}
                style={{ fontSize: '13px', lineHeight: '18px', padding: '0 4px' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (activeTool === 'street') {
    const activeSpec =
      STREET_KIND_OPTIONS.find((s) => s.id === snap.streetPathKind) ?? STREET_KIND_OPTIONS[1];

    return (
      <div className="panel-group">
        <h3 className="panel-subheading">Strade e Canali</h3>

        <div className="form-field">
          <span className="field-label">Tipo di arteria</span>
          <div className="city-shape-grid" role="group" aria-label="Tipo di arteria urbana">
            {STREET_KIND_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="segmented-btn"
                aria-pressed={snap.streetPathKind === opt.id}
                onClick={() => store.setStreetPathKind(opt.id)}
                style={{ fontSize: '13px', lineHeight: '18px' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <p className="panel-hint">{activeSpec.desc}</p>

        <SyncedRangeField
          label="Larghezza carreggiata"
          value={snap.streetStrokeWidthDoc}
          min={3}
          max={44}
          step={0.5}
          unit="u"
          onChange={(v) => store.setStreetStrokeWidthDoc(v)}
        />

        <label className="pencil-check-row">
          <input
            type="checkbox"
            checked={snap.streetSnapEnabled}
            onChange={(e) => store.setStreetSnapEnabled(e.target.checked)}
          />
          <span>Aggancia automaticamente agli incroci</span>
        </label>

        <button
          type="button"
          className="btn btn-secondary btn-compact"
          onClick={() => store.setTool('streetGrid')}
          style={{ justifyContent: 'center' }}
        >
          Passa a Griglia stradale →
        </button>
      </div>
    );
  }

  if (activeTool === 'streetGrid') {
    const activeStyle =
      GRID_STYLE_OPTIONS.find((g) => g.id === snap.streetGridStyle) ?? GRID_STYLE_OPTIONS[0];

    return (
      <div className="panel-group">
        <h3 className="panel-subheading">Griglia stradale</h3>
        <p className="panel-hint">
          {activeStyle.desc} Trascina un rettangolo sulla carta per creare gli isolati.
        </p>

        <div className="form-field">
          <span className="field-label">Impianto viario</span>
          <div
            className="segmented-group"
            style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
            role="group"
            aria-label="Impianto della griglia stradale"
          >
            {GRID_STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="segmented-btn"
                aria-pressed={snap.streetGridStyle === opt.id}
                onClick={() => store.setStreetGridStyle(opt.id)}
                style={{ fontSize: '13px', lineHeight: '18px', padding: '0 4px' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <SyncedRangeField
          label="Passo isolati"
          value={snap.streetGridSpacingDoc}
          min={48}
          max={220}
          step={4}
          unit="u"
          onChange={(v) => store.setStreetGridSpacingDoc(v)}
        />

        <SyncedRangeField
          label="Orientamento"
          value={snap.streetGridAngleDeg}
          min={-45}
          max={45}
          step={5}
          unit="°"
          onChange={(v) => store.setStreetGridAngleDeg(v)}
        />

        <label className="pencil-check-row">
          <input
            type="checkbox"
            checked={snap.streetGridAutoFill}
            onChange={(e) => store.setStreetGridAutoFill(e.target.checked)}
          />
          <span>Riempi automaticamente gli isolati con edifici</span>
        </label>
      </div>
    );
  }

  if (activeTool === 'plaza') {
    return (
      <div className="panel-group">
        <h3 className="panel-subheading">Piazza</h3>
        <p className="panel-hint">
          {getPlazaShapeLabel(snap.plazaShape)}. Fai clic per posare la piazza; gli edifici sottostanti possono essere sgomberati in automatico.
        </p>

        <div className="form-field">
          <span className="field-label">Forma</span>
          <div
            className="segmented-group"
            style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
            role="group"
            aria-label="Forma della piazza"
          >
            {PLAZA_SHAPE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="segmented-btn"
                aria-pressed={snap.plazaShape === opt.id}
                onClick={() => store.setPlazaShape(opt.id)}
                style={{ fontSize: '13px', lineHeight: '18px', padding: '0 4px' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <SyncedRangeField
          label="Dimensione piazza"
          value={snap.plazaSizeDoc}
          min={36}
          max={220}
          step={4}
          unit="u"
          onChange={(v) => store.setPlazaSizeDoc(v)}
        />

        <div className="form-field">
          <span className="field-label">Elemento centrale</span>
          <div className="city-preset-list" role="group" aria-label="Elemento centrale della piazza">
            {PLAZA_CENTERPIECE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="segmented-btn city-preset-btn"
                aria-pressed={snap.plazaCenterpiece === opt.id}
                onClick={() => store.setPlazaCenterpiece(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="pencil-check-row">
          <input
            type="checkbox"
            checked={snap.plazaClearBuildings}
            onChange={(e) => store.setPlazaClearBuildings(e.target.checked)}
          />
          <span>Sgombera automaticamente gli edifici sottostanti</span>
        </label>
      </div>
    );
  }

  return (
    <div className="panel-group">
      <h3 className="panel-subheading">Mura cittadine</h3>
      <p className="panel-hint">
        Trascina il perimetro difensivo: i torrioni e le porte fortificate agli incroci stradali vengono generati in automatico.
      </p>

      <SyncedRangeField
        label="Spessore cortina"
        value={snap.wallStrokeWidthDoc}
        min={6}
        max={30}
        step={1}
        unit="u"
        onChange={(v) => store.setWallStrokeWidthDoc(v)}
      />

      <SyncedRangeField
        label="Passo torrioni"
        value={snap.wallTowerSpacingDoc}
        min={45}
        max={240}
        step={5}
        unit="u"
        onChange={(v) => store.setWallTowerSpacingDoc(v)}
      />

      <label className="pencil-check-row">
        <input
          type="checkbox"
          checked={snap.wallAutoTowers}
          onChange={(e) => store.setWallAutoTowers(e.target.checked)}
        />
        <span>Torrioni difensivi automatici</span>
      </label>

      <label className="pencil-check-row">
        <input
          type="checkbox"
          checked={snap.wallAutoGates}
          onChange={(e) => store.setWallAutoGates(e.target.checked)}
        />
        <span>Porte con torri gemelle sugli incroci stradali</span>
      </label>
    </div>
  );
}
