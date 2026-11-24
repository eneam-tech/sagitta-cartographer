import Konva from 'konva';
import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { CameraState, clampNumber, screenToDoc } from '../model/coordinates';
import { DEFAULT_LAYER_TERRAIN_ID } from '../model/document';
import { drawAtlasFrameToContext } from '../render/objectMetrics';
import {
  EditorStore,
  isTerrainBrushTool,
  useEditorStore
} from '../state/editorStore';
import { LockClosedIcon } from '../ui/icons';

export interface ViewportLayersHandle {
  stage: Konva.Stage;
  terrainLayer: Konva.Layer;
  objectsLayer: Konva.Layer;
  overlayLayer: Konva.Layer;
}

export interface CoalescedPointerPoint {
  cssX: number;
  cssY: number;
  docX: number;
  docY: number;
}

export interface ViewportPointerContext {
  docX: number;
  docY: number;
  cssX: number;
  cssY: number;
  camera: CameraState;
  event: PointerEvent | MouseEvent;
  coalescedPoints?: ReadonlyArray<CoalescedPointerPoint>;
}

export interface MapViewportProps {
  store: EditorStore;
  onLayersReady?: (handle: ViewportLayersHandle | null) => void;
  onObjectPointerDown?: (ctx: ViewportPointerContext) => boolean;
  onObjectPointerMove?: (ctx: ViewportPointerContext) => void;
  onObjectPointerUp?: (ctx: ViewportPointerContext) => void;
  onObjectDoubleClick?: (ctx: ViewportPointerContext) => void;
  onObjectCancelInteraction?: () => boolean;
  onObjectPointerLeave?: () => void;
  onCursorDocMove?: (docPoint: { x: number; y: number } | null) => void;
  inlineEditorSlot?: ReactNode;
}

type ActiveGesture =
  | {
      mode: 'pan';
      pointerId: number;
      pointerType: string;
      startClientX: number;
      startClientY: number;
      lastClientX: number;
      lastClientY: number;
      movedPx: number;
      fromPencilOnly: boolean;
    }
  | {
      mode: 'brush';
      pointerId: number;
      pointerType: string;
      startTimeMs: number;
      startClientX: number;
      startClientY: number;
      movedPx: number;
    }
  | {
      mode: 'object';
      pointerId: number;
      pointerType: string;
      startTimeMs: number;
      startClientX: number;
      startClientY: number;
      movedPx: number;
    }
  | {
      mode: 'pinch';
      startTimeMs: number;
      prevCenterCssX: number;
      prevCenterCssY: number;
      prevDistPx: number;
      didTransform: boolean;
      maxTouchCount: number;
      maxFingerMovePx: number;
    }
  | null;

interface ActiveTouchPointer {
  startCssX: number;
  startCssY: number;
  cssX: number;
  cssY: number;
  maxMovePx: number;
}

function getNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isTouchOrCoarseDevice(): boolean {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  ) {
    return true;
  }
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

function isEditableControlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(
    target.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')
  );
}

function computeTwoTouchMetrics(
  pointers: Map<number, ActiveTouchPointer>
): { centerCssX: number; centerCssY: number; distPx: number; maxMovePx: number } | null {
  if (pointers.size < 2) return null;
  let p1: ActiveTouchPointer | null = null;
  let p2: ActiveTouchPointer | null = null;
  let maxMovePx = 0;
  for (const pt of pointers.values()) {
    if (pt.maxMovePx > maxMovePx) maxMovePx = pt.maxMovePx;
    if (!p1) {
      p1 = pt;
    } else if (!p2) {
      p2 = pt;
    }
  }
  if (!p1 || !p2) return null;
  return {
    centerCssX: (p1.cssX + p2.cssX) * 0.5,
    centerCssY: (p1.cssY + p2.cssY) * 0.5,
    distPx: Math.hypot(p2.cssX - p1.cssX, p2.cssY - p1.cssY),
    maxMovePx
  };
}

interface CursorState {
  inside: boolean;
  cssX: number;
  cssY: number;
  docX: number;
  docY: number;
}

interface TileCapableTerrainRenderer {
  drawToCanvasContext?: (
    ctx: CanvasRenderingContext2D,
    space: { width: number; height: number },
    visibleDocRect?: { x: number; y: number; width: number; height: number }
  ) => void;
}

