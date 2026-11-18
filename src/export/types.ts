export interface PdfExportOptions {
  ppi?: number;
  filename?: string;
}

export interface PdfExportResult {
  bytes: Uint8Array;
  filename: string;
  pageWidthPt: number;
  pageHeightPt: number;
  rasterWidthPx: number;
  rasterHeightPx: number;
}
