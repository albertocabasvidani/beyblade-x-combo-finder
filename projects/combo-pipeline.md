---
name: combo-pipeline
status: active
updated: 17/06/2026
health: yellow
next-step: "attivare lo scheduling Task Scheduler con consenso esplicito"
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

## Known issues

<!-- Bug noti, problemi aperti, debiti tecnici. Formato: `- gg/mm/aaaa — testo` -->
- 16/06/2026 — WBO bloccato da Cloudflare in headless: serve `WBO_HEADED=1` + captcha manuale; fallback su MetaBeys
- 16/06/2026 — Reddit blocca l'accesso non autenticato: dipende dalla sessione loggata nel profilo `.playwright-beyblade` (`REDDIT_HEADED=1`), fragile

## In progress

<!-- Lavori in corso. Se collegati a un piano in plans/, linkalo. -->
- 17/06/2026 — verifica headed WBO + backfill profondo one-off (Cloudflare): validare `?page=N` reale, `printthread` vs vista forum, classificare gli altri thread BBX (es. "National Tournament 2025"), confermare `parse:wbo` sul raw multi-pagina. Codice pronto, serve un run con captcha manuale (`WBO_HEADED=1 WBO_MAX_PAGES=30 npm run fetch:wbo`)
- 16/06/2026 — attivazione scheduling Task Scheduler deferita: i 4 task fanno commit/push autonomi, da abilitare con consenso esplicito (Fase 6, vedi [piano ripresa](plans/ripresa-pipeline-beyblade-x-over-blade-bonifica-pa-2026-06-15-1731.md))

## Changelog

<!-- Cose completate, dalla più recente. Formato: `- gg/mm/aaaa — testo` -->
- 17/06/2026 — paginazione storica fonti torneo + cutoff 12 mesi condiviso + pruning: `scripts/lib/freshness.ts` (cutoff unico, applicato in fetch/parse/score), paginazione capped+resumable di MetaBeys (`?page=N`, cursore `metabeysBackfill`) e WBO (all'indietro, cursore `wboBackfill`, `printthread` opzionale), `prune:combos` (archivia in `combos-archive.json` le combo senza evidenza fresca, dry-run + guardrail). Eventi distinti da ~23 → in crescita (MetaBeys 79→175 combo in 3 pagine). Golden test `test:freshness`/`test:prune`
- 17/06/2026 — agente `/discover-sources`: scoperta automatica di nuove fonti tornei (YouTube via API, siti/blog/forum/social via WebSearch+WebFetch), valutazione + dedup vs fonti note, proposta motivata via email; staging in `source-candidates.json`, task settimanale nascosto. Attacca il gap d'audit "Discord/social/JP mai mappati"
- 16/06/2026 — task "Beyblade Transcripts" a finestra nascosta (wrapper `run-transcripts-hidden.vbs` via `wscript.exe`): non apre più la console ogni 5 min, intervallo invariato
- 16/06/2026 — backfill storico Reddit (`REDDIT_BACKFILL`) + robustezza scraper (skip post falliti, no crash)
- 16/06/2026 — Competitive Authority Score (CAS) deterministico per le combo
- 16/06/2026 — Reddit orientato ai risultati torneo + automazione headed
- 15/06/2026 — primo run `/update-combos` sui tornei (`update combos database 2026-06-15`)
- 15/06/2026 — `scrape:reddit` su sessione browser loggata (Playwright) invece di OAuth
