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

## Funzionalità incluse (v0.2 · Incremento 2)

- **Tela espandibile e ridimensionabile**: formati predefiniti da **A4** fino ad **A1** (`841 × 594 mm`), **Quadrato grande (`500 × 500 mm`)** o misure personalizzate (`50–2000 mm`) sia alla creazione sia dal vivo con **`Tela…` (`Ridimensiona tela`)**, modalità *Espandi / Ritaglia* (ancora 3×3 a 9 punti) o *Scala contenuto* con pieno supporto Annulla / Ripristina.
- **Motore terreno reattivo a 10 materiali**: pennelli Terra / Acqua, **4 strumenti di elevazione** (*Alza*, *Abbassa*, *Appiattisci*, *Ammorbidisci*) con regolazione fine dell’**Intensità** (`5–100%` + preset rapidi) e **10 superfici/materiali dedicati** (*Naturale*, *Foresta*, *Campi*, *Prateria*, *Sabbia*, *Roccia*, *Neve*, *Palude*, *Mattoni*, *Lava*) resi senza giunture sui chunk da `256 × 256 px`.
- **4 temi cartografici**: *Carta di stracci classica*, *Atlante boreale*, *Pergamena d’archivio* e *Terra d’ossidiana*, commutabili istantaneamente dalla barra superiore o alla creazione progetto.
- **Livelli ordinati (`Livelli`)**: gestione di livelli di disegno (*Terreno e Rilievo*, *Fiumi e Strade*, *Luoghi e POI*, *Nomi e Note* e livelli personalizzati `+ Nuovo livello`) con visibilità, blocco, opacità (`0–100%`), riordino ed esclusione automatica dei livelli nascosti dall’esportazione PDF.
- **Tracciati vettoriali (`Fiumi e Strade`)**: disegno a mano libera semplificato (*Fiume* affusolato, *Strada*, *Confine* tratteggiato in unità documento e *Inchiostro libero*) con modifica di spessore, colore, opacità e tracciamento.
- **Libreria ampliata a 31 POI ed etichette**: **31** simboli cartografici originali `CC0-1.0` in 6 categorie con ricerca istantanea, filtri, scala configurabile (`40–250%`), posa **Singola** o pennello **Scatter** (annullabile come passo singolo) ed etichette editabili in Spectral.
- **Persistenza e retrocompatibilità v1/v2 -> v3**: autosalvataggio IndexedDB con rilevamento conflitti ed archivi `.zip` portabili con migrazione automatica di progetti `schemaVersion = 1` e `2` verso `schemaVersion = 3`.
- **Esportazione PDF**: anteprima completa, selettore **150 / 200 / 300 ppi** (con adattamento sicuro `clampPrintDimensions` fino a `32M px` / `8192 px`) in formato fisico esatto senza maniglie né livelli nascosti.
