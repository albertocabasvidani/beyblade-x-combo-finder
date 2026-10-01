/**
 * top-cut.ts — Classifiche per presenza nei top cut dei tornei, calcolate dai piazzamenti di combos.json.
 *
 * Unica fonte dei conteggi per due consumatori: la pagina /top-cut/ del sito e i caroselli Instagram
 * (scripts/lib/ig-posts.ts). Così chi arriva da un post trova sul sito gli stessi numeri.
 *
 * Funzioni pure (niente file, niente rete). Tutte le linee contano: BX/UX e CX. Per le classifiche
 * «per lama» la lama di una CX è la Main Blade (è la parte che dà il nome alla combo, come la lama
 * di una BX); gli id delle parti sono univoci fra le categorie di parts.json, quindi lame BX e Main
 * Blade stanno nella stessa classifica senza collisioni.
 */

export interface Placement { date?: string; placement?: number; eventName?: string }
export interface TopCutCombo {
  id: string;
  line: string;
  blade: string | null;
  ratchet: string | null;
  bit: string;
  lockChip?: string | null;
  mainBlade?: string | null;
  assistBlade?: string | null;
  overBlade?: string | null;
  displayName: string;
  type?: string;
  evidence?: { placements?: Placement[] };
}

export interface ComboStat<C extends TopCutCombo = TopCutCombo> { combo: C; topCut: number; wins: number; events: number }
export interface BladeStat<C extends TopCutCombo = TopCutCombo> { blade: string; line: string; topCut: number; share: number; firstSeen: string; combos: ComboStat<C>[] }
export interface PartStat { part: string; topCut: number; wins: number; share: number }

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export function daysBefore(ref: Date, n: number): string {
  const x = new Date(ref); x.setUTCDate(x.getUTCDate() - n); return isoDate(x);
}

/** La «lama» di una combo: la Blade per BX/UX, la Main Blade per CX. Null se manca (combo incompleta). */
export const bladeOf = (c: TopCutCombo): string | null => (c.line === 'cx' ? c.mainBlade ?? null : c.blade);

/** Combo che possono stare in classifica: con una lama riconoscibile. */
const ranked = <C extends TopCutCombo>(db: C[]) => db.filter((c) => bladeOf(c));
const inWindow = (p: Placement, from: string, to: string) => !!p.date && p.date >= from && p.date <= to;

/** Statistiche per combo su una finestra [from, to] inclusa (date ISO). */
export function comboStats<C extends TopCutCombo>(db: C[], from: string, to: string): ComboStat<C>[] {
  const out: ComboStat<C>[] = [];
  for (const c of ranked(db)) {
    let topCut = 0, wins = 0; const ev = new Set<string>();
    for (const p of c.evidence?.placements ?? []) {
      if (!inWindow(p, from, to)) continue;
      topCut++;
      if (p.placement === 1) wins++;
      ev.add(`${p.eventName ?? ''}|${p.date}`);
    }
    if (topCut) out.push({ combo: c, topCut, wins, events: ev.size });
  }
  return out.sort((a, b) => b.topCut - a.topCut || b.wins - a.wins || a.combo.displayName.localeCompare(b.combo.displayName));
}

/** Statistiche per lama sulla stessa finestra: top cut, quota sul totale, prima evidenza assoluta, combo ordinate. */
export function bladeStats<C extends TopCutCombo>(db: C[], from: string, to: string): BladeStat<C>[] {
  const stats = comboStats(db, from, to);
  const total = stats.reduce((a, s) => a + s.topCut, 0) || 1;
  const first: Record<string, string> = {};
  for (const c of ranked(db)) {
    const b = bladeOf(c)!;
    for (const p of c.evidence?.placements ?? []) if (p.date && (!first[b] || p.date < first[b])) first[b] = p.date;
  }
  const by: Record<string, BladeStat<C>> = {};
  for (const s of stats) {
    const k = bladeOf(s.combo)!;
    const b = (by[k] = by[k] || { blade: k, line: s.combo.line === 'cx' ? 'cx' : 'bx', topCut: 0, share: 0, firstSeen: first[k] ?? '', combos: [] });
    b.topCut += s.topCut; b.combos.push(s);
  }
  return Object.values(by).map((b) => ({ ...b, share: b.topCut / total })).sort((a, b) => b.topCut - a.topCut || a.blade.localeCompare(b.blade));
}

/** Statistiche per ratchet o bit: una combo col ratchet integrato nella lama non conta per i ratchet. */
export function partStats(db: TopCutCombo[], category: 'ratchet' | 'bit', from: string, to: string): PartStat[] {
  const stats = comboStats(db, from, to);
  const by: Record<string, PartStat> = {};
  let total = 0;
  for (const s of stats) {
    const id = s.combo[category];
    if (!id) continue;
    const p = (by[id] = by[id] || { part: id, topCut: 0, wins: 0, share: 0 });
    p.topCut += s.topCut; p.wins += s.wins; total += s.topCut;
  }
  return Object.values(by).map((p) => ({ ...p, share: p.topCut / (total || 1) })).sort((a, b) => b.topCut - a.topCut || a.part.localeCompare(b.part));
}

/** Tornei distinti (evento+data) con almeno un piazzamento nella finestra. */
export function tournamentCount(db: TopCutCombo[], from: string, to: string): number {
  const ev = new Set<string>();
  for (const c of ranked(db)) for (const p of c.evidence?.placements ?? []) {
    if (inWindow(p, from, to)) ev.add(`${p.eventName ?? ''}|${p.date}`);
  }
  return ev.size;
}

/** Piazzamenti datati di una lama, senza limite di finestra. */
export function bladeTotal(db: TopCutCombo[], blade: string): number {
  let n = 0;
  for (const c of ranked(db)) if (bladeOf(c) === blade) n += (c.evidence?.placements ?? []).filter((p) => p.date).length;
  return n;
}
