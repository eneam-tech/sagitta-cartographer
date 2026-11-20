import { PDFDocument } from 'pdf-lib';
import {
  BUILTIN_POI_CATALOG,
  disposeLoadedAssets,
  getCatalogItemById,
  loadAssetsForDocument
} from '../assets/catalog';
import { LoadedAssetMap } from '../assets/types';
import {
  DEFAULT_EXPORT_PPI,
  mmToPdfPoints,
  mmToPrintPx,
  validatePageSizeMm
} from '../model/coordinates';
import { AssetManifestEntry, MapDocument } from '../model/document';
import {
  composeDocumentTerrainRgba,
  composeDocumentToCanvas,
  encodeRgbaPng
} from '../render/composeDocument';
import { ITerrainRenderer } from '../terrain/types';
import { PdfExportOptions, PdfExportResult } from './types';

export interface RasterPngRenderContext {
  doc: MapDocument;
  assets: LoadedAssetMap;
  widthPx: number;
  heightPx: number;
  existingTerrainRenderer?: ITerrainRenderer;
}

export interface ExtendedPdfExportOptions extends PdfExportOptions {
  extraAssetBlobs?: Map<string, Blob>;
  existingTerrainRenderer?: ITerrainRenderer;
  isGestureActive?: () => boolean;
  loadAssetsFn?: (
    doc: MapDocument,
    extraAssetBlobs?: Map<string, Blob>
  ) => Promise<LoadedAssetMap>;
  disposeAssetsFn?: (assets: LoadedAssetMap) => void;
  renderRasterPngFn?: (
    context: RasterPngRenderContext
  ) => Promise<Uint8Array> | Uint8Array;
  onDisposeTemporaryResources?: () => void;
}

/**
 * Derives a cross-platform `.pdf` filename from the map title (or an explicit
 * filename override), falling back to `carta.pdf`.
 */
