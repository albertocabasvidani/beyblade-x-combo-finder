# Beyblade X Combo Finder

## Progetto

Sito web per trovare le migliori combo Beyblade X in base alle parti possedute. Database aggiornato tramite pipeline agentica Claude Code.

## Tech Stack

- **Framework**: Astro (SSG) + Preact (island interattiva)
- **Styling**: Tailwind CSS v4
- **Hosting**: GitHub Pages (deploy automatico via Actions)
- **i18n**: EN (default) + IT, route-based (`/en/`, `/it/`)
- **Database**: JSON nel repo (`data/combos.json`, `data/parts.json`)
- **Pipeline**: Claude Code agentico via comando `/update-combos`

## Struttura Dati

### Combo Beyblade X
- **BX/UX Line** (3 parti): Blade + Ratchet + Bit
- **CX Line** (5 parti): Lock Chip + Main Blade + Assist Blade + Ratchet + Bit
- **CX Expand** (6 parti): Lock Chip + **Over Blade** + Main Blade + Assist Blade + Ratchet + Bit. Il "Metal Blade" del wiki È modellato come Main Blade; l'Over Blade (Break/Guard/Flow/Peak/Outer) è la categoria `overBlade` a sé (combo `overBlade` nullable, opzionale).
- Ratchet e Bit sono condivisi tra le linee

### File Dati
- `data/parts-master.json` — **file canonico** parti multilingua (names.tt/hasbro/ja/romaji + aliases per lingua, stats, products, source). Fonte di verità del registro parti.
- `data/parts.json` — **derivato** da parts-master via `npm run build:parts` (schema consumato dal sito). NON editare a mano: si rigenera.
- `data/parts-master-conflicts.json` — casi ambigui dell'import per revisione umana (type_mismatch = rumore; gli over_blade ora sono categoria `overBlades` a sé, non più conflitti)
- `data/combos.json` — database combo con score e fonti
- `data/products.json` — catalogo prodotti TT+Hasbro (link Amazon); referenzia gli id parte
- `data/sources.json` — fonti configurabili (con `lang`, `manualVerification`); editabile dall'utente
- `data/youtube-cache.json`, `data/youtube-transcripts.json`, `data/reddit-cache.json`, `data/sheets-cache.json` — cache grezze fonti
- `data/metabeys-cache.json` — cache eventi+leaderboard MetaBeys (Playwright headless)
- `data/wbo-cache.json` — cache thread WBO (Playwright; Cloudflare può bloccare headless)
- `data/scan-history.json` — dedup: scannedVideos/Sheets/RedditPosts/Pages(+revid)/Events/Posts

## Comandi

- `npm run dev` — server sviluppo
- `npm run build` — build produzione
- `npm run build:parts` — rigenera `parts.json` da `parts-master.json` (guardrail: aborta se rompe i riferimenti di combos.json)
- `npm run verify:wiki` — verifica completezza del master contro la fonte affidabile (category per-tipo del Fandom Wiki, X-pure; blade filtrati su `Category:Beyblade X` perché `Category:Blades` è mista X+Burst). Riporta mancanti/extra. Obiettivo: 0 mancanti.
- `npm run collect:sources` — raccoglie le cache grezze (Reddit, YouTube, Sheets, MetaBeys, WBO)
- `/scrape-parts-master` — import iniziale parti da Fandom (one-shot, subagent)
- `/verify-parts-master` — verifica qualità del master parti
- `/update-parts` — aggiornamento giornaliero parti (diff revid)
- `/update-combos` — aggiorna database combo dalle cache (master multilingua, X-filter, dedup id-set)

## Pipeline Dati

### Confine IA / codice (principio architetturale)
Le routine (import parti, update giornalieri, analisi combo) le esegue **Claude**. Tutto ciò che è
**non deterministico — leggere/interpretare pagine, riconoscere e matchare i nomi delle parti in
qualsiasi lingua — lo fa l'IA** (comandi + subagent). Il **codice** fa solo ciò che è deterministico:
accesso/fetch grezzo, dedup (id/revid/hash), derivazione di formato, validazione referenziale.

### Database parti (master multilingua → derivati)
- Fonte: pagine prodotto Beyblade Fandom Wiki via **API MediaWiki** (`api.php?action=parse&...&prop=wikitext`;
  la pagina `/wiki/` dà 403). Corrispondenze TT↔Hasbro dall'AKA; per CX leggere le pagine parte
  (`Main Blade - X`, `Lock Chip - X`, `Assist Blade - X`); nomi JP da JPName/RomajiName.
- `/scrape-parts-master` (one-shot, subagent) popola `parts-master.json`; `scripts/build-parts.ts`
  deriva `parts.json` e valida i riferimenti (guardrail combos: aborta se rotti). `/update-parts`
  aggiorna via diff `revid`. Script deterministici: `bootstrap-master.ts`, `merge-master.ts`, `build-parts.ts`.

### Script raccolta combo (`npm run collect:sources`)
- `scrape:reddit` (Playwright; Reddit blocca l'accesso non autenticato → serve sessione browser loggata:
  `REDDIT_HEADED=1 npm run scrape:reddit`, login una tantum nel profilo `.playwright-beyblade`, poi riusa
  la sessione e legge gli endpoint `.json`; headless = no-op non distruttivo, preserva la cache),
  `fetch:youtube` (API key), `fetch:sheets`, `fetch:metabeys` (Playwright headless),
  `fetch:wbo` (Playwright; Cloudflare blocca headless → `WBO_HEADED=1`, oppure ci si affida a MetaBeys
  che indicizza gli stessi eventi WBO). `fetch:transcripts` gira SEPARATO (ogni 5 min, `--batch 1`).
