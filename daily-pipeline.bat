@echo off
REM Pipeline giornaliera COMPLETA in sequenza, alle 08:00 (PC acceso di giorno, utente loggato).
REM Un solo task: l'ordine conta (parts -> collect -> analyze), niente esecuzioni parallele.
REM Reddit/WBO headed (REDDIT_HEADED/WBO_HEADED, lette da collect:sources): Reddit riusa il login del
REM profilo .playwright-beyblade; WBO puo' chiedere il captcha Cloudflare da risolvere nella finestra.
REM Task schedulato con /it (solo se l'utente e' loggato) perche' i fetcher social aprono un browser.
REM I transcript YouTube girano a parte (fetch-transcripts.bat ogni 5 min, rate-limit).
REM /update-parts e /update-combos fanno commit/push autonomi su master.
cd /d "c:\claude-code\Personale\beyblade combos"
set REDDIT_HEADED=1
set WBO_HEADED=1
echo === 1/3 Aggiornamento parti ===
claude --dangerously-skip-permissions -p "Esegui /update-parts"
echo.
echo === 2/3 Raccolta fonti (MetaBeys/YouTube/Sheets + Reddit/WBO headed) ===
call npm run collect:sources
echo.
echo === 3/3 Analisi e aggiornamento combo ===
claude --dangerously-skip-permissions -p "Esegui /update-combos"
