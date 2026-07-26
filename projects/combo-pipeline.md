---
name: combo-pipeline
status: active
updated: 26/07/2026
health: green
next-step: "valutare un filtro UI per la coda di combo a evento singolo (3285 attive) + rifinire le CX unresolved via /update-combos"
blocked-by: null
current-plan: plans/pipeline-dati-beyblade-x-combo-da-tornei-db-parti--2026-06-15-1107.md
main-doc: docs/scoring-algorithm.md
---

# Pipeline combo (raccolta → estrazione → scoring → automazione)

## Scope

L'intera catena dati delle combo: il **codice** raccoglie le cache grezze dalle fonti
(`collect:sources`: Reddit, YouTube, Sheets, MetaBeys, WBO) e parsa il deterministico
(`parse:metabeys`); l'**IA** (`/update-combos`) estrae le combo, riconosce i nomi parte multilingua,
deduplica per id-set e popola l'`evidence`; il codice calcola il **Competitive Authority Score**
(`score:combos`, `src/lib/scoring.ts`). Include lo scheduling Windows Task Scheduler che orchestra
tutto in sequenza giornaliera.

## Backlog

<!-- Idee, feature, task non avviati. Formato: `- gg/mm/aaaa — testo` -->
- 23/07/2026 — Il parser MetaBeys non ha un meccanismo di corrections come `wbo-corrections.json`: in questa revisione ho trovato 37 piazzamenti recuperabili persi per refusi puri (es. "Scark Scale"→"Shark Scale", "Areo Pegasus"→"Aero Pegasus", "Hovery Wyvern"/"Hover Wyern"→"Hover Wyvern", "T Rex"/"T-Rex" nickname di Tyranno Beat) su 192 unresolved totali (144 sono dati mancanti alla fonte, non fixabili). Andrebbe replicato lo stesso pattern typo-candidates/typo-apply usato per WBO, applicato a `metabeys-evidence.json`
- 23/07/2026 — Le overBlade (`data/parts-master.json`) non hanno `shortName`: WBO/YouTube usano spesso codici a 2 lettere per over+assist incollati prima del ratchet (es. "BahamutBlitz BK1-50I", "BRACHIO BLITZ OD 5-60FF") che `cx-resolve.ts` non sa decodificare (gestisce solo nomi pieni incollati tipo "BreakHeavy"). Il pattern "BK" ricorre 53 volte nel solo ledger WBO. Servirebbe assegnare shortName ufficiali alle overBlade e insegnare a `resolveCoda` i codici a 2 lettere — ma senza conoscenza certa della convenzione WBO non è stato tentato (rischio di risolvere combo sbagliate)

## Known issues

<!-- Bug noti, problemi aperti, debiti tecnici. Formato: `- gg/mm/aaaa — testo` -->
- 16/06/2026 — WBO bloccato da Cloudflare in headless: serve `WBO_HEADED=1` + captcha manuale; fallback su MetaBeys
- 16/06/2026 — Reddit blocca l'accesso non autenticato: dipende dalla sessione loggata nel profilo `.playwright-beyblade` (`REDDIT_HEADED=1`), fragile
- 25/07/2026 — `/mine-reddit` non ha (ancora) un passaggio deterministico di dedup id come `scripts/reddit-merge.ts`: creando a mano due nuove combo da un report Reddit ho duplicato l'`id` di due combo già esistenti (`shark-scale-3-60-low-rush`, `meteor-dragoon-9-60-elevate`), non essendomi accorto che esistevano già sotto un nome pieno del bit invece della sigla che avevo ipotizzato. `score:combos` non fa dedup per id: ha ricalcolato entrambe le copie separatamente, portando a 2 score diversi per lo stesso id in `combos.json` finché non ho unito manualmente evidence+mentions e cancellato il duplicato. Prevenzione: prima di creare una combo nuova a mano, cercare sempre `blade+ratchet+bit` (non solo l'id ipotizzato) in `combos.json`

## In progress

<!-- Lavori in corso. Se collegati a un piano in plans/, linkalo. -->

## Changelog

