# Beyblade X Combo Finder

## Progetto

Sito web per trovare le migliori combo Beyblade X in base alle parti possedute. Database aggiornato tramite pipeline agentica Claude Code.

## Sottoprogetti

Tracking di backlog/issue/changelog per area in [`projects/`](projects/INDEX.md).

| Area | Cosa copre |
|---|---|
| [parts-database](projects/parts-database.md) | DB parti master multilingua: scrape wiki, derivazione, update, verify, Over Blade |
| [combo-pipeline](projects/combo-pipeline.md) | Raccolta fonti → estrazione IA → scoring CAS → scheduling |
| [web-frontend](projects/web-frontend.md) | Sito Astro/Preact (redesign "Arena"): ricerca unica parti, ranking unico BX+CX, temi chiaro/scuro, badge CAS. Monolingua EN su root |

## Tech Stack

- **Framework**: Astro (SSG) + Preact (island interattiva)
- **Styling**: Tailwind CSS v4 — design system "Arena" a doppio tema (token CSS in `src/styles/global.css`,
  toggle chiaro/scuro persistito in `localStorage`, anti-FOUC inline in `base-layout.astro`). Spec design
  in `docs/redesign-arena.md`. Font: Anton (display) / Saira (body) / JetBrains Mono (mono).
- **Hosting**: GitHub Pages (deploy automatico via Actions)
- **i18n**: sito **monolingua inglese** servito dalla root (`/`, `/about/`), nessun redirect.
  L'infrastruttura i18n resta in repo (`src/i18n/{en,it}.json`, `ui.ts`, tipo `Locale`): `it.json` è
  dormiente, riattivabile ricreando le route `/it/` e il selettore lingua nell'header.
- **Database**: JSON nel repo (`data/combos.json`, `data/parts.json`)
- **Pipeline**: Claude Code agentico via comando `/update-combos`

## Struttura Dati

### Combo Beyblade X
- **BX/UX Line** (3 parti): Blade + Ratchet + Bit
- **CX Line** (5 parti): Lock Chip + Main Blade + Assist Blade + Ratchet + Bit
- **CX Expand** (6 parti): Lock Chip + **Over Blade** + Main Blade + Assist Blade + Ratchet + Bit. Il "Metal Blade" del wiki È modellato come Main Blade; l'Over Blade (Break/Guard/Flow/Peak/Outer) è la categoria `overBlade` a sé (combo `overBlade` nullable, opzionale).
- Ratchet e Bit sono condivisi tra le linee

