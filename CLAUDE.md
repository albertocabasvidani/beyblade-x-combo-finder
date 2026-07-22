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
- `data/combos.json` — database combo con `evidence` (placements/usage/mentions; `usage` è uno **storico** di snapshot per il trend), `scoreBreakdown` CAS (con `lastPlacementDate`, `stadiums`, `usageTrend`) e fonti. Contiene **solo evidenza entro il cutoff di 12 mesi** (filtrata da `score:combos`)
- `data/combos-archive.json` — combo rimaste **senza evidenza fresca** dopo il pruning (`prune:combos`): archiviate (non eliminate) con `archivedReason`/`archivedDate`, fuori dal sito e dal ranking. Reversibile: se la combo ri-piazza, `score:combos` la ricrea e `prune:combos` la toglie dall'archivio
- `data/metabeys-evidence.json` — evidenza torneo parsata in modo deterministico da MetaBeys (placements + usage, **BX e CX**), input dello scoring
- `data/wbo-evidence.json` — evidenza torneo da WBO (placements BX **e CX**, con `stadium` xtreme/infinity), parser deterministico; input dello scoring. Le CX portano `lockChip/mainBlade/assistBlade/overBlade`
- `data/wbo-unresolved.json` — **ledger persistente** delle righe-combo WBO non risolte (chiave stabile = hash della forma normalizzata, `status` new/triaged/ignored, `category`, `occurrences`). Idempotente: ogni run di `parse:wbo` aggiorna lo stato e segnala solo il **delta nuovo**; nessun unresolved si perde. Esclude gli avvisi a livello evento (oltre-cutoff, no-podio)
- `data/wbo-corrections.json` — mappa `norm(riga) → riga corretta` per i refusi, curata dal subagent typo di `/update-combos` (proposte gated: la riga corretta DEVE risolvere). `parse:wbo` la applica PRIMA del parsing, così i refusi risolvono in contesto e spariscono dal ledger
- `data/arca-cache.json` — cache post arca.live KR (Playwright; estrazione combo via IA in `/update-combos`)
- `data/bbx-weekly-cache.json` / `data/bbx-weekly-evidence.json` — BBX Weekly: raw + usage per-parte. **Cross-check, NON entra nel CAS**
- `data/products.json` — catalogo prodotti TT+Hasbro (link Amazon); referenzia gli id parte
- `data/sources.json` — fonti configurabili (con `lang`, `manualVerification`); editabile dall'utente
- `data/source-candidates.json` — staging dei candidati-fonte scoperti da `/discover-sources` (`status` proposed/accepted/rejected + `knownNegatives`): dedup persistente tra run. NON è una fonte attiva — la promozione a `sources.json` è manuale
- `data/youtube-cache.json`, `data/youtube-transcripts.json`, `data/reddit-cache.json`, `data/sheets-cache.json` — cache grezze fonti
- `data/metabeys-cache.json` — cache eventi+leaderboard MetaBeys (Playwright headless); eventi potati per data (entro 12 mesi)
- `data/wbo-cache.json` — cache thread WBO (Playwright; Cloudflare può bloccare headless); `threads[key].pages` per pagina + `raw` concatenato (entro 12 mesi)
- `data/scan-history.json` — dedup: scannedVideos/Sheets/RedditPosts/Pages(+revid)/Events(+`eventDate`)/Posts; cursori di backfill `metabeysBackfill`/`wboBackfill` (`nextPage`/`done`)

## Comandi

