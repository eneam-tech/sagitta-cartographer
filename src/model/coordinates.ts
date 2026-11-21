export const DOC_UNITS_PER_MM = 10;
export const DEFAULT_EXPORT_PPI = 300;
export const MAX_MASK_PIXELS = 32_000_000;
export const DEFAULT_INTERACTIVE_MAX_MASK_PIXELS = 12_000_000;
export const MIN_PAGE_MM = 50;
export const MAX_PAGE_MM = 2000;
export const MIN_MASK_DIM_PX = 64;
export const MAX_MASK_DIM_PX = 8192;

export type ResizeAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export type ResizeCanvasMode = 'expand-crop' | 'scale-content';

export interface PageSizeMm {
  widthMm: number;
  heightMm: number;
}

export interface DocSpace {
  width: number;
  height: number;
}

export interface MaskDimensions {
  widthPx: number;
  heightPx: number;
}

export interface PagePreset {
  id: string;
  label: string;
  page: PageSizeMm;
}

export const PAGE_PRESETS: readonly PagePreset[] = [
  { id: 'a4-landscape', label: 'A4 orizzontale (297 × 210 mm)', page: { widthMm: 297, heightMm: 210 } },
  { id: 'a4-portrait', label: 'A4 verticale (210 × 297 mm)', page: { widthMm: 210, heightMm: 297 } },
  { id: 'a3-landscape', label: 'A3 orizzontale (420 × 297 mm)', page: { widthMm: 420, heightMm: 297 } },
  { id: 'a3-portrait', label: 'A3 verticale (297 × 420 mm)', page: { widthMm: 297, heightMm: 420 } },
  { id: 'a2-landscape', label: 'A2 orizzontale (594 × 420 mm)', page: { widthMm: 594, heightMm: 420 } },
  { id: 'a1-landscape', label: 'A1 orizzontale (841 × 594 mm)', page: { widthMm: 841, heightMm: 594 } },
  { id: 'square-large', label: 'Quadrato grande (500 × 500 mm)', page: { widthMm: 500, heightMm: 500 } }
] as const;

export interface CameraState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export function mmToPdfPoints(mm: number): number {
  return (mm * 72) / 25.4;
}

export function mmToPrintPx(mm: number, ppi = DEFAULT_EXPORT_PPI): number {
  return Math.round((mm * ppi) / 25.4);
}

export function ptToDocUnits(pt: number): number {
  return ((pt * 25.4) / 72) * DOC_UNITS_PER_MM;
}

export function pageMmToSpace(page: PageSizeMm): DocSpace {
  return {
    width: Math.round(page.widthMm * DOC_UNITS_PER_MM),
    height: Math.round(page.heightMm * DOC_UNITS_PER_MM)
  };
}

export function pageMmToMaskDimensions(page: PageSizeMm, ppi = DEFAULT_EXPORT_PPI): MaskDimensions {
  const widthPx = mmToPrintPx(page.widthMm, ppi);
  const heightPx = mmToPrintPx(page.heightMm, ppi);
  if (widthPx * heightPx <= MAX_MASK_PIXELS && widthPx <= MAX_MASK_DIM_PX && heightPx <= MAX_MASK_DIM_PX) {
    return { widthPx, heightPx };
  }
  const scale = Math.min(
    MAX_MASK_DIM_PX / widthPx,
    MAX_MASK_DIM_PX / heightPx,
    Math.sqrt(MAX_MASK_PIXELS / (widthPx * heightPx))
  );
  return {
    widthPx: Math.max(MIN_MASK_DIM_PX, Math.floor(widthPx * scale)),
    heightPx: Math.max(MIN_MASK_DIM_PX, Math.floor(heightPx * scale))
  };
}

/**
 * Computes default terrain mask dimensions for interactive editing so small sheets (A4)
 * retain full 300 ppi terrain cells while oversized sheets (A3-A1, custom up to 2000 mm)
 * remain fluid in memory and painting speed while vectors stay at full resolution.
 */
export function pageMmToInteractiveMaskDimensions(
  page: PageSizeMm,
  ppi = DEFAULT_EXPORT_PPI,
  maxPixels = DEFAULT_INTERACTIVE_MAX_MASK_PIXELS
): MaskDimensions {
  const widthPx = mmToPrintPx(page.widthMm, ppi);
  const heightPx = mmToPrintPx(page.heightMm, ppi);
  if (widthPx * heightPx <= maxPixels && widthPx <= MAX_MASK_DIM_PX && heightPx <= MAX_MASK_DIM_PX) {
    return { widthPx, heightPx };
  }
  const scale = Math.min(
    MAX_MASK_DIM_PX / widthPx,
    MAX_MASK_DIM_PX / heightPx,
    Math.sqrt(maxPixels / (widthPx * heightPx))
  );
  return {
    widthPx: Math.max(MIN_MASK_DIM_PX, Math.floor(widthPx * scale)),
    heightPx: Math.max(MIN_MASK_DIM_PX, Math.floor(heightPx * scale))
  };
}

/**
 * Computes the shift (dx, dy) that maps old coordinates into the resized canvas
 * while keeping the chosen 9-point anchor fixed.
 */
export function computeAnchorOffset(
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  anchor: ResizeAnchor
): { dx: number; dy: number } {
  const dw = newW - oldW;
  const dh = newH - oldH;

  let dx: number;
  if (anchor === 'top-left' || anchor === 'left' || anchor === 'bottom-left') {
    dx = 0;
  } else if (anchor === 'top-right' || anchor === 'right' || anchor === 'bottom-right') {
    dx = dw;
  } else {
    dx = dw / 2;
  }

  let dy: number;
  if (anchor === 'top-left' || anchor === 'top' || anchor === 'top-right') {
    dy = 0;
  } else if (anchor === 'bottom-left' || anchor === 'bottom' || anchor === 'bottom-right') {
    dy = dh;
  } else {
    dy = dh / 2;
  }

  return { dx, dy };
}

