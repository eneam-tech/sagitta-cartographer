import type Konva from 'konva';
import KonvaRuntime from 'konva/lib/index.js';
import { getCatalogItemById, svgToDataUrl } from '../assets/catalog';
import {
  findNearestUrbanStreet,
  findOverlappingBuildingIdsForPlaza,
  findSnapPointForPathKind,
  getCityThemePalette,
  sampleLandMaskAtDoc
} from '../city/geometry';
import {
  findBuildingsInBrushStroke,
  generateDistrictBuildingsAlongStroke
} from '../city/smartDistrictBrush';
import {
  buildSmartCityWallObjects,
  generateStreetGridInRect
} from '../city/streetGridTool';
import { Point2D, clampNumber } from '../model/coordinates';
import {
  AssetManifestEntry,
  BuildingObject,
  LabelObject,
  MapDocument,
  MapLayer,
  MapObject,
  PathKind,
  PathObject,
  PlazaObject,
  StampObject,
  cloneMapObject,
  resolveObjectLayerId
} from '../model/document';
import {
  AddAndDeleteObjectsCommand,
  AddObjectCommand,
  AddObjectsBatchCommand,
  DeleteObjectCommand,
  DeleteObjectsBatchCommand,
  areMapObjectsEqual,
  commitObjectUpdate,
  createBuildingObject,
  createPathObject,
  createPlazaObject,
  createPoiStampObject,
  getDefaultObjectLabel,
  getDeleteObjectLabel,
  getPathKindDefaults,
  normalizeRotationDeg,
  simplifyPolyline
} from '../objects/objectCommands';
import { drawBuildingToContext, drawPlazaToContext } from '../render/cityRenderer';
import {
  NetworkGroup,
  NetworkPass,
  drawPathToContext,
  getNetworkFillSubOrder,
  getObjectNetworkGroup,
  resolveLabelHaloWidth,
  sampleSmoothPathPoints
} from '../render/objectMetrics';
import { buildNaturalRiverSpine } from '../render/riverRenderer';
import { EditorSnapshot, EditorStore, shouldIgnoreShortcut } from '../state/editorStore';
import { MapTheme, getDefaultLabelColor, getFontSpec } from '../theme/theme';
import type { ViewportLayersHandle, ViewportPointerContext } from './MapViewport';

const KonvaCtor = KonvaRuntime as unknown as typeof Konva;

export interface InlineLabelEditRequest {
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
  tool: 'path' | 'street' | 'cityWall';
  points: number[];
  layerId: string;
  buildingLayerId: string;
  pointerId: number | null;
}

interface ActiveDistrictDraft {
  points: Array<{ x: number; y: number }>;
  layerId: string;
  pointerId: number | null;
}

interface ActiveStreetGridDraft {
  startDoc: Point2D;
  endDoc: Point2D;
  streetLayerId: string;
  buildingLayerId: string;
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

const NETWORK_GROUP_ORDER: readonly NetworkGroup[] = ['river', 'canal', 'street', 'wall'];

function getLocalPathHitPoints(pathObj: PathObject): number[] {
  if (pathObj.kind === 'river') {
    const { points } = buildNaturalRiverSpine(pathObj);
    if (points.length >= 2) {
      const out = new Array<number>(points.length * 2);
      for (let i = 0; i < points.length; i += 1) {
        out[i * 2] = points[i].x;
        out[i * 2 + 1] = points[i].y;
      }
      return out;
    }
  }
  return pathObj.smooth !== false ? sampleSmoothPathPoints(pathObj.points, 5) : pathObj.points;
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
  const meanderPad = pathObj.kind === 'river' ? 18 : 0;
  const pad = Math.max(6, pathObj.strokeWidthDoc * 0.65) + meanderPad;
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(12, maxX - minX + pad * 2),
    height: Math.max(12, maxY - minY + pad * 2)
  };
}