### File Dati
- `data/parts-master.json` — **file canonico** parti multilingua (names.tt/hasbro/ja/romaji + aliases per lingua, **`shortName` = codice ufficiale dei bit** es. H/FB/LR, stats, products, source). Fonte di verità del registro parti.
- `data/parts.json` — **derivato** da parts-master via `npm run build:parts` (schema consumato dal sito). NON editare a mano: si rigenera.
- `data/parts-master-conflicts.json` — casi ambigui dell'import per revisione umana (type_mismatch = rumore; gli over_blade ora sono categoria `overBlades` a sé, non più conflitti)
- `data/combos.json` — database combo con `evidence` (placements/usage/mentions; `usage` è uno **storico** di snapshot per il trend), `scoreBreakdown` CAS (con `lastPlacementDate`, `stadiums`, `usageTrend`) e fonti
- `data/metabeys-evidence.json` — evidenza torneo parsata in modo deterministico da MetaBeys (placements + usage), input dello scoring
- `data/wbo-evidence.json` — evidenza torneo da WBO (placements, con `stadium` xtreme/infinity), parser deterministico; input dello scoring
- `data/arca-cache.json` — cache post arca.live KR (Playwright; estrazione combo via IA in `/update-combos`)
- `data/bbx-weekly-cache.json` / `data/bbx-weekly-evidence.json` — BBX Weekly: raw + usage per-parte. **Cross-check, NON entra nel CAS**
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
- `npm run collect:sources` — raccoglie le cache grezze (Reddit, arca.live, YouTube, Sheets, MetaBeys, WBO, BBX Weekly)
- `npm run scrape:arca` — scraper arca.live KR (`ARCA_HEADED=1` se Cloudflare; headless = no-op non distruttivo)
- `npm run fetch:bbx-weekly` + `npm run parse:bbx-weekly` — BBX Weekly: cattura raw + estrae usage per-parte (ancorato al registro). Cross-check di freschezza/usage, **fuori dal CAS** (no doppioni)
- `/scrape-parts-master` — import iniziale parti da Fandom (one-shot, subagent)
- `/verify-parts-master` — verifica qualità del master parti
- `/update-parts` — aggiornamento giornaliero parti (diff revid)
- `/update-combos` — aggiorna database combo dalle cache (master multilingua, X-filter, dedup id-set)
- `/mine-reddit` — mina la cache Reddit **a blocchi** (idempotente via scan-history): legge tutta la cache, non la skimma. Per backfill e marcia normale
- `npm run reddit:batch -- next|done` — batcher deterministico per `/mine-reddit` (serve/marca blocchi)
- `npx tsx scripts/reddit-merge.ts` — merge deterministico dei combo estratti da `/mine-reddit` (`tmp/reddit-extracted.json`, prodotto dall'IA) in `combos.json`: deriva id/line/type/displayName da `parts.json`, X-filter su blade/mainBlade, dedup dell'evidence per chiave stabile (idempotente). Lo score lo ricalcola poi `score:combos`
- `npm run parse:metabeys` — parser deterministico MetaBeys (eventi+leaderboard) → `metabeys-evidence.json` (placements+usage; ambigui in `unresolved`)
- `npm run parse:wbo` — parser deterministico WBO (segmentazione regex + risoluzione) → `wbo-evidence.json` (placements; CX/sigle ignote/eventi senza podio in `unresolved`)
- `npm run score:combos` — ricalcola gli score CAS deterministici da `evidence` (algoritmo in `src/lib/scoring.ts`, spec in `docs/scoring-algorithm.md`)
- `npm run test:scoring` — golden test dell'algoritmo CAS
- `npm run test:wbo` — golden test della parte deterministica del parser WBO

## Pipeline Dati

### Confine IA / codice (principio architetturale)
Le routine (import parti, update giornalieri, analisi combo) le esegue **Claude**. Tutto ciò che è
**non deterministico — leggere/interpretare pagine, riconoscere e matchare i nomi delle parti in
qualsiasi lingua — lo fa l'IA** (comandi + subagent). Il **codice** fa solo ciò che è deterministico:
accesso/fetch grezzo, **parsing delle fonti strutturate** (MetaBeys eventi+leaderboard), dedup
(id/revid/hash), derivazione di formato, validazione referenziale, e il **calcolo dello score CAS**
(da `evidence` a numero — `src/lib/scoring.ts`). L'IA estrae l'evidenza dalle fonti narrative e dai
casi `unresolved`; non calcola mai lo score né ri-parsa ciò che il parser deterministico ha risolto.

**WBO**: il thread-forum è eterogeneo (token incollati, marcatori di piazzamento misti, quote/ads da
scartare), ma `parse:wbo` lo gestisce **interamente a codice deterministico**
(`scripts/lib/wbo-parse.ts`): segmentazione del layout via regex + risoluzione parti/sigle/id, dedup,
stats. I casi che la segmentazione non risolve (eventi-ladder, layout insoliti) restano in
`unresolved` e li rifinisce l'IA in `/update-combos`, che gira **sull'abbonamento Claude Code** — mai
via API a pagamento (regola: non pagare due volte ciò che l'abbonamento già copre).

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
- Reddit backfill storico (one-off): `REDDIT_BACKFILL=1` (con `REDDIT_HEADED=1`) pagina a fondo ogni query
  (cursore `after`, ~1000/query) e NON pota la cache (no `KEEP_TOP`). Seguire SUBITO con `/update-combos`,
  prima che un run normale (che applica `KEEP_TOP`) la poti.
- Le cache grezze le interpreta `/update-combos` (estrazione, match multilingua, dedup id-set, scoring).

### Scoring combo (CAS, deterministico)
Lo scoring NON è più una stima inline dell'IA: è il **Competitive Authority Score** calcolato dal
codice. `/update-combos` (IA) popola il blocco `evidence` di ogni combo distinguendo **risultati**
(`placements`/`usage`) da **opinioni** (`mentions`); `parse:metabeys` e `parse:wbo` producono
l'evidenza torneo in `metabeys-evidence.json` e `wbo-evidence.json` (entrambi parser deterministici);
`score:combos` le **unisce** (placements deduplicati per evento fisico — data+posizione+nome evento —
per non doppiare gli eventi che MetaBeys e WBO indicizzano entrambi; preserva anche i placement
narrative già raccolti, es. Reddit), applica `src/lib/scoring.ts` e scrive `scoreBreakdown` + tag
gestiti (`meta` ≥8.5, `top-tier` ≥7.0, `tournament-proven`, `theory-only`, `rising` implementato:
momentum recente>storico). Algoritmo, pesi e costanti in `docs/scoring-algorithm.md`.
- **`useConfidence` ATTIVO**: shrinkage low-sample (≈117/148 combo a evento singolo) — `score:combos`
  chiama `scoreCombo(ev, { ref, useConfidence: true })`.
- **Stadio**: i placement WBO portano `stadium` (xtreme/infinity, da `Stadium:` del thread); MetaBeys no.
  Esposto come filtro/badge UI, NON pesato nello score. Lo storico `usage` alimenta il `usageTrend`.
- Peso per **tipologia** di fonte (`TIER_WEIGHT`: structured 1.0 / narrative 0.6 / theory 0.3), non
  per singola fonte: WBO è scorato 1.0, il `weight` di sources.json serve solo ai link UI.
- Limite residuo dedup: senza id-evento condiviso cross-fonte, nomi del tutto diversi restano doppi
  (mitigato: eventName WBO ora è il titolo torneo, non lo username; `normName` togle date/parentesi).

### Dipendenze
- Node: `tsx`, `playwright-core` (usa il Chrome di sistema). Python: `youtube_transcript_api`.
- `.env`: `YOUTUBE_API_KEY` (YouTube Data API v3 + Sheets API v4), `AMAZON_TAG_IT/US`.

### Fonti torneo (in `data/sources.json`, con `lang`)
Strutturate: **MetaBeys** (1.0, podio+deck+usage%), **WBO Winning Combos** (0.95). Web: **SBBL** (es,
win-rate), **PBI/probladers** (it), **okuyama3093** (ja), **arca.live** (ko, forum pubblico scrappato
via Playwright). **kamen_a** (`wbo-overseas-note`, ja): prize-score WBO **aggregato per-parte**, usato
come segnale soft/mention — MAI promosso a placements (duplicherebbe WBO). YouTube multilingua: Bulgari
Cult Bistrot (it), BeyMac/Beybreakr/Casual Beyblader X (en), LBP/Galaxy (pt), Flowbeyblade/BladerUlis
(es), PoKSmon (id), Leonerd/BEYBLADE X KOREA (ko), namaste 阿土 (zh), MBBC (en).
**Declassate** a `parts-theory` (0.3): BeyBase, BeyXDB (tier list teoriche). **Cross-check fuori dal
CAS**: BBX Weekly (`parts-usage`, ranking per-parte). **BBX.gg escluso** (championship/belt + eventi
sovrapposti a WBO senza id condiviso → rischio doppioni). Facebook PH/MY e Instagram restano in
`manualVerification` (non automatizzabili senza login/API).

## Automazione (Windows Task Scheduler)

Il PC è spento di notte → tutta la pipeline gira in **un'unica sequenza alle 08:00** (utente loggato).
`daily-pipeline.bat` esegue in ordine: `/update-parts` → `collect:sources` (con Reddit/WBO/arca **headed**
via `REDDIT_HEADED=1`/`WBO_HEADED=1`/`ARCA_HEADED=1`, lette da collect:sources; BBX Weekly headless) →
`/update-combos` (fonti strutturate) → `/mine-reddit` (Reddit a blocchi). Reddit riusa il login del
profilo `.playwright-beyblade`; WBO/arca possono chiedere il captcha Cloudflare (mattina = utente al PC
per risolverlo). I transcript YouTube girano a
parte ogni 5 min (`--batch 1`, rate-limit): i video nuovi scoperti oggi vengono trascritti nelle ore
successive e raccolti dai run seguenti (eventually-consistent). `/update-parts`, `/update-combos` e
`/mine-reddit` fanno **commit/push autonomi su master**.

Durata `/update-combos`: **~20-22 min** a run (misurato 16/06/2026 via `claude -p`: parser
MetaBeys/WBO + scoring CAS + estrazione fonti strutturate + build + commit/push). **Non** mina la
cache Reddit a fondo: la cache (`reddit-cache.json`, migliaia di righe) eccede un singolo Read, quindi
`/update-combos` ne vede solo una fetta. Reddit lo mina `/mine-reddit`, che la legge **a blocchi**
(`reddit:batch`) marcando ogni post in `scan-history` — idempotente, riprende dove era rimasto, e
copre sia un backfill (~900 post → molti blocchi) sia i pochi post nuovi del giorno (1 blocco).
Durata `/mine-reddit`: **~39 min** per un backfill da 934 post (16 blocchi da 60; misurato 16/06/2026,
ha portato i combo da 204 a 457). Nella marcia normale è 1 blocco → pochi minuti.

Bat manuali: `collect-social.bat` (solo Reddit+WBO headed), `collect-combos.bat` (solo collect
headless), `update-combos.bat` (collect+analyze), `dev-server.bat` (Astro).

Registrazione task (eseguire una volta; il task pipeline ha `/it` = gira solo se l'utente è loggato,
necessario per i browser headed). Path con spazi quotati dentro `/tr`:

    schtasks /create /tn "Beyblade Daily Pipeline" /tr "\"c:\claude-code\Personale\beyblade combos\daily-pipeline.bat\"" /sc daily /st 08:00 /it /f
    schtasks /create /tn "Beyblade Transcripts" /tr "wscript.exe \"c:\claude-code\Personale\beyblade combos\run-transcripts-hidden.vbs\"" /sc minute /mo 5 /f

Il task transcripts gira **a finestra nascosta**: l'azione lancia `wscript.exe run-transcripts-hidden.vbs`,
che a sua volta avvia `fetch-transcripts.bat` con console nascosta (`WScript.Shell.Run ..., 0`). Necessario
perché ogni 5 min altrimenti compariva una finestra cmd nella sessione utente. Resta nella sessione loggata
(non in background di sistema) perché Python è installato per-utente e serve l'accesso alla rete.

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
- Traduzioni in `src/i18n/en.json` (attiva) e `src/i18n/it.json` (dormiente, vedi i18n in Tech Stack)

## Amazon Affiliate (disattivato nella UI dal redesign "Arena")

Il redesign "Arena" ha **rimosso i link Amazon dalla UI** (niente badge link sulle parti mancanti, niente
banner, niente disclosure nel footer). I chip delle parti mancanti ora sono solo informativi (`! Nome`).

La logica resta in repo per un eventuale ripristino, ma **non è più importata dal frontend**:
`src/lib/amazon.ts` (`buildAmazonSearchUrl`, `buildProductLookup`) e `data/products.json` (ancora
rigenerato da `/update-parts`, step 7) non vengono più usati da `combo-card.tsx`/`combo-search.tsx`.

Per riattivarli servirebbe: ripassare `amazonConfig`/`productLookup` da `pages/{en,it}/index.astro` a
`ComboSearch`, rifare il rendering dei link nei chip mancanti, e reintrodurre la disclosure nel footer.
Gotcha storico (se si riattiva): blade/lock chip/main blade/assist blade si cercano per **nome diretto**
(`Beyblade X Phoenix Wing`); ratchet e bit **per nome danno 0 risultati**, quindi si cerca il **codice del
set** che li contiene (`3-60` → `Beyblade X BX-01`, `Hexa` → `Beyblade X UX-02`). Config in `.env`:
`AMAZON_TAG_IT`, `AMAZON_TAG_US`; TLD per locale (IT → `amazon.it`, EN → `amazon.com`).
