import { AssetManifestEntry, MapDocument } from '../model/document';
import { LoadedAssetMap, LoadedAssetResource, POI_CATEGORIES, PoiCatalogItem, PoiCategoryMeta } from './types';
export { POI_CATEGORIES };

import abbeySvg from './svg/poi-abbey.svg?raw';
import ancientTreeSvg from './svg/poi-ancient-tree.svg?raw';
import bannerCompassSvg from './svg/poi-banner-compass.svg?raw';
import bridgeSvg from './svg/poi-bridge.svg?raw';
import campSvg from './svg/poi-camp.svg?raw';
import capitalSvg from './svg/poi-capital.svg?raw';
import castleSvg from './svg/poi-castle.svg?raw';
import caveSvg from './svg/poi-cave.svg?raw';
import citadelSvg from './svg/poi-citadel.svg?raw';
import cloudBankSvg from './svg/poi-cloud-bank.svg?raw';
import compassSvg from './svg/poi-compass.svg?raw';
import dockSvg from './svg/poi-dock.svg?raw';
import gateSvg from './svg/poi-gate.svg?raw';
import harborSvg from './svg/poi-harbor.svg?raw';
import hillFortSvg from './svg/poi-hill-fort.svg?raw';
import keepSvg from './svg/poi-keep.svg?raw';
import lighthouseSvg from './svg/poi-lighthouse.svg?raw';
import longshipSvg from './svg/poi-longship.svg?raw';
import mineSvg from './svg/poi-mine.svg?raw';
import monolithSvg from './svg/poi-monolith.svg?raw';
import monsterLairSvg from './svg/poi-monster-lair.svg?raw';
import obeliskSvg from './svg/poi-obelisk.svg?raw';
import peakSvg from './svg/poi-peak.svg?raw';
import portalSvg from './svg/poi-portal.svg?raw';
import ruinSvg from './svg/poi-ruin.svg?raw';
import settlementSvg from './svg/poi-settlement.svg?raw';
import shipSvg from './svg/poi-ship.svg?raw';
import shipwreckSvg from './svg/poi-shipwreck.svg?raw';
import shrineSvg from './svg/poi-shrine.svg?raw';
import signpostSvg from './svg/poi-signpost.svg?raw';
import tavernSvg from './svg/poi-tavern.svg?raw';
import templeSvg from './svg/poi-temple.svg?raw';
import towerSvg from './svg/poi-tower.svg?raw';
import villageSvg from './svg/poi-village.svg?raw';
import volcanoSvg from './svg/poi-volcano.svg?raw';
import walledCitySvg from './svg/poi-walled-city.svg?raw';
import waterfallSvg from './svg/poi-waterfall.svg?raw';
import windmillSvg from './svg/poi-windmill.svg?raw';

type PoiCategoryId = PoiCategoryMeta['id'];

const CATEGORY_LABEL_BY_ID: Record<PoiCategoryId, string> = Object.fromEntries(
  POI_CATEGORIES.map((cat) => [cat.id, cat.label])
) as Record<PoiCategoryId, string>;

interface BuiltinPoiSpec {
  id: string;
  categoryId: PoiCategoryId;
  tags: readonly string[];
  name: string;
  description: string;
  defaultWidthDoc: number;
  defaultHeightDoc: number;
  svgRaw: string;
}

/** Builds a normalized CC0-1.0 built-in POI catalog entry with 128x128 viewBox and centered anchor. */
function makeBuiltinPoiItem(spec: BuiltinPoiSpec): PoiCatalogItem {
  return {
    id: spec.id,
    categoryId: spec.categoryId,
    categoryLabel: CATEGORY_LABEL_BY_ID[spec.categoryId],
    tags: spec.tags,
    name: spec.name,
    description: spec.description,
    defaultWidthDoc: spec.defaultWidthDoc,
    defaultHeightDoc: spec.defaultHeightDoc,
    asset: {
      id: spec.id,
      path: `assets/${spec.id}.svg`,
      mimeType: 'image/svg+xml',
      version: 1,
      author: 'Il tavolo del cartografo',
      source: 'builtin',
      license: 'CC0-1.0',
      width: 128,
      height: 128,
      anchorX: 0.5,
      anchorY: 0.5
    },
    svgContent: spec.svgRaw.trim()
  };
}

