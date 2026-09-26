/**
 * ig-posts.ts — Candidati per i caroselli Instagram, calcolati dai piazzamenti di combos.json.
 *
 * Funzioni pure (niente file, niente rete): ricevono il db, il registro parti e la data di
 * riferimento, restituiscono strutture dati. Le regole sono quelle di docs/ig-caroselli.md:
 *  - `top-build`  (settimanale, lunedì): top 5 combo per top cut negli ultimi 30 giorni;
 *  - `top-lame`   (settimanale, giovedì): top 5 lame per top cut negli ultimi 30 giorni, con quota;
 *  - `build-lama-nuova` (evento): lama con primo risultato torneo da < NEW_BLADE_DAYS giorni che ha
 *    raggiunto NEW_BLADE_MIN_PLACEMENTS piazzamenti;
 *  - `nuovo-ingresso` (evento): lama in giro da >= NEW_BLADE_DAYS giorni, fuori dalla top 5 (mese e
 *    90 giorni), >= RISING_MIN_RECENT top cut nel mese, crescita >= RISING_MIN_GROWTH sulla media
 *    mensile dei 60 giorni prima;
 *  - `build-lama` (riempitivo): «le build meta per X» per le lame della top 10 a 90 giorni.
 * Chi sceglie cosa pubblicare ogni giorno (Reel o carosello, settimanale o evento) è il pubblicatore
 * nel progetto contenuti: qui si producono solo i candidati, con id stabili.
 * Soglie stimate sui dati di luglio-settembre 2026 (tmp/ig-cadenza.cjs): da rivedere dopo un mese.
 */

export const NEW_BLADE_DAYS = 60;
export const NEW_BLADE_MIN_PLACEMENTS = 40;
export const RISING_MIN_RECENT = 15;
export const RISING_MIN_GROWTH = 2;
export const FILLER_TOP_BLADES = 10;
export const BUILDS_PER_BLADE = 4;

export interface Placement { date?: string; placement?: number; eventName?: string }
export interface Combo {
  id: string; line: string; blade: string; ratchet: string | null; bit: string; displayName: string; type?: string;
  evidence?: { placements?: Placement[] };
}
export interface Part { id: string; name: string; image?: string; releaseSet?: string }
export interface Registry { blades: Part[]; ratchets: Part[]; bits: Part[] }

export interface ComboStat { combo: Combo; topCut: number; wins: number; events: number }
export interface BladeStat { blade: string; topCut: number; share: number; firstSeen: string; combos: ComboStat[] }

