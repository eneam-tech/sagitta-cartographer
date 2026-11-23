import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { clampNumber } from '../model/coordinates';
import { COVER_MATERIALS, CoverToolId, MapObject } from '../model/document';
import {
  EditorStore,
  ElevationSubTool,
  InspectorTab,
  MAX_BRUSH_DIAMETER_DOC,
  MIN_BRUSH_DIAMETER_DOC,
  useEditorStore
} from '../state/editorStore';
import {
  BrushDiameterFeedback,
  BrushPreviewSwatch,
  CoverSurfaceSwatch,
  ElevationBandSwatch
} from './TerrainSwatches';
import {
  CloseIcon,
  FlattenIcon,
  GenerateWorldIcon,
  LowerIcon,
  PlateauIcon,
  RaiseIcon,
  ResizeCanvasIcon,
  SmoothIcon
} from './icons';

export interface PropertiesPanelProps {
  store: EditorStore;
  layersSlot?: ReactNode;
  pathToolSlot?: ReactNode;
  poiLibrarySlot?: ReactNode;
  objectInspectorSlot?: ReactNode;
  objectListSlot?: ReactNode;
  labelToolSlot?: ReactNode;
}

const COVER_TOOL_SET = new Set<string>(COVER_MATERIALS.map((m) => m.tool));

const ELEVATION_TOOLS: ReadonlyArray<{
  tool: ElevationSubTool;
  label: string;
  hint: string;
  icon: ReactNode;
}> = [
  {
    tool: 'raise',
    label: 'Alza picchi',
    hint: 'Scolpisce creste e picchi montuosi frastagliati senza appiattirsi in un tavolato.',
    icon: <RaiseIcon size={18} />
  },
  {
    tool: 'plateau',
    label: 'Altopiano',
    hint: 'Modella un tavolato piano con scarpate nette alla quota impostata.',
    icon: <PlateauIcon size={18} />
  },
  {
    tool: 'lower',
    label: 'Abbassa',
    hint: 'Scava valli, passi e bassopiani verso il livello della costa.',
    icon: <LowerIcon size={18} />
  },
  {
    tool: 'flatten',
    label: 'Appiattisci',
    hint: 'Uniforma il terreno intorno alla quota iniziale del tratto.',
    icon: <FlattenIcon size={18} />
  },
  {
    tool: 'smooth',
    label: 'Ammorbidisci',
    hint: 'Attenua i pendii ripidi e fonde dolcemente le fasce di quota.',
    icon: <SmoothIcon size={18} />
  }
];

const INTENSITY_PRESETS: ReadonlyArray<{ label: string; percent: number }> = [
  { label: 'Leggero', percent: 20 },
  { label: 'Medio', percent: 45 },
  { label: 'Forte', percent: 80 }
];

const PLATEAU_HEIGHT_PRESETS: ReadonlyArray<{ label: string; height: number }> = [
  { label: 'Collina', height: 135 },
  { label: 'Altopiano', height: 185 },
  { label: 'Tavolato', height: 225 }
];

interface SyncedNumberSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (nextValue: number) => void;
}

function SyncedNumberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange
}: SyncedNumberSliderProps) {
  const rangeId = useId();
  const numId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!editing) {
      setDraft(String(value));
    }
  }, [value, editing]);

  const commitDraft = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      const clamped = Math.round(clampNumber(parsed, min, max));
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
    }
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
            className="number-input"
            min={min}
            max={max}
            step={step}
            value={editing ? draft : value}
            onFocus={() => {
              setEditing(true);
              setDraft(String(value));
            }}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              const parsed = Number(raw);
              if (raw.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
                onChange(Math.round(parsed));
              }
            }}
            onBlur={() => {
              setEditing(false);
              commitDraft();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitDraft();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setDraft(String(value));
                setEditing(false);
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
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function getFallbackObjectName(obj: MapObject): string {
  if (obj.type === 'label') {
    return obj.text.trim() || 'Etichetta vuota';
  }
  if (obj.type === 'path') {
    if (obj.kind === 'river') return 'Fiume';
    if (obj.kind === 'road') return 'Strada';
    if (obj.kind === 'border') return 'Confine';
    return 'Tracciato libero';
  }
  return obj.categoryId || obj.assetId;
}

function FallbackObjectInspector({
  object,
  onClearSelection
}: {
  object: MapObject;
  onClearSelection: () => void;
}) {
  return (
    <div className="panel-group">
      <div className="slider-header">
        <h3 className="panel-subheading">
          {object.type === 'stamp'
            ? 'Simbolo selezionato'
            : object.type === 'label'
              ? 'Etichetta selezionata'
              : 'Tracciato selezionato'}
        </h3>
        <button type="button" className="btn btn-ghost btn-compact" onClick={onClearSelection}>
          Deseleziona
        </button>
      </div>
      <div className="inspector-summary-grid">
        <span className="inspector-summary-key">Nome</span>
        <span className="inspector-summary-val">{getFallbackObjectName(object)}</span>
        <span className="inspector-summary-key">Posizione</span>
        <span className="inspector-summary-val">
          {Math.round(object.x)}, {Math.round(object.y)} u
        </span>
        {object.type === 'stamp' ? (
          <>
            <span className="inspector-summary-key">Dimensione</span>
            <span className="inspector-summary-val">
              {Math.round(object.width)} × {Math.round(object.height)} u
            </span>
          </>
        ) : object.type === 'label' ? (
          <>
            <span className="inspector-summary-key">Corpo testo</span>
            <span className="inspector-summary-val">{object.fontSize.toFixed(1)} u</span>
          </>
        ) : (
          <>
            <span className="inspector-summary-key">Spessore</span>
            <span className="inspector-summary-val">{object.strokeWidthDoc.toFixed(1)} u</span>
          </>
        )}
        <span className="inspector-summary-key">Rotazione</span>
        <span className="inspector-summary-val">{Math.round(object.rotationDeg)}°</span>
      </div>
    </div>
  );
}

function FallbackLayersList({ store }: { store: EditorStore }) {
  const snap = useEditorStore(store);
  const layers = [...snap.doc.manifest.layers].reverse();

  return (
    <div className="panel-group">
      <p className="panel-hint">Ordine visivo dall’alto verso il basso.</p>
      <ul className="objects-fallback-list" aria-label="Livelli della carta">
        {layers.map((layer) => {
          const isActive = layer.id === snap.activeLayerId;
          return (
            <li key={layer.id}>
              <button
                type="button"
                className="objects-fallback-item"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => store.setActiveLayerId(layer.id)}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {layer.name}
                </span>
                <span className="objects-fallback-kind">
                  {layer.locked ? 'Bloccato' : layer.visible ? 'Visibile' : 'Nascosto'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PropertiesPanel({
  store,
  layersSlot,
  pathToolSlot,
  poiLibrarySlot,
  objectInspectorSlot,
  objectListSlot,
  labelToolSlot
}: PropertiesPanelProps) {
  const snap = useEditorStore(store);
  const {
    doc,
    activeTool,
    brushDiameterDoc,
    brushIntensity,
    brushMode,
    brushRoughness,
    plateauTargetHeight,
    inspectorTab,
    activeLayerId,
    selectedObjectId,
    propertiesDrawerOpen
  } = snap;

  const baseId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const prevDrawerOpenRef = useRef(propertiesDrawerOpen);

  useEffect(() => {
    const wasOpen = prevDrawerOpenRef.current;
    prevDrawerOpenRef.current = propertiesDrawerOpen;
    if (wasOpen === propertiesDrawerOpen) return;

    const toggleBtn = document.querySelector<HTMLButtonElement>('.topbar-props-toggle');
    if (!toggleBtn || toggleBtn.offsetParent === null) return;

    if (propertiesDrawerOpen) {
      closeBtnRef.current?.focus();
    } else {
      toggleBtn.focus();
    }
  }, [propertiesDrawerOpen]);

  const selectedObject = selectedObjectId
    ? doc.manifest.objects.find((o) => o.id === selectedObjectId) ?? null
    : null;
  const activeLayer = doc.manifest.layers.find((l) => l.id === activeLayerId);
  const intensityPercent = Math.round(brushIntensity * 100);
  const roughnessPercent = Math.round(brushRoughness * 100);
  const foregroundFirstObjects = [...doc.manifest.objects].reverse();

  const isElevationTool =
    activeTool === 'raise' ||
    activeTool === 'plateau' ||
    activeTool === 'lower' ||
    activeTool === 'flatten' ||
    activeTool === 'smooth';
  const isCoverTool = COVER_TOOL_SET.has(activeTool);

  const formatTabBadge = (count: number): string => (count > 999 ? '999+' : String(count));

  const tabs: ReadonlyArray<{ id: InspectorTab; label: string; badge?: number }> = [
    { id: 'tool', label: 'Strumento' },
    { id: 'layers', label: 'Livelli', badge: doc.manifest.layers.length },
    { id: 'objects', label: 'Oggetti', badge: doc.manifest.objects.length }
  ];

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIdx = (index + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = tabs.length - 1;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const targetTab = tabs[nextIdx];
      store.setInspectorTab(targetTab.id);
      tabRefs.current[nextIdx]?.focus();
    }
  };

  const activeElevationSpec =
    ELEVATION_TOOLS.find((item) => item.tool === activeTool) ?? ELEVATION_TOOLS[0];

  return (
    <>
      <div
        className={`properties-drawer-backdrop ${propertiesDrawerOpen ? 'is-open' : ''}`}
        aria-hidden="true"
        onClick={() => store.setPropertiesDrawerOpen(false)}
      />

      <aside
        id="editor-properties-panel"
        className={`editor-properties ${propertiesDrawerOpen ? 'is-open' : ''}`}
        aria-label="Pannello proprietà"
      >
        <div className="properties-header">
          <h2 className="panel-title">Proprietà</h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="btn btn-ghost btn-icon-only properties-close-btn has-tooltip-bottom"
            aria-label="Chiudi pannello proprietà"
            data-tooltip="Chiudi (Esc)"
            onClick={() => store.setPropertiesDrawerOpen(false)}
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {/* 3 schede superiori: Strumento | Livelli | Oggetti */}
        <div
          className="inspector-tablist"
          role="tablist"
          aria-label="Sezioni del pannello proprietà"
        >
          {tabs.map((tab, index) => {
            const isSelected = inspectorTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                id={`${baseId}-tab-${tab.id}`}
                type="button"
                role="tab"
                className="inspector-tab-btn"
                aria-selected={isSelected}
                aria-controls={`${baseId}-panel-${tab.id}`}
                aria-label={tab.badge !== undefined ? `${tab.label} (${tab.badge})` : tab.label}
                title={tab.badge !== undefined ? `${tab.label}: ${tab.badge}` : tab.label}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => store.setInspectorTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, index)}
              >
                <span className="inspector-tab-label">{tab.label}</span>
                {tab.badge !== undefined ? (
                  <span className="inspector-tab-badge tabular-nums">
                    {formatTabBadge(tab.badge)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Scheda 1: Strumento */}
        {inspectorTab === 'tool' ? (
          <div
            id={`${baseId}-panel-tool`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-tool`}
            className="properties-body"
          >
            {/* Strumento Mano */}
            {activeTool === 'hand' ? (
              <div className="panel-group">
                <h3 className="panel-subheading">Spostamento vista</h3>
                <p className="panel-hint">
                  Trascina sul foglio per spostare l’inquadratura oppure usa la rotella per lo zoom sul cursore.
                </p>
                <div className="inspector-summary-grid">
                  <span className="inspector-summary-key">Formato foglio</span>
                  <span className="inspector-summary-val">
                    {Math.round(doc.manifest.page.widthMm)} × {Math.round(doc.manifest.page.heightMm)} mm
                  </span>
                  <span className="inspector-summary-key">Spazio logico</span>
                  <span className="inspector-summary-val">
                    {doc.manifest.space.width} × {doc.manifest.space.height} u
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={() => store.openDialog('resizeCanvas')}
                >
                  <ResizeCanvasIcon size={16} />
                  <span>Ridimensiona tela…</span>
                </button>
              </div>
            ) : null}

            {/* Strumenti Terra / Acqua (con pennello intelligente e scorciatoia generatore) */}
            {activeTool === 'land' || activeTool === 'water' ? (
              <div className="panel-group">
                <h3 className="panel-subheading">
                  {activeTool === 'land' ? 'Pennello terra' : 'Pennello acqua'}
                </h3>

                <div className="form-field">
                  <span className="field-label">Modalità pennello</span>
                  <div className="segmented-group" role="group" aria-label="Modalità pennello">
                    <button
                      type="button"
                      className="segmented-btn"
                      aria-pressed={brushMode === 'smart'}
                      onClick={() => store.setBrushMode('smart')}
                    >
                      Intelligente
                    </button>
                    <button
                      type="button"
                      className="segmented-btn"
                      aria-pressed={brushMode === 'classic'}
                      onClick={() => store.setBrushMode('classic')}
                    >
                      Geometrico
                    </button>
                  </div>
                </div>

                <p className="panel-hint">
                  {brushMode === 'smart'
                    ? activeTool === 'land'
                      ? 'Scolpisce coste frastagliate con isolotti costieri e un rilievo naturale verso l’interno.'
                      : 'Scava insenature naturali rispettando scogliere e versanti costieri esistenti.'
                    : 'Pennello circolare classico con bordo netto e uniforme.'}
                </p>

                {brushMode === 'smart' ? (
                  <SyncedNumberSlider
                    label="Frastagliatura costa"
                    value={roughnessPercent}
                    min={0}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(pct) => store.setBrushRoughnessPercent(pct)}
                  />
                ) : null}

                <SyncedNumberSlider
                  label="Diametro"
                  value={brushDiameterDoc}
                  min={MIN_BRUSH_DIAMETER_DOC}
                  max={MAX_BRUSH_DIAMETER_DOC}
                  step={2}
                  unit="u"
                  onChange={(val) => store.setBrushDiameter(val)}
                />
                <BrushPreviewSwatch
                  tool={activeTool}
                  diameterDoc={brushDiameterDoc}
                  colors={doc.theme.colors}
                />

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => store.openDialog('generateWorld')}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <GenerateWorldIcon size={18} />
                  <span>Genera continente…</span>
                </button>
              </div>
            ) : null}

            {/* Strumento Rilievo (5 modalità: Alza picchi, Altopiano, Abbassa, Appiattisci, Ammorbidisci) */}
            {isElevationTool ? (
              <div className="panel-group">
                <h3 className="panel-subheading">Rilievo</h3>
                <div
                  className="elevation-mode-grid"
                  role="group"
                  aria-label="Modalità rilievo"
                >
                  {ELEVATION_TOOLS.map((item) => {
                    const active = activeTool === item.tool;
                    return (
                      <button
                        key={item.tool}
                        type="button"
                        className="segmented-btn elevation-mode-btn"
                        aria-pressed={active}
                        onClick={() => store.setTool(item.tool)}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                <p className="panel-hint">{activeElevationSpec.hint}</p>

                {activeTool === 'plateau' ? (
                  <div className="panel-group" style={{ gap: 'var(--ui-space-2)' }}>
                    <SyncedNumberSlider
                      label="Quota altopiano"
                      value={plateauTargetHeight}
                      min={60}
                      max={245}
                      step={5}
                      unit=""
                      onChange={(val) => store.setPlateauTargetHeight(val)}
                    />
                    <div
                      className="intensity-presets-row"
                      role="group"
                      aria-label="Preset quota altopiano"
                    >
                      {PLATEAU_HEIGHT_PRESETS.map((preset) => {
                        const isPresetActive = plateauTargetHeight === preset.height;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            className="segmented-btn intensity-preset-btn"
                            aria-pressed={isPresetActive}
                            onClick={() => store.setPlateauTargetHeight(preset.height)}
                          >
                            <span>{preset.label}</span>
                            <span className="intensity-preset-pct tabular-nums">
                              {preset.height}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="panel-group" style={{ gap: 'var(--ui-space-2)' }}>
                  <SyncedNumberSlider
                    label="Intensità"
                    value={intensityPercent}
                    min={5}
                    max={100}
                    step={1}
                    unit="%"
                    onChange={(pct) => store.setBrushIntensityPercent(pct)}
                  />
                  <div
                    className="intensity-presets-row"
                    role="group"
                    aria-label="Preset intensità rilievo"
                  >
                    {INTENSITY_PRESETS.map((preset) => {
                      const isPresetActive = intensityPercent === preset.percent;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          className="segmented-btn intensity-preset-btn"
                          aria-pressed={isPresetActive}
                          onClick={() => store.setBrushIntensityPercent(preset.percent)}
                        >
                          <span>{preset.label}</span>
                          <span className="intensity-preset-pct tabular-nums">
                            {preset.percent}%
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <SyncedNumberSlider
                  label="Diametro pennello"
                  value={brushDiameterDoc}
                  min={MIN_BRUSH_DIAMETER_DOC}
                  max={MAX_BRUSH_DIAMETER_DOC}
                  step={2}
                  unit="u"
                  onChange={(val) => store.setBrushDiameter(val)}
                />

                <BrushDiameterFeedback
                  diameterDoc={brushDiameterDoc}
                  caption="Anteprima diametro"
                />

                <ElevationBandSwatch colors={doc.theme.colors} />
              </div>
            ) : null}

            {/* Strumento Superfici / Materiali (10 materiali tema-reattivi) */}
            {isCoverTool ? (
              <div className="panel-group">
                <h3 className="panel-subheading">Superfici e materiali</h3>
                <CoverSurfaceSwatch
                  activeCover={activeTool as CoverToolId}
                  onSelectCover={(tool) => store.setTool(tool)}
                  colors={doc.theme.colors}
                />

                <div className="form-field">
                  <span className="field-label">Modalità pennello</span>
                  <div className="segmented-group" role="group" aria-label="Modalità pennello">
                    <button
                      type="button"
                      className="segmented-btn"
                      aria-pressed={brushMode === 'smart'}
                      onClick={() => store.setBrushMode('smart')}
                    >
                      Intelligente
                    </button>
                    <button
                      type="button"
                      className="segmented-btn"
                      aria-pressed={brushMode === 'classic'}
                      onClick={() => store.setBrushMode('classic')}
                    >
                      Uniforme
                    </button>
                  </div>
                </div>

                <p className="panel-hint">
                  {brushMode === 'smart'
                    ? 'Adatta i margini al rilievo e alle coste, con bordi organici e naturali.'
                    : 'Stende il materiale in modo uniforme all’interno dell’intera area del pennello.'}
                </p>

                <SyncedNumberSlider
                  label="Diametro pennello"
                  value={brushDiameterDoc}
                  min={MIN_BRUSH_DIAMETER_DOC}
                  max={MAX_BRUSH_DIAMETER_DOC}
                  step={2}
                  unit="u"
                  onChange={(val) => store.setBrushDiameter(val)}
                />
                <BrushDiameterFeedback
                  diameterDoc={brushDiameterDoc}
                  caption="Anteprima diametro"
                />
              </div>
            ) : null}

            {/* Strumento Fiumi e Strade */}
            {activeTool === 'path' ? (
              <div className="panel-group">
                <h3 className="panel-subheading">Fiumi e Strade</h3>
                {pathToolSlot ?? (
                  <p className="panel-empty-hint">
                    Trascina sulla mappa per tracciare un fiume, una strada o un confine.
                  </p>
                )}
              </div>
            ) : null}

            {/* Strumento POI */}
            {activeTool === 'poi' ? (
              <div className="panel-group">
                <h3 className="panel-subheading">Punti di interesse</h3>
                {poiLibrarySlot ?? (
                  <p className="panel-empty-hint">Scegli un simbolo e fai clic sulla mappa.</p>
                )}
              </div>
            ) : null}

            {/* Strumento Testo */}
            {activeTool === 'label' ? (
              <div className="panel-group">
                <h3 className="panel-subheading">Etichette</h3>
                {labelToolSlot ?? (
                  <p className="panel-empty-hint">
                    Fai clic sulla mappa per collocare una nuova etichetta di testo.
                  </p>
                )}
              </div>
            ) : null}

            {/* Strumento Selezione */}
            {activeTool === 'select' ? (
              selectedObject ? (
                objectInspectorSlot ?? (
                  <FallbackObjectInspector
                    object={selectedObject}
                    onClearSelection={() => store.selectObject(null)}
                  />
                )
              ) : (
                <div className="panel-group">
                  <h3 className="panel-subheading">Selezione</h3>
                  {objectInspectorSlot ?? (
                    <p className="panel-empty-hint">
                      Fai clic su un simbolo, tracciato o etichetta della mappa, oppure scegli un elemento dalla scheda Oggetti.
                    </p>
                  )}
                </div>
              )
            ) : null}

            {/* Collegamento rapido contestuale a Oggetti / Livelli senza affollare */}
            <div className="panel-quick-links">
              {activeTool !== 'select' && selectedObject ? (
                <button
                  type="button"
                  className="panel-quick-card"
                  onClick={() => store.setInspectorTab('objects')}
                >
                  <span className="panel-quick-card-label">
                    Selezionato: <strong>{getFallbackObjectName(selectedObject)}</strong>
                  </span>
                  <span className="panel-quick-card-action">Modifica →</span>
                </button>
              ) : null}

              <div className="panel-quick-row">
                <button
                  type="button"
                  className="btn btn-ghost btn-compact panel-quick-jump"
                  onClick={() => store.setInspectorTab('layers')}
                >
                  <span>Livello: {activeLayer?.name ?? '—'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact panel-quick-jump tabular-nums"
                  onClick={() => store.setInspectorTab('objects')}
                >
                  <span>Oggetti ({doc.manifest.objects.length})</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Scheda 2: Livelli */}
        {inspectorTab === 'layers' ? (
          <div
            id={`${baseId}-panel-layers`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-layers`}
            className="properties-body"
          >
            {layersSlot ?? <FallbackLayersList store={store} />}
          </div>
        ) : null}

        {/* Scheda 3: Oggetti */}
        {inspectorTab === 'objects' ? (
          <div
            id={`${baseId}-panel-objects`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-objects`}
            className="properties-body"
          >
            {selectedObject ? (
              objectInspectorSlot ?? (
                <FallbackObjectInspector
                  object={selectedObject}
                  onClearSelection={() => store.selectObject(null)}
                />
              )
            ) : (
              <p className="panel-empty-hint">
                Seleziona un elemento dall’elenco qui sotto o usa Selezione (V) sulla carta.
              </p>
            )}

            <section className="panel-group" aria-label="Elenco oggetti della carta">
              <div className="slider-header">
                <h3 className="panel-subheading">
                  Elenco oggetti ({doc.manifest.objects.length})
                </h3>
              </div>
              {objectListSlot ??
                (foregroundFirstObjects.length === 0 ? (
                  <p className="panel-empty-hint">Nessun oggetto sulla mappa.</p>
                ) : (
                  <ul className="objects-fallback-list">
                    {foregroundFirstObjects.map((obj) => {
                      const isSelected = obj.id === selectedObjectId;
                      return (
                        <li key={obj.id}>
                          <button
                            type="button"
                            className="objects-fallback-item"
                            aria-current={isSelected ? 'true' : undefined}
                            onClick={() => store.selectObject(obj.id)}
                          >
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {getFallbackObjectName(obj)}
                            </span>
                            <span className="objects-fallback-kind">
                              {obj.type === 'stamp'
                                ? 'POI'
                                : obj.type === 'label'
                                  ? 'Testo'
                                  : 'Tracciato'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ))}
            </section>
          </div>
        ) : null}
      </aside>
    </>
  );
}
