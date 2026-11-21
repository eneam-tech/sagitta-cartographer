# Editor di mappe fantasy · Specifica tecnica

**Revisione 0.2 · 18 novembre 2026 · Stato: specifica iniziale, implementazione da verificare**

Per ogni intervento UI consultare il [documento di design](DESIGN-EDITOR-MAPPE.md), che definisce direzione artistica, token, componenti e criteri di revisione.

## 1. Mandato e lettura del documento

Il master apre una tela vuota, dipinge la geografia di un mondo, colloca elementi illustrati, assegna nomi ai luoghi e stampa una carta da usare al tavolo. Ogni carta ha un proprio documento. Inkarnate è il riferimento per l’interazione diretta con pennelli e simboli. L’identità visiva maturerà durante lo sviluppo.

| Stato | Decisioni | Come deve usarle chi implementa |
|---|---|---|
| Concordato | Creazione manuale da tela vuota. Primo tipo di mappa: mondo. Elevazione e coperture dipinte con resa contestuale. POI come sticker indipendenti. Mappe indipendenti. Esportazione PDF. Stack web open source. Stile da sviluppare nel tempo. | Sono i vincoli del prodotto. Un loro cambiamento richiede una decisione del titolare. |
| Baseline proposta | Browser desktop, mouse e trackpad, salvataggio locale, progetto portabile, carta A4 a 300 ppi. React, TypeScript, Vite, Konva, IndexedDB e pdf-lib. | Sono impostazioni di partenza sufficienti a realizzare e valutare il prototipo. Documentare le variazioni che incidono sui progetti salvati o sull’esperienza dell’utente. |
| Da validare | Qualità del pennello, densità di simboli sostenibile, risoluzione massima, dispositivi prioritari, libreria artistica e formati di stampa successivi. | Eseguire le prove indicate nella sezione 11. Riportare condizioni e risultati effettivi. |
| Evoluzione | Città e dungeon come ulteriori tipi di documento indipendenti. | Riutilizzare selezione, cronologia, persistenza ed export quando serviranno. Evitare di anticipare oggi un sistema di navigazione tra mappe. |

**Scenario di accettazione.** Creo un arcipelago su una carta vuota. Unisco due isole, apro uno stretto, annullo e ripristino il gesto. Alzo una dorsale, dipingo una foresta dal piano al versante e apro una radura con Campi. Applico lo sticker di una città e le assegno un nome. Chiudo, riapro, correggo il nome ed esporto la carta intera mentre sullo schermo sto guardando un dettaglio. Il PDF deve essere utilizzabile anche da chi non possiede l’editor.

## 2. Perimetro delle consegne

**Prima versione utilizzabile.** Nuovo progetto, titolo, pagina vuota con sfondo mare, pennelli terra e acqua con diametro regolabile, zoom e spostamento della vista, elevazione modificabile, coperture Foresta e Campi e libreria di sticker POI (insediamento, rovina, torre), inserimento e modifica del testo, selezione, spostamento, scala e rotazione dei simboli, eliminazione, ordine degli oggetti, annulla e ripristina. Completano il percorso il salvataggio automatico, la riapertura locale, l’importazione e l’esportazione del progetto e il PDF. Le dimensioni della carta si scelgono alla creazione.

**Secondo incremento mondo.** Fiumi e strade a tracciato modificabile, pennello per distribuire più simboli e ulteriori temi. La sezione 5 descrive come estendere il documento. Il completamento del primo incremento si misura sullo scenario di accettazione anche con una libreria artistica minima.

**Sviluppi con requisiti propri.** Una città introduce edifici, isolati e mura. Un dungeon introduce griglia, scala fisica di gioco, aggancio delle porte ai muri e potenzialmente stampa su più fogli. Il loro dettaglio funzionale dovrà essere definito prima di svilupparli. Account, sincronizzazione cloud, multiplayer, generazione procedurale di mondi e atlante navigabile sono esterni al mandato attuale.

## 3. Architettura e strumenti

