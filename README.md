# Beyblade X Combo Finder

Sito web per trovare le migliori combo Beyblade X in base alle parti possedute. Le combo provengono
da **risultati di tornei reali** raccolti da fonti competitive multilingua e aggiornati da una pipeline
agentica Claude Code.

- **Sito**: https://albertocabasvidani.github.io/beyblade-x-combo-finder/
- **Stack**: Astro (SSG) + Preact island, Tailwind CSS v4, GitHub Pages. Monolingua inglese servito
  dalla root (`/`, `/about/`); infrastruttura i18n IT in standby nel repo.

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
| `npm run parse:metabeys` | Parser deterministico MetaBeys (eventi+leaderboard, **BX e CX**) → `data/metabeys-evidence.json` |
| `npm run parse:wbo` | Parser deterministico WBO (segmentazione regex + risoluzione **BX e CX**) → `data/wbo-evidence.json`; residuo nel ledger `data/wbo-unresolved.json` |
| `npm run score:combos` | Ricalcola lo score CAS (deterministico) da `evidence`, scrive `combos.json` (materializza anche le CX; filtra il cutoff 12 mesi) |
| `npm run prune:combos` | Pruning: archivia in `combos-archive.json` le combo senza evidenza fresca. **Dry-run** di default; `-- --apply` scrive |
| `npm run typo:candidates` / `npm run typo:apply` | Bordo deterministico del recupero typo dal ledger (dump candidati per il subagent; gate + merge in `wbo-corrections.json`) |
| `npm run test:scoring` | Golden test dell'algoritmo di scoring |
| `npm run test:wbo` / `npm run test:wbo-unresolved` | Golden test del parser WBO (BX/CX) e del ledger |
| `npm run test:freshness` | Golden test del cutoff condiviso (`scripts/lib/freshness.ts`) |
| `npm run test:prune` | Golden test della partizione del pruning |

Comandi Claude Code (in `.claude/commands/`):
- `/scrape-parts-master` — import iniziale del database parti da Beyblade Fandom Wiki (one-shot)
- `/update-parts` — aggiornamento giornaliero parti (diff per revisione)
- `/update-combos` — estrae e aggiorna le combo dalle cache, riconoscendo i nomi parte multilingua

## Architettura dati

- **`data/parts-master.json`** — file canonico delle parti, multilingua (nomi Takara Tomy / Hasbro /
  giapponese + alias per lingua). Da qui `build:parts` deriva `data/parts.json` (consumato dal sito),
  preservando gli id e con un guardrail che aborta se romperebbe i riferimenti di `combos.json`.
- **`data/combos.json`** — combo con `evidence` (placements/usage/mentions), `scoreBreakdown` CAS, tag e fonti. Solo evidenza entro il **cutoff di 12 mesi**.
- **`data/combos-archive.json`** — combo archiviate dal pruning (senza evidenza fresca): fuori dal sito, reversibili.
- **`data/metabeys-evidence.json`** — evidenza torneo parsata in modo deterministico da MetaBeys (input dello scoring).
- **`data/wbo-evidence.json`** — evidenza torneo da WBO (parser deterministico, BX **e CX** con campi `lockChip/mainBlade/assistBlade/overBlade`).
- **`data/wbo-unresolved.json`** — ledger persistente delle righe WBO non risolte (chiave stabile, `status`, `category`): idempotente, segnala solo il delta nuovo, nulla si perde.
- **`data/wbo-corrections.json`** — mappa refuso→riga corretta (curata dal subagent typo, applicata da `parse:wbo`).
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
MetaBeys, che indicizza gli stessi eventi). Il thread WBO usa un parser **deterministico**
(segmentazione regex + risoluzione parti/sigle/id, dedup, stats); i casi non segmentabili li rifinisce
l'IA in `/update-combos` (abbonamento Claude Code, mai via API a pagamento). MetaBeys e WBO **paginano
lo storico fino a un cutoff di 12 mesi** (capped + resumable via cursori in `scan-history.json`); un
**pruning** deterministico (`prune:combos`, dry-run di default + guardrail) archivia le combo senza
evidenza fresca in `combos-archive.json`. Dettagli completi e scheduling in `CLAUDE.md`.

## Deploy

Push su `master` → GitHub Actions builda e pubblica su GitHub Pages.
