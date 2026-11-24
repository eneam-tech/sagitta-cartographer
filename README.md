# Sagitta - Cartografo — Editor di mappe fantasy

Prima versione utilizzabile dell'editor web e PWA offline per mappe fantasy da tavolo (tipo documento: **mondo**), costruito con React, TypeScript, Konva, IndexedDB, fflate, pdf-lib e segnalazione WebRTC su Cloudflare Durable Objects.

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

## Uso su iPad con Apple Pencil (Wi-Fi locale da Mac)

1. Avvia lo script **`Avvia-Il-Tavolo-del-Cartografo.command`** sul Mac: ricompila automaticamente se necessario, pubblica il server sulla rete Wi-Fi (`--host 0.0.0.0`) e stampa nel Terminale sia l’indirizzo IP locale (`http://<IP-Mac>:5173/`) sia l’indirizzo Bonjour (`http://<Nome-Mac>.local:5173/`).
2. Su **iPad** (sulla stessa rete Wi-Fi), apri uno degli indirizzi mostrati in Safari.
3. Opzionale: tocca **Condividi → «Aggiungi alla schermata Home»** per utilizzare l’editor a schermo intero senza barre di navigazione Safari.

Funzionalità integrate per **iPad e Apple Pencil**:
- **Modalità `Solo penna`** (`Solo Apple Pencil`, accessibile in barra superiore, nel menu `Progetto` e in `Proprietà`): disegna e seleziona solo con la Apple Pencil, mentre **1 dito sposta liberamente la carta**.
- **Rifiuto del palmo (`palm rejection`)**: ignora i tocchi della mano appoggiata sullo schermo mentre la Apple Pencil è attiva.
- **Sensibilità alla pressione Apple Pencil**: modula dinamicamente diametro e intensità dei pennelli di terreno, rilievo e superfici (con campionamento ad alta frequenza `getCoalescedEvents`).
- **Gesti multi-touch**: **pizzico a 2 dita** per zoom e spostamento simultaneo, **tocco a 2 dita** per Annulla e **tocco a 3 dita** per Ripristina.

## PWA Offline, Trasferimento P2P e Deploy Cloudflare (`sagitta-cartographer`)

