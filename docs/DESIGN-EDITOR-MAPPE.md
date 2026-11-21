# Il tavolo del cartografo
## Documento di design dell’editor di mappe fantasy

**Edizione 1.1 · 18 novembre 2026 · Riferimento UI del progetto**

Aprendo un progetto si vede un foglio di mare azzurro dentro un banco di lavoro color blu ardesia. Sulla sinistra si sceglie il pennello. A destra, un campione mostra il diametro del tratto. Al centro, la prima pennellata fa emergere un lembo di terra chiara. È qui che deve concentrarsi lo sguardo del master.

Questa guida governa l’aspetto e il comportamento visibile dell’editor. La [specifica tecnica](SPECIFICA-EDITOR-MAPPE.md) governa dati, strumenti disponibili, salvataggio ed export. Il nome «Il tavolo del cartografo» identifica la direzione artistica e può restare interno al progetto. Colori, caratteri e misure qui definiti costituiscono la prima baseline progettuale. Il tema della carta può evolvere indipendentemente dall’interfaccia.

### Direzione artistica

| Ispirazione richiesta | Qualità da portare nell’editor | Applicazione originale |
|---|---|---|
| Manuale di avventura di D&D | Gerarchia editoriale, piacere di consultare un luogo descritto e illustrato, alternanza fra titoli evocativi e istruzioni precise | Titoli con grazie, lessico operativo in italiano, nomi di luogo ben leggibili. Una città sul foglio si chiama «Porto delle Brume». Il comando che la inserisce si chiama «Insediamento». |
| Illustrazione fantasy di Magic: The Gathering | Una scena concentrata in una silhouette leggibile, luce direzionale e profondità atmosferica | Il campione di una montagna ha una cresta riconoscibile, un versante in ombra e un primo piano netto. La stessa silhouette deve reggere sia nella libreria sia sulla carta. |
| Cartografia da tavolo | Continuità tra il foglio di lavoro e quello consegnato ai giocatori | Un filetto color ottone e piccoli segni di registro agli angoli individuano la pagina sul banco. Tutte le indicazioni degli strumenti appartengono alla vista di lavoro. |

**Firma visiva.** Riservare il dettaglio illustrato alla carta e ai campioni della libreria. L’interfaccia usa superfici opache, testo nitido, una sola famiglia di icone e un solo accento ottone. Un pannello proprietà deve restare leggibile anche accanto a una costa molto frastagliata. Loghi, simboli di mana, cornici di carte, illustrazioni e caratteri proprietari dei giochi citati restano fuori dal vocabolario del prodotto. Ogni nuova risorsa segue le regole di provenienza della specifica tecnica.

### Colore e materiali

Usare i nomi semantici sotto come proprietà CSS condivise. Il renderer riceve gli equivalenti per cursori e maniglie. Un componente usa il token del proprio ruolo. Per una nuova esigenza cromatica verificare prima i ruoli esistenti.

| Token UI | Colore | Impiego |
|---|---|---|
| ui-bench | `#17232D` | Piano di lavoro esterno al foglio e testo sui pulsanti ottone |
| ui-panel | `#22323F` | Barre, pannelli, finestre |
| ui-raised | `#304554` | Campi, superfici in hover, riga attiva |
| ui-text | `#F3EEDF` | Testo principale e icone su superfici scure |
| ui-muted | `#C0C9C9` | Valori secondari, unità e scorciatoie |
| ui-line | `#81939A` | Contorno di input e controlli che richiedono un confine percepibile. Per divisori decorativi usare lo stesso colore al 30%. |
| ui-accent | `#E0BB79` | Fondo dell’azione primaria, tacca dello strumento attivo, segni di registro |
| ui-focus | `#9CDEEF` | Anello del focus da tastiera e bordo esterno delle maniglie |
| ui-error | `#FFB3A6` | Icona e titolo di errore su pannello, accompagnati da messaggio e azione |
| ui-success | `#A8D8BC` | Spunta che accompagna «Salvato» |

**Abbinamenti.** Testo normale in ui-text o ui-muted su bench, panel e raised. Sul pulsante ottone usare ui-bench. L’errore di salvataggio usa un’icona, la frase esplicita e il colore dedicato. Riservare eventuali texture alla terra e al mare della carta. Mantenere uniformi gli sfondi sotto input, tabelle, menu e messaggi.

### Tipografia, metrica e icone

| Ruolo | Famiglia e fallback | Dimensione / interlinea · peso |
|---|---|---|
| Titolo progetto, titolo finestra | Spectral, Georgia, serif | 22/28 px · 600 |
| Titolo di pannello | Spectral, Georgia, serif | 18/24 px · 600 |
| Comando, scheda, titolo di campo | Source Sans 3, system-ui, sans-serif | 15/20 px · 600 |
| Testo operativo e input | Source Sans 3, system-ui, sans-serif | 15/22 px · 400 |
| Stato, unità, scorciatoia | Source Sans 3, system-ui, sans-serif | 13/18 px · 400 |

