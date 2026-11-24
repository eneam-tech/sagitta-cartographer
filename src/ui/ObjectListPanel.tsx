import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { getCatalogItemById, svgToDataUrl } from '../assets/catalog';
import { MapObject, resolveObjectLayerId } from '../model/document';
import {
  DeleteObjectCommand,
  commitObjectReorderInLayer,
  getDefaultObjectLabel,
  getDeleteObjectLabel
} from '../objects/objectCommands';
import { EditorStore, useEditorStore } from '../state/editorStore';

export interface ObjectListPanelProps {
  store: EditorStore;
}

const VIRTUAL_THRESHOLD = 200;
const PAGE_STEP = 100;

export interface ObjectListRowKeyCallbacks {
  onDelete: () => void;
  onFocusPrev?: () => void;
  onFocusNext?: () => void;
  onFocusFirst?: () => void;
  onFocusLast?: () => void;
}

/**
 * Handles keyboard navigation and deletion on an ObjectListPanel row button.
 * Calls both `preventDefault()` and `stopPropagation()` on Delete/Backspace so
 * the global window handler does not delete a second object.
 */
export function handleObjectListItemKeyDown(
  e: Pick<KeyboardEvent<HTMLElement>, 'key' | 'preventDefault' | 'stopPropagation'>,
  callbacks: ObjectListRowKeyCallbacks
): boolean {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    callbacks.onFocusNext?.();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    callbacks.onFocusPrev?.();
    return true;
  }
  if (e.key === 'Home') {
    e.preventDefault();
    callbacks.onFocusFirst?.();
    return true;
  }
  if (e.key === 'End') {
    e.preventDefault();
    callbacks.onFocusLast?.();
    return true;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    e.stopPropagation();
    callbacks.onDelete();
    return true;
  }
  return false;
}

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

  if (obj.type === 'path') {
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
          flexShrink: 0
        }}
      >
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke={obj.color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={obj.dashed ? '4 3' : undefined}
        >
          <path d="M4 17c4-8 8-8 10 0s4 2 6-9" />
        </svg>
      </span>
    );
  }

  if (obj.type === 'building') {
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
          flexShrink: 0
        }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <rect
            x="4"
            y="6"
            width="16"
            height="12"
            rx="1"
            fill={obj.roofColor}
            stroke="currentColor"
            strokeWidth={1.6}
          />
          <path d="M4 6l4.5 6L4 18M20 6l-4.5 6L20 18M8.5 12h7" stroke="#17232D" strokeWidth={1.4} />
        </svg>
      </span>
    );
  }

  if (obj.type === 'plaza') {
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
          flexShrink: 0
        }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <rect
            x="4"
            y="4"
            width="16"
            height="16"
            rx={obj.shape === 'circle' ? '8' : '2'}
            fill={obj.fillColor}
            stroke={obj.borderColor || 'currentColor'}
            strokeWidth={1.75}
          />
          <circle cx="12" cy="12" r="2.8" fill="currentColor" opacity="0.65" />
        </svg>
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
        <span style={{ fontSize: '13px', lineHeight: '18px', fontWeight: 600, color: 'var(--ui-muted)' }}>
          P
        </span>
      )}
    </span>
  );
}

interface ObjectRowProps {
  obj: MapObject;
  canMoveForwardInLayer: boolean;
  canMoveBackwardInLayer: boolean;
  isSelected: boolean;
  layerName: string;
  layerEditable: boolean;
  onSelect: (id: string) => void;
  onBringForward: (obj: MapObject) => void;
  onSendBackward: (obj: MapObject) => void;
  onDelete: (obj: MapObject) => void;
  onKeyDownSelectBtn: (e: KeyboardEvent<HTMLButtonElement>, visibleIndex: number, obj: MapObject) => void;
  visibleIndex: number;
  registerRowButton: (index: number, el: HTMLButtonElement | null) => void;
}

