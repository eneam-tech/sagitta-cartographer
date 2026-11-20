import { EditorStore, useEditorStore } from '../state/editorStore';
import {
  AlertErrorIcon,
  CheckSavedIcon,
  CloseIcon,
  FitViewIcon,
  ZoomInIcon,
  ZoomOutIcon
} from './icons';

export interface StatusBarProps {
  store: EditorStore;
}

export function StatusBar({ store }: StatusBarProps) {
  const snap = useEditorStore(store);
  const { camera, doc, persistenceState, statusNotice } = snap;
  const zoomPercent = Math.round(camera.scale * 100);

  const renderLeftStatus = () => {
    if (persistenceState.status === 'error') {
      return (
        <>
          <AlertErrorIcon size={18} className="statusbar-icon-error" />
          <span className="statusbar-text is-error">
            {persistenceState.errorMessage || 'Spazio locale esaurito. Scarica una copia del progetto.'}
          </span>
          <button
            type="button"
            className="statusbar-action-link"
            onClick={() => void store.downloadArchive()}
          >
            Scarica progetto
          </button>
        </>
      );
    }

    if (persistenceState.status === 'conflict') {
      return (
        <>
          <AlertErrorIcon size={18} className="statusbar-icon-error" />
          <span className="statusbar-text is-error">
            Modifica rilevata in un’altra scheda.
          </span>
          <button
            type="button"
            className="statusbar-action-link"
            onClick={() => void store.saveAsCopyOnConflict()}
          >
            Salva come copia
          </button>
        </>
      );
    }

    if (statusNotice) {
      return (
        <>
          {statusNotice.tone === 'error' ? (
            <AlertErrorIcon size={18} className="statusbar-icon-error" />
          ) : (
            <CheckSavedIcon size={18} className="statusbar-icon-success" />
          )}
          <span
            className={`statusbar-text ${
              statusNotice.tone === 'error' ? 'is-error' : 'is-muted'
            }`}
          >
            {statusNotice.text}
          </span>
          <button
            type="button"
            className="statusbar-btn has-tooltip-top"
            aria-label="Chiudi avviso"
            data-tooltip="Chiudi avviso"
            onClick={() => store.setStatusNotice(null)}
          >
            <CloseIcon size={16} />
          </button>
        </>
      );
    }

    if (persistenceState.status === 'saving') {
      return <span className="statusbar-text is-muted">Salvataggio…</span>;
    }

    if (
      (persistenceState.status === 'saved' &&
        persistenceState.savedRevision === doc.manifest.revision) ||
      (persistenceState.status === 'idle' && doc.manifest.revision === 0)
    ) {
      return (
        <>
          <CheckSavedIcon size={18} className="statusbar-icon-success" />
          <span className="statusbar-text">Salvato</span>
        </>
      );
    }

    return <span className="statusbar-text is-muted">Salvataggio…</span>;
  };

  return (
    <footer className="editor-statusbar" aria-label="Barra di stato e controlli vista">
      <div className="statusbar-left" role="status" aria-live="polite">
        {renderLeftStatus()}
      </div>

      <div className="statusbar-right" role="group" aria-label="Controlli della camera">
        <button
          type="button"
          className="statusbar-btn has-tooltip-top"
          aria-label="Riduci zoom"
          data-tooltip="Riduci zoom"
          onClick={() => store.zoomOut()}
        >
          <ZoomOutIcon size={18} />
        </button>

        <span className="statusbar-zoom-readout" aria-label={`Zoom ${zoomPercent} percento`}>
          {zoomPercent}%
        </span>

        <button
          type="button"
          className="statusbar-btn has-tooltip-top"
          aria-label="Aumenta zoom"
          data-tooltip="Aumenta zoom"
          onClick={() => store.zoomIn()}
        >
          <ZoomInIcon size={18} />
        </button>

        <button
          type="button"
          className="statusbar-btn has-tooltip-top"
          aria-label="Adatta alla finestra"
          data-tooltip="Adatta la carta alla finestra"
          onClick={() => store.fitCamera()}
        >
          <FitViewIcon size={18} />
          <span className="statusbar-fit-label">Adatta</span>
        </button>
      </div>
    </footer>
  );
}
