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
cd /d "c:\claude-code\Personale\Beyblade\beyblade combos"

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

call :log "--- 1/4 update-parts START ---"
REM Modello fissato a Sonnet/effort medium: e' un lavoro meccanico e ripetitivo (diff revid, estrazione
REM strutturata, merge), non serve il modello di punta. I flag CLI rendono la scelta deterministica anche
REM se cambia il modello di default della sessione; il frontmatter del comando dice la stessa cosa.
claude --model sonnet --effort medium --dangerously-skip-permissions -p "Esegui /update-parts" >> "%LOG%" 2>&1
call :log "--- 1/4 update-parts END exit=!errorlevel! ---"

REM La raccolta fonti NON sta piu' qui: e' il task "Beyblade Collect Sources" delle
REM 07:30 (collect-sources-task.bat). Motivo: i browser headed di collect:sources,
REM chiudendosi male, si portavano dietro questo bat e gli step sotto non partivano
REM MAI (37 log dal 29/06/2026 con "collect:sources START" e nessun "END").
REM Separandola, un browser che muore ferma al massimo la raccolta: qui si elaborano
REM comunque le cache presenti. Freschezza: 30 minuti prima, stessa mattina.
call :log "--- cache disponibili (raccolte dal task delle 07:30) ---"
for %%f in (reddit-cache.json wbo-cache.json metabeys-cache.json arca-cache.json youtube-cache.json) do (
  if exist "data\%%f" (
    for %%d in ("data\%%f") do call :log "    %%f  %%~td"
  ) else (
    call :log "    %%f  ASSENTE"
  )
)

call :log "--- 2/4 judge-youtube START ---"
claude --dangerously-skip-permissions -p "Esegui /judge-youtube" >> "%LOG%" 2>&1
call :log "--- 2/4 judge-youtube END exit=!errorlevel! ---"

call :log "--- 3/4 update-combos START ---"
claude --dangerously-skip-permissions -p "Esegui /update-combos" >> "%LOG%" 2>&1
call :log "--- 3/4 update-combos END exit=!errorlevel! ---"

call :log "--- 4/4 mine-reddit START ---"
claude --dangerously-skip-permissions -p "Esegui /mine-reddit" >> "%LOG%" 2>&1
call :log "--- 4/4 mine-reddit END exit=!errorlevel! ---"

call :log "=== PIPELINE END ==="
endlocal
goto :eof

:log
echo [%date% %time%] %~1
echo [%date% %time%] %~1>> "%LOG%"
goto :eof
