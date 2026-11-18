# Il tavolo del cartografo — Editor di mappe fantasy

Prima versione utilizzabile dell'editor web per mappe fantasy da tavolo (tipo documento: **mondo**), costruito con React, TypeScript, Konva, IndexedDB, fflate e pdf-lib.

## Documentazione di riferimento

- Specifica tecnica (comportamento, modello dati, persistenza, esportazione, matrice di verifica): [docs/SPECIFICA-EDITOR-MAPPE.md](docs/SPECIFICA-EDITOR-MAPPE.md)
- Documento di design (direzione artistica, token UI, tipografia, componenti, criteri di revisione): [docs/DESIGN-EDITOR-MAPPE.md](docs/DESIGN-EDITOR-MAPPE.md)
- Istruzioni operative per agenti e contratti dei moduli: [AGENTS.md](AGENTS.md)
- Licenze e attribuzioni delle risorse distribuite: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## Requisiti e avvio rapido

- Node.js >= 20 e npm >= 10

```bash
npm install
npm run dev
```

Aprire l'URL mostrato da Vite nel browser desktop (es. `http://localhost:5173`).

## Comandi di verifica

```bash
npm run typecheck   # Controllo tipi TypeScript (tsc --noEmit)
npm run test        # Suite di test automatici Vitest
npm run build       # Verifica tipi + build statica in dist/
npm run preview     # Anteprima locale della build di produzione
```

## Funzionalità incluse (v0.1 · Incremento 1/1b/2/3/4)

- **Tela e formato fisico**: carta vuota con mare uniforme (A4 orizzontale/verticale, A3 orizzontale o misure personalizzate), cornice ottone e segni di registro sul banco blu ardesia.
- **Pennelli del terreno reattivo**: Terra / Acqua, Elevazione (Alza / Abbassa) e Copertura (Foresta / Campi / Naturale) con classificazione contestuale di spiaggia, pianura, collina e montagna, ombreggiatura da nord-ovest e dettagli ancorati alle coordinate documento.
- **Sticker POI ed etichette**: catalogo iniziale originale di simboli cartografici (Insediamento, Porto, Torre, Rovina, Cittadella, Monolite), selezione con maniglie a due toni, trasformazioni (sposta, scala, ruota), ordine dei livelli, elenco oggetti ed etichette editabili in Spectral con supporto agli accenti italiani.
- **Cronologia unificata**: Annulla / Ripristina per pennellate, oggetti ed etichette con budget di memoria per i patch raster.
- **Persistenza locale e portabilità**: autosalvataggio in IndexedDB con rilevamento dei conflitti tra schede, indicazione «Salvataggio…» / «Salvato» / «Errore di salvataggio», esportazione e importazione in archivio `.zip` con migrazione da progetti v1.
- **Esportazione PDF**: anteprima completa e stampa rasterizzata a 300 ppi in formato fisico esatto senza maniglie di selezione né elementi di interfaccia.