Usare maiuscole da frase e cifre tabulari nei campi che cambiano durante il trascinamento. Allineare a sinistra i nomi, a destra i valori numerici associati. Prevedere fallback con accenti italiani. Distribuire localmente le famiglie selezionate insieme ai relativi avvisi quando si prepara la build.

**Misure UI.** Griglia di spaziatura di 4 px. Usare 8 px tra icona e testo, 12 px tra campi correlati, 16 px di margine nei pannelli e 24 px tra gruppi. Raggio di 4 px sui controlli e 8 px sui dialoghi. Contorno da 1 px. Pulsanti e input alti almeno 36 px, strumenti principali 44 × 44 px. Allargare l’area cliccabile delle icone senza ingrandire il disegno.

**Iconografia.** Griglia 24 × 24, tratto da 1,75 px con estremità arrotondate. Il pennello Terra mostra un pennello con un piccolo lembo pieno, Acqua un’onda con un’incisione. Disegnare le due silhouette in modo che si distinguano anche in monocromia. Ogni comando a sola icona ha nome accessibile e suggerimento visibile sia al passaggio del puntatore sia al focus.

### Anatomia dell’editor

Schema di riferimento desktop. Le diciture nella tela e nelle parentesi descrivono le zone del disegno.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Progetto ▾   Arcipelago delle Brume    Annulla  Ripristina  Esporta PDF │
├────────┬──────────────────────────────────────────┬─────────────────┤
│ Mano   │                                          │ Proprietà       │
│ Selez. │        ┌───────────────────────┐         │                 │
│ Terra  │        │                       │         │ Pennello terra  │
│ Acqua  │        │   [foglio di mare]    │         │ Diametro   80 u │
│ Rilievo│        │                       │         │ ─────●──────    │
│ Copert.│        └───────────────────────┘         │ [campione]      │
│ POI    │                                          │                 │
│ Testo  │                                          │                 │
├────────┴──────────────────────────────────────────┴─────────────────┤
│ ✓ Salvato                                     −   100%   +   Adatta │
└─────────────────────────────────────────────────────────────────────┘
```

- **Barra superiore.** Altezza di riferimento 56 px. «Progetto» raggruppa creazione, apertura, importazione e download del progetto modificabile. Titolo editabile, annulla e ripristina rimangono raggiungibili. «Esporta PDF» è il pulsante primario.
- **Strumenti a sinistra.** Colonna da 64 px. Una tacca verticale ottone, la superficie raised e lo stato accessibile premuto identificano lo strumento corrente. La posizione dei comandi rimane stabile cambiando selezione.
- **Centro.** Il foglio mantiene il rapporto della pagina. All’apertura è interamente visibile con aria sui quattro lati. La tela iniziale è mare uniforme. Un breve aiuto «Disegna la prima costa con Terra» può apparire sul banco fino al primo tratto.
- **Pannello destro.** Larghezza di riferimento 280 px. Con Terra o Acqua mostra diametro, valore numerico e campione. Con Elevazione presenta Alza e Abbassa. Con Copertura presenta i materiali. Con POI presenta la libreria di sticker. Con un oggetto selezionato presenta proprietà e ordine. L’elenco «Oggetti» consente di raggiungere elementi coperti. Scorre internamente.
- **Barra inferiore.** Altezza di riferimento 36 px. Stato di salvataggio a sinistra, controlli della camera a destra. Mantenere fermi i controlli quando cambia la lunghezza del messaggio.
- **Spazio ridotto.** Sotto 1100 px il pannello destro si richiude con «Proprietà» e si riapre come pannello sovrapposto. Sotto 760 px gli strumenti diventano una fila orizzontale scorrevole e le proprietà un cassetto richiudibile. Mantenere accessibili zoom, chiusura del cassetto ed export. Il primo dispositivo di riferimento resta il desktop.

### Componenti e stati

| Componente | Anatomia e comportamento |
|---|---|
| Pulsante primario | Fondo ottone, testo scuro, verbo e oggetto. In un dialogo di export l’azione è «Esporta PDF». Durante l’elaborazione mostra «Esportazione…» e impedisce invii duplicati. |
| Pulsante secondario | Superficie panel, testo chiaro, contorno quando serve a identificarne i limiti. Hover su raised. Pressione con contorno interno. Disabilitato con stato semantico e aspetto attenuato. |
| Controllo diametro | Etichetta, slider e input numerico sincronizzati. «u» indica le unità mappa. Il puntatore circolare mantiene lo stesso diametro geografico cambiando zoom. |
| Libreria POI | Griglia di campioni su fondo uniforme, con nome leggibile sotto ogni figura. Il campione attivo ha bordo ottone e spunta. Clic sul campione prepara il simbolo, clic sul foglio lo colloca. |
| Selezione sulla carta | Riquadro e maniglie a due toni, contorno scuro e interno chiaro, visibili su mare e terra. Ingrandire l’area di presa. Il pannello riporta nome, dimensioni e rotazione. |
| Elenco oggetti | Riga con anteprima, nome e stato selezionato. La prima riga rappresenta l’oggetto in primo piano. «Porta avanti» e «Porta indietro» aggiornano lista e tela insieme. |
| Finestra Esporta PDF | Miniatura della pagina completa, formato fisico, orientamento del progetto e azioni «Annulla» ed «Esporta PDF». L’anteprima esclude maniglie e segni di registro. |
| Messaggio persistente | Frase breve, icona e rimedio concreto. Per quota esaurita usare «Spazio locale esaurito. Scarica una copia del progetto.» con azione «Scarica progetto». |
| Dialoghi e pannelli | Focus iniziale sul primo controllo utile, Esc per chiudere e ritorno al comando d’origine. I dialoghi modali trattengono il focus finché restano aperti. |

**Stati da disegnare.** Per ogni controllo interattivo coprire riposo, hover, pressione, focus da tastiera, stato attivo e indisponibilità quando applicabili. Il focus usa un anello di 2 px con distacco di 2 px. Lo strumento attivo e il comando con focus possono essere diversi. Nelle superfici illustrate usare un doppio contorno per mantenere visibile il focus.

### Dipingere il paesaggio e collocare un luogo

**Elevazione.** Usare l’icona di tre curve di livello. Il pannello mostra Alza e Abbassa, diametro, intensità e un campione delle quattro fasce. Nel campione il tratto passa dalla sabbia chiara alla pianura aperta, alle curve morbide delle colline e infine alle creste illuminate. La sagoma del pennello resta visibile sopra tutti i materiali. La risposta della terra si vede già durante il gesto. Sulla riva bassa compare sabbia, mentre alla stessa quota nell’entroterra compare pianura.

**Copertura.** Presentare Foresta, Campi e Naturale con nome e campione di superficie. Ogni campione mostra una piccola porzione di paesaggio. Le chiome lasciano intravedere il versante, i solchi seguono la collina e la battigia resta leggibile. Con Naturale riaffiora il rilievo sottostante. Al passaggio su acqua mostrare l’indicazione contestuale «Dipingi sulla terra» quando il pennello ricade interamente sul mare.

**Punti di interesse (POI).** La libreria presenta sticker isolati su fondo uniforme. Una torre, un porto e una rovina devono essere riconoscibili dalla silhouette. Mostrare l’anteprima singola ancorata al cursore e applicarla con un clic. In selezione compaiono maniglie e proprietà dell’oggetto. Anche dopo una pennellata di foresta lo sticker resta leggibile sopra il paesaggio. Le posizioni dei singoli alberi e dei solchi dipinti appartengono alla resa del materiale.

**Scena di revisione.** Usare un promontorio con spiaggia, dorsale montuosa e torre sul crinale. Attraversare con Foresta piano e pendio, ripassare una zona con Campi e abbassare parte della dorsale. Confrontare tela, riapertura e PDF per continuità della costa, visibilità delle creste, posizione dei dettagli e leggibilità del POI.

### Il primo tema della carta

Questa è una **proposta artistica per la carta campione**. I token map appartengono al tema versionato del progetto. Modificare i colori dell’interfaccia deve preservare integralmente i PDF delle carte esistenti.

| Ruolo | Base | Resa |
|---|---|---|
| map-sea | `#A8C8C6` | Mare verdeazzurro, fondo disteso. Eventuali linee batimetriche seguono localmente la costa. |
| map-land | `#E8D8AF` | Terra color carta di stracci. Grana fine e a bassa intensità. |
| map-ink | `#263C40` | Contorni di costa, nomi e dettagli più profondi. |
| map-forest | `#486953` | Chiome raccolte in masse leggibili, con aperture tra i gruppi. |
| map-stone | `#7B7880` | Versanti in ombra, luce convenzionale da nord-ovest. |
| map-settlement | `#8B493D` | Accento caldo riservato a tetti e insediamenti. |