- **PWA offline completa**: Service Worker (`sw.js`) con precache di app, font e simboli POI, icone PNG (`public/icons/`) e richiesta `navigator.storage.persist()` su iPadOS.
- **Autosalvataggio rapido su iPad**: salva direttamente la maschera grezza `maskU8` in IndexedDB senza ricodifica PNG ad ogni tratto (`400 ms` per oggetti, `2500 ms` per pennellate terreno) con flush automatico al passaggio in background.
- **Invia a `<dispositivo>` (WebRTC P2P)**: in `Progetto → Collega dispositivo…` abbini due dispositivi tramite codice a 6 caratteri o QR leggibile dall’app; le mappe `.zip` viaggiano cifrate end-to-end tra i dispositivi previa conferma esplicita, usando solo un leggero handshake WebSocket sul Durable Object SQLite `PairingRoomDurableObject` ([worker/index.ts](worker/index.ts)).
- **Hardening, honeypot e log dinamici**: `public/_headers` (CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`), `robots.txt`, decoy sintetici (`X-API-KEY.json`, `password.txt`, `secrets-config.json`, [worker/honeypot.ts](worker/honeypot.ts)) e telemetria JSON strutturata (`observability.enabled: true` in `wrangler.jsonc` per `honeypot_hit`, `signal_origin_rejected`, `signal_peer_connected`, `signal_peers_matched`, `signal_rate_limited`, `signal_peer_disconnected`, `signal_room_expired`).
- **Deploy su Cloudflare (Workers Builds da GitHub o locale)**:
  - **Cloudflare Workers Builds**: Build command `npm run build`, Deploy command `npx wrangler deploy` (configurazione in [wrangler.jsonc](wrangler.jsonc)).
  - **Sviluppo locale Worker + Durable Object + Assets**: `npm run build && npm run cf:dev`
  - **Deploy manuale da terminale**: `npm run cf:deploy`
  - **Log live da terminale**: `npm run cf:tail` (oppure dalla dashboard Cloudflare in **Workers & Pages → `sagitta-cartographer` → Observability → Logs**).

## Funzionalità incluse (v0.3 · Incremento 3)

- **Pennelli intelligenti sensibili al contesto (`Intelligente` / `Geometrico`)**: *Terra* e *Acqua* generano coste frastagliate con isolotti satelliti, rilievo naturale verso l’interno e rispetto di scogliere o insenature esistenti (con slider **Frastagliatura costa** `0–100%` e modalità classica *Geometrico*/*Uniforme* sempre selezionabile). Tutte le **10 superfici/materiali** (*Naturale*, *Foresta*, *Campi*, *Prateria*, *Sabbia*, *Roccia*, *Neve*, *Palude*, *Mattoni*, *Lava*) integrano ora il piazzamento geografico intelligente con cursore **Organicità bordo** (`0–100%`): *Foresta* forma radure ed evita spiagge basse e vette estreme; *Campi* si allineano a parcelle agricole su pianure/colline dolci; *Sabbia* livella e spande spiagge costiere e dune al vento; *Palude* scava conche umide in pianura; *Roccia* aderisce a scogliere e pendii; *Neve* segue la quota nivale; *Mattoni* si allinea a isolati urbani; *Lava* solidifica in roccia lavica al contatto col mare. Il ciclo di pennellata usa rendering incrementale per canale, accorpamento rAF e livello statico separato per garantire tracciamento fluido ad alto framerate.
- **Catene montuose a picchi + strumento dedicato `Altopiano`**: *Alza picchi* (`raise`) scolpisce creste e picchi multifrattali senza mai appiattirsi in un tavolato uniforme alla quota massima; il nuovo strumento **Altopiano** (`plateau`) consente invece di modellare tavolati piani con scarpate nette a quota configurabile (`60–245`, con preset *Collina*, *Altopiano*, *Tavolato*), insieme ad *Abbassa*, *Appiattisci* e *Ammorbidisci*.
- **Atlante *Regni del Nord* e Generatore Procedurale (`Genera…`)**: nuovo 5° tema cartografico **`Regni del Nord`** (mare verde-ottanio ad acquerello, terra ambrata antica, ombreggiatura montana marcata, doppie cornici d’atlante, fiumi inchiostrati, strade bordate ed etichette avorio su alone seppia scuro) e modale **`Genera continente`** (accessibile dalla barra superiore e dal menu `Progetto`) con **4 modelli deterministici** (*Regni del Nord*, *Arcipelago di Skellige*, *Valle Continentale*, *Costa e Isole Frastagliate*), seed personalizzabile, cursori mare/montagne/frastagliatura/biomi e **Annulla in 1 passaggio**.
- **Tela espandibile e ridimensionabile**: formati predefiniti da **A4** fino ad **A1** (`841 × 594 mm`), **Quadrato grande (`500 × 500 mm`)** o misure personalizzate (`50–2000 mm`) sia alla creazione sia dal vivo con **`Tela…` (`Ridimensiona tela`)**, modalità *Espandi / Ritaglia* (ancora 3×3 a 9 punti) o *Scala contenuto* con pieno supporto Annulla / Ripristina.
- **Livelli ordinati (`Livelli`) e Tracciati vettoriali (`Fiumi e Strade`)**: livelli riordinabili (*Terreno e Rilievo*, *Fiumi e Strade*, *Luoghi e POI*, *Nomi e Note* e livelli personalizzati `+ Nuovo livello`) con visibilità, blocco, opacità (`0–100%`), tracciati (*Fiume* affusolato, *Strada*, *Confine* tratteggiato, *Inchiostro libero*) con sincronizzazione automatica dei colori al cambio tema.
- **Libreria ampliata a 38 POI ed etichettatura rapida**: **38** simboli cartografici originali `CC0-1.0` (inclusi *Metropoli murata*, *Rocca collinare*, *Drakkar nordico*, *Rosa con cartiglio*, *Banco di nubi*, *Santuario* e *Tana di mostro*) con ricerca istantanea, filtri per 6 categorie, posa **Singola** o **Scatter**, opzione **`Etichetta alla posa`** e pulsante **`Aggiungi etichetta`** nell’ispettore.
- **Persistenza e retrocompatibilità v1/v2 -> v3**: autosalvataggio IndexedDB con rilevamento conflitti ed archivi `.zip` portabili con migrazione automatica di progetti `schemaVersion = 1` e `2` verso `schemaVersion = 3`.
- **Esportazione PDF**: anteprima completa della carta (inclusa eventuale cornice d’atlante), selettore **150 / 200 / 300 ppi** con adattamento sicuro fino a `32M px` / `8192 px`, senza maniglie né livelli nascosti.
- **Modalità Urbana / Città (`Città` vs `Continente`)**: selezionabile in **`Nuova carta`** (ambiente fisso per documento con badge in `Apri locale…`); include **4 stili urbani** (*Borgo medievale organico*, *Città imperiale*, *Città portuale e canali*, *Planimetria a inchiostro antico* in vista piatta incisa), **pennello `Quartiere intelligente`** con 5 tipologie ed **eliminazione edifici**, **`Edificio singolo`** a 6 piante con auto-allineamento alle strade, **`Strade` con aggancio agli incroci**, **`Griglia stradale`** (`Ortogonale | Organica | Radiale` con riempimento opzionale), **`Piazza`** con sgombero automatico e elementi centrali, **`Mura cittadine`** con torri e porte automatiche agli incroci e generatore procedurale **`Genera città`** annullabile in 1 passaggio.
- **Verifica automatica**: 8 suite automatiche Vitest e 8 suite end-to-end Playwright (`e2e/01`–`e2e/08`).
