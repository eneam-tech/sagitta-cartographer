import { AssetManifestEntry, MapDocument } from '../model/document';
import { LoadedAssetMap, LoadedAssetResource, PoiCatalogItem } from './types';

function makeProvisionalPoiSvg(title: string, bodySvg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="${title}">
  ${bodySvg}
</svg>`;
}

export const BUILTIN_POI_CATALOG: readonly PoiCatalogItem[] = [
  {
    id: 'poi-settlement',
    categoryId: 'settlement',
    name: 'Insediamento',
    description: 'Cittadella o borgo murato con tetti rossi',
    defaultWidthDoc: 110,
    defaultHeightDoc: 110,
    asset: {
      id: 'poi-settlement',
      path: 'assets/poi-settlement.svg',
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
    svgContent: makeProvisionalPoiSvg(
      'Insediamento',
      `<ellipse cx="64" cy="96" rx="42" ry="12" fill="#263C40" opacity="0.22"/>
       <rect x="26" y="64" width="76" height="30" rx="3" fill="#E8D8AF" stroke="#263C40" stroke-width="4"/>
       <polygon points="22,64 46,40 70,64" fill="#8B493D" stroke="#263C40" stroke-width="4" stroke-linejoin="round"/>
       <polygon points="56,64 82,36 106,64" fill="#8B493D" stroke="#263C40" stroke-width="4" stroke-linejoin="round"/>
       <rect x="57" y="74" width="14" height="20" rx="2" fill="#263C40"/>`
    )
  },
  {
    id: 'poi-harbor',
    categoryId: 'harbor',
    name: 'Porto',
    description: 'Molo con faro e tetto di guardia sul mare',
    defaultWidthDoc: 112,
    defaultHeightDoc: 112,
    asset: {
      id: 'poi-harbor',
      path: 'assets/poi-harbor.svg',
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
    svgContent: makeProvisionalPoiSvg(
      'Porto',
      `<path d="M18 96 Q40 88 64 96 T110 96" fill="none" stroke="#263C40" stroke-width="4" stroke-linecap="round"/>
       <rect x="24" y="80" width="52" height="12" rx="2" fill="#7B7880" stroke="#263C40" stroke-width="3.5"/>
       <polygon points="48,80 54,34 68,34 74,80" fill="#E8D8AF" stroke="#263C40" stroke-width="4" stroke-linejoin="round"/>
       <polygon points="46,34 61,20 76,34" fill="#8B493D" stroke="#263C40" stroke-width="4" stroke-linejoin="round"/>
       <circle cx="61" cy="48" r="5" fill="#E0BB79" stroke="#263C40" stroke-width="2.5"/>`
    )
  },
  {
    id: 'poi-tower',
    categoryId: 'tower',
    name: 'Torre',
    description: 'Torre di guardia isolata',
    defaultWidthDoc: 96,
    defaultHeightDoc: 96,
    asset: {
      id: 'poi-tower',
      path: 'assets/poi-tower.svg',
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
    svgContent: makeProvisionalPoiSvg(
      'Torre',
      `<ellipse cx="64" cy="102" rx="28" ry="9" fill="#263C40" opacity="0.24"/>
       <polygon points="44,100 50,42 78,42 84,100" fill="#7B7880" stroke="#263C40" stroke-width="4" stroke-linejoin="round"/>
       <rect x="42" y="34" width="44" height="10" rx="2" fill="#E8D8AF" stroke="#263C40" stroke-width="3.5"/>
       <polygon points="42,34 64,16 86,34" fill="#8B493D" stroke="#263C40" stroke-width="4" stroke-linejoin="round"/>
       <rect x="59" y="76" width="10" height="24" rx="5" fill="#263C40"/>`
    )
  },
  {
    id: 'poi-ruin',
    categoryId: 'ruin',
    name: 'Rovina',
    description: 'Archi spezzati e pietre antiche',
    defaultWidthDoc: 102,
    defaultHeightDoc: 102,
    asset: {
      id: 'poi-ruin',
      path: 'assets/poi-ruin.svg',
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
    svgContent: makeProvisionalPoiSvg(
      'Rovina',
      `<ellipse cx="64" cy="98" rx="38" ry="10" fill="#263C40" opacity="0.22"/>
       <rect x="30" y="48" width="16" height="48" fill="#7B7880" stroke="#263C40" stroke-width="4"/>
       <rect x="80" y="60" width="16" height="36" fill="#7B7880" stroke="#263C40" stroke-width="4"/>
       <path d="M30 48 Q56 26 74 44" fill="none" stroke="#263C40" stroke-width="6" stroke-linecap="round"/>
       <rect x="54" y="82" width="18" height="14" rx="2" fill="#7B7880" stroke="#263C40" stroke-width="3.5"/>`
    )
  },
  {
    id: 'poi-citadel',
    categoryId: 'citadel',
    name: 'Cittadella',
    description: 'Fortezza montana con bastioni',
    defaultWidthDoc: 118,
    defaultHeightDoc: 118,
    asset: {
      id: 'poi-citadel',
      path: 'assets/poi-citadel.svg',
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
    svgContent: makeProvisionalPoiSvg(
      'Cittadella',
      `<ellipse cx="64" cy="100" rx="44" ry="11" fill="#263C40" opacity="0.24"/>
       <rect x="24" y="58" width="80" height="38" fill="#7B7880" stroke="#263C40" stroke-width="4"/>
       <rect x="48" y="34" width="32" height="62" fill="#E8D8AF" stroke="#263C40" stroke-width="4"/>
       <polygon points="46,34 64,18 82,34" fill="#8B493D" stroke="#263C40" stroke-width="4" stroke-linejoin="round"/>
       <polygon points="22,58 34,42 46,58" fill="#8B493D" stroke="#263C40" stroke-width="3.5"/>
       <polygon points="82,58 94,42 106,58" fill="#8B493D" stroke="#263C40" stroke-width="3.5"/>`
    )
  },
  {
    id: 'poi-monolith',
    categoryId: 'monolith',
    name: 'Monolite',
    description: 'Pietra runica e santuario antico',
    defaultWidthDoc: 90,
    defaultHeightDoc: 90,
    asset: {
      id: 'poi-monolith',
      path: 'assets/poi-monolith.svg',
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
    svgContent: makeProvisionalPoiSvg(
      'Monolite',
      `<ellipse cx="64" cy="100" rx="28" ry="9" fill="#263C40" opacity="0.24"/>
       <polygon points="48,98 52,32 64,20 76,32 80,98" fill="#7B7880" stroke="#263C40" stroke-width="4" stroke-linejoin="round"/>
       <path d="M64 42 L64 76 M56 52 L72 64" stroke="#E0BB79" stroke-width="3.5" stroke-linecap="round"/>`
    )
  }
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
