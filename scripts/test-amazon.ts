/**
 * test-amazon.ts — golden test dei link affiliati (src/lib/amazon.ts) e della scelta del marketplace
 * (src/lib/marketplace.ts). Esegui: npm run test:amazon (esce 1 se un controllo fallisce).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildPartLookup, buildAmazonUrl, type AmazonConfigFile, type AsinIndex } from '../src/lib/amazon';
import { marketFromLanguages } from '../src/lib/marketplace';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  OK ${name}`);
  else { console.error(`  KO ${name} ${extra}`); failed++; }
}

const ROOT = join(import.meta.dirname, '..');
const products = JSON.parse(readFileSync(join(ROOT, 'data', 'products.json'), 'utf8'));
const lookup = buildPartLookup(products);

const config: AmazonConfigFile = {
  defaultMarketplace: 'com',
  marketplaces: {
    it: { tld: 'amazon.it', tag: 'sito-it-21' },
    de: { tld: 'amazon.de', tag: 'sito-de-21' },
    com: { tld: 'amazon.com', tag: '' },
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
const com = buildAmazonUrl('blade', 'dran-sword', 'Dran Sword', lookup, asins, 'com', config);
check('amazon.com senza tag', com.href === 'https://www.amazon.com/s?k=Beyblade%20X%20Dran%20Sword', com.href);
const unknown = buildAmazonUrl('blade', 'dran-sword', 'Dran Sword', lookup, asins, 'xx', config);
check('mercato sconosciuto → default (com)', unknown.href.startsWith('https://www.amazon.com/'), unknown.href);
const noCode = buildAmazonUrl('bit', 'bit-inesistente', 'Bit Inesistente', lookup, {}, 'it', config);
check('bit senza codice → ricerca per nome', noCode.href.includes('Beyblade%20X%20Bit%20Inesistente'), noCode.href);

console.log('Marketplace dalle lingue del browser');
const avail = ['it', 'de', 'fr', 'es', 'uk', 'jp', 'com'];
check("['it-IT','en'] → it", marketFromLanguages(['it-IT', 'en'], avail) === 'it');
check("['en-US'] → com", marketFromLanguages(['en-US'], avail) === 'com');
check("['en-GB'] → uk", marketFromLanguages(['en-GB'], avail) === 'uk');
check("['fr-BE'] → fr", marketFromLanguages(['fr-BE'], avail) === 'fr');
check("['de-AT'] → de", marketFromLanguages(['de-AT'], avail) === 'de');
check("['ja'] → jp", marketFromLanguages(['ja'], avail) === 'jp');
check("['pt-BR'] → com", marketFromLanguages(['pt-BR'], avail) === 'com');
check('[] → com', marketFromLanguages([], avail) === 'com');
check('undefined → com', marketFromLanguages(undefined, avail) === 'com');
check('mercato non disponibile → com', marketFromLanguages(['it-IT'], ['com']) === 'com');

console.log(failed === 0 ? '\nTutti i test passati.' : `\n${failed} test FALLITI.`);
process.exit(failed === 0 ? 0 : 1);
