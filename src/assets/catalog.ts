import { AssetManifestEntry, MapDocument } from '../model/document';
import { LoadedAssetMap, LoadedAssetResource, POI_CATEGORIES, PoiCatalogItem } from './types';
export { POI_CATEGORIES };
import citadelSvg from './svg/poi-citadel.svg?raw';
import harborSvg from './svg/poi-harbor.svg?raw';
import monolithSvg from './svg/poi-monolith.svg?raw';
import ruinSvg from './svg/poi-ruin.svg?raw';
import settlementSvg from './svg/poi-settlement.svg?raw';
import towerSvg from './svg/poi-tower.svg?raw';

interface BuiltinPoiSpec {
  id: string;
  categoryId: string;
  categoryLabel: string;
  tags: readonly string[];
  name: string;
  description: string;
  defaultWidthDoc: number;
  defaultHeightDoc: number;
  svgRaw: string;
}

/** Builds a normalized CC0-1.0 built-in POI catalog entry with 128x128 viewBox and centered anchor. */
function makeBuiltinPoiItem(spec: BuiltinPoiSpec): PoiCatalogItem {
  return {
    id: spec.id,
    categoryId: spec.categoryId,
    categoryLabel: spec.categoryLabel,
    tags: spec.tags,
    name: spec.name,
    description: spec.description,
    defaultWidthDoc: spec.defaultWidthDoc,
    defaultHeightDoc: spec.defaultHeightDoc,
    asset: {
      id: spec.id,
      path: `assets/${spec.id}.svg`,
      mimeType: 'image/svg+xml',
      version: 1,
      author: 'Il tavolo del cartografo',
      source: 'builtin',
      license: 'CC0-1.0',
      width: 128,
      height: 128,
      anchorX: 0.5,
      anchorY: 0.5
    },
    svgContent: spec.svgRaw.trim()
  };
}

export const BUILTIN_POI_CATALOG: readonly PoiCatalogItem[] = [
  makeBuiltinPoiItem({
    id: 'poi-settlement',
    categoryId: 'settlements',
    categoryLabel: 'Insediamenti',
    tags: ['borgo', 'città', 'villaggio'],
    name: 'Insediamento',
    description: 'Borgo murato con cinta merlata, porta ad arco e tetti rossi',
    defaultWidthDoc: 110,
    defaultHeightDoc: 110,
    svgRaw: settlementSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-harbor',
    categoryId: 'coasts',
    categoryLabel: 'Coste e Porti',
    tags: ['porto', 'faro', 'nave'],
    name: 'Porto',
    description: 'Faro costiero con banchina e barca a vela ormeggiata',
    defaultWidthDoc: 112,
    defaultHeightDoc: 112,
    svgRaw: harborSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-tower',
    categoryId: 'fortresses',
    categoryLabel: 'Fortezze',
    tags: ['torre', 'guardia', 'vedetta'],
    name: 'Torre',
    description: 'Torre di guardia isolata su zoccolo roccioso',
    defaultWidthDoc: 96,
    defaultHeightDoc: 96,
    svgRaw: towerSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-ruin',
    categoryId: 'ruins',
    categoryLabel: 'Rovine e Misteri',
    tags: ['rovina', 'tempio', 'antico'],
    name: 'Rovina',
    description: 'Archi spezzati, colonna abbattuta e pietre antiche',
    defaultWidthDoc: 102,
    defaultHeightDoc: 102,
    svgRaw: ruinSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-citadel',
    categoryId: 'fortresses',
    categoryLabel: 'Fortezze',
    tags: ['cittadella', 'castello', 'fortezza'],
    name: 'Cittadella',
    description: 'Fortezza arroccata con mastio centrale e bastioni angolari',
    defaultWidthDoc: 118,
    defaultHeightDoc: 118,
    svgRaw: citadelSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-monolith',
    categoryId: 'ruins',
    categoryLabel: 'Rovine e Misteri',
    tags: ['monolite', 'pietra', 'runa'],
    name: 'Monolite',
    description: 'Stele di pietra scura con incisione dorata e cerchio di pietre',
    defaultWidthDoc: 90,
    defaultHeightDoc: 90,
    svgRaw: monolithSvg
  })
];

export function getCatalogItemById(id: string): PoiCatalogItem | undefined {
  return BUILTIN_POI_CATALOG.find((item) => item.id === id);
}

export function getBuiltinAssetSvgBytes(assetId: string): Uint8Array | null {
  const item = getCatalogItemById(assetId);
  if (!item) return null;
  return new TextEncoder().encode(item.svgContent);
}

export function svgToDataUrl(svgContent: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
}

function loadImageFromSrc(src: string, assetId: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Impossibile caricare la risorsa "${assetId}".`));
    img.src = src;
  });
}

export async function loadAssetsForDocument(
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
      const objectUrl = URL.createObjectURL(blob);
      const image = await loadImageFromSrc(objectUrl, assetId);
      const resource: LoadedAssetResource = { entry, image, objectUrl };
      result.set(assetId, resource);
      continue;
    }

    const catalogItem = getCatalogItemById(assetId);
    if (catalogItem) {
      const image = await loadImageFromSrc(svgToDataUrl(catalogItem.svgContent), assetId);
      result.set(assetId, { entry, image });
      continue;
    }

    throw new Error(`File risorsa "${entry.path}" (${assetId}) mancante.`);
  }

  return result;
}

export function disposeLoadedAssets(assets: LoadedAssetMap): void {
  for (const res of assets.values()) {
    if (res.objectUrl) {
      URL.revokeObjectURL(res.objectUrl);
    }
  }
}
