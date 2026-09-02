@echo off
setlocal enabledelayedexpansion
REM Pipeline giornaliera COMPLETA in sequenza, soglia 08:00 (PC acceso di giorno, utente loggato).
REM Job `beyblade-pipeline` del dispatcher generale: l'ora e' una soglia, non un appuntamento.
REM Un solo esecutore: l'ordine conta (parts -> collect -> judge youtube -> analyze -> mine reddit).
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
cd /d "%~dp0"

REM --- data ISO per il nome del file di log ---
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"
if not exist logs mkdir logs
set "LOG=logs\pipeline-%TODAY%.log"

REM --- cleanup lock file del profilo Playwright (un Chrome chiuso male lascia lock che bloccano l'open) ---
del /q "%USERPROFILE%\.playwright-beyblade\SingletonLock" 2>nul
del /q "%USERPROFILE%\.playwright-beyblade\SingletonCookie" 2>nul
del /q "%USERPROFILE%\.playwright-beyblade\SingletonSocket" 2>nul

set REDDIT_HEADED=1
set WBO_HEADED=1

REM --- battito cardiaco (diagnostica, vedi scripts\heartbeat.ps1) ---
REM Gira NELLA STESSA CONSOLE (start /b), quindi ne condivide la sorte. Confrontando
REM dove si ferma il battito con l'ultimo marker qui sotto si distingue "e' stata uccisa
REM tutta la console" (battito fermo nello stesso istante) da "e' uscito solo cmd.exe"
REM (battito che prosegue). Path relativi: start tronca i path assoluti con spazi.
if not exist tmp mkdir tmp
set "FLAG=tmp\pipeline-alive.flag"
echo attiva> "%FLAG%"
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\heartbeat.ps1" "logs\heartbeat-%TODAY%.log" "%FLAG%"

REM Il log da solo non basta: l'esito degli step deve arrivare al dispatcher, che legge
REM l'exit code del bat. Senza il contatore qui sotto il file esce 0 anche con tutti gli
REM step falliti, e la verifica delle 09:00 registra "esito=ok" (02/09/2026: tre step morti
REM per sessione OAuth scaduta, dispatcher e verificatore silenziosi per tutta la notte).
set "FALLITI=0"
set "FALLITI_ELENCO="

call :log "=== PIPELINE START ==="

call :log "--- 1/4 update-parts START ---"
REM Modello fissato a Sonnet/effort medium: e' un lavoro meccanico e ripetitivo (diff revid, estrazione
REM strutturata, merge), non serve il modello di punta. I flag CLI rendono la scelta deterministica anche
REM se cambia il modello di default della sessione; il frontmatter del comando dice la stessa cosa.
claude --model sonnet --effort medium --dangerously-skip-permissions -p "/update-parts" >> "%LOG%" 2>&1
set "RC=!errorlevel!"
call :log "--- 1/4 update-parts END exit=!RC! ---"
call :conta "!RC!" "update-parts"

REM La raccolta fonti NON sta piu' qui: e' il job `beyblade-collect` del dispatcher
REM generale, soglia 07:30 (collect-sources-task.bat). Motivo: i browser headed di collect:sources,
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
claude --model sonnet --effort medium --dangerously-skip-permissions -p "/judge-youtube" >> "%LOG%" 2>&1
set "RC=!errorlevel!"
call :log "--- 2/4 judge-youtube END exit=!RC! ---"
call :conta "!RC!" "judge-youtube"

REM Interruttore manuale per il solo /update-combos: se il file esiste, lo step viene saltato
REM e il resto della pipeline prosegue. E' lo step piu' lungo (~20 min: legge combos.json da
REM 19,7 MB, estrae con l'IA dalle fonti narrative, riscora ~4900 combo, ricompila il sito).
REM Per riattivarlo basta cancellare il file. Stesso interruttore in recover-combos.bat,
REM altrimenti il recupero delle 14:00 lo rifarebbe comunque.
if exist "%~dp0.pausa-update-combos" (
  call :log "--- 3/4 update-combos SALTATO: esiste .pausa-update-combos ---"
) else (
  call :log "--- 3/4 update-combos START ---"
  claude --model sonnet --effort medium --dangerously-skip-permissions -p "/update-combos" >> "%LOG%" 2>&1
  set "RC=!errorlevel!"
  call :log "--- 3/4 update-combos END exit=!RC! ---"
  call :conta "!RC!" "update-combos"
)

call :log "--- 4/4 mine-reddit START ---"
claude --model sonnet --effort medium --dangerously-skip-permissions -p "/mine-reddit" >> "%LOG%" 2>&1
set "RC=!errorlevel!"
call :log "--- 4/4 mine-reddit END exit=!RC! ---"
call :conta "!RC!" "mine-reddit"

REM Rimuovere il flag prima del marker finale: il battito lo vede entro 30s e si chiude
REM da solo. Se il bat muore prima di qui, il flag resta e il battito prosegue fino a
REM scadenza - ed e' proprio quel proseguire a dire che la console era ancora viva.
del /q "%FLAG%" 2>nul
if not "!FALLITI!"=="0" goto :fine_errore
call :log "=== PIPELINE END ==="
endlocal
goto :eof

REM Esce non-zero: il dispatcher registra l'occorrenza come fallita (maxAttempts 1,
REM quindi nessun ritentativo: si riprova domani) e la verifica delle 09:00 la mette
REM fra i problemi invece di dire che e' andato tutto bene.
:fine_errore
call :log "=== PIPELINE END: falliti !FALLITI! step:!FALLITI_ELENCO! ==="
endlocal
exit /b 1

:log
echo [%date% %time%] %~1
echo [%date% %time%] %~1>> "%LOG%"
goto :eof

REM %~1 = exit code dello step, %~2 = nome. Il contatore decide l'exit code del bat.
:conta
if not "%~1"=="0" (
  set /a FALLITI+=1
  set "FALLITI_ELENCO=!FALLITI_ELENCO! %~2"
)
goto :eof
