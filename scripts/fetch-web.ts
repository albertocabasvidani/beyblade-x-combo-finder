/**
 * fetch-web.ts — Scarica le pagine delle fonti web che riportano combo complete.
 *
 * Fino al 12/11/2026 nessuno script le scaricava: le leggeva /update-combos con WebFetch, quando
 * decideva di farlo, e l'impronta in scan-history era un'etichetta scelta dal modello. Qui il codice
 * fa la sua parte: richiesta HTTP, testo ripulito, sha256. Le pagine da leggere stanno in
 * `sources.json`, nel campo `mine.pages` di ogni fonte `website`:
 *
 *   "mine": { "pages": [{ "url": "https://…", "startAfter": "…", "maxChars": 40000 }], "parser": "beywatch" }
 *
 * `startAfter` butta via tutto ciò che precede quel testo (menu e filtri in testa alla pagina): se
 * il testo non c'è la pagina è fallita, perché la struttura è cambiata. `maxChars` tronca ciò che
 * resta (le pagine-classifica mettono in cima ciò che conta). `parser` sceglie un estrattore
 * dedicato al posto del testo intero della pagina.
 *
 * Scrive `data/web-cache.json` (gitignorato, come le altre cache). Una pagina che non risponde
 * lascia in cache la versione precedente. Esce 1 se una pagina fallisce e la sua ultima lettura
 * buona ha più di GIORNI_TOLLERANZA giorni, o non esiste: un errore di una notte si ritenta da
 * solo, una fonte muta da giorni deve arrivare al dispatcher.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { readJson, today } from './lib/mine-comune';

const ROOT = join(import.meta.dirname, '..');
const SOURCES = join(ROOT, 'data', 'sources.json');
const CACHE = join(ROOT, 'data', 'web-cache.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const GIORNI_TOLLERANZA = 3;
const TIMEOUT_MS = 30_000;

const ENTITA: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&middot;': '·', '&mdash;': '—' };

export function htmlInTesto(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITA[e] ?? ' ')
    .replace(/[ \t\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * BEYWATCH.GG: una scheda per torneo, col prefisso dello slug che dice da dove viene il dato.
 * Gli eventi `wbo-` e `metabeys-` sono già nelle fonti strutturate e si scartano qui, a codice:
 * lasciarli al giudizio del modello vorrebbe dire contare due volte lo stesso torneo.
 */
export function parserBeywatch(html: string): string {
  const righe: string[] = [];
  for (const m of html.matchAll(/<a href="\/tournaments\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const slug = m[1];
    if (/^(wbo|metabeys)-/.test(slug)) continue;
    const t = htmlInTesto(m[2].replace(/<\/span>/g, '</span>\n')).replace(/\n+/g, ' | ');
    if (!/Winning deck/i.test(t)) continue;
    righe.push(`[${slug}] ${t}`);
  }
  return [...new Set(righe)].join('\n');
}

const PARSER: Record<string, ((html: string) => string) | undefined> = { beywatch: parserBeywatch };

interface PaginaCache { sourceId: string; sourceName: string; lang: string; title: string; hash: string; text: string; fetchedAt: string; changedAt: string }

async function scarica(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function giorniDa(data: string | undefined): number {
  if (!data) return Infinity;
  return (Date.parse(today()) - Date.parse(data)) / 86_400_000;
}

async function main() {
  const fonti = (readJson(SOURCES, { sources: [] }).sources ?? []).filter((s: any) => s.type === 'website' && s.mine?.pages?.length);
  const cache = readJson(CACHE, { pages: {} });
  cache.pages = cache.pages ?? {};
  let lette = 0, cambiate = 0;
  const fallite: string[] = [];
  const gravi: string[] = [];
  const attive = new Set<string>();

  for (const fonte of fonti) {
    for (const pagina of fonte.mine.pages) {
      const url: string = pagina.url;
      attive.add(url);
      const prima: PaginaCache | undefined = cache.pages[url];
      try {
        const html = await scarica(url);
        const parser = PARSER[fonte.mine.parser ?? ''];
        let text = parser ? parser(html) : htmlInTesto(html);
        if (pagina.startAfter) {
          const i = text.indexOf(pagina.startAfter);
          if (i < 0) throw new Error(`manca il testo di partenza "${pagina.startAfter}": struttura cambiata`);
          text = text.slice(i);
        }
        if (pagina.maxChars && text.length > pagina.maxChars) text = text.slice(0, pagina.maxChars);
        // Con un parser dedicato poche righe sono un esito normale (pochi eventi non coperti da WBO):
        // lì la struttura si controlla sull'HTML, non sulla lunghezza del testo.
        if (parser) {
          if (!/<a href="\/tournaments\//.test(html)) throw new Error('nessuna scheda torneo nella pagina: struttura cambiata');
        } else if (text.length < 200) {
          throw new Error(`testo di ${text.length} caratteri: pagina vuota o struttura cambiata`);
        }
        const hash = createHash('sha256').update(text).digest('hex');
        const title = (html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? '').trim();
        const cambiata = prima?.hash !== hash;
        cache.pages[url] = { sourceId: fonte.id, sourceName: fonte.name ?? fonte.id, lang: fonte.lang ?? 'en', title, hash, text, fetchedAt: today(), changedAt: cambiata ? today() : prima!.changedAt };
        lette++;
        if (cambiata) cambiate++;
        console.log(`  ok   ${fonte.id}: ${url} (${text.length} caratteri${cambiata ? ', cambiata' : ''})`);
      } catch (e: any) {
        const msg = `${fonte.id}: ${url}: ${e?.message ?? e}`;
        fallite.push(msg);
        const eta = giorniDa(prima?.fetchedAt);
        console.error(`  KO   ${msg} (ultima lettura buona: ${prima?.fetchedAt ?? 'mai'})`);
        if (eta > GIORNI_TOLLERANZA) gravi.push(msg);
      }
    }
  }

  // Una pagina tolta da sources.json esce dalla cache: altrimenti resterebbe da leggere per sempre.
  for (const url of Object.keys(cache.pages)) if (!attive.has(url)) delete cache.pages[url];
  cache.lastFetched = today();
  writeFileSync(CACHE, JSON.stringify(cache, null, 2));

  console.log(`Web: ${lette} pagine lette, ${cambiate} cambiate, ${fallite.length} fallite (su ${attive.size} in ${fonti.length} fonti).`);
  if (gravi.length) {
    console.error(`Web: ${gravi.length} pagine senza una lettura buona da più di ${GIORNI_TOLLERANZA} giorni.`);
    process.exit(1);
  }
}

if (process.argv[1] && /fetch-web\.ts$/.test(process.argv[1])) main();
