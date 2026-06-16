/**
 * reddit-merge.ts — Merge deterministico dei combo estratti da /mine-reddit in data/combos.json.
 *
 * L'IA (in /mine-reddit) legge i post e produce `tmp/reddit-extracted.json`: un array di combo già
 * RISOLTI a id del master (blade/lockChip/mainBlade/assistBlade/overBlade/ratchet/bit) con il loro
 * blocco `evidence` (placements/usage/mentions) già classificato. Questo script fa SOLO ciò che è
 * deterministico: deriva id canonico / line / type / displayName da parts.json, valida i riferimenti
 * (X-filter: blade o mainBlade deve esistere), e fa il MERGE con dedup nell'evidence dei combo esistenti
 * (oppure crea il combo). Lo score NON si tocca qui: lo ricalcola `score:combos` dall'evidence.
 *
 * Idempotente: la dedup dell'evidence è per chiave stabile, quindi ri-mergere lo stesso blocco non
 * duplica nulla.
 *
 * Uso: npx tsx scripts/reddit-merge.ts            (legge tmp/reddit-extracted.json)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const COMBOS = join(ROOT, 'data', 'combos.json');
const PARTS = join(ROOT, 'data', 'parts.json');
const EXTRACTED = join(ROOT, 'tmp', 'reddit-extracted.json');

const today = () => new Date().toISOString().slice(0, 10);

const parts = JSON.parse(readFileSync(PARTS, 'utf-8'));
const byId = (arr: any[]) => new Map((arr ?? []).map((p: any) => [p.id, p]));
const blades = byId(parts.blades);
const lockChips = byId(parts.lockChips);
const mainBlades = byId(parts.mainBlades);
const assistBlades = byId(parts.assistBlades);
const overBlades = byId(parts.overBlades);
const bits = byId(parts.bits);
const ratchets = byId(parts.ratchets);

function bitName(id: string): string {
  return bits.get(id)?.name ?? id;
}

function comboKey(c: any): string {
  if (c.lockChip || c.mainBlade) {
    return [c.lockChip, c.overBlade ?? null, c.mainBlade, c.assistBlade, c.ratchet, c.bit].join('|');
  }
  return ['bx', c.blade, c.ratchet, c.bit].join('|');
}

function buildId(c: any): string {
  if (c.lockChip || c.mainBlade) {
    const segs = [c.lockChip, c.overBlade, c.mainBlade, c.assistBlade, c.ratchet, c.bit].filter(Boolean);
    return segs.join('-');
  }
  return [c.blade, c.ratchet, c.bit].join('-');
}

function buildDisplayName(c: any): string {
  if (c.lockChip || c.mainBlade) {
    const lc = lockChips.get(c.lockChip)?.name ?? c.lockChip;
    const ob = c.overBlade ? (overBlades.get(c.overBlade)?.name ?? c.overBlade) + ' ' : '';
    const mb = mainBlades.get(c.mainBlade)?.name ?? c.mainBlade;
    const ab = assistBlades.get(c.assistBlade)?.shortName ?? assistBlades.get(c.assistBlade)?.name ?? c.assistBlade;
    return `${lc} ${ob}${mb} ${ab} ${c.ratchet} ${bitName(c.bit)}`.replace(/\s+/g, ' ').trim();
  }
  const b = blades.get(c.blade)?.name ?? c.blade;
  return `${b} ${c.ratchet} ${bitName(c.bit)}`;
}

function deriveLine(c: any): string {
  if (c.overBlade) return 'cx';
  if (c.lockChip || c.mainBlade) return 'cx';
  return blades.get(c.blade)?.line ?? 'bx';
}

function deriveType(c: any): string {
  if (c.lockChip || c.mainBlade) return mainBlades.get(c.mainBlade)?.type ?? 'balance';
  return blades.get(c.blade)?.type ?? 'balance';
}

// ---- guardrail anti-allucinazione IA ----
// I placement estratti da Reddit (fonte narrativa) NON possono spacciarsi per dati torneo
// strutturati: forziamo tier='narrative' (mai 'tournament-proven', che richiede tier 'structured')
// e validiamo lo schema minimo, scartando le entry malformate. La veridicità del testo resta non
// verificabile a codice, ma il tier basso confina l'impatto (niente pilastro performance pieno,
// niente badge tournament-proven).
function sanitizePlacements(places: any[]): any[] {
  const out: any[] = [];
  for (const p of places ?? []) {
    if (!p || typeof p !== 'object') continue;
    if (typeof p.placement !== 'number' || !p.date) {
      console.warn(`SKIP placement Reddit malformato (placement/date mancanti): ${JSON.stringify(p)}`);
      continue;
    }
    out.push({ ...p, tier: 'narrative', source: p.source || 'reddit', lang: p.lang || 'en' });
  }
  return out;
}

// ---- chiavi di dedup per l'evidence ----
const plKey = (p: any) => `${p.source}|${p.eventId ?? p.eventName ?? ''}|${p.date}|${p.placement ?? ''}`;
const usKey = (u: any) => `${u.source}|${u.date}|${u.window ?? ''}`;
const meKey = (m: any) => `${m.source}|${m.kind ?? ''}|${m.url ?? ''}`;

function mergeArray(target: any[], incoming: any[], keyFn: (x: any) => string) {
  const seen = new Set(target.map(keyFn));
  let added = 0;
  for (const item of incoming ?? []) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    target.push(item);
    added++;
  }
  return added;
}

function sourceEntryFor(ev: any): { name: string; url: string; weight: number; date: string } | null {
  // costruisce una voce sources[] da una qualunque entry reddit (per il display del sito)
  const first = (ev.placements?.[0] ?? ev.usage?.[0] ?? ev.mentions?.[0]);
  if (!first) return null;
  return {
    name: 'Reddit r/Beyblade',
    url: first.url ?? 'https://reddit.com/r/Beyblade',
    weight: 0.6,
    date: first.date ?? today(),
  };
}

function main() {
  if (!existsSync(EXTRACTED)) {
    console.error(`Nessun file ${EXTRACTED}. Niente da mergere.`);
    process.exit(0);
  }
  const extracted: any[] = JSON.parse(readFileSync(EXTRACTED, 'utf-8'));
  const db = JSON.parse(readFileSync(COMBOS, 'utf-8'));
  const combos: any[] = db.combos;
  const index = new Map(combos.map((c) => [comboKey(c), c]));

  let created = 0, updated = 0, skipped = 0;
  const newCombos: string[] = [];

  for (const raw of extracted) {
    // X-filter: blade (bx/ux) o mainBlade (cx) deve risolvere a un id del master
    const isCx = !!(raw.lockChip || raw.mainBlade);
    if (isCx) {
      if (!raw.mainBlade || !mainBlades.has(raw.mainBlade)) { console.warn(`SKIP (mainBlade ignota): ${JSON.stringify(raw)}`); skipped++; continue; }
      if (raw.lockChip && !lockChips.has(raw.lockChip)) { console.warn(`SKIP (lockChip ignota): ${raw.lockChip}`); skipped++; continue; }
      if (raw.assistBlade && !assistBlades.has(raw.assistBlade)) { console.warn(`SKIP (assist ignota): ${raw.assistBlade}`); skipped++; continue; }
      if (raw.overBlade && !overBlades.has(raw.overBlade)) { console.warn(`SKIP (overBlade ignota): ${raw.overBlade}`); skipped++; continue; }
    } else {
      if (!raw.blade || !blades.has(raw.blade)) { console.warn(`SKIP (blade ignota): ${raw.blade}`); skipped++; continue; }
    }
    if (!raw.ratchet || !ratchets.has(raw.ratchet)) { console.warn(`SKIP (ratchet ignoto): ${raw.ratchet}`); skipped++; continue; }
    if (!raw.bit || !bits.has(raw.bit)) { console.warn(`SKIP (bit ignoto): ${raw.bit}`); skipped++; continue; }

    const key = comboKey(raw);
    let combo = index.get(key);
    const ev = raw.evidence ?? {};
    ev.placements = sanitizePlacements(ev.placements);   // guardrail: forza tier narrative + valida

    if (!combo) {
      combo = {
        id: buildId(raw),
        line: deriveLine(raw),
        blade: raw.blade ?? null,
        ratchet: raw.ratchet,
        bit: raw.bit,
        lockChip: raw.lockChip ?? null,
        mainBlade: raw.mainBlade ?? null,
        assistBlade: raw.assistBlade ?? null,
        overBlade: raw.overBlade ?? null,
        displayName: buildDisplayName(raw),
        type: deriveType(raw),
        score: 0,
        scoreBreakdown: { performance: 0, presence: 0, corroboration: 0, tournamentEvents: 0, wins: 0, topCutAppearances: 0 },
        tags: [],
        notes: raw.notes ?? 'Combo segnalata su Reddit r/Beyblade.',
        sources: [],
        amazon: {},
        dateAdded: today(),
        dateUpdated: today(),
        evidence: { placements: [], usage: [], mentions: [] },
      };
      if (deriveLine(raw) === 'cx' && !combo.tags.includes('cx')) combo.tags.push('cx');
      combos.push(combo);
      index.set(key, combo);
      created++;
      newCombos.push(combo.displayName);
    } else {
      updated++;
    }

    combo.evidence = combo.evidence ?? { placements: [], usage: [], mentions: [] };
    combo.evidence.placements = combo.evidence.placements ?? [];
    combo.evidence.usage = combo.evidence.usage ?? [];
    combo.evidence.mentions = combo.evidence.mentions ?? [];

    let touched = 0;
    touched += mergeArray(combo.evidence.placements, ev.placements ?? [], plKey);
    touched += mergeArray(combo.evidence.usage, ev.usage ?? [], usKey);
    touched += mergeArray(combo.evidence.mentions, ev.mentions ?? [], meKey);

    // sources[] per il display (dedup per url)
    const se = sourceEntryFor(ev);
    if (se) {
      combo.sources = combo.sources ?? [];
      if (!combo.sources.some((s: any) => s.url === se.url)) combo.sources.push(se);
    }

    if (touched > 0) combo.dateUpdated = today();
  }

  db.lastUpdated = new Date().toISOString();
  writeFileSync(COMBOS, JSON.stringify(db, null, 2));
  console.log(`Merge completato: ${created} nuovi, ${updated} aggiornati, ${skipped} skip. Totale combo: ${combos.length}.`);
  if (newCombos.length) console.log('Nuovi combo:\n  - ' + newCombos.join('\n  - '));
}

main();
