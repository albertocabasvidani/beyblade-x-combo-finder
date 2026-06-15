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
  `AMAZON_TAG_IT` / `AMAZON_TAG_US` per i link affiliate.
- `playwright-core` usa il Chrome di sistema (nessun download browser).

## Comandi

| Comando | Azione |
| :-- | :-- |
| `npm run dev` | Dev server su `localhost:4321` |
| `npm run build` | Build produzione in `./dist/` |
| `npm run build:parts` | Rigenera `data/parts.json` da `data/parts-master.json` (con guardrail) |
| `npm run collect:sources` | Raccoglie le cache grezze (Reddit, YouTube, Sheets, MetaBeys, WBO) |

Comandi Claude Code (in `.claude/commands/`):
- `/scrape-parts-master` — import iniziale del database parti da Beyblade Fandom Wiki (one-shot)
- `/update-parts` — aggiornamento giornaliero parti (diff per revisione)
- `/update-combos` — estrae e aggiorna le combo dalle cache, riconoscendo i nomi parte multilingua

## Architettura dati

- **`data/parts-master.json`** — file canonico delle parti, multilingua (nomi Takara Tomy / Hasbro /
  giapponese + alias per lingua). Da qui `build:parts` deriva `data/parts.json` (consumato dal sito),
  preservando gli id e con un guardrail che aborta se romperebbe i riferimenti di `combos.json`.
- **`data/combos.json`** — combo con score, tag e fonti.
- **`data/products.json`** — catalogo prodotti TT+Hasbro per i link Amazon.
- **`data/sources.json`** — fonti configurabili (con `lang`); social non scrappabili in `manualVerification`.

## Pipeline (confine IA / codice)

Le routine le esegue Claude. La parte **non deterministica** (leggere le pagine, riconoscere/matchare i
nomi delle parti in qualsiasi lingua) la fa l'**IA**; il **codice** fa solo accesso/fetch grezzo, dedup,
derivazione e validazione. Le pagine wiki si leggono via **API MediaWiki** (`api.php`, la `/wiki/` dà 403);
MetaBeys e WBO via **Playwright headless** (WBO è dietro Cloudflare: usare `WBO_HEADED=1` o affidarsi a
MetaBeys, che indicizza gli stessi eventi). Dettagli completi e scheduling in `CLAUDE.md`.

## Deploy

Push su `master` → GitHub Actions builda e pubblica su GitHub Pages.