- `npm run dev` — server sviluppo
- `npm run build` — build produzione
- `npm run build:parts` — rigenera `parts.json` da `parts-master.json` (guardrail: aborta se rompe i riferimenti di combos.json)
- `npm run verify:wiki` — verifica completezza del master contro la fonte affidabile (category per-tipo del Fandom Wiki, X-pure; blade filtrati su `Category:Beyblade X` perché `Category:Blades` è mista X+Burst). Riporta mancanti/extra. Obiettivo: 0 mancanti.
- `npm run collect:sources` — raccoglie le cache grezze (Reddit, arca.live, YouTube, Sheets, MetaBeys, WBO, BBX Weekly)
- `npm run discover:youtube` — ricerca deterministica di NUOVI canali YouTube (search API multilingua, dedup vs `sources.json` + `source-candidates.json`) → `tmp/discover-youtube.json`; input di `/discover-sources`
- `npm run scrape:arca` — scraper arca.live KR (`ARCA_HEADED=1` se Cloudflare; headless = no-op non distruttivo)
- `npm run fetch:bbx-weekly` + `npm run parse:bbx-weekly` — BBX Weekly: cattura raw + estrae usage per-parte (ancorato al registro). Cross-check di freschezza/usage, **fuori dal CAS** (no doppioni)
- `/scrape-parts-master` — import iniziale parti da Fandom (one-shot, subagent)
- `/verify-parts-master` — verifica qualità del master parti
- `/update-parts` — aggiornamento giornaliero parti (diff revid)
- `/update-combos` — aggiorna database combo dalle cache (master multilingua, X-filter, dedup id-set)
- `/mine-reddit` — mina la cache Reddit **a blocchi** (idempotente via scan-history): legge tutta la cache, non la skimma. Per backfill e marcia normale
- `/judge-youtube` — giudica la rilevanza dei video YouTube **a blocchi** (idempotente, flag in cache): per ogni video `prefilter:"pass"` decide `relevant` (combo/meta/torneo competitivo Beyblade X? Burst/unboxing/casual → false) e `lang` (lingua reale del parlato), leggendo titolo+descrizione+tag multilingua. I transcript si scaricano solo dei `relevant`
- `npm run youtube:judge -- next|done` — batcher deterministico per `/judge-youtube` (serve un blocco / fonde i verdetti IA da `tmp/youtube-judge-extracted.json` nella cache)
- `/discover-sources` — cerca NUOVE fonti tornei (YouTube/siti/blog/forum/social), le valuta, esclude le note (dedup vs `sources.json` + `source-candidates.json`) e manda una proposta motivata via email (corpo leggibile, no allegati). Loop di feedback: rispondi all'email in linguaggio naturale (approva/scarta) e il **run successivo** promuove gli approvati in `sources.json` (o `manualVerification` per i social) e marca i rifiutati. Staging in `data/source-candidates.json` (campo `lastProposal` per ritrovare il thread del feedback)
- `npm run reddit:batch -- next|done` — batcher deterministico per `/mine-reddit` (serve/marca blocchi)
- `npx tsx scripts/reddit-merge.ts` — merge deterministico dei combo estratti da `/mine-reddit` (`tmp/reddit-extracted.json`, prodotto dall'IA) in `combos.json`: deriva id/line/type/displayName da `parts.json`, X-filter su blade/mainBlade, dedup dell'evidence per chiave stabile (idempotente). Lo score lo ricalcola poi `score:combos`
- `npm run parse:metabeys` — parser deterministico MetaBeys (eventi+leaderboard) → `metabeys-evidence.json`. Risolve **BX (3 segmenti) e CX (4 segmenti** `lockChip mainBlade [over] / assist / ratchet / bit`, via `cx-resolve.ts`); solo typo/incompleti restano in `unresolved` (placements+usage)
- `npm run parse:wbo` — parser deterministico WBO (segmentazione regex + risoluzione **BX e CX**) → `wbo-evidence.json`. Risolve le CX (lockChip+mainBlade+assist[+over], order-agnostic + Western) via `scripts/lib/cx-resolve.ts`; il residuo va nel ledger `wbo-unresolved.json` (delta nuovo segnalato). Applica `wbo-corrections.json` (refusi) prima del parsing
- `npm run score:combos` — ricalcola gli score CAS deterministici da `evidence` (algoritmo in `src/lib/scoring.ts`, spec in `docs/scoring-algorithm.md`); filtra l'evidenza per il **cutoff 12 mesi** (`scripts/lib/freshness.ts`). Materializza anche le **combo CX** dall'evidenza WBO (copia `lockChip/mainBlade/assistBlade/overBlade`)
- `npm run typo:candidates` / `npm run typo:apply` — bordo deterministico del recupero typo: dump del sottoinsieme `typo` del ledger + nomi registro (`tmp/typo-candidates.json`) per il subagent; gate (ri-parsa) + merge delle correzioni accettate in `wbo-corrections.json`
- `npm run prune:combos` — pruning deterministico: archivia in `combos-archive.json` le combo senza evidenza fresca (cutoff 12 mesi). **Default dry-run**; `-- --apply` scrive. Guardrail: aborta se le orfane superano `PRUNE_GUARD_PCT` (60%) o se l'evidenza torneo è a 0
- `npm run test:scoring` — golden test dell'algoritmo CAS
- `npm run test:wbo` — golden test del parser WBO (BX, CX order-agnostic/Western, hardening BX, casi che restano unresolved)
- `npm run test:wbo-unresolved` — golden test del ledger (idempotenza, preservazione `status`, categorizzazione)
- `npm run test:freshness` / `npm run test:prune` — golden test del cutoff condiviso e della partizione del pruning

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
stats. La **data** evento: "Date: MM/DD/YYYY" → timestamp del post "Mon. GG, AAAA" (formato MyBB, es.
"Jun. 09, 2026") → MM/DD/YYYY → fallback `fetchedAt`, ogni candidato **validato** (scarta non-date di
calendario tipo `2026-06-31`).

Il parser risolve **sia BX sia CX** in modo deterministico. Le **CX** (lockChip+mainBlade glued CamelCase,
assist come sigla/nome, eventuale over-blade gluato all'assist) le scompone `scripts/lib/cx-resolve.ts`:
**order-agnostic** (lockChip/mainBlade in qualsiasi ordine) e **Western-aware** (match anche sui nomi
Hasbro, es. "Courage"=Brave), **conservativo** (risolve solo su assegnazione univoca; ambiguo → ledger,
niente combo inventate). Hardening BX: i nomi Western che inglobano ratchet+bit ("Rock Golem 1-60UN")
vengono indicizzati anche nudi; prefisso-username ("Beezo PhoenixWing") strippato se la coda risolve.
Recupero misurato: ~87% delle righe prima `unresolved`. Le CX entrano nello scoring come le BX (id-set
`lockChip-[overBlade]-mainBlade-assistBlade-ratchet-bit`). `cx-resolve.ts` è **condiviso con
`parse:metabeys`**, che risolve le CX a 4 segmenti (`core / assist / ratchet / bit`) componendo
`seg[0]+' '+seg[1]` e passandolo allo stesso resolver.

Il **residuo irrisolvibile** (refusi, dato mancante "?", BK/OW senza assist, varianti ambigue) non si
perde né ricompare come lavoro nuovo: vive nel **ledger** `wbo-unresolved.json` (idempotente, delta
nuovo segnalato). I **refusi** li recupera un subagent economico in `/update-combos` (proposte gated +
giudice → `wbo-corrections.json`, applicate al parsing successivo), **sull'abbonamento Claude Code** —
mai via API a pagamento. L'IA non calcola mai lo score né ri-parsa ciò che il parser ha già risolto.

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
  `fetch:youtube` (API key; discovery + **arricchimento** via `videos?part=snippet`: tags, descrizione
  completa, `defaultAudioLanguage` → cache **cumulativa** + **pre-filtro deterministico**
  `scripts/lib/youtube-relevance.ts` che scarta off-topic/franchise estranei), `fetch:sheets`,
  `fetch:metabeys` (Playwright headless; **paginazione storica** `?page=N`, ~9 eventi/pagina, capped a
  `META_MAX_PAGES`/run, cursore `metabeysBackfill`, stop al cutoff),
  `fetch:wbo` (Playwright; Cloudflare blocca headless → `WBO_HEADED=1`, oppure ci si affida a MetaBeys
  che indicizza gli stessi eventi WBO; **paginazione all'indietro** del thread `?page=N`, capped a
  `WBO_MAX_PAGES`/run, cursore `wboBackfill`, canale `printthread` opzionale via `WBO_PRINTTHREAD=1`).
  **Profilo dedicato `.playwright-wbo`**, non condiviso: quando usava `.playwright-beyblade` insieme a
  Reddit/arca, un Chrome lasciato aperto da Reddit in ETIMEDOUT lo faceva fallire con *"Target page,
  context or browser has been closed"* — in **tutti** i run dal 29/06, mentre da solo completa in ~30s.
  Il profilo serve solo ai cookie Cloudflare, nessun login condiviso.
  `fetch:transcripts` gira SEPARATO (ogni 5 min, `--batch 1`):
  scarica solo i video `relevant:true` (giudicati da `/judge-youtube`), nella lingua reale del video
  (`youtube_transcript_api.list()` + `.translate('en')` se non-EN e traducibile).
- Reddit/WBO girano headed+manuale (lo scheduler headless li lascia no-op): rieseguire a mano quando serve dato fresco.
- Reddit backfill storico (one-off): `REDDIT_BACKFILL=1` (con `REDDIT_HEADED=1`) pagina a fondo ogni query
  (cursore `after`, ~1000/query) e NON pota la cache (no `KEEP_TOP`). Seguire SUBITO con `/update-combos`,
  prima che un run normale (che applica `KEEP_TOP`) la poti.
- Le cache grezze le interpreta `/update-combos` (estrazione, match multilingua, dedup id-set, scoring).

### Cutoff temporale e pruning (deterministici)
Cutoff condiviso **12 mesi** in `scripts/lib/freshness.ts` (`CUTOFF_MONTHS`, override `COMBO_CUTOFF_MONTHS`):
unica fonte di verità applicata in **fetch** (stop paginazione storica), **parse** (scarto dei placement
oltre cutoff) e **score** (filtro dell'evidenza unita). Coerente col decay (emivita 75gg: a 12 mesi il
peso è già ~0.03). I fetcher paginano lo storico in modo **capped + resumable** (cursori in
`scan-history.json`; default 3 pagine/run, backfill profondo one-off con `META_MAX_PAGES`/`WBO_MAX_PAGES`
alti). Il **pruning** (`prune:combos`) archivia in `combos-archive.json` le combo senza evidenza fresca:
deterministico, **dry-run di default** (`-- --apply` scrive), guardrail (aborta se orfane > `PRUNE_GUARD_PCT`
60% o evidenza torneo a 0), idempotente, riconcilia gli id tornati attivi. Gira dentro `/update-combos`
dopo `score:combos`, prima di `build`.

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
- **`useConfidence` ATTIVO**: shrinkage low-sample — col backfill 12 mesi (~2027 eventi, ~3285 combo)
  la coda è dominata da combo a evento singolo, penalizzate dal confidence. `score:combos` chiama
  `scoreCombo(ev, { ref, useConfidence: true })`.
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

Il PC è spento di notte → tutto gira di mattina, in **due task distinti**.

**07:30 — `collect-sources-task.bat`** (task "Beyblade Collect Sources", `/it`): sola raccolta delle
cache grezze, con Reddit/WBO/arca **headed** (`REDDIT_HEADED=1`/`WBO_HEADED=1`/`ARCA_HEADED=1`; BBX
Weekly headless). Reddit riusa il login del profilo `.playwright-beyblade`; WBO ha il **profilo
dedicato** `.playwright-wbo` (vedi sotto) e può chiedere il captcha Cloudflare.

**08:00 — `daily-pipeline.bat`** (task "Beyblade Daily Pipeline", `/it`): `/update-parts` →
`/judge-youtube` → `/update-combos` → `/mine-reddit`. **Nessuno di questi step apre browser**: lavorano
sulle cache raccolte mezz'ora prima, di cui il log riporta la data di ultima scrittura.
**Modello fissato per ogni comando della pipeline.** Senza vincolo esplicito ogni run ereditava il
default di sessione del momento (Opus a effort variabile, a volte Fable): lavoro meccanico pagato come
lavoro di punta. Il vincolo sta in due posti — flag `--model`/`--effort` in tutti i `.bat` e frontmatter
`model:`/`effort:` nel `.md` del comando:

> **Gotcha (verificato 21/07/2026)**: il frontmatter vale solo con l'invocazione **diretta**
> (`-p "/update-parts"`). Con `-p "Esegui /update-parts"` il comando passa dal tool Skill e il
> frontmatter viene **ignorato**: resta il modello della sessione, più un turno sprecato a decidere di
> invocarlo. Per questo tutti i `.bat` usano la forma diretta `-p "/comando"`, mai `-p "Esegui /comando"`.

| Comando | Modello | Effort | Perché |
|---|---|---|---|
| `/update-parts` | sonnet | medium | diff revid, estrazione strutturata, merge |
| `/judge-youtube` | sonnet | medium | classificazione a blocchi (rilevanza + lingua) |
| `/mine-reddit` | sonnet | medium | estrazione + match nomi parte, merge deterministico a valle |
| `/update-combos` | sonnet | high | scrive `combos.json` da fonti narrative: estrazione, ma delicata |
| `/discover-sources` | opus | medium | giudica fonti nuove e **manda una email** in autonomia |

**Perché separati** (21/07/2026): quando la raccolta stava dentro la pipeline, i browser headed
chiudendosi si portavano dietro il `.bat` — 37 log dal 29/06 con `collect:sources START` e mai `END`,
quindi `/update-combos` non partiva **mai** e `combos.json` restava indietro in silenzio (buco
03/07→18/07 recuperato a mano; anche `recover-combos.bat` moriva lì, rendendo inutile la rete di
sicurezza). La causa esatta non è deterministica (la correlazione con i singoli fetcher regge 30 volte
su 37): la separazione la rende irrilevante, perché una raccolta che muore non impedisce l'elaborazione.

I transcript YouTube girano a parte ogni 5 min (`--batch 1`, rate-limit): scaricano solo i video
`relevant:true` (decisi da `/judge-youtube`), nella lingua reale del video, nelle ore successive
(eventually-consistent).
`/update-parts`, `/update-combos` e `/mine-reddit` fanno **commit/push autonomi su master**.
Ogni step scrive su `logs/pipeline-YYYY-MM-DD.log` (marker `START`/`END` + exit code): se la sequenza si
interrompe (PC sospeso, browser headed appeso, processo abortito), l'ultimo marker dice **dove** è morta.

**Battito cardiaco** (`scripts/heartbeat.ps1`, dal 22/07/2026): `start /b` lo avvia nella **stessa
console** del bat, scrive una riga ogni 30s in `logs/heartbeat-YYYY-MM-DD.log` e si chiude quando il bat
rimuove `tmp/pipeline-alive.flag`. Serve a separare due cause che l'ultimo marker da solo non distingue:
se il battito **si ferma nello stesso istante** dell'ultimo marker è stata uccisa l'intera console
(evento CTRL+C al gruppo di processi, taskkill sull'albero, chiusura della finestra); se **prosegue**,
la console era viva ed è uscito solo `cmd.exe`. Diagnostica pura: non cambia il comportamento della
pipeline. Cause già escluse con prove: `ExecutionTimeLimit` (è `PT72H`), crash di processo (nessun
evento nel log Applicazione), esaurimento risorse (zero eventi `Resource-Exhaustion-Detector` in 30
giorni), sospensione del PC, browser headed (il 22/07 è morta su `judge-youtube`, che non apre browser)
e il meccanismo `.bat` + `claude` in sé (tre `claude -p` in sequenza sotto Task Scheduler con la stessa
configurazione della pipeline arrivano in fondo).
La pipeline è interattiva (`/it`) e dura ~1h: se il PC viene sospeso/spento a metà, gli step combo che
committano non completano e `combos.json` resta indietro — per questo c'è il task di recupero (sotto).
`logs/` è gitignorato. All'avvio il bat pulisce i lock del profilo `.playwright-beyblade`.

Durata `/update-combos`: **~20-22 min** a run (misurato 16/06/2026 via `claude -p`: parser
MetaBeys/WBO + scoring CAS + estrazione fonti strutturate + build + commit/push). **Non** mina la
cache Reddit a fondo: la cache (`reddit-cache.json`, migliaia di righe) eccede un singolo Read, quindi
`/update-combos` ne vede solo una fetta. Reddit lo mina `/mine-reddit`, che la legge **a blocchi**
(`reddit:batch`) marcando ogni post in `scan-history` — idempotente, riprende dove era rimasto, e
copre sia un backfill (~900 post → molti blocchi) sia i pochi post nuovi del giorno (1 blocco).
Durata `/mine-reddit`: **~39 min** per un backfill da 934 post (16 blocchi da 60; misurato 16/06/2026,
ha portato i combo da 204 a 457). Nella marcia normale è 1 blocco → pochi minuti.

Recupero combo — task SEPARATO, **giornaliero nel pomeriggio** (utente al PC): `recover-combos.bat`
controlla via `git log --since=midnight` se gli step che committano sono già passati **oggi**; se
`update combos database` manca rifà `/judge-youtube` → `/update-combos`, se
`mine reddit combos` manca rifà `/mine-reddit`. **Non rifà la raccolta** (è il task delle 07:30):
elabora la cache presente. **Idempotente**: se la mattina è andata, non fa nulla
(solo log in `logs/recover-YYYY-MM-DD.log`). Rete di sicurezza per le interruzioni della sequenza
mattutina interattiva (caso 25-26/06/2026: pipeline morta a metà, `combos.json` fermo 2 giorni).

Scoperta nuove fonti — task SEPARATO, **settimanale** (lunedì 09:00): `discover-sources.bat` esegue
`/discover-sources` (ricerca YouTube/siti/forum/social, valutazione, dedup vs fonti note). Manda una **email**
di proposta a `cinquequarti@gmail.com` (via gws, corpo leggibile senza allegati). Loop di feedback: si
risponde all'email in linguaggio naturale e il run successivo legge la risposta e promuove gli approvati
in `sources.json` (social → `manualVerification`), marca i rifiutati. Gira a finestra nascosta via
`run-discover-hidden.vbs` e committa `source-candidates.json` (+ `sources.json` quando applica feedback).
Per passare a giornaliero: `/sc daily`.

Bat manuali: `collect-social.bat` (solo Reddit+WBO headed), `collect-combos.bat` (solo collect
headless), `update-combos.bat` (collect+analyze), `dev-server.bat` (Astro).

Registrazione task (eseguire una volta; il task pipeline ha `/it` = gira solo se l'utente è loggato,
necessario per i browser headed). Path con spazi quotati dentro `/tr`:

    schtasks /create /tn "Beyblade Collect Sources" /tr "\"c:\claude-code\Personale\Beyblade\beyblade combos\collect-sources-task.bat\"" /sc daily /st 07:30 /it /f
    schtasks /create /tn "Beyblade Daily Pipeline" /tr "\"c:\claude-code\Personale\Beyblade\beyblade combos\daily-pipeline.bat\"" /sc daily /st 08:00 /it /f
    schtasks /create /tn "Beyblade Transcripts" /tr "wscript.exe \"c:\claude-code\Personale\Beyblade\beyblade combos\run-transcripts-hidden.vbs\"" /sc minute /mo 5 /f
    schtasks /create /tn "Beyblade Discover Sources" /tr "wscript.exe \"c:\claude-code\Personale\Beyblade\beyblade combos\run-discover-hidden.vbs\"" /sc weekly /d MON /st 09:00 /it /f
    schtasks /create /tn "Beyblade Recover Combos" /tr "\"c:\claude-code\Personale\Beyblade\beyblade combos\recover-combos.bat\"" /sc daily /st 14:00 /it /f

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
