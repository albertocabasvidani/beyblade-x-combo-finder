/**
 * content.config.ts — content collections per il contenuto editoriale (report mensili, pagine
 * parte/combo, guide d'acquisto). Testo scritto a mano, separato da `data/`: quei file li riscrive
 * la pipeline ogni giorno (score-combos.ts, prune-combos.ts cancella record), quindi il testo umano
 * non può viverci senza rischiare di essere sovrascritto o perso.
 *
 * Le rotte in src/pages/{meta,parts,combos,buy}/[x].astro derivano i loro path SOLO da queste
 * collection (getCollection), non dai dati grezzi: se una parte/combo/set non ha una entry qui, la
 * sua pagina non esiste. `draft: true` non viene generato in produzione (vedi getStaticPaths).
 *
 * `partId`/`comboId`/`setCode` sono la chiave autorevole (validata contro i dati veri da
 * scripts/test-content.ts), non il nome del file: un rename non rompe il collegamento.
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const common = {
  title: z.string().min(20).max(70),
  description: z.string().min(80).max(160),
  author: z.string().default('Alberto'),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  draft: z.boolean().default(true),
  status: z.enum(['live', 'retired']).default('live'),
};

const metaReports = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/meta-reports' }),
  schema: z.object({
    ...common,
    month: z.string().regex(/^\d{4}-\d{2}$/, 'formato YYYY-MM'),
  }),
});

const parts = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/parts' }),
  schema: z.object({
    ...common,
    partId: z.string(),
    category: z.enum(['blade', 'lockChip', 'mainBlade', 'assistBlade', 'overBlade', 'ratchet', 'bit']),
    relatedCombos: z.array(z.string()).default([]),
  }),
});

const combos = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/combos' }),
  schema: z.object({
    ...common,
    comboId: z.string(),
    relatedParts: z.array(z.string()).default([]),
    relatedCombos: z.array(z.string()).default([]),
  }),
});

const buyingGuides = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/buying-guides' }),
  schema: z.object({
    ...common,
    setCode: z.string(),
    relatedParts: z.array(z.string()).default([]),
  }),
});

export const collections = { metaReports, parts, combos, buyingGuides };