export const BUILTIN_POI_CATALOG: readonly PoiCatalogItem[] = [
  // Insediamenti (6)
  makeBuiltinPoiItem({
    id: 'poi-settlement',
    categoryId: 'settlements',
    tags: ['borgo', 'città', 'villaggio', 'insediamento', 'mura', 'cinta', 'porta'],
    name: 'Insediamento',
    description: 'Borgo murato con cinta merlata, porta ad arco e tetti rossi',
    defaultWidthDoc: 110,
    defaultHeightDoc: 110,
    svgRaw: settlementSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-village',
    categoryId: 'settlements',
    tags: ['villaggio', 'casali', 'case', 'campagna', 'paglia', 'borgo', 'rurale', 'pozzo'],
    name: 'Villaggio',
    description: 'Piccolo agglomerato rurale con case dal tetto di paglia e pozzo',
    defaultWidthDoc: 98,
    defaultHeightDoc: 98,
    svgRaw: villageSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-capital',
    categoryId: 'settlements',
    tags: ['capitale', 'metropoli', 'città', 'reale', 'palazzo', 'cupola', 'impero', 'regno'],
    name: 'Capitale',
    description: 'Grande metropoli reale con cupola dorata, guglie e porta trionfale',
    defaultWidthDoc: 136,
    defaultHeightDoc: 136,
    svgRaw: capitalSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-tavern',
    categoryId: 'settlements',
    tags: ['locanda', 'taverna', 'osteria', 'birra', 'botti', 'ristoro', 'viaggiatori', 'albergo'],
    name: 'Locanda',
    description: 'Osteria a graticcio lungo la via con botti e insegna sporgente',
    defaultWidthDoc: 96,
    defaultHeightDoc: 96,
    svgRaw: tavernSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-windmill',
    categoryId: 'settlements',
    tags: ['mulino', 'vento', 'pale', 'grano', 'campi', 'granaio', 'farina', 'rurale'],
    name: 'Mulino a vento',
    description: 'Torre rurale con grandi pale a croce e granaio ai piedi del colle',
    defaultWidthDoc: 102,
    defaultHeightDoc: 102,
    svgRaw: windmillSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-abbey',
    categoryId: 'settlements',
    tags: ['abbazia', 'monastero', 'chiesa', 'campanile', 'chiostro', 'santuario', 'convento'],
    name: 'Abbazia',
    description: 'Santuario monastico con rosone, chiostro porticato e campanile',
    defaultWidthDoc: 112,
    defaultHeightDoc: 112,
    svgRaw: abbeySvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-walled-city',
    categoryId: 'settlements',
    tags: ['metropoli', 'città', 'mura', 'novigrad', 'oxenfurt', 'porto', 'tetti rossi', 'cinta'],
    name: 'Metropoli murata',
    description: 'Grande città medievale cinta da mura bastionati con dedalo di tetti rossi',
    defaultWidthDoc: 148,
    defaultHeightDoc: 148,
    svgRaw: walledCitySvg
  }),

  // Fortezze (5)
  makeBuiltinPoiItem({
    id: 'poi-tower',
    categoryId: 'fortresses',
    tags: ['torre', 'guardia', 'vedetta', 'avamposto', 'sentinella', 'fortezza'],
    name: 'Torre',
    description: 'Torre di guardia isolata su zoccolo roccioso',
    defaultWidthDoc: 96,
    defaultHeightDoc: 96,
    svgRaw: towerSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-citadel',
    categoryId: 'fortresses',
    tags: ['cittadella', 'castello', 'fortezza', 'mastio', 'rocca', 'difesa'],
    name: 'Cittadella',
    description: 'Fortezza arroccata con mastio centrale e bastioni angolari',
    defaultWidthDoc: 118,
    defaultHeightDoc: 118,
    svgRaw: citadelSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-castle',
    categoryId: 'fortresses',
    tags: ['castello', 'maniero', 'rocca', 're', 'maschio', 'torri', 'fortezza', 'feudo'],
    name: 'Castello',
    description: 'Maniero asimmetrico arroccato su sperone roccioso con maschio e torrette',
    defaultWidthDoc: 128,
    defaultHeightDoc: 128,
    svgRaw: castleSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-keep',
    categoryId: 'fortresses',
    tags: ['bastione', 'fortino', 'baluardo', 'presidio', 'guarnigione', 'fortezza', 'braciere'],
    name: 'Bastione',
    description: 'Ridotta militare a mura scarpate con contrafforti e braciere di guardia',
    defaultWidthDoc: 104,
    defaultHeightDoc: 104,
    svgRaw: keepSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-gate',
    categoryId: 'fortresses',
    tags: ['porta', 'valico', 'confine', 'passo', 'saracinesca', 'dogana', 'mura', 'arco'],
    name: 'Porta fortificata',
    description: 'Varco di confine fortificato con torri gemelle e saracinesca alzata',
    defaultWidthDoc: 108,
    defaultHeightDoc: 108,
    svgRaw: gateSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-hill-fort',
    categoryId: 'fortresses',
    tags: ['rocca', 'colle', 'forte', 'barone', 'palizzata', 'bastione', 'maniero', 'fortezza'],
    name: 'Rocca collinare',
    description: 'Roccaforte arroccata su collina con sentiero, palizzata e palazzotto rosso',
    defaultWidthDoc: 132,
    defaultHeightDoc: 132,
    svgRaw: hillFortSvg
  }),

  // Coste e Porti (5)
  makeBuiltinPoiItem({
    id: 'poi-harbor',
    categoryId: 'coasts',
    tags: ['porto', 'faro', 'nave', 'banchina', 'costa', 'approdo', 'baia'],
    name: 'Porto',
    description: 'Faro costiero con banchina e barca a vela ormeggiata',
    defaultWidthDoc: 112,
    defaultHeightDoc: 112,
    svgRaw: harborSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-lighthouse',
    categoryId: 'coasts',
    tags: ['faro', 'scoglio', 'luce', 'costa', 'mare', 'secca', 'lanterna', 'segnale'],
    name: 'Faro isolato',
    description: 'Torre costiera a bande rosse su scoglio battuto dalle onde con fasci di luce',
    defaultWidthDoc: 100,
    defaultHeightDoc: 100,
    svgRaw: lighthouseSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-shipwreck',
    categoryId: 'coasts',
    tags: ['relitto', 'naufragio', 'scogli', 'secca', 'nave', 'costa', 'pericolo', 'tesoro'],
    name: 'Relitto',
    description: 'Scafo spezzato incagliato fra gli scogli con albero inclinato e vela lacera',
    defaultWidthDoc: 106,
    defaultHeightDoc: 106,
    svgRaw: shipwreckSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-ship',
    categoryId: 'coasts',
    tags: ['galeone', 'nave', 'veliero', 'vascello', 'mare', 'flotta', 'rotta', 'vele'],
    name: 'Galeone',
    description: 'Veliero a tre alberi in navigazione con vele quadre gonfie dal vento',
    defaultWidthDoc: 114,
    defaultHeightDoc: 114,
    svgRaw: shipSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-dock',
    categoryId: 'coasts',
    tags: ['molo', 'pontile', 'attracco', 'barca', 'pesca', 'riva', 'approdo', 'legno'],
    name: 'Molo',
    description: 'Pontile in legno su palafitte con merci, lanterna e barca a remi ormeggiata',
    defaultWidthDoc: 104,
    defaultHeightDoc: 104,
    svgRaw: dockSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-longship',
    categoryId: 'coasts',
    tags: ['drakkar', 'skellige', 'nave', 'vichinga', 'nordica', 'scudi', 'vela', 'mare'],
    name: 'Drakkar nordico',
    description: 'Nave nordica con prua di drago, fila di scudi lungo la murata e vela a strisce',
    defaultWidthDoc: 118,
    defaultHeightDoc: 118,
    svgRaw: longshipSvg
  }),

  // Rovine e Misteri (5)
  makeBuiltinPoiItem({
    id: 'poi-ruin',
    categoryId: 'ruins',
    tags: ['rovina', 'tempio', 'antico', 'ruderi', 'archi', 'colonna'],
    name: 'Rovina',
    description: 'Archi spezzati, colonna abbattuta e pietre antiche',
    defaultWidthDoc: 102,
    defaultHeightDoc: 102,
    svgRaw: ruinSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-monolith',
    categoryId: 'ruins',
    tags: ['monolite', 'pietra', 'runa', 'stele', 'cerchio', 'sacro'],
    name: 'Monolite',
    description: 'Stele di pietra scura con incisione dorata e cerchio di pietre',
    defaultWidthDoc: 90,
    defaultHeightDoc: 90,
    svgRaw: monolithSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-temple',
    categoryId: 'ruins',
    tags: ['tempio', 'santuario', 'colonne', 'altare', 'antico', 'culto', 'oracolo', 'rovine'],
    name: 'Tempio antico',
    description: 'Santuario classico gradonato con colonne, frontone e altare acceso',
    defaultWidthDoc: 116,
    defaultHeightDoc: 116,
    svgRaw: templeSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-obelisk',
    categoryId: 'ruins',
    tags: ['obelisco', 'rune', 'glifi', 'deserto', 'stele', 'antico', 'magia', 'arenaria'],
    name: 'Obelisco runico',
    description: 'Guglia in arenaria scolpita con punta dorata e colonna di glifi turchesi',
    defaultWidthDoc: 94,
    defaultHeightDoc: 94,
    svgRaw: obeliskSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-portal',
    categoryId: 'ruins',
    tags: ['portale', 'arcano', 'magia', 'vortice', 'soglia', 'rune', 'teletrasporto', 'mistero'],
    name: 'Portale arcano',
    description: 'Arco megalitico inciso di rune dorate attorno a un vortice turchese',
    defaultWidthDoc: 106,
    defaultHeightDoc: 106,
    svgRaw: portalSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-shrine',
    categoryId: 'ruins',
    tags: ['luogo di potere', 'stele', 'altare', 'runa', 'santuario', 'pietra', 'magia'],
    name: 'Luogo di potere',
    description: 'Stele runica antica incisa con glifo luminoso su piedistallo di pietra',
    defaultWidthDoc: 96,
    defaultHeightDoc: 96,
    svgRaw: shrineSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-monster-lair',
    categoryId: 'ruins',
    tags: ['tana', 'mostri', 'caverna', 'teschio', 'pericolo', 'antro', 'contratto'],
    name: 'Tana oscura',
    description: 'Anfratto roccioso segnato da teschio e simbolo di pericolo per tracce di mostri',
    defaultWidthDoc: 104,
    defaultHeightDoc: 104,
    svgRaw: monsterLairSvg
  }),

  // Natura e Rilievi (5)
  makeBuiltinPoiItem({
    id: 'poi-peak',
    categoryId: 'nature',
    tags: ['picco', 'montagna', 'vetta', 'neve', 'alpi', 'cresta', 'rilievo', 'cima'],
    name: 'Picco alpino',
    description: 'Vetta montuosa di tre quarti con cresta nevosa, versante in ombra e abeti',
    defaultWidthDoc: 122,
    defaultHeightDoc: 122,
    svgRaw: peakSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-volcano',
    categoryId: 'nature',
    tags: ['vulcano', 'lava', 'magma', 'cratere', 'fuoco', 'cenere', 'montagna', 'fumo'],
    name: 'Vulcano',
    description: 'Cono vulcanico fumante con cratere ardente, colate di lava e cenere',
    defaultWidthDoc: 120,
    defaultHeightDoc: 120,
    svgRaw: volcanoSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-cave',
    categoryId: 'nature',
    tags: ['grotta', 'caverna', 'antro', 'stalattiti', 'cristalli', 'sotterraneo', 'dungeon', 'rupe'],
    name: 'Grotta',
    description: 'Imbocco roccioso con stalattiti, cristalli e bagliore sulla soglia',
    defaultWidthDoc: 104,
    defaultHeightDoc: 104,
    svgRaw: caveSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-waterfall',
    categoryId: 'nature',
    tags: ['cascata', 'acqua', 'fiume', 'torrente', 'laghetto', 'rupe', 'natura', 'salto'],
    name: 'Cascata',
    description: 'Salto d’acqua fra pareti rocciose e vegetazione verso un laghetto spumeggiante',
    defaultWidthDoc: 110,
    defaultHeightDoc: 110,
    svgRaw: waterfallSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-ancient-tree',
    categoryId: 'nature',
    tags: ['albero', 'sacro', 'quercia', 'foresta', 'bosco', 'druido', 'mondo', 'natura'],
    name: 'Albero sacro',
    description: 'Quercia millenaria dalle chiome stratificate con radici nodose e lanterna',
    defaultWidthDoc: 114,
    defaultHeightDoc: 114,
    svgRaw: ancientTreeSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-cloud-bank',
    categoryId: 'nature',
    tags: ['nubi', 'nuvole', 'nebbia', 'atlante', 'cornice', 'cielo', 'foschia'],
    name: 'Banco di nubi',
    description: 'Massa nuvolosa pittorica in stile atlante per cornici, passi alpini o mari inesplorati',
    defaultWidthDoc: 170,
    defaultHeightDoc: 170,
    svgRaw: cloudBankSvg
  }),

  // Punti e Riferimenti (5)
  makeBuiltinPoiItem({
    id: 'poi-bridge',
    categoryId: 'landmarks',
    tags: ['ponte', 'arco', 'fiume', 'guado', 'strada', 'passaggio', 'pietra', 'via'],
    name: 'Ponte',
    description: 'Ponte in pietra ad arco su fiume azzurro con piloni e lanterne agli imbocchi',
    defaultWidthDoc: 116,
    defaultHeightDoc: 116,
    svgRaw: bridgeSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-mine',
    categoryId: 'landmarks',
    tags: ['miniera', 'oro', 'carrello', 'binari', 'galleria', 'scavo', 'nani', 'gemma'],
    name: 'Miniera',
    description: 'Galleria montana armata in legno con binari, piccone e carrello colmo d’oro',
    defaultWidthDoc: 108,
    defaultHeightDoc: 108,
    svgRaw: mineSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-camp',
    categoryId: 'landmarks',
    tags: ['accampamento', 'campo', 'tende', 'falò', 'fuoco', 'bivacco', 'esercito', 'viaggio'],
    name: 'Accampamento',
    description: 'Campo di tende e padiglione a strisce attorno al fuoco acceso con stendardo',
    defaultWidthDoc: 108,
    defaultHeightDoc: 108,
    svgRaw: campSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-compass',
    categoryId: 'landmarks',
    tags: ['rosa', 'venti', 'bussola', 'nord', 'orientamento', 'cartografia', 'stella', 'simbolo'],
    name: 'Rosa dei venti',
    description: 'Rosa cartografica a otto punte con anello graduato in ottone e Nord evidenziato',
    defaultWidthDoc: 124,
    defaultHeightDoc: 124,
    svgRaw: compassSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-banner-compass',
    categoryId: 'landmarks',
    tags: ['rosa', 'cartiglio', 'nastro', 'bussola', 'regni del nord', 'atlante', 'orientamento'],
    name: 'Rosa con cartiglio',
    description: 'Grande rosa dei venti antica a 16 punte con cartiglio in pergamena',
    defaultWidthDoc: 170,
    defaultHeightDoc: 170,
    svgRaw: bannerCompassSvg
  }),
  makeBuiltinPoiItem({
    id: 'poi-signpost',
    categoryId: 'landmarks',
    tags: ['cippo', 'crocevia', 'bivio', 'cartello', 'frecce', 'strada', 'incrocio', 'segnaletica'],
    name: 'Cippo / Crocevia',
    description: 'Palo direzionale a tre frecce su bivio sterrato con lanterna e cippo miliare',
    defaultWidthDoc: 86,
    defaultHeightDoc: 86,
    svgRaw: signpostSvg
  })
];

