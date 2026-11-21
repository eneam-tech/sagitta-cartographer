import { PATH_KIND_OPTIONS } from '../objects/objectCommands';
import { PathColorControls, SyncedRangeField } from '../objects/uiControls';
import { EditorStore, useEditorStore } from '../state/editorStore';

export interface PathToolPanelProps {
  store: EditorStore;
}

/**
 * Vector path tool configuration panel: 4 preset path styles (`Fiume`, `Strada`,
 * `Confine`, `Inchiostro libero`), stroke width (`2–60 u`), theme color swatches +
 * custom color picker, smooth/tapered/dashed toggles, live stroke preview, and
 * active target layer readout.
 */
export function PathToolPanel({ store }: PathToolPanelProps) {
  const snap = useEditorStore(store);
  const {
    doc,
    pathKind,
    pathStrokeWidthDoc,
    pathColor,
    pathSmooth,
    pathDashed,
    pathTapered
  } = snap;

  const targetLayerId = store.resolveTargetLayerIdForNewObject('path');
  const targetLayer = doc.manifest.layers.find((l) => l.id === targetLayerId);
  const targetEditable = store.isLayerEditable(targetLayerId);

  const previewStroke = Math.min(22, Math.max(2, pathStrokeWidthDoc * 0.45));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-3)' }}>
      <p className="panel-hint">
        Trascina sulla mappa per disegnare un tracciato vettoriale modificabile.
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
          Livello attivo:{' '}
          <strong style={{ color: 'var(--ui-text)' }}>
            {targetLayer?.name ?? 'Fiumi e Strade'}
          </strong>
        </span>
        {!targetEditable ? <span style={{ flexShrink: 0 }}>Bloccato</span> : null}
      </div>

      {/* Selettore 4 stili */}
      <div className="form-field">
        <span className="field-label">Stile tracciato</span>
        <div className="segmented-group" role="group" aria-label="Stile tracciato">
          {PATH_KIND_OPTIONS.map((opt) => {
            const isActive = pathKind === opt.kind;
            return (
              <button
                key={opt.kind}
                type="button"
                className="segmented-btn"
                aria-pressed={isActive}
                onClick={() => store.setPathKind(opt.kind)}
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

      {/* Anteprima visiva del tratto */}
      <div className="swatch-frame" aria-hidden="true">
        <svg
          className="swatch-svg"
          viewBox="0 0 240 56"
          style={{ backgroundColor: doc.theme.colors.land }}
        >
          {pathTapered ? (
            <>
              <path
                d={pathSmooth ? 'M 18 36 Q 82 14, 128 28' : 'M 18 36 L 128 28'}
                fill="none"
                stroke={pathColor}
                strokeWidth={Math.max(1.5, previewStroke * 0.45)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={pathSmooth ? 'M 128 28 Q 174 42, 222 20' : 'M 128 28 L 222 20'}
                fill="none"
                stroke={pathColor}
                strokeWidth={Math.max(2, previewStroke * 1.05)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : (
            <path
              d={pathSmooth ? 'M 18 36 Q 82 14, 128 28 T 222 20' : 'M 18 36 L 128 28 L 222 20'}
              fill="none"
              stroke={pathColor}
              strokeWidth={previewStroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={pathDashed ? `${Math.max(6, previewStroke * 2)} ${Math.max(4, previewStroke * 1.4)}` : undefined}
            />
          )}
        </svg>
        <div className="swatch-caption">
          <span>Anteprima tratto</span>
          <span className="tabular-nums">{pathStrokeWidthDoc} u</span>
        </div>
      </div>

      {/* Spessore 2–60 u */}
      <SyncedRangeField
        label="Spessore"
        value={pathStrokeWidthDoc}
        min={2}
        max={60}
        step={0.5}
        unit="u"
        onChange={(val) => store.setPathStrokeWidthDoc(val)}
      />

      {/* Swatch tema + picker custom */}
      <PathColorControls
        theme={doc.theme}
        color={pathColor}
        onChangeColor={(hex) => store.setPathColor(hex)}
      />

      {/* Opzioni geometria e stile */}
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
            cursor: 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={pathSmooth}
            onChange={(e) => store.setPathSmooth(e.target.checked)}
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
            cursor: 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={pathTapered}
            onChange={(e) => store.setPathTapered(e.target.checked)}
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
            cursor: 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={pathDashed}
            onChange={(e) => store.setPathDashed(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: 'var(--ui-accent)' }}
          />
          <span>Tratteggiato</span>
        </label>
      </div>
    </div>
  );
}
