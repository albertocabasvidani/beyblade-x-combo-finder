/**
 * verify-parts-preserved.ts — Rete di sicurezza contro le REGRESSIONI del registro parti.
 *
 * Confronta gli id per categoria di data/parts.json e data/parts-master.json con quelli
 * dell'ultimo commit (git HEAD): se una parte c'era e non c'e' piu', esce 1 e /update-parts
 * abortisce senza committare.
 *
 * Perche' non basta il guardrail di build-parts.ts: quello controlla solo che nessuna parte
 * REFERENZIATA da combos.json sparisca. Le ~200 parti che nessuna combo cita oggi (bit rari,
 * ratchet appena usciti, parti CX di nicchia) potrebbero svanire senza che niente protesti.
 * merge-master non cancella mai, ma /update-parts modifica anche il master a mano — il
 * 14/08/2026 ha riscritto tre nomi direttamente — e una modifica a mano puo' sbagliare.
 *
 * Uso:  npx tsx scripts/verify-parts-preserved.ts
 *       --allow-removed id1,id2   rimozioni volute (senza, la pipeline resterebbe bloccata)
 *       --current <path>          confronta HEAD con un file arbitrario invece del working tree
 *                                 (usato dalla suite di test, che non tocca data/)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ROOT = join(import.meta.dirname, '..');
const CATS = ['blades', 'lockChips', 'mainBlades', 'assistBlades', 'overBlades', 'ratchets', 'bits'] as const;

const argOpt = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const allowRemoved = new Set<string>(
  String(argOpt('--allow-removed', '')).split(',').map((s: string) => s.trim()).filter(Boolean)
);
const currentOverride = argOpt('--current', '');

function fromHead(relPath: string): any | null {
  try {
    const out = execFileSync('git', ['show', `HEAD:${relPath}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(out);
  } catch {
    // File non ancora in HEAD (prima introduzione): niente da preservare.
    return null;
  }
}

function ids(doc: any): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const c of CATS) m.set(c, new Set((doc?.[c] ?? []).map((e: any) => e?.id).filter(Boolean)));
  return m;
}

let perse = 0;

function confronta(etichetta: string, relPath: string, currentPath: string): void {
  const prima = fromHead(relPath);
  if (!prima) { console.log(`${etichetta}: non presente in HEAD, salto.`); return; }
  const dopo = JSON.parse(readFileSync(currentPath, 'utf8'));
  const a = ids(prima), b = ids(dopo);
  let totPrima = 0, totDopo = 0;

  for (const c of CATS) {
    const setA = a.get(c)!, setB = b.get(c)!;
    totPrima += setA.size; totDopo += setB.size;
    const mancanti = [...setA].filter((id) => !setB.has(id) && !allowRemoved.has(id));
    if (mancanti.length) {
      perse += mancanti.length;
      console.error(`  ${etichetta} / ${c}: ${mancanti.length} PERSE -> ${mancanti.join(', ')}`);
    }
  }
  console.log(`${etichetta}: ${totPrima} id in HEAD, ${totDopo} adesso.`);
}

confronta('parts.json', 'data/parts.json', currentOverride || join(ROOT, 'data', 'parts.json'));
if (!currentOverride) confronta('parts-master.json', 'data/parts-master.json', join(ROOT, 'data', 'parts-master.json'));

if (perse > 0) {
  console.error(`\nREGRESSIONE: ${perse} parti presenti in HEAD sono sparite. Nessun commit.`);
  console.error("Se la rimozione e' voluta: --allow-removed <id,id>");
  process.exit(1);
}
console.log('\nNessuna parte persa rispetto a HEAD.');
