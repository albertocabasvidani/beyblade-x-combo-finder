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
- Ratchet e Bit sono condivisi tra le linee

### File Dati
- `data/parts.json` — registro parti (blade, lockChip, mainBlade, assistBlade, ratchet, bit)
- `data/combos.json` — database combo con score e fonti (77 combo: 66 BX + 11 CX)
- `data/sources.json` — fonti configurabili per la pipeline (editabile dall'utente)
- `data/youtube-cache.json` — cache metadati video YouTube (titolo, descrizione)
- `data/youtube-transcripts.json` — trascrizioni auto-generate dei video YouTube
- `data/reddit-cache.json` — cache post Reddit r/Beyblade
- `data/sheets-cache.json` — cache Google Sheets (WBO tournament data)
- `data/scan-history.json` — tracking video/post/sheets già scansionati

## Comandi

- `npm run dev` — server sviluppo
- `npm run build` — build produzione
- `/update-combos` — aggiorna database combo (comando Claude Code locale)
- `/update-parts` — cerca e aggiunge nuove parti Beyblade X

## Pipeline Dati

### Script raccolta (eseguiti da `npm run collect:sources`)
- `npm run scrape:reddit` — scrapa r/Beyblade via Reddit JSON API (no auth)
- `npm run fetch:youtube` — fetcha metadati video via YouTube Data API v3 (richiede API key)
- `npm run fetch:sheets` — fetcha Google Sheets WBO tournament data
- `npm run fetch:transcripts` — scarica trascrizioni video via Python `youtube_transcript_api`

### Dipendenze script
- **Node.js**: tsx (devDep)
- **Python**: `youtube_transcript_api` (`pip install youtube-transcript-api`)
- **API key**: `YOUTUBE_API_KEY` in `.env` (YouTube Data API v3 + Google Sheets API v4)

### Fonti dati e affidabilità
| Fonte | Tipo | Peso |
|-------|------|------|
| WBO Tournament Data (Google Sheets) | Dati torneo con punti e vittorie | 1.0 |
| World Championship 2025 | Combo vincenti evento ufficiale | 0.9 |
| MBBC Theory Crafting | Video test benchmark (6+ video) | 0.9 |
| BeyBase | Articoli tier list curati | 1.0 |
| HobbyTalk Haru Ren | Video "My Favorite" con capitoli | 0.8 |
| AWWC TOP 3 COMBOS | Video top 3 per blade (solo trascrizioni) | 0.8 |
| Jacob Pomegranate | Video combo review/analisi | 0.8 |
| Reddit r/Beyblade | Post community, tier list utenti | 0.5-0.7 |

## Automazione (Windows Task Scheduler)

- `update-combos.bat` — raccolta dati + aggiornamento combo via Claude CLI
- `update-parts.bat` — aggiornamento parti via Claude CLI
- `fetch-transcripts.bat` — scarica 1 trascrizione per esecuzione (ogni 5 min)
- `dev-server.bat` — avvia server di sviluppo Astro
- Configurare in Task Scheduler: trigger settimanale per combo/parts, ogni 5 min per transcripts

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