/**
 * Clamps print/PDF raster export dimensions to safe HTMLCanvas/memory limits and returns
 * the actual effective PPI used for the page.
 */
export function clampPrintDimensions(
  page: PageSizeMm,
  requestedPpi: number,
  maxPrintPixels = MAX_MASK_PIXELS,
  maxDimPx = MAX_MASK_DIM_PX
): { widthPx: number; heightPx: number; effectivePpi: number } {
  const safePpi = clampNumber(requestedPpi, 72, 600);
  const rawW = mmToPrintPx(page.widthMm, safePpi);
  const rawH = mmToPrintPx(page.heightMm, safePpi);
  if (rawW * rawH <= maxPrintPixels && rawW <= maxDimPx && rawH <= maxDimPx) {
    return { widthPx: rawW, heightPx: rawH, effectivePpi: Math.round(safePpi) };
  }
  const scale = Math.min(
    maxDimPx / rawW,
    maxDimPx / rawH,
    Math.sqrt(maxPrintPixels / (rawW * rawH))
  );
  const widthPx = Math.max(MIN_MASK_DIM_PX, Math.floor(rawW * scale));
  const heightPx = Math.max(MIN_MASK_DIM_PX, Math.floor(rawH * scale));
  const effectivePpi = Math.max(72, Math.round(safePpi * scale));
  return { widthPx, heightPx, effectivePpi };
}

export function docToMaskX(xDoc: number, space: DocSpace, terrain: MaskDimensions): number {
  return (xDoc / space.width) * terrain.widthPx;
}

export function docToMaskY(yDoc: number, space: DocSpace, terrain: MaskDimensions): number {
  return (yDoc / space.height) * terrain.heightPx;
}

export function maskToDocX(xPx: number, space: DocSpace, terrain: MaskDimensions): number {
  return (xPx / terrain.widthPx) * space.width;
}

export function maskToDocY(yPx: number, space: DocSpace, terrain: MaskDimensions): number {
  return (yPx / terrain.heightPx) * space.height;
}

export function docDistToMaskPxX(distDoc: number, space: DocSpace, terrain: MaskDimensions): number {
  return (distDoc / space.width) * terrain.widthPx;
}

export function docDistToMaskPxY(distDoc: number, space: DocSpace, terrain: MaskDimensions): number {
  return (distDoc / space.height) * terrain.heightPx;
}

export function screenToDoc(cssX: number, cssY: number, camera: CameraState): Point2D {
  return {
    x: (cssX - camera.offsetX) / camera.scale,
    y: (cssY - camera.offsetY) / camera.scale
  };
}

export function docToScreen(docX: number, docY: number, camera: CameraState): Point2D {
  return {
    x: docX * camera.scale + camera.offsetX,
    y: docY * camera.scale + camera.offsetY
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function zoomAtPoint(
  camera: CameraState,
  cssX: number,
  cssY: number,
  requestedScale: number,
  minScale = 0.08,
  maxScale = 12
): CameraState {
  const nextScale = clampNumber(requestedScale, minScale, maxScale);
  const docPoint = screenToDoc(cssX, cssY, camera);
  return {
    scale: nextScale,
    offsetX: cssX - docPoint.x * nextScale,
    offsetY: cssY - docPoint.y * nextScale
  };
}

export function fitCameraToViewport(
  space: DocSpace,
  viewportWidth: number,
  viewportHeight: number,
  paddingPx = 48
): CameraState {
  const availW = Math.max(64, viewportWidth - paddingPx * 2);
  const availH = Math.max(64, viewportHeight - paddingPx * 2);
  const scale = clampNumber(Math.min(availW / space.width, availH / space.height), 0.05, 4);
  const renderedW = space.width * scale;
  const renderedH = space.height * scale;
  return {
    scale,
    offsetX: (viewportWidth - renderedW) / 2,
    offsetY: (viewportHeight - renderedH) / 2
  };
}

export function validatePageSizeMm(page: PageSizeMm): void {
  if (
    !Number.isFinite(page.widthMm) ||
    !Number.isFinite(page.heightMm) ||
    page.widthMm < MIN_PAGE_MM ||
    page.widthMm > MAX_PAGE_MM ||
    page.heightMm < MIN_PAGE_MM ||
    page.heightMm > MAX_PAGE_MM
  ) {
    throw new Error(
      `Dimensioni pagina non valide (${page.widthMm} × ${page.heightMm} mm). Intervallo consentito: ${MIN_PAGE_MM}–${MAX_PAGE_MM} mm.`
    );
  }
}

export function validateMaskDimensions(dim: MaskDimensions): void {
  if (
    !Number.isInteger(dim.widthPx) ||
    !Number.isInteger(dim.heightPx) ||
    dim.widthPx < MIN_MASK_DIM_PX ||
    dim.widthPx > MAX_MASK_DIM_PX ||
    dim.heightPx < MIN_MASK_DIM_PX ||
    dim.heightPx > MAX_MASK_DIM_PX ||
    dim.widthPx * dim.heightPx > MAX_MASK_PIXELS
  ) {
    throw new Error(
      `Risoluzione terreno non valida (${dim.widthPx} × ${dim.heightPx} px).`
    );
  }
}
