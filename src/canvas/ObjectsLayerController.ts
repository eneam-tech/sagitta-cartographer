import type Konva from 'konva';
import KonvaRuntime from 'konva/lib/index.js';
import { getCatalogItemById, svgToDataUrl } from '../assets/catalog';
import { Point2D, clampNumber } from '../model/coordinates';
import {
  AssetManifestEntry,
  LabelObject,
  MapDocument,
  MapLayer,
  MapObject,
  PathObject,
  cloneMapObject,
  resolveObjectLayerId
} from '../model/document';
import {
  AddObjectCommand,
  AddObjectsBatchCommand,
  DeleteObjectCommand,
  areMapObjectsEqual,
  commitObjectUpdate,
  createPathObject,
  createPoiStampObject,
  getDefaultObjectLabel,
  getDeleteObjectLabel,
  normalizeRotationDeg,
  simplifyPolyline
} from '../objects/objectCommands';
import {
  drawPathToContext,
  resolveLabelHaloWidth,
  sampleSmoothPathPoints
} from '../render/objectMetrics';
import { EditorSnapshot, EditorStore, shouldIgnoreShortcut } from '../state/editorStore';
import { MapTheme, getFontSpec } from '../theme/theme';
import type { ViewportLayersHandle, ViewportPointerContext } from './MapViewport';

const KonvaCtor = KonvaRuntime as unknown as typeof Konva;

export interface InlineLabelEditRequest {
  mode: 'create' | 'edit';
  docX: number;
  docY: number;
  objectId?: string;
  initialText: string;
  fontId: string;
  fontSize: number;
  color: string;
  rotationDeg: number;
  onEnd?: () => void;
}

export interface ObjectsLayerControllerOptions {
  layers: ViewportLayersHandle;
  store: EditorStore;
  onRequestInlineLabelEdit?: (request: InlineLabelEditRequest) => void;
}

interface CachedAssetEntry {
  assetId: string;
  entry: AssetManifestEntry;
  image: HTMLImageElement;
  objectUrl?: string;
  loaded: boolean;
}

interface ActivePathDraft {
  points: number[];
  layerId: string;
  pointerId: number | null;
}

const STAMP_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
];

