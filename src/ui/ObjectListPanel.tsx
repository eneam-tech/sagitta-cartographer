import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { getCatalogItemById, svgToDataUrl } from '../assets/catalog';
import { MapObject } from '../model/document';
import {
  DeleteObjectCommand,
  commitObjectReorder,
  getDefaultObjectLabel
} from '../objects/objectCommands';
import { EditorStore, useEditorStore } from '../state/editorStore';

export interface ObjectListPanelProps {
  store: EditorStore;
}

const VIRTUAL_THRESHOLD = 200;
const PAGE_STEP = 100;

function ArrowUpSmallIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
    </svg>
  );
}

function ArrowDownSmallIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="m6.5 13.5 5.5 5.5 5.5-5.5" />
    </svg>
  );
}

function TrashSmallIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M7.5 7l.8 11.8a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9L16.5 7" />
    </svg>
  );
}

function ObjectThumb({ obj }: { obj: MapObject }) {
  if (obj.type === 'label') {
    return (
      <span
        aria-hidden="true"
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '3px',
          backgroundColor: 'var(--ui-bench)',
          border: '1px solid var(--ui-line-subtle)',
          color: 'var(--ui-text)',
          fontFamily: 'var(--ui-font-display)',
          fontSize: '13px',
          fontWeight: 600,
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
      >
        T
      </span>
    );
  }

  const catalogItem = getCatalogItemById(obj.assetId);
  return (
    <span
      aria-hidden="true"
      style={{
        width: '22px',
        height: '22px',
        borderRadius: '3px',
        backgroundColor: 'var(--ui-bench)',
        border: '1px solid var(--ui-line-subtle)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden'
      }}
    >
      {catalogItem ? (
        <img
          src={svgToDataUrl(catalogItem.svgContent)}
          alt=""
          width={18}
          height={18}
          draggable={false}
          style={{ display: 'block', pointerEvents: 'none' }}
        />
      ) : (
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ui-muted)' }}>P</span>
      )}
    </span>
  );
}

interface ObjectRowProps {
  obj: MapObject;
  docIndex: number;
  totalCount: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onBringForward: (obj: MapObject, docIndex: number) => void;
  onSendBackward: (obj: MapObject, docIndex: number) => void;
  onDelete: (obj: MapObject) => void;
  onKeyDownSelectBtn: (e: KeyboardEvent<HTMLButtonElement>, visibleIndex: number, obj: MapObject) => void;
  visibleIndex: number;
  registerRowButton: (index: number, el: HTMLButtonElement | null) => void;
}

function ObjectRow({
  obj,
  docIndex,
  totalCount,
  isSelected,
  onSelect,
  onBringForward,
  onSendBackward,
  onDelete,
  onKeyDownSelectBtn,
  visibleIndex,
  registerRowButton
}: ObjectRowProps) {
  const displayName = getDefaultObjectLabel(obj);
  const canMoveForward = docIndex < totalCount - 1;
  const canMoveBackward = docIndex > 0;

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        minHeight: '36px',
        padding: '0 2px 0 4px',
        backgroundColor: isSelected ? 'var(--ui-raised)' : 'transparent',
        border: `1px solid ${isSelected ? 'var(--ui-accent)' : 'transparent'}`,
        borderRadius: 'var(--ui-radius-control)'
      }}
    >
      <button
        ref={(el) => registerRowButton(visibleIndex, el)}
        type="button"
        aria-current={isSelected ? 'true' : undefined}
        aria-label={`${displayName} (${obj.type === 'stamp' ? 'POI' : 'Etichetta'})`}
        onClick={() => onSelect(obj.id)}
        onKeyDown={(e) => onKeyDownSelectBtn(e, visibleIndex, obj)}
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          minHeight: '36px',
          padding: '0 4px',
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--ui-radius-control)',
          color: 'var(--ui-text)',
          fontFamily: 'var(--ui-font-sans)',
          fontSize: '14px',
          lineHeight: '20px',
          fontWeight: isSelected ? 600 : 400,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          textAlign: 'left',
          cursor: 'pointer'
        }}
      >
        <ObjectThumb obj={obj} />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {displayName}
        </span>
      </button>

      <div style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={`Porta avanti ${displayName}`}
          title="Porta avanti"
          disabled={!canMoveForward}
          onClick={() => onBringForward(obj, docIndex)}
          style={{
            minHeight: '36px',
            minWidth: '28px',
            width: '28px',
            padding: 0
          }}
        >
          <ArrowUpSmallIcon />
        </button>

        <button
          type="button"
          className="btn btn-ghost"
          aria-label={`Porta indietro ${displayName}`}
          title="Porta indietro"
          disabled={!canMoveBackward}
          onClick={() => onSendBackward(obj, docIndex)}
          style={{
            minHeight: '36px',
            minWidth: '28px',
            width: '28px',
            padding: 0
          }}
        >
          <ArrowDownSmallIcon />
        </button>

        <button
          type="button"
          className="btn btn-ghost"
          aria-label={`Elimina ${displayName}`}
          title="Elimina"
          onClick={() => onDelete(obj)}
          style={{
            minHeight: '36px',
            minWidth: '28px',
            width: '28px',
            padding: 0,
            color: 'var(--ui-muted)'
          }}
        >
          <TrashSmallIcon />
        </button>
      </div>
    </li>
  );
}

