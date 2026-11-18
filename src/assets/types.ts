import { AssetManifestEntry } from '../model/document';

export interface PoiCatalogItem {
  id: string;
  categoryId: string;
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
