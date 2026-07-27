@echo off
setlocal enabledelayedexpansion
REM RECUPERO idempotente della parte combo della pipeline.
REM Motivo: la daily-pipeline gira alle 08:00 in sessione interattiva (/it) e dura ~1h; se il PC viene
REM sospeso/spento o un browser headed si appende, gli step che committano (update-combos, mine-reddit)
REM possono non completare e combos.json resta indietro (successo gia' 25-26/06/2026).
REM Questo script, schedulato nel POMERIGGIO (utente al PC), controlla via git se gli step combo sono
REM stati committati OGGI; se mancano, rifa' collect:sources fresco -> judge-youtube -> update-combos
REM e/o mine-reddit. E' idempotente: se la mattina e' andata, non fa nulla (solo log).
cd /d "c:\claude-code\Personale\Beyblade\beyblade combos"

for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"
if not exist logs mkdir logs
set "LOG=logs\recover-%TODAY%.log"
set "CHECK=%TEMP%\bey-recover-check.txt"

del /q "C:\Users\cinqu\.playwright-beyblade\SingletonLock" 2>nul
del /q "C:\Users\cinqu\.playwright-beyblade\SingletonCookie" 2>nul
del /q "C:\Users\cinqu\.playwright-beyblade\SingletonSocket" 2>nul

set REDDIT_HEADED=1
set WBO_HEADED=1

call :log "=== RECOVER START ==="

git log --since="%TODAY% 00:00" --pretty=format:%%s > "%CHECK%" 2>nul

REM Stesso interruttore manuale di daily-pipeline.bat: senza, il recupero rifarebbe
REM /update-combos proprio mentre lo si e' messo in pausa nella pipeline.
set "SALTA_COMBOS="
if exist "%~dp0.pausa-update-combos" set "SALTA_COMBOS=1"
if defined SALTA_COMBOS call :log "update-combos in pausa (.pausa-update-combos): salto judge + update-combos"

REM Le due condizioni si combinano in una variabile, senza goto e senza if concatenati:
REM  - "if errorlevel 1 if not defined X (...) else (...)" legherebbe l'else al SECONDO if;
REM  - un "goto" in avanti si rompe perche' cmd cerca le etichette per offset di byte e questi
REM    .bat hanno fine riga LF: il salto atterra a meta' riga (visto: "setlocal" letto "tlocal").
findstr /c:"update combos database" "%CHECK%" >nul
set "COMBOS_DA_FARE="
if errorlevel 1 set "COMBOS_DA_FARE=1"
if defined SALTA_COMBOS set "COMBOS_DA_FARE="

if defined COMBOS_DA_FARE (
  REM Niente ">" nei messaggi: in ":log" il testo arriva come %~1 e il parser di cmd vede
  REM la freccia PRIMA di stampare, trattandola come redirezione. "oggi -> recupero"
  REM creava un file chiamato "recupero" nella cartella del progetto e lasciava nel log la
  REM riga troncata a "oggi -", senza nessun errore (successo dal 24 al 27/07/2026).
  call :log "update-combos NON committato oggi: recupero (judge + update-combos)"
  REM La raccolta NON viene rifatta qui: e' il job `beyblade-collect` (soglia 07:30)
  REM a farla, e i suoi browser headed uccidevano questo bat prima di arrivare
  REM a /update-combos - cioe' proprio il recupero che doveva garantire. Si elabora
  REM la cache gia' presente: se il task del mattino e' andato, e' fresca di poche ore.
  call :log "--- judge-youtube START ---"
  claude --model sonnet --effort medium --dangerously-skip-permissions -p "/judge-youtube" >> "%LOG%" 2>&1
  call :log "--- judge-youtube END exit=!errorlevel! ---"
  call :log "--- update-combos START ---"
  claude --model sonnet --effort high --dangerously-skip-permissions -p "/update-combos" >> "%LOG%" 2>&1
  call :log "--- update-combos END exit=!errorlevel! ---"
) else (
  REM Due stati opposti non possono avere lo stesso messaggio: "la mattina e' andata" e
  REM "e' in pausa da una settimana" si leggono uguali nel log, e a distanza di giorni
  REM nessuno sa piu' quale dei due era.
  if defined SALTA_COMBOS (
    call :log "update-combos: NON eseguito perche' in pausa (.pausa-update-combos)"
  ) else (
    call :log "update-combos: niente da fare, gia' committato oggi"
  )
)

findstr /c:"mine reddit combos" "%CHECK%" >nul
if errorlevel 1 (
  call :log "--- mine-reddit START ---"
  claude --model sonnet --effort medium --dangerously-skip-permissions -p "/mine-reddit" >> "%LOG%" 2>&1
  call :log "--- mine-reddit END exit=!errorlevel! ---"
) else (
  call :log "mine-reddit gia' committato oggi: skip"
)

call :log "=== RECOVER END ==="
del /q "%CHECK%" 2>nul
endlocal
goto :eof

:log
echo [%date% %time%] %~1
echo [%date% %time%] %~1>> "%LOG%"
goto :eof
