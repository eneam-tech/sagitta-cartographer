import { UnzipFileInfo, Zippable, unzipSync, zipSync } from 'fflate';
import { getBuiltinAssetSvgBytes } from '../assets/catalog';
import { decodeMaskPng, encodeMaskPng } from '../core/png';
import {
  DocumentManifest,
  MAX_COVER_CODE,
  MapDocument,
  SCHEMA_VERSION,
  isCoverCode,
  isValidArchivePath,
  safeRandomUUID,
  validateDocumentManifest
} from '../model/document';
import { MapTheme, V1_FLAT_THEME, normalizeTheme } from '../theme/theme';
import {
  assertSupportedSchemaVersion,
  initializeV1TerrainBuffers,
  migrateManifestToV3
} from './migration';
import { ArchiveImportResult } from './types';

export const MAX_ARCHIVE_FILES = 500;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

class ArchiveSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveSecurityError';
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isSafeDirectoryPlaceholder(file: UnzipFileInfo): boolean {
  if (!file.name.endsWith('/') || file.originalSize !== 0 || file.size !== 0) {
    return false;
  }
  const trimmed = file.name.slice(0, -1);
  return trimmed.length > 0 && isValidArchivePath(trimmed);
}

/**
 * Validates theme structural fields (id, mode, 16 required base colors, and any
 * optional geometry/typography blocks) and enriches missing v3 palette entries
 * via `normalizeTheme`.
 */
export function validateMapTheme(raw: unknown): MapTheme {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('File tema non valido: atteso oggetto JSON.');
  }
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id.trim()) {
    throw new Error('Identificativo del tema mancante o non valido.');
  }
  if (
    t.version !== undefined &&
    (typeof t.version !== 'number' || !Number.isInteger(t.version) || t.version < 1)
  ) {
    throw new Error('Versione del tema non valida.');
  }
  if (t.name !== undefined && typeof t.name !== 'string') {
    throw new Error('Nome del tema mancante o non valido.');
  }
  if (t.mode !== 'reactive' && t.mode !== 'flat') {
    throw new Error(`Modalità tema non supportata: ${String(t.mode)}.`);
  }
  if (!t.colors || typeof t.colors !== 'object' || Array.isArray(t.colors)) {
    throw new Error('Tavolozza colori del tema mancante.');
  }
  const requiredColorKeys = [
    'sea',
    'seaShallow',
    'seaBathymetry',
    'beach',
    'land',
    'hill',
    'mountain',
    'mountainCrest',
    'ink',
    'forest',
    'forestShadow',
    'fields',
    'fieldsFurrow',
    'stone',
    'settlement',
    'labelHalo'
  ] as const;
  const colors = t.colors as Record<string, unknown>;
  for (const key of requiredColorKeys) {
    if (typeof colors[key] !== 'string' || !colors[key]) {
      throw new Error(`Colore tema "${key}" mancante o non valido.`);
    }
  }
  const sanitizedColors: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value) {
      throw new Error(`Colore tema "${key}" mancante o non valido.`);
    }
    sanitizedColors[key] = value;
  }

  if (t.coast !== undefined) {
    if (!t.coast || typeof t.coast !== 'object' || Array.isArray(t.coast)) {
      throw new Error('Parametri costa del tema mancanti.');
    }
    const coast = t.coast as Record<string, unknown>;
    if (
      typeof coast.strokeWidthDoc !== 'number' ||
      !Number.isFinite(coast.strokeWidthDoc) ||
      coast.strokeWidthDoc < 0 ||
      typeof coast.bathymetryOffsetDoc !== 'number' ||
      !Number.isFinite(coast.bathymetryOffsetDoc) ||
      coast.bathymetryOffsetDoc < 0
    ) {
      throw new Error('Valori costa del tema non validi.');
    }
  }

  if (t.elevation !== undefined) {
    if (!t.elevation || typeof t.elevation !== 'object' || Array.isArray(t.elevation)) {
      throw new Error('Soglie di elevazione del tema mancanti.');
    }
    const elev = t.elevation as Record<string, unknown>;
    for (const k of [
      'beachMaxHeight',
      'beachMaxCoastDistDoc',
      'plainMaxHeight',
      'hillMaxHeight',
      'mountainMaxHeight',
      'blendWidth'
    ]) {
      if (typeof elev[k] !== 'number' || !Number.isFinite(elev[k])) {
        throw new Error(`Soglia elevazione "${k}" non valida nel tema.`);
      }
    }
  }

  if (t.fonts !== undefined) {
    if (!t.fonts || typeof t.fonts !== 'object' || Array.isArray(t.fonts)) {
      throw new Error('Configurazione font del tema mancante.');
    }
    const fonts = t.fonts as Record<string, unknown>;
    if (
      typeof fonts.defaultFontId !== 'string' ||
      !fonts.presets ||
      typeof fonts.presets !== 'object' ||
      Array.isArray(fonts.presets)
    ) {
      throw new Error('Preset tipografici del tema non validi.');
    }
  }

  if (t.environment !== undefined && t.environment !== 'world' && t.environment !== 'city') {
    throw new Error(`Ambiente tema non supportato: ${String(t.environment)}.`);
  }

  let validatedCity: MapTheme['city'] | undefined;
  if (t.city !== undefined) {
    if (!t.city || typeof t.city !== 'object' || Array.isArray(t.city)) {
      throw new Error('Configurazione palette urbana del tema non valida.');
    }
    validatedCity = t.city as MapTheme['city'];
  }

  return normalizeTheme({
    ...t,
    colors: sanitizedColors,
    ...(validatedCity ? { city: validatedCity } : {})
  });
}

