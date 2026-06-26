@echo off
setlocal enabledelayedexpansion
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
REM
REM LOGGING: ogni step scrive su logs\pipeline-YYYY-MM-DD.log con marker START/END + exit code, cosi'
REM un'eventuale interruzione (PC sospeso, browser headed appeso, processo abortito) e' diagnosticabile
REM dall'ultimo marker. Se l'ultimo marker e' "... START" senza "... END", quello step e' dove e' morta.
cd /d "c:\claude-code\Personale\beyblade combos"

REM --- data ISO per il nome del file di log ---
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"
if not exist logs mkdir logs
set "LOG=logs\pipeline-%TODAY%.log"

REM --- cleanup lock file del profilo Playwright (un Chrome chiuso male lascia lock che bloccano l'open) ---
del /q "C:\Users\cinqu\.playwright-beyblade\SingletonLock" 2>nul
del /q "C:\Users\cinqu\.playwright-beyblade\SingletonCookie" 2>nul
del /q "C:\Users\cinqu\.playwright-beyblade\SingletonSocket" 2>nul

set REDDIT_HEADED=1
set WBO_HEADED=1

call :log "=== PIPELINE START ==="

call :log "--- 1/5 update-parts START ---"
claude --dangerously-skip-permissions -p "Esegui /update-parts" >> "%LOG%" 2>&1
call :log "--- 1/5 update-parts END exit=!errorlevel! ---"

call :log "--- 2/5 collect:sources START ---"
call npm run collect:sources >> "%LOG%" 2>&1
call :log "--- 2/5 collect:sources END exit=!errorlevel! ---"

call :log "--- 3/5 judge-youtube START ---"
claude --dangerously-skip-permissions -p "Esegui /judge-youtube" >> "%LOG%" 2>&1
call :log "--- 3/5 judge-youtube END exit=!errorlevel! ---"

call :log "--- 4/5 update-combos START ---"
claude --dangerously-skip-permissions -p "Esegui /update-combos" >> "%LOG%" 2>&1
call :log "--- 4/5 update-combos END exit=!errorlevel! ---"

call :log "--- 5/5 mine-reddit START ---"
claude --dangerously-skip-permissions -p "Esegui /mine-reddit" >> "%LOG%" 2>&1
call :log "--- 5/5 mine-reddit END exit=!errorlevel! ---"

call :log "=== PIPELINE END ==="
endlocal
goto :eof

:log
echo [%date% %time%] %~1
echo [%date% %time%] %~1>> "%LOG%"
goto :eof
