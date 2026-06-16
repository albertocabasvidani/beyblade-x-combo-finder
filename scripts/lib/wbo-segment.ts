/**
 * wbo-segment.ts — Segmentazione del thread WBO (la parte "IA" del confine IA/codice).
 *
 * Interpretare il layout di un thread-forum eterogeneo (quali blocchi sono eventi reali e non
 * pubblicità/quote/nav, dove iniziano i podi, quale riga marca 1°/2°/3° tra formati misti come
 * "1st" / "1st Place:" / 🥇 / bullet "- ") è interpretazione di pagina → la fa l'IA. Usiamo Haiku
 * (economico) e gli chiediamo SOLO la struttura: NON risolve le parti, NON inventa piazzamenti, e
 * copia le righe-combo verbatim. La risoluzione parti/sigle/id resta deterministica (wbo-parse.ts).
 *
 * Riproducibilità/costo: il risultato Haiku è messo in cache per hash del raw. Se manca
 * ANTHROPIC_API_KEY o l'API fallisce, si ripiega sul segmentatore deterministico (deterministicSegment).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { deterministicSegment, type SegEvent } from './wbo-parse';

const MODEL = 'claude-haiku-4-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You extract the STRUCTURE of a World Beyblade Organization (WBO) forum thread that lists tournament-winning Beyblade combos. You do NOT resolve part names and you do NOT invent anything.

The thread concatenates many posts. Each tournament-result post has: an organizer/title header (often with "Date: MM/DD/YYYY", "Player Count: N" or "N Participants" or "N player tournament", "Event Page Link:", "Bracket Link:"), then a podium. Podium positions are marked in MIXED styles: "1st <user>", "1st Place: <user>", or medal emojis 🥇🥈🥉. Under each position come 3 (sometimes more) combo lines like "WizardRod 1-60Hexa (First Stage & Final Stage)", "SharkScale 1-70H", sometimes bulleted "- ...".

Return, via the report_events tool, the list of REAL tournament-result events. For each:
- eventName: the tournament title.
- headerRaw: the header lines BEFORE the first podium marker, copied VERBATIM (title + Date/Player Count/Event Page Link/Bracket Link). This is parsed downstream for date/players/id.
- placements: one entry per podium position, with rank (1,2,3,...) and comboLinesRaw = the combo lines under it, copied VERBATIM (do not rewrite, do not strip the "(... Stage)" suffix, do not resolve parts).

Rules:
- EXCLUDE non-events: the page header/ads at the very top (price tags, "$XX.99 USD"), navigation ("Prev", page numbers, "(current)"), the site footer, and any quoted/discussion post (these contain "Wrote:").
- Map medals: 🥇→rank 1, 🥈→rank 2, 🥉→rank 3.
- If a post lists decks but has NO position markers (e.g. a ladder/deck-locked list of usernames with no 1st/2nd/3rd), include the event with placements = [] (do NOT infer ranks from order).
- Copy combo lines exactly as written; never merge, summarize, or correct them.`;

const TOOL = {
  name: 'report_events',
  description: 'Report the structured list of WBO tournament-result events.',
  input_schema: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            eventName: { type: 'string' },
            headerRaw: { type: 'string', description: 'Header lines before the first podium marker, verbatim.' },
            placements: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  rank: { type: 'integer' },
                  comboLinesRaw: { type: 'array', items: { type: 'string' } },
                },
                required: ['rank', 'comboLinesRaw'],
              },
            },
          },
          required: ['eventName', 'headerRaw', 'placements'],
        },
      },
    },
    required: ['events'],
  },
} as const;

/** Chiama Haiku e ritorna gli eventi segmentati. Throw se manca la key o l'API fallisce. */
export async function segmentWithHaiku(raw: string): Promise<SegEvent[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non impostata');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'report_events' },
      messages: [{ role: 'user', content: `WBO thread raw text:\n\n${raw}` }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data: any = await res.json();
  if (data.stop_reason === 'max_tokens') {
    console.warn('  ⚠️  Haiku troncato (max_tokens): alcuni eventi potrebbero mancare.');
  }
  const tool = (data.content ?? []).find((c: any) => c.type === 'tool_use' && c.name === 'report_events');
  if (!tool?.input?.events) throw new Error('Risposta Haiku senza tool_use report_events');
  return tool.input.events as SegEvent[];
}

type SegResult = { events: SegEvent[]; source: 'cache' | 'haiku' | 'fallback' };

/**
 * Orchestratore: cache per hash → Haiku → fallback deterministico. La cache vale solo per i
 * risultati Haiku (il fallback non si cacha, così quando l'API torna disponibile si riprova).
 */
export async function segment(raw: string, cachePath: string): Promise<SegResult> {
  const hash = createHash('sha256').update(raw).digest('hex');
  const cache: Record<string, SegEvent[]> = existsSync(cachePath)
    ? JSON.parse(readFileSync(cachePath, 'utf8'))
    : {};
  if (cache[hash]) return { events: cache[hash], source: 'cache' };

  try {
    const events = await segmentWithHaiku(raw);
    cache[hash] = events;
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
    return { events, source: 'haiku' };
  } catch (e) {
    console.warn(`  ⚠️  Segmentazione Haiku non disponibile (${(e as Error).message}). Uso il fallback deterministico.`);
    return { events: deterministicSegment(raw), source: 'fallback' };
  }
}
