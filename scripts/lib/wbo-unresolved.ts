/**
 * wbo-unresolved.ts — Ledger persistente delle righe-combo WBO non risolte (deterministico).
 *
 * Problema: parse:wbo ri-parsa l'intera cache ad ogni run, quindi rigenera lo stesso elenco di
 * unresolved ogni volta. Questo ledger dà a ogni riga una chiave stabile (hash della forma
 * normalizzata) e uno `status`, così ogni run espone solo il DELTA nuovo (mai visto prima) e nulla va
 * perso: i residui irrisolvibili (refusi, dato mancante "?", CX ambigue) restano tracciati e contati.
 *
 * Idempotente: stesso input due volte → stesso file (lo `status` impostato a mano viene preservato).
 * Nessun timestamp casuale: `today` è iniettato dal chiamante.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { UnresolvedItem } from './wbo-parse';

export type LedgerStatus = 'new' | 'triaged' | 'ignored';
export type LedgerCategory =
  | 'missing-data' | 'cx-ambiguous' | 'blade-unresolved' | 'bit-unresolved' | 'no-ratchet' | 'unknown';

export interface LedgerItem {
  key: string;
  line: string;
  normLine: string;
  reason: string;
  category: LedgerCategory;
  status: LedgerStatus;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
}
export interface Ledger {
  generatedAt: string;
  source: string;
  items: LedgerItem[];
  stats: { total: number; new: number; triaged: number; ignored: number };
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim();

/** Forma normalizzata per la chiave: lowercase, spazi collassati, MA si tiene il "?" (è informativo). */
export function normLineOf(line: string): string {
  return norm(line);
}

/** Hash FNV-1a 32-bit → 8 hex. Deterministico, stabile tra run (no Date/random). */
export function keyOf(normLine: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < normLine.length; i++) {
    h ^= normLine.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Solo le righe-combo che valgono un triage finiscono nel ledger. Gli avvisi a livello evento
 * (oltre-cutoff, deck list senza podio) sono pruning atteso, non "lavoro": esclusi. */
export function isLedgerable(reason: string): boolean {
  return !/^oltre-cutoff|^nessun marcatore/i.test(reason);
}

/** Categoria deterministica derivata dal reason del parser (input del triage / del subagent typo). */
export function categorize(line: string, reason: string): LedgerCategory {
  if (line.includes('?') || /"\?"/.test(reason)) return 'missing-data';
  if (/CX ambiguo/i.test(reason)) return 'cx-ambiguous';
  if (/nessun ratchet/i.test(reason)) return 'no-ratchet';
  if (/bit\/sigla non risolto/i.test(reason)) return 'bit-unresolved';
  if (/blade non risolto/i.test(reason)) return 'blade-unresolved';
  return 'unknown';
}

export function loadLedger(path: string, source: string): Ledger {
  if (existsSync(path)) {
    try {
      const l = JSON.parse(readFileSync(path, 'utf8'));
      if (Array.isArray(l.items)) return l as Ledger;
    } catch { /* file corrotto → riparti pulito */ }
  }
  return { generatedAt: '', source, items: [], stats: { total: 0, new: 0, triaged: 0, ignored: 0 } };
}

/**
 * Fonde gli unresolved del run corrente nel ledger. Ritorna { ledger, added } dove `added` è il numero
 * di item NUOVI mai visti (il "delta" da segnalare). Preserva lo `status` impostato a mano.
 */
export function mergeUnresolved(prev: Ledger, items: UnresolvedItem[], today: string): { ledger: Ledger; added: number } {
  // aggrega per chiave nel run corrente (le ripetizioni della stessa riga → un item con occurrences)
  const current = new Map<string, { line: string; reason: string; normLine: string; count: number }>();
  for (const it of items) {
    if (!isLedgerable(it.reason)) continue;
    const normLine = normLineOf(it.line);
    if (!normLine) continue;
    const key = keyOf(normLine);
    const cur = current.get(key);
    if (cur) cur.count++;
    else current.set(key, { line: it.line.trim(), reason: it.reason, normLine, count: 1 });
  }

  const byKey = new Map<string, LedgerItem>(prev.items.map((i) => [i.key, i]));
  let added = 0;
  for (const [key, c] of current) {
    const existing = byKey.get(key);
    if (existing) {
      existing.lastSeen = today;
      existing.occurrences = c.count;
      existing.reason = c.reason; // il reason può evolvere col parser
      existing.category = categorize(c.line, c.reason);
    } else {
      byKey.set(key, {
        key, line: c.line, normLine: c.normLine, reason: c.reason,
        category: categorize(c.line, c.reason), status: 'new',
        occurrences: c.count, firstSeen: today, lastSeen: today,
      });
      added++;
    }
  }

  const out = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  const stats = {
    total: out.length,
    new: out.filter((i) => i.status === 'new').length,
    triaged: out.filter((i) => i.status === 'triaged').length,
    ignored: out.filter((i) => i.status === 'ignored').length,
  };
  return { ledger: { generatedAt: today, source: prev.source, items: out, stats }, added };
}

export function writeLedger(path: string, ledger: Ledger): void {
  writeFileSync(path, JSON.stringify(ledger, null, 2) + '\n');
}