const LABEL_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function toKonvaFontStyle(italic: boolean, weight: 400 | 600): string {
  return `${italic ? 'italic ' : ''}${weight}`;
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = clampNumber(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function computePathSelfRect(pathObj: PathObject | undefined): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (!pathObj || pathObj.points.length < 2) {
    return { x: -8, y: -8, width: 16, height: 16 };
  }
  const count = Math.floor(pathObj.points.length / 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const px = pathObj.points[i * 2];
    const py = pathObj.points[i * 2 + 1];
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  const pad = Math.max(6, pathObj.strokeWidthDoc * 0.65);
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(12, maxX - minX + pad * 2),
    height: Math.max(12, maxY - minY + pad * 2)
  };
}

function isPointInsideObject(
  obj: MapObject,
  docX: number,
  docY: number,
  node: Konva.Image | Konva.Text | Konva.Shape | undefined,
  anchorX: number,
  anchorY: number
): boolean {
  const dx = docX - obj.x;
  const dy = docY - obj.y;
  const rad = (-obj.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  if (obj.type === 'stamp') {
    const left = -obj.width * anchorX;
    const top = -obj.height * anchorY;
    return lx >= left && lx <= left + obj.width && ly >= top && ly <= top + obj.height;
  }

  if (obj.type === 'path') {
    const pts = obj.smooth !== false ? sampleSmoothPathPoints(obj.points, 5) : obj.points;
    const count = Math.floor(pts.length / 2);
    if (count < 2) return false;
    const hitRadius = Math.max(12, obj.strokeWidthDoc * 0.75);
    for (let i = 0; i < count - 1; i += 1) {
      const d = distToSegment(
        lx,
        ly,
        pts[i * 2],
        pts[i * 2 + 1],
        pts[(i + 1) * 2],
        pts[(i + 1) * 2 + 1]
      );
      if (d <= hitRadius) {
        return true;
      }
    }
    return false;
  }

  const textNode = node as Konva.Text | undefined;
  const width = textNode
    ? Math.max(20, textNode.width())
    : Math.max(24, obj.text.length * obj.fontSize * 0.6);
  const height = textNode ? Math.max(obj.fontSize, textNode.height()) : obj.fontSize * 1.25;
  return lx >= -4 && lx <= width + 4 && ly >= -4 && ly <= height + 4;
}

function computePolylineLength(points: readonly number[]): number {
  const count = Math.floor(points.length / 2);
  let len = 0;
  for (let i = 0; i < count - 1; i += 1) {
    len += Math.hypot(points[(i + 1) * 2] - points[i * 2], points[(i + 1) * 2 + 1] - points[i * 2 + 1]);
  }
  return len;
}

/**
 * Imperative Konva controller managing `objectsLayer` (grouped by non-terrain
 * `MapLayer`s with visibility/opacity/lock enforcement for stamps, labels, and
 * vector paths) and `overlayLayer` (two-tone Transformer, cursor ghosts, and
 * live vector path stroke previews).
 */
export class ObjectsLayerController {
  private readonly layers: ViewportLayersHandle;
  private readonly store: EditorStore;
  private readonly onRequestInlineLabelEdit?: (request: InlineLabelEditRequest) => void;

  private readonly layerGroupMap = new Map<string, Konva.Group>();
  private readonly nodeMap = new Map<string, Konva.Image | Konva.Text | Konva.Shape>();
  private readonly syncedObjectMap = new Map<string, MapObject>();
  private readonly assetCache = new Map<string, CachedAssetEntry>();

  private readonly transformer: Konva.Transformer;
  private readonly ghostGroup: Konva.Group;
  private readonly ghostScatterCircle: Konva.Circle;
  private readonly ghostImage: Konva.Image;
  private readonly ghostRect: Konva.Rect;
  private readonly ghostLabelPill: Konva.Group;
  private readonly ghostLabelRect: Konva.Rect;
  private readonly ghostLabelText: Konva.Text;
  private readonly pathCursorRing: Konva.Circle;
  private readonly pathPreviewShape: Konva.Shape;

  private unsubscribeStore: (() => void) | null = null;
  private detachStageLeave: (() => void) | null = null;
  private detachPathWindowListeners: (() => void) | null = null;
  private disposed = false;

  private lastDoc: MapDocument | null = null;
  private lastDocVersionTick = -1;
  private lastThemeSignature = '';
  private lastEffectiveTool: string | null = null;
  private lastSelectedObjectId: string | null = null;
  private lastActivePoiId: string | null = null;
  private lastPoiScale = -1;
  private lastPoiBrushMode = '';
  private lastPoiScatterRadius = -1;
  private lastPathStyleSignature = '';
  private lastInlineEditingObjectId: string | null = null;
  private lastCameraScale = -1;
  private lastCameraOffsetX = 0;
  private lastCameraOffsetY = 0;
  private lastExtraBlobsRef: Map<string, Blob> | null = null;

  private inlineEditingObjectId: string | null = null;
  private inlineEditingSessionActive = false;

  private activeInteractingObjectId: string | null = null;
  private dragStartSnapshot: MapObject | null = null;
  private transformStartSnapshot: MapObject | null = null;
  private pathDraft: ActivePathDraft | null = null;

  private cursorInside = false;
  private cursorDocPoint: Point2D = { x: 0, y: 0 };

  constructor(options: ObjectsLayerControllerOptions) {
    this.layers = options.layers;
    this.store = options.store;
    this.onRequestInlineLabelEdit = options.onRequestInlineLabelEdit;

    this.transformer = this.createTwoToneTransformer();
    this.layers.overlayLayer.add(this.transformer);

    this.ghostGroup = new KonvaCtor.Group({ visible: false, listening: false });
    this.ghostScatterCircle = new KonvaCtor.Circle({
      visible: false,
      x: 0,
      y: 0,
      radius: 140,
      stroke: '#E0BB79',
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
      dash: [7, 5],
      fill: 'rgba(224, 187, 121, 0.06)',
      listening: false
    });
    this.ghostRect = new KonvaCtor.Rect({
      stroke: '#9CDEEF',
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
      dash: [5, 4],
      fill: 'rgba(156, 222, 239, 0.1)',
      listening: false
    });
    this.ghostImage = new KonvaCtor.Image({
      image: undefined,
      opacity: 0.62,
      listening: false,
      perfectDrawEnabled: false
    });
    this.ghostGroup.add(this.ghostScatterCircle, this.ghostRect, this.ghostImage);

    this.ghostLabelPill = new KonvaCtor.Group({ visible: false, listening: false });
    this.ghostLabelRect = new KonvaCtor.Rect({
      x: 0,
      y: 0,
      width: 112,
      height: 36,
      cornerRadius: 4,
      stroke: '#9CDEEF',
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
      dash: [5, 4],
      fill: 'rgba(23, 35, 45, 0.35)',
      listening: false
    });
    this.ghostLabelText = new KonvaCtor.Text({
      x: 8,
      y: 8,
      text: 'Nuova etichetta',
      fontFamily: '"Spectral", Georgia, serif',
      fontSize: 20,
      fill: '#F3EEDF',
      opacity: 0.85,
      listening: false
    });
    this.ghostLabelPill.add(this.ghostLabelRect, this.ghostLabelText);

    this.pathCursorRing = new KonvaCtor.Circle({
      visible: false,
      x: 0,
      y: 0,
      radius: 7,
      stroke: '#9CDEEF',
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
      listening: false
    });

    this.pathPreviewShape = new KonvaCtor.Shape({
      visible: false,
      listening: false,
      perfectDrawEnabled: false,
      sceneFunc: (ctx) => {
        const draft = this.pathDraft;
        if (!draft || draft.points.length < 2) return;
        const rawCtx = (ctx as unknown as { _context?: CanvasRenderingContext2D })._context;
        if (!rawCtx) return;
        const snap = this.store.getSnapshot();
        if (draft.points.length < 4) {
          rawCtx.save();
          rawCtx.fillStyle = snap.pathColor;
          rawCtx.globalAlpha *= 0.85;
          rawCtx.beginPath();
          rawCtx.arc(
            draft.points[0],
            draft.points[1],
            Math.max(1.5, snap.pathStrokeWidthDoc * 0.5),
            0,
            Math.PI * 2
          );
          rawCtx.fill();
          rawCtx.restore();
          return;
        }
        const previewObj: PathObject = {
          id: '__path-preview__',
          type: 'path',
          kind: snap.pathKind,
          x: 0,
          y: 0,
          rotationDeg: 0,
          points: draft.points,
          strokeWidthDoc: snap.pathStrokeWidthDoc,
          color: snap.pathColor,
          opacity: 0.88,
          dashed: snap.pathDashed,
          tapered: snap.pathTapered,
          smooth: snap.pathSmooth
        };
        drawPathToContext(rawCtx, previewObj, 1, 1);
      }
    });

    this.layers.overlayLayer.add(
      this.ghostGroup,
      this.ghostLabelPill,
      this.pathCursorRing,
      this.pathPreviewShape
    );

    const content = this.layers.stage.content;
    if (content && typeof content.addEventListener === 'function') {
      const onLeave = () => this.handlePointerLeave();
      content.addEventListener('pointerleave', onLeave);
      content.addEventListener('mouseleave', onLeave);
      this.detachStageLeave = () => {
        content.removeEventListener('pointerleave', onLeave);
        content.removeEventListener('mouseleave', onLeave);
      };
    }

    this.sync(this.store.getSnapshot());
    this.unsubscribeStore = this.store.subscribe(() => {
      if (!this.disposed) {
        this.sync(this.store.getSnapshot());
      }
    });
  }

  private createTwoToneTransformer(): Konva.Transformer {
    const tr = new KonvaCtor.Transformer({
      visible: false,
      rotateEnabled: true,
      rotateLineVisible: true,
      rotateAnchorOffset: 28,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      rotationSnapTolerance: 3,
      anchorSize: 12,
      anchorFill: '#F3EEDF',
      anchorStroke: '#17232D',
      anchorStrokeWidth: 1.75,
      anchorCornerRadius: 2,
      borderEnabled: true,
      borderStroke: '#9CDEEF',
      borderStrokeWidth: 1.5,
      keepRatio: true,
      flipEnabled: false,
      ignoreStroke: true,
      padding: 4,
      boundBoxFunc: (oldBox, newBox) => {
        if (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10) {
          return oldBox;
        }
        return newBox;
      },
      anchorStyleFunc: (anchor) => {
        anchor.hitStrokeWidth(8);
        anchor.fill('#F3EEDF');
        anchor.stroke('#17232D');
        anchor.strokeWidth(1.75);
        anchor.cornerRadius(anchor.hasName('rotater') ? 6 : 2);
      }
    });

    const back = tr.findOne('.back') as Konva.Shape | undefined;
    if (back) {
      back.sceneFunc((ctx, shape) => {
        const parentTr = shape.getParent() as Konva.Transformer | null;
        if (!parentTr || !parentTr.borderEnabled()) return;
        const padding = parentTr.padding();
        const w = shape.width();
        const h = shape.height();
        const signH = h < 0 ? -1 : 1;

        ctx.beginPath();
        ctx.rect(-padding, -padding, w + padding * 2, h + padding * 2);
        if (parentTr.rotateEnabled() && parentTr.rotateLineVisible()) {
          ctx.moveTo(w / 2, -padding);
          ctx.lineTo(w / 2, -parentTr.rotateAnchorOffset() * signH - padding);
        }

        ctx.save();
        ctx.strokeStyle = '#17232D';
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.strokeStyle = '#9CDEEF';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      });
    }

    return tr;
  }

  private isLayerIdEditable(layerId: string, layers: readonly MapLayer[]): boolean {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return true;
    return layer.visible && !layer.locked;
  }

  private isObjectLayerEditable(obj: MapObject, layers: readonly MapLayer[]): boolean {
    const resolvedLayerId = resolveObjectLayerId(obj, layers);
    return this.isLayerIdEditable(resolvedLayerId, layers);
  }

  /**
   * Notifies the controller whether an HTML inline label editor is currently open
   * and optionally which existing object ID is being edited (to hide its canvas duplicate).
   */
  setInlineEditingState(active: boolean, editingObjectId: string | null = null): void {
    this.inlineEditingSessionActive = active;
    this.inlineEditingObjectId = active ? editingObjectId : null;
    if (!this.disposed) {
      this.sync(this.store.getSnapshot());
    }
  }

  /**
   * Updates cursor location from external viewport callbacks (null hides placement ghost).
   */
  setCursorDocPoint(point: Point2D | null): void {
    if (!point) {
      this.handlePointerLeave();
      return;
    }
    this.cursorInside = true;
    this.cursorDocPoint = { x: point.x, y: point.y };
    const snap = this.store.getSnapshot();
    const effectiveTool = snap.spacePanActive ? 'hand' : snap.activeTool;
    if (this.updateGhost(snap, effectiveTool)) {
      this.layers.overlayLayer.batchDraw();
    }
  }

  sync(snapshot: EditorSnapshot): void {
    if (this.disposed) return;

    const effectiveTool = snapshot.spacePanActive ? 'hand' : snapshot.activeTool;
    const isSelect = effectiveTool === 'select';
    const doc = snapshot.doc;
    const extraBlobs = this.store.getExtraAssetBlobs();
    if (this.lastExtraBlobsRef !== extraBlobs) {
      this.clearNonBuiltinAssetCache();
      this.lastExtraBlobsRef = extraBlobs;
    }

    if (effectiveTool !== 'path' && this.pathDraft) {
      this.cancelPathDraft();
    }

    const themeSignature = `${doc.theme.id}:${doc.theme.version}:${doc.theme.colors.labelHalo}:${JSON.stringify(doc.theme.fonts)}`;
    const pathStyleSignature = `${snapshot.pathKind}:${snapshot.pathStrokeWidthDoc}:${snapshot.pathColor}:${snapshot.pathSmooth}:${snapshot.pathDashed}:${snapshot.pathTapered}`;
    const docChanged =
      doc !== this.lastDoc ||
      snapshot.documentVersionTick !== this.lastDocVersionTick ||
      themeSignature !== this.lastThemeSignature;
    const toolChanged = effectiveTool !== this.lastEffectiveTool;
    const selectionChanged = snapshot.selectedObjectId !== this.lastSelectedObjectId;
    const poiChanged =
      snapshot.activePoiId !== this.lastActivePoiId ||
      snapshot.poiPlacementScale !== this.lastPoiScale ||
      snapshot.poiBrushMode !== this.lastPoiBrushMode ||
      snapshot.poiScatterRadiusDoc !== this.lastPoiScatterRadius;
    const pathStyleChanged = pathStyleSignature !== this.lastPathStyleSignature;
    const inlineChanged = this.inlineEditingObjectId !== this.lastInlineEditingObjectId;
    const cameraChanged =
      snapshot.camera.scale !== this.lastCameraScale ||
      snapshot.camera.offsetX !== this.lastCameraOffsetX ||
      snapshot.camera.offsetY !== this.lastCameraOffsetY;

    if (
      !docChanged &&
      !toolChanged &&
      !selectionChanged &&
      !poiChanged &&
      !pathStyleChanged &&
      !inlineChanged &&
      !cameraChanged
    ) {
      return;
    }

    let objectsLayerDirty = false;
    let overlayLayerDirty = false;

    if (toolChanged) {
      this.layers.objectsLayer.listening(isSelect);
    }

    if (docChanged || toolChanged || inlineChanged) {
      const nonTerrainLayers = doc.manifest.layers.filter((l) => l.kind !== 'terrain');
      const activeLayerIds = new Set<string>();

      for (let gIdx = 0; gIdx < nonTerrainLayers.length; gIdx += 1) {
        const layer = nonTerrainLayers[gIdx];
        activeLayerIds.add(layer.id);
        let group = this.layerGroupMap.get(layer.id);
        if (!group) {
          group = new KonvaCtor.Group({
            id: layer.id,
            name: 'doc-layer-group'
          });
          this.layers.objectsLayer.add(group);
          this.layerGroupMap.set(layer.id, group);
          objectsLayerDirty = true;
        }

        const nextListening = layer.visible && !layer.locked;
        const nextOpacity = clampNumber(layer.opacity, 0, 1);

        if (group.visible() !== layer.visible) {
          group.visible(layer.visible);
          objectsLayerDirty = true;
        }
        if (Math.abs(group.opacity() - nextOpacity) > 1e-4) {
          group.opacity(nextOpacity);
          objectsLayerDirty = true;
        }
        if (group.listening() !== nextListening) {
          group.listening(nextListening);
          objectsLayerDirty = true;
        }
        if (group.zIndex() !== gIdx) {
          group.zIndex(gIdx);
          objectsLayerDirty = true;
        }
      }

      const objects = doc.manifest.objects;
      const seenIds = new Set<string>();
      const themeChanged = themeSignature !== this.lastThemeSignature;
      const perLayerZCount = new Map<string, number>();

      for (let i = 0; i < objects.length; i += 1) {
        const obj = objects[i];
        seenIds.add(obj.id);
        const targetLayerId = resolveObjectLayerId(obj, doc.manifest.layers);
        const targetGroup = this.layerGroupMap.get(targetLayerId);
        const layerEditable = this.isLayerIdEditable(targetLayerId, doc.manifest.layers);
        const zInLayer = perLayerZCount.get(targetLayerId) ?? 0;
        perLayerZCount.set(targetLayerId, zInLayer + 1);

        let node = this.nodeMap.get(obj.id);

        if (node) {
          const expectedType =
            obj.type === 'stamp' ? 'Image' : obj.type === 'label' ? 'Text' : 'Shape';
          if (node.getClassName() !== expectedType) {
            node.destroy();
            this.nodeMap.delete(obj.id);
            this.syncedObjectMap.delete(obj.id);
            node = undefined;
          }
        }

        if (!node) {
          node = this.createNodeForObject(obj, doc, isSelect && layerEditable);
          if (targetGroup) {
            targetGroup.add(node);
          } else {
            this.layers.objectsLayer.add(node);
          }
          this.nodeMap.set(obj.id, node);
          this.syncedObjectMap.set(obj.id, obj);
          if (node.zIndex() !== zInLayer) {
            node.zIndex(zInLayer);
          }
          objectsLayerDirty = true;
        } else {
          if (targetGroup && node.getParent() !== targetGroup) {
            targetGroup.add(node);
            objectsLayerDirty = true;
          }
          const prevObj = this.syncedObjectMap.get(obj.id);
          const isInteracting = this.activeInteractingObjectId === obj.id;
          if (!isInteracting && (prevObj !== obj || themeChanged)) {
            this.applyObjectAttrsToNode(node, obj, doc);
            this.syncedObjectMap.set(obj.id, obj);
            objectsLayerDirty = true;
          }
          const desiredDraggable = isSelect && layerEditable;
          if (node.draggable() !== desiredDraggable) {
            node.draggable(desiredDraggable);
          }
          if (node.listening() !== layerEditable) {
            node.listening(layerEditable);
          }
          if (node.zIndex() !== zInLayer) {
            node.zIndex(zInLayer);
            objectsLayerDirty = true;
          }
        }

        const shouldBeVisible = obj.id !== this.inlineEditingObjectId;
        if (node.visible() !== shouldBeVisible) {
          node.visible(shouldBeVisible);
          objectsLayerDirty = true;
        }
      }

      for (const [id, node] of this.nodeMap.entries()) {
        if (!seenIds.has(id)) {
          if (this.transformer.nodes().includes(node)) {
            this.transformer.nodes([]);
          }
          node.destroy();
          this.nodeMap.delete(id);
          this.syncedObjectMap.delete(id);
          objectsLayerDirty = true;
        }
      }

      for (const [layerId, group] of this.layerGroupMap.entries()) {
        if (!activeLayerIds.has(layerId)) {
          group.destroy();
          this.layerGroupMap.delete(layerId);
          objectsLayerDirty = true;
        }
      }
    }

    // Sincronizza Konva.Transformer su overlayLayer solo per oggetti su livelli modificabili
    const selectedId = snapshot.selectedObjectId;
    const candidateSelected =
      selectedId && isSelect && selectedId !== this.inlineEditingObjectId
        ? doc.manifest.objects.find((o) => o.id === selectedId) ?? null
        : null;
    const selectedObj =
      candidateSelected && this.isObjectLayerEditable(candidateSelected, doc.manifest.layers)
        ? candidateSelected
        : null;
    const selectedNode = selectedObj ? this.nodeMap.get(selectedObj.id) ?? null : null;

    if (selectedObj && selectedNode) {
      const currentNodes = this.transformer.nodes();
      if (currentNodes.length !== 1 || currentNodes[0] !== selectedNode) {
        this.transformer.nodes([selectedNode]);
        overlayLayerDirty = true;
      }
      const targetAnchors = selectedObj.type === 'label' ? LABEL_ANCHORS : STAMP_ANCHORS;
      this.transformer.enabledAnchors(targetAnchors);
      this.transformer.keepRatio(true);
      if (!this.transformer.visible()) {
        this.transformer.visible(true);
        overlayLayerDirty = true;
      }
      this.transformer.moveToTop();
      this.layers.overlayLayer.listening(true);
      if (docChanged || cameraChanged || selectionChanged) {
        this.transformer.forceUpdate();
        overlayLayerDirty = true;
      }
    } else {
      if (this.transformer.nodes().length > 0) {
        this.transformer.nodes([]);
        overlayLayerDirty = true;
      }
      if (this.transformer.visible()) {
        this.transformer.visible(false);
        overlayLayerDirty = true;
      }
      this.layers.overlayLayer.listening(false);
    }

    if (this.updateGhost(snapshot, effectiveTool)) {
      overlayLayerDirty = true;
    }

    this.lastDoc = doc;
    this.lastDocVersionTick = snapshot.documentVersionTick;
    this.lastThemeSignature = themeSignature;
    this.lastEffectiveTool = effectiveTool;
    this.lastSelectedObjectId = snapshot.selectedObjectId;
    this.lastActivePoiId = snapshot.activePoiId;
    this.lastPoiScale = snapshot.poiPlacementScale;
    this.lastPoiBrushMode = snapshot.poiBrushMode;
    this.lastPoiScatterRadius = snapshot.poiScatterRadiusDoc;
    this.lastPathStyleSignature = pathStyleSignature;
    this.lastInlineEditingObjectId = this.inlineEditingObjectId;
    this.lastCameraScale = snapshot.camera.scale;
    this.lastCameraOffsetX = snapshot.camera.offsetX;
    this.lastCameraOffsetY = snapshot.camera.offsetY;

    if (objectsLayerDirty) {
      this.layers.objectsLayer.batchDraw();
    }
    if (overlayLayerDirty) {
      this.layers.overlayLayer.batchDraw();
    }
  }

  private updateGhost(snapshot: EditorSnapshot, effectiveTool: string): boolean {
    let dirty = false;

    const inlineActive = this.inlineEditingSessionActive && this.isAnyInlineEditorMounted();
    const showPoiGhost =
      effectiveTool === 'poi' &&
      Boolean(snapshot.activePoiId) &&
      this.cursorInside &&
      !inlineActive;

    if (showPoiGhost && snapshot.activePoiId) {
      const item = getCatalogItemById(snapshot.activePoiId);
      if (item) {
        const cached = this.ensureAssetResource(item.asset.id, snapshot.doc);
        const scale = snapshot.poiPlacementScale;
        const w = item.defaultWidthDoc * scale;
        const h = item.defaultHeightDoc * scale;
        const ox = w * item.asset.anchorX;
        const oy = h * item.asset.anchorY;

        this.ghostGroup.position({ x: this.cursorDocPoint.x, y: this.cursorDocPoint.y });
        this.ghostImage.setAttrs({
          image: cached?.loaded ? cached.image : undefined,
          width: w,
          height: h,
          offsetX: ox,
          offsetY: oy
        });
        this.ghostRect.setAttrs({
          x: -ox,
          y: -oy,
          width: w,
          height: h
        });
        const isScatter = snapshot.poiBrushMode === 'scatter';
        this.ghostScatterCircle.setAttrs({
          visible: isScatter,
          radius: snapshot.poiScatterRadiusDoc
        });
        if (!this.ghostGroup.visible()) {
          this.ghostGroup.visible(true);
        }
        this.ghostGroup.moveToTop();
        dirty = true;
      } else if (this.ghostGroup.visible()) {
        this.ghostGroup.visible(false);
        dirty = true;
      }
    } else if (this.ghostGroup.visible()) {
      this.ghostGroup.visible(false);
      dirty = true;
    }

    const showLabelGhost = effectiveTool === 'label' && this.cursorInside && !inlineActive;

    if (showLabelGhost) {
      const spec = getFontSpec(snapshot.doc.theme, snapshot.doc.theme.fonts.defaultFontId);
      this.ghostLabelPill.position({ x: this.cursorDocPoint.x, y: this.cursorDocPoint.y });
      this.ghostLabelText.setAttrs({
        fontFamily: spec.family,
        fontStyle: toKonvaFontStyle(spec.italic, spec.weight),
        fontSize: Math.max(16, spec.defaultSizeDoc)
      });
      const textW = Math.max(120, this.ghostLabelText.width() + 16);
      const textH = Math.max(28, this.ghostLabelText.height() + 10);
      this.ghostLabelRect.setAttrs({ width: textW, height: textH });
      if (!this.ghostLabelPill.visible()) {
        this.ghostLabelPill.visible(true);
      }
      this.ghostLabelPill.moveToTop();
      dirty = true;
    } else if (this.ghostLabelPill.visible()) {
      this.ghostLabelPill.visible(false);
      dirty = true;
    }

    const showPathCursor =
      effectiveTool === 'path' && this.cursorInside && !this.pathDraft && !inlineActive;
    if (showPathCursor) {
      this.pathCursorRing.setAttrs({
        visible: true,
        x: this.cursorDocPoint.x,
        y: this.cursorDocPoint.y,
        radius: Math.max(3, snapshot.pathStrokeWidthDoc * 0.5),
        stroke: snapshot.pathColor
      });
      this.pathCursorRing.moveToTop();
      dirty = true;
    } else if (this.pathCursorRing.visible()) {
      this.pathCursorRing.visible(false);
      dirty = true;
    }

    return dirty;
  }

  private createNodeForObject(
    obj: MapObject,
    doc: MapDocument,
    draggable: boolean
  ): Konva.Image | Konva.Text | Konva.Shape {
    let node: Konva.Image | Konva.Text | Konva.Shape;

    if (obj.type === 'stamp') {
      node = new KonvaCtor.Image({
        id: obj.id,
        image: undefined,
        draggable,
        perfectDrawEnabled: false
      });
    } else if (obj.type === 'label') {
      node = new KonvaCtor.Text({
        id: obj.id,
        text: obj.text,
        draggable,
        lineJoin: 'round',
        fillAfterStrokeEnabled: true,
        shadowForStrokeEnabled: false
      });
    } else {
      const shape = new KonvaCtor.Shape({
        id: obj.id,
        draggable,
        perfectDrawEnabled: false,
        lineCap: 'round',
        lineJoin: 'round',
        sceneFunc: (ctx, konvaShape) => {
          const pathObj = konvaShape.getAttr('pathObject') as PathObject | undefined;
          if (!pathObj) return;
          const rawCtx = (ctx as unknown as { _context?: CanvasRenderingContext2D })._context;
          if (!rawCtx) return;
          drawPathToContext(rawCtx, { ...pathObj, x: 0, y: 0, rotationDeg: 0 }, 1, 1);
        },
        hitFunc: (ctx, konvaShape) => {
          const pathObj = konvaShape.getAttr('pathObject') as PathObject | undefined;
          if (!pathObj || pathObj.points.length < 4) return;
          const pts =
            pathObj.smooth !== false
              ? sampleSmoothPathPoints(pathObj.points, 5)
              : pathObj.points;
          const count = Math.floor(pts.length / 2);
          if (count < 2) return;
          ctx.beginPath();
          ctx.moveTo(pts[0], pts[1]);
          for (let i = 1; i < count; i += 1) {
            ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
          }
          ctx.strokeShape(konvaShape);
        }
      });
      shape.getSelfRect = () =>
        computePathSelfRect(shape.getAttr('pathObject') as PathObject | undefined);
      node = shape;
    }

    this.applyObjectAttrsToNode(node, obj, doc);
    this.bindNodeInteractionEvents(node, obj.id);
    return node;
  }

  private applyObjectAttrsToNode(
    node: Konva.Image | Konva.Text | Konva.Shape,
    obj: MapObject,
    doc: MapDocument
  ): void {
    if (obj.type === 'stamp') {
      const cached = this.ensureAssetResource(obj.assetId, doc);
      const anchorX = cached?.entry.anchorX ?? 0.5;
      const anchorY = cached?.entry.anchorY ?? 0.5;
      node.setAttrs({
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        offsetX: obj.width * anchorX,
        offsetY: obj.height * anchorY,
        scaleX: 1,
        scaleY: 1,
        rotation: obj.rotationDeg,
        image: cached?.loaded ? cached.image : undefined
      });
    } else if (obj.type === 'label') {
      const spec = getFontSpec(doc.theme, obj.fontId);
      node.setAttrs({
        x: obj.x,
        y: obj.y,
        text: obj.text,
        fontFamily: spec.family,
        fontSize: obj.fontSize,
        fontStyle: toKonvaFontStyle(spec.italic, spec.weight),
        fill: obj.color,
        stroke: doc.theme.colors.labelHalo,
        strokeWidth: resolveLabelHaloWidth(obj.fontSize, 1),
        fillAfterStrokeEnabled: true,
        lineJoin: 'round',
        scaleX: 1,
        scaleY: 1,
        rotation: obj.rotationDeg
      });
    } else {
      node.setAttr('pathObject', obj);
      node.setAttrs({
        x: obj.x,
        y: obj.y,
        scaleX: 1,
        scaleY: 1,
        rotation: obj.rotationDeg,
        hitStrokeWidth: Math.max(18, obj.strokeWidthDoc * 1.5)
      });
    }
  }

  private bindNodeInteractionEvents(
    node: Konva.Image | Konva.Text | Konva.Shape,
    objectId: string
  ): void {
    node.on('dragstart', () => {
      const snap = this.store.getSnapshot();
      const current = snap.doc.manifest.objects.find((o) => o.id === objectId);
      if (!current || !this.isObjectLayerEditable(current, snap.doc.manifest.layers)) {
        node.stopDrag();
        return;
      }
      this.activeInteractingObjectId = objectId;
      this.dragStartSnapshot = cloneMapObject(current);
    });

    node.on('dragend', () => {
      const prev = this.dragStartSnapshot;
      this.dragStartSnapshot = null;
      if (this.activeInteractingObjectId === objectId) {
        this.activeInteractingObjectId = null;
      }
      if (!prev) return;

      const nextX = Number(node.x().toFixed(2));
      const nextY = Number(node.y().toFixed(2));
      node.setAttrs({ x: nextX, y: nextY });

      const next: MapObject = {
        ...prev,
        x: nextX,
        y: nextY
      };
      const actionLabel =
        prev.type === 'stamp'
          ? 'Sposta simbolo'
          : prev.type === 'label'
            ? 'Sposta etichetta'
            : 'Sposta tracciato';
      commitObjectUpdate(this.store, prev, next, actionLabel);
    });

    node.on('transformstart', () => {
      const snap = this.store.getSnapshot();
      const current = snap.doc.manifest.objects.find((o) => o.id === objectId);
      if (!current || !this.isObjectLayerEditable(current, snap.doc.manifest.layers)) {
        return;
      }
      this.activeInteractingObjectId = objectId;
      this.transformStartSnapshot = cloneMapObject(current);
    });

    node.on('transformend', () => {
      const prev = this.transformStartSnapshot;
      this.transformStartSnapshot = null;
      if (this.activeInteractingObjectId === objectId) {
        this.activeInteractingObjectId = null;
      }
      if (!prev) return;

      const nextX = Number(node.x().toFixed(2));
      const nextY = Number(node.y().toFixed(2));
      const nextRotation = normalizeRotationDeg(node.rotation());
      const scaleX = Math.abs(node.scaleX());
      const scaleY = Math.abs(node.scaleY());

      let next: MapObject;
      if (prev.type === 'stamp') {
        const doc = this.store.getDocument();
        const entry = this.resolveAssetEntry(prev.assetId, doc);
        const nextWidth = Math.max(4, Number((node.width() * scaleX).toFixed(2)));
        const nextHeight = Math.max(4, Number((node.height() * scaleY).toFixed(2)));
        node.setAttrs({
          scaleX: 1,
          scaleY: 1,
          width: nextWidth,
          height: nextHeight,
          offsetX: nextWidth * entry.anchorX,
          offsetY: nextHeight * entry.anchorY,
          x: nextX,
          y: nextY,
          rotation: nextRotation
        });
        next = {
          ...prev,
          x: nextX,
          y: nextY,
          width: nextWidth,
          height: nextHeight,
          rotationDeg: nextRotation
        };
      } else if (prev.type === 'label') {
        const scaleFactor = Math.max(scaleX, scaleY);
        const nextFontSize = Math.max(8, Number((prev.fontSize * scaleFactor).toFixed(2)));
        node.setAttrs({
          scaleX: 1,
          scaleY: 1,
          fontSize: nextFontSize,
          strokeWidth: resolveLabelHaloWidth(nextFontSize, 1),
          x: nextX,
          y: nextY,
          rotation: nextRotation
        });
        next = {
          ...prev,
          x: nextX,
          y: nextY,
          fontSize: nextFontSize,
          rotationDeg: nextRotation
        };
      } else {
        const nextPoints: number[] = [];
        for (let i = 0; i < prev.points.length; i += 2) {
          nextPoints.push(
            Number((prev.points[i] * scaleX).toFixed(2)),
            Number((prev.points[i + 1] * scaleY).toFixed(2))
          );
        }
        const avgScale = (scaleX + scaleY) * 0.5;
        const nextStrokeWidthDoc = Math.max(
          1,
          Number((prev.strokeWidthDoc * avgScale).toFixed(2))
        );
        next = {
          ...prev,
          x: nextX,
          y: nextY,
          rotationDeg: nextRotation,
          points: nextPoints,
          strokeWidthDoc: nextStrokeWidthDoc
        };
        node.setAttr('pathObject', next);
        node.setAttrs({
          scaleX: 1,
          scaleY: 1,
          x: nextX,
          y: nextY,
          rotation: nextRotation,
          hitStrokeWidth: Math.max(18, nextStrokeWidthDoc * 1.5)
        });
      }

      this.transformer.forceUpdate();
      this.layers.objectsLayer.batchDraw();
      this.layers.overlayLayer.batchDraw();

      const actionLabel =
        prev.type === 'stamp'
          ? 'Trasforma simbolo'
          : prev.type === 'label'
            ? 'Trasforma etichetta'
            : 'Trasforma tracciato';
      if (!areMapObjectsEqual(prev, next)) {
        commitObjectUpdate(this.store, prev, next, actionLabel);
      }
    });
  }

  private resolveAssetEntry(assetId: string, doc: MapDocument): AssetManifestEntry {
    const cached = this.assetCache.get(assetId);
    if (cached) return cached.entry;
    const fromManifest = doc.manifest.assets.find((a) => a.id === assetId);
    if (fromManifest) return fromManifest;
    const fromCatalog = getCatalogItemById(assetId)?.asset;
    if (fromCatalog) return fromCatalog;
    return {
      id: assetId,
      path: `assets/${assetId}.svg`,
      mimeType: 'image/svg+xml',
      version: 1,
      author: 'Sconosciuto',
      source: 'unknown',
      license: 'unknown',
      width: 128,
      height: 128,
      anchorX: 0.5,
      anchorY: 0.5
    };
  }

  private ensureAssetResource(assetId: string, doc: MapDocument): CachedAssetEntry | undefined {
    const existing = this.assetCache.get(assetId);
    if (existing) return existing;

    if (typeof Image === 'undefined') {
      return undefined;
    }

    const entry = this.resolveAssetEntry(assetId, doc);
    const extraBlobs = this.store.getExtraAssetBlobs();
    const extraBlob = extraBlobs.get(entry.path) ?? extraBlobs.get(assetId);
    const catalogItem = getCatalogItemById(assetId);

    let src: string | null = null;
    let objectUrl: string | undefined;

    if (extraBlob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      objectUrl = URL.createObjectURL(extraBlob);
      src = objectUrl;
    } else if (catalogItem) {
      src = svgToDataUrl(catalogItem.svgContent);
    }

    if (!src) {
      return undefined;
    }

    const image = new Image();
    const record: CachedAssetEntry = {
      assetId,
      entry,
      image,
      objectUrl,
      loaded: false
    };
    this.assetCache.set(assetId, record);

    image.onload = () => {
      record.loaded = true;
      if (this.disposed) return;

      let touchedObjects = false;
      const currentObjects = this.store.getDocument().manifest.objects;
      for (const obj of currentObjects) {
        if (obj.type === 'stamp' && obj.assetId === assetId) {
          const node = this.nodeMap.get(obj.id);
          if (node && node instanceof KonvaCtor.Image) {
            node.image(image);
            touchedObjects = true;
          }
        }
      }
      if (touchedObjects) {
        this.layers.objectsLayer.batchDraw();
      }

      const snap = this.store.getSnapshot();
      if (snap.activePoiId === assetId) {
        this.updateGhost(snap, snap.spacePanActive ? 'hand' : snap.activeTool);
        this.layers.overlayLayer.batchDraw();
      }
    };

    image.src = src;
    if (image.complete && image.naturalWidth > 0) {
      record.loaded = true;
    }

    return record;
  }

  private clearNonBuiltinAssetCache(): void {
    for (const [id, cached] of this.assetCache.entries()) {
      if (cached.objectUrl) {
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(cached.objectUrl);
        }
        this.assetCache.delete(id);
      }
    }
  }

  private findTopmostObjectAt(
    doc: MapDocument,
    docX: number,
    docY: number,
    cssX?: number,
    cssY?: number
  ): MapObject | null {
    const layers = doc.manifest.layers;

    if (cssX !== undefined && cssY !== undefined && this.layers.objectsLayer.listening()) {
      const hit = this.layers.objectsLayer.getIntersection({ x: cssX, y: cssY });
      if (hit) {
        const hitId = hit.id();
        const found = doc.manifest.objects.find((o) => o.id === hitId);
        if (found && this.isObjectLayerEditable(found, layers)) {
          return found;
        }
      }
    }

    // Rispetta l'ordine visivo effettivo dei livelli (dall'alto verso il basso)
    // saltando livelli nascosti o bloccati.
    const objects = doc.manifest.objects;
    for (let li = layers.length - 1; li >= 0; li -= 1) {
      const layer = layers[li];
      if (layer.kind === 'terrain' || !layer.visible || layer.locked) {
        continue;
      }

      for (let oi = objects.length - 1; oi >= 0; oi -= 1) {
        const obj = objects[oi];
        if (resolveObjectLayerId(obj, layers) !== layer.id) {
          continue;
        }
        const node = this.nodeMap.get(obj.id);
        if (node && !node.visible()) continue;

        let anchorX = 0.5;
        let anchorY = 0.5;
        if (obj.type === 'stamp') {
          const entry = this.resolveAssetEntry(obj.assetId, doc);
          anchorX = entry.anchorX;
          anchorY = entry.anchorY;
        }

        if (isPointInsideObject(obj, docX, docY, node, anchorX, anchorY)) {
          return obj;
        }
      }
    }
    return null;
  }

  private isAnyInlineEditorMounted(): boolean {
    if (typeof document !== 'undefined') {
      return document.querySelector('[data-inline-label-editor="true"]') !== null;
    }
    return this.inlineEditingSessionActive;
  }

  private openInlineEditorForNewLabel(docX: number, docY: number, theme: MapTheme): void {
    if (!this.onRequestInlineLabelEdit) return;
    const spec = getFontSpec(theme, theme.fonts.defaultFontId);
    this.inlineEditingSessionActive = true;
    this.inlineEditingObjectId = null;
    this.updateGhost(this.store.getSnapshot(), this.store.getEffectiveTool());
    this.layers.overlayLayer.batchDraw();

    this.onRequestInlineLabelEdit({
      mode: 'create',
      docX: Number(docX.toFixed(2)),
      docY: Number(docY.toFixed(2)),
      initialText: '',
      fontId: spec.id,
      fontSize: spec.defaultSizeDoc,
      color: theme.colors.ink,
      rotationDeg: 0,
      onEnd: () => this.setInlineEditingState(false, null)
    });
  }

  private openInlineEditorForExistingLabel(label: LabelObject): void {
    if (!this.onRequestInlineLabelEdit) return;
    this.store.selectObject(label.id);
    this.setInlineEditingState(true, label.id);

    this.onRequestInlineLabelEdit({
      mode: 'edit',
      docX: label.x,
      docY: label.y,
      objectId: label.id,
      initialText: label.text,
      fontId: label.fontId,
      fontSize: label.fontSize,
      color: label.color,
      rotationDeg: label.rotationDeg,
      onEnd: () => this.setInlineEditingState(false, null)
    });
  }

  private notifyLockedOrHiddenLayer(layerId: string, layers: readonly MapLayer[], fallbackName: string): void {
    const layer = layers.find((l) => l.id === layerId);
    this.store.setStatusNotice({
      tone: 'info',
      text: `Il livello «${layer?.name ?? fallbackName}» è bloccato o nascosto.`
    });
  }

  private attachPathWindowFallback(): void {
    this.detachPathWindowFallback();
    if (typeof window === 'undefined') return;
    const onWinPointerUp = () => {
      this.commitPathDraft();
    };
    const onWinPointerCancel = () => {
      this.cancelPathDraft();
    };
    const onWinKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelPathDraft();
      }
    };
    window.addEventListener('pointerup', onWinPointerUp);
    window.addEventListener('pointercancel', onWinPointerCancel);
    window.addEventListener('keydown', onWinKeyDown);
    this.detachPathWindowListeners = () => {
      window.removeEventListener('pointerup', onWinPointerUp);
      window.removeEventListener('pointercancel', onWinPointerCancel);
      window.removeEventListener('keydown', onWinKeyDown);
    };
  }

  private detachPathWindowFallback(): void {
    this.detachPathWindowListeners?.();
    this.detachPathWindowListeners = null;
  }

  private commitPathDraft(finalPoint?: Point2D): void {
    const draft = this.pathDraft;
    if (!draft) return;
    this.pathDraft = null;
    this.detachPathWindowFallback();

    if (finalPoint) {
      const lastX = draft.points[draft.points.length - 2];
      const lastY = draft.points[draft.points.length - 1];
      if (Math.hypot(finalPoint.x - lastX, finalPoint.y - lastY) >= 0.5) {
        draft.points.push(Number(finalPoint.x.toFixed(2)), Number(finalPoint.y.toFixed(2)));
      }
    }

    this.pathPreviewShape.visible(false);
    const snap = this.store.getSnapshot();

    if (draft.points.length >= 4 && computePolylineLength(draft.points) >= 3) {
      const toleranceDoc = clampNumber(snap.pathStrokeWidthDoc * 0.25, 1.5, 6);
      const simplified = simplifyPolyline(draft.points, toleranceDoc);
      if (simplified.length >= 4) {
        const pathObj = createPathObject({
          layerId: draft.layerId,
          kind: snap.pathKind,
          points: simplified,
          strokeWidthDoc: snap.pathStrokeWidthDoc,
          color: snap.pathColor,
          smooth: snap.pathSmooth,
          dashed: snap.pathDashed,
          tapered: snap.pathTapered,
          opacity: 1,
          theme: snap.doc.theme
        });
        this.store.executeCommand(
          new AddObjectCommand(pathObj, undefined, undefined, `Aggiungi ${getDefaultObjectLabel(pathObj)}`)
        );
        this.store.selectObject(pathObj.id);
      }
    }

    this.updateGhost(this.store.getSnapshot(), this.store.getEffectiveTool());
    this.layers.overlayLayer.batchDraw();
  }

  private cancelPathDraft(): void {
    if (!this.pathDraft) return;
    this.pathDraft = null;
    this.detachPathWindowFallback();
    this.pathPreviewShape.visible(false);
    this.updateGhost(this.store.getSnapshot(), this.store.getEffectiveTool());
    this.layers.overlayLayer.batchDraw();
  }

  handlePointerDown(ctx: ViewportPointerContext): boolean {
    if (this.disposed) return false;
    this.cursorInside = true;
    this.cursorDocPoint = { x: ctx.docX, y: ctx.docY };

    const snap = this.store.getSnapshot();
    const tool = snap.spacePanActive ? 'hand' : snap.activeTool;
    const { space } = snap.doc.manifest;

    if (tool === 'select') {
      if (this.layers.overlayLayer.listening()) {
        const overlayHit = this.layers.overlayLayer.getIntersection({ x: ctx.cssX, y: ctx.cssY });
        if (
          overlayHit &&
          (overlayHit.getParent() === this.transformer ||
            this.transformer.isAncestorOf(overlayHit))
        ) {
          return true;
        }
      }

      const hitObj = this.findTopmostObjectAt(snap.doc, ctx.docX, ctx.docY, ctx.cssX, ctx.cssY);
      if (hitObj) {
        this.store.selectObject(hitObj.id);
        return true;
      }

      this.store.selectObject(null);
      return true;
    }

    if (tool === 'path') {
      if (ctx.docX < 0 || ctx.docY < 0 || ctx.docX > space.width || ctx.docY > space.height) {
        return false;
      }
      const targetLayerId = this.store.resolveTargetLayerIdForNewObject('path');
      if (!this.store.isLayerEditable(targetLayerId)) {
        this.notifyLockedOrHiddenLayer(targetLayerId, snap.doc.manifest.layers, 'Fiumi e Strade');
        return true;
      }

      const pointerId = 'pointerId' in ctx.event ? ctx.event.pointerId : null;
      this.pathDraft = {
        points: [Number(ctx.docX.toFixed(2)), Number(ctx.docY.toFixed(2))],
        layerId: targetLayerId,
        pointerId
      };
      this.pathCursorRing.visible(false);
      this.pathPreviewShape.visible(true);
      this.pathPreviewShape.moveToTop();
      this.attachPathWindowFallback();
      this.layers.overlayLayer.batchDraw();
      return true;
    }

    if (tool === 'poi') {
      if (
        !snap.activePoiId ||
        ctx.docX < 0 ||
        ctx.docY < 0 ||
        ctx.docX > space.width ||
        ctx.docY > space.height
      ) {
        return false;
      }
      const catalogItem = getCatalogItemById(snap.activePoiId);
      if (!catalogItem) return false;

      const targetLayerId = this.store.resolveTargetLayerIdForNewObject('stamp');
      if (!this.store.isLayerEditable(targetLayerId)) {
        this.notifyLockedOrHiddenLayer(targetLayerId, snap.doc.manifest.layers, 'Luoghi e POI');
        return true;
      }

      if (snap.poiBrushMode === 'scatter') {
        const count = Math.max(2, Math.round(snap.poiScatterDensity));
        const radius = Math.max(10, snap.poiScatterRadiusDoc);
        const sector = (Math.PI * 2) / count;
        const stamps = Array.from({ length: count }, (_, idx) => {
          const angle = sector * idx + (Math.random() - 0.5) * sector * 0.75;
          const dist = radius * (0.2 + 0.8 * Math.sqrt(Math.random()));
          const px = Number(
            clampNumber(ctx.docX + Math.cos(angle) * dist, 0, space.width).toFixed(2)
          );
          const py = Number(
            clampNumber(ctx.docY + Math.sin(angle) * dist, 0, space.height).toFixed(2)
          );
          const itemScale = snap.poiPlacementScale * (0.85 + Math.random() * 0.3);
          return createPoiStampObject(catalogItem, px, py, {
            layerId: targetLayerId,
            scale: itemScale
          });
        });

        this.store.executeCommand(
          new AddObjectsBatchCommand(stamps, 'Pennellata POI scatter', [catalogItem.asset])
        );
        if (stamps.length > 0) {
          this.store.selectObject(stamps[stamps.length - 1].id);
        }
        return true;
      }

      const stamp = createPoiStampObject(
        catalogItem,
        Number(ctx.docX.toFixed(2)),
        Number(ctx.docY.toFixed(2)),
        {
          layerId: targetLayerId,
          scale: snap.poiPlacementScale
        }
      );
      this.store.executeCommand(
        new AddObjectCommand(stamp, undefined, catalogItem.asset, `Aggiungi ${catalogItem.name}`)
      );
      this.store.selectObject(stamp.id);
      return true;
    }

    if (tool === 'label') {
      if (this.inlineEditingSessionActive && this.isAnyInlineEditorMounted()) {
        return true;
      }
      this.inlineEditingSessionActive = false;
      if (ctx.docX < 0 || ctx.docY < 0 || ctx.docX > space.width || ctx.docY > space.height) {
        return false;
      }

      const hitObj = this.findTopmostObjectAt(snap.doc, ctx.docX, ctx.docY);
      if (hitObj && hitObj.type === 'label') {
        this.store.selectObject(hitObj.id);
        return true;
      }

      const targetLabelLayerId = resolveObjectLayerId({ type: 'label' }, snap.doc.manifest.layers);
      if (!this.store.isLayerEditable(targetLabelLayerId)) {
        this.notifyLockedOrHiddenLayer(targetLabelLayerId, snap.doc.manifest.layers, 'Nomi e Note');
        return true;
      }

      this.openInlineEditorForNewLabel(ctx.docX, ctx.docY, snap.doc.theme);
      return true;
    }

    return false;
  }

  handlePointerMove(ctx: ViewportPointerContext): void {
    if (this.disposed) return;
    this.cursorInside = true;
    this.cursorDocPoint = { x: ctx.docX, y: ctx.docY };

    const snap = this.store.getSnapshot();
    const tool = snap.spacePanActive ? 'hand' : snap.activeTool;

    if (this.pathDraft && tool === 'path') {
      const { space } = snap.doc.manifest;
      const clampedX = Number(clampNumber(ctx.docX, 0, space.width).toFixed(2));
      const clampedY = Number(clampNumber(ctx.docY, 0, space.height).toFixed(2));
      const pts = this.pathDraft.points;
      const lastX = pts[pts.length - 2];
      const lastY = pts[pts.length - 1];
      if (Math.hypot(clampedX - lastX, clampedY - lastY) >= 3) {
        pts.push(clampedX, clampedY);
        this.pathPreviewShape.moveToTop();
        this.layers.overlayLayer.batchDraw();
      }
      return;
    }

    if (this.updateGhost(snap, tool)) {
      this.layers.overlayLayer.batchDraw();
    }
  }

  handlePointerUp(ctx: ViewportPointerContext): void {
    if (this.disposed) return;
    if (this.pathDraft) {
      const { space } = this.store.getDocument().manifest;
      const clampedX = clampNumber(ctx.docX, 0, space.width);
      const clampedY = clampNumber(ctx.docY, 0, space.height);
      this.commitPathDraft({ x: clampedX, y: clampedY });
    }
  }

  handlePointerLeave(): void {
    if (this.disposed) return;
    this.cursorInside = false;
    const snap = this.store.getSnapshot();
    const tool = snap.spacePanActive ? 'hand' : snap.activeTool;
    if (this.updateGhost(snap, tool)) {
      this.layers.overlayLayer.batchDraw();
    }
  }

  handleDoubleClick(ctx: ViewportPointerContext): void {
    if (this.disposed) return;
    const snap = this.store.getSnapshot();
    const tool = snap.spacePanActive ? 'hand' : snap.activeTool;
    if (tool !== 'select' && tool !== 'label') return;

    const hitObj = this.findTopmostObjectAt(snap.doc, ctx.docX, ctx.docY, ctx.cssX, ctx.cssY);
    if (hitObj && hitObj.type === 'label') {
      this.openInlineEditorForExistingLabel(hitObj);
    }
  }

  handleKeyDown(e: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    target: EventTarget | null;
    preventDefault?: () => void;
  }): boolean {
    if (this.disposed) return false;
    if (shouldIgnoreShortcut(e.target)) {
      return false;
    }
    if (e.key === 'Escape' && this.pathDraft) {
      e.preventDefault?.();
      this.cancelPathDraft();
      return true;
    }

    const snap = this.store.getSnapshot();
    if (snap.activeDialog !== null || (this.inlineEditingSessionActive && this.isAnyInlineEditorMounted())) {
      return false;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const selectedId = snap.selectedObjectId;
      if (!selectedId) return false;
      const target = snap.doc.manifest.objects.find((o) => o.id === selectedId);
      if (!target) return false;

      e.preventDefault?.();
      if (!this.isObjectLayerEditable(target, snap.doc.manifest.layers)) {
        const layerId = resolveObjectLayerId(target, snap.doc.manifest.layers);
        this.notifyLockedOrHiddenLayer(layerId, snap.doc.manifest.layers, 'Livello');
        return true;
      }

      this.store.executeCommand(
        new DeleteObjectCommand(target.id, getDeleteObjectLabel(target))
      );
      return true;
    }

    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.detachStageLeave?.();
    this.detachStageLeave = null;
    this.detachPathWindowFallback();
    this.pathDraft = null;

    this.transformer.nodes([]);
    this.transformer.destroy();
    this.ghostGroup.destroy();
    this.ghostLabelPill.destroy();
    this.pathCursorRing.destroy();
    this.pathPreviewShape.destroy();

    for (const node of this.nodeMap.values()) {
      node.destroy();
    }
    this.nodeMap.clear();
    this.syncedObjectMap.clear();

    for (const group of this.layerGroupMap.values()) {
      group.destroy();
    }
    this.layerGroupMap.clear();

    for (const cached of this.assetCache.values()) {
      if (cached.objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(cached.objectUrl);
      }
    }
    this.assetCache.clear();
  }
}
