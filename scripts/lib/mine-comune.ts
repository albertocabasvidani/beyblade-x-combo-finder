/**
 * mine-comune.ts — Ciò che i batcher delle fonti narrative (youtube-mine-batch, web-mine-batch)
 * hanno in comune: il dizionario delle parti servito al modello e la forma di una combo proposta.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');
const MASTER = join(ROOT, 'data', 'parts-master.json');

export const KINDS = new Set(['tournament-report', 'recommendation']);
const CATEGORIE = ['blades', 'lockChips', 'mainBlades', 'assistBlades', 'overBlades', 'ratchets', 'bits'] as const;

export const today = () => new Date().toISOString().slice(0, 10);
export const readJson = (p: string, fb: any) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : fb);

/** Dizionario nomi → id, compatto: tutto ciò che serve al modello per risolvere una parte. */
export function scriviDizionario(dest: string): void {
  const master = readJson(MASTER, {});
  const dict: Record<string, any[]> = {};
  for (const cat of CATEGORIE) {
    dict[cat] = (master[cat] ?? []).map((p: any) => {
      const nomi = new Set<string>();
      for (const n of Object.values(p.names ?? {})) if (n) nomi.add(String(n));
      for (const a of p.aliases ?? []) if (a?.value) nomi.add(String(a.value));
      if (p.shortName) nomi.add(String(p.shortName));
      const voce: any = { id: p.id, nomi: [...nomi] };
      if (p.integratedRatchet) voce.ratchetIntegrato = true;
      return voce;
    });
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(dict));
}

export const kindDi = (c: any): string => (KINDS.has(c?.kind) ? c.kind : 'recommendation');

/** Chiave di una combo proposta dentro lo stesso documento: serve a non contarla due volte. */
export const chiaveCombo = (c: any): string =>
  [c.blade, c.lockChip, c.overBlade, c.mainBlade, c.assistBlade, c.ratchet, c.bit, kindDi(c)].join('|');

/** Voce pronta per `mergeExtracted`: le parti dette dal modello, la mention costruita dal codice. */
export function voceDaFondere(c: any, mention: Record<string, any>): any {
  return {
    blade: c.blade ?? null,
    ratchet: c.ratchet ?? null,
    bit: c.bit ?? null,
    lockChip: c.lockChip ?? null,
    mainBlade: c.mainBlade ?? null,
    assistBlade: c.assistBlade ?? null,
    overBlade: c.overBlade ?? null,
    evidence: { placements: [], usage: [], mentions: [{ tier: 'narrative', ...mention, kind: kindDi(c) }] },
  };
}