| Componente | Responsabilità | Decisione tecnica |
|---|---|---|
| Interfaccia | Barre strumenti, proprietà, libreria, moduli, dialoghi e indicatori di stato | React e TypeScript. Input testuali, pulsanti e dialoghi in HTML per usare focus, tastiera e selezione del testo nativi. |
| Documento | Geometria, oggetti, riferimenti artistici, versione del formato e operazioni di modifica | Modello TypeScript indipendente dal renderer. Usare una validazione a runtime per i dati che arrivano da file o storage. |
| Vista e interazione | Camera, selezione, gestione puntatore, anteprima del gesto, visualizzazione e hit test | Konva su Canvas 2D. react-konva è un’integrazione facoltativa. Un solo proprietario per ciascuna proprietà di un nodo durante il trascinamento. |
| Terreno | Superficie raster editabile, composizione del pennello e produzione dell’immagine da visualizzare | Canvas 2D fuori schermo, aggiornamento dell’area modificata. La prima implementazione può tenere una superficie intera in memoria. |
| Persistenza | Revisioni locali, risorse binarie, importazione e migrazioni | IndexedDB, transazioni e Blob. Archivio ZIP per il formato portabile proposto. |
| Stampa | Composizione dell’intero documento alle dimensioni richieste e creazione della pagina | Superficie di rendering dedicata e pdf-lib. |
| Build e distribuzione | Sviluppo locale, controllo tipi e produzione dei file pubblicabili | Vite. Hosting statico con risorse della versione distribuita. Nessun servizio remoto richiesto per elaborare la mappa. |

