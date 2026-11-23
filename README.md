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
npm run typecheck      # Controllo tipi TypeScript (src, tests ed e2e)
npm run test           # Suite di test automatici Vitest
npm run test:e2e       # Suite end-to-end Playwright (e2e/)
npm run test:e2e:ui    # Runner interattivo Playwright UI
npm run test:e2e:headed # Esecuzione E2E con finestra browser visibile
npm run test:all       # Controllo tipi + Vitest + Playwright E2E
npm run build          # Verifica tipi + build statica in dist/
npm run preview        # Anteprima locale della build di produzione
```

> Prima della prima esecuzione E2E su una nuova macchina, installare il browser Playwright con `npx playwright install chromium`.

## Funzionalità incluse (v0.3 · Incremento 3)

- **Pennelli intelligenti sensibili al contesto (`Intelligente` / `Geometrico`)**: *Terra* e *Acqua* generano coste frastagliate con isolotti satelliti, rilievo naturale verso l’interno e rispetto di scogliere o insenature esistenti (con slider **Frastagliatura costa** `0–100%` e modalità classica *Geometrico*/*Uniforme* sempre selezionabile). Tutte le **10 superfici/materiali** (*Naturale*, *Foresta*, *Campi*, *Prateria*, *Sabbia*, *Roccia*, *Neve*, *Palude*, *Mattoni*, *Lava*) si fondono organicamente con i margini costieri e collinari su tutti i temi.
- **Catene montuose a picchi + strumento dedicato `Altopiano`**: *Alza picchi* (`raise`) scolpisce creste e picchi multifrattali senza mai appiattirsi in un tavolato uniforme alla quota massima; il nuovo strumento **Altopiano** (`plateau`) consente invece di modellare tavolati piani con scarpate nette a quota configurabile (`60–245`, con preset *Collina*, *Altopiano*, *Tavolato*), insieme ad *Abbassa*, *Appiattisci* e *Ammorbidisci*.
- **Atlante *Regni del Nord* e Generatore Procedurale (`Genera…`)**: nuovo 5° tema cartografico **`Regni del Nord`** (mare verde-ottanio ad acquerello, terra ambrata antica, ombreggiatura montana marcata, doppie cornici d’atlante, fiumi inchiostrati, strade bordate ed etichette avorio su alone seppia scuro) e modale **`Genera continente`** (accessibile dalla barra superiore e dal menu `Progetto`) con **4 modelli deterministici** (*Regni del Nord*, *Arcipelago di Skellige*, *Valle Continentale*, *Costa e Isole Frastagliate*), seed personalizzabile, cursori mare/montagne/frastagliatura/biomi e **Annulla in 1 passaggio**.
- **Tela espandibile e ridimensionabile**: formati predefiniti da **A4** fino ad **A1** (`841 × 594 mm`), **Quadrato grande (`500 × 500 mm`)** o misure personalizzate (`50–2000 mm`) sia alla creazione sia dal vivo con **`Tela…` (`Ridimensiona tela`)**, modalità *Espandi / Ritaglia* (ancora 3×3 a 9 punti) o *Scala contenuto* con pieno supporto Annulla / Ripristina.
- **Livelli ordinati (`Livelli`) e Tracciati vettoriali (`Fiumi e Strade`)**: livelli riordinabili (*Terreno e Rilievo*, *Fiumi e Strade*, *Luoghi e POI*, *Nomi e Note* e livelli personalizzati `+ Nuovo livello`) con visibilità, blocco, opacità (`0–100%`), tracciati (*Fiume* affusolato, *Strada*, *Confine* tratteggiato, *Inchiostro libero*) con sincronizzazione automatica dei colori al cambio tema.
- **Libreria ampliata a 38 POI ed etichettatura rapida**: **38** simboli cartografici originali `CC0-1.0` (inclusi *Metropoli murata*, *Rocca collinare*, *Drakkar nordico*, *Rosa con cartiglio*, *Banco di nubi*, *Santuario* e *Tana di mostro*) con ricerca istantanea, filtri per 6 categorie, posa **Singola** o **Scatter**, opzione **`Etichetta alla posa`** e pulsante **`Aggiungi etichetta`** nell’ispettore.
- **Persistenza e retrocompatibilità v1/v2 -> v3**: autosalvataggio IndexedDB con rilevamento conflitti ed archivi `.zip` portabili con migrazione automatica di progetti `schemaVersion = 1` e `2` verso `schemaVersion = 3`.
- **Esportazione PDF**: anteprima completa della carta (inclusa eventuale cornice d’atlante), selettore **150 / 200 / 300 ppi** con adattamento sicuro fino a `32M px` / `8192 px`, senza maniglie né livelli nascosti.
- **Verifica automatica**: 77 test unitari/integrazione Vitest + 5 suite end-to-end Playwright (`e2e/01`–`e2e/05`).