export function MapViewport({
  store,
  onLayersReady,
  onObjectPointerDown,
  onObjectPointerMove,
  onObjectPointerUp,
  onObjectDoubleClick,
  onObjectCancelInteraction,
  onObjectPointerLeave,
  onCursorDocMove,
  inlineEditorSlot
}: MapViewportProps) {
  const snap = useEditorStore(store);
  const {
    doc,
    activeTool,
    brushDiameterDoc,
    camera,
    hasLand,
    spacePanActive,
    seaOnlyHintVisible,
    activePoiId,
    documentVersionTick,
    terrainRenderTick
  } = snap;

  const terrainLayerMeta = doc.manifest.layers.find(
    (l) => l.id === DEFAULT_LAYER_TERRAIN_ID || l.kind === 'terrain'
  );
  const terrainVisible = terrainLayerMeta ? terrainLayerMeta.visible : true;
  const terrainOpacity = terrainLayerMeta ? clampNumber(terrainLayerMeta.opacity, 0, 1) : 1;
  const terrainLocked = terrainLayerMeta ? terrainLayerMeta.locked : false;

  const containerRef = useRef<HTMLDivElement>(null);
  const stageHostRef = useRef<HTMLDivElement>(null);
  const seaHintElRef = useRef<HTMLDivElement>(null);

  const stageRef = useRef<Konva.Stage | null>(null);
  const paperLayerRef = useRef<Konva.Layer | null>(null);
  const terrainLayerRef = useRef<Konva.Layer | null>(null);
  const objectsLayerRef = useRef<Konva.Layer | null>(null);
  const frameLayerRef = useRef<Konva.Layer | null>(null);
  const overlayLayerRef = useRef<Konva.Layer | null>(null);

  const terrainShadowRef = useRef<Konva.Rect | null>(null);
  const paperBgRef = useRef<Konva.Rect | null>(null);
  const terrainSeaRef = useRef<Konva.Rect | null>(null);
  const terrainShapeRef = useRef<Konva.Shape | null>(null);

  const pageBorderRef = useRef<Konva.Rect | null>(null);
  const regMarksRef = useRef<Konva.Line[]>([]);
  const brushGroupRef = useRef<Konva.Group | null>(null);
  const brushOuterRingRef = useRef<Konva.Circle | null>(null);
  const brushInnerRingRef = useRef<Konva.Circle | null>(null);
  const brushCenterDotRef = useRef<Konva.Circle | null>(null);
  const fallbackGhostRef = useRef<Konva.Group | null>(null);
  const fallbackGhostRectRef = useRef<Konva.Rect | null>(null);

  const activeGestureRef = useRef<ActiveGesture>(null);
  const activeTouchPointersRef = useRef<Map<number, ActiveTouchPointer>>(new Map());
  const activePenPointerIdRef = useRef<number | null>(null);
  const lastPenActivityMsRef = useRef<number>(-10_000);
  const shownPencilOnlyHintRef = useRef<boolean>(false);
  const lastTouchTapRef = useRef<{
    timeMs: number;
    cssX: number;
    cssY: number;
    pointerType: string;
  } | null>(null);
  const lastDoubleTapHandledMsRef = useRef<number>(-10_000);
  const cursorRef = useRef<CursorState>({ inside: false, cssX: 0, cssY: 0, docX: 0, docY: 0 });
  const lastTelemetrySentMsRef = useRef<number>(0);
  const seaHintCoordsRef = useRef<{ x: number; y: number }>({ x: 16, y: 16 });

  const effectiveTool = spacePanActive ? 'hand' : activeTool;
  const effectiveToolRef = useRef(effectiveTool);
  effectiveToolRef.current = effectiveTool;

  const brushDiameterRef = useRef(brushDiameterDoc);
  brushDiameterRef.current = brushDiameterDoc;

  const onLayersReadyRef = useRef(onLayersReady);
  onLayersReadyRef.current = onLayersReady;

  const hasObjectCallbackRef = useRef(Boolean(onObjectPointerDown));
  hasObjectCallbackRef.current = Boolean(onObjectPointerDown);

  const activePoiIdRef = useRef(activePoiId);
  activePoiIdRef.current = activePoiId;

  const syncOverlayCursor = useCallback(() => {
    const overlay = overlayLayerRef.current;
    const brushGroup = brushGroupRef.current;
    const outerRing = brushOuterRingRef.current;
    const innerRing = brushInnerRingRef.current;
    const centerDot = brushCenterDotRef.current;
    const ghostGroup = fallbackGhostRef.current;
    const ghostRect = fallbackGhostRectRef.current;
    if (!overlay || !brushGroup || !outerRing || !innerRing || !centerDot) return;

    const cursor = cursorRef.current;
    const tool = effectiveToolRef.current;
    const currentCam = store.getSnapshot().camera;
    const radiusDoc = brushDiameterRef.current / 2;
    const isPainting = activeGestureRef.current?.mode === 'brush';

    if (cursor.inside && isTerrainBrushTool(tool)) {
      brushGroup.visible(true);
      brushGroup.position({ x: cursor.docX, y: cursor.docY });
      outerRing.radius(radiusDoc);
      innerRing.radius(radiusDoc);
      innerRing.stroke(isPainting ? '#9CDEEF' : '#F3EEDF');
      centerDot.radius(Math.max(1.5, 2.5 / currentCam.scale));
    } else {
      brushGroup.visible(false);
    }

    if (
      ghostGroup &&
      ghostRect &&
      cursor.inside &&
      !hasObjectCallbackRef.current &&
      ((tool === 'poi' && activePoiIdRef.current) || tool === 'label')
    ) {
      const sizeDoc = tool === 'poi' ? 88 : 110;
      const heightDoc = tool === 'poi' ? 88 : 38;
      ghostGroup.visible(true);
      ghostGroup.position({ x: cursor.docX, y: cursor.docY });
      ghostRect.setAttrs({
        x: tool === 'poi' ? -sizeDoc / 2 : 0,
        y: tool === 'poi' ? -heightDoc / 2 : 0,
        width: sizeDoc,
        height: heightDoc
      });
    } else if (ghostGroup) {
      ghostGroup.visible(false);
    }

    overlay.batchDraw();
  }, [store]);

  // Montaggio Stage e 3 livelli Konva separati
  useEffect(() => {
    const container = containerRef.current;
    const stageHost = stageHostRef.current;
    if (!container || !stageHost) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    Konva.pixelRatio = isTouchOrCoarseDevice() ? Math.min(2, dpr) : Math.min(2.5, dpr);

    const preventStageDefault = (e: Event) => {
      if (isEditableControlTarget(e.target)) return;
      if (e.cancelable) {
        e.preventDefault();
      }
    };
    stageHost.addEventListener('touchstart', preventStageDefault, { passive: false });
    stageHost.addEventListener('touchmove', preventStageDefault, { passive: false });
    stageHost.addEventListener('gesturestart', preventStageDefault, { passive: false });
    stageHost.addEventListener('gesturechange', preventStageDefault, { passive: false });
    stageHost.addEventListener('gestureend', preventStageDefault, { passive: false });
    stageHost.addEventListener('contextmenu', preventStageDefault);

    const initW = Math.max(1, container.clientWidth);
    const initH = Math.max(1, container.clientHeight);

    const stage = new Konva.Stage({
      container: stageHost,
      width: initW,
      height: initH
    });

    const paperLayer = new Konva.Layer({ listening: false });
    const terrainLayer = new Konva.Layer({ listening: false });
    const objectsLayer = new Konva.Layer({ listening: false });
    const frameLayer = new Konva.Layer({ listening: false });
    const overlayLayer = new Konva.Layer({ listening: false });

    const shadowRect = new Konva.Rect({
      fill: 'rgba(8, 13, 18, 0.36)',
      listening: false
    });
    const paperBgRect = new Konva.Rect({
      x: 0,
      y: 0,
      fill: '#FFFFFF',
      listening: false
    });
    paperLayer.add(shadowRect, paperBgRect);

    const seaRect = new Konva.Rect({
      x: 0,
      y: 0,
      listening: false
    });
    const terrainShape = new Konva.Shape({
      x: 0,
      y: 0,
      listening: false,
      perfectDrawEnabled: false,
      sceneFunc: (ctx) => {
        const currentSnap = store.getSnapshot();
        const renderer = store.getRenderer();
        const { space } = currentSnap.doc.manifest;
        const tileRenderer = renderer as unknown as TileCapableTerrainRenderer;

        if (typeof tileRenderer.drawToCanvasContext === 'function') {
          const cam = currentSnap.camera;
          const scale = Math.max(1e-6, cam.scale);
          const vpW = currentSnap.viewportSize.width || stage.width() || 1;
          const vpH = currentSnap.viewportSize.height || stage.height() || 1;
          const marginDoc = 16 / scale;
          const visibleDocRect = {
            x: -cam.offsetX / scale - marginDoc,
            y: -cam.offsetY / scale - marginDoc,
            width: vpW / scale + marginDoc * 2,
            height: vpH / scale + marginDoc * 2
          };
          tileRenderer.drawToCanvasContext(ctx._context, space, visibleDocRect);
          return;
        }

        const canvas = renderer.getCanvas();
        if (canvas) {
          ctx._context.drawImage(canvas, 0, 0, space.width, space.height);
        }
      }
    });
    terrainLayer.add(seaRect, terrainShape);

    const pageBorder = new Konva.Rect({
      x: 0,
      y: 0,
      stroke: '#E0BB79',
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
      listening: false
    });

    const regMarks = Array.from({ length: 4 }, () =>
      new Konva.Line({
        points: [],
        stroke: '#E0BB79',
        strokeWidth: 1.5,
        strokeScaleEnabled: false,
        lineCap: 'round',
        lineJoin: 'round',
        listening: false
      })
    );

    const brushGroup = new Konva.Group({ visible: false, listening: false });
    const outerRing = new Konva.Circle({
      x: 0,
      y: 0,
      radius: 40,
      stroke: '#17232D',
      strokeWidth: 3.5,
      strokeScaleEnabled: false,
      listening: false
    });
    const innerRing = new Konva.Circle({
      x: 0,
      y: 0,
      radius: 40,
      stroke: '#F3EEDF',
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
      listening: false
    });
    const centerDot = new Konva.Circle({
      x: 0,
      y: 0,
      radius: 2,
      fill: '#F3EEDF',
      stroke: '#17232D',
      strokeWidth: 1,
      strokeScaleEnabled: false,
      listening: false
    });
    brushGroup.add(outerRing, innerRing, centerDot);

    const fallbackGhostGroup = new Konva.Group({ visible: false, listening: false });
    const fallbackGhostRect = new Konva.Rect({
      stroke: '#9CDEEF',
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
      dash: [6, 4],
      fill: 'rgba(156, 222, 239, 0.12)',
      listening: false
    });
    fallbackGhostGroup.add(fallbackGhostRect);

    const atlasFrameShape = new Konva.Shape({
      x: 0,
      y: 0,
      listening: false,
      perfectDrawEnabled: false,
      sceneFunc: (ctx) => {
        const currentDoc = store.getSnapshot().doc;
        drawAtlasFrameToContext(
          ctx._context,
          currentDoc.manifest.space.width,
          currentDoc.manifest.space.height,
          currentDoc.theme
        );
      }
    });

    frameLayer.add(atlasFrameShape, pageBorder, ...regMarks);
    overlayLayer.add(fallbackGhostGroup, brushGroup);

    stage.add(paperLayer, terrainLayer, objectsLayer, frameLayer, overlayLayer);

    stageRef.current = stage;
    paperLayerRef.current = paperLayer;
    terrainLayerRef.current = terrainLayer;
    objectsLayerRef.current = objectsLayer;
    frameLayerRef.current = frameLayer;
    overlayLayerRef.current = overlayLayer;
    terrainShadowRef.current = shadowRect;
    paperBgRef.current = paperBgRect;
    terrainSeaRef.current = seaRect;
    terrainShapeRef.current = terrainShape;
    pageBorderRef.current = pageBorder;
    regMarksRef.current = regMarks;
    brushGroupRef.current = brushGroup;
    brushOuterRingRef.current = outerRing;
    brushInnerRingRef.current = innerRing;
    brushCenterDotRef.current = centerDot;
    fallbackGhostRef.current = fallbackGhostGroup;
    fallbackGhostRectRef.current = fallbackGhostRect;

    store.setViewportSize(initW, initH);

    onLayersReadyRef.current?.({
      stage,
      terrainLayer,
      objectsLayer,
      overlayLayer
    });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, Math.round(entry.contentRect.width));
        const h = Math.max(1, Math.round(entry.contentRect.height));
        stage.size({ width: w, height: h });
        store.setViewportSize(w, h);
        stage.batchDraw();
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      stageHost.removeEventListener('touchstart', preventStageDefault);
      stageHost.removeEventListener('touchmove', preventStageDefault);
      stageHost.removeEventListener('gesturestart', preventStageDefault);
      stageHost.removeEventListener('gesturechange', preventStageDefault);
      stageHost.removeEventListener('gestureend', preventStageDefault);
      stageHost.removeEventListener('contextmenu', preventStageDefault);
      onLayersReadyRef.current?.(null);
      stage.destroy();
      stageRef.current = null;
      paperLayerRef.current = null;
      terrainLayerRef.current = null;
      objectsLayerRef.current = null;
      frameLayerRef.current = null;
      overlayLayerRef.current = null;
      terrainShadowRef.current = null;
      paperBgRef.current = null;
      terrainSeaRef.current = null;
      terrainShapeRef.current = null;
    };
  }, [store]);

  // Wheel zoom centrato sul cursore con passive: false
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const currentCam = store.getSnapshot().camera;
      const zoomFactor = Math.exp(-e.deltaY * 0.0018);
      store.zoomAt(cssX, cssY, currentCam.scale * zoomFactor);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [store]);

  // Sincronizza camera, dimensioni pagina, ritaglio livello oggetti e cornice statica
  useEffect(() => {
    const paperLayer = paperLayerRef.current;
    const terrainLayer = terrainLayerRef.current;
    const objectsLayer = objectsLayerRef.current;
    const frameLayer = frameLayerRef.current;
    const overlayLayer = overlayLayerRef.current;
    if (!paperLayer || !terrainLayer || !objectsLayer || !frameLayer || !overlayLayer) return;

    const { width, height } = doc.manifest.space;
    const layerTransform = {
      x: camera.offsetX,
      y: camera.offsetY,
      scaleX: camera.scale,
      scaleY: camera.scale
    };

    paperLayer.setAttrs(layerTransform);
    terrainLayer.setAttrs({
      ...layerTransform,
      visible: terrainVisible,
      opacity: terrainOpacity
    });
    objectsLayer.setAttrs({
      ...layerTransform,
      clipX: 0,
      clipY: 0,
      clipWidth: width,
      clipHeight: height,
      listening: effectiveTool === 'select'
    });
    frameLayer.setAttrs(layerTransform);
    overlayLayer.setAttrs(layerTransform);

    const shadowOffset = 6 / camera.scale;
    terrainShadowRef.current?.setAttrs({
      x: shadowOffset,
      y: shadowOffset,
      width,
      height
    });
    paperBgRef.current?.setAttrs({
      width,
      height
    });
    terrainSeaRef.current?.setAttrs({
      width,
      height,
      fill: doc.theme.colors.sea
    });
    terrainShapeRef.current?.setAttrs({
      width,
      height
    });

    pageBorderRef.current?.setAttrs({
      width,
      height
    });

    const gap = 6 / camera.scale;
    const arm = 12 / camera.scale;
    const marks = regMarksRef.current;
    if (marks.length === 4) {
      marks[0].points([-gap - arm, -gap, -gap, -gap, -gap, -gap - arm]);
      marks[1].points([width + gap + arm, -gap, width + gap, -gap, width + gap, -gap - arm]);
      marks[2].points([-gap - arm, height + gap, -gap, height + gap, -gap, height + gap + arm]);
      marks[3].points([
        width + gap + arm,
        height + gap,
        width + gap,
        height + gap,
        width + gap,
        height + gap + arm
      ]);
    }

    paperLayer.batchDraw();
    terrainLayer.batchDraw();
    objectsLayer.batchDraw();
    frameLayer.batchDraw();
    syncOverlayCursor();
  }, [
    camera,
    doc,
    documentVersionTick,
    terrainRenderTick,
    terrainVisible,
    terrainOpacity,
    effectiveTool,
    brushDiameterDoc,
    store,
    syncOverlayCursor
  ]);

  // Ridisegno isolato del solo terreno (senza doppio rAF quando già accorpato dallo store)
  useEffect(() => {
    const unsub = store.subscribeTerrainRedraw(() => {
      const terrainLayer = terrainLayerRef.current;
      const terrainShape = terrainShapeRef.current;
      if (!terrainLayer || !terrainShape) return;
      terrainLayer.batchDraw();
    });

    return () => {
      unsub();
    };
  }, [store]);

  const computePointerCoords = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const currentCam = store.getSnapshot().camera;
    const docPt = screenToDoc(cssX, cssY, currentCam);
    return {
      rect,
      cssX,
      cssY,
      docX: docPt.x,
      docY: docPt.y,
      camera: currentCam
    };
  };

  const updateSeaHintPosition = (cssX: number, cssY: number, rect: DOMRect) => {
    const maxX = Math.max(12, rect.width - 156);
    const maxY = Math.max(12, rect.height - 40);
    const nextX = clampNumber(cssX + 16, 12, maxX);
    const nextY = clampNumber(cssY + 20, 12, maxY);
    seaHintCoordsRef.current = { x: nextX, y: nextY };
    if (seaHintElRef.current) {
      seaHintElRef.current.style.left = `${nextX}px`;
      seaHintElRef.current.style.top = `${nextY}px`;
    }
  };

  const trySetPointerCapture = (target: Element, pointerId: number) => {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Ignora su eventi sintetici o browser che non supportano la cattura per questo puntatore
    }
  };

  const releaseCaptureIfHeld = (pointerId: number) => {
    const container = containerRef.current;
    if (!container) return;
    try {
      if (container.hasPointerCapture(pointerId)) {
        container.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignora errori se la cattura è già stata rilasciata
    }
  };

  const hideTouchCursorOverlay = () => {
    cursorRef.current.inside = false;
    lastTelemetrySentMsRef.current = 0;
    store.clearCursorSeaHint();
    store.setCursorDoc(null);
    onCursorDocMove?.(null);
    onObjectPointerLeave?.();
    syncOverlayCursor();
  };

  const handlePointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const now = getNowMs();
    if (e.pointerType === 'touch') {
      const snap = store.getSnapshot();
      const isBlockedTouch =
        snap.pencilOnlyMode ||
        activePenPointerIdRef.current !== null ||
        activeTouchPointersRef.current.size >= 1 ||
        (activeTouchPointersRef.current.size === 0 && now - lastPenActivityMsRef.current < 280);
      stage.listening(!isBlockedTouch);
      return;
    }
    stage.listening(true);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const coords = computePointerCoords(e.clientX, e.clientY);
    if (!coords) return;
    const now = getNowMs();
    const pointerType = e.pointerType || 'mouse';

    if (pointerType === 'pen') {
      lastPenActivityMsRef.current = now;
      activePenPointerIdRef.current = e.pointerId;
      if (activeGestureRef.current?.mode === 'pinch') {
        activeGestureRef.current = null;
        activeTouchPointersRef.current.clear();
      }
    } else if (pointerType === 'touch') {
      if (activePenPointerIdRef.current !== null) {
        return;
      }

      activeTouchPointersRef.current.set(e.pointerId, {
        startCssX: coords.cssX,
        startCssY: coords.cssY,
        cssX: coords.cssX,
        cssY: coords.cssY,
        maxMovePx: 0
      });

      if (activeTouchPointersRef.current.size >= 2) {
        const prevGesture = activeGestureRef.current;
        if (prevGesture?.mode === 'brush') {
          releaseCaptureIfHeld(prevGesture.pointerId);
          if (now - prevGesture.startTimeMs <= 250 && prevGesture.movedPx < 36) {
            store.cancelTerrainStroke();
          } else {
            store.commitTerrainStroke();
          }
        } else if (prevGesture?.mode === 'object') {
          if (now - prevGesture.startTimeMs <= 250 && prevGesture.movedPx < 36) {
            onObjectCancelInteraction?.();
          } else {
            onObjectPointerUp?.({
              docX: coords.docX,
              docY: coords.docY,
              cssX: coords.cssX,
              cssY: coords.cssY,
              camera: coords.camera,
              event: e.nativeEvent
            });
          }
        } else if (prevGesture?.mode === 'pan') {
          releaseCaptureIfHeld(prevGesture.pointerId);
        }

        const metrics = computeTwoTouchMetrics(activeTouchPointersRef.current);
        trySetPointerCapture(e.currentTarget, e.pointerId);
        if (prevGesture?.mode === 'pinch') {
          prevGesture.maxTouchCount = Math.max(
            prevGesture.maxTouchCount,
            activeTouchPointersRef.current.size
          );
          if (metrics) {
            prevGesture.prevCenterCssX = metrics.centerCssX;
            prevGesture.prevCenterCssY = metrics.centerCssY;
            prevGesture.prevDistPx = metrics.distPx;
            prevGesture.maxFingerMovePx = Math.max(prevGesture.maxFingerMovePx, metrics.maxMovePx);
          }
        } else if (metrics) {
          activeGestureRef.current = {
            mode: 'pinch',
            startTimeMs: now,
            prevCenterCssX: metrics.centerCssX,
            prevCenterCssY: metrics.centerCssY,
            prevDistPx: metrics.distPx,
            didTransform: false,
            maxTouchCount: activeTouchPointersRef.current.size,
            maxFingerMovePx: metrics.maxMovePx
          };
        }
        hideTouchCursorOverlay();
        return;
      }

      if (activeGestureRef.current?.mode === 'pinch') {
        trySetPointerCapture(e.currentTarget, e.pointerId);
        return;
      }

      const snapNow = store.getSnapshot();
      if (snapNow.pencilOnlyMode) {
        e.preventDefault();
        trySetPointerCapture(e.currentTarget, e.pointerId);
        activeGestureRef.current = {
          mode: 'pan',
          pointerId: e.pointerId,
          pointerType,
          startClientX: e.clientX,
          startClientY: e.clientY,
          lastClientX: e.clientX,
          lastClientY: e.clientY,
          movedPx: 0,
          fromPencilOnly: true
        };
        cursorRef.current.inside = false;
        syncOverlayCursor();
        return;
      }

      if (now - lastPenActivityMsRef.current < 280) {
        // Tracciamento passivo del primo tocco vicino alla penna: ignora il palmo singolo, ma permette un pinch rapido a due dita
        return;
      }
    }

    cursorRef.current = {
      inside: true,
      cssX: coords.cssX,
      cssY: coords.cssY,
      docX: coords.docX,
      docY: coords.docY
    };
    updateSeaHintPosition(coords.cssX, coords.cssY, coords.rect);

    const tool = effectiveToolRef.current;

    if (e.button === 1 || ((e.button === 0 || pointerType !== 'mouse') && tool === 'hand')) {
      e.preventDefault();
      trySetPointerCapture(e.currentTarget, e.pointerId);
      activeGestureRef.current = {
        mode: 'pan',
        pointerId: e.pointerId,
        pointerType,
        startClientX: e.clientX,
        startClientY: e.clientY,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
        movedPx: 0,
        fromPencilOnly: false
      };
      return;
    }

    if (pointerType === 'mouse' && e.button !== 0) return;

    if (isTerrainBrushTool(tool)) {
      e.preventDefault();
      const target = e.currentTarget;
      const penPressure =
        pointerType === 'pen' && Number.isFinite(e.pressure) ? e.pressure : undefined;
      const started = store.beginTerrainStroke(coords.docX, coords.docY, penPressure);
      if (started) {
        trySetPointerCapture(target, e.pointerId);
        activeGestureRef.current = {
          mode: 'brush',
          pointerId: e.pointerId,
          pointerType,
          startTimeMs: now,
          startClientX: e.clientX,
          startClientY: e.clientY,
          movedPx: 0
        };
      }
      syncOverlayCursor();
      return;
    }

    if (onObjectPointerDown) {
      const handled = onObjectPointerDown({
        docX: coords.docX,
        docY: coords.docY,
        cssX: coords.cssX,
        cssY: coords.cssY,
        camera: coords.camera,
        event: e.nativeEvent
      });
      if (handled) {
        if (pointerType !== 'mouse' && tool !== 'select') {
          e.preventDefault();
        }
        activeGestureRef.current = {
          mode: 'object',
          pointerId: e.pointerId,
          pointerType,
          startTimeMs: now,
          startClientX: e.clientX,
          startClientY: e.clientY,
          movedPx: 0
        };
        return;
      }
    }

    if (tool === 'select') {
      const stage = stageRef.current;
      const hit = stage?.getIntersection({ x: coords.cssX, y: coords.cssY });
      if (!hit) {
        store.selectObject(null);
      }
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const coords = computePointerCoords(e.clientX, e.clientY);
    if (!coords) return;
    const now = getNowMs();
    const pointerType = e.pointerType || 'mouse';

    if (pointerType === 'pen') {
      lastPenActivityMsRef.current = now;
    } else if (pointerType === 'touch') {
      if (activePenPointerIdRef.current !== null) {
        return;
      }
      const tracked = activeTouchPointersRef.current.get(e.pointerId);
      if (tracked) {
        tracked.cssX = coords.cssX;
        tracked.cssY = coords.cssY;
        const distFromStart = Math.hypot(
          coords.cssX - tracked.startCssX,
          coords.cssY - tracked.startCssY
        );
        if (distFromStart > tracked.maxMovePx) {
          tracked.maxMovePx = distFromStart;
        }
      }

      const currentGesture = activeGestureRef.current;
      if (currentGesture?.mode === 'pinch') {
        cursorRef.current.inside = false;
        if (tracked && tracked.maxMovePx > currentGesture.maxFingerMovePx) {
          currentGesture.maxFingerMovePx = tracked.maxMovePx;
        }
        const metrics = computeTwoTouchMetrics(activeTouchPointersRef.current);
        if (metrics && currentGesture.prevDistPx > 4 && metrics.distPx > 4) {
          if (metrics.maxMovePx > currentGesture.maxFingerMovePx) {
            currentGesture.maxFingerMovePx = metrics.maxMovePx;
          }
          const panDx = metrics.centerCssX - currentGesture.prevCenterCssX;
          const panDy = metrics.centerCssY - currentGesture.prevCenterCssY;
          const distDelta = Math.abs(metrics.distPx - currentGesture.prevDistPx);
          const scaleRatio = metrics.distPx / currentGesture.prevDistPx;
          if (
            currentGesture.didTransform ||
            Math.hypot(panDx, panDy) > 2 ||
            distDelta > 2
          ) {
            currentGesture.didTransform = true;
            const curScale = store.getSnapshot().camera.scale;
            store.applyPinchTransform(
              metrics.centerCssX,
              metrics.centerCssY,
              panDx,
              panDy,
              curScale * scaleRatio
            );
            currentGesture.prevCenterCssX = metrics.centerCssX;
            currentGesture.prevCenterCssY = metrics.centerCssY;
            currentGesture.prevDistPx = metrics.distPx;
          }
        }
        syncOverlayCursor();
        return;
      }

      if (tracked && !currentGesture) {
        // Primo tocco trattenuto solo come possibile inizio pinch durante la finestra post-penna
        return;
      }
    }

    const gesture = activeGestureRef.current;
    const hideRingDuringFingerPan =
      pointerType === 'touch' && gesture?.mode === 'pan' && gesture.fromPencilOnly;

    cursorRef.current = {
      inside: !hideRingDuringFingerPan,
      cssX: coords.cssX,
      cssY: coords.cssY,
      docX: coords.docX,
      docY: coords.docY
    };

    const nativeEvt = e.nativeEvent;
    const rawCoalesced =
      typeof nativeEvt.getCoalescedEvents === 'function' ? nativeEvt.getCoalescedEvents() : [];

    let isBrushing = false;
    if (
      gesture &&
      gesture.mode !== 'pinch' &&
      gesture.pointerId === e.pointerId
    ) {
      const moveDist = Math.hypot(
        e.clientX - gesture.startClientX,
        e.clientY - gesture.startClientY
      );
      if (moveDist > gesture.movedPx) {
        gesture.movedPx = moveDist;
      }

      if (gesture.mode === 'pan') {
        const dx = e.clientX - gesture.lastClientX;
        const dy = e.clientY - gesture.lastClientY;
        gesture.lastClientX = e.clientX;
        gesture.lastClientY = e.clientY;
        store.panBy(dx, dy);
      } else if (gesture.mode === 'brush') {
        isBrushing = true;
        const sampleEvents = rawCoalesced.length > 0 ? rawCoalesced : [nativeEvt];
        const batch: Array<{ docX: number; docY: number; pressure?: number }> = [];
        let lastBatchCoords = coords;
        for (const ev of sampleEvents) {
          const evCoords = computePointerCoords(ev.clientX, ev.clientY);
          if (!evCoords) continue;
          lastBatchCoords = evCoords;
          batch.push({
            docX: evCoords.docX,
            docY: evCoords.docY,
            pressure:
              ev.pointerType === 'pen' && Number.isFinite(ev.pressure) ? ev.pressure : undefined
          });
        }
        if (batch.length > 0) {
          store.moveTerrainStrokeBatch(batch);
          cursorRef.current.cssX = lastBatchCoords.cssX;
          cursorRef.current.cssY = lastBatchCoords.cssY;
          cursorRef.current.docX = lastBatchCoords.docX;
          cursorRef.current.docY = lastBatchCoords.docY;
        }
      } else if (gesture.mode === 'object' && onObjectPointerMove) {
        const coalescedPoints: CoalescedPointerPoint[] = [];
        for (const ev of rawCoalesced) {
          const evCoords = computePointerCoords(ev.clientX, ev.clientY);
          if (!evCoords) continue;
          coalescedPoints.push({
            cssX: evCoords.cssX,
            cssY: evCoords.cssY,
            docX: evCoords.docX,
            docY: evCoords.docY
          });
        }
        onObjectPointerMove({
          docX: coords.docX,
          docY: coords.docY,
          cssX: coords.cssX,
          cssY: coords.cssY,
          camera: coords.camera,
          event: nativeEvt,
          ...(coalescedPoints.length > 0 ? { coalescedPoints } : {})
        });
      }
    } else if (onObjectPointerMove) {
      const coalescedPoints: CoalescedPointerPoint[] = [];
      for (const ev of rawCoalesced) {
        const evCoords = computePointerCoords(ev.clientX, ev.clientY);
        if (!evCoords) continue;
        coalescedPoints.push({
          cssX: evCoords.cssX,
          cssY: evCoords.cssY,
          docX: evCoords.docX,
          docY: evCoords.docY
        });
      }
      onObjectPointerMove({
        docX: coords.docX,
        docY: coords.docY,
        cssX: coords.cssX,
        cssY: coords.cssY,
        camera: coords.camera,
        event: nativeEvt,
        ...(coalescedPoints.length > 0 ? { coalescedPoints } : {})
      });
    }

    if (!isBrushing && !hideRingDuringFingerPan) {
      store.updateCursorSeaHint(coords.docX, coords.docY);
    }
    if (!hideRingDuringFingerPan) {
      if (!isBrushing || now - lastTelemetrySentMsRef.current >= 40) {
        if (now - lastTelemetrySentMsRef.current >= 32) {
          lastTelemetrySentMsRef.current = now;
          store.setCursorDoc({ x: coords.docX, y: coords.docY });
        }
      }
      updateSeaHintPosition(coords.cssX, coords.cssY, coords.rect);
      onCursorDocMove?.({ x: coords.docX, y: coords.docY });
    }
    syncOverlayCursor();
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const now = getNowMs();
    const pointerType = e.pointerType || 'mouse';

    if (pointerType === 'pen') {
      lastPenActivityMsRef.current = now;
      if (activePenPointerIdRef.current === e.pointerId) {
        activePenPointerIdRef.current = null;
      }
    } else if (pointerType === 'touch') {
      const tracked = activeTouchPointersRef.current.get(e.pointerId);
      activeTouchPointersRef.current.delete(e.pointerId);

      const gestureNow = activeGestureRef.current;
      if (gestureNow?.mode === 'pinch') {
        if (tracked && tracked.maxMovePx > gestureNow.maxFingerMovePx) {
          gestureNow.maxFingerMovePx = tracked.maxMovePx;
        }
        releaseCaptureIfHeld(e.pointerId);
        if (activeTouchPointersRef.current.size === 0) {
          activeGestureRef.current = null;
          if (stageRef.current) stageRef.current.listening(true);
          if (
            !gestureNow.didTransform &&
            now - gestureNow.startTimeMs < 350 &&
            gestureNow.maxFingerMovePx < 18
          ) {
            if (gestureNow.maxTouchCount === 2) {
              store.undo();
            } else if (gestureNow.maxTouchCount >= 3) {
              store.redo();
            }
          }
          hideTouchCursorOverlay();
        }
        return;
      }
    }

    const gesture = activeGestureRef.current;
    if (gesture && gesture.mode !== 'pinch' && gesture.pointerId === e.pointerId) {
      const moveDist = Math.hypot(
        e.clientX - gesture.startClientX,
        e.clientY - gesture.startClientY
      );
      if (moveDist > gesture.movedPx) {
        gesture.movedPx = moveDist;
      }
      activeGestureRef.current = null;
      releaseCaptureIfHeld(e.pointerId);
      if (stageRef.current) stageRef.current.listening(true);

      if (gesture.mode === 'brush') {
        store.commitTerrainStroke();
        const coords = computePointerCoords(e.clientX, e.clientY);
        if (coords && pointerType !== 'touch') {
          lastTelemetrySentMsRef.current = now;
          store.setCursorDoc({ x: coords.docX, y: coords.docY });
        }
        if (pointerType === 'touch') {
          hideTouchCursorOverlay();
        } else {
          syncOverlayCursor();
        }
        return;
      }

      if (gesture.mode === 'pan') {
        if (
          gesture.fromPencilOnly &&
          gesture.movedPx < 8 &&
          !shownPencilOnlyHintRef.current &&
          store.getEffectiveTool() !== 'hand'
        ) {
          shownPencilOnlyHintRef.current = true;
          store.setStatusNotice({
            tone: 'info',
            text: 'Solo Apple Pencil attivo: usa la penna per disegnare o trascina con un dito per spostare la carta.'
          });
        }
        if (pointerType === 'touch') {
          hideTouchCursorOverlay();
        } else {
          syncOverlayCursor();
        }
        return;
      }

      if (gesture.mode === 'object') {
        const coords = computePointerCoords(e.clientX, e.clientY);
        if (coords && onObjectPointerUp) {
          onObjectPointerUp({
            docX: coords.docX,
            docY: coords.docY,
            cssX: coords.cssX,
            cssY: coords.cssY,
            camera: coords.camera,
            event: e.nativeEvent
          });
        }
        if (pointerType !== 'mouse' && coords && gesture.movedPx < 12 && onObjectDoubleClick) {
          const prevTap = lastTouchTapRef.current;
          if (
            prevTap &&
            prevTap.pointerType === pointerType &&
            now - prevTap.timeMs < 360 &&
            Math.hypot(coords.cssX - prevTap.cssX, coords.cssY - prevTap.cssY) < 28
          ) {
            lastTouchTapRef.current = null;
            lastDoubleTapHandledMsRef.current = now;
            onObjectDoubleClick({
              docX: coords.docX,
              docY: coords.docY,
              cssX: coords.cssX,
              cssY: coords.cssY,
              camera: coords.camera,
              event: e.nativeEvent
            });
          } else {
            lastTouchTapRef.current = {
              timeMs: now,
              cssX: coords.cssX,
              cssY: coords.cssY,
              pointerType
            };
          }
        }
        if (pointerType === 'touch') {
          hideTouchCursorOverlay();
        } else {
          syncOverlayCursor();
        }
        return;
      }
    }

    releaseCaptureIfHeld(e.pointerId);
    if (stageRef.current) stageRef.current.listening(true);
    const coords = computePointerCoords(e.clientX, e.clientY);
    if (coords && onObjectPointerUp) {
      onObjectPointerUp({
        docX: coords.docX,
        docY: coords.docY,
        cssX: coords.cssX,
        cssY: coords.cssY,
        camera: coords.camera,
        event: e.nativeEvent
      });
    }
    if (pointerType === 'touch' && activeTouchPointersRef.current.size === 0) {
      hideTouchCursorOverlay();
    }
  };

  const handlePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pointerType = e.pointerType || 'mouse';
    const isLostCapture = e.type === 'lostpointercapture';

    if (pointerType === 'touch') {
      if (isLostCapture && !activeTouchPointersRef.current.has(e.pointerId)) {
        return;
      }
      activeTouchPointersRef.current.delete(e.pointerId);
      releaseCaptureIfHeld(e.pointerId);
      if (activeGestureRef.current?.mode === 'pinch') {
        if (activeTouchPointersRef.current.size === 0) {
          activeGestureRef.current = null;
          if (stageRef.current) stageRef.current.listening(true);
          hideTouchCursorOverlay();
        }
        return;
      }
    }

    if (pointerType === 'pen' && activePenPointerIdRef.current === e.pointerId) {
      if (!isLostCapture) {
        activePenPointerIdRef.current = null;
        lastPenActivityMsRef.current = getNowMs();
      }
    }

    const gesture = activeGestureRef.current;
    if (!gesture || gesture.mode === 'pinch') return;
    if (isLostCapture && gesture.pointerId !== e.pointerId) return;

    activeGestureRef.current = null;
    releaseCaptureIfHeld(e.pointerId);
    if (stageRef.current) stageRef.current.listening(true);
    if (gesture.mode === 'brush') {
      store.cancelTerrainStroke();
    } else if (gesture.mode === 'object') {
      onObjectCancelInteraction?.();
    }
    if (pointerType === 'touch') {
      hideTouchCursorOverlay();
    } else {
      syncOverlayCursor();
    }
  };

  const handlePointerLeave = () => {
    if (activeGestureRef.current) return;
    cursorRef.current.inside = false;
    lastTelemetrySentMsRef.current = 0;
    store.clearCursorSeaHint();
    store.setCursorDoc(null);
    onCursorDocMove?.(null);
    onObjectPointerLeave?.();
    syncOverlayCursor();
  };

  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!onObjectDoubleClick) return;
    if (getNowMs() - lastDoubleTapHandledMsRef.current < 180) return;
    const coords = computePointerCoords(e.clientX, e.clientY);
    if (!coords) return;
    onObjectDoubleClick({
      docX: coords.docX,
      docY: coords.docY,
      cssX: coords.cssX,
      cssY: coords.cssY,
      camera: coords.camera,
      event: e.nativeEvent
    });
  };

  let cursorStyle = 'default';
  if (effectiveTool === 'hand') {
    cursorStyle = activeGestureRef.current?.mode === 'pan' ? 'grabbing' : 'grab';
  } else if (
    isTerrainBrushTool(effectiveTool) ||
    effectiveTool === 'path' ||
    effectiveTool === 'district' ||
    effectiveTool === 'street' ||
    effectiveTool === 'streetGrid' ||
    effectiveTool === 'cityWall'
  ) {
    cursorStyle = 'crosshair';
  } else if (
    effectiveTool === 'poi' ||
    effectiveTool === 'building' ||
    effectiveTool === 'plaza'
  ) {
    cursorStyle = 'copy';
  } else if (effectiveTool === 'label') {
    cursorStyle = 'text';
  }

  return (
    <main
      ref={containerRef}
      className="editor-stage-wrap"
      aria-label="Area di lavoro della carta"
      style={{ cursor: cursorStyle }}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={handleDoubleClick}
    >
      <div ref={stageHostRef} className="editor-stage-host" />

      {inlineEditorSlot}

      {terrainLocked || (!terrainVisible && isTerrainBrushTool(effectiveTool)) ? (
        <div className="stage-terrain-lock-pill" role="status" aria-live="polite">
          <LockClosedIcon size={15} />
          <span>
            {terrainLocked && !terrainVisible
              ? 'Terreno bloccato e nascosto'
              : terrainLocked
                ? 'Livello terreno bloccato'
                : 'Livello terreno nascosto'}
          </span>
        </div>
      ) : null}

      {!hasLand ? (
        <div className="stage-empty-aid" role="status" aria-live="polite">
          Disegna la prima costa con Terra
        </div>
      ) : doc.manifest.kind === 'city' && doc.manifest.objects.length === 0 ? (
        <div className="stage-empty-aid" role="status" aria-live="polite">
          Traccia le strade o dipingi un quartiere, oppure usa Genera…
        </div>
      ) : null}

      {seaOnlyHintVisible ? (
        <div
          ref={seaHintElRef}
          className="stage-sea-hint"
          role="status"
          aria-live="polite"
          style={{
            left: `${seaHintCoordsRef.current.x}px`,
            top: `${seaHintCoordsRef.current.y}px`
          }}
        >
          Dipingi sulla terra
        </div>
      ) : null}
    </main>
  );
}