function computeCenteredBoxSelfRect(
  width: number,
  height: number,
  pad = 2
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const w = Math.max(8, width);
  const h = Math.max(8, height);
  return {
    x: -w * 0.5 - pad,
    y: -h * 0.5 - pad,
    width: w + pad * 2,
    height: h + pad * 2
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

  if (obj.type === 'building') {
    const hw = obj.width * 0.5 + 3;
    const hh = obj.height * 0.5 + 3;
    return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
  }

  if (obj.type === 'plaza') {
    const hw = obj.width * 0.5 + 3;
    const hh = obj.height * 0.5 + 3;
    if (obj.shape === 'circle') {
      const rx = Math.max(4, hw);
      const ry = Math.max(4, hh);
      return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
    }
    return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
  }

  if (obj.type === 'path') {
    const pts = getLocalPathHitPoints(obj);
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

function resolveBuildingPlacementRotation(
  doc: MapDocument,
  docX: number,
  docY: number,
  fallbackDeg: number,
  autoAlign: boolean
): number {
  if (!autoAlign) {
    return normalizeRotationDeg(fallbackDeg);
  }
  const nearest = findNearestUrbanStreet(doc, docX, docY, 140);
  if (!nearest) {
    return normalizeRotationDeg(fallbackDeg);
  }
  return normalizeRotationDeg(nearest.angleDeg + fallbackDeg);
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
 * `MapLayer`s with visibility/opacity/lock enforcement for stamps, labels, vector
 * paths, buildings, and plazas) and `overlayLayer` (two-tone Transformer, cursor
 * ghosts, smart city brush/grid/snap previews, and live vector stroke previews).
 */
export class ObjectsLayerController {
  private readonly layers: ViewportLayersHandle;
  private readonly store: EditorStore;
  private readonly onRequestInlineLabelEdit?: (request: InlineLabelEditRequest) => void;

  private readonly layerGroupMap = new Map<string, Konva.Group>();
  private readonly layerNetworkCasingShapes = new Map<string, Map<NetworkGroup, Konva.Shape>>();
  private readonly layerNetworkMembers = new Map<string, Map<NetworkGroup, MapObject[]>>();
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
  private readonly streetSnapRing: Konva.Circle;
  private readonly pathPreviewShape: Konva.Shape;
  private readonly districtBrushCircle: Konva.Circle;
  private readonly districtStrokePreview: Konva.Line;
  private readonly cityGhostShape: Konva.Shape;
  private readonly streetGridPreviewShape: Konva.Shape;

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
  private lastCityToolSignature = '';
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
  private districtDraft: ActiveDistrictDraft | null = null;
  private streetGridDraft: ActiveStreetGridDraft | null = null;

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

    this.streetSnapRing = new KonvaCtor.Circle({
      visible: false,
      x: 0,
      y: 0,
      radius: 10,
      stroke: '#9CDEEF',
      strokeWidth: 2,
      strokeScaleEnabled: false,
      fill: 'rgba(156, 222, 239, 0.18)',
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
        const theme = snap.doc.theme;

        let kind: PathKind = snap.pathKind;
        let strokeWidthDoc = snap.pathStrokeWidthDoc;
        let color = snap.pathColor;
        let smooth = snap.pathSmooth;
        let dashed = snap.pathDashed;
        let tapered = snap.pathTapered;

        if (draft.tool === 'street') {
          kind = snap.streetPathKind;
          strokeWidthDoc = snap.streetStrokeWidthDoc;
          const defaults = getPathKindDefaults(kind, theme);
          color = defaults.color;
          smooth = kind === 'canal';
          dashed = false;
          tapered = false;
        } else if (draft.tool === 'cityWall') {
          kind = 'wall';
          strokeWidthDoc = snap.wallStrokeWidthDoc;
          const defaults = getPathKindDefaults('wall', theme);
          color = defaults.color;
          smooth = false;
          dashed = false;
          tapered = false;
        }

        if (draft.points.length < 4) {
          rawCtx.save();
          rawCtx.fillStyle = color;
          rawCtx.globalAlpha *= 0.85;
          rawCtx.beginPath();
          rawCtx.arc(
            draft.points[0],
            draft.points[1],
            Math.max(1.5, strokeWidthDoc * 0.5),
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
          kind,
          x: 0,
          y: 0,
          rotationDeg: 0,
          points: draft.points,
          strokeWidthDoc,
          color,
          opacity: 0.88,
          dashed,
          tapered,
          smooth
        };
        drawPathToContext(rawCtx, previewObj, 1, 1, theme, {
          pass: 'full',
          doc: snap.doc
        });
      }
    });

    this.districtBrushCircle = new KonvaCtor.Circle({
      visible: false,
      x: 0,
      y: 0,
      radius: 55,
      stroke: '#E0BB79',
      strokeWidth: 1.75,
      strokeScaleEnabled: false,
      dash: [7, 5],
      fill: 'rgba(224, 187, 121, 0.08)',
      listening: false
    });

    this.districtStrokePreview = new KonvaCtor.Line({
      visible: false,
      points: [],
      stroke: 'rgba(224, 187, 121, 0.28)',
      strokeWidth: 110,
      lineCap: 'round',
      lineJoin: 'round',
      listening: false
    });

    this.cityGhostShape = new KonvaCtor.Shape({
      visible: false,
      opacity: 0.72,
      listening: false,
      perfectDrawEnabled: false,
      sceneFunc: (ctx, konvaShape) => {
        const rawCtx = (ctx as unknown as { _context?: CanvasRenderingContext2D })._context;
        if (!rawCtx) return;
        const theme = this.store.getDocument().theme;
        const ghostBldg = konvaShape.getAttr('ghostBuilding') as BuildingObject | undefined;
        if (ghostBldg) {
          drawBuildingToContext(rawCtx, ghostBldg, theme, 1, 1, { applyTransform: false });
          return;
        }
        const ghostPlaza = konvaShape.getAttr('ghostPlaza') as PlazaObject | undefined;
        if (ghostPlaza) {
          drawPlazaToContext(rawCtx, ghostPlaza, theme, 1, 1, { applyTransform: false });
        }
      }
    });

    this.streetGridPreviewShape = new KonvaCtor.Shape({
      visible: false,
      listening: false,
      perfectDrawEnabled: false,
      sceneFunc: (ctx) => {
        const draft = this.streetGridDraft;
        if (!draft) return;
        const rawCtx = (ctx as unknown as { _context?: CanvasRenderingContext2D })._context;
        if (!rawCtx) return;
        const snap = this.store.getSnapshot();
        const x0 = Math.min(draft.startDoc.x, draft.endDoc.x);
        const y0 = Math.min(draft.startDoc.y, draft.endDoc.y);
        const w = Math.abs(draft.endDoc.x - draft.startDoc.x);
        const h = Math.abs(draft.endDoc.y - draft.startDoc.y);
        if (w < 4 || h < 4) return;

        rawCtx.save();
        rawCtx.fillStyle = 'rgba(156, 222, 239, 0.08)';
        rawCtx.strokeStyle = '#9CDEEF';
        rawCtx.lineWidth = 1.5;
        rawCtx.setLineDash([6, 4]);
        rawCtx.fillRect(x0, y0, w, h);
        rawCtx.strokeRect(x0, y0, w, h);

        const spacing = clampNumber(snap.streetGridSpacingDoc, 48, 220);
        const cx = x0 + w * 0.5;
        const cy = y0 + h * 0.5;
        rawCtx.strokeStyle = 'rgba(224, 187, 121, 0.78)';
        rawCtx.lineWidth = 2;
        rawCtx.setLineDash([4, 4]);
        rawCtx.beginPath();

        if (snap.streetGridStyle === 'radial') {
          const maxR = Math.min(w, h) * 0.48;
          for (let r = spacing * 0.75; r <= maxR; r += spacing) {
            rawCtx.moveTo(cx + r, cy);
            rawCtx.arc(cx, cy, r, 0, Math.PI * 2);
          }
          const spokes = 6;
          for (let i = 0; i < spokes; i += 1) {
            const a = ((snap.streetGridAngleDeg * Math.PI) / 180) + (i * Math.PI) / (spokes * 0.5);
            rawCtx.moveTo(cx, cy);
            rawCtx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
          }
        } else if (snap.streetGridStyle === 'organic') {
          const hubX = x0 + w * 0.46;
          const hubY = y0 + h * 0.48;
          rawCtx.save();
          rawCtx.beginPath();
          rawCtx.rect(x0, y0, w, h);
          rawCtx.clip();

          // 3 curved primary arterials converging organically across the rect
          rawCtx.lineWidth = 2.6;
          rawCtx.beginPath();
          rawCtx.moveTo(x0, y0 + h * 0.32);
          rawCtx.quadraticCurveTo(hubX, hubY - h * 0.04, x0 + w, y0 + h * 0.62);
          rawCtx.moveTo(x0 + w * 0.34, y0);
          rawCtx.quadraticCurveTo(hubX + w * 0.04, hubY, x0 + w * 0.62, y0 + h);
          rawCtx.moveTo(hubX - w * 0.02, hubY);
          rawCtx.quadraticCurveTo(x0 + w * 0.72, y0 + h * 0.28, x0 + w, y0 + h * 0.18);
          rawCtx.stroke();

          // Irregular connecting secondary collector branches
          rawCtx.lineWidth = 1.6;
          rawCtx.beginPath();
          const branches: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
            [0.24, 0.38, 0.28, 0.56, 0.2, 0.78],
            [0.39, 0.2, 0.56, 0.24, 0.74, 0.28],
            [0.72, 0.28, 0.78, 0.48, 0.72, 0.54],
            [0.34, 0.66, 0.48, 0.69, 0.57, 0.76],
            [0.62, 0.53, 0.69, 0.71, 0.84, 0.82],
            [0.14, 0.45, 0.32, 0.41, 0.42, 0.21]
          ];
          for (const [x1, y1, cx1, cy1, x2, y2] of branches) {
            rawCtx.moveTo(x0 + w * x1, y0 + h * y1);
            rawCtx.quadraticCurveTo(x0 + w * cx1, y0 + h * cy1, x0 + w * x2, y0 + h * y2);
          }
          rawCtx.stroke();
          rawCtx.restore();
          rawCtx.restore();
          return;
        } else {
          const rad = (snap.streetGridAngleDeg * Math.PI) / 180;
          const diag = Math.hypot(w, h) * 0.52;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          rawCtx.save();
          rawCtx.beginPath();
          rawCtx.rect(x0, y0, w, h);
          rawCtx.clip();
          rawCtx.beginPath();
          for (let d = -diag; d <= diag; d += spacing) {
            rawCtx.moveTo(cx + cos * -diag - sin * d, cy + sin * -diag + cos * d);
            rawCtx.lineTo(cx + cos * diag - sin * d, cy + sin * diag + cos * d);
            rawCtx.moveTo(cx + cos * d - sin * -diag, cy + sin * d + cos * -diag);
            rawCtx.lineTo(cx + cos * d - sin * diag, cy + sin * d + cos * diag);
          }
          rawCtx.stroke();
          rawCtx.restore();
          rawCtx.restore();
          return;
        }

        rawCtx.stroke();
        rawCtx.restore();
      }
    });

    this.layers.overlayLayer.add(
      this.ghostGroup,
      this.ghostLabelPill,
      this.pathCursorRing,
      this.streetSnapRing,
      this.pathPreviewShape,
      this.districtStrokePreview,
      this.districtBrushCircle,
      this.cityGhostShape,
      this.streetGridPreviewShape
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
    const isTouchOrCoarse =
      (typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches) ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    const tr = new KonvaCtor.Transformer({
      visible: false,
      rotateEnabled: true,
      rotateLineVisible: true,
      rotateAnchorOffset: isTouchOrCoarse ? 36 : 28,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      rotationSnapTolerance: 3,
      anchorSize: isTouchOrCoarse ? 20 : 12,
      anchorFill: '#F3EEDF',
      anchorStroke: '#17232D',
      anchorStrokeWidth: isTouchOrCoarse ? 2 : 1.75,
      anchorCornerRadius: isTouchOrCoarse ? 4 : 2,
      borderEnabled: true,
      borderStroke: '#9CDEEF',
      borderStrokeWidth: 1.5,
      keepRatio: true,
      flipEnabled: false,
      ignoreStroke: true,
      padding: isTouchOrCoarse ? 6 : 4,
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

    if (this.pathDraft && effectiveTool !== this.pathDraft.tool) {
      this.cancelPathDraft();
    }
    if (this.districtDraft && effectiveTool !== 'district') {
      this.cancelDistrictDraft();
    }
    if (this.streetGridDraft && effectiveTool !== 'streetGrid') {
      this.cancelStreetGridDraft();
    }

    const themeSignature = `${doc.theme.id}:${doc.theme.version}:${doc.theme.colors.labelHalo}:${JSON.stringify(doc.theme.fonts)}:${JSON.stringify(doc.theme.city ?? null)}`;
    const pathStyleSignature = `${snapshot.pathKind}:${snapshot.pathStrokeWidthDoc}:${snapshot.pathColor}:${snapshot.pathSmooth}:${snapshot.pathDashed}:${snapshot.pathTapered}`;
    const cityToolSignature = [
      snapshot.districtMode,
      snapshot.districtDiameterDoc,
      snapshot.buildingShape,
      snapshot.buildingWidthDoc,
      snapshot.buildingHeightDoc,
      snapshot.buildingRotationDeg,
      snapshot.buildingRoofColor,
      snapshot.buildingAutoAlign,
      snapshot.buildingRenderStyle,
      snapshot.streetPathKind,
      snapshot.streetStrokeWidthDoc,
      snapshot.streetSnapEnabled,
      snapshot.streetGridStyle,
      snapshot.streetGridSpacingDoc,
      snapshot.streetGridAngleDeg,
      snapshot.plazaShape,
      snapshot.plazaSizeDoc,
      snapshot.plazaCenterpiece,
      snapshot.wallStrokeWidthDoc
    ].join(':');

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
    const cityToolChanged = cityToolSignature !== this.lastCityToolSignature;
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
      !cityToolChanged &&
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

      // Track network buckets per layer for seamless two-pass casing->fill compositing
      const layerBuckets = new Map<
        string,
        Record<NetworkGroup | 'other', MapObject[]>
      >();
      for (const layer of nonTerrainLayers) {
        layerBuckets.set(layer.id, {
          river: [],
          canal: [],
          street: [],
          wall: [],
          other: []
        });
      }

      for (let i = 0; i < objects.length; i += 1) {
        const obj = objects[i];
        seenIds.add(obj.id);
        const targetLayerId = resolveObjectLayerId(obj, doc.manifest.layers);
        const targetGroup = this.layerGroupMap.get(targetLayerId);
        const layerEditable = this.isLayerIdEditable(targetLayerId, doc.manifest.layers);

        const bucket = layerBuckets.get(targetLayerId);
        const netGroup = getObjectNetworkGroup(obj);
        if (bucket) {
          bucket[netGroup ?? 'other'].push(obj);
        }

        let node = this.nodeMap.get(obj.id);

        if (node) {
          const expectedType =
            obj.type === 'stamp' ? 'Image' : obj.type === 'label' ? 'Text' : 'Shape';
          if (node.getClassName() !== expectedType || node.getAttr('objectKind') !== obj.type) {
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
          const casingMap = this.layerNetworkCasingShapes.get(layerId);
          if (casingMap) {
            for (const cShape of casingMap.values()) {
              cShape.destroy();
            }
            this.layerNetworkCasingShapes.delete(layerId);
          }
          this.layerNetworkMembers.delete(layerId);
          group.destroy();
          this.layerGroupMap.delete(layerId);
          objectsLayerDirty = true;
        }
      }

      // Synchronize two-pass casing underlays (when >= 2 network members share a layer)
      // and enforce identical intra-layer z-order as drawMapObjectsToContext().
      for (const layer of nonTerrainLayers) {
        const group = this.layerGroupMap.get(layer.id);
        const bucket = layerBuckets.get(layer.id);
        if (!group || !bucket) continue;

        let casingShapes = this.layerNetworkCasingShapes.get(layer.id);
        if (!casingShapes) {
          casingShapes = new Map();
          this.layerNetworkCasingShapes.set(layer.id, casingShapes);
        }
        let membersByNet = this.layerNetworkMembers.get(layer.id);
        if (!membersByNet) {
          membersByNet = new Map();
          this.layerNetworkMembers.set(layer.id, membersByNet);
        }

        const orderedChildren: Konva.Node[] = [];

        for (const netGroup of NETWORK_GROUP_ORDER) {
          const members = bucket[netGroup];
          const useMergedCasing = members.length >= 2;
          membersByNet.set(netGroup, useMergedCasing ? members : []);

          let casingShape = casingShapes.get(netGroup);
          if (useMergedCasing) {
            if (!casingShape) {
              casingShape = this.createNetworkCasingShape(layer.id, netGroup);
              group.add(casingShape);
              casingShapes.set(netGroup, casingShape);
              objectsLayerDirty = true;
            }
            if (!casingShape.visible()) {
              casingShape.visible(true);
              objectsLayerDirty = true;
            }
            orderedChildren.push(casingShape);
          } else if (casingShape) {
            casingShape.destroy();
            casingShapes.delete(netGroup);
            objectsLayerDirty = true;
          }

          const fillMembers =
            netGroup === 'street' && members.length > 1
              ? [...members].sort(
                  (a, b) => getNetworkFillSubOrder(a) - getNetworkFillSubOrder(b)
                )
              : members;
          const memberPass: NetworkPass = useMergedCasing ? 'fill' : 'full';
          for (const member of fillMembers) {
            const mNode = this.nodeMap.get(member.id);
            if (!mNode) continue;
            if (mNode.getAttr('networkRenderPass') !== memberPass) {
              mNode.setAttr('networkRenderPass', memberPass);
              objectsLayerDirty = true;
            }
            orderedChildren.push(mNode);
          }
        }

        for (const other of bucket.other) {
          const oNode = this.nodeMap.get(other.id);
          if (!oNode) continue;
          if (oNode.getAttr('networkRenderPass') !== 'full') {
            oNode.setAttr('networkRenderPass', 'full');
          }
          orderedChildren.push(oNode);
        }

        for (let z = 0; z < orderedChildren.length; z += 1) {
          const child = orderedChildren[z];
          if (child.zIndex() !== z) {
            child.zIndex(z);
            objectsLayerDirty = true;
          }
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
      this.transformer.keepRatio(selectedObj.type === 'stamp' || selectedObj.type === 'label');
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
    this.lastCityToolSignature = cityToolSignature;
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

    const isLineDrawTool =
      effectiveTool === 'path' || effectiveTool === 'street' || effectiveTool === 'cityWall';
    const resolvedSnap =
      this.cursorInside && !inlineActive && isLineDrawTool
        ? this.resolveSnapForLineTool(
            snapshot,
            effectiveTool,
            this.cursorDocPoint.x,
            this.cursorDocPoint.y
          )
        : null;
    const snapPoint = resolvedSnap?.hit ?? null;

    if (resolvedSnap && resolvedSnap.hit.snapped) {
      this.streetSnapRing.setAttrs({
        visible: true,
        x: resolvedSnap.hit.x,
        y: resolvedSnap.hit.y,
        radius: Math.max(8, resolvedSnap.strokeW * 0.65),
        stroke: resolvedSnap.isWater ? '#9CDEEF' : '#E0BB79',
        fill: resolvedSnap.isWater
          ? 'rgba(156, 222, 239, 0.18)'
          : 'rgba(224, 187, 121, 0.18)'
      });
      this.streetSnapRing.moveToTop();
      dirty = true;
    } else if (this.streetSnapRing.visible()) {
      this.streetSnapRing.visible(false);
      dirty = true;
    }

    const showPathCursor = isLineDrawTool && this.cursorInside && !this.pathDraft && !inlineActive;
    if (showPathCursor) {
      let radius = Math.max(3, snapshot.pathStrokeWidthDoc * 0.5);
      let stroke = snapshot.pathColor;
      if (effectiveTool === 'street') {
        radius = Math.max(3, snapshot.streetStrokeWidthDoc * 0.5);
        stroke = getPathKindDefaults(snapshot.streetPathKind, snapshot.doc.theme).color;
      } else if (effectiveTool === 'cityWall') {
        radius = Math.max(3, snapshot.wallStrokeWidthDoc * 0.5);
        stroke = getPathKindDefaults('wall', snapshot.doc.theme).color;
      }
      this.pathCursorRing.setAttrs({
        visible: true,
        x: snapPoint?.snapped ? snapPoint.x : this.cursorDocPoint.x,
        y: snapPoint?.snapped ? snapPoint.y : this.cursorDocPoint.y,
        radius,
        stroke
      });
      this.pathCursorRing.moveToTop();
      dirty = true;
    } else if (this.pathCursorRing.visible()) {
      this.pathCursorRing.visible(false);
      dirty = true;
    }

    const showDistrictCursor = effectiveTool === 'district' && this.cursorInside && !inlineActive;
    if (showDistrictCursor) {
      const isErase = snapshot.districtMode === 'erase';
      this.districtBrushCircle.setAttrs({
        visible: true,
        x: this.cursorDocPoint.x,
        y: this.cursorDocPoint.y,
        radius: Math.max(12, snapshot.districtDiameterDoc * 0.5),
        stroke: isErase ? '#FFB3A6' : '#E0BB79',
        fill: isErase ? 'rgba(255, 179, 166, 0.1)' : 'rgba(224, 187, 121, 0.08)'
      });
      this.districtBrushCircle.moveToTop();
      dirty = true;
    } else if (this.districtBrushCircle.visible()) {
      this.districtBrushCircle.visible(false);
      dirty = true;
    }

    const showCityGhost =
      (effectiveTool === 'building' || effectiveTool === 'plaza') &&
      this.cursorInside &&
      !inlineActive;
    if (showCityGhost) {
      if (effectiveTool === 'building') {
        const rotationDeg = resolveBuildingPlacementRotation(
          snapshot.doc,
          this.cursorDocPoint.x,
          this.cursorDocPoint.y,
          snapshot.buildingRotationDeg,
          snapshot.buildingAutoAlign
        );
        const ghostBldg: BuildingObject = {
          id: '__ghost-building__',
          type: 'building',
          shape: snapshot.buildingShape,
          x: this.cursorDocPoint.x,
          y: this.cursorDocPoint.y,
          width: snapshot.buildingWidthDoc,
          height: snapshot.buildingHeightDoc,
          rotationDeg,
          roofColor: snapshot.buildingRoofColor,
          ...(snapshot.buildingRenderStyle !== 'auto'
            ? { renderStyle: snapshot.buildingRenderStyle }
            : {})
        };
        this.cityGhostShape.setAttr('ghostBuilding', ghostBldg);
        this.cityGhostShape.setAttr('ghostPlaza', undefined);
        this.cityGhostShape.setAttrs({
          visible: true,
          x: ghostBldg.x,
          y: ghostBldg.y,
          rotation: ghostBldg.rotationDeg
        });
      } else {
        const palette = getCityThemePalette(snapshot.doc.theme);
        const w = snapshot.plazaSizeDoc;
        const h =
          snapshot.plazaShape === 'rect'
            ? Math.max(24, Math.round(snapshot.plazaSizeDoc * 0.76))
            : snapshot.plazaSizeDoc;
        const ghostPlaza: PlazaObject = {
          id: '__ghost-plaza__',
          type: 'plaza',
          shape: snapshot.plazaShape,
          x: this.cursorDocPoint.x,
          y: this.cursorDocPoint.y,
          width: w,
          height: h,
          rotationDeg: 0,
          fillColor: palette.plazaFill,
          borderColor: palette.streetBorder,
          centerpiece: snapshot.plazaCenterpiece
        };
        this.cityGhostShape.setAttr('ghostBuilding', undefined);
        this.cityGhostShape.setAttr('ghostPlaza', ghostPlaza);
        this.cityGhostShape.setAttrs({
          visible: true,
          x: ghostPlaza.x,
          y: ghostPlaza.y,
          rotation: 0
        });
      }
      this.cityGhostShape.moveToTop();
      dirty = true;
    } else if (this.cityGhostShape.visible()) {
      this.cityGhostShape.visible(false);
      dirty = true;
    }

    return dirty;
  }

  private createNetworkCasingShape(layerId: string, netGroup: NetworkGroup): Konva.Shape {
    return new KonvaCtor.Shape({
      id: `__casing-${layerId}-${netGroup}`,
      name: `network-casing-${netGroup}`,
      listening: false,
      perfectDrawEnabled: false,
      sceneFunc: (ctx) => {
        const members = this.layerNetworkMembers.get(layerId)?.get(netGroup);
        if (!members || members.length < 2) return;
        const rawCtx = (ctx as unknown as { _context?: CanvasRenderingContext2D })._context;
        if (!rawCtx) return;
        const doc = this.store.getDocument();

        const drawMemberCasing = (
          member: MapObject,
          wallCasingPhase: 'shadow' | 'ink' | 'both'
        ) => {
          const mNode = this.nodeMap.get(member.id);
          if (!mNode || !mNode.visible()) return;
          const nx = mNode.x();
          const ny = mNode.y();
          const rot = mNode.rotation();
          const sx = mNode.scaleX();
          const sy = mNode.scaleY();

          rawCtx.save();
          rawCtx.translate(nx, ny);
          rawCtx.rotate((rot * Math.PI) / 180);
          rawCtx.scale(sx, sy);

          if (member.type === 'plaza') {
            const pObj = (mNode.getAttr('plazaObject') as PlazaObject | undefined) ?? member;
            drawPlazaToContext(rawCtx, { ...pObj, rotationDeg: rot }, doc.theme, 1, 1, {
              applyTransform: false,
              pass: 'casing'
            });
          } else if (member.type === 'path') {
            const pathObj = (mNode.getAttr('pathObject') as PathObject | undefined) ?? member;
            drawPathToContext(
              rawCtx,
              { ...pathObj, x: 0, y: 0, rotationDeg: 0 },
              1,
              1,
              doc.theme,
              {
                pass: 'casing',
                doc,
                worldOrigin: { x: nx, y: ny, rotationDeg: rot },
                wallCasingPhase
              }
            );
          }
          rawCtx.restore();
        };

        if (netGroup === 'wall') {
          for (const member of members) {
            drawMemberCasing(member, 'shadow');
          }
          for (const member of members) {
            drawMemberCasing(member, 'ink');
          }
          return;
        }

        for (const member of members) {
          drawMemberCasing(member, 'both');
        }
      }
    });
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
    } else if (obj.type === 'building') {
      const shape = new KonvaCtor.Shape({
        id: obj.id,
        draggable,
        perfectDrawEnabled: false,
        sceneFunc: (ctx, konvaShape) => {
          const bObj = konvaShape.getAttr('buildingObject') as BuildingObject | undefined;
          if (!bObj) return;
          const rawCtx = (ctx as unknown as { _context?: CanvasRenderingContext2D })._context;
          if (!rawCtx) return;
          drawBuildingToContext(
            rawCtx,
            { ...bObj, rotationDeg: konvaShape.rotation() },
            this.store.getDocument().theme,
            1,
            1,
            { applyTransform: false }
          );
        },
        hitFunc: (ctx, konvaShape) => {
          const bObj = konvaShape.getAttr('buildingObject') as BuildingObject | undefined;
          if (!bObj) return;
          ctx.beginPath();
          ctx.rect(-bObj.width * 0.5, -bObj.height * 0.5, bObj.width, bObj.height);
          ctx.closePath();
          ctx.fillStrokeShape(konvaShape);
        }
      });
      shape.getSelfRect = () => {
        const bObj = shape.getAttr('buildingObject') as BuildingObject | undefined;
        return computeCenteredBoxSelfRect(bObj?.width ?? 24, bObj?.height ?? 24, 2);
      };
      node = shape;
    } else if (obj.type === 'plaza') {
      const shape = new KonvaCtor.Shape({
        id: obj.id,
        draggable,
        perfectDrawEnabled: false,
        sceneFunc: (ctx, konvaShape) => {
          const pObj = konvaShape.getAttr('plazaObject') as PlazaObject | undefined;
          if (!pObj) return;
          const rawCtx = (ctx as unknown as { _context?: CanvasRenderingContext2D })._context;
          if (!rawCtx) return;
          const renderPass =
            (konvaShape.getAttr('networkRenderPass') as NetworkPass | undefined) ?? 'full';
          drawPlazaToContext(
            rawCtx,
            { ...pObj, rotationDeg: konvaShape.rotation() },
            this.store.getDocument().theme,
            1,
            1,
            { applyTransform: false, pass: renderPass }
          );
        },
        hitFunc: (ctx, konvaShape) => {
          const pObj = konvaShape.getAttr('plazaObject') as PlazaObject | undefined;
          if (!pObj) return;
          ctx.beginPath();
          if (pObj.shape === 'circle') {
            ctx.ellipse(0, 0, pObj.width * 0.5, pObj.height * 0.5, 0, 0, Math.PI * 2);
          } else {
            ctx.rect(-pObj.width * 0.5, -pObj.height * 0.5, pObj.width, pObj.height);
          }
          ctx.closePath();
          ctx.fillStrokeShape(konvaShape);
        }
      });
      shape.getSelfRect = () => {
        const pObj = shape.getAttr('plazaObject') as PlazaObject | undefined;
        return computeCenteredBoxSelfRect(pObj?.width ?? 60, pObj?.height ?? 60, 2);
      };
      node = shape;
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
          const docNow = this.store.getDocument();
          const renderPass =
            (konvaShape.getAttr('networkRenderPass') as NetworkPass | undefined) ?? 'full';
          drawPathToContext(
            rawCtx,
            { ...pathObj, x: 0, y: 0, rotationDeg: 0 },
            1,
            1,
            docNow.theme,
            {
              pass: renderPass,
              doc: docNow,
              worldOrigin: {
                x: konvaShape.x(),
                y: konvaShape.y(),
                rotationDeg: konvaShape.rotation()
              }
            }
          );
        },
        hitFunc: (ctx, konvaShape) => {
          const pathObj = konvaShape.getAttr('pathObject') as PathObject | undefined;
          if (!pathObj || pathObj.points.length < 4) return;
          const pts = getLocalPathHitPoints(pathObj);
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

    node.setAttr('objectKind', obj.type);
    this.applyObjectAttrsToNode(node, obj, doc);
    this.bindNodeInteractionEvents(node, obj.id);
    return node;
  }

  private applyObjectAttrsToNode(
    node: Konva.Image | Konva.Text | Konva.Shape,
    obj: MapObject,
    doc: MapDocument
  ): void {
    node.setAttr('objectKind', obj.type);
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
    } else if (obj.type === 'building') {
      node.setAttr('buildingObject', obj);
      node.setAttrs({
        x: obj.x,
        y: obj.y,
        scaleX: 1,
        scaleY: 1,
        rotation: obj.rotationDeg
      });
    } else if (obj.type === 'plaza') {
      node.setAttr('plazaObject', obj);
      node.setAttrs({
        x: obj.x,
        y: obj.y,
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
            : prev.type === 'building'
              ? 'Sposta edificio'
              : prev.type === 'plaza'
                ? 'Sposta piazza'
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
      } else if (prev.type === 'building') {
        const nextWidth = Math.max(8, Number((prev.width * scaleX).toFixed(2)));
        const nextHeight = Math.max(8, Number((prev.height * scaleY).toFixed(2)));
        next = {
          ...prev,
          x: nextX,
          y: nextY,
          width: nextWidth,
          height: nextHeight,
          rotationDeg: nextRotation
        };
        node.setAttr('buildingObject', next);
        node.setAttrs({
          scaleX: 1,
          scaleY: 1,
          x: nextX,
          y: nextY,
          rotation: nextRotation
        });
      } else if (prev.type === 'plaza') {
        const nextWidth = Math.max(20, Number((prev.width * scaleX).toFixed(2)));
        const nextHeight = Math.max(20, Number((prev.height * scaleY).toFixed(2)));
        next = {
          ...prev,
          x: nextX,
          y: nextY,
          width: nextWidth,
          height: nextHeight,
          rotationDeg: nextRotation
        };
        node.setAttr('plazaObject', next);
        node.setAttrs({
          scaleX: 1,
          scaleY: 1,
          x: nextX,
          y: nextY,
          rotation: nextRotation
        });
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
            : prev.type === 'building'
              ? 'Trasforma edificio'
              : prev.type === 'plaza'
                ? 'Trasforma piazza'
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

  requestLabelForStamp(stamp: StampObject): void {
    const doc = this.store.getDocument();
    const targetLayerId = this.store.resolveTargetLayerIdForNewObject('label');
    if (!this.store.isLayerEditable(targetLayerId)) {
      this.notifyLockedOrHiddenLayer(targetLayerId, doc.manifest.layers, 'Nomi e Note');
      return;
    }
    const { space } = doc.manifest;
    const docX = clampNumber(stamp.x, 40, space.width - 40);
    const docY = clampNumber(stamp.y + stamp.height * 0.55 + 14, 28, space.height - 28);
    const theme = doc.theme;
    const cityFontId = theme.fonts.presets.city
      ? 'city'
      : theme.fonts.defaultFontId;
    this.openInlineEditorForNewLabel(docX, docY, theme, targetLayerId, cityFontId);
  }

  private openInlineEditorForNewLabel(
    docX: number,
    docY: number,
    theme: MapTheme,
    layerId: string,
    fontIdOverride?: string,
    fontSizeOverride?: number
  ): void {
    if (!this.onRequestInlineLabelEdit) return;
    const spec = getFontSpec(theme, fontIdOverride ?? theme.fonts.defaultFontId);
    this.inlineEditingSessionActive = true;
    this.inlineEditingObjectId = null;
    this.updateGhost(this.store.getSnapshot(), this.store.getEffectiveTool());
    this.layers.overlayLayer.batchDraw();

    this.onRequestInlineLabelEdit({
      mode: 'create',
      docX: Number(docX.toFixed(2)),
      docY: Number(docY.toFixed(2)),
      layerId,
      initialText: '',
      fontId: spec.id,
      fontSize: fontSizeOverride ?? spec.defaultSizeDoc,
      color: getDefaultLabelColor(theme),
      rotationDeg: 0,
      onEnd: () => this.setInlineEditingState(false, null)
    });
  }

  private openInlineEditorForExistingLabel(label: LabelObject): void {
    if (!this.onRequestInlineLabelEdit) return;
    const doc = this.store.getDocument();
    const resolvedLayerId = resolveObjectLayerId(label, doc.manifest.layers);
    this.store.selectObject(label.id);
    this.setInlineEditingState(true, label.id);

    this.onRequestInlineLabelEdit({
      mode: 'edit',
      docX: label.x,
      docY: label.y,
      layerId: resolvedLayerId,
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
      if (this.pathDraft) {
        this.commitPathDraft();
      } else if (this.districtDraft) {
        this.commitDistrictDraft();
      } else if (this.streetGridDraft) {
        this.commitStreetGridDraft();
      }
    };
    const onWinPointerCancel = () => {
      this.cancelActiveInteraction();
    };
    const onWinKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelActiveInteraction();
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

  private resolveSnapForLineTool(
    snap: EditorSnapshot,
    tool: string,
    docX: number,
    docY: number
  ): { hit: { x: number; y: number; snapped: boolean }; strokeW: number; isWater: boolean } | null {
    let activeKind: PathKind | null = null;
    let strokeW = snap.pathStrokeWidthDoc;

    if (tool === 'street' && snap.streetSnapEnabled) {
      activeKind = snap.streetPathKind;
      strokeW = snap.streetStrokeWidthDoc;
    } else if (tool === 'cityWall') {
      activeKind = 'wall';
      strokeW = snap.wallStrokeWidthDoc;
    } else if (tool === 'path' && (snap.pathKind === 'river' || snap.pathKind === 'road')) {
      activeKind = snap.pathKind;
      strokeW = snap.pathStrokeWidthDoc;
    }

    if (!activeKind) return null;
    const hit = findSnapPointForPathKind(snap.doc, docX, docY, activeKind);
    return {
      hit,
      strokeW,
      isWater: activeKind === 'river' || activeKind === 'canal'
    };
  }

  private commitPathDraft(finalPoint?: Point2D): void {
    const draft = this.pathDraft;
    if (!draft) return;
    this.pathDraft = null;
    this.detachPathWindowFallback();

    const snap = this.store.getSnapshot();

    if (finalPoint) {
      let fx = finalPoint.x;
      let fy = finalPoint.y;
      const resolvedSnap = this.resolveSnapForLineTool(snap, draft.tool, fx, fy);
      if (resolvedSnap && resolvedSnap.hit.snapped) {
        fx = resolvedSnap.hit.x;
        fy = resolvedSnap.hit.y;
      }
      const lastX = draft.points[draft.points.length - 2];
      const lastY = draft.points[draft.points.length - 1];
      if (Math.hypot(fx - lastX, fy - lastY) >= 0.5) {
        draft.points.push(Number(fx.toFixed(2)), Number(fy.toFixed(2)));
      }
    }

    this.pathPreviewShape.visible(false);

    if (!this.store.isLayerEditable(draft.layerId)) {
      this.notifyLockedOrHiddenLayer(draft.layerId, snap.doc.manifest.layers, 'Fiumi e Strade');
      this.updateGhost(snap, this.store.getEffectiveTool());
      this.layers.overlayLayer.batchDraw();
      return;
    }

    if (draft.points.length >= 4 && computePolylineLength(draft.points) >= 3) {
      if (draft.tool === 'cityWall') {
        const toleranceDoc = clampNumber(snap.wallStrokeWidthDoc * 0.4, 3, 10);
        const simplified = simplifyPolyline(draft.points, toleranceDoc);
        if (simplified.length >= 4) {
          const buildingsEditable = this.store.isLayerEditable(draft.buildingLayerId);
          const wallObjects = buildSmartCityWallObjects(snap.doc, simplified, {
            strokeWidthDoc: snap.wallStrokeWidthDoc,
            towerSpacingDoc: snap.wallTowerSpacingDoc,
            autoTowers: snap.wallAutoTowers && buildingsEditable,
            autoGates: snap.wallAutoGates && buildingsEditable,
            vectorLayerId: draft.layerId,
            buildingsLayerId: draft.buildingLayerId
          });
          if (wallObjects.length > 0) {
            this.store.executeCommand(
              new AddObjectsBatchCommand(wallObjects, { label: 'Traccia mura cittadine' })
            );
            this.store.selectObject(wallObjects[0].id);
          }
        }
      } else if (draft.tool === 'street') {
        const toleranceDoc = clampNumber(snap.streetStrokeWidthDoc * 0.25, 1.5, 5);
        const simplified = simplifyPolyline(draft.points, toleranceDoc);
        if (simplified.length >= 4) {
          const defaults = getPathKindDefaults(snap.streetPathKind, snap.doc.theme);
          const streetObj = createPathObject({
            layerId: draft.layerId,
            kind: snap.streetPathKind,
            points: simplified,
            strokeWidthDoc: snap.streetStrokeWidthDoc,
            color: defaults.color,
            smooth: snap.streetPathKind === 'canal',
            dashed: false,
            tapered: false,
            opacity: 1,
            theme: snap.doc.theme
          });
          this.store.executeCommand(
            new AddObjectCommand(
              streetObj,
              undefined,
              undefined,
              `Aggiungi ${getDefaultObjectLabel(streetObj)}`
            )
          );
          this.store.selectObject(streetObj.id);
        }
      } else {
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
            new AddObjectCommand(
              pathObj,
              undefined,
              undefined,
              `Aggiungi ${getDefaultObjectLabel(pathObj)}`
            )
          );
          this.store.selectObject(pathObj.id);
        }
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

  private commitDistrictDraft(finalPoint?: Point2D): void {
    const draft = this.districtDraft;
    if (!draft) return;
    this.districtDraft = null;
    this.detachPathWindowFallback();
    this.districtStrokePreview.visible(false);
    this.districtStrokePreview.points([]);

    if (finalPoint) {
      const last = draft.points[draft.points.length - 1];
      if (!last || Math.hypot(finalPoint.x - last.x, finalPoint.y - last.y) >= 2) {
        draft.points.push({
          x: Number(finalPoint.x.toFixed(2)),
          y: Number(finalPoint.y.toFixed(2))
        });
      }
    }

    const snap = this.store.getSnapshot();
    if (!this.store.isLayerEditable(draft.layerId)) {
      this.notifyLockedOrHiddenLayer(draft.layerId, snap.doc.manifest.layers, 'Quartieri ed Edifici');
      this.updateGhost(snap, this.store.getEffectiveTool());
      this.layers.overlayLayer.batchDraw();
      return;
    }

    if (draft.points.length > 0) {
      if (snap.districtMode === 'erase') {
        const hitIds = findBuildingsInBrushStroke(
          snap.doc,
          draft.points,
          snap.districtDiameterDoc
        ).filter((id) => {
          const obj = snap.doc.manifest.objects.find((o) => o.id === id);
          return obj ? this.isObjectLayerEditable(obj, snap.doc.manifest.layers) : false;
        });
        if (hitIds.length > 0) {
          this.store.executeCommand(
            new DeleteObjectsBatchCommand(hitIds, 'Cancella edifici')
          );
        }
      } else {
        const first = draft.points[0];
        const strokeSeed =
          (snap.doc.manifest.terrain.seed ^
            Math.round(first.x * 37 + first.y * 91) ^
            (snap.doc.manifest.revision * 131 + snap.doc.manifest.objects.length * 17)) >>>
          0;
        const created = generateDistrictBuildingsAlongStroke(snap.doc, draft.points, {
          diameterDoc: snap.districtDiameterDoc,
          density: snap.districtDensity,
          buildingScale: snap.districtBuildingScale,
          irregularity: snap.districtIrregularity,
          preset: snap.districtPreset,
          renderStyle: snap.districtRenderStyle,
          layerId: draft.layerId,
          seed: strokeSeed
        });
        if (created.length > 0) {
          this.store.executeCommand(
            new AddObjectsBatchCommand(created, { label: 'Dipingi quartiere' })
          );
        } else {
          const anyOnLand = draft.points.some((pt) => sampleLandMaskAtDoc(snap.doc, pt.x, pt.y));
          if (!anyOnLand) {
            this.store.setStatusNotice({
              tone: 'info',
              text: 'Dipingi il quartiere sulla terraferma.'
            });
          }
        }
      }
    }

    this.updateGhost(this.store.getSnapshot(), this.store.getEffectiveTool());
    this.layers.overlayLayer.batchDraw();
  }

  private cancelDistrictDraft(): void {
    if (!this.districtDraft) return;
    this.districtDraft = null;
    this.detachPathWindowFallback();
    this.districtStrokePreview.visible(false);
    this.districtStrokePreview.points([]);
    this.updateGhost(this.store.getSnapshot(), this.store.getEffectiveTool());
    this.layers.overlayLayer.batchDraw();
  }

  private commitStreetGridDraft(finalPoint?: Point2D): void {
    const draft = this.streetGridDraft;
    if (!draft) return;
    this.streetGridDraft = null;
    this.detachPathWindowFallback();
    this.streetGridPreviewShape.visible(false);

    if (finalPoint) {
      draft.endDoc = { x: finalPoint.x, y: finalPoint.y };
    }

    const x = Math.min(draft.startDoc.x, draft.endDoc.x);
    const y = Math.min(draft.startDoc.y, draft.endDoc.y);
    const width = Math.abs(draft.endDoc.x - draft.startDoc.x);
    const height = Math.abs(draft.endDoc.y - draft.startDoc.y);

    const snap = this.store.getSnapshot();
    if (!this.store.isLayerEditable(draft.streetLayerId)) {
      this.notifyLockedOrHiddenLayer(
        draft.streetLayerId,
        snap.doc.manifest.layers,
        'Strade, Piazze e Mura'
      );
      this.updateGhost(snap, this.store.getEffectiveTool());
      this.layers.overlayLayer.batchDraw();
      return;
    }

    if (Math.min(width, height) >= 40) {
      const buildingsEditable = this.store.isLayerEditable(draft.buildingLayerId);
      const gridSeed =
        (snap.doc.manifest.terrain.seed ^
          Math.round(x * 23 + y * 53) ^
          (snap.doc.manifest.revision * 73)) >>>
        0;
      const created = generateStreetGridInRect(
        snap.doc,
        { x, y, width, height },
        {
          style: snap.streetGridStyle,
          spacingDoc: snap.streetGridSpacingDoc,
          angleDeg: snap.streetGridAngleDeg,
          autoFillBuildings: snap.streetGridAutoFill && buildingsEditable,
          districtPreset: snap.districtPreset,
          density: snap.districtDensity,
          buildingScale: snap.districtBuildingScale,
          irregularity: snap.districtIrregularity,
          renderStyle: snap.districtRenderStyle,
          vectorLayerId: draft.streetLayerId,
          buildingsLayerId: draft.buildingLayerId,
          seed: gridSeed
        }
      );
      if (created.length > 0) {
        this.store.executeCommand(
          new AddObjectsBatchCommand(created, { label: 'Genera griglia stradale' })
        );
      }
    } else {
      this.store.setStatusNotice({
        tone: 'info',
        text: 'Trascina un rettangolo più ampio sulla carta per creare una griglia stradale.'
      });
    }

    this.updateGhost(this.store.getSnapshot(), this.store.getEffectiveTool());
    this.layers.overlayLayer.batchDraw();
  }

  private cancelStreetGridDraft(): void {
    if (!this.streetGridDraft) return;
    this.streetGridDraft = null;
    this.detachPathWindowFallback();
    this.streetGridPreviewShape.visible(false);
    this.updateGhost(this.store.getSnapshot(), this.store.getEffectiveTool());
    this.layers.overlayLayer.batchDraw();
  }

  cancelActiveInteraction(): boolean {
    let cancelled = false;
    if (this.pathDraft) {
      this.cancelPathDraft();
      cancelled = true;
    }
    if (this.districtDraft) {
      this.cancelDistrictDraft();
      cancelled = true;
    }
    if (this.streetGridDraft) {
      this.cancelStreetGridDraft();
      cancelled = true;
    }
    return cancelled;
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

    if (tool === 'path' || tool === 'street' || tool === 'cityWall') {
      if (ctx.docX < 0 || ctx.docY < 0 || ctx.docX > space.width || ctx.docY > space.height) {
        return false;
      }
      const targetLayerId = this.store.resolveTargetLayerIdForNewObject('path');
      if (!this.store.isLayerEditable(targetLayerId)) {
        this.notifyLockedOrHiddenLayer(
          targetLayerId,
          snap.doc.manifest.layers,
          tool === 'path' ? 'Fiumi e Strade' : 'Strade, Piazze e Mura'
        );
        return true;
      }
      const buildingLayerId = this.store.resolveTargetLayerIdForNewObject('building');

      let startX = ctx.docX;
      let startY = ctx.docY;
      const resolvedSnap = this.resolveSnapForLineTool(snap, tool, startX, startY);
      if (resolvedSnap && resolvedSnap.hit.snapped) {
        startX = resolvedSnap.hit.x;
        startY = resolvedSnap.hit.y;
      }

      const pointerId = 'pointerId' in ctx.event ? ctx.event.pointerId : null;
      this.pathDraft = {
        tool,
        points: [Number(startX.toFixed(2)), Number(startY.toFixed(2))],
        layerId: targetLayerId,
        buildingLayerId,
        pointerId
      };
      this.pathCursorRing.visible(false);
      this.pathPreviewShape.visible(true);
      this.pathPreviewShape.moveToTop();
      this.attachPathWindowFallback();
      this.layers.overlayLayer.batchDraw();
      return true;
    }

    if (tool === 'district') {
      if (ctx.docX < 0 || ctx.docY < 0 || ctx.docX > space.width || ctx.docY > space.height) {
        return false;
      }
      const targetLayerId = this.store.resolveTargetLayerIdForNewObject('building');
      if (!this.store.isLayerEditable(targetLayerId)) {
        this.notifyLockedOrHiddenLayer(
          targetLayerId,
          snap.doc.manifest.layers,
          'Quartieri ed Edifici'
        );
        return true;
      }
      const pointerId = 'pointerId' in ctx.event ? ctx.event.pointerId : null;
      const sx = Number(ctx.docX.toFixed(2));
      const sy = Number(ctx.docY.toFixed(2));
      this.districtDraft = {
        points: [{ x: sx, y: sy }],
        layerId: targetLayerId,
        pointerId
      };
      this.districtStrokePreview.setAttrs({
        visible: true,
        points: [sx, sy, sx + 0.1, sy + 0.1],
        strokeWidth: snap.districtDiameterDoc,
        stroke:
          snap.districtMode === 'erase'
            ? 'rgba(255, 179, 166, 0.34)'
            : 'rgba(224, 187, 121, 0.28)'
      });
      this.districtStrokePreview.moveToTop();
      this.districtBrushCircle.moveToTop();
      this.attachPathWindowFallback();
      this.layers.overlayLayer.batchDraw();
      return true;
    }

    if (tool === 'streetGrid') {
      if (ctx.docX < 0 || ctx.docY < 0 || ctx.docX > space.width || ctx.docY > space.height) {
        return false;
      }
      const streetLayerId = this.store.resolveTargetLayerIdForNewObject('path');
      if (!this.store.isLayerEditable(streetLayerId)) {
        this.notifyLockedOrHiddenLayer(
          streetLayerId,
          snap.doc.manifest.layers,
          'Strade, Piazze e Mura'
        );
        return true;
      }
      const buildingLayerId = this.store.resolveTargetLayerIdForNewObject('building');
      const pointerId = 'pointerId' in ctx.event ? ctx.event.pointerId : null;
      const sx = Number(ctx.docX.toFixed(2));
      const sy = Number(ctx.docY.toFixed(2));
      this.streetGridDraft = {
        startDoc: { x: sx, y: sy },
        endDoc: { x: sx, y: sy },
        streetLayerId,
        buildingLayerId,
        pointerId
      };
      this.streetGridPreviewShape.visible(true);
      this.streetGridPreviewShape.moveToTop();
      this.attachPathWindowFallback();
      this.layers.overlayLayer.batchDraw();
      return true;
    }

    if (tool === 'building') {
      if (ctx.docX < 0 || ctx.docY < 0 || ctx.docX > space.width || ctx.docY > space.height) {
        return false;
      }
      const targetLayerId = this.store.resolveTargetLayerIdForNewObject('building');
      if (!this.store.isLayerEditable(targetLayerId)) {
        this.notifyLockedOrHiddenLayer(
          targetLayerId,
          snap.doc.manifest.layers,
          'Quartieri ed Edifici'
        );
        return true;
      }
      const rotationDeg = resolveBuildingPlacementRotation(
        snap.doc,
        ctx.docX,
        ctx.docY,
        snap.buildingRotationDeg,
        snap.buildingAutoAlign
      );
      const bldg = createBuildingObject({
        layerId: targetLayerId,
        shape: snap.buildingShape,
        x: ctx.docX,
        y: ctx.docY,
        width: snap.buildingWidthDoc,
        height: snap.buildingHeightDoc,
        rotationDeg,
        roofColor: snap.buildingRoofColor,
        ...(snap.buildingRenderStyle !== 'auto'
          ? { renderStyle: snap.buildingRenderStyle }
          : {})
      });
      this.store.executeCommand(
        new AddObjectCommand(bldg, undefined, undefined, 'Aggiungi edificio')
      );
      this.store.selectObject(bldg.id);
      return true;
    }

    if (tool === 'plaza') {
      if (ctx.docX < 0 || ctx.docY < 0 || ctx.docX > space.width || ctx.docY > space.height) {
        return false;
      }
      const targetLayerId = this.store.resolveTargetLayerIdForNewObject('plaza');
      if (!this.store.isLayerEditable(targetLayerId)) {
        this.notifyLockedOrHiddenLayer(
          targetLayerId,
          snap.doc.manifest.layers,
          'Strade, Piazze e Mura'
        );
        return true;
      }
      const palette = getCityThemePalette(snap.doc.theme);
      const width = snap.plazaSizeDoc;
      const height =
        snap.plazaShape === 'rect'
          ? Math.max(24, Math.round(snap.plazaSizeDoc * 0.76))
          : snap.plazaSizeDoc;
      const plaza = createPlazaObject({
        layerId: targetLayerId,
        shape: snap.plazaShape,
        x: ctx.docX,
        y: ctx.docY,
        width,
        height,
        rotationDeg: 0,
        fillColor: palette.plazaFill,
        borderColor: palette.streetBorder,
        centerpiece: snap.plazaCenterpiece
      });
      if (snap.plazaClearBuildings) {
        const overlappingIds = findOverlappingBuildingIdsForPlaza(snap.doc, plaza).filter(
          (id) => {
            const b = snap.doc.manifest.objects.find((o) => o.id === id);
            return b ? this.isObjectLayerEditable(b, snap.doc.manifest.layers) : false;
          }
        );
        if (overlappingIds.length > 0) {
          this.store.executeCommand(
            new AddAndDeleteObjectsCommand([plaza], overlappingIds, 'Aggiungi piazza')
          );
        } else {
          this.store.executeCommand(
            new AddObjectCommand(plaza, undefined, undefined, 'Aggiungi piazza')
          );
        }
      } else {
        this.store.executeCommand(
          new AddObjectCommand(plaza, undefined, undefined, 'Aggiungi piazza')
        );
      }
      this.store.selectObject(plaza.id);
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
      if (snap.poiAutoLabel) {
        this.requestLabelForStamp(stamp);
      }
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

      const targetLabelLayerId = this.store.resolveTargetLayerIdForNewObject('label');
      if (!this.store.isLayerEditable(targetLabelLayerId)) {
        this.notifyLockedOrHiddenLayer(targetLabelLayerId, snap.doc.manifest.layers, 'Nomi e Note');
        return true;
      }

      this.openInlineEditorForNewLabel(ctx.docX, ctx.docY, snap.doc.theme, targetLabelLayerId);
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

    if (this.pathDraft && tool === this.pathDraft.tool) {
      const { space } = snap.doc.manifest;
      const samples =
        ctx.coalescedPoints && ctx.coalescedPoints.length > 0
          ? ctx.coalescedPoints
          : [{ cssX: ctx.cssX, cssY: ctx.cssY, docX: ctx.docX, docY: ctx.docY }];
      const pts = this.pathDraft.points;
      let appended = false;
      for (const sample of samples) {
        const clampedX = Number(clampNumber(sample.docX, 0, space.width).toFixed(2));
        const clampedY = Number(clampNumber(sample.docY, 0, space.height).toFixed(2));
        const lastX = pts[pts.length - 2];
        const lastY = pts[pts.length - 1];
        if (Math.hypot(clampedX - lastX, clampedY - lastY) >= 3) {
          pts.push(clampedX, clampedY);
          appended = true;
        }
      }
      const resolvedSnap = this.resolveSnapForLineTool(
        snap,
        this.pathDraft.tool,
        ctx.docX,
        ctx.docY
      );
      if (resolvedSnap) {
        this.streetSnapRing.setAttrs({
          visible: resolvedSnap.hit.snapped,
          x: resolvedSnap.hit.x,
          y: resolvedSnap.hit.y,
          radius: Math.max(8, resolvedSnap.strokeW * 0.65),
          stroke: resolvedSnap.isWater ? '#9CDEEF' : '#E0BB79',
          fill: resolvedSnap.isWater
            ? 'rgba(156, 222, 239, 0.18)'
            : 'rgba(224, 187, 121, 0.18)'
        });
        if (resolvedSnap.hit.snapped) {
          this.streetSnapRing.moveToTop();
        }
        appended = true;
      }
      if (appended) {
        this.pathPreviewShape.moveToTop();
        this.layers.overlayLayer.batchDraw();
      }
      return;
    }

    if (this.districtDraft && tool === 'district') {
      const { space } = snap.doc.manifest;
      const clampedX = Number(clampNumber(ctx.docX, 0, space.width).toFixed(2));
      const clampedY = Number(clampNumber(ctx.docY, 0, space.height).toFixed(2));
      const pts = this.districtDraft.points;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(clampedX - last.x, clampedY - last.y) >= 4) {
        pts.push({ x: clampedX, y: clampedY });
        const flat: number[] = [];
        for (const p of pts) {
          flat.push(p.x, p.y);
        }
        this.districtStrokePreview.points(flat);
        this.districtStrokePreview.moveToTop();
      }
      this.updateGhost(snap, tool);
      this.layers.overlayLayer.batchDraw();
      return;
    }

    if (this.streetGridDraft && tool === 'streetGrid') {
      const { space } = snap.doc.manifest;
      this.streetGridDraft.endDoc = {
        x: Number(clampNumber(ctx.docX, 0, space.width).toFixed(2)),
        y: Number(clampNumber(ctx.docY, 0, space.height).toFixed(2))
      };
      this.streetGridPreviewShape.moveToTop();
      this.layers.overlayLayer.batchDraw();
      return;
    }

    if (this.updateGhost(snap, tool)) {
      this.layers.overlayLayer.batchDraw();
    }
  }

  handlePointerUp(ctx: ViewportPointerContext): void {
    if (this.disposed) return;
    const { space } = this.store.getDocument().manifest;
    const clampedX = clampNumber(ctx.docX, 0, space.width);
    const clampedY = clampNumber(ctx.docY, 0, space.height);
    if (this.pathDraft) {
      this.commitPathDraft({ x: clampedX, y: clampedY });
    } else if (this.districtDraft) {
      this.commitDistrictDraft({ x: clampedX, y: clampedY });
    } else if (this.streetGridDraft) {
      this.commitStreetGridDraft({ x: clampedX, y: clampedY });
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
    if (e.key === 'Escape' && (this.pathDraft || this.districtDraft || this.streetGridDraft)) {
      e.preventDefault?.();
      this.cancelActiveInteraction();
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
    this.districtDraft = null;
    this.streetGridDraft = null;

    this.transformer.nodes([]);
    this.transformer.destroy();
    this.ghostGroup.destroy();
    this.ghostLabelPill.destroy();
    this.pathCursorRing.destroy();
    this.streetSnapRing.destroy();
    this.pathPreviewShape.destroy();
    this.districtStrokePreview.destroy();
    this.districtBrushCircle.destroy();
    this.cityGhostShape.destroy();
    this.streetGridPreviewShape.destroy();

    for (const node of this.nodeMap.values()) {
      node.destroy();
    }
    this.nodeMap.clear();
    this.syncedObjectMap.clear();

    for (const casingMap of this.layerNetworkCasingShapes.values()) {
      for (const cShape of casingMap.values()) {
        cShape.destroy();
      }
    }
    this.layerNetworkCasingShapes.clear();
    this.layerNetworkMembers.clear();

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