export interface PostCandidate {
  id: string;
  type: 'top-build' | 'top-lame' | 'build-lama-nuova' | 'nuovo-ingresso' | 'build-lama';
  week?: string;           // settimana ISO per i settimanali (2026-W40)
  blade?: string;          // id lama per i post su una lama
  priority: number;        // ordine fra gli eventi: più basso = prima
  data: Record<string, unknown>;
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export function daysBefore(ref: Date, n: number): string {
  const x = new Date(ref); x.setUTCDate(x.getUTCDate() - n); return isoDate(x);
}
/** Settimana ISO 8601 (lunedì-domenica) nel formato 2026-W40. */
export function isoWeek(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y = x.getUTCFullYear();
  const wk = Math.ceil(((x.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}

const bxOnly = (db: Combo[]) => db.filter((c) => c.line !== 'cx' && c.blade);

/** Statistiche per combo su una finestra [from, to] inclusa (date ISO). */
export function comboStats(db: Combo[], from: string, to: string): ComboStat[] {
  const out: ComboStat[] = [];
  for (const c of bxOnly(db)) {
    let topCut = 0, wins = 0; const ev = new Set<string>();
    for (const p of c.evidence?.placements ?? []) {
      if (!p.date || p.date < from || p.date > to) continue;
      topCut++;
      if (p.placement === 1) wins++;
      ev.add(`${p.eventName ?? ''}|${p.date}`);
    }
    if (topCut) out.push({ combo: c, topCut, wins, events: ev.size });
  }
  return out.sort((a, b) => b.topCut - a.topCut || b.wins - a.wins || a.combo.displayName.localeCompare(b.combo.displayName));
}

/** Statistiche per lama sulla stessa finestra: top cut, quota sul totale, prima evidenza assoluta, combo ordinate. */
export function bladeStats(db: Combo[], from: string, to: string): BladeStat[] {
  const stats = comboStats(db, from, to);
  const total = stats.reduce((a, s) => a + s.topCut, 0) || 1;
  const first: Record<string, string> = {};
  for (const c of bxOnly(db)) for (const p of c.evidence?.placements ?? []) {
    if (p.date && (!first[c.blade] || p.date < first[c.blade])) first[c.blade] = p.date;
  }
  const by: Record<string, BladeStat> = {};
  for (const s of stats) {
    const b = (by[s.combo.blade] = by[s.combo.blade] || { blade: s.combo.blade, topCut: 0, share: 0, firstSeen: first[s.combo.blade] ?? '', combos: [] });
    b.topCut += s.topCut; b.combos.push(s);
  }
  return Object.values(by).map((b) => ({ ...b, share: b.topCut / total })).sort((a, b) => b.topCut - a.topCut || a.blade.localeCompare(b.blade));
}

/** Tornei distinti (evento+data) con almeno un piazzamento nella finestra. */
export function tournamentCount(db: Combo[], from: string, to: string): number {
  const ev = new Set<string>();
  for (const c of bxOnly(db)) for (const p of c.evidence?.placements ?? []) {
    if (p.date && p.date >= from && p.date <= to) ev.add(`${p.eventName ?? ''}|${p.date}`);
  }
  return ev.size;
}

/** Piazzamenti totali di una lama, senza limite di finestra (serve alla soglia della lama nuova). */
function bladeTotal(db: Combo[], blade: string): number {
  let n = 0;
  for (const c of bxOnly(db)) if (c.blade === blade) n += (c.evidence?.placements ?? []).filter((p) => p.date).length;
  return n;
}

/** Tutti i candidati per la data di riferimento (di norma oggi, all'ora del giro notturno). */
export function computeCandidates(db: Combo[], ref: Date): PostCandidate[] {
  const today = isoDate(ref);
  const d30 = daysBefore(ref, 30), d90 = daysBefore(ref, 90);
  const month = bladeStats(db, d30, today);
  const quarter = bladeStats(db, d90, today);
  const combosMonth = comboStats(db, d30, today);
  // Settimana del post = settimana ISO di DOMANI: il top-build del lunedì può uscire già la domenica
  // (finestra ±1 giorno), e la domenica appartiene ancora alla settimana prima. Con «domani» il post
  // generato la notte fra sabato e domenica porta già l'id della settimana del lunedì.
  const week = isoWeek(new Date(ref.getTime() + 86400000));
  const out: PostCandidate[] = [];

  out.push({ id: `top-build-${week}`, type: 'top-build', week, priority: 0, data: {
    tournaments: tournamentCount(db, d30, today), from: d30, to: today,
    combos: combosMonth.slice(0, 5).map((s) => ({ id: s.combo.id, name: s.combo.displayName, blade: s.combo.blade, ratchet: s.combo.ratchet, bit: s.combo.bit, type: s.combo.type ?? '', topCut: s.topCut, wins: s.wins, events: s.events })),
  } });
  out.push({ id: `top-lame-${week}`, type: 'top-lame', week, priority: 0, data: {
    tournaments: tournamentCount(db, d30, today), from: d30, to: today,
    totalTopCut: month.reduce((a, b) => a + b.topCut, 0),
    blades: month.slice(0, 5).map((b) => ({ blade: b.blade, topCut: b.topCut, share: b.share, bestCombo: b.combos[0]?.combo.displayName ?? '' })),
  } });

  // Eventi: lama nuova pronta (precedenza 1), nuovo ingresso (precedenza 2).
  const newCut = daysBefore(ref, NEW_BLADE_DAYS);
  for (const b of quarter) {
    if (b.firstSeen && b.firstSeen >= newCut && bladeTotal(db, b.blade) >= NEW_BLADE_MIN_PLACEMENTS) {
      out.push({ id: `build-lama-nuova-${b.blade}`, type: 'build-lama-nuova', blade: b.blade, priority: 1, data: bladeBuildData(db, b, d90, today) });
    }
  }
  const top5Month = new Set(month.slice(0, 5).map((b) => b.blade));
  const top5Quarter = new Set(quarter.slice(0, 5).map((b) => b.blade));
  const rising = month
    .filter((b) => b.firstSeen && b.firstSeen < newCut && !top5Month.has(b.blade) && !top5Quarter.has(b.blade) && b.topCut >= RISING_MIN_RECENT)
    .map((b) => {
      const q = quarter.find((x) => x.blade === b.blade);
      const prevMonthly = ((q?.topCut ?? 0) - b.topCut) / 2;
      return { b, prevMonthly, growth: b.topCut / Math.max(prevMonthly, 1) };
    })
    .filter((r) => r.growth >= RISING_MIN_GROWTH)
    .sort((x, y) => y.growth - x.growth);
  rising.forEach((r, i) => out.push({ id: `nuovo-ingresso-${r.b.blade}`, type: 'nuovo-ingresso', blade: r.b.blade, priority: 2 + i, data: {
    ...bladeBuildData(db, r.b, d30, today),
    recent: r.b.topCut, prevMonthly: r.prevMonthly, growth: r.growth, share: r.b.share,
    leader: month[0]?.blade ?? '', totalTopCut: month.reduce((a, x) => a + x.topCut, 0),
  } }));

  // Riempitivi: top 10 lame a 90 giorni, ordine = posizione (il pubblicatore ruota col suo registro).
  quarter.slice(0, FILLER_TOP_BLADES).forEach((b, i) => out.push({ id: `build-lama-${b.blade}`, type: 'build-lama', blade: b.blade, priority: 10 + i, data: bladeBuildData(db, b, d90, today) }));
  return out;
}

/** Dati per un post «le build meta per X»: le prime BUILDS_PER_BLADE combo della lama nella finestra. */
function bladeBuildData(db: Combo[], b: BladeStat, from: string, to: string) {
  return {
    blade: b.blade, from, to, tournaments: tournamentCount(db, from, to), topCut: b.topCut, share: b.share, firstSeen: b.firstSeen,
    builds: b.combos.slice(0, BUILDS_PER_BLADE).map((s) => ({ id: s.combo.id, name: s.combo.displayName, blade: s.combo.blade, ratchet: s.combo.ratchet, bit: s.combo.bit, type: s.combo.type ?? '', topCut: s.topCut, wins: s.wins, events: s.events })),
  };
}