function ObjectRow({
  obj,
  canMoveForwardInLayer,
  canMoveBackwardInLayer,
  isSelected,
  layerName,
  layerEditable,
  onSelect,
  onBringForward,
  onSendBackward,
  onDelete,
  onKeyDownSelectBtn,
  visibleIndex,
  registerRowButton
}: ObjectRowProps) {
  const displayName = getDefaultObjectLabel(obj);
  const kindLabel =
    obj.type === 'stamp'
      ? 'POI'
      : obj.type === 'label'
        ? 'Etichetta'
        : obj.type === 'building'
          ? 'Edificio'
          : obj.type === 'plaza'
            ? 'Piazza'
            : 'Tracciato';
  const canMoveForward = layerEditable && canMoveForwardInLayer;
  const canMoveBackward = layerEditable && canMoveBackwardInLayer;

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        minHeight: '44px',
        padding: '3px 2px 3px 4px',
        backgroundColor: isSelected ? 'var(--ui-raised)' : 'transparent',
        border: `1px solid ${isSelected ? 'var(--ui-accent)' : 'transparent'}`,
        borderRadius: 'var(--ui-radius-control)',
        opacity: layerEditable ? 1 : 0.72
      }}
    >
      <button
        ref={(el) => registerRowButton(visibleIndex, el)}
        type="button"
        aria-current={isSelected ? 'true' : undefined}
        aria-label={`${displayName} (${kindLabel}, livello ${layerName})`}
        onClick={() => onSelect(obj.id)}
        onKeyDown={(e) => onKeyDownSelectBtn(e, visibleIndex, obj)}
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          minHeight: '36px',
          padding: '2px 4px',
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--ui-radius-control)',
          color: 'var(--ui-text)',
          fontFamily: 'var(--ui-font-sans)',
          fontSize: '15px',
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
            flex: '1 1 auto',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '2px'
          }}
        >
          <span
            style={{
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={displayName}
          >
            {displayName}
          </span>
          <span
            title={`Livello: ${layerName}`}
            style={{
              fontSize: '13px',
              lineHeight: '18px',
              fontWeight: 400,
              color: 'var(--ui-muted)',
              backgroundColor: 'rgba(23, 35, 45, 0.55)',
              border: '1px solid var(--ui-line-subtle)',
              borderRadius: 'var(--ui-radius-control)',
              padding: '0 6px',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {layerName}
          </span>
        </span>
      </button>

      <div style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
        <button
          type="button"
          className="btn btn-ghost has-tooltip-top"
          aria-label={`Porta avanti ${displayName}`}
          data-tooltip="Porta avanti"
          disabled={!canMoveForward}
          onClick={() => onBringForward(obj)}
          style={{
            minHeight: '36px',
            minWidth: '36px',
            width: '36px',
            height: '36px',
            padding: 0
          }}
        >
          <ArrowUpSmallIcon />
        </button>

        <button
          type="button"
          className="btn btn-ghost has-tooltip-top"
          aria-label={`Porta indietro ${displayName}`}
          data-tooltip="Porta indietro"
          disabled={!canMoveBackward}
          onClick={() => onSendBackward(obj)}
          style={{
            minHeight: '36px',
            minWidth: '36px',
            width: '36px',
            height: '36px',
            padding: 0
          }}
        >
          <ArrowDownSmallIcon />
        </button>

        <button
          type="button"
          className="btn btn-ghost has-tooltip-top"
          aria-label={`Elimina ${displayName}`}
          data-tooltip="Elimina"
          disabled={!layerEditable}
          onClick={() => onDelete(obj)}
          style={{
            minHeight: '36px',
            minWidth: '36px',
            width: '36px',
            height: '36px',
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

interface VisualObjectEntry {
  obj: MapObject;
  canMoveForwardInLayer: boolean;
  canMoveBackwardInLayer: boolean;
}

/**
 * Foreground-first object z-order list matching Canvas and PDF visual stacking
 * (`[...nonTerrainLayers].reverse()`, then objects within each layer from front
 * to back), with two-line rows, layer badges, same-layer reordering, keyboard
 * navigation, and windowing for 2,000+ symbols.
 */
export function ObjectListPanel({ store }: ObjectListPanelProps) {
  const snap = useEditorStore(store);
  const objects = snap.doc.manifest.objects;
  const layers = snap.doc.manifest.layers;
  const totalCount = objects.length;
  const selectedId = snap.selectedObjectId;

  const [visibleLimit, setVisibleLimit] = useState(PAGE_STEP);
  const rowBtnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (totalCount === 0) {
    return <p className="panel-empty-hint">Nessun oggetto sulla mappa.</p>;
  }

  const layerById = new Map(layers.map((l) => [l.id, l]));
  const bucketsByLayer = new Map<string, MapObject[]>();
  for (const obj of objects) {
    const resolvedId = resolveObjectLayerId(obj, layers);
    let bucket = bucketsByLayer.get(resolvedId);
    if (!bucket) {
      bucket = [];
      bucketsByLayer.set(resolvedId, bucket);
    }
    bucket.push(obj);
  }

  // Costruisce la pila visiva effettiva dall'alto verso il basso (coerente con Canvas e PDF)
  const visualOrder: VisualObjectEntry[] = [];
  const nonTerrainLayers = layers.filter((l) => l.kind !== 'terrain');
  for (let li = nonTerrainLayers.length - 1; li >= 0; li -= 1) {
    const bucket = bucketsByLayer.get(nonTerrainLayers[li].id);
    if (!bucket || bucket.length === 0) continue;
    for (let bi = bucket.length - 1; bi >= 0; bi -= 1) {
      visualOrder.push({
        obj: bucket[bi],
        canMoveForwardInLayer: bi < bucket.length - 1,
        canMoveBackwardInLayer: bi > 0
      });
    }
  }

  const getLayerMeta = (obj: MapObject) => {
    const resolvedId = resolveObjectLayerId(obj, layers);
    const layer = layerById.get(resolvedId);
    return {
      layerName: layer?.name ?? 'Oggetti',
      layerEditable: layer ? layer.visible && !layer.locked : true
    };
  };

  const isVirtualized = visualOrder.length > VIRTUAL_THRESHOLD;
  const effectiveLimit = isVirtualized
    ? Math.min(visualOrder.length, visibleLimit)
    : visualOrder.length;
  const visibleEntries = visualOrder.slice(0, effectiveLimit);

  const selectedRank = selectedId ? visualOrder.findIndex((e) => e.obj.id === selectedId) : -1;
  const pinnedSelectedOutsideWindow =
    isVirtualized && selectedRank >= effectiveLimit
      ? { entry: visualOrder[selectedRank], rank: selectedRank }
      : null;

  const handleBringForward = (obj: MapObject) => {
    if (!getLayerMeta(obj).layerEditable) return;
    commitObjectReorderInLayer(store, obj.id, 'forward');
  };

  const handleSendBackward = (obj: MapObject) => {
    if (!getLayerMeta(obj).layerEditable) return;
    commitObjectReorderInLayer(store, obj.id, 'backward');
  };

  const handleDelete = (obj: MapObject) => {
    if (!getLayerMeta(obj).layerEditable) return;
    store.executeCommand(
      new DeleteObjectCommand(obj.id, getDeleteObjectLabel(obj))
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
    handleObjectListItemKeyDown(e, {
      onFocusNext: () => rowBtnRefs.current[visibleIndex + 1]?.focus(),
      onFocusPrev: () => rowBtnRefs.current[visibleIndex - 1]?.focus(),
      onFocusFirst: () => rowBtnRefs.current[0]?.focus(),
      onFocusLast: () => rowBtnRefs.current[visibleEntries.length - 1]?.focus(),
      onDelete: () => handleDelete(obj)
    });
  };

  const remainingCount = visualOrder.length - effectiveLimit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-2)' }}>
      {pinnedSelectedOutsideWindow ? (
        (() => {
          const meta = getLayerMeta(pinnedSelectedOutsideWindow.entry.obj);
          return (
            <div
              style={{
                paddingBottom: 'var(--ui-space-2)',
                borderBottom: '1px solid var(--ui-line-subtle)'
              }}
            >
              <div
                style={{
                  fontSize: '13px',
                  lineHeight: '18px',
                  color: 'var(--ui-accent)',
                  marginBottom: '4px'
                }}
              >
                Selezionato (#{pinnedSelectedOutsideWindow.rank + 1} su {visualOrder.length})
              </div>
              <ul className="objects-fallback-list" aria-label="Oggetto selezionato">
                <ObjectRow
                  obj={pinnedSelectedOutsideWindow.entry.obj}
                  canMoveForwardInLayer={pinnedSelectedOutsideWindow.entry.canMoveForwardInLayer}
                  canMoveBackwardInLayer={pinnedSelectedOutsideWindow.entry.canMoveBackwardInLayer}
                  isSelected={true}
                  layerName={meta.layerName}
                  layerEditable={meta.layerEditable}
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
          );
        })()
      ) : null}

      <ul className="objects-fallback-list" aria-label="Oggetti dal primo piano al fondo">
        {visibleEntries.map((entry, idx) => {
          const meta = getLayerMeta(entry.obj);
          return (
            <ObjectRow
              key={entry.obj.id}
              obj={entry.obj}
              canMoveForwardInLayer={entry.canMoveForwardInLayer}
              canMoveBackwardInLayer={entry.canMoveBackwardInLayer}
              isSelected={entry.obj.id === selectedId}
              layerName={meta.layerName}
              layerEditable={meta.layerEditable}
              onSelect={(id) => store.selectObject(id)}
              onBringForward={handleBringForward}
              onSendBackward={handleSendBackward}
              onDelete={handleDelete}
              onKeyDownSelectBtn={handleKeyDownSelectBtn}
              visibleIndex={idx}
              registerRowButton={registerRowButton}
            />
          );
        })}
      </ul>

      {remainingCount > 0 ? (
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          onClick={() => setVisibleLimit((prev) => Math.min(visualOrder.length, prev + PAGE_STEP))}
          style={{ width: '100%' }}
        >
          Mostra altri ({remainingCount} rimanenti)
        </button>
      ) : null}
    </div>
  );
}
