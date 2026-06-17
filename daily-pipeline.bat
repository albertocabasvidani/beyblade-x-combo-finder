@echo off
REM Pipeline giornaliera COMPLETA in sequenza, alle 08:00 (PC acceso di giorno, utente loggato).
REM Un solo task: l'ordine conta (parts -> collect -> judge youtube -> analyze -> mine reddit).
REM Reddit/WBO headed (REDDIT_HEADED/WBO_HEADED, lette da collect:sources): Reddit riusa il login del
REM profilo .playwright-beyblade; WBO puo' chiedere il captcha Cloudflare da risolvere nella finestra.
REM Task schedulato con /it (solo se l'utente e' loggato) perche' i fetcher social aprono un browser.
REM /judge-youtube giudica rilevanza+lingua dei video raccolti PRIMA di /update-combos, cosi' i flag
REM relevant esistono quando si leggono i transcript. I transcript YouTube girano a parte
REM (fetch-transcripts.bat ogni 5 min, rate-limit) e scaricano solo i video relevant.
REM /update-parts, /update-combos e /mine-reddit fanno commit/push autonomi su master.
REM Cutoff fonti: 12 mesi (scripts/lib/freshness.ts). La raccolta giornaliera pagina poche pagine/run
REM (META_MAX_PAGES/WBO_MAX_PAGES, default 3); il backfill storico avanza in piu' giorni. /update-combos
REM esegue prune:combos --apply (archivia le combo senza evidenza fresca in data/combos-archive.json).
REM Backfill profondo one-off (manuale, fuori da questo task):
REM   set META_MAX_PAGES=30 ^&^& npm run fetch:metabeys     (MetaBeys, headless ok)
REM   set WBO_HEADED=1 ^&^& set WBO_MAX_PAGES=30 ^&^& npm run fetch:wbo   (WBO, risolvi captcha Cloudflare)
cd /d "c:\claude-code\Personale\beyblade combos"
set REDDIT_HEADED=1
set WBO_HEADED=1
echo === 1/5 Aggiornamento parti ===
claude --dangerously-skip-permissions -p "Esegui /update-parts"
echo.
echo === 2/5 Raccolta fonti (MetaBeys/YouTube/Sheets + Reddit/WBO headed) ===
call npm run collect:sources
echo.
echo === 3/5 Giudizio rilevanza video YouTube (relevant + lingua, a blocchi) ===
claude --dangerously-skip-permissions -p "Esegui /judge-youtube"
echo.
echo === 4/5 Analisi e aggiornamento combo (fonti strutturate) ===
claude --dangerously-skip-permissions -p "Esegui /update-combos"
echo.
echo === 5/5 Mining Reddit a blocchi (tutta la cache, idempotente) ===
claude --dangerously-skip-permissions -p "Esegui /mine-reddit"
