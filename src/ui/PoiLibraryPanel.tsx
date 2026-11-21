import { useId, useMemo, useState } from 'react';
import { BUILTIN_POI_CATALOG, POI_CATEGORIES, svgToDataUrl } from '../assets/catalog';
import { SyncedRangeField } from '../objects/uiControls';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { CheckSavedIcon, CloseIcon } from './icons';

export interface PoiLibraryPanelProps {
  store: EditorStore;
}

function normalizeQuery(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Filterable, searchable catalog of all 31 built-in POI stamps with single/scatter
 * brush mode selector, scale control, scatter radius/density controls, and
 * uniform dark swatch previews.
 */
export function PoiLibraryPanel({ store }: PoiLibraryPanelProps) {
  const snap = useEditorStore(store);
  const searchId = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const {
    activePoiId,
    poiPlacementScale,
    poiBrushMode,
    poiScatterRadiusDoc,
    poiScatterDensity
  } = snap;

  const activeItem = activePoiId
    ? BUILTIN_POI_CATALOG.find((item) => item.id === activePoiId) ?? null
    : null;

  const targetLayerId = store.resolveTargetLayerIdForNewObject('stamp');
  const targetLayer = snap.doc.manifest.layers.find((l) => l.id === targetLayerId);
  const targetEditable = store.isLayerEditable(targetLayerId);

  const normalizedQuery = normalizeQuery(searchQuery);

  const filteredItems = useMemo(() => {
    return BUILTIN_POI_CATALOG.filter((item) => {
      if (selectedCategory !== 'all' && item.categoryId !== selectedCategory) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = normalizeQuery(
        `${item.name} ${item.description} ${item.categoryLabel} ${item.tags.join(' ')}`
      );
      return haystack.includes(normalizedQuery);
    });
  }, [selectedCategory, normalizedQuery]);

  const scalePercent = Math.round(poiPlacementScale * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-3)' }}>
      <p className="panel-hint" role="status" aria-live="polite">
        {activeItem
          ? poiBrushMode === 'scatter'
            ? `Pronto: ${activeItem.name} (scatter). Fai clic sulla mappa per distribuire.`
            : `Pronto: ${activeItem.name}. Fai clic sulla mappa per collocare.`
          : 'Scegli un simbolo e fai clic sulla mappa.'}
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--ui-space-2)',
          fontSize: '13px',
          lineHeight: '18px',
          color: targetEditable ? 'var(--ui-muted)' : 'var(--ui-error)'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Livello: <strong style={{ color: 'var(--ui-text)' }}>{targetLayer?.name ?? 'Luoghi e POI'}</strong>
        </span>
        {!targetEditable ? <span style={{ flexShrink: 0 }}>Bloccato</span> : null}
      </div>

      {/* Modalità pennello POI: Singolo o Scatter */}
      <div className="form-field">
        <span className="field-label">Modalità posa</span>
        <div className="segmented-group" role="group" aria-label="Modalità pennello POI">
          <button
            type="button"
            className="segmented-btn"
            aria-pressed={poiBrushMode === 'single'}
            onClick={() => store.setPoiBrushMode('single')}
          >
            Singolo
          </button>
          <button
            type="button"
            className="segmented-btn"
            aria-pressed={poiBrushMode === 'scatter'}
            onClick={() => store.setPoiBrushMode('scatter')}
          >
            Scatter
          </button>
        </div>
      </div>

      <SyncedRangeField
        label="Scala POI"
        value={scalePercent}
        min={40}
        max={250}
        step={5}
        unit="%"
        onChange={(pct) => store.setPoiPlacementScale(pct / 100)}
      />

      {poiBrushMode === 'scatter' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ui-space-3)',
            padding: 'var(--ui-space-2)',
            backgroundColor: 'rgba(23, 35, 45, 0.45)',
            border: 'var(--ui-border-w) solid var(--ui-line-subtle)',
            borderRadius: 'var(--ui-radius-control)'
          }}
        >
          <SyncedRangeField
            label="Raggio"
            value={poiScatterRadiusDoc}
            min={40}
            max={360}
            step={10}
            unit="u"
            onChange={(val) => store.setPoiScatterRadiusDoc(val)}
          />
          <SyncedRangeField
            label="Densità"
            value={poiScatterDensity}
            min={2}
            max={8}
            step={1}
            unit="POI"
            onChange={(val) => store.setPoiScatterDensity(val)}
          />
        </div>
      ) : null}

      {/* Ricerca istantanea */}
      <div className="form-field">
        <div className="slider-header">
          <label htmlFor={searchId} className="field-label">
            Cerca simboli
          </label>
          <span
            className="tabular-nums"
            style={{ fontSize: '13px', lineHeight: '18px', color: 'var(--ui-muted)' }}
          >
            {filteredItems.length} di {BUILTIN_POI_CATALOG.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ui-space-1)' }}>
          <input
            id={searchId}
            type="text"
            className="text-input"
            placeholder="Nome, tag o descrizione…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery ? (
            <button
              type="button"
              className="btn btn-ghost"
              aria-label="Svuota ricerca"
              onClick={() => setSearchQuery('')}
              style={{
                minWidth: '36px',
                minHeight: '36px',
                width: '36px',
                height: '36px',
                padding: 0,
                flexShrink: 0
              }}
            >
              <CloseIcon size={18} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Filtri categoria */}
      <div
        role="group"
        aria-label="Filtra per categoria POI"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--ui-space-1)'
        }}
      >
        <button
          type="button"
          className="segmented-btn"
          aria-pressed={selectedCategory === 'all'}
          onClick={() => setSelectedCategory('all')}
          style={{
            minHeight: '36px',
            padding: '0 10px',
            fontSize: '13px',
            lineHeight: '18px',
            color: selectedCategory === 'all' ? 'var(--ui-accent)' : 'var(--ui-text)'
          }}
        >
          Tutte
        </button>
        {POI_CATEGORIES.map((cat) => {
          const isActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              className="segmented-btn"
              aria-pressed={isActive}
              title={cat.description}
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                minHeight: '36px',
                padding: '0 10px',
                fontSize: '13px',
                lineHeight: '18px',
                color: isActive ? 'var(--ui-accent)' : 'var(--ui-text)'
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {filteredItems.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ui-space-2)'
          }}
        >
          <p className="panel-empty-hint">Nessun simbolo corrisponde ai filtri attuali.</p>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
            }}
          >
            Mostra tutti (31)
          </button>
        </div>
      ) : (
        <div
          role="group"
          aria-label="Libreria simboli POI"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 'var(--ui-space-2)'
          }}
        >
          {filteredItems.map((item) => {
            const isActive = item.id === activePoiId;
            return (
              <button
                key={item.id}
                type="button"
                className="cover-swatch-card"
                aria-pressed={isActive}
                aria-label={`${item.name} — ${item.description}`}
                title={item.description}
                onClick={() => store.setActivePoiId(item.id)}
                style={{
                  position: 'relative',
                  minHeight: '96px'
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '64px',
                    backgroundColor: 'var(--ui-bench)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderBottom: 'var(--ui-border-w) solid var(--ui-line-subtle)'
                  }}
                >
                  <img
                    src={svgToDataUrl(item.svgContent)}
                    alt=""
                    width={48}
                    height={48}
                    draggable={false}
                    style={{ display: 'block', pointerEvents: 'none' }}
                  />

                  {isActive ? (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--ui-accent)',
                        color: 'var(--ui-bench)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 0 0 1px var(--ui-bench)'
                      }}
                    >
                      <CheckSavedIcon size={13} />
                    </span>
                  ) : null}
                </div>

                <div
                  style={{
                    padding: '6px var(--ui-space-2)',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <span
                    style={{
                      fontSize: '13px',
                      lineHeight: '18px',
                      fontWeight: 600,
                      color: isActive ? 'var(--ui-accent)' : 'var(--ui-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {item.name}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
