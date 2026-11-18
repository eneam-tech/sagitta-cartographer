import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { EditorStore, useEditorStore } from '../state/editorStore';
import {
  ChevronDownIcon,
  ExportPdfIcon,
  ProjectIcon,
  PropertiesIcon,
  RedoIcon,
  UndoIcon
} from './icons';

export interface TopBarProps {
  store: EditorStore;
}

export function TopBar({ store }: TopBarProps) {
  const snap = useEditorStore(store);
  const { doc, canUndo, canRedo, nextUndoLabel, nextRedoLabel, propertiesDrawerOpen } = snap;

  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(doc.manifest.title);

  const projectMenuWrapRef = useRef<HTMLDivElement>(null);
  const projectBtnRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const initialTitleRef = useRef(doc.manifest.title);
  const canceledTitleRef = useRef(false);

  // Sincronizza il titolo mostrato su undo/redo o cambio documento quando l'input non è attivo
  useEffect(() => {
    if (!isEditingTitle) {
      setDraftTitle(doc.manifest.title);
    }
  }, [doc.manifest.title, isEditingTitle]);

  // Chiude il menu Progetto cliccando fuori o premendo Esc
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (projectMenuWrapRef.current && !projectMenuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
        projectBtnRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [menuOpen]);

  // Sposta il focus sul primo elemento quando si apre il menu da tastiera
  useEffect(() => {
    if (menuOpen) {
      requestAnimationFrame(() => {
        menuItemRefs.current[0]?.focus();
      });
    }
  }, [menuOpen]);

  const handleMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const commitTitle = () => {
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      setDraftTitle(doc.manifest.title);
      return;
    }
    setDraftTitle(trimmed);
    store.setTitle(trimmed);
  };

  const handleTitleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    canceledTitleRef.current = false;
    commitTitle();
    titleInputRef.current?.blur();
  };

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      canceledTitleRef.current = true;
      setDraftTitle(initialTitleRef.current);
      titleInputRef.current?.blur();
    }
  };

  const handleImportChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const buf = await file.arrayBuffer();
    await store.importArchiveFile(new Uint8Array(buf));
  };

  return (
    <header className="editor-topbar" aria-label="Barra degli strumenti superiore">
      <div className="topbar-left">
        <div className="topbar-project-wrap" ref={projectMenuWrapRef}>
          <button
            ref={projectBtnRef}
            type="button"
            className="btn btn-secondary"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls="project-menu-dropdown"
            aria-label="Menu progetto"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <ProjectIcon size={20} />
            <span className="topbar-btn-label">Progetto</span>
            <ChevronDownIcon size={18} />
          </button>

          {menuOpen ? (
            <div
              id="project-menu-dropdown"
              className="dropdown-menu"
              role="menu"
              aria-label="Azioni sul progetto"
              onKeyDown={handleMenuKeyDown}
            >
              <button
                ref={(el) => {
                  menuItemRefs.current[0] = el;
                }}
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  projectBtnRef.current?.focus();
                  setMenuOpen(false);
                  store.openDialog('newProject');
                }}
              >
                <span>Nuova carta</span>
              </button>
              <button
                ref={(el) => {
                  menuItemRefs.current[1] = el;
                }}
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  projectBtnRef.current?.focus();
                  setMenuOpen(false);
                  store.openDialog('openProject');
                }}
              >
                <span>Apri locale…</span>
              </button>
              <div className="dropdown-divider" role="separator" />
              <button
                ref={(el) => {
                  menuItemRefs.current[2] = el;
                }}
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  setMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <span>Importa archivio (.zip)…</span>
              </button>
              <button
                ref={(el) => {
                  menuItemRefs.current[3] = el;
                }}
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  projectBtnRef.current?.focus();
                  setMenuOpen(false);
                  void store.downloadArchive();
                }}
              >
                <span>Scarica progetto (.zip)</span>
              </button>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            tabIndex={-1}
            aria-hidden="true"
            style={{ display: 'none' }}
            onChange={(e) => void handleImportChange(e)}
          />
        </div>

        <form className="topbar-title-form" onSubmit={handleTitleSubmit}>
          <input
            ref={titleInputRef}
            type="text"
            className="topbar-title-input"
            aria-label="Titolo della carta"
            value={draftTitle}
            maxLength={120}
            onFocus={() => {
              initialTitleRef.current = doc.manifest.title;
              canceledTitleRef.current = false;
              setIsEditingTitle(true);
            }}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            onBlur={() => {
              setIsEditingTitle(false);
              if (!canceledTitleRef.current) {
                commitTitle();
              }
              canceledTitleRef.current = false;
            }}
          />
        </form>
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className="btn btn-ghost has-tooltip-bottom"
          disabled={!canUndo}
          aria-label={nextUndoLabel ? `Annulla: ${nextUndoLabel}` : 'Annulla'}
          data-tooltip={nextUndoLabel ? `Annulla: ${nextUndoLabel} (Ctrl/Cmd+Z)` : 'Annulla (Ctrl/Cmd+Z)'}
          onClick={() => store.undo()}
        >
          <UndoIcon size={20} />
          <span className="topbar-btn-label">Annulla</span>
        </button>

        <button
          type="button"
          className="btn btn-ghost has-tooltip-bottom"
          disabled={!canRedo}
          aria-label={nextRedoLabel ? `Ripristina: ${nextRedoLabel}` : 'Ripristina'}
          data-tooltip={
            nextRedoLabel
              ? `Ripristina: ${nextRedoLabel} (Ctrl/Cmd+Shift+Z)`
              : 'Ripristina (Ctrl/Cmd+Shift+Z)'
          }
          onClick={() => store.redo()}
        >
          <RedoIcon size={20} />
          <span className="topbar-btn-label">Ripristina</span>
        </button>

        <button
          type="button"
          className="btn btn-secondary topbar-props-toggle has-tooltip-bottom"
          aria-expanded={propertiesDrawerOpen}
          aria-controls="editor-properties-panel"
          aria-label="Apri o chiudi pannello proprietà"
          data-tooltip="Proprietà"
          onClick={() => store.togglePropertiesDrawer()}
        >
          <PropertiesIcon size={20} />
          <span className="topbar-btn-label">Proprietà</span>
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => store.openDialog('exportPdf')}
        >
          <ExportPdfIcon size={20} />
          <span>Esporta PDF</span>
        </button>
      </div>
    </header>
  );
}