**Modello per gli illustratori.** Montagna di tre quarti con una cresta dominante, abete con due masse di rami, porto con una torre e un molo. Base visiva allineata al terreno, margine trasparente uniforme e silhouette riconoscibile a 24 px. Rivedere insieme i tre simboli per coerenza di luce, tratto e prospettiva. Conservare la stessa ancora durante la sostituzione delle illustrazioni.

**Etichette nella carta campione.** Usare Spectral per i nomi. Sul foglio A4 provare 16 pt per «Arcipelago delle Brume», 11 pt per «Porto delle Brume» e 10 pt corsivo per «Mare di Vetro». Sono valori fisici del tema, da convertire in unità documento secondo la scala della pagina. Un alone sottile color terra può proteggere una scritta posta su un’illustrazione. Verificare il risultato sulla stampa al 100%. Le scelte dell’autore della carta rimangono modificabili.

### Voce, movimento e accessibilità

**Lingua.** Italiano, verbi diretti e termini coerenti. «Scarica progetto» conserva il lavoro modificabile. «Esporta PDF» produce la pagina da stampare. Usare «Salvataggio…» durante la scrittura e «Salvato» dopo la conferma. Un conflitto offre «Salva come copia». In un pannello vuoto usare un invito specifico, per esempio «Scegli un simbolo e fai clic sulla mappa».

