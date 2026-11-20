# Licenze e attribuzioni di terze parti

Questo documento raccoglie le licenze e le attribuzioni delle dipendenze software installate (verificate da `package.json` e `package-lock.json`), dei pacchetti transitivi inclusi nel bundle client, dei font tipografici distribuiti localmente e delle risorse grafiche cartografiche dell'editor **«Il tavolo del cartografo»**.

---

## 1. Dipendenze runtime dirette (distribuite nel bundle)

| Pacchetto | Versione installata | Vincolo `package.json` | Licenza | Titolare / Note di copyright | Sorgente |
|---|---|---|---|---|---|
| `react` | `19.3.1` | `^19.0.0` | `MIT` | Copyright (c) Meta Platforms, Inc. and affiliates | https://github.com/facebook/react |
| `react-dom` | `19.3.1` | `^19.0.0` | `MIT` | Copyright (c) Meta Platforms, Inc. and affiliates | https://github.com/facebook/react |
| `konva` | `9.3.22` | `^9.3.18` | `MIT` | Original work Copyright (C) 2011–2013 Eric Rowell; Modified work Copyright (C) 2014–present Anton Lavrenov | https://github.com/konvajs/konva |
| `pdf-lib` | `1.17.1` | `^1.17.1` | `MIT` | Copyright (c) 2019 Andrew Dillon | https://github.com/Hopding/pdf-lib |
| `fflate` | `0.8.3` | `^0.8.2` | `MIT` | Copyright (c) 2026 Arjun Barrett | https://github.com/101arrowz/fflate |

---

## 2. Dipendenze runtime incorporate / transitive (incluse nel bundle)

| Pacchetto | Versione installata | Portato da | Licenza | Titolare / Note di copyright | Sorgente |
|---|---|---|---|---|---|
| `scheduler` | `0.28.0` | `react-dom` | `MIT` | Copyright (c) Meta Platforms, Inc. and affiliates | https://github.com/facebook/react |
| `@pdf-lib/standard-fonts` | `1.0.0` | `pdf-lib` | `MIT` | Copyright (c) 2018 Andrew Dillon | https://github.com/Hopding/standard-fonts |
| `@pdf-lib/upng` | `1.0.1` | `pdf-lib` | `MIT` | Copyright (c) 2017 Photopea | https://github.com/Hopding/upng |
| `pako` | `1.0.11` | `pdf-lib` | `MIT AND Zlib` | File principali in MIT: Copyright (C) 2014–2017 Vitaly Puzrin e Andrei Tuputcyn; `/lib/zlib` in Zlib (porting di zlib v1.2.8 di Jean-loup Gailly e Mark Adler) | https://github.com/nodeca/pako |
| `tslib` | `1.14.1` | `pdf-lib` | `0BSD` | Copyright (c) Microsoft Corporation | https://github.com/microsoft/tslib |

---

## 3. Font tipografici distribuiti localmente (`SIL OFL-1.1`)