/**
 * Foreground-first object z-order list with thumbnails, keyboard arrow navigation,
 * forward/backward/delete controls, and windowing for 2,000+ symbols.
 */
export function ObjectListPanel({ store }: ObjectListPanelProps) {
  const snap = useEditorStore(store);
  const objects = snap.doc.manifest.objects;
  const totalCount = objects.length;
  const selectedId = snap.selectedObjectId;

  const [visibleLimit, setVisibleLimit] = useState(PAGE_STEP);
  const rowBtnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (totalCount === 0) {
    return <p className="panel-empty-hint">Nessun oggetto sulla mappa.</p>;
  }

  const isVirtualized = totalCount > VIRTUAL_THRESHOLD;
  const effectiveLimit = isVirtualized ? Math.min(totalCount, visibleLimit) : totalCount;

  // Costruisce la finestra dall'alto (primo piano = objects[totalCount - 1]) verso il fondo
  const visibleEntries: Array<{ obj: MapObject; docIndex: number }> = [];
  for (let rank = 0; rank < effectiveLimit; rank += 1) {
    const docIndex = totalCount - 1 - rank;
    visibleEntries.push({ obj: objects[docIndex], docIndex });
  }

  const selectedDocIndex = selectedId ? objects.findIndex((o) => o.id === selectedId) : -1;
  const selectedRank = selectedDocIndex >= 0 ? totalCount - 1 - selectedDocIndex : -1;
  const pinnedSelectedOutsideWindow =
    isVirtualized && selectedDocIndex >= 0 && selectedRank >= effectiveLimit
      ? { obj: objects[selectedDocIndex], docIndex: selectedDocIndex, rank: selectedRank }
      : null;

  const handleBringForward = (obj: MapObject, docIndex: number) => {
    commitObjectReorder(store, obj.id, docIndex + 1, 'Porta avanti');
  };

  const handleSendBackward = (obj: MapObject, docIndex: number) => {
    commitObjectReorder(store, obj.id, docIndex - 1, 'Porta indietro');
  };

  const handleDelete = (obj: MapObject) => {
    store.executeCommand(
      new DeleteObjectCommand(
        obj.id,
        obj.type === 'stamp' ? 'Elimina simbolo' : 'Elimina etichetta'
      )
    );
  };

  const registerRowButton = (index: number, el: HTMLButtonElement | null) => {
    rowBtnRefs.current[index] = el;
  };

  const handleKeyDownSelectBtn = (
    e: KeyboardEvent<HTMLButtonElement>,
    visibleIndex: number,
    obj: MapObject
  ) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = rowBtnRefs.current[visibleIndex + 1];
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = rowBtnRefs.current[visibleIndex - 1];
      prev?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      rowBtnRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      rowBtnRefs.current[visibleEntries.length - 1]?.focus();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      handleDelete(obj);
    }
  };

  const remainingCount = totalCount - effectiveLimit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-2)' }}>
      {pinnedSelectedOutsideWindow ? (
        <div
          style={{
            paddingBottom: 'var(--ui-space-2)',
            borderBottom: '1px solid var(--ui-line-subtle)'
          }}
        >
          <div
            style={{
              fontSize: '12px',
              lineHeight: '16px',
              color: 'var(--ui-accent)',
              marginBottom: '4px'
            }}
          >
            Selezionato (#{pinnedSelectedOutsideWindow.rank + 1} su {totalCount})
          </div>
          <ul className="objects-fallback-list" aria-label="Oggetto selezionato">
            <ObjectRow
              obj={pinnedSelectedOutsideWindow.obj}
              docIndex={pinnedSelectedOutsideWindow.docIndex}
              totalCount={totalCount}
              isSelected={true}
              onSelect={(id) => store.selectObject(id)}
              onBringForward={handleBringForward}
              onSendBackward={handleSendBackward}
              onDelete={handleDelete}
              onKeyDownSelectBtn={handleKeyDownSelectBtn}
              visibleIndex={-1}
              registerRowButton={() => {}}
            />
          </ul>
        </div>
      ) : null}

      <ul className="objects-fallback-list" aria-label="Oggetti dal primo piano al fondo">
        {visibleEntries.map((entry, idx) => (
          <ObjectRow
            key={entry.obj.id}
            obj={entry.obj}
            docIndex={entry.docIndex}
            totalCount={totalCount}
            isSelected={entry.obj.id === selectedId}
            onSelect={(id) => store.selectObject(id)}
            onBringForward={handleBringForward}
            onSendBackward={handleSendBackward}
            onDelete={handleDelete}
            onKeyDownSelectBtn={handleKeyDownSelectBtn}
            visibleIndex={idx}
            registerRowButton={registerRowButton}
          />
        ))}
      </ul>

      {remainingCount > 0 ? (
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          onClick={() => setVisibleLimit((prev) => Math.min(totalCount, prev + PAGE_STEP))}
          style={{ width: '100%' }}
        >
          Mostra altri ({remainingCount} rimanenti)
        </button>
      ) : null}
    </div>
  );
}
