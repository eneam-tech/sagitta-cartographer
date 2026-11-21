import { useSyncExternalStore } from 'react';
import { COVER_MATERIALS, MapDocument } from '../model/document';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { inspectCellAtDoc } from '../terrain';
import type { BiomeKind } from '../terrain/types';
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

const COVER_LABEL_BY_CODE = new Map<number, string>(
  COVER_MATERIALS.map((m) => [m.code, m.label])
);

const BIOME_LABELS: Record<BiomeKind, string> = {
  sea: 'Acqua',
  beach: 'Spiaggia',
  plain: 'Pianura',
  hill: 'Collina',
  mountain: 'Montagna'
};

function InfoStatusIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11.2v4.8" />
      <path d="M12 8.1v.3" />
    </svg>
  );
}

function CursorTelemetry({ store, doc }: { store: EditorStore; doc: MapDocument }) {
  const cursorDoc = useSyncExternalStore(
    store.subscribeCursor,
    store.getCursorDoc,
    store.getCursorDoc
  );

  if (!cursorDoc) {
    return (
      <span className="statusbar-cursor-readout is-muted tabular-nums">
        (—, —) u
      </span>
    );
  }

  const xRound = Math.round(cursorDoc.x);
  const yRound = Math.round(cursorDoc.y);
  const cell = inspectCellAtDoc(doc, cursorDoc.x, cursorDoc.y);

  if (!cell) {
    return (
      <span className="statusbar-cursor-readout is-muted tabular-nums">
        ({xRound}, {yRound}) u · Fuori foglio
      </span>
    );
  }

  if (!cell.isLand) {
    return (
      <span
        className="statusbar-cursor-readout tabular-nums"
        title={`Coordinate (${xRound}, ${yRound}) u · Acqua`}
      >
        ({xRound}, {yRound}) u · Acqua
      </span>
    );
  }

  const coverLabel = COVER_LABEL_BY_CODE.get(cell.cover) ?? 'Naturale';
  const biomeLabel = BIOME_LABELS[cell.classification.biome] ?? 'Pianura';

  return (
    <span
      className="statusbar-cursor-readout tabular-nums"
      title={`Coordinate (${xRound}, ${yRound}) u · ${biomeLabel} · Quota ${cell.height}/255 · ${coverLabel}`}
    >
      ({xRound}, {yRound}) u · Quota {cell.height} · {coverLabel}
    </span>
  );
}

export function StatusBar({ store }: StatusBarProps) {
  const snap = useEditorStore(store);
  const { camera, doc, activeLayerId, persistenceState, statusNotice } = snap;
  const zoomPercent = Math.round(camera.scale * 100);
  const pageWidthMm = Math.round(doc.manifest.page.widthMm);
  const pageHeightMm = Math.round(doc.manifest.page.heightMm);
  const activeLayer = doc.manifest.layers.find((l) => l.id === activeLayerId);
  const activeLayerName = activeLayer?.name ?? doc.manifest.layers[0]?.name ?? 'Livello';

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
      const noticeIcon =
        statusNotice.tone === 'error' ? (
          <AlertErrorIcon size={18} className="statusbar-icon-error" />
        ) : statusNotice.tone === 'success' ? (
          <CheckSavedIcon size={18} className="statusbar-icon-success" />
        ) : (
          <InfoStatusIcon size={18} className="statusbar-icon-info" />
        );
      const noticeToneClass =
        statusNotice.tone === 'error'
          ? 'is-error'
          : statusNotice.tone === 'info'
            ? 'is-info'
            : 'is-muted';

      return (
        <>
          {noticeIcon}
          <span className={`statusbar-text ${noticeToneClass}`}>
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

    if (persistenceState.status === 'idle') {
      if (persistenceState.savedRevision > 0) {
        return (
          <>
            <CheckSavedIcon size={18} className="statusbar-icon-success" />
            <span className="statusbar-text">Salvato</span>
          </>
        );
      }
      return <span className="statusbar-text is-muted">Pronto</span>;
    }

    if (
      persistenceState.status === 'saved' &&
      persistenceState.savedRevision === doc.manifest.revision
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

      <div className="statusbar-telemetry" aria-label="Informazioni foglio, livello e cursore">
        <span className="statusbar-meta-chip tabular-nums">
          {pageWidthMm}×{pageHeightMm} mm
        </span>
        <span className="statusbar-meta-divider" aria-hidden="true" />
        <span className="statusbar-meta-chip statusbar-layer-chip" title={`Livello attivo: ${activeLayerName}`}>
          Livello: <strong className="statusbar-layer-name">{activeLayerName}</strong>
        </span>
        <span className="statusbar-meta-divider" aria-hidden="true" />
        <CursorTelemetry store={store} doc={doc} />
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
