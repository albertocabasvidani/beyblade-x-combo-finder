/**
 * cx-resolve.ts — Risoluzione DETERMINISTICA del lato sinistro CX di una riga-combo.
 *
 * Scompone il `bladePart` (tutto ciò che precede il ratchet) nei componenti CX:
 *   lockChip + mainBlade [+ overBlade] + assistBlade
 * in modo **order-agnostic** (lockChip e mainBlade in qualsiasi ordine), **Western-aware** (match anche
 * sui nomi Hasbro/occidentali, es. "Courage" = Brave) e **conservativo** (risolve solo se l'assegnazione
 * è univoca; se due assegnazioni distinte sono valide → ambiguo, niente indovinare).
 *
 * Pattern reali coperti (derivati dai dati WBO, vedi tmp/cx-spike):
 *   "HellsBrave Jaggy"      → lock+main gluati CamelCase, assist a nome intero
 *   "PegasusBlast J"        → assist come shortName
 *   "Courage Dran"          → core a 2 token spaziati, ordine invertito, nome Western
 *   "ValkyrieBlitz BreakHeavy" → over+assist gluati in coda ("Break"+"Heavy")
 *   "Beezo PhoenixWing"     → (gestito a monte) prefisso username → NON è CX
 *
 * Niente IA, niente fuzzy. Riusabile da WBO e (in seguito) MetaBeys.
 */
import type { BladeType } from '../../src/lib/types';

const RATCHET_RE = /\d-\d{2}/;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim();
const squash = (s: string) => norm(s).replace(/[\s-]+/g, '');

export interface CxRef { id: string; name: string; shortName?: string; type?: BladeType }
export interface CxResolution {
  lockChip: CxRef;
  mainBlade: CxRef;
  assistBlade: CxRef;
  overBlade: CxRef | null;
}
export type CxResult = { ok: true; cx: CxResolution } | { ok: false; ambiguous?: boolean };

export interface CxResolver {
  lock: Map<string, CxRef>;
  main: Map<string, CxRef>;
  assistByCode: Map<string, CxRef>;
  assistByName: Map<string, CxRef>;
  overByName: Map<string, CxRef>;
}

function addKey(m: Map<string, CxRef>, key: string, v: CxRef) {
  const k = squash(key);
  if (!k || RATCHET_RE.test(k)) return;
  if (!m.has(k)) m.set(k, v);
}

/** Estrae il nome TT dell'assist dal name di parts.json ("A (Assault)" → "Assault"). */
function assistTtName(name: string): string {
  return name.match(/\(([^)]+)\)/)?.[1] ?? name;
}

export function buildCxResolver(parts: any): CxResolver {
  const lock = new Map<string, CxRef>();
  const main = new Map<string, CxRef>();
  const assistByCode = new Map<string, CxRef>();
  const assistByName = new Map<string, CxRef>();
  const overByName = new Map<string, CxRef>();

  for (const p of parts.lockChips ?? []) {
    const v: CxRef = { id: p.id, name: p.name };
    addKey(lock, p.name, v);
    if (p.nameWestern) addKey(lock, p.nameWestern, v);
  }
  for (const p of parts.mainBlades ?? []) {
    const v: CxRef = { id: p.id, name: p.name, type: p.type as BladeType | undefined };
    addKey(main, p.name, v);
    if (p.nameWestern) addKey(main, p.nameWestern, v);
  }
  for (const p of parts.assistBlades ?? []) {
    const v: CxRef = { id: p.id, name: p.name, shortName: p.shortName };
    if (p.shortName) assistByCode.set(String(p.shortName).toUpperCase(), v);
    addKey(assistByName, assistTtName(p.name), v);
    if (p.nameWestern) addKey(assistByName, p.nameWestern, v);
  }
  for (const p of parts.overBlades ?? []) {
    const v: CxRef = { id: p.id, name: p.name };
    addKey(overByName, p.name, v);
    if (p.nameWestern) addKey(overByName, p.nameWestern, v);
  }
  return { lock, main, assistByCode, assistByName, overByName };
}

const assistRef = (r: CxResolver, t: string): CxRef | null =>
  r.assistByCode.get(t.toUpperCase()) ?? r.assistByName.get(squash(t)) ?? null;
const overRef = (r: CxResolver, t: string): CxRef | null => r.overByName.get(squash(t)) ?? null;

/**
 * Risolve i token del core in {lockChip, mainBlade}, order-agnostic. Il core può essere 1 token gluato
 * (genera tutti gli split) o 2 token spaziati. Ritorna 'ambig' se più assegnazioni DISTINTE sono valide.
 */