export function getCatalogItemById(id: string): PoiCatalogItem | undefined {
  return BUILTIN_POI_CATALOG.find((item) => item.id === id);
}

export function getBuiltinAssetSvgBytes(assetId: string): Uint8Array | null {
  const item = getCatalogItemById(assetId);
  if (!item) return null;
  return new TextEncoder().encode(item.svgContent);
}

export function svgToDataUrl(svgContent: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
}

function loadImageFromSrc(src: string, assetId: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Impossibile caricare la risorsa "${assetId}".`));
    img.src = src;
  });
}

export async function loadAssetsForDocument(
  doc: MapDocument,
  extraAssetBlobs?: Map<string, Blob>
): Promise<LoadedAssetMap> {
  const result: LoadedAssetMap = new Map();
  const entriesById = new Map<string, AssetManifestEntry>();

  for (const item of BUILTIN_POI_CATALOG) {
    entriesById.set(item.asset.id, item.asset);
  }
  for (const entry of doc.manifest.assets) {
    entriesById.set(entry.id, entry);
  }

  const neededAssetIds = new Set<string>();
  for (const entry of doc.manifest.assets) neededAssetIds.add(entry.id);
  for (const obj of doc.manifest.objects) {
    if (obj.type === 'stamp') neededAssetIds.add(obj.assetId);
  }

  try {
    for (const assetId of neededAssetIds) {
      const entry = entriesById.get(assetId);
      if (!entry) {
        throw new Error(`Risorsa "${assetId}" non trovata nel manifest né nel catalogo.`);
      }
      const blob = extraAssetBlobs?.get(entry.path) ?? extraAssetBlobs?.get(assetId);
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        try {
          const image = await loadImageFromSrc(objectUrl, assetId);
          const resource: LoadedAssetResource = { entry, image, objectUrl };
          result.set(assetId, resource);
          continue;
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          throw err;
        }
      }

      const catalogItem = getCatalogItemById(assetId);
      if (catalogItem) {
        const image = await loadImageFromSrc(svgToDataUrl(catalogItem.svgContent), assetId);
        result.set(assetId, { entry, image });
        continue;
      }

      throw new Error(`File risorsa "${entry.path}" (${assetId}) mancante.`);
    }
  } catch (err) {
    disposeLoadedAssets(result);
    throw err;
  }

  return result;
}

export function disposeLoadedAssets(assets: LoadedAssetMap): void {
  for (const res of assets.values()) {
    if (res.objectUrl) {
      URL.revokeObjectURL(res.objectUrl);
    }
  }
}
