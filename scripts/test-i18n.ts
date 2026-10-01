/**
 * test-i18n.ts — le lingue del sito restano allineate (npm run test:i18n, esce 1 se qualcosa manca).
 *
 * Controlla che:
 *  1. ogni file in src/i18n/ abbia esattamente le chiavi di en.json (l'italiano è dormiente ma deve
 *     restare completo, per poterlo riattivare senza buchi);
 *  2. nessun valore sia vuoto;
 *  3. ogni chiave letterale usata nei sorgenti (`t('…')`, `t(locale, '…')`, `labelKey: '…'`) esista;
 *  4. le famiglie di chiavi costruite a runtime (periodi, ordinamento, vista, suggerimenti) esistano
 *     per ogni valore che il codice può produrre.
 * Non giudica le traduzioni: una frase riscritta in una sola lingua passa (vedi la regola sulle chiavi
 * riscritte: si cercano con grep e si riscrivono in tutte le lingue nello stesso giro).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { WINDOW_KEYS } from '../src/lib/scoring';
import { SORT_KEYS } from '../src/lib/search-engine';

const ROOT = join(import.meta.dirname, '..');
const I18N = join(ROOT, 'src', 'i18n');
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name} ${extra}`); failed++; }
}

const langs = readdirSync(I18N).filter((f) => f.endsWith('.json'));
const dict: Record<string, Record<string, string>> = {};
for (const f of langs) dict[f.replace('.json', '')] = JSON.parse(readFileSync(join(I18N, f), 'utf8'));
const en = dict.en;
const keys = Object.keys(en);

console.log(`lingue: ${Object.keys(dict).join(', ')} (${keys.length} chiavi in en)`);
for (const [lang, d] of Object.entries(dict)) {
  const missing = keys.filter((k) => !(k in d));
  const extra = Object.keys(d).filter((k) => !(k in en));
  const empty = Object.entries(d).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k);
  check(`${lang}: stesse chiavi di en`, missing.length === 0 && extra.length === 0, `mancano ${missing.join(', ') || '-'} · in più ${extra.join(', ') || '-'}`);
  check(`${lang}: nessun valore vuoto`, empty.length === 0, empty.join(', '));
}

// Chiavi letterali nei sorgenti.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|astro)$/.test(f) ? [p] : [];
  });
}
const used = new Map<string, string>();
const patterns = [/\bt\(\s*'([a-zA-Z][\w.]*)'/g, /\bt\(\s*locale\s*,\s*'([a-zA-Z][\w.]*)'/g, /labelKey:\s*'([a-zA-Z][\w.]*)'/g];
for (const file of walk(join(ROOT, 'src'))) {
  const src = readFileSync(file, 'utf8');
  for (const re of patterns) for (const m of src.matchAll(re)) used.set(m[1], file.slice(ROOT.length + 1));
}
const unknown = [...used].filter(([k]) => !(k in en));
check(`${used.size} chiavi letterali nei sorgenti, tutte presenti in en`, unknown.length === 0, unknown.map(([k, f]) => `${k} (${f})`).join(', '));

// Famiglie costruite a runtime in combo-search.tsx.
const VIEWS = ['combos', 'blades'];
const dynamic = [
  ...WINDOW_KEYS.flatMap((w) => [`period.${w}`, `period.span.${w}`]),
  ...SORT_KEYS.map((k) => `sort.${k}`),
  ...VIEWS.map((v) => `view.${v}`),
  ...VIEWS.flatMap((v) => SORT_KEYS.map((k) => `hint.${v}.${k}`)),
  'stadium.xtreme', 'stadium.infinity',
];
const missingDyn = dynamic.filter((k) => !(k in en));
check(`${dynamic.length} chiavi costruite a runtime presenti`, missingDyn.length === 0, missingDyn.join(', '));
const noPlaceholder = VIEWS.flatMap((v) => SORT_KEYS.map((k) => `hint.${v}.${k}`))
  .flatMap((k) => Object.entries(dict).filter(([, d]) => !d[k]?.includes('{period}')).map(([l]) => `${l}:${k}`));
check('ogni suggerimento del ranking contiene {period}', noPlaceholder.length === 0, noPlaceholder.join(', '));

console.log(failed === 0 ? '\nTutti i test passati.' : `\n${failed} test FALLITI.`);
process.exit(failed === 0 ? 0 : 1);