function resolveCore(r: CxResolver, coreTokens: string[]): { lock: CxRef; main: CxRef } | 'ambig' | null {
  const pairs: Array<[string, string]> = [];
  if (coreTokens.length === 1) {
    const t = squash(coreTokens[0]);
    for (let i = 1; i < t.length; i++) pairs.push([t.slice(0, i), t.slice(i)]);
  } else if (coreTokens.length === 2) {
    pairs.push([squash(coreTokens[0]), squash(coreTokens[1])]);
  }
  const sols = new Map<string, { lock: CxRef; main: CxRef }>();
  for (const [a, b] of pairs) {
    const la = r.lock.get(a), mb = r.main.get(b);
    if (la && mb) sols.set(`${la.id}|${mb.id}`, { lock: la, main: mb });
    const lb = r.lock.get(b), ma = r.main.get(a);
    if (lb && ma) sols.set(`${lb.id}|${ma.id}`, { lock: lb, main: ma });
  }
  if (sols.size === 0) return null;
  if (sols.size > 1) return 'ambig';
  return [...sols.values()][0];
}

/**
 * Risolve i token-coda (dopo il core, prima del ratchet) in {over?, assist}. Gestisce assist singolo
 * (sigla o nome), over singolo (nome), e over+assist gluati ("BreakHeavy"). Richiede un assist: una CX
 * senza assist non forma un id valido (resta unresolved a monte).
 */
function resolveCoda(r: CxResolver, codaTokens: string[]): { over: CxRef | null; assist: CxRef } | null {
  let over: CxRef | null = null;
  let assist: CxRef | null = null;
  for (const tk of codaTokens) {
    const a = assistRef(r, tk);
    if (a && !assist) { assist = a; continue; }
    const o = overRef(r, tk);
    if (o && !over) { over = o; continue; }
    // token gluato over+assist, es. "BreakHeavy"
    const sq = squash(tk);
    let split: { o: CxRef; a: CxRef } | null = null;
    for (let i = 1; i < sq.length; i++) {
      const oId = r.overByName.get(sq.slice(0, i));
      const aId = r.assistByName.get(sq.slice(i));
      if (oId && aId) { split = { o: oId, a: aId }; break; }
    }
    if (split && !over && !assist) { over = split.o; assist = split.a; continue; }
    return null; // token-coda non interpretabile
  }
  if (!assist) return null;
  return { over, assist };
}

const isComboPart = (r: CxResolver, t: string): boolean =>
  r.lock.has(squash(t)) || r.main.has(squash(t)) || assistRef(r, t) !== null || overRef(r, t) !== null;

/**
 * Risolve un `bladePart` CX completo. `start` permette di saltare un prefisso-username (t0) solo se NON
 * è esso stesso un pezzo combo. Prova i confini core|coda con core di 1 (gluato) o 2 (spaziati) token.
 */
export function resolveCxBladePart(r: CxResolver, bladePart: string): CxResult {
  const cleaned = bladePart.replace(/\[\/?[a-z]+\]/gi, '').replace(/^[-•\s]+/, '').trim();
  if (!cleaned || cleaned.includes('?')) return { ok: false };
  const tokens = cleaned.split(/\s+/).filter(Boolean);

  for (const start of [0, 1]) {
    if (start === 1) {
      if (tokens.length < 2) continue;
      if (isComboPart(r, tokens[0])) continue; // t0 è un pezzo combo, non un username
    }
    const rest = tokens.slice(start);
    for (const coreLen of [1, 2]) {
      if (rest.length < coreLen) continue;
      const core = resolveCore(r, rest.slice(0, coreLen));
      if (core === 'ambig') return { ok: false, ambiguous: true };
      if (!core) continue;
      const codaTokens = rest.slice(coreLen);
      if (codaTokens.length === 0) continue; // CX senza assist → incompleta
      const coda = resolveCoda(r, codaTokens);
      if (!coda) continue;
      return { ok: true, cx: { lockChip: core.lock, mainBlade: core.main, assistBlade: coda.assist, overBlade: coda.over } };
    }
  }
  return { ok: false };
}

/**
 * id-set CX canonico (con overBlade se presente): lockChip-[overBlade]-mainBlade-assistBlade-ratchet-bit.
 * `ratchet` null per le CX con Ratchet Integrated Bit (Operate/Turbo): il segmento ratchet è omesso.
 */
export function cxComboId(cx: CxResolution, ratchet: string | null, bitId: string): string {
  const over = cx.overBlade ? `${cx.overBlade.id}-` : '';
  const rt = ratchet ? `${ratchet}-` : '';
  return `${cx.lockChip.id}-${over}${cx.mainBlade.id}-${cx.assistBlade.id}-${rt}${bitId}`;
}

/** displayName CX: "Lock Main [Over] AssistShort [ratchet] Bit" (ratchet omesso se null). */
export function cxDisplayName(cx: CxResolution, ratchet: string | null, bitName: string): string {
  const over = cx.overBlade ? `${cx.overBlade.name} ` : '';
  const assistShort = cx.assistBlade.shortName ?? cx.assistBlade.name;
  const rt = ratchet ? `${ratchet} ` : '';
  return `${cx.lockChip.name} ${cx.mainBlade.name} ${over}${assistShort} ${rt}${bitName}`.replace(/\s+/g, ' ').trim();
}
