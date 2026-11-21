import { useEffect, useRef, useState } from 'react';
import {
  AddLayerCommand,
  DeleteLayerCommand,
  ReorderLayersCommand,
  UpdateLayerCommand
} from '../model/commands';
import { clampNumber } from '../model/coordinates';
import {
  DEFAULT_LAYER_TERRAIN_ID,
  MapLayer,
  cloneMapLayer,
  resolveObjectLayerId,
  safeRandomUUID
} from '../model/document';
import { EditorStore, useEditorStore } from '../state/editorStore';

export interface LayersPanelProps {
  store: EditorStore;
}

function EyeOpenIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 3.5 20.5 20.5" />
      <path d="M9.9 6.3A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.3 4.1" />
      <path d="M6.4 8.2C4.1 9.9 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.9-.3 4.1-.9" />
    </svg>
  );
}

function LockClosedIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5.5" y="11" width="13" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 1 1 7 0v3" />
    </svg>
  );
}

function LockOpenIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5.5" y="11" width="13" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 6.7-1.4" />
    </svg>
  );
}

function ArrowUpIcon() {
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

function ArrowDownIcon() {
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

function PencilIcon() {
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
      <path d="M15.5 4.5 19.5 8.5 8.5 19.5H4.5v-4l11-11Z" />
      <path d="m13.2 6.8 4 4" />
    </svg>
  );
}

function TrashIcon() {
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

function LayerOpacitySlider({
  layer,
  onCommitOpacity
}: {
  layer: MapLayer;
  onCommitOpacity: (layer: MapLayer, nextOpacity: number) => void;
}) {
  const serverPct = Math.round(clampNumber(layer.opacity, 0, 1) * 100);
  const [draftPct, setDraftPct] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const dragStartLayerRef = useRef<MapLayer>(layer);

  useEffect(() => {
    if (!draggingRef.current) {
      setDraftPct(null);
    }
  }, [serverPct, layer.id]);

  const displayPct = draftPct !== null ? draftPct : serverPct;

  const finishDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const targetPct = draftPct ?? serverPct;
    setDraftPct(null);
    const nextOpacity = Number(clampNumber(targetPct / 100, 0, 1).toFixed(2));
    if (Math.abs(nextOpacity - dragStartLayerRef.current.opacity) >= 0.005) {
      onCommitOpacity(dragStartLayerRef.current, nextOpacity);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--ui-space-2)'
      }}
    >
      <span
        style={{
          fontSize: '13px',
          lineHeight: '18px',
          color: 'var(--ui-muted)',
          flexShrink: 0
        }}
      >
        Opacità
      </span>
      <input
        type="range"
        className="range-input"
        aria-label={`Opacità livello ${layer.name} (%)`}
        min={0}
        max={100}
        step={1}
        value={displayPct}
        onPointerDown={() => {
          draggingRef.current = true;
          dragStartLayerRef.current = cloneMapLayer(layer);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onBlur={finishDrag}
        onChange={(e) => {
          const nextPct = clampNumber(Number(e.target.value), 0, 100);
          if (!Number.isFinite(nextPct)) return;
          if (draggingRef.current) {
            setDraftPct(nextPct);
          } else {
            const nextOpacity = Number((nextPct / 100).toFixed(2));
            if (Math.abs(nextOpacity - layer.opacity) >= 0.005) {
              onCommitOpacity(layer, nextOpacity);
            }
          }
        }}
        style={{ flex: '1 1 auto', minWidth: 0 }}
      />
      <span
        className="tabular-nums"
        style={{
          fontSize: '13px',
          lineHeight: '18px',
          color: 'var(--ui-text)',
          minWidth: '38px',
          textAlign: 'right',
          flexShrink: 0
        }}
      >
        {displayPct}%
      </span>
    </div>
  );
}

/**
 * Top-to-bottom visual layer stack panel with active target selection, visibility/lock
 * toggles, per-layer opacity (`0–100%`), reorder guards protecting `layer-terrain`
 * at the base, inline renaming, object counts, and `+ Nuovo livello`.
 */
export function LayersPanel({ store }: LayersPanelProps) {
  const snap = useEditorStore(store);
  const layers = snap.doc.manifest.layers;
  const activeLayerId = snap.activeLayerId;

  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameCancelledRef = useRef(false);
  const renameSkipBlurRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingLayerId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingLayerId]);

  const countsByLayer = new Map<string, number>();
  for (const obj of snap.doc.manifest.objects) {
    const lid = resolveObjectLayerId(obj, layers);
    countsByLayer.set(lid, (countsByLayer.get(lid) ?? 0) + 1);
  }

  const terrainIdx = layers.findIndex(
    (l) => l.kind === 'terrain' || l.id === DEFAULT_LAYER_TERRAIN_ID
  );
  const nonTerrainLayers = layers.filter((l) => l.kind !== 'terrain');
  const visualLayers = [...layers].reverse();

  const handleAddLayer = () => {
    const customCount = layers.filter((l) => l.kind === 'custom').length + 1;
    const newLayer: MapLayer = {
      id: `layer-${safeRandomUUID()}`,
      name: `Livello ${customCount}`,
      kind: 'custom',
      visible: true,
      locked: false,
      opacity: 1
    };
    store.executeCommand(new AddLayerCommand(newLayer, undefined, 'Nuovo livello'));
    store.setActiveLayerId(newLayer.id);
  };

  const handleToggleVisible = (layer: MapLayer) => {
    store.executeCommand(
      new UpdateLayerCommand(
        layer,
        { ...layer, visible: !layer.visible },
        layer.visible ? 'Nascondi livello' : 'Mostra livello'
      )
    );
  };

  const handleToggleLocked = (layer: MapLayer) => {
    store.executeCommand(
      new UpdateLayerCommand(
        layer,
        { ...layer, locked: !layer.locked },
        layer.locked ? 'Sblocca livello' : 'Blocca livello'
      )
    );
  };

  const handleCommitOpacity = (layer: MapLayer, nextOpacity: number) => {
    store.executeCommand(
      new UpdateLayerCommand(
        layer,
        { ...layer, opacity: nextOpacity },
        'Opacità livello'
      )
    );
  };

  const handleMoveLayer = (docIndex: number, delta: 1 | -1) => {
    const targetIndex = docIndex + delta;
    if (targetIndex < 0 || targetIndex >= layers.length) return;
    if (layers[docIndex].kind === 'terrain' || layers[targetIndex].kind === 'terrain') return;
    if (terrainIdx >= 0 && targetIndex <= terrainIdx) return;

    const nextOrder = layers.map(cloneMapLayer);
    const [moved] = nextOrder.splice(docIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);
    store.executeCommand(new ReorderLayersCommand(layers, nextOrder, 'Riordina livelli'));
  };

  const beginRename = (layer: MapLayer) => {
    renameCancelledRef.current = false;
    renameSkipBlurRef.current = false;
    setEditingLayerId(layer.id);
    setRenameDraft(layer.name);
  };

  const commitRename = (layer: MapLayer) => {
    const trimmed = renameDraft.trim();
    setEditingLayerId(null);
    if (!trimmed || trimmed === layer.name) return;
    store.executeCommand(
      new UpdateLayerCommand(layer, { ...layer, name: trimmed }, 'Rinomina livello')
    );
  };

  const handleDeleteLayer = (layer: MapLayer) => {
    if (layer.kind === 'terrain' || layer.id === DEFAULT_LAYER_TERRAIN_ID) return;
    if (nonTerrainLayers.length <= 1) return;
    const fallback = nonTerrainLayers.find((l) => l.id !== layer.id);
    store.executeCommand(
      new DeleteLayerCommand(layer.id, {
        fallbackLayerId: fallback?.id,
        label: `Elimina livello ${layer.name}`
      })
    );
    if (fallback && snap.activeLayerId === layer.id) {
      store.setActiveLayerId(fallback.id);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-3)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--ui-space-2)'
        }}
      >
        <p className="panel-hint">Dall’alto verso il basso</p>
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          onClick={handleAddLayer}
        >
          + Nuovo livello
        </button>
      </div>

      <ul className="objects-fallback-list" aria-label="Livelli della carta">
        {visualLayers.map((layer, visualIdx) => {
          const docIndex = layers.length - 1 - visualIdx;
          const isTerrain =
            layer.kind === 'terrain' || layer.id === DEFAULT_LAYER_TERRAIN_ID;
          const isActive = layer.id === activeLayerId;
          const isRenaming = editingLayerId === layer.id;
          const objectCount = isTerrain ? 0 : (countsByLayer.get(layer.id) ?? 0);
          const canMoveUp = !isTerrain && docIndex < layers.length - 1;
          const canMoveDown =
            !isTerrain && (terrainIdx >= 0 ? docIndex > terrainIdx + 1 : docIndex > 0);
          const canDelete = !isTerrain && nonTerrainLayers.length > 1;

          return (
            <li
              key={layer.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--ui-space-1)',
                padding: 'var(--ui-space-2)',
                backgroundColor: isActive ? 'var(--ui-raised)' : 'rgba(23, 35, 45, 0.35)',
                border: `1px solid ${isActive ? 'var(--ui-accent)' : 'var(--ui-line-subtle)'}`,
                borderRadius: 'var(--ui-radius-control)'
              }}
            >
              {/* Riga principale: Visibilità, Blocco, Nome/Selezione, Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                <button
                  type="button"
                  className="btn btn-ghost has-tooltip-top"
                  aria-pressed={layer.visible}
                  aria-label={
                    layer.visible
                      ? `Nascondi livello ${layer.name}`
                      : `Mostra livello ${layer.name}`
                  }
                  data-tooltip={layer.visible ? 'Nascondi' : 'Mostra'}
                  onClick={() => handleToggleVisible(layer)}
                  style={{
                    minWidth: '36px',
                    minHeight: '36px',
                    width: '36px',
                    height: '36px',
                    padding: 0,
                    color: layer.visible ? 'var(--ui-text)' : 'var(--ui-muted)',
                    opacity: layer.visible ? 1 : 0.6
                  }}
                >
                  {layer.visible ? <EyeOpenIcon /> : <EyeClosedIcon />}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost has-tooltip-top"
                  aria-pressed={layer.locked}
                  aria-label={
                    layer.locked
                      ? `Sblocca livello ${layer.name}`
                      : `Blocca livello ${layer.name}`
                  }
                  data-tooltip={layer.locked ? 'Sblocca' : 'Blocca'}
                  onClick={() => handleToggleLocked(layer)}
                  style={{
                    minWidth: '36px',
                    minHeight: '36px',
                    width: '36px',
                    height: '36px',
                    padding: 0,
                    color: layer.locked ? 'var(--ui-accent)' : 'var(--ui-muted)'
                  }}
                >
                  {layer.locked ? <LockClosedIcon /> : <LockOpenIcon />}
                </button>

                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    className="text-input"
                    aria-label={`Nome livello ${layer.name}`}
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => {
                      if (renameCancelledRef.current || renameSkipBlurRef.current) {
                        renameCancelledRef.current = false;
                        renameSkipBlurRef.current = false;
                        return;
                      }
                      commitRename(layer);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        renameSkipBlurRef.current = true;
                        commitRename(layer);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        renameCancelledRef.current = true;
                        setEditingLayerId(null);
                      }
                    }}
                    style={{ flex: '1 1 auto', minWidth: 0 }}
                  />
                ) : (
                  <button
                    type="button"
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => store.setActiveLayerId(layer.id)}
                    onDoubleClick={() => beginRename(layer)}
                    style={{
                      flex: '1 1 auto',
                      minWidth: 0,
                      minHeight: '36px',
                      padding: '0 4px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 'var(--ui-radius-control)',
                      color: layer.visible ? 'var(--ui-text)' : 'var(--ui-muted)',
                      fontFamily: 'var(--ui-font-sans)',
                      fontSize: '15px',
                      lineHeight: '20px',
                      fontWeight: isActive ? 600 : 400,
                      textAlign: 'left',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer'
                    }}
                    title={layer.name}
                  >
                    {layer.name}
                  </button>
                )}

                {isTerrain ? (
                  <span
                    style={{
                      fontSize: '13px',
                      lineHeight: '18px',
                      fontWeight: 600,
                      color: 'var(--ui-accent)',
                      backgroundColor: 'rgba(23, 35, 45, 0.75)',
                      border: '1px solid var(--ui-line-subtle)',
                      borderRadius: 'var(--ui-radius-control)',
                      padding: '2px 8px',
                      flexShrink: 0
                    }}
                  >
                    Base
                  </span>
                ) : (
                  <span
                    className="tabular-nums"
                    aria-label={`${objectCount} oggetti nel livello ${layer.name}`}
                    style={{
                      fontSize: '13px',
                      lineHeight: '18px',
                      color: 'var(--ui-muted)',
                      backgroundColor: 'rgba(23, 35, 45, 0.75)',
                      border: '1px solid var(--ui-line-subtle)',
                      borderRadius: 'var(--ui-radius-control)',
                      padding: '2px 8px',
                      flexShrink: 0
                    }}
                  >
                    {objectCount}
                  </span>
                )}
              </div>

              {/* Opacità (0-100%) per i livelli oggetti */}
              {!isTerrain ? (
                <LayerOpacitySlider layer={layer} onCommitOpacity={handleCommitOpacity} />
              ) : null}

              {/* Azioni livello: Sposta Su, Sposta Giù, Rinomina, Elimina */}
              {!isTerrain ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '4px'
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-ghost has-tooltip-top"
                    aria-label={`Sposta su livello ${layer.name}`}
                    data-tooltip="Sposta su"
                    disabled={!canMoveUp}
                    onClick={() => handleMoveLayer(docIndex, 1)}
                    style={{
                      minWidth: '36px',
                      minHeight: '36px',
                      width: '36px',
                      height: '36px',
                      padding: 0
                    }}
                  >
                    <ArrowUpIcon />
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost has-tooltip-top"
                    aria-label={`Sposta giù livello ${layer.name}`}
                    data-tooltip="Sposta giù"
                    disabled={!canMoveDown}
                    onClick={() => handleMoveLayer(docIndex, -1)}
                    style={{
                      minWidth: '36px',
                      minHeight: '36px',
                      width: '36px',
                      height: '36px',
                      padding: 0
                    }}
                  >
                    <ArrowDownIcon />
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost has-tooltip-top"
                    aria-label={`Rinomina livello ${layer.name}`}
                    data-tooltip="Rinomina"
                    onClick={() => beginRename(layer)}
                    style={{
                      minWidth: '36px',
                      minHeight: '36px',
                      width: '36px',
                      height: '36px',
                      padding: 0
                    }}
                  >
                    <PencilIcon />
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost has-tooltip-top"
                    aria-label={
                      canDelete
                        ? `Elimina livello ${layer.name}`
                        : `Impossibile eliminare l’unico livello oggetti`
                    }
                    data-tooltip={canDelete ? 'Elimina livello' : 'Minimo un livello'}
                    disabled={!canDelete}
                    onClick={() => handleDeleteLayer(layer)}
                    style={{
                      minWidth: '36px',
                      minHeight: '36px',
                      width: '36px',
                      height: '36px',
                      padding: 0,
                      color: canDelete ? 'var(--ui-muted)' : undefined
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
