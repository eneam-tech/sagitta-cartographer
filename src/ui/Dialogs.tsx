import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode, RefObject } from 'react';
import {
  MAX_PAGE_MM,
  MIN_PAGE_MM,
  PAGE_PRESETS,
  PageSizeMm
} from '../model/coordinates';
import { SavedProjectSummary } from '../persistence/types';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { MAP_THEMES, MapTheme, getBuiltinThemeById } from '../theme/theme';
import { ResizeCanvasDialog } from './ResizeCanvasDialog';
import { AlertErrorIcon, CloseIcon } from './icons';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])'
].join(',');

export interface ModalDialogProps {
  title: string;
  isErrorTitle?: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  footer?: ReactNode;
}

export function ModalDialog({
  title,
  isErrorTitle = false,
  onClose,
  initialFocusRef,
  children,
  footer
}: ModalDialogProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const rafId = requestAnimationFrame(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
      }
      const firstBodyControl = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (firstBodyControl) {
        firstBodyControl.focus();
        return;
      }
      const firstFooterControl = footerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (firstFooterControl) {
        firstFooterControl.focus();
        return;
      }
      const fallback = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      fallback?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !cardRef.current) return;

      const focusables = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first || !cardRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (!active || active === last || !cardRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocusRef.current && previousFocusRef.current.isConnected) {
        previousFocusRef.current.focus();
      }
    };
  }, [initialFocusRef]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={cardRef}
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-header">
          <h2 id={titleId} className={`dialog-title ${isErrorTitle ? 'is-error' : ''}`}>
            {isErrorTitle ? <AlertErrorIcon size={22} /> : null}
            <span>{title}</span>
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon-only has-tooltip-bottom"
            aria-label="Chiudi finestra"
            data-tooltip="Chiudi (Esc)"
            onClick={onClose}
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div ref={bodyRef} className="dialog-body">
          {children}
        </div>

        {footer ? (
          <div ref={footerRef} className="dialog-footer">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Nuovo progetto                                                             */
/* -------------------------------------------------------------------------- */

function NewProjectDialog({ store }: { store: EditorStore }) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleFieldId = useId();
  const customWId = useId();
  const customHId = useId();

  const [title, setTitle] = useState('Nuova carta');
  const [presetId, setPresetId] = useState<string>(PAGE_PRESETS[0].id);
  const [customWidthMm, setCustomWidthMm] = useState('297');
  const [customHeightMm, setCustomHeightMm] = useState('210');
  const [themeId, setThemeId] = useState<string>(MAP_THEMES[0].id);
  const [error, setError] = useState<string | null>(null);

  const selectedTheme: MapTheme = getBuiltinThemeById(themeId) ?? MAP_THEMES[0];

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Inserisci un titolo per la carta.');
      return;
    }

    let page: PageSizeMm;
    if (presetId === 'custom') {
      const w = Number(customWidthMm);
      const h = Number(customHeightMm);
      if (
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w < MIN_PAGE_MM ||
        w > MAX_PAGE_MM ||
        h < MIN_PAGE_MM ||
        h > MAX_PAGE_MM
      ) {
        setError(
          `Inserisci dimensioni comprese tra ${MIN_PAGE_MM} e ${MAX_PAGE_MM} mm.`
        );
        return;
      }
      page = { widthMm: Math.round(w), heightMm: Math.round(h) };
    } else {
      const preset = PAGE_PRESETS.find((p) => p.id === presetId) ?? PAGE_PRESETS[0];
      page = { ...preset.page };
    }

    setError(null);
    store.newProject({ title: cleanTitle, page, theme: selectedTheme });
  };

  return (
    <ModalDialog
      title="Nuova carta"
      onClose={() => store.closeDialog()}
      initialFocusRef={titleInputRef}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => store.closeDialog()}
          >
            Annulla
          </button>
          <button type="submit" form="new-project-form" className="btn btn-primary">
            Crea carta
          </button>
        </>
      }
    >
      <form id="new-project-form" onSubmit={handleSubmit} className="panel-group">
        <div className="form-field">
          <label className="field-label" htmlFor={titleFieldId}>
            Titolo del progetto
          </label>
          <input
            ref={titleInputRef}
            id={titleFieldId}
            type="text"
            className="text-input"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <fieldset className="form-field" style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>
            Formato della pagina
          </legend>
          <div className="preset-list">
            {PAGE_PRESETS.map((preset) => (
              <label
                key={preset.id}
                className={`preset-option ${presetId === preset.id ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="pagePreset"
                  value={preset.id}
                  checked={presetId === preset.id}
                  onChange={() => {
                    setPresetId(preset.id);
                    setError(null);
                  }}
                />
                <span>{preset.label}</span>
              </label>
            ))}

            <label
              className={`preset-option ${presetId === 'custom' ? 'is-selected' : ''}`}
            >
              <input
                type="radio"
                name="pagePreset"
                value="custom"
                checked={presetId === 'custom'}
                onChange={() => {
                  setPresetId('custom');
                  setError(null);
                }}
              />
              <span>Misure personalizzate (50–2000 mm)</span>
            </label>
          </div>
        </fieldset>

        {presetId === 'custom' ? (
          <div className="form-row-2">
            <div className="form-field">
              <label className="field-label" htmlFor={customWId}>
                Larghezza (mm)
              </label>
              <input
                id={customWId}
                type="number"
                className="text-input tabular-nums"
                min={MIN_PAGE_MM}
                max={MAX_PAGE_MM}
                value={customWidthMm}
                onChange={(e) => setCustomWidthMm(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor={customHId}>
                Altezza (mm)
              </label>
              <input
                id={customHId}
                type="number"
                className="text-input tabular-nums"
                min={MIN_PAGE_MM}
                max={MAX_PAGE_MM}
                value={customHeightMm}
                onChange={(e) => setCustomHeightMm(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        <fieldset className="form-field" style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>
            Tema cartografico iniziale
          </legend>
          <div className="theme-preset-grid">
            {MAP_THEMES.map((theme) => {
              const isSelected = themeId === theme.id;
              const accentColor =
                theme.id === 'vulcanica' ? theme.colors.lava : theme.colors.forest;
              return (
                <label
                  key={theme.id}
                  className={`theme-preset-card ${isSelected ? 'is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="initialTheme"
                    value={theme.id}
                    checked={isSelected}
                    onChange={() => setThemeId(theme.id)}
                    style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
                  />
                  <span className="theme-dots-row" aria-hidden="true">
                    <span className="theme-dot" style={{ backgroundColor: theme.colors.sea }} />
                    <span className="theme-dot" style={{ backgroundColor: theme.colors.land }} />
                    <span className="theme-dot" style={{ backgroundColor: accentColor }} />
                  </span>
                  <span className="theme-preset-name">{theme.name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </ModalDialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Apri progetto locale                                                       */
/* -------------------------------------------------------------------------- */

function OpenProjectDialog({ store }: { store: EditorStore }) {
  const snap = useEditorStore(store);
  const [projects, setProjects] = useState<SavedProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    store
      .listProjects()
      .then((list) => {
        if (!cancelled) {
          setProjects(list);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Impossibile leggere i progetti locali.'
          );
          setProjects([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const handleOpen = async (id: string) => {
    await store.openLocalProject(id);
  };

  const handleDelete = async (id: string) => {
    await store.deleteLocalProject(id);
    setConfirmDeleteId(null);
    const refreshed = await store.listProjects();
    setProjects(refreshed);
  };

  return (
    <ModalDialog
      title="Apri progetto locale"
      onClose={() => store.closeDialog()}
      footer={
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => store.closeDialog()}
        >
          Chiudi
        </button>
      }
    >
      {loadError ? (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      ) : null}

      {projects === null ? (
        <p className="panel-hint">Caricamento delle carte salvate…</p>
      ) : projects.length === 0 ? (
        <p className="panel-empty-hint">
          Nessun progetto salvato localmente in questo browser.
        </p>
      ) : (
        <ul className="project-list">
          {projects.map((p) => {
            const isCurrent = p.id === snap.doc.manifest.id;
            const dateStr = new Date(p.updatedAt).toLocaleString('it-IT', {
              dateStyle: 'short',
              timeStyle: 'short'
            });
            return (
              <li key={p.id} className="project-row">
                <div className="project-row-info">
                  <p className="project-row-title">
                    {p.title} {isCurrent ? '(aperto)' : ''}
                  </p>
                  <p className="project-row-meta tabular-nums">
                    {p.page.widthMm} × {p.page.heightMm} mm · rev. {p.revision} · {dateStr}
                  </p>
                </div>
                <div className="project-row-actions">
                  {confirmDeleteId === p.id ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() => void handleDelete(p.id)}
                      >
                        Conferma
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Annulla
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        onClick={() => void handleOpen(p.id)}
                      >
                        Apri
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        aria-label={`Elimina ${p.title}`}
                        onClick={() => setConfirmDeleteId(p.id)}
                      >
                        Elimina
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ModalDialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Errore salvataggio / Quota esaurita                                        */
/* -------------------------------------------------------------------------- */

function StorageErrorDialog({ store }: { store: EditorStore }) {
  const snap = useEditorStore(store);
  const downloadBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <ModalDialog
      title="Errore di salvataggio"
      isErrorTitle
      onClose={() => store.closeDialog()}
      initialFocusRef={downloadBtnRef}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => store.closeDialog()}
          >
            Chiudi
          </button>
          <button
            ref={downloadBtnRef}
            type="button"
            className="btn btn-primary"
            onClick={() => void store.downloadArchive()}
          >
            Scarica progetto
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        Spazio locale esaurito. Scarica una copia del progetto.
      </p>
      {snap.persistenceState.errorMessage &&
      snap.persistenceState.errorMessage !==
        'Spazio locale esaurito. Scarica una copia del progetto.' ? (
        <p className="panel-hint">{snap.persistenceState.errorMessage}</p>
      ) : null}
    </ModalDialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Conflitto tra schede                                                       */
/* -------------------------------------------------------------------------- */

function ConflictDialog({ store }: { store: EditorStore }) {
  const saveCopyBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <ModalDialog
      title="Conflitto tra schede"
      isErrorTitle
      onClose={() => store.closeDialog()}
      initialFocusRef={saveCopyBtnRef}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => store.closeDialog()}
          >
            Chiudi
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void store.downloadArchive()}
          >
            Scarica progetto
          </button>
          <button
            ref={saveCopyBtnRef}
            type="button"
            className="btn btn-primary"
            onClick={() => void store.saveAsCopyOnConflict()}
          >
            Salva come copia
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        Questo progetto è stato modificato in un’altra scheda del browser. Salva la versione
        corrente come copia indipendente per evitare sovrascritture.
      </p>
    </ModalDialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Guida alle scorciatoie da tastiera (?)                                     */
/* -------------------------------------------------------------------------- */

const SHORTCUT_GROUPS: ReadonlyArray<{
  title: string;
  items: ReadonlyArray<{ keys: string; label: string }>;
}> = [
  {
    title: 'Strumenti cartografici',
    items: [
      { keys: 'L / B', label: 'Terra' },
      { keys: 'W', label: 'Acqua' },
      { keys: 'E', label: 'Rilievo (Alza / Abbassa / Appiattisci / Ammorbidisci)' },
      { keys: 'C', label: 'Superfici (10 materiali)' },
      { keys: 'R', label: 'Fiumi e Strade' },
      { keys: 'P', label: 'Simboli (POI)' },
      { keys: 'T', label: 'Testo (etichette)' },
      { keys: 'V', label: 'Seleziona' },
      { keys: 'H / Spazio', label: 'Mano (spostamento vista)' }
    ]
  },
  {
    title: 'Pennello, oggetti e cronologia',
    items: [
      { keys: '[ / ]', label: 'Riduci / Aumenta diametro pennello' },
      { keys: 'Ctrl/Cmd + Z', label: 'Annulla ultima modifica' },
      { keys: 'Ctrl/Cmd + Shift + Z', label: 'Ripristina modifica' },
      { keys: 'Canc', label: 'Elimina oggetto selezionato' },
      { keys: 'Esc', label: 'Annulla gesto / Deseleziona / Chiudi finestra' },
      { keys: '?', label: 'Apri questa guida alle scorciatoie' }
    ]
  }
];

function ShortcutsDialog({ store }: { store: EditorStore }) {
  const closeFooterRef = useRef<HTMLButtonElement>(null);

  return (
    <ModalDialog
      title="Scorciatoie da tastiera"
      onClose={() => store.closeDialog()}
      initialFocusRef={closeFooterRef}
      footer={
        <button
          ref={closeFooterRef}
          type="button"
          className="btn btn-primary"
          onClick={() => store.closeDialog()}
        >
          Chiudi
        </button>
      }
    >
      <p className="panel-hint">
        Le scorciatoie restano inattive mentre digiti all’interno di campi di testo o etichette.
      </p>

      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} className="panel-group" style={{ gap: 'var(--ui-space-2)' }}>
          <h3 className="panel-subheading">{group.title}</h3>
          <dl className="shortcuts-list">
            {group.items.map((item) => (
              <div key={item.keys} className="shortcuts-row">
                <dt className="shortcuts-label">{item.label}</dt>
                <dd className="shortcuts-keys">
                  <kbd className="shortcut-kbd">{item.keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </ModalDialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Host unificato dialoghi                                                    */
/* -------------------------------------------------------------------------- */

export interface DialogsHostProps {
  store: EditorStore;
  exportPdfDialogSlot?: ReactNode;
}

export function DialogsHost({ store, exportPdfDialogSlot }: DialogsHostProps) {
  const snap = useEditorStore(store);
  const { activeDialog, doc } = snap;

  if (!activeDialog) return null;

  if (activeDialog === 'newProject') {
    return <NewProjectDialog store={store} />;
  }
  if (activeDialog === 'openProject') {
    return <OpenProjectDialog store={store} />;
  }
  if (activeDialog === 'resizeCanvas') {
    return <ResizeCanvasDialog store={store} />;
  }
  if (activeDialog === 'shortcuts') {
    return <ShortcutsDialog store={store} />;
  }
  if (activeDialog === 'storageError') {
    return <StorageErrorDialog store={store} />;
  }
  if (activeDialog === 'conflict') {
    return <ConflictDialog store={store} />;
  }
  if (activeDialog === 'exportPdf') {
    if (exportPdfDialogSlot) {
      return <>{exportPdfDialogSlot}</>;
    }
    return (
      <ModalDialog
        title="Esporta PDF"
        onClose={() => store.closeDialog()}
        footer={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => store.closeDialog()}
          >
            Chiudi
          </button>
        }
      >
        <p style={{ margin: 0 }}>
          Formato della carta: {doc.manifest.page.widthMm} × {doc.manifest.page.heightMm} mm.
        </p>
        <p className="panel-hint">
          Il modulo di composizione PDF verrà collegato all’integrazione finale dell’editor.
        </p>
      </ModalDialog>
    );
  }

  return null;
}