export function buildPdfFilename(title: string, explicitFilename?: string): string {
  if (explicitFilename && explicitFilename.trim()) {
    const cleaned = explicitFilename
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (cleaned) {
      return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
    }
  }

  const slug = (title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${slug || 'carta'}.pdf`;
}

async function resolveAssetsWithoutDom(
  doc: MapDocument,
  extraAssetBlobs?: Map<string, Blob>
): Promise<LoadedAssetMap> {
  const result: LoadedAssetMap = new Map();
  const entriesById = new Map<string, AssetManifestEntry>();

  for (const item of BUILTIN_POI_CATALOG) {
    entriesById.set(item.asset.id, item.asset);
  }
  for (const entry of doc.manifest.assets) {
    entriesById.set(entry.id, entry);
  }

  const neededAssetIds = new Set<string>();
  for (const entry of doc.manifest.assets) neededAssetIds.add(entry.id);
  for (const obj of doc.manifest.objects) {
    if (obj.type === 'stamp') neededAssetIds.add(obj.assetId);
  }

  for (const assetId of neededAssetIds) {
    const entry = entriesById.get(assetId);
    if (!entry) {
      throw new Error(`Risorsa "${assetId}" non trovata nel manifest né nel catalogo.`);
    }
    const blob = extraAssetBlobs?.get(entry.path) ?? extraAssetBlobs?.get(assetId);
    if (blob) {
      if (blob.size === 0) {
        throw new Error(`Impossibile caricare la risorsa "${assetId}" (${entry.path}).`);
      }
      result.set(assetId, { entry, image: null as unknown as HTMLImageElement });
      continue;
    }

    const catalogItem = getCatalogItemById(assetId);
    if (catalogItem) {
      result.set(assetId, { entry, image: null as unknown as HTMLImageElement });
      continue;
    }

    throw new Error(`File risorsa "${entry.path}" (${assetId}) mancante.`);
  }

  return result;
}

async function canvasToPngUint8Array(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('Esportazione PNG da canvas non supportata in questo ambiente.'));
      return;
    }
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Impossibile codificare l’immagine PNG della carta.'));
        }
      },
      'image/png'
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Exports a confirmed `MapDocument` snapshot to an exact physical-dimension PDF
 * using the shared document compositor (or pure-TS RGBA PNG fallback in Node).
 */
export async function exportDocumentToPdf(
  doc: MapDocument,
  options?: ExtendedPdfExportOptions
): Promise<PdfExportResult> {
  let loadedAssets: LoadedAssetMap | null = null;
  let tempCanvas: HTMLCanvasElement | null = null;

  try {
    if (options?.isGestureActive?.()) {
      throw new Error(
        'Impossibile esportare il PDF mentre è in corso un gesto sulla tela. Completa o annulla il tratto corrente.'
      );
    }

    const ppi = options?.ppi ?? DEFAULT_EXPORT_PPI;
    if (!Number.isFinite(ppi) || ppi <= 0) {
      throw new Error(`Risoluzione di stampa (ppi) non valida: ${String(ppi)}.`);
    }

    validatePageSizeMm(doc.manifest.page);

    const rasterWidthPx = mmToPrintPx(doc.manifest.page.widthMm, ppi);
    const rasterHeightPx = mmToPrintPx(doc.manifest.page.heightMm, ppi);
    const pageWidthPt = mmToPdfPoints(doc.manifest.page.widthMm);
    const pageHeightPt = mmToPdfPoints(doc.manifest.page.heightMm);

    if (rasterWidthPx <= 0 || rasterHeightPx <= 0) {
      throw new Error('Dimensioni raster di stampa non valide.');
    }

    if (typeof document !== 'undefined' && document.fonts?.ready) {
      await document.fonts.ready;
    }

    if (options?.loadAssetsFn) {
      loadedAssets = await options.loadAssetsFn(doc, options.extraAssetBlobs);
    } else if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
      loadedAssets = await loadAssetsForDocument(doc, options?.extraAssetBlobs);
    } else {
      loadedAssets = await resolveAssetsWithoutDom(doc, options?.extraAssetBlobs);
    }

    let pngBytes: Uint8Array;
    if (options?.renderRasterPngFn) {
      pngBytes = await options.renderRasterPngFn({
        doc,
        assets: loadedAssets,
        widthPx: rasterWidthPx,
        heightPx: rasterHeightPx,
        existingTerrainRenderer: options.existingTerrainRenderer
      });
    } else if (typeof document !== 'undefined') {
      tempCanvas = document.createElement('canvas');
      tempCanvas.width = rasterWidthPx;
      tempCanvas.height = rasterHeightPx;
      composeDocumentToCanvas(doc, loadedAssets, {
        widthPx: rasterWidthPx,
        heightPx: rasterHeightPx,
        existingTerrainRenderer: options?.existingTerrainRenderer,
        targetCanvas: tempCanvas
      });
      pngBytes = await canvasToPngUint8Array(tempCanvas);
    } else {
      const terrain = composeDocumentTerrainRgba(doc, options?.existingTerrainRenderer);
      pngBytes = encodeRgbaPng(
        terrain.rgba,
        terrain.width,
        terrain.height,
        rasterWidthPx,
        rasterHeightPx
      );
    }

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(doc.manifest.title?.trim() || 'Carta');
    pdfDoc.setCreator('Il tavolo del cartografo');
    pdfDoc.setProducer('Il tavolo del cartografo (pdf-lib)');

    const embeddedPng = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    page.drawImage(embeddedPng, {
      x: 0,
      y: 0,
      width: pageWidthPt,
      height: pageHeightPt
    });

    const bytes = await pdfDoc.save();
    const filename = buildPdfFilename(doc.manifest.title, options?.filename);

    return {
      bytes,
      filename,
      pageWidthPt,
      pageHeightPt,
      rasterWidthPx,
      rasterHeightPx
    };
  } finally {
    if (tempCanvas) {
      tempCanvas.width = 0;
      tempCanvas.height = 0;
      tempCanvas = null;
    }
    if (loadedAssets) {
      const disposeFn = options?.disposeAssetsFn ?? disposeLoadedAssets;
      disposeFn(loadedAssets);
      loadedAssets = null;
    }
    options?.onDisposeTemporaryResources?.();
  }
}

/**
 * Triggers a browser download for a generated PDF result and schedules Blob URL cleanup.
 */
export function triggerPdfDownload(result: PdfExportResult): void {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return;
  }

  const buffer = new ArrayBuffer(result.bytes.byteLength);
  new Uint8Array(buffer).set(result.bytes);
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
