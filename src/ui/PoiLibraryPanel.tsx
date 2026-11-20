import { BUILTIN_POI_CATALOG, svgToDataUrl } from '../assets/catalog';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { CheckSavedIcon } from './icons';

export interface PoiLibraryPanelProps {
  store: EditorStore;
}

/**
 * Grid of built-in POI stamp swatches on uniform dark background with Italian labels,
 * brass active indicator + checkmark, and accessible double-contour focus ring.
 */
export function PoiLibraryPanel({ store }: PoiLibraryPanelProps) {
  const snap = useEditorStore(store);
  const { activePoiId } = snap;
  const activeItem = activePoiId
    ? BUILTIN_POI_CATALOG.find((item) => item.id === activePoiId) ?? null
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-3)' }}>
      <p className="panel-hint" role="status" aria-live="polite">
        {activeItem
          ? `Pronto: ${activeItem.name}. Fai clic sulla mappa per collocare.`
          : 'Scegli un simbolo e fai clic sulla mappa.'}
      </p>

      <div
        role="group"
        aria-label="Libreria simboli POI"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--ui-space-2)'
        }}
      >
        {BUILTIN_POI_CATALOG.map((item) => {
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
    </div>
  );
}