<!-- Cose completate, dalla più recente. Formato: `- gg/mm/aaaa — testo` -->
- 26/07/2026 — `/update-combos`: parser ri-eseguiti su cache fresche (4950 combo, 17 nuove da evidenza WBO). Recupero refusi ledger: 60 proposte typo (subagent Haiku, verificate contro il registro), 55 accettate dal gate deterministico → ledger sceso da 194 a 135 non risolte (i due pattern a 53 occorrenze "BahamutBlitz BK1-50I"/"BrachioWhip OW5-70Nr" restano aperti, vedi Backlog 23/07). Estrazione fonti narrative senza novità (YouTube già scansionato, arca.live 58 post nuovi tutti chiacchiere/scambi, SBBL e Sheets WBO ri-verificati ridondanti con l'evidenza WBO già strutturata). Validato in produzione il fix a `mergeUnresolved` (`scripts/lib/wbo-unresolved.ts`, non ancora committato a parte): una riga risolta ora sparisce davvero dal ledger invece di restarci in eterno
- 25/07/2026 — `/mine-reddit`: minato il blocco residuo (6 post, ledger a zero). Estratto un tournament-report dettagliato (2° posto G2 Northeast Regional Thailand, 240+ partecipanti): mention aggiunta a `wizard-rod-1-60-hexa` (esistente) e alle nuove `shark-scale-3-60-low-rush`/`meteor-dragoon-9-60-elevate`. `score:combos` + `prune:combos --apply` (1 combo archiviata, `tricera-press-3-60-low-rush`) rieseguiti dopo il fix del duplicato id (v. Known issues)
- 17/06/2026 — backfill WBO 12 mesi eseguito (headed, Cloudflare): thread `tid=110113` paginato all'indietro fino al cutoff (pagina 48, 2025-05-24), 87 pagine in cache. `?page=N` reale confermato. **Dataset combo da ~23 a ~2027 eventi distinti, 3285 combo attive**; archivio riconciliato a 18. Top CAS coerente col meta reale (Wizard Rod 1-60 Hexa 9.6). `printthread`/altri thread BBX non promossi (vista forum sufficiente, approccio curato)
- 17/06/2026 — fix WBO date + scoring NaN-safe + fetch più veloce: `parse:wbo` riconosce il timestamp dei post ("Mon. GG, AAAA") e valida la data (scarta non-date di calendario), prima ripiegava quasi sempre su `fetchedAt`; `scoring.ts` `daysBetween` NaN-safe (una data invalida non azzera più lo score); `fetch-wbo` senza attesa fissa di 3s/pagina (controllo Cloudflare immediato, attesa solo se sfidato)
- 17/06/2026 — scheduling Task Scheduler ATTIVO e verificato: "Beyblade Daily Pipeline" (08:00 giornaliero) Ready, ultimo run 17/06 esito 0. `/update-combos` ora esegue anche `prune:combos --apply`
- 17/06/2026 — paginazione storica fonti torneo + cutoff 12 mesi condiviso + pruning: `scripts/lib/freshness.ts` (cutoff unico, applicato in fetch/parse/score), paginazione capped+resumable di MetaBeys (`?page=N`, cursore `metabeysBackfill`) e WBO (all'indietro, cursore `wboBackfill`, `printthread` opzionale), `prune:combos` (archivia in `combos-archive.json` le combo senza evidenza fresca, dry-run + guardrail). Golden test `test:freshness`/`test:prune`
- 17/06/2026 — agente `/discover-sources`: scoperta automatica di nuove fonti tornei (YouTube via API, siti/blog/forum/social via WebSearch+WebFetch), valutazione + dedup vs fonti note, proposta motivata via email; staging in `source-candidates.json`, task settimanale nascosto. Attacca il gap d'audit "Discord/social/JP mai mappati"
- 16/06/2026 — task "Beyblade Transcripts" a finestra nascosta (wrapper `run-transcripts-hidden.vbs` via `wscript.exe`): non apre più la console ogni 5 min, intervallo invariato
- 16/06/2026 — backfill storico Reddit (`REDDIT_BACKFILL`) + robustezza scraper (skip post falliti, no crash)
- 16/06/2026 — Competitive Authority Score (CAS) deterministico per le combo
- 16/06/2026 — Reddit orientato ai risultati torneo + automazione headed
- 15/06/2026 — primo run `/update-combos` sui tornei (`update combos database 2026-06-15`)
- 15/06/2026 — `scrape:reddit` su sessione browser loggata (Playwright) invece di OAuth
