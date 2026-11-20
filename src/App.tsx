import { useEffect, useState } from 'react';
import { MapViewport } from './canvas/MapViewport';
import { createEmptyDocument } from './model/document';
import { PersistenceService } from './persistence';
import { EditorStore, attachEditorKeyboardListeners } from './state/editorStore';
import { TerrainRenderer, TerrainStrokeSession } from './terrain';
import { DialogsHost } from './ui/Dialogs';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { StatusBar } from './ui/StatusBar';
import { ToolRail } from './ui/ToolRail';
import { TopBar } from './ui/TopBar';

export interface MapEditorDebugHandle {
  store: EditorStore;
  getDocument: () => ReturnType<EditorStore['getDocument']>;
  simulateStorageQuotaError: () => void;
}

declare global {
  interface Window {
    __MAP_EDITOR_DEBUG__?: MapEditorDebugHandle;
  }
}

export default function App() {
  const [store, setStore] = useState<EditorStore | null>(null);

  useEffect(() => {
    let cancelled = false;

    const strokeSession = new TerrainStrokeSession();
    const renderer = new TerrainRenderer();
    const persistence = new PersistenceService({ debounceMs: 350 });

    const editorStore = new EditorStore({
      initialDocument: createEmptyDocument({ title: 'Nuova carta' }),
      strokeSession,
      renderer,
      persistence
    });

    setStore(editorStore);

    const detachKeyboard = attachEditorKeyboardListeners(editorStore);

    window.__MAP_EDITOR_DEBUG__ = {
      store: editorStore,
      getDocument: () => editorStore.getDocument(),
      simulateStorageQuotaError: () => {
        const internal = persistence as unknown as {
          setState?: (state: { status: 'error'; savedRevision: number; errorMessage: string }) => void;
        };
        if (typeof internal.setState === 'function') {
          internal.setState({
            status: 'error',
            savedRevision: editorStore.getSnapshot().persistenceState.savedRevision,
            errorMessage: 'Spazio locale esaurito. Scarica una copia del progetto.'
          });
        }
      }
    };

    void persistence
      .listProjects()
      .then(async (projects) => {
        if (cancelled || projects.length === 0) return;
        const currentDoc = editorStore.getDocument();
        if (currentDoc.manifest.revision > 0 || editorStore.getStrokeSession().isActive()) {
          return;
        }
        await editorStore.openLocalProject(projects[0].id);
      })
      .catch(() => {
        // IndexedDB non disponibile: mantiene la carta vuota in memoria
      });

    return () => {
      cancelled = true;
      detachKeyboard();
      if (window.__MAP_EDITOR_DEBUG__?.store === editorStore) {
        delete window.__MAP_EDITOR_DEBUG__;
      }
      editorStore.dispose();
      persistence.dispose();
      renderer.dispose();
    };
  }, []);

  if (!store) {
    return (
      <div className="editor-shell" aria-busy="true">
        <div
          style={{
            gridColumn: '1 / -1',
            gridRow: '1 / -1',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--ui-text)'
          }}
        >
          Preparazione del tavolo da disegno…
        </div>
      </div>
    );
  }

  return (
    <div className="editor-shell">
      <TopBar store={store} />
      <div className="editor-workspace">
        <ToolRail store={store} />
        <MapViewport store={store} />
        <PropertiesPanel store={store} />
      </div>
      <StatusBar store={store} />
      <DialogsHost store={store} />
    </div>
  );
}