- Reddit/WBO girano headed+manuale (lo scheduler headless li lascia no-op): rieseguire a mano quando serve dato fresco.
- Le cache grezze le interpreta `/update-combos` (estrazione, match multilingua, dedup id-set, scoring).

### Dipendenze
- Node: `tsx`, `playwright-core` (usa il Chrome di sistema). Python: `youtube_transcript_api`.
- `.env`: `YOUTUBE_API_KEY` (YouTube Data API v3 + Sheets API v4), `AMAZON_TAG_IT/US`.

### Fonti torneo (in `data/sources.json`, con `lang`)
Strutturate: **MetaBeys** (1.0, podio+deck+usage%), **WBO Winning Combos** (0.95). Web: **SBBL** (es,
win-rate), **PBI/probladers** (it), **okuyama3093**/**note** (ja), **polishbladers** (pl). YouTube
multilingua: Bulgari Cult Bistrot (it), BeyMac/Beybreakr/Casual Beyblader X (en), LBP/Galaxy (pt),
Flowbeyblade/BladerUlis (es), PoKSmon (id), Leonerd/BEYBLADE X KOREA (ko), namaste 阿土 (zh), MBBC (en).
**Declassate** a `parts-theory` (0.3): BeyBase, BeyXDB (tier list teoriche, non dati torneo).
Social login-walled in `manualVerification` (non scrappati, solo elencati nel report).

## Automazione (Windows Task Scheduler)

Sequenza giornaliera (i `.bat` invocano `claude --dangerously-skip-permissions -p`):
- **03:00** `update-parts.bat` → `/update-parts` (diff revid, di solito no-op da ~30s)
- **03:30** `collect-combos.bat` → `npm run collect:sources` (cache grezze, incl. MetaBeys/WBO)
- **03:45 → tutto il giorno, ogni 5 min** `fetch-transcripts.bat` (`--batch 1`, rate-limit YouTube)
- **22:00** `analyze-combos.bat` → `/update-combos`
- `update-combos.bat` resta come esecuzione manuale tutto-in-uno; `dev-server.bat` avvia Astro.

Registrazione task (eseguire una volta; attivare consapevolmente — fanno commit/push autonomi):

    schtasks /create /tn "Beyblade Update Parts" /tr "c:\claude-code\Personale\beyblade combos\update-parts.bat" /sc daily /st 03:00
    schtasks /create /tn "Beyblade Collect Combos" /tr "c:\claude-code\Personale\beyblade combos\collect-combos.bat" /sc daily /st 03:30
    schtasks /create /tn "Beyblade Transcripts" /tr "c:\claude-code\Personale\beyblade combos\fetch-transcripts.bat" /sc minute /mo 5
    schtasks /create /tn "Beyblade Analyze Combos" /tr "c:\claude-code\Personale\beyblade combos\analyze-combos.bat" /sc daily /st 22:00

## GitHub

- Repo: https://github.com/albertocabasvidani/beyblade-x-combo-finder
- Branch: master
- Deploy: GitHub Pages (automatico su push a master)
- URL: https://albertocabasvidani.github.io/beyblade-x-combo-finder/

## Convenzioni

- Nomi file minuscoli con trattini
- Componenti Preact in `.tsx`
- Componenti Astro in `.astro`
- Interfacce TypeScript in `src/lib/types.ts`
- Traduzioni in `src/i18n/en.json` e `src/i18n/it.json`

## Amazon Affiliate

### Architettura

Il sistema genera link Amazon sulle parti mancanti nelle combo card. Il flusso:

1. **Build time** (Astro frontmatter in `en/index.astro`, `it/index.astro`):
   - Importa `data/products.json` (catalogo 304 prodotti TT + Hasbro)
   - `buildProductLookup()` crea una mappa compatta `{ ratchets: { "3-60": "BX-01", ... }, bits: { "flat": "BX-01", ... } }`
   - Legge tag affiliate da `.env` (`AMAZON_TAG_IT`, `AMAZON_TAG_US`)
   - Passa `productLookup` + `amazonConfig` come props serializzate al Preact island

2. **Runtime** (Preact, `combo-card.tsx`):
   - I badge arancioni delle parti mancanti diventano `<a>` cliccabili
   - `buildAmazonSearchUrl()` costruisce l'URL di ricerca Amazon

### Strategia di ricerca Amazon

| Tipo parte | Metodo ricerca | Esempio query |
|------------|---------------|---------------|
| Blade | Nome diretto | `Beyblade X Phoenix Wing` |
| Lock Chip | Nome diretto | `Beyblade X Dran` |
| Main Blade | Nome diretto | `Beyblade X Brave` |
| Assist Blade | Nome diretto | `Beyblade X Slash` |
| Ratchet | Codice set da products.json | `Beyblade X BX-01` (contiene 3-60) |
| Bit | Codice set da products.json | `Beyblade X UX-02` (contiene Hexa) |

Ratchet e bit non si trovano su Amazon per nome (es. "Beyblade X Taper" → 0 risultati), quindi si cerca il codice del set che li contiene.

### File coinvolti

- `src/lib/amazon.ts` — `buildAmazonSearchUrl()`, `buildProductLookup()`, logica ricerca
- `data/products.json` — catalogo prodotti (aggiornato da `/update-parts`)
- `src/components/search/combo-card.tsx` — rendering link su parti missing
- `.env` — `AMAZON_TAG_IT`, `AMAZON_TAG_US` (vuoti = link senza tracking)

### Config

- Tag in `.env`: `AMAZON_TAG_IT`, `AMAZON_TAG_US`
- TLD basato su locale: IT → `amazon.it`, EN → `amazon.com`
- Disclosure nel footer (`footer.disclosure` in i18n)
- `products.json` aggiornato automaticamente da `/update-parts` (step 7)
