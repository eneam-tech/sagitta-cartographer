import { AssetManifestEntry } from '../model/document';

export interface PoiCategoryMeta {
  id: 'settlements' | 'fortresses' | 'coasts' | 'ruins' | 'nature' | 'landmarks';
  label: string;
  description: string;
}

export const POI_CATEGORIES: readonly PoiCategoryMeta[] = [
  { id: 'settlements', label: 'Insediamenti', description: 'Villaggi, borghi murati, capitali e porti fluviali' },
  { id: 'fortresses', label: 'Fortezze', description: 'Torri, castelli, cittadelle e avamposti fortificati' },
  { id: 'coasts', label: 'Coste e Porti', description: 'Porti, fari, pontili, relitti e baie' },
  { id: 'ruins', label: 'Rovine e Misteri', description: 'Rovine antiche, monoliti, templi e portali arcani' },
  { id: 'nature', label: 'Natura e Rilievi', description: 'Picchi, vulcani, caverne, cascate e alberi sacri' },
  { id: 'landmarks', label: 'Punti e Riferimenti', description: 'Ponti, miniere, rose dei venti, accampamenti e segnaletica' }
] as const;

export interface PoiCatalogItem {
  id: string;
  categoryId: string;
  categoryLabel: string;
  tags: readonly string[];
  name: string;
  description: string;
  asset: AssetManifestEntry;
  defaultWidthDoc: number;
  defaultHeightDoc: number;
  svgContent: string;
}

export interface LoadedAssetResource {
  entry: AssetManifestEntry;
  image: HTMLImageElement;
  objectUrl?: string;
}

export type LoadedAssetMap = Map<string, LoadedAssetResource>;
