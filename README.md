# Beyblade X Combo Finder

Sito web per trovare le migliori combo Beyblade X in base alle parti possedute. Le combo provengono
da **risultati di tornei reali** raccolti da fonti competitive multilingua e aggiornati da una pipeline
agentica Claude Code.

- **Sito**: https://albertocabasvidani.github.io/beyblade-x-combo-finder/
- **Stack**: Astro (SSG) + Preact island, Tailwind CSS v4, GitHub Pages. i18n EN/IT.

## Installazione

```sh
npm install
```

Richiede inoltre (per la pipeline dati):
- Python con `youtube-transcript-api` (`pip install youtube-transcript-api`)
- `.env` con `YOUTUBE_API_KEY` (YouTube Data API v3 + Google Sheets API v4) e, opzionali,
  `AMAZON_TAG_IT` / `AMAZON_TAG_US` per i link affiliate e `ANTHROPIC_API_KEY` per la segmentazione
  Haiku del parser WBO (senza, `parse:wbo` usa il fallback deterministico).
- `playwright-core` usa il Chrome di sistema (nessun download browser).

## Comandi

| Comando | Azione |
| :-- | :-- |
| `npm run dev` | Dev server su `localhost:4321` |
| `npm run build` | Build produzione in `./dist/` |
| `npm run build:parts` | Rigenera `data/parts.json` da `data/parts-master.json` (con guardrail) |
| `npm run collect:sources` | Raccoglie le cache grezze (Reddit, YouTube, Sheets, MetaBeys, WBO) |
| `npm run parse:metabeys` | Parser deterministico MetaBeys (eventi+leaderboard) → `data/metabeys-evidence.json` |
| `npm run parse:wbo` | Parser ibrido WBO (segmentazione Haiku + risoluzione deterministica) → `data/wbo-evidence.json` |
| `npm run score:combos` | Ricalcola lo score CAS (deterministico) da `evidence`, scrive `combos.json` |
| `npm run test:scoring` | Golden test dell'algoritmo di scoring |
| `npm run test:wbo` | Golden test della parte deterministica del parser WBO |

Comandi Claude Code (in `.claude/commands/`):
- `/scrape-parts-master` — import iniziale del database parti da Beyblade Fandom Wiki (one-shot)
- `/update-parts` — aggiornamento giornaliero parti (diff per revisione)
- `/update-combos` — estrae e aggiorna le combo dalle cache, riconoscendo i nomi parte multilingua

## Architettura dati

- **`data/parts-master.json`** — file canonico delle parti, multilingua (nomi Takara Tomy / Hasbro /
  giapponese + alias per lingua). Da qui `build:parts` deriva `data/parts.json` (consumato dal sito),
  preservando gli id e con un guardrail che aborta se romperebbe i riferimenti di `combos.json`.
- **`data/combos.json`** — combo con `evidence` (placements/usage/mentions), `scoreBreakdown` CAS, tag e fonti.
- **`data/metabeys-evidence.json`** — evidenza torneo parsata in modo deterministico da MetaBeys (input dello scoring).
- **`data/wbo-evidence.json`** — evidenza torneo da WBO (parser ibrido: segmentazione Haiku + risoluzione deterministica).
- **`data/products.json`** — catalogo prodotti TT+Hasbro per i link Amazon.
- **`data/sources.json`** — fonti configurabili (con `lang`); social non scrappabili in `manualVerification`.

## Scoring (Competitive Authority Score)

Lo score (0–10) misura l'**autorevolezza competitiva** di una combo ed è calcolato **dal codice** in
modo deterministico (`src/lib/scoring.ts`), non stimato dall'IA. Combina tre pilastri con rendimenti
decrescenti: **performance** nei tornei (piazzamento × dimensione evento × affidabilità fonte ×
decadimento temporale), **presenza** nel meta (usage share + eventi indipendenti) e **corroborazione**
(fonti distinte). L'IA estrae l'`evidence` dalle fonti; il codice la trasforma in numero. Algoritmo,
pesi e costanti documentati in [`docs/scoring-algorithm.md`](docs/scoring-algorithm.md).

## Pipeline (confine IA / codice)

Le routine le esegue Claude. La parte **non deterministica** (leggere le pagine narrative, riconoscere/
matchare i nomi delle parti in qualsiasi lingua) la fa l'**IA**; il **codice** fa accesso/fetch grezzo,
**parsing delle fonti strutturate** (MetaBeys), dedup, derivazione, validazione e il **calcolo dello
score CAS**. Le pagine wiki si leggono via **API MediaWiki** (`api.php`, la `/wiki/` dà 403);
MetaBeys e WBO via **Playwright headless** (WBO è dietro Cloudflare: usare `WBO_HEADED=1` o affidarsi a
MetaBeys, che indicizza gli stessi eventi). Il thread WBO ha un parser **ibrido**: la segmentazione del
layout (eterogeneo) la fa Haiku, la risoluzione parti/sigle/id resta codice deterministico. Dettagli
completi e scheduling in `CLAUDE.md`.

## Deploy

Push su `master` → GitHub Actions builda e pubblica su GitHub Pages.
