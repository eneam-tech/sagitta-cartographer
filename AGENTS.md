# AGENTS.md — Guida operativa del repository

## Documenti normativi

1. **[docs/SPECIFICA-EDITOR-MAPPE.md](docs/SPECIFICA-EDITOR-MAPPE.md)** governa **comportamento, coordinate, modello dati, schema del documento, regole del terreno reattivo, persistenza IndexedDB/ZIP, esportazione PDF e criteri di verifica**.
2. **[docs/DESIGN-EDITOR-MAPPE.md](docs/DESIGN-EDITOR-MAPPE.md)** governa **direzione artistica, token UI (`--ui-*`), tipografia (Spectral & Source Sans 3), metrica a 4 px, iconografia, anatomia dell'editor, stati accessibili, lessico italiano e scene di revisione**.
   - **Regola obbligatoria**: ogni agente o sviluppatore che interviene su interfaccia, icone, stili o interazione su canvas deve leggere integralmente `docs/DESIGN-EDITOR-MAPPE.md` prima di scrivere codice.

## Contratti condivisi e proprietà dei moduli

I contratti congelati seguenti definiscono le interfacce comuni e non vanno modificati unilateralmente dai singoli moduli:

- `src/model/coordinates.ts` — unità logiche (`10 u/mm`), conversioni stampa (`mmToPdfPoints`, `mmToPrintPx`, `ptToDocUnits`), mapping maschera/documento, matematica camera (`screenToDoc`, `docToScreen`, `zoomAtPoint`, `fitCameraToViewport`).
- `src/model/document.ts` — schema v2 (`DocumentManifest`, `TerrainBuffers`, `MapObject` unione discriminata `stamp | label`, `createEmptyDocument`, validazione runtime).
- `src/model/commands.ts` e `src/model/history.ts` — confine dei comandi annullabili, `TerrainPatchCommand`, `HistoryManager` con budget di memoria e monotonicità di `revision` / `terrainVersion`.
- `src/theme/theme.ts` — `MapTheme`, `DEFAULT_THEME`, `V1_FLAT_THEME`, soglie di elevazione e preset tipografici.
- `src/core/png.ts` — codifica/decodifica PNG RGBA lossless pure-TS (`encodeMaskPng`, `decodeMaskPng`).
- `src/assets/types.ts` — tipi del catalogo POI e caricamento immagini.
- `src/terrain/types.ts` — interfaccia di `ITerrainStrokeSession` e `ITerrainRenderer`.
- `src/persistence/types.ts` — interfaccia di `IPersistenceService`, stati di salvataggio ed esiti importazione.
- `src/render/objectMetrics.ts` — metriche e disegno condivisi degli oggetti (`resolveLabelFontCss`, `drawMapObjectsToContext`) tra Konva, anteprima e PDF.
- `src/export/types.ts` — interfaccia `PdfExportOptions` e `PdfExportResult`.

### Aree di responsabilità

- **Terreno e rendering**: `src/terrain/` (escluso `types.ts`) e `tests/terrain/`
- **Interfaccia, camera e strumenti**: `src/styles/`, `src/ui/` (esclusi dialoghi/pannelli Wave 2 dedicati), `src/canvas/MapViewport.tsx`, `src/state/editorStore.ts`, `tests/ui/`
- **Persistenza e archivio**: `src/persistence/` (escluso `types.ts`) e `tests/persistence/`
- **POI ed etichette**: `src/objects/`, `src/canvas/ObjectsLayerController.ts`, `src/ui/PoiLibraryPanel.tsx`, `src/ui/ObjectListPanel.tsx`, `src/ui/ObjectInspector.tsx`, `src/ui/InlineLabelEditor.tsx`, `tests/objects/`
- **Composizione condivisa ed export PDF**: `src/render/composeDocument.ts`, `src/export/` (escluso `types.ts`), `src/ui/ExportPdfDialog.tsx`, `tests/export/`
- **Risorse cartografiche e licenze**: `src/assets/svg/`, `src/assets/catalog.ts`, `THIRD_PARTY_NOTICES.md`
- **Integrazione e dipendenze**: `package.json`, `package-lock.json`, `src/App.tsx`, `src/main.tsx`

## Comandi di build, controllo tipi e test

```bash
npm run typecheck
npm run test
npm run build
npm run dev
```

Prima di considerare concluso un incremento, eseguire `npm run typecheck`, `npm run test` e `npm run build`, oltre alle prove interattive nel browser secondo la sezione 11 della specifica e la checklist di revisione del documento di design.
