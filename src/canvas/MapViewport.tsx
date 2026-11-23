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

export interface ViewportPointerContext {
  docX: number;
  docY: number;
  cssX: number;
  cssY: number;
  camera: CameraState;
  event: PointerEvent | MouseEvent;
}

export interface MapViewportProps {
  store: EditorStore;
  onLayersReady?: (handle: ViewportLayersHandle | null) => void;
  onObjectPointerDown?: (ctx: ViewportPointerContext) => boolean;
  onObjectPointerMove?: (ctx: ViewportPointerContext) => void;
  onObjectPointerUp?: (ctx: ViewportPointerContext) => void;
  onObjectDoubleClick?: (ctx: ViewportPointerContext) => void;
  onCursorDocMove?: (docPoint: { x: number; y: number } | null) => void;
  inlineEditorSlot?: ReactNode;
}

type ActiveGesture =
  | { mode: 'pan'; pointerId: number; lastClientX: number; lastClientY: number }
  | { mode: 'brush'; pointerId: number }
  | null;

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
  const cursorRef = useRef<CursorState>({ inside: false, cssX: 0, cssY: 0, docX: 0, docY: 0 });
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

    overlayLayer.add(atlasFrameShape, pageBorder, ...regMarks, fallbackGhostGroup, brushGroup);

    stage.add(paperLayer, terrainLayer, objectsLayer, overlayLayer);

    stageRef.current = stage;
    paperLayerRef.current = paperLayer;
    terrainLayerRef.current = terrainLayer;
    objectsLayerRef.current = objectsLayer;
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
      onLayersReadyRef.current?.(null);
      stage.destroy();
      stageRef.current = null;
      paperLayerRef.current = null;
      terrainLayerRef.current = null;
      objectsLayerRef.current = null;
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

  // Sincronizza camera, dimensioni pagina, ritaglio livello oggetti e segni di registro
  useEffect(() => {
    const paperLayer = paperLayerRef.current;
    const terrainLayer = terrainLayerRef.current;
    const objectsLayer = objectsLayerRef.current;
    const overlayLayer = overlayLayerRef.current;
    if (!paperLayer || !terrainLayer || !objectsLayer || !overlayLayer) return;

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

  // Ridisegno isolato e accorpato per frame del solo terreno durante la pennellata
  useEffect(() => {
    let rafId: number | null = null;
    const flushTerrainDraw = () => {
      rafId = null;
      const terrainLayer = terrainLayerRef.current;
      const terrainShape = terrainShapeRef.current;
      if (!terrainLayer || !terrainShape) return;
      terrainLayer.batchDraw();
    };

    const unsub = store.subscribeTerrainRedraw(() => {
      if (typeof requestAnimationFrame === 'function') {
        if (rafId === null) {
          rafId = requestAnimationFrame(flushTerrainDraw);
        }
      } else {
        flushTerrainDraw();
      }
    });

    return () => {
      unsub();
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
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

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const coords = computePointerCoords(e.clientX, e.clientY);
    if (!coords) return;

    cursorRef.current = {
      inside: true,
      cssX: coords.cssX,
      cssY: coords.cssY,
      docX: coords.docX,
      docY: coords.docY
    };
    updateSeaHintPosition(coords.cssX, coords.cssY, coords.rect);

    const tool = effectiveToolRef.current;

    if (e.button === 1 || (e.button === 0 && tool === 'hand')) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      activeGestureRef.current = {
        mode: 'pan',
        pointerId: e.pointerId,
        lastClientX: e.clientX,
        lastClientY: e.clientY
      };
      return;
    }

    if (e.button !== 0) return;

    if (isTerrainBrushTool(tool)) {
      e.preventDefault();
      const target = e.currentTarget;
      const started = store.beginTerrainStroke(coords.docX, coords.docY);
      if (started) {
        target.setPointerCapture(e.pointerId);
        activeGestureRef.current = { mode: 'brush', pointerId: e.pointerId };
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

    cursorRef.current = {
      inside: true,
      cssX: coords.cssX,
      cssY: coords.cssY,
      docX: coords.docX,
      docY: coords.docY
    };

    const gesture = activeGestureRef.current;
    if (gesture && gesture.pointerId === e.pointerId) {
      if (gesture.mode === 'pan') {
        const dx = e.clientX - gesture.lastClientX;
        const dy = e.clientY - gesture.lastClientY;
        gesture.lastClientX = e.clientX;
        gesture.lastClientY = e.clientY;
        store.panBy(dx, dy);
      } else if (gesture.mode === 'brush') {
        store.moveTerrainStroke(coords.docX, coords.docY);
      }
    } else if (onObjectPointerMove) {
      onObjectPointerMove({
        docX: coords.docX,
        docY: coords.docY,
        cssX: coords.cssX,
        cssY: coords.cssY,
        camera: coords.camera,
        event: e.nativeEvent
      });
    }

    store.updateCursorSeaHint(coords.docX, coords.docY);
    store.setCursorDoc({ x: coords.docX, y: coords.docY });
    updateSeaHintPosition(coords.cssX, coords.cssY, coords.rect);
    onCursorDocMove?.({ x: coords.docX, y: coords.docY });
    syncOverlayCursor();
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = activeGestureRef.current;
    if (gesture && gesture.pointerId === e.pointerId) {
      activeGestureRef.current = null;
      releaseCaptureIfHeld(e.pointerId);
      if (gesture.mode === 'brush') {
        store.commitTerrainStroke();
      }
      syncOverlayCursor();
      return;
    }

    releaseCaptureIfHeld(e.pointerId);
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
  };

  const handlePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = activeGestureRef.current;
    if (!gesture) return;
    activeGestureRef.current = null;
    releaseCaptureIfHeld(e.pointerId);
    if (gesture.mode === 'brush') {
      store.cancelTerrainStroke();
    }
    syncOverlayCursor();
  };

  const handlePointerLeave = () => {
    if (activeGestureRef.current) return;
    cursorRef.current.inside = false;
    store.clearCursorSeaHint();
    store.setCursorDoc(null);
    onCursorDocMove?.(null);
    syncOverlayCursor();
  };

  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!onObjectDoubleClick) return;
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
  } else if (isTerrainBrushTool(effectiveTool) || effectiveTool === 'path') {
    cursorStyle = 'crosshair';
  } else if (effectiveTool === 'poi') {
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