**Flusso delle modifiche.** Interfaccia → intento dell’utente → anteprima del gesto → comando concluso → documento e cronologia → aggiornamento vista e richiesta di salvataggio. Export e archivio leggono una revisione coerente del documento. Posizione del cursore, selezione, maniglie e camera appartengono alla sessione. Questa separazione consente di riaprire un progetto anche con un renderer diverso. Konva documenta sia il salvataggio dello stato applicativo sia il ridisegno selettivo dei livelli. [Stato applicativo](https://konvajs.org/docs/data_and_serialization/Best_Practices.html) · [Prestazioni](https://konvajs.org/docs/performance/All_Performance_Tips.html)

**Perché questa scelta.** La prima versione richiede molte interazioni da editor e una stampa fedele. Konva fornisce un modello di oggetti e trasformazioni, mentre le API web coprono file e storage. Valutare PixiJS se le misure attribuiscono il costo dominante al disegno di molti simboli. Unity tornerebbe in discussione per un cambiamento come rilievi tridimensionali e illuminazione interattiva. Il solo aumento delle dimensioni di un PDF richiede anzitutto una verifica di memoria e risoluzione.

## 4. Spazi di coordinate e strumenti

Il documento usa coordinate logiche con origine nell’angolo superiore sinistro, X verso destra e Y verso il basso. Per A4 orizzontale si propone una superficie logica 2970 × 2100, equivalente a dieci unità per millimetro sulla stampa di riferimento. Il formato verticale scambia le dimensioni. La risoluzione della maschera è un parametro distinto, memorizzato in pixel interi. Per A4 orizzontale la baseline è 3508 × 2480 pixel. La conversione sulla maschera usa i rapporti effettivi fra le due coppie di dimensioni.

La camera trasforma le coordinate documento in coordinate CSS della vista. Sottrarre l’origine del contenitore al puntatore e applicare la trasformazione inversa **una sola volta**. La densità pixel dello schermo interessa il backing canvas. Lo zoom sul cursore deve lasciare fermo lo stesso punto geografico. Durante il pan cambia la camera, durante il drag di un simbolo cambiano le sue coordinate. La dimensione del pennello è espressa in unità documento e il suo indicatore a schermo segue lo zoom.

| Gesto | Risultato e caso limite |
|---|---|
| Pressione, movimento, rilascio con pennello attivo | Traccia continua anche con eventi distanti. Un clic fermo produce un punto. Catturare il puntatore e limitare il disegno al rettangolo della carta. |
| Interruzione del puntatore o Esc durante il gesto | Scartare la sola anteprima in corso e ripristinare lo stato precedente. Rilasciare la cattura anche quando il rilascio avviene fuori dalla tela. |
| Clic su simboli sovrapposti con selezione attiva | Selezionare l’oggetto visibile più in alto. Consentire di raggiungere gli altri tramite l’elenco degli oggetti o il cambio di ordine. |
| Modifica di un nome | Usare un campo HTML. Confermare registra un’operazione, annullare conserva il testo iniziale. Scorciatoie distruttive della tela inattive mentre si digita. |
| Zoom e pan | Rotella o gesto trackpad per zoom, strumento mano o spazio e trascinamento per pan. Fornire anche pulsanti zoom e adatta alla finestra. |

Rendere riconoscibili lo strumento attivo e il focus. Dare un nome accessibile ai comandi a icona e consentire la modifica dei valori numerici dal pannello proprietà. La vista ad alta densità e il ridimensionamento della finestra non devono spostare il contenuto del documento.

## 5. Contratto del documento e delle risorse

L’esempio seguente è il manifest minimo proposto per un progetto vuoto. I file indicati devono esistere nell’archivio corrispondente. Il valore di revisione cresce dopo ciascuna modifica confermata, compresi annulla e ripristina. La versione dello schema cambia quando cambia il contratto del file.

```json
{
  "schemaVersion": 2,
  "id": "9c42105f-ff0c-4401-9062-000000000001",
  "revision": 0,
  "kind": "world",
  "title": "Arcipelago",
  "page": { "widthMm": 297, "heightMm": 210 },
  "space": { "width": 2970, "height": 2100 },
  "terrain": { "mask": "terrain/land.png", "height": "terrain/height.u8", "cover": "terrain/cover.u8", "rulesVersion": 1, "seed": 173, "widthPx": 3508, "heightPx": 2480 },
  "theme": { "id": "base", "version": 1, "file": "theme/theme.json" },
  "assets": [],
  "objects": []
}
```

**Maschera.** Il canale alpha del PNG rappresenta la copertura della terra. Zero indica acqua, 255 terra, i valori intermedi preservano l’antialiasing. L’RGB è convenzionalmente bianco. Sfondo, colore della terra e contorno sono derivati dalla maschera e dal tema. Il formato PNG è senza perdita. Una carta vuota ha una maschera trasparente della dimensione dichiarata.

**Quota e copertura.** I file height.u8 e cover.u8 contengono un byte per cella, per righe da sinistra a destra e dall’alto in basso, alle stesse dimensioni della maschera. Validare la lunghezza esatta di entrambi. La quota relativa va da 0 a 255. La copertura ammette 0 naturale, 1 foresta, 2 campi. Una carta vuota ha entrambi i raster a zero. La maschera definisce il confine terra/acqua anche a quota zero. Il seed è un intero senza segno a 32 bit che stabilizza le varianti illustrative. rulesVersion identifica le regole di classificazione e disposizione. Conservare i dati dipinti, il tema e le risorse che consentono di rigenerare la vista.

**Lettura di progetti v1.** Conservare maschera, oggetti, trasformazioni e ordine. Inizializzare la terra preesistente a quota di pianura (64), il mare a zero e la copertura a naturale. Associare un seed stabile e mantenere il tema precedente con resa piatta finché l’autore sceglie il tema reattivo. I vecchi timbri montagna o albero restano oggetti decorativi. Per i nuovi POI la variante stamp include role uguale a poi e un categoryId del catalogo. I timbri importati senza ruolo assumono il ruolo decorativo.

**Oggetti.** Usare un’unione discriminata tramite il campo type. Ogni oggetto ha un identificativo stabile e univoco. Nell’incremento iniziale l’array objects definisce l’ordine di disegno dal basso verso l’alto sopra il terreno. La selezione di un oggetto conserva l’identificativo anche se cambia l’ordine.

| Tipo | Dati persistenti | Convenzioni |
|---|---|---|
| stamp | id, type, assetId, x, y, width, height, rotationDeg | Origine al centro del simbolo, dimensioni positive in unità documento, rotazione oraria. L’inserimento copia il rapporto d’aspetto originale. |
| label | id, type, text, x, y, fontId, fontSize, color, rotationDeg | Origine in alto a sinistra del riquadro testo, dimensioni del font in unità documento. Prima versione a riga singola, centratura e multilinea richiedono campi dedicati. |
| path, incremento successivo | id, type, punti di controllo, stile, larghezza e algoritmo di interpolazione versionato | Disegno di fiumi e strade. Introdurre il tipo insieme a validazione, salvataggio, export e migrazione del formato. |

**Risorse e tema.** Il manifest delle risorse associa ciascun id a un percorso interno, un tipo di contenuto, una versione e le informazioni di licenza applicabili. Il tema definisce colori e stili di terreno, risorse predefinite e font. Allegare all’archivio le risorse effettivamente necessarie alla riapertura, inclusi i font distribuibili. Una revisione del tema usata da una carta salvata resta identificabile. L’applicazione di un nuovo tema a una vecchia carta è una modifica esplicita. Cambiare tema preserva forma della costa, coordinate, dimensioni e ordine degli elementi.

**Invarianti.** Dimensioni positive e finite, identificativi univoci, percorsi relativi all’archivio, riferimenti risolvibili, tipo e dimensioni reali della maschera coerenti con il manifest. Rifiutare valori numerici fuori dai limiti supportati. Il bordo della pagina ritaglia gli oggetti che lo attraversano. Anteprima, salvataggio e stampa condividono tali convenzioni.

## 6. Rendering del terreno e cronologia

### Terreno reattivo nella prima versione mondo

La modifica è locale e prevedibile. Lo stesso tratto Foresta produce chiome fitte in pianura e gruppi più radi su un pendio. Alzando quel pendio, il rilievo e la foresta già dipinta si aggiornano insieme. Le seguenti soglie e rese sono la baseline da provare con la carta campione.

| Strumento | Dato modificato | Effetto |
|---|---|---|
| Terra / Acqua | Maschera della terra | Terra appena emersa parte a quota 0 e copertura naturale. La terra già presente conserva i valori. Dove la copertura di terra raggiunge zero, azzerare quota e copertura nello stesso comando. |
| Elevazione · Alza / Abbassa | Quota sulla sola terra | Diametro e intensità regolabili. Applicare incrementi con caduta morbida dal centro al bordo e saturazione a 0 e 255. Interpolare a distanza regolare in unità mappa per rendere l’effetto indipendente dalla frequenza degli eventi. Passaggi successivi sul medesimo luogo accumulano l’effetto. |
| Copertura · Foresta / Campi / Naturale | Tipo di copertura sulla sola terra | L’ultima copertura dipinta sostituisce la precedente. Naturale rimuove la copertura mantenendo quota e costa. Un tratto sul solo mare lascia invariata la revisione. |
| POI | Oggetto stamp con ruolo poi | Ogni clic colloca una singola illustrazione con id stabile, selezionabile, spostabile, scalabile, ruotabile ed eliminabile. Si può collocare un faro a cavallo della costa. I pennelli modificano il terreno sottostante conservando lo sticker e il suo ordine. |

**Classificazione proposta.** Su terra, una cella a quota 0–31 entro 12 unità documento dall’acqua è spiaggia. La stessa quota nell’entroterra è pianura. La pianura si estende fino a 111, le colline da 112 a 191 e le montagne da 192 a 255. Ai bordi del foglio considerare come acqua solo quella descritta dalla maschera. I limiti classificano i campioni per le prove. Sfumare colori e tratteggio nelle vicinanze delle soglie. Calcolare l’ombreggiatura dal gradiente locale di quota con luce da nord-ovest. Un rilievo alto sulla costa può formare una scogliera.

**Composizione.** Disegnare mare, terra con rilievo, copertura ritagliata sulla terra, poi oggetti nell’ordine salvato. Su pianura la foresta mostra chiome accostate e i campi parcelle a solchi. Su collina diradare le chiome e orientare i solchi lungo le curve di livello. In montagna diradare ulteriormente la vegetazione, lasciando le creste leggibili, e rendere i campi come terrazzamenti discontinui. Sulla spiaggia rendere rada la copertura e mantenere visibile la battigia. L’ultima copertura scelta rimane memorizzata anche quando il tema la rende attenuata. Il tema fornisce colori, motivi e illustrazioni. Il renderer fissa i dettagli a coordinate documento usando seed e coordinate della cella di distribuzione. Pan, zoom, undo e stampa devono ritrovare gli stessi alberi e solchi.

**Ridisegno locale.** Invalidare l’area del gesto più il massimo raggio di influenza di costa, sfumatura, ombreggiatura e motivi illustrati. Ricalcolare anche le tessere adiacenti coinvolte, ritagliando alla pagina. Conservare insieme nel comando le differenze di tutti i raster interessati. Vista ed export usano lo stesso classificatore e la stessa disposizione dei dettagli. Le cache illustrate si possono rigenerare.

### Ciclo di modifica

1. All’inizio della pennellata registrare lo strumento, i suoi parametri e il raggio. Creare una modifica provvisoria. Conservare la regione originale prima di alterarne i pixel.
2. Interpolare il movimento in coordinate documento e comporre una traccia continua a estremità arrotondate. Il pennello terra aggiunge copertura e il pennello acqua la sottrae. Un gesto che torna sui propri passi deve mantenere il comportamento previsto per l’opacità del pennello.
3. Durante la modifica aggiornare il rettangolo interessato, allargato del raggio del pennello e dello spessore del bordo costiero. Il bordo deve seguire anche laghi, isole interne e stretti. Una prima resa con sola differenza cromatica è sufficiente per provare la geometria.
4. Al rilascio conservare i pixel precedenti e successivi della zona modificata oppure tessere equivalenti. Un trascinamento, una trasformazione o una rinomina producono analogamente un solo comando. Saltare i comandi che non cambiano il documento.
5. Dopo annulla, una nuova modifica elimina il ramo di ripristino. Applicare un budget di memoria alla cronologia raster, eliminando per primi i comandi più vecchi. Il documento corrente resta completo. L’incremento iniziale conserva la cronologia per la sessione aperta.

Una superficie RGBA da 3508 × 2480 occupa circa 33 MiB prima di copie, texture e codifica. Duplicare tutta la superficie per ogni gesto consuma rapidamente memoria. Accorpare le aree modificate, ridisegnare al massimo una volta per frame e misurare il costo della codifica PNG separatamente da quello del pennello. Introdurre tessere, cache o worker dove la profilazione evidenzia un vantaggio. I livelli Konva suggeriti sono terreno, oggetti e sovrapposizioni di interazione. L’ultimo ospita cursore e maniglie ed è escluso dall’export.

## 7. Persistenza, file e recupero

**Salvataggio locale.** Usare una tabella progetti per id e ultima revisione, una per i dati binari e una per le risorse condivise, se necessaria. Dopo un comando concluso accorpare i salvataggi ravvicinati. Catturare dati e revisione insieme, preparare maschera, quota e copertura della stessa revisione fuori dalla transazione e scrivere dati e riferimenti nella stessa transazione IndexedDB. È possibile riusare una maschera già salvata quando cambia soltanto un’etichetta. [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

**Concorrenza.** Serializzare le scritture per progetto. Se durante il salvataggio della revisione 8 si passa alla 9, completare la 8 e accodare la 9. Mostrare «Salvato» solo dopo il completamento della transazione che corrisponde alla revisione corrente. Tra schede diverse, confrontare nella transazione la revisione persistita con l’ultima letta. In caso di conflitto conservare entrambe le modifiche offrendo il salvataggio come copia. Un contatore locale da solo non distingue due scritture concorrenti sulla stessa base.

**Interruzioni.** Alla riapertura caricare l’ultima transazione completa. Una chiusura improvvisa può perdere il gesto in corso o una revisione ancora in coda. Rendere visibili «Salvataggio…», «Salvato» ed «Errore di salvataggio». Su errore di quota o storage indisponibile mantenere il progetto in memoria, segnalare il problema e consentire subito il download della copia portabile. Evitare promesse di persistenza basate sul solo evento di chiusura della pagina.

**Archivio portabile.** Usare uno ZIP contenente manifest.json, terrain/land.png, terrain/height.u8, terrain/cover.u8, theme/theme.json e le risorse referenziate sotto assets/. Registrare licenze e attribuzioni dovute. Il manifest descrive il contenuto anche se il nome del file scaricato cambia. Validare versione, inventario, riferimenti, numero di elementi e dimensioni decompresse prima di sostituire il progetto visibile. Determinare i limiti numerici iniziali con le prove di memoria. Decodificare solo formati esplicitamente gestiti dalla versione. Il testo delle etichette è contenuto testuale.

**Importazione e compatibilità.** Preparare il documento importato in uno stato temporaneo. Una risorsa assente, un file troncato o una versione successiva sconosciuta producono un messaggio specifico e lasciano aperto il progetto precedente. In caso di id locale già presente importare una copia con nuovo id. Per una versione precedente supportata applicare migrazioni ordinate su una copia e validare il risultato. Conservare un archivio rappresentativo per ogni versione pubblicata da verificare nelle future modifiche al formato.

## 8. Esportazione in PDF

La pagina ha dimensioni fisiche esplicite. Convertire i millimetri in punti PDF con mm × 72 / 25,4. Convertire le dimensioni di stampa in pixel con arrotondamento di mm × ppi / 25,4. Per A4 orizzontale a 300 ppi il risultato è 3508 × 2480 px. La risoluzione delle illustrazioni e della maschera limita il dettaglio effettivo recuperabile. [Export Konva](https://konvajs.org/docs/data_and_serialization/High-Quality-Export.html)

1. Catturare l’ultima revisione confermata. Attendere il completamento del gesto corrente o richiederne la conclusione prima di avviare l’export.
2. Caricare le immagini e attendere i font specificati dal documento. In caso di risorsa mancante indicare quale impedisce la resa fedele.
3. Disegnare l’intero documento in una superficie separata, con origine della mappa nell’angolo della pagina, scala di stampa e ritaglio ai bordi. Riutilizzare la stessa composizione di terreno e oggetti della vista normale. Escludere camera di lavoro, selezione e sovrapposizioni.
4. Incorporare il risultato in una pagina PDF delle dimensioni scelte, con scala uniforme e senza margini interni nella baseline. Lo stampatore può applicare margini fisici propri. Usare un nome scaricabile derivato dal titolo con estensione .pdf.
5. Rilasciare le superfici temporanee anche in caso di errore e mostrare l’esito. La prima versione produce una pagina rasterizzata. Se verrà richiesto testo selezionabile, disegnare le etichette nel PDF con font incorporati e verificare baseline, rotazione e conversione dell’asse Y. [pdf-lib](https://pdf-lib.js.org/)

**Verifica.** Controllare dimensioni e numero di pagine con un lettore PDF indipendente. Confrontare vista completa ed export su una carta con accenti, testo ruotato, simboli sovrapposti e un’isola sul bordo. Ripetere con zoom alto, finestra ridimensionata e densità schermo diversa. Vietare qualsiasi dipendenza della dimensione di stampa da quella della finestra.

## 9. Risorse grafiche e licenze

Le dipendenze dirette selezionate dichiarano licenze permissive. TypeScript usa Apache 2.0. React, Vite, Konva, react-konva e pdf-lib usano MIT per i rispettivi progetti principali. Al momento della scelta delle versioni, fissarle nel progetto con lockfile e conservare gli avvisi applicabili alle componenti effettivamente distribuite, comprese le dipendenze incorporate. La scelta della licenza dell’app rimane al titolare. [TypeScript](https://github.com/microsoft/TypeScript) · [React](https://github.com/react/react) · [Vite](https://github.com/vitejs/vite) · [Konva](https://github.com/konvajs/konva) · [react-konva](https://github.com/konvajs/react-konva) · [pdf-lib](https://github.com/Hopding/pdf-lib)

Per ciascun simbolo, texture e font registrare id, autore, origine, versione, licenza e attribuzione richiesta. Verificare i diritti per la distribuzione nell’editor, l’inclusione nel progetto scaricabile e l’uso nelle mappe esportate. La prima libreria può usare forme originali semplici o risorse CC0. Inkarnate orienta il comportamento degli strumenti. Le illustrazioni della libreria devono avere una provenienza propria. [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.it)

## 10. Sequenza di implementazione

| Passo | Risultato utilizzabile | Prova per procedere |
|---|---|---|
| 1 · Documento e tela | Documento vuoto, formato fisico, camera, pennello terra/acqua e cronologia | Disegnare due isole, unirle e separarle a più livelli di zoom. Annulla e ripristina ricostruiscono la stessa maschera. |
| 1b · Terreno reattivo | Alza, Abbassa, Foresta, Campi e Naturale con resa contestuale | Percorrere tutte le fasce su una costa, dipingere e poi modificare di nuovo il rilievo. |
| 2 · Risorse e oggetti | Sticker POI, etichette, trasformazioni, pannello proprietà e ordine di disegno | Modificare e sovrapporre oggetti. Verificare selezione del più alto, testo accentato e ripristino delle trasformazioni. |
| 3 · Persistenza | Autosave con stato visibile, riapertura, archiviazione e importazione | Aprire l’archivio in un profilo browser pulito e riprendere il disegno. Simulare scritture fallite e due schede sullo stesso progetto. |
| 4 · Stampa e prova al tavolo | PDF A4 completo, gestione dei fallimenti, misure di fluidità e memoria | Eseguire lo scenario della sezione 1 e la matrice della sezione 11. Verificare almeno una stampa fisica quando disponibile. |
| 5 · Strumenti aggiuntivi | Fiumi e strade, distribuzione di simboli e revisione artistica | Mantenere apribili gli archivi della prima versione e confrontare la resa delle carte preesistenti. |

## 11. Verifica e criteri di qualità

| Area | Prova riproducibile | Esito atteso |
|---|---|---|
| Elevazione | Preparare strisce a quota 16, 64, 144 e 224 dalla riva verso l’interno e una quinta a quota 16 lontana dal mare | Spiaggia, pianura, colline, montagne e pianura interna. Abbassa riattraversa le soglie. |
| Coperture | Tracciare Foresta attraverso mare, piano e collina. Sovrascrivere metà con Campi, poi alzare il terreno | Mare intatto, coperture leggibili e adattate al nuovo rilievo. Naturale lascia intatta la quota. |
| Interazione con POI | Applicare una torre sul versante, scavare un lago sotto di essa, annullare, salvare e riaprire | Identici id, posizione e ordine dello sticker. Annulla ripristina tutti e tre i raster. In PDF torre, radura e chiome mantengono la disposizione mostrata dall’editor. |
| Coordinate | Applicare pan e zoom, modificare il terreno sotto il cursore, rigenerare la vista ad altra densità pixel | Stesso punto documento entro un pixel della maschera per gli arrotondamenti. |
| Pennello | Clic fermo, movimento rapido, incrocio di due pennellate, apertura di un lago e passaggio sul bordo carta | Continuità del tratto, lago attraversabile col pennello terra, nessun segno oltre la pagina. |
| Cronologia | Aggiungere terra, scavare acqua, rinominare un oggetto. Annullare tre volte, ripristinare tre volte | Uguaglianza della maschera decodificata e dei dati degli oggetti agli estremi. Ripetere con un gesto interrotto. |
| Portabilità | Salvare, ricaricare e confrontare dati e maschera. Importare con stesso id e con archivio incompleto | Carta intatta dopo il ciclo completo. Copia indipendente in caso di collisione. Errore circostanziato per archivio incompleto. |
| Scritture | Rallentare la codifica PNG, modificare un’etichetta durante il salvataggio e riaprire dopo «Salvato» | L’ultima modifica è presente. Un errore di quota mantiene disponibile la copia scaricabile. |
| Stampa | Esportare da viste molto diverse la stessa revisione | Stessa pagina fisica e stessa composizione dopo rasterizzazione dei PDF. Confrontare le immagini di pagina perché i metadati PDF possono variare. |
| Compatibilità | Eseguire il percorso principale almeno su Chromium e Safari desktop, registrando versioni e sistema operativo | Disegno, input testo, storage, importazione e download completano il percorso. Estendere la matrice in base ai dispositivi scelti. |
| Prestazioni | Distribuire 2.000 simboli, disegnare per 10 secondi con zoom normale e ingrandito, quindi esportare A4 | Rilevare tempi frame mediano e p95, durata export e picco di memoria quando misurabile. Obiettivo iniziale proposto p95 entro 33 ms durante il gesto sul dispositivo di riferimento. |

Registrare computer, browser, risoluzione, densità schermo, numero di oggetti e dimensioni delle illustrazioni. Usare una carta di prova con posizioni ripetibili. I 2.000 simboli e la soglia di fluidità sono obiettivi sperimentali. Il presente documento non contiene benchmark eseguiti. Per l’uso reale verificare anche la leggibilità dei nomi e la continuità delle coste sulla stampa.

## 12. Indicazioni operative per gli agenti AI

- All’inizio individuare l’incremento richiesto e leggere le istruzioni del repository effettivo. Questa specifica descrive il comportamento atteso. Nomi di cartelle, comandi di build e versioni esatte dei pacchetti saranno stabiliti con l’inizializzazione del progetto.
- Per ogni nuovo strumento definire l’unità di misura, il dato persistente modificato, il confine dell’operazione di annullamento e il risultato atteso nel PDF. Far passare anche le scorciatoie dallo stesso percorso di modifica dell’interfaccia.
- Tenere separati i dati salvati, lo stato transitorio della vista e le risorse grafiche derivate. Per cambiamenti al formato includere lettura dei documenti precedenti, migrazione verificabile ed eventuale aggiornamento degli esempi in questa specifica.
- Per difetti di visualizzazione ricostruire il problema a partire dal documento e dalle trasformazioni della camera. Per perdite di dati identificare revisione, transazione e stato mostrato all’utente. Per problemi di fluidità misurare prima disegno, hit test e codifica separatamente.
- Prima di dichiarare completo un incremento, eseguirne il percorso attraverso l’interfaccia normale. Riportare le prove effettivamente svolte, i risultati, gli eventuali limiti e le decisioni ancora aperte. Conservare le modifiche dell’utente durante interventi successivi.
- Aggiornare questo riferimento quando una decisione cambia il comportamento visibile, la compatibilità dei file o il perimetro. Annotare data, ragione, conseguenze per i documenti esistenti e verifica che ha motivato la decisione.

**Decisioni aperte per la prima prova con il titolare.** Confermare il computer e il browser di riferimento, valutare A4 con una stampa reale, provare la risposta del pennello e scegliere quanto deve essere irregolare il bordo costiero. La selezione del primo tema illustrato può avvenire sulla stessa carta campione dopo la validazione degli strumenti.

---

### Aggiornamento Incremento 2 (`schemaVersion = 3`, `rulesVersion = 2` — 21 novembre 2026)

- **Ragione e perimetro:** completato l’Incremento 2 con estensione del formato fisico (`50–2000 mm`, preset A4–A1 e Quadrato `500×500 mm`) e comando annullabile `ResizeCanvasCommand` (`expand-crop` ad ancora 3×3 / `scale-content`), **10 codici copertura (`0..9`: Naturale, Foresta, Campi, Sabbia, Mattoni, Neve, Palude, Roccia, Prateria, Lava)** resi in modo deterministico sui chunk da `256 px`, **4 strumenti elevazione (`Alza`, `Abbassa`, `Appiattisci`, `Ammorbidisci`)**, **4 temi cartografici built-in** (`base`, `nordica`, `pergamena`, `vulcanica`), **livelli (`MapLayer` con visibilità, blocco, opacità e riordino)** onorati su tela, anteprima ed esportazione PDF, **tracciati vettoriali `PathObject`** (`river`, `road`, `border`, `freehand`), **31 POI originali `CC0-1.0`** con ricerca/filtri/scala/pennello scatter (`AddObjectsBatchCommand`), e selettore PDF `150 / 200 / 300 ppi` protetto da `clampPrintDimensions`.
- **Compatibilità e migrazione:** i salvataggi e gli archivi `.zip` `v1` e `v2` restano integralmente importabili tramite `migrateManifestToV3` + `normalizeTheme` (i progetti `v1` preservano `V1_FLAT_THEME`, i progetti `v2` ricevono livelli predefiniti, `layerId` sugli oggetti e tavolozza v3 completa).
- **Verifica di supporto:** `npm run typecheck`, suite `Vitest` (6 file, 72+ test), `vite build`, prova end-to-end in browser (`1440×900`, `1024×768`, `390×844`), benchmark `?qa=1` a 2.000 simboli e ispezione indipendente PDF tramite Swift `PDFKit`.
