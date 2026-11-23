import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { MAP_THEMES, MapTheme } from '../theme/theme';
import {
  CheckSavedIcon,
  ChevronDownIcon,
  ExportPdfIcon,
  GenerateWorldIcon,
  ProjectIcon,
  PropertiesIcon,
  RedoIcon,
  ResizeCanvasIcon,
  ShortcutsIcon,
  UndoIcon
} from './icons';

export interface TopBarProps {
  store: EditorStore;
}

function getThemePreviewDots(theme: MapTheme): [string, string, string] {
  const accent =
    theme.id === 'vulcanica'
      ? theme.colors.lava
      : theme.id === 'regni-del-nord'
        ? theme.colors.settlement
        : theme.colors.forest;
  return [theme.colors.sea, theme.colors.land, accent];
}

export function TopBar({ store }: TopBarProps) {
  const snap = useEditorStore(store);
  const { doc, canUndo, canRedo, nextUndoLabel, nextRedoLabel, propertiesDrawerOpen } = snap;

  const [menuOpen, setMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(doc.manifest.title);

  const projectMenuWrapRef = useRef<HTMLDivElement>(null);
  const projectBtnRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const themeMenuWrapRef = useRef<HTMLDivElement>(null);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const themeItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const initialTitleRef = useRef(doc.manifest.title);
  const canceledTitleRef = useRef(false);
  const importPickerPendingRef = useRef(false);

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
        const hadFocusInside =
          document.activeElement instanceof Node &&
          projectMenuWrapRef.current.contains(document.activeElement);
        setMenuOpen(false);
        if (hadFocusInside) {
          requestAnimationFrame(() => {
            if (!document.activeElement || document.activeElement === document.body) {
              projectBtnRef.current?.focus();
            }
          });
        }
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

  // Chiude il menu Tema cliccando fuori o premendo Esc
  useEffect(() => {
    if (!themeMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (themeMenuWrapRef.current && !themeMenuWrapRef.current.contains(e.target as Node)) {
        const hadFocusInside =
          document.activeElement instanceof Node &&
          themeMenuWrapRef.current.contains(document.activeElement);
        setThemeMenuOpen(false);
        if (hadFocusInside) {
          requestAnimationFrame(() => {
            if (!document.activeElement || document.activeElement === document.body) {
              themeBtnRef.current?.focus();
            }
          });
        }
      }
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setThemeMenuOpen(false);
        themeBtnRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [themeMenuOpen]);

  // Restituisce il focus al pulsante Progetto se il file picker viene annullato
  useEffect(() => {
    const input = fileInputRef.current;
    let cancelTimer: ReturnType<typeof setTimeout> | null = null;

    const restoreFocusIfSafe = () => {
      const active = document.activeElement;
      if (!active || active === document.body || active === input) {
        projectBtnRef.current?.focus();
      }
    };

    const handleCancel = () => {
      importPickerPendingRef.current = false;
      restoreFocusIfSafe();
    };

    const handleWindowFocus = () => {
      if (!importPickerPendingRef.current) return;
      if (cancelTimer !== null) clearTimeout(cancelTimer);
      cancelTimer = setTimeout(() => {
        if (importPickerPendingRef.current) {
          importPickerPendingRef.current = false;
          restoreFocusIfSafe();
        }
      }, 150);
    };

    input?.addEventListener('cancel', handleCancel);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      if (cancelTimer !== null) clearTimeout(cancelTimer);
      input?.removeEventListener('cancel', handleCancel);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, []);

  // Sposta il focus sul primo elemento quando si apre il menu Progetto
  useEffect(() => {
    if (menuOpen) {
      requestAnimationFrame(() => {
        menuItemRefs.current[0]?.focus();
      });
    }
  }, [menuOpen]);

  // Sposta il focus sul tema corrente quando si apre il menu Tema
  useEffect(() => {
    if (themeMenuOpen) {
      requestAnimationFrame(() => {
        const activeIdx = MAP_THEMES.findIndex((t) => t.id === doc.theme.id);
        themeItemRefs.current[activeIdx >= 0 ? activeIdx : 0]?.focus();
      });
    }
  }, [themeMenuOpen, doc.theme.id]);

  const handleDropdownKeyDown = (
    e: KeyboardEvent<HTMLDivElement>,
    refs: Array<HTMLButtonElement | null>
  ) => {
    const items = refs.filter((el): el is HTMLButtonElement => el !== null);
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
    importPickerPendingRef.current = false;
    const file = e.target.files?.[0];
    e.target.value = '';
    try {
      if (!file) return;
      const buf = await file.arrayBuffer();
      await store.importArchiveFile(new Uint8Array(buf));
    } finally {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active === fileInputRef.current) {
          projectBtnRef.current?.focus();
        }
      });
    }
  };

  const pageWidthMm = Math.round(doc.manifest.page.widthMm);
  const pageHeightMm = Math.round(doc.manifest.page.heightMm);
  const activeTheme = doc.theme;
  const activeDots = getThemePreviewDots(activeTheme);

  return (
    <header className="editor-topbar" aria-label="Barra degli strumenti superiore">
      <div className="topbar-left">
        <div className="topbar-project-wrap" ref={projectMenuWrapRef}>
          <button
            ref={projectBtnRef}
            type="button"
            className="btn btn-secondary has-tooltip-bottom has-tooltip-bottom-start"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls="project-menu-dropdown"
            aria-label="Menu progetto"
            data-tooltip="Menu progetto"
            onClick={() => {
              setThemeMenuOpen(false);
              setMenuOpen((prev) => !prev);
            }}
          >
            <ProjectIcon size={20} />
            <span className="topbar-btn-label">Progetto</span>
            <ChevronDownIcon size={18} className="topbar-project-chevron" />
          </button>

          {menuOpen ? (
            <div
              id="project-menu-dropdown"
              className="dropdown-menu"
              role="menu"
              aria-label="Azioni sul progetto"
              onKeyDown={(e) => handleDropdownKeyDown(e, menuItemRefs.current)}
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
              <button
                ref={(el) => {
                  menuItemRefs.current[2] = el;
                }}
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  projectBtnRef.current?.focus();
                  setMenuOpen(false);
                  store.openDialog('resizeCanvas');
                }}
              >
                <span>Ridimensiona tela…</span>
                <span className="dropdown-item-meta tabular-nums">
                  {pageWidthMm}×{pageHeightMm}
                </span>
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
                  store.openDialog('generateWorld');
                }}
              >
                <span>Genera continente…</span>
              </button>
              <div className="dropdown-divider" role="separator" />
              <button
                ref={(el) => {
                  menuItemRefs.current[4] = el;
                }}
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  importPickerPendingRef.current = true;
                  setMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <span>Importa archivio (.zip)…</span>
              </button>
              <button
                ref={(el) => {
                  menuItemRefs.current[5] = el;
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
              <div className="dropdown-divider" role="separator" />
              <button
                ref={(el) => {
                  menuItemRefs.current[6] = el;
                }}
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  projectBtnRef.current?.focus();
                  setMenuOpen(false);
                  store.openDialog('shortcuts');
                }}
              >
                <span>Scorciatoie da tastiera</span>
                <span className="dropdown-item-meta">?</span>
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
          <span className="topbar-btn-label topbar-hide-medium">Annulla</span>
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
          <span className="topbar-btn-label topbar-hide-medium">Ripristina</span>
        </button>

        <button
          type="button"
          className="btn btn-secondary topbar-generate-btn has-tooltip-bottom"
          aria-label="Genera continente procedurale"
          data-tooltip="Genera continente"
          onClick={() => store.openDialog('generateWorld')}
        >
          <GenerateWorldIcon size={18} />
          <span className="topbar-generate-label">Genera…</span>
        </button>

        <button
          type="button"
          className="btn btn-secondary topbar-canvas-btn has-tooltip-bottom"
          aria-label={`Tela ${pageWidthMm} per ${pageHeightMm} millimetri. Ridimensiona tela`}
          data-tooltip={`Tela ${pageWidthMm}×${pageHeightMm} mm`}
          onClick={() => store.openDialog('resizeCanvas')}
        >
          <ResizeCanvasIcon size={18} />
          <span className="topbar-canvas-label tabular-nums">
            {pageWidthMm}×{pageHeightMm} mm
          </span>
        </button>

        {/* Selettore dei 5 temi cartografici con 3 pallini cromatici */}
        <div className="topbar-theme-wrap" ref={themeMenuWrapRef}>
          <button
            ref={themeBtnRef}
            type="button"
            className="btn btn-secondary topbar-theme-btn topbar-theme-select has-tooltip-bottom"
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
            aria-controls="theme-menu-dropdown"
            aria-label={`Tema della carta: ${activeTheme.name}`}
            data-tooltip={`Tema: ${activeTheme.name}`}
            onClick={() => {
              setMenuOpen(false);
              setThemeMenuOpen((prev) => !prev);
            }}
          >
            <span className="theme-dots-row" aria-hidden="true">
              {activeDots.map((hex, i) => (
                <span key={i} className="theme-dot" style={{ backgroundColor: hex }} />
              ))}
            </span>
            <span className="topbar-theme-label">{activeTheme.name}</span>
            <ChevronDownIcon size={16} className="topbar-theme-chevron" />
          </button>

          {themeMenuOpen ? (
            <div
              id="theme-menu-dropdown"
              className="dropdown-menu dropdown-menu--right"
              role="menu"
              aria-label="Seleziona tema della carta"
              onKeyDown={(e) => handleDropdownKeyDown(e, themeItemRefs.current)}
            >
              {MAP_THEMES.map((theme, idx) => {
                const isSelected = doc.theme.id === theme.id;
                const dots = getThemePreviewDots(theme);
                return (
                  <button
                    key={theme.id}
                    ref={(el) => {
                      themeItemRefs.current[idx] = el;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    className={`dropdown-item ${isSelected ? 'is-active' : ''}`}
                    onClick={() => {
                      store.setTheme(theme);
                      themeBtnRef.current?.focus();
                      setThemeMenuOpen(false);
                    }}
                  >
                    <span className="theme-menu-item-main">
                      <span className="theme-dots-row" aria-hidden="true">
                        {dots.map((hex, i) => (
                          <span key={i} className="theme-dot" style={{ backgroundColor: hex }} />
                        ))}
                      </span>
                      <span className="theme-menu-item-name">{theme.name}</span>
                    </span>
                    {isSelected ? <CheckSavedIcon size={16} className="theme-menu-check" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-icon-only topbar-shortcuts-btn has-tooltip-bottom"
          aria-label="Scorciatoie da tastiera (?)"
          data-tooltip="Scorciatoie (?)"
          onClick={() => store.openDialog('shortcuts')}
        >
          <ShortcutsIcon size={20} />
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
          className="btn btn-primary topbar-export-btn"
          aria-label="Esporta PDF"
          onClick={() => store.openDialog('exportPdf')}
        >
          <ExportPdfIcon size={20} />
          <span className="topbar-export-full">Esporta PDF</span>
          <span className="topbar-export-short">PDF</span>
        </button>
      </div>
    </header>
  );
}
