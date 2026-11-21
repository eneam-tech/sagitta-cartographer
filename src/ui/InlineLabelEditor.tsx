import { useEffect, useRef, useState } from 'react';
import { clampNumber, docToScreen } from '../model/coordinates';
import { resolveObjectLayerId } from '../model/document';
import {
  AddObjectCommand,
  commitObjectUpdate,
  createLabelObject
} from '../objects/objectCommands';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { getFontSpec } from '../theme/theme';

export interface InlineLabelEditorSession {
  mode: 'create' | 'edit';
  docX: number;
  docY: number;
  layerId?: string;
  objectId?: string;
  initialText: string;
  fontId: string;
  fontSize: number;
  color: string;
  rotationDeg: number;
  onEnd?: () => void;
}

export interface InlineLabelEditorProps {
  store: EditorStore;
  session: InlineLabelEditorSession | null;
  onClose: () => void;
}

/**
 * Commits an inline label creation or edit against `store` after verifying that
 * the target layer is still visible and unlocked. Returns false if blocked.
 */
export function commitInlineLabelSession(
  store: EditorStore,
  session: InlineLabelEditorSession,
  rawDraft: string
): boolean {
  const currentDoc = store.getDocument();
  const finalText = rawDraft.trim();

  if (session.mode === 'create') {
    const targetLayerId = session.layerId ?? store.resolveTargetLayerIdForNewObject('label');
    if (!store.isLayerEditable(targetLayerId)) {
      store.setStatusNotice({
        tone: 'info',
        text: 'Il livello selezionato è bloccato o nascosto.'
      });
      return false;
    }
    if (finalText.length > 0) {
      const labelObj = createLabelObject(
        finalText,
        session.docX,
        session.docY,
        currentDoc.theme,
        undefined,
        {
          layerId: targetLayerId,
          fontId: session.fontId,
          fontSize: session.fontSize,
          color: session.color,
          rotationDeg: session.rotationDeg
        }
      );
      store.executeCommand(
        new AddObjectCommand(labelObj, undefined, undefined, 'Aggiungi etichetta')
      );
      store.selectObject(labelObj.id);
    }
    return true;
  }

  if (session.mode === 'edit' && session.objectId) {
    const existing = currentDoc.manifest.objects.find((o) => o.id === session.objectId);
    if (existing && existing.type === 'label') {
      const targetLayerId = resolveObjectLayerId(existing, currentDoc.manifest.layers);
      if (!store.isLayerEditable(targetLayerId)) {
        store.setStatusNotice({
          tone: 'info',
          text: 'Il livello selezionato è bloccato o nascosto.'
        });
        return false;
      }
      if (finalText.length > 0 && finalText !== existing.text) {
        commitObjectUpdate(
          store,
          existing,
          { ...existing, text: finalText },
          'Modifica etichetta'
        );
      }
    }
  }
  return true;
}

/**
 * HTML inline text editor anchored at exact screen coordinates via `docToScreen`.
 * Commits a single AddObjectCommand or UpdateObjectCommand on Enter/blur and cancels
 * cleanly on Escape without modifying history.
 */
export function InlineLabelEditor({ store, session, onClose }: InlineLabelEditorProps) {
  const snap = useEditorStore(store);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);
  const [draft, setDraft] = useState(session?.initialText ?? '');

  useEffect(() => {
    if (!session) return;
    settledRef.current = false;
    setDraft(session.initialText);

    const rafId =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(() => {
            const input = inputRef.current;
            if (!input) return;
            input.focus();
            if (session.initialText.length > 0) {
              input.select();
            }
          })
        : null;

    return () => {
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      session.onEnd?.();
    };
  }, [session]);

  if (!session) {
    return null;
  }

  const screenPos = docToScreen(session.docX, session.docY, snap.camera);
  const spec = getFontSpec(snap.doc.theme, session.fontId);
  const screenFontPx = clampNumber(session.fontSize * snap.camera.scale, 13, 76);

  const finishClose = () => {
    session.onEnd?.();
    onClose();
  };

  const handleCommit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    commitInlineLabelSession(store, session, draft);
    finishClose();
  };

  const handleCancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    finishClose();
  };

  const maxViewportW = snap.viewportSize.width > 0 ? snap.viewportSize.width : 800;
  const clampedLeft = clampNumber(screenPos.x, 8, Math.max(8, maxViewportW - 220));
  const clampedTop = Math.max(8, screenPos.y);

  return (
    <input
      ref={inputRef}
      type="text"
      data-inline-label-editor="true"
      aria-label={session.mode === 'create' ? 'Nuova etichetta sulla carta' : 'Modifica etichetta'}
      placeholder="Nome luogo…"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={handleCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          handleCommit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          handleCancel();
        }
      }}
      style={{
        position: 'absolute',
        left: `${clampedLeft}px`,
        top: `${clampedTop}px`,
        transform: session.rotationDeg !== 0 ? `rotate(${session.rotationDeg}deg)` : undefined,
        transformOrigin: 'top left',
        zIndex: 25,
        minWidth: '180px',
        maxWidth: '380px',
        padding: '4px 8px',
        backgroundColor: 'rgba(23, 35, 45, 0.94)',
        color: 'var(--ui-text)',
        border: '2px solid var(--ui-focus)',
        borderRadius: 'var(--ui-radius-control)',
        boxShadow: '0 8px 22px rgba(8, 13, 18, 0.6)',
        fontFamily: spec.family,
        fontWeight: spec.weight,
        fontStyle: spec.italic ? 'italic' : 'normal',
        fontSize: `${screenFontPx}px`,
        lineHeight: 1.2,
        outline: '2px solid var(--ui-focus)',
        outlineOffset: '2px'
      }}
    />
  );
}
