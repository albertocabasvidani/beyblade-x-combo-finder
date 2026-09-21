/**
 * test-amazon.ts — golden test dei link affiliati (src/lib/amazon.ts) e della scelta del marketplace
 * (src/lib/marketplace.ts). Esegui: npm run test:amazon (esce 1 se un controllo fallisce).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildPartLookup, buildAmazonUrl, KEEP_STORE_PARAM, type AmazonConfigFile, type AsinIndex } from '../src/lib/amazon';
import { marketFromLanguages, marketFromCountry, resolveMarket } from '../src/lib/marketplace';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  OK ${name}`);
  else { console.error(`  KO ${name} ${extra}`); failed++; }
}

const ROOT = join(import.meta.dirname, '..');
const products = JSON.parse(readFileSync(join(ROOT, 'data', 'products.json'), 'utf8'));
const lookup = buildPartLookup(products);

const config: AmazonConfigFile = {
  defaultMarketplace: 'uk',
  marketplaces: {
    it: { tld: 'amazon.it', tag: 'sito-it-21' },
    de: { tld: 'amazon.de', tag: 'sito-de-21' },
    uk: { tld: 'amazon.co.uk', tag: 'sito-uk-21' },
  },
};
const asins: AsinIndex = { 'BX-01': { it: 'B0TEST00001' } };

console.log('Lookup parte → codice set');
for (const [k, id] of [['bit', 'accel'], ['ratchet', '1-80'], ['ratchet', '4-50'], ['ratchet', '0-70']]) {
  const code = lookup[k][id];
  check(`${k} ${id} → codice Takara Tomy (${code})`, /^(BX|UX|CX)-\d+$/.test(code ?? ''), `=${code}`);
}
check('blade dran-sword → BX-01', lookup.blade['dran-sword'] === 'BX-01', `=${lookup.blade['dran-sword']}`);
check('ratchet 3-60 → BX-01 (regolare, non -00)', lookup.ratchet['3-60'] === 'BX-01', `=${lookup.ratchet['3-60']}`);
check('categorie CX presenti nel lookup', Object.keys(lookup.lockChip).length > 0 && Object.keys(lookup.mainBlade).length > 0 && Object.keys(lookup.assistBlade).length > 0);

console.log('Link');
const dp = buildAmazonUrl('blade', 'dran-sword', 'Dran Sword', lookup, asins, 'it', config);
check('ASIN noto → /dp/ con tag', dp.kind === 'dp' && dp.href === 'https://www.amazon.it/dp/B0TEST00001?tag=sito-it-21', dp.href);
const de = buildAmazonUrl('blade', 'dran-sword', 'Dran Sword', lookup, asins, 'de', config);
check('ASIN assente su quel mercato → ricerca per nome con tag', de.kind === 'search' && de.href === 'https://www.amazon.de/s?k=Beyblade%20X%20Dran%20Sword&tag=sito-de-21', de.href);
const bit = buildAmazonUrl('bit', 'flat', 'Flat', lookup, {}, 'de', config);
check('bit → ricerca per codice set', bit.kind === 'search' && /s\?k=Beyblade%20X%20(BX|UX|CX)-\d+&tag=sito-de-21$/.test(bit.href), bit.href);
const ratchet = buildAmazonUrl('ratchet', '3-60', '3-60', lookup, {}, 'it', config);
check('ratchet → ricerca per codice set BX-01', ratchet.href === 'https://www.amazon.it/s?k=Beyblade%20X%20BX-01&tag=sito-it-21', ratchet.href);
const unknown = buildAmazonUrl('blade', 'dran-sword', 'Dran Sword', lookup, asins, 'xx', config);
check('mercato sconosciuto → default, con tag', unknown.href === 'https://www.amazon.co.uk/s?k=Beyblade%20X%20Dran%20Sword&tag=sito-uk-21', unknown.href);

// Un tag vuoto deve rompere, non produrre un link non tracciato: e' la contestazione del 19/09/2026.
const senzaTag: AmazonConfigFile = { defaultMarketplace: 'com', marketplaces: { com: { tld: 'amazon.com', tag: '' } } };
let ha_sollevato = false;
try { buildAmazonUrl('blade', 'dran-sword', 'Dran Sword', lookup, asins, 'com', senzaTag); }
catch { ha_sollevato = true; }
check('marketplace con tag vuoto → solleva invece di emettere il link', ha_sollevato);
const noCode = buildAmazonUrl('bit', 'bit-inesistente', 'Bit Inesistente', lookup, {}, 'it', config);
check('bit senza codice → ricerca per nome', noCode.href.includes('Beyblade%20X%20Bit%20Inesistente'), noCode.href);

console.log('Marketplace dalle lingue del browser');
const avail = ['it', 'de', 'fr', 'es', 'uk', 'jp'];
const FB = 'uk';
check("['it-IT','en'] → it", marketFromLanguages(['it-IT', 'en'], avail, FB) === 'it');
check("['en-GB'] → uk", marketFromLanguages(['en-GB'], avail, FB) === 'uk');
check("['fr-BE'] → fr", marketFromLanguages(['fr-BE'], avail, FB) === 'fr');
check("['de-AT'] → de", marketFromLanguages(['de-AT'], avail, FB) === 'de');
check("['es-ES'] → es", marketFromLanguages(['es-ES'], avail, FB) === 'es');
check("['ja'] → jp", marketFromLanguages(['ja'], avail, FB) === 'jp');
// Il caso del revisore Amazon: browser in inglese americano. Deve atterrare su un mercato TAGGATO.
check("['en-US'] → fallback taggato", marketFromLanguages(['en-US'], avail, FB) === 'uk');
check("['pt-BR'] → fallback taggato", marketFromLanguages(['pt-BR'], avail, FB) === 'uk');
check('[] → fallback taggato', marketFromLanguages([], avail, FB) === 'uk');
check('undefined → fallback taggato', marketFromLanguages(undefined, avail, FB) === 'uk');
check('mercato non disponibile → uno dei disponibili', marketFromLanguages(['it-IT'], ['de'], FB) === 'de');

console.log('Negozio dal paese del visitatore');
check("IT → it", marketFromCountry('IT', avail) === 'it');
check("FR → fr", marketFromCountry('FR', avail) === 'fr');
check("AT → de (compra su amazon.de)", marketFromCountry('AT', avail) === 'de');
check("BE → fr", marketFromCountry('BE', avail) === 'fr');
check("PT → es", marketFromCountry('PT', avail) === 'es');
check("IE → uk", marketFromCountry('IE', avail) === 'uk');
check("minuscolo e spazi → it", marketFromCountry(' it ', avail) === 'it');
check('paese senza regola (BR) → null', marketFromCountry('BR', avail) === null);
check('paese nullo → null', marketFromCountry(null, avail) === null);
check('mercato non configurato → null', marketFromCountry('JP', ['it', 'de']) === null);

console.log('Precedenza: paese, poi lingua, poi default');
// `localStorage` non esiste in Node, quindi qui non c'e' mai una scelta salvata: e' il caso del
// visitatore che arriva per la prima volta, cioe' quello che vede il revisore Amazon.
const geoFR = await resolveMarket(avail, FB, async () => 'FR');
check('paese FR → fr, source geo', geoFR.market === 'fr' && geoFR.source === 'geo', JSON.stringify(geoFR));
const geoAT = await resolveMarket(avail, FB, async () => 'AT');
check('paese AT → de, source geo', geoAT.market === 'de' && geoAT.source === 'geo', JSON.stringify(geoAT));
// Senza paese si scende alla lingua del browser. Node 22 espone `navigator.languages` (qui it-IT),
// quindi l'atteso si calcola invece di scriverlo: su un'altra macchina sarebbe un altro mercato.
const attesoDaLingua = marketFromLanguages((globalThis.navigator as any)?.languages, avail, FB);
const geoNull = await resolveMarket(avail, FB, async () => null);
check('paese non rilevato → scende alla lingua del browser', geoNull.market === attesoDaLingua, JSON.stringify(geoNull));
const geoIgnoto = await resolveMarket(avail, FB, async () => 'BR');
check('paese senza regola → scende alla lingua del browser', geoIgnoto.market === attesoDaLingua, JSON.stringify(geoIgnoto));

// Il caso del revisore Amazon: browser in inglese americano e nessun paese rilevabile. Deve
// atterrare su un mercato TAGGATO, mai su un link senza tracking ID.
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en-US'] }, configurable: true });
const revisore = await resolveMarket(avail, FB, async () => null);
check('en-US senza paese → fallback taggato, source default',
  revisore.market === FB && revisore.source === 'default', JSON.stringify(revisore));
const revisoreInFrancia = await resolveMarket(avail, FB, async () => 'FR');
check('en-US ma indirizzo francese → fr (il paese batte la lingua)',
  revisoreInFrancia.market === 'fr' && revisoreInFrancia.source === 'geo', JSON.stringify(revisoreInFrancia));

console.log('La scelta manuale blocca il redirect di Amazon');
const scelto = buildAmazonUrl('blade', 'dran-sword', 'Dran Sword', lookup, asins, 'it', config, true);
check('scelta manuale → link con tag e con il parametro anti-redirect',
  scelto.href === `https://www.amazon.it/dp/B0TEST00001?tag=sito-it-21&${KEEP_STORE_PARAM}`, scelto.href);
const rilevato = buildAmazonUrl('blade', 'dran-sword', 'Dran Sword', lookup, asins, 'it', config);
check('negozio rilevato dal sito → nessun parametro anti-redirect',
  !rilevato.href.includes('creatorsDisableRedirect'), rilevato.href);
const sceltoRicerca = buildAmazonUrl('bit', 'flat', 'Flat', lookup, {}, 'de', config, true);
check('vale anche sui link di ricerca', sceltoRicerca.href.endsWith(`&${KEEP_STORE_PARAM}`)
  && new URL(sceltoRicerca.href).searchParams.get('tag') === 'sito-de-21', sceltoRicerca.href);

console.log('Config reale (data/amazon-config.json)');
const reale: AmazonConfigFile = JSON.parse(readFileSync(join(ROOT, 'data', 'amazon-config.json'), 'utf8'));
const senza = Object.entries(reale.marketplaces).filter(([, m]) => !m.tag).map(([k]) => k);
check('ogni marketplace configurato ha un tracking ID', senza.length === 0, `senza tag: ${senza.join(', ')}`);
check('defaultMarketplace esiste ed e\' taggato', !!reale.marketplaces[reale.defaultMarketplace]?.tag, reale.defaultMarketplace);
for (const [k, m] of Object.entries(reale.marketplaces)) {
  const u = buildAmazonUrl('blade', 'dran-sword', 'Dran Sword', lookup, {}, k, reale);
  check(`link su ${k} con tag=`, new URL(u.href).searchParams.get('tag') === m.tag, u.href);
}

console.log(failed === 0 ? '\nTutti i test passati.' : `\n${failed} test FALLITI.`);
process.exit(failed === 0 ? 0 : 1);