I font seguenti sono distribuiti localmente nel bundle applicativo tramite pacchetti Fontsource (`src/styles/tokens.css`) sotto **SIL Open Font License, Version 1.1 (`OFL-1.1`)** (testo completo: http://scripts.sil.org/OFL e nei rispettivi file `LICENSE` di pacchetto):

| Famiglia | Pacchetto | Versione installata | Versione font | Pesi inclusi nel bundle | Licenza | Autori / Copyright | Sorgente |
|---|---|---|---|---|---|---|---|
| **Spectral** | `@fontsource/spectral` | `5.3.0` (`^5.1.0`) | `v15` | `400`, `600`, `400 italic`, `600 italic` | `OFL-1.1` | Copyright 2017 The Spectral Project Authors (Production Type) | https://github.com/productiontype/Spectral · https://fontsource.org/fonts/spectral |
| **Source Sans 3** | `@fontsource/source-sans-3` | `5.3.1` (`^5.1.0`) | `v20` | `400`, `600` | `OFL-1.1` | Adobe / Paul D. Hunt (metadati Fontsource: Google Inc.) | https://fontsource.org/fonts/source-sans-3 · https://github.com/fontsource/font-files |

**Condizioni essenziali SIL OFL-1.1:** l'incorporamento nella distribuzione web dell'editor e l'impiego nella composizione ed esportazione PDF delle mappe sono consentiti senza royalty, a condizione di mantenere intatti gli avvisi di copyright e di licenza (`OFL-1.1`), di non rivendere i file dei font isolatamente e di non riutilizzare i nomi riservati dei caratteri per versioni modificate.

---

## 4. Strumenti di sviluppo, build e test (`devDependencies`)

Questi pacchetti sono impiegati in fase di compilazione, controllo tipi e test automatizzati e non vengono distribuiti come librerie runtime del bundle finale:

| Pacchetto | Versione installata | Vincolo `package.json` | Licenza | Titolare / Note di copyright | Sorgente |
|---|---|---|---|---|---|
| `typescript` | `5.9.3` | `^5.7.3` | `Apache-2.0` | Microsoft Corporation | https://github.com/microsoft/TypeScript |
| `vite` | `6.4.6` | `^6.1.0` | `MIT` | Copyright (c) 2019–present VoidZero Inc. and Vite contributors | https://github.com/vitejs/vite |
| `@vitejs/plugin-react` | `4.7.0` | `^4.3.4` | `MIT` | Copyright (c) 2019–present Yuxi (Evan) You and Vite contributors | https://github.com/vitejs/vite-plugin-react |
| `vitest` | `3.2.7` | `^3.0.5` | `MIT` | Copyright (c) 2021–Present Vitest Team | https://github.com/vitest-dev/vitest |
| `fake-indexeddb` | `6.2.8` | `^6.0.0` | `Apache-2.0` | Jeremy Scheff (dumbmatter) | https://github.com/dumbmatter/fakeIndexedDB |
| `@types/react` | `19.3.0` | `^19.0.0` | `MIT` | DefinitelyTyped contributors | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/react-dom` | `19.3.0` | `^19.0.0` | `MIT` | DefinitelyTyped contributors | https://github.com/DefinitelyTyped/DefinitelyTyped |

---

## 5. Risorse grafiche e simboli cartografici (`CC0-1.0`)

Tutti i 6 simboli POI del catalogo predefinito (`BUILTIN_POI_CATALOG`, definiti in `src/assets/svg/*.svg` e registrati in `src/assets/catalog.ts`) sono **illustrazioni vettoriali originali** create appositamente per *«Il tavolo del cartografo»*, prive di dipendenze da font esterni e rilasciate sotto **CC0 1.0 Universal (Public Domain Dedication)** (https://creativecommons.org/publicdomain/zero/1.0/deed.it).

| ID risorsa | Nome italiano | Percorso archivio / sorgente | Versione | Autore | Origine | Licenza | Attribuzione richiesta |
|---|---|---|---|---|---|---|---|
| `poi-settlement` | Insediamento | `assets/poi-settlement.svg` (`src/assets/svg/poi-settlement.svg`) | `1` | Il tavolo del cartografo | `builtin` (originale) | `CC0-1.0` | Nessuna (CC0 1.0 Universal) |
| `poi-harbor` | Porto | `assets/poi-harbor.svg` (`src/assets/svg/poi-harbor.svg`) | `1` | Il tavolo del cartografo | `builtin` (originale) | `CC0-1.0` | Nessuna (CC0 1.0 Universal) |
| `poi-tower` | Torre | `assets/poi-tower.svg` (`src/assets/svg/poi-tower.svg`) | `1` | Il tavolo del cartografo | `builtin` (originale) | `CC0-1.0` | Nessuna (CC0 1.0 Universal) |
| `poi-ruin` | Rovina | `assets/poi-ruin.svg` (`src/assets/svg/poi-ruin.svg`) | `1` | Il tavolo del cartografo | `builtin` (originale) | `CC0-1.0` | Nessuna (CC0 1.0 Universal) |
| `poi-citadel` | Cittadella | `assets/poi-citadel.svg` (`src/assets/svg/poi-citadel.svg`) | `1` | Il tavolo del cartografo | `builtin` (originale) | `CC0-1.0` | Nessuna (CC0 1.0 Universal) |
| `poi-monolith` | Monolite | `assets/poi-monolith.svg` (`src/assets/svg/poi-monolith.svg`) | `1` | Il tavolo del cartografo | `builtin` (originale) | `CC0-1.0` | Nessuna (CC0 1.0 Universal) |

**Diritti verificati:** la dedica al pubblico dominio `CC0-1.0` autorizza senza restrizioni la distribuzione dei file SVG all'interno della build dell'editor, l'incorporazione automatica negli archivi `.zip` esportati (accompagnati da `LICENSES.txt`) e la stampa o esportazione PDF delle mappe generate dagli utenti. Le texture di terreno, costa, rilievo, foresta e campi sono sintetizzate proceduralmente in codice proprio del progetto e non utilizzano asset bitmap di terze parti.
