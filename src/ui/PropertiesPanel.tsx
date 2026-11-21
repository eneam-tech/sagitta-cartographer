import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clampNumber } from '../model/coordinates';
import { MapObject } from '../model/document';
import {
  EditorStore,
  MAX_BRUSH_DIAMETER_DOC,
  MIN_BRUSH_DIAMETER_DOC,
  useEditorStore
} from '../state/editorStore';
import {
  BrushPreviewSwatch,
  CoverSurfaceSwatch,
  ElevationBandSwatch
} from './TerrainSwatches';
import { ChevronDownIcon, CloseIcon } from './icons';

export interface PropertiesPanelProps {
  store: EditorStore;
  poiLibrarySlot?: ReactNode;
  objectInspectorSlot?: ReactNode;
  objectListSlot?: ReactNode;
  labelToolSlot?: ReactNode;
}

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
    return obj.kind;
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

export function PropertiesPanel({
  store,
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
    selectedObjectId,
    propertiesDrawerOpen
  } = snap;

  const [objectsOpen, setObjectsOpen] = useState(true);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
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
  const intensityPercent = Math.round(brushIntensity * 100);
  const foregroundFirstObjects = [...doc.manifest.objects].reverse();

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

        <div className="properties-body">
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
                  {doc.manifest.page.widthMm} × {doc.manifest.page.heightMm} mm
                </span>
                <span className="inspector-summary-key">Spazio logico</span>
                <span className="inspector-summary-val">
                  {doc.manifest.space.width} × {doc.manifest.space.height} u
                </span>
              </div>
            </div>
          ) : null}

          {/* Strumenti Terra / Acqua */}
          {activeTool === 'land' || activeTool === 'water' ? (
            <div className="panel-group">
              <h3 className="panel-subheading">
                {activeTool === 'land' ? 'Pennello terra' : 'Pennello acqua'}
              </h3>
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
            </div>
          ) : null}

          {/* Strumento Rilievo (Alza / Abbassa) */}
          {activeTool === 'raise' || activeTool === 'lower' ? (
            <div className="panel-group">
              <h3 className="panel-subheading">Rilievo</h3>
              <div className="segmented-group" role="group" aria-label="Modalità rilievo">
                <button
                  type="button"
                  className="segmented-btn"
                  aria-pressed={activeTool === 'raise'}
                  onClick={() => store.setTool('raise')}
                >
                  Alza
                </button>
                <button
                  type="button"
                  className="segmented-btn"
                  aria-pressed={activeTool === 'lower'}
                  onClick={() => store.setTool('lower')}
                >
                  Abbassa
                </button>
              </div>
              <SyncedNumberSlider
                label="Diametro"
                value={brushDiameterDoc}
                min={MIN_BRUSH_DIAMETER_DOC}
                max={MAX_BRUSH_DIAMETER_DOC}
                step={2}
                unit="u"
                onChange={(val) => store.setBrushDiameter(val)}
              />
              <SyncedNumberSlider
                label="Intensità"
                value={intensityPercent}
                min={5}
                max={100}
                step={1}
                unit="%"
                onChange={(pct) => store.setBrushIntensityPercent(pct)}
              />
              <ElevationBandSwatch colors={doc.theme.colors} />
            </div>
          ) : null}

          {/* Strumento Copertura (Foresta / Campi / Naturale) */}
          {activeTool === 'forest' || activeTool === 'fields' || activeTool === 'natural' ? (
            <div className="panel-group">
              <h3 className="panel-subheading">Copertura</h3>
              <CoverSurfaceSwatch
                activeCover={activeTool}
                onSelectCover={(tool) => store.setTool(tool)}
                colors={doc.theme.colors}
              />
              <SyncedNumberSlider
                label="Diametro"
                value={brushDiameterDoc}
                min={MIN_BRUSH_DIAMETER_DOC}
                max={MAX_BRUSH_DIAMETER_DOC}
                step={2}
                unit="u"
                onChange={(val) => store.setBrushDiameter(val)}
              />
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

          {/* Selezione e ispezione oggetto */}
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
                    Fai clic su un simbolo o su un’etichetta della mappa, oppure scegli un elemento nell’elenco Oggetti.
                  </p>
                )}
              </div>
            )
          ) : selectedObject ? (
            objectInspectorSlot ?? (
              <FallbackObjectInspector
                object={selectedObject}
                onClearSelection={() => store.selectObject(null)}
              />
            )
          ) : null}
        </div>

        {/* Elenco Oggetti sempre accessibile in coda al pannello */}
        <section className="objects-section" aria-label="Elenco oggetti della carta">
          <button
            type="button"
            className="objects-toggle-btn"
            aria-expanded={objectsOpen}
            aria-controls="objects-section-list"
            onClick={() => setObjectsOpen((prev) => !prev)}
          >
            <span>Oggetti ({doc.manifest.objects.length})</span>
            <ChevronDownIcon
              size={18}
              className={`objects-toggle-chevron ${objectsOpen ? 'is-open' : ''}`}
            />
          </button>

          {objectsOpen ? (
            <div id="objects-section-list" className="objects-list-container">
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
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {getFallbackObjectName(obj)}
                            </span>
                            <span className="objects-fallback-kind">
                              {obj.type === 'stamp' ? 'POI' : 'Testo'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ))}
            </div>
          ) : null}
        </section>
      </aside>
    </>
  );
}