/**
 * Generates LICENSES.txt documenting software, theme, fonts, and all bundled assets.
 */
export function buildLicensesText(doc: MapDocument): string {
  const lines: string[] = [
    'Il tavolo del cartografo — Licenze e attribuzioni dell’archivio',
    '===============================================================',
    `Progetto: ${doc.manifest.title} (${doc.manifest.id})`,
    `Revisione: ${doc.manifest.revision}`,
    '',
    'Tema cartografico:',
    `- id: ${doc.theme.id} · nome: ${doc.theme.name} · versione: ${doc.theme.version} · modalità: ${doc.theme.mode}`,
    '',
    'Font tipografici distribuiti dall’editor:',
    '- Spectral (Production Type / Fontsource) — Licenza SIL Open Font License 1.1 (OFL-1.1)',
    '- Source Sans 3 (Adobe / Paul D. Hunt / Fontsource) — Licenza SIL Open Font License 1.1 (OFL-1.1)'
  ];

  const fontPresetList = Object.values(doc.theme.fonts.presets);
  if (fontPresetList.length > 0) {
    lines.push('Stili tipografici configurati nel tema:');
    for (const preset of fontPresetList) {
      lines.push(`- ${preset.id}: ${preset.label} (${preset.family})`);
    }
  }

  lines.push('');
  lines.push('Risorse grafiche allegate nell’archivio:');
  if (doc.manifest.assets.length === 0) {
    lines.push('- Nessun asset grafico allegato.');
  } else {
    for (const entry of doc.manifest.assets) {
      const attrib = entry.attribution ? ` · Attribuzione: ${entry.attribution}` : '';
      lines.push(
        `- ${entry.id} (${entry.path}, v${entry.version}) — Autore: ${entry.author} · Origine: ${entry.source} · Licenza: ${entry.license}${attrib}`
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

function validateTerrainForArchive(doc: MapDocument): void {
  const { widthPx, heightPx, mask, height, cover } = doc.terrain;
  const expected = widthPx * heightPx;
  if (widthPx !== doc.manifest.terrain.widthPx || heightPx !== doc.manifest.terrain.heightPx) {
    throw new Error('Dimensioni terreno del documento incoerenti con il manifest.');
  }
  if (mask.length !== expected || height.length !== expected || cover.length !== expected) {
    throw new Error('Lunghezza dei raster terreno non coerente con le dimensioni dichiarate.');
  }
  for (let i = 0; i < cover.length; i += 1) {
    if (!isCoverCode(cover[i])) {
      throw new Error(`Codice copertura non valido (${cover[i]}) alla cella ${i}.`);
    }
  }
}

/**
 * Packages a MapDocument and its referenced assets into a portable ZIP archive.
 */
export async function exportProjectArchive(
  doc: MapDocument,
  extraAssets?: Map<string, Blob>
): Promise<Uint8Array> {
  const manifest = validateDocumentManifest(structuredClone(doc.manifest));
  validateTerrainForArchive(doc);

  const maskPng = encodeMaskPng(
    doc.terrain.mask,
    doc.terrain.widthPx,
    doc.terrain.heightPx
  );

  const entries: Zippable = {
    'manifest.json': textEncoder.encode(JSON.stringify(manifest, null, 2)),
    [manifest.terrain.mask]: maskPng,
    [manifest.terrain.height]: new Uint8Array(doc.terrain.height),
    [manifest.terrain.cover]: new Uint8Array(doc.terrain.cover),
    [manifest.theme.file]: textEncoder.encode(JSON.stringify(doc.theme, null, 2)),
    'LICENSES.txt': textEncoder.encode(buildLicensesText(doc))
  };

  for (const asset of manifest.assets) {
    const extraBlob = extraAssets?.get(asset.path) ?? extraAssets?.get(asset.id);
    if (extraBlob) {
      entries[asset.path] = new Uint8Array(await extraBlob.arrayBuffer());
      continue;
    }

    const builtinBytes = getBuiltinAssetSvgBytes(asset.id);
    if (builtinBytes) {
      entries[asset.path] = builtinBytes;
      continue;
    }

    throw new Error(
      `Impossibile esportare l’archivio: file risorsa "${asset.path}" (${asset.id}) mancante.`
    );
  }

  return new Uint8Array(zipSync(entries, { level: 6 }));
}

function parseJsonEntry(bytes: Uint8Array, label: string): unknown {
  try {
    const text = textDecoder.decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new Error(`Il file "${label}" nell’archivio non contiene JSON UTF-8 valido.`);
  }
}

function resolveRawMaskPath(rawManifest: Record<string, unknown>): string {
  const rawTerrain =
    rawManifest.terrain && typeof rawManifest.terrain === 'object'
      ? (rawManifest.terrain as Record<string, unknown>)
      : null;
  const candidate =
    typeof rawTerrain?.mask === 'string'
      ? rawTerrain.mask
      : typeof rawManifest.mask === 'string'
        ? rawManifest.mask
        : 'terrain/land.png';

  if (!isValidArchivePath(candidate)) {
    throw new Error(`Percorso maschera non valido nel manifest: "${candidate}".`);
  }
  return candidate;
}

/**
 * Validates and imports a portable ZIP archive completely in memory before returning.
 * Supports v3 documents and ordered migration of v1 and v2 documents.
 */
export async function importProjectArchive(
  bytes: Uint8Array,
  existingProjectIds: ReadonlySet<string> = new Set()
): Promise<ArchiveImportResult> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22) {
    throw new Error('Archivio ZIP non valido o troncato.');
  }

  let fileCount = 0;
  let declaredTotalBytes = 0;

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.includes('\0')) {
          throw new ArchiveSecurityError(
            `Percorso non sicuro nell’archivio ZIP: "${file.name}".`
          );
        }
        if (isSafeDirectoryPlaceholder(file)) {
          return false;
        }
        if (!isValidArchivePath(file.name)) {
          throw new ArchiveSecurityError(
            `Percorso non valido o path traversal rilevato nell’archivio ZIP: "${file.name}".`
          );
        }
        if (file.compression !== 0 && file.compression !== 8) {
          throw new ArchiveSecurityError(
            `Metodo di compressione ZIP non supportato (${file.compression}) per "${file.name}".`
          );
        }

        fileCount += 1;
        if (fileCount > MAX_ARCHIVE_FILES) {
          throw new ArchiveSecurityError(
            `L’archivio ZIP supera il limite massimo di ${MAX_ARCHIVE_FILES} file.`
          );
        }

        if (!Number.isFinite(file.originalSize) || file.originalSize < 0) {
          throw new ArchiveSecurityError(
            `Dimensione dichiarata non valida per "${file.name}" nell’archivio ZIP.`
          );
        }

        declaredTotalBytes += file.originalSize;
        if (declaredTotalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
          throw new ArchiveSecurityError(
            'L’archivio ZIP supera la dimensione massima decompressa consentita (128 MiB).'
          );
        }

        return true;
      }
    });
  } catch (err) {
    if (err instanceof ArchiveSecurityError) {
      throw new Error(err.message);
    }
    throw new Error('Archivio ZIP corrotto, troncato o non leggibile.');
  }

  let actualTotalBytes = 0;
  for (const content of Object.values(files)) {
    actualTotalBytes += content.byteLength;
    if (actualTotalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new Error(
        'L’archivio ZIP supera la dimensione massima decompressa consentita (128 MiB).'
      );
    }
  }

  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) {
    throw new Error('Archivio non valido: file "manifest.json" mancante.');
  }

  const rawManifestUnknown = parseJsonEntry(manifestBytes, 'manifest.json');
  if (!rawManifestUnknown || typeof rawManifestUnknown !== 'object') {
    throw new Error('Il file "manifest.json" non è un oggetto valido.');
  }
  const rawManifest = rawManifestUnknown as Record<string, unknown>;

  const schemaVersion = assertSupportedSchemaVersion(rawManifest.schemaVersion);
  const wasMigratedFromV1 = schemaVersion === 1;

  const rawMaskPath = resolveRawMaskPath(rawManifest);
  const maskBytes = files[rawMaskPath];
  if (!maskBytes) {
    throw new Error(`File maschera "${rawMaskPath}" mancante nell’archivio.`);
  }
  const decodedMask = decodeMaskPng(maskBytes);

  const manifest: DocumentManifest = migrateManifestToV3(rawManifest, {
    widthPx: decodedMask.width,
    heightPx: decodedMask.height
  });

  if (
    decodedMask.width !== manifest.terrain.widthPx ||
    decodedMask.height !== manifest.terrain.heightPx
  ) {
    throw new Error(
      `Dimensioni della maschera (${decodedMask.width}×${decodedMask.height}) non coerenti con il manifest (${manifest.terrain.widthPx}×${manifest.terrain.heightPx}).`
    );
  }

  const themeBytes = files[manifest.theme.file];
  if (!themeBytes) {
    throw new Error(`File del tema "${manifest.theme.file}" mancante nell’archivio.`);
  }
  const parsedTheme = parseJsonEntry(themeBytes, manifest.theme.file);
  const theme = wasMigratedFromV1
    ? normalizeTheme(V1_FLAT_THEME)
    : validateMapTheme(parsedTheme);

  const expectedCells = manifest.terrain.widthPx * manifest.terrain.heightPx;
  let height: Uint8Array;
  let cover: Uint8Array;

  if (wasMigratedFromV1) {
    const initialized = initializeV1TerrainBuffers(
      decodedMask.mask,
      decodedMask.width,
      decodedMask.height
    );
    height = initialized.height;
    cover = initialized.cover;
  } else {
    const heightBytes = files[manifest.terrain.height];
    if (!heightBytes) {
      throw new Error(
        `File delle quote "${manifest.terrain.height}" mancante nell’archivio.`
      );
    }
    if (heightBytes.length !== expectedCells) {
      throw new Error(
        `Lunghezza non valida per "${manifest.terrain.height}": attesi ${expectedCells} byte, trovati ${heightBytes.length}.`
      );
    }

    const coverBytes = files[manifest.terrain.cover];
    if (!coverBytes) {
      throw new Error(
        `File della copertura "${manifest.terrain.cover}" mancante nell’archivio.`
      );
    }
    if (coverBytes.length !== expectedCells) {
      throw new Error(
        `Lunghezza non valida per "${manifest.terrain.cover}": attesi ${expectedCells} byte, trovati ${coverBytes.length}.`
      );
    }

    for (let i = 0; i < coverBytes.length; i += 1) {
      if (!isCoverCode(coverBytes[i])) {
        throw new Error(
          `Codice copertura non valido (${coverBytes[i]}) in "${manifest.terrain.cover}" alla cella ${i}: ammessi solo 0–${MAX_COVER_CODE}.`
        );
      }
    }

    height = new Uint8Array(heightBytes);
    cover = new Uint8Array(coverBytes);
  }

  const extraAssetBlobs = new Map<string, Blob>();
  for (const entry of manifest.assets) {
    const assetBytes = files[entry.path];
    if (!assetBytes) {
      throw new Error(
        `File risorsa "${entry.path}" (${entry.id}) dichiarato nel manifest ma mancante nell’archivio.`
      );
    }

    const builtinBytes = getBuiltinAssetSvgBytes(entry.id);
    if (!builtinBytes || !bytesEqual(assetBytes, builtinBytes)) {
      const mimeType = entry.mimeType || 'application/octet-stream';
      extraAssetBlobs.set(
        entry.path,
        new Blob([new Uint8Array(assetBytes)], { type: mimeType })
      );
    }
  }

  let wasIdRemapped = false;
  if (existingProjectIds.has(manifest.id)) {
    let candidate = safeRandomUUID();
    while (existingProjectIds.has(candidate)) {
      candidate = safeRandomUUID();
    }
    manifest.id = candidate;
    wasIdRemapped = true;
  }

  // Imported archives start cleanly with schemaVersion 3
  manifest.schemaVersion = SCHEMA_VERSION;

  const document: MapDocument = {
    manifest,
    terrain: {
      widthPx: decodedMask.width,
      heightPx: decodedMask.height,
      mask: decodedMask.mask,
      height,
      cover
    },
    theme,
    terrainVersion: 0
  };

  return {
    document,
    extraAssetBlobs,
    wasMigratedFromV1,
    wasIdRemapped
  };
}