**Movimento.** Hover e apertura pannello possono usare 120–160 ms. Il pennello, le maniglie e il pan seguono il gesto immediatamente. Con movimento ridotto attivo eliminare transizioni di posizione e zoom animato. Un’operazione lunga mantiene un’indicazione testuale di avanzamento.

**Lettura e controllo.** Obiettivi di progetto: contrasto minimo 4,5:1 per testo normale, 3:1 per componenti visivi essenziali sullo sfondo adiacente. Affiancare sempre colore e forma o testo allo stato. Mantenere navigabili da tastiera strumenti, elenco oggetti e proprietà. Verificare a zoom browser 200%, con titoli lunghi e con accenti. Annunciare errori e completamento di operazioni importanti senza annunciare ogni movimento del pennello.

### Come applicare la guida a ogni intervento UI

1. **Prima della modifica**, identificare il compito del master, la sezione pertinente di questa guida e il componente esistente da riusare. Consultare la specifica tecnica per distinguere funzionalità disponibili e incrementi futuri.
2. **Durante l’implementazione**, usare token semantici e componenti condivisi. Per un nuovo pattern documentare qui nome, scopo, anatomia, stati, comportamento da tastiera e adattamento a spazio ridotto. Una variazione artistica della carta va nel suo tema versionato.
3. **Prima della consegna**, provare il percorso modificato con mouse e tastiera. Confrontare a 1440 × 900 e 1024 × 768. Se la modifica riguarda layout compatto, provarla anche a 390 px di larghezza. Registrare le dimensioni effettivamente verificate.
4. **Nella consegna**, citare la sezione applicata, riportare gli stati controllati e allegare le viste interessate quando è disponibile un’app eseguibile. Una modifica intenzionale a palette, tipografia o anatomia condivisa comprende l’aggiornamento di questa guida e del suo registro.

| Scena di riferimento | Cosa deve restare riconoscibile in revisione |
|---|---|
| Primo avvio | Foglio vuoto ben delimitato, Terra attivo, nome dello strumento e diametro leggibili. |
| Modifica di «Porto delle Brume» | Stessa selezione in tela, elenco e proprietà. Focus e testo visibili anche con pannello stretto. |
| Errore di salvataggio | La carta resta visibile. Il messaggio spiega come conservare una copia. |
| Anteprima e PDF | Inquadratura della pagina intera, identità cartografica preservata, assenza di elementi di interazione nel file. |
| Nuovo tema cartografico | Colori e simboli possono cambiare. Posizione dei comandi e significato degli stati UI rimangono coerenti. |

**Registro delle decisioni.** Edizione 1.0, 18 novembre 2026. Introdotti banco blu ardesia, accento ottone, coppia Spectral e Source Sans 3, anatomia desktop e primo tema cartografico. La prima implementazione dovrà validare densità dei pannelli, controllo del pennello e leggibilità del foglio stampato.

**Edizione 1.1, 18 novembre 2026.** Aggiunti Elevazione, Copertura e sticker POI alla prima versione mondo. La scena del promontorio verifica insieme la resa reattiva e l’indipendenza degli oggetti.

**Edizione 2.0, 21 novembre 2026 (Incremento 2).** Estesa la barra strumenti con `Fiumi e Strade (R)`, i 4 strumenti di `Rilievo` (*Alza*, *Abbassa*, *Appiattisci*, *Ammorbidisci*) con preset d’intensità (`20%`, `45%`, `80%`), i 10 campioni illustrati di `Superfici e materiali`, la barra superiore con **`Tela…` (`ResizeCanvasDialog`)**, selettore dei **4 temi cartografici** e guida scorciatoie (`?`), il pannello destro a **3 schede (`Strumento | Livelli | Oggetti`)**, la libreria a 31 POI con ricerca, filtri e pennello scatter, la pila di **Livelli** con opacità, blocco e visibilità, preservando token `--ui-*`, gerarchia Spectral / Source Sans 3 (`13/15/18/22 px`), anello focus `2 px + 2 px` e layout compatto privo di overflow a `1440×900`, `1024×768` e `390×844`.
