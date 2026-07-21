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

findstr /c:"update combos database" "%CHECK%" >nul
if errorlevel 1 (
  call :log "update-combos NON committato oggi -> recupero (judge + update-combos)"
  REM La raccolta NON viene rifatta qui: e' il task "Beyblade Collect Sources" delle
  REM 07:30 a farla, e i suoi browser headed uccidevano questo bat prima di arrivare
  REM a /update-combos — cioe' proprio il recupero che doveva garantire. Si elabora
  REM la cache gia' presente: se il task del mattino e' andato, e' fresca di poche ore.
  call :log "--- judge-youtube START ---"
  claude --model sonnet --effort medium --dangerously-skip-permissions -p "/judge-youtube" >> "%LOG%" 2>&1
  call :log "--- judge-youtube END exit=!errorlevel! ---"
  call :log "--- update-combos START ---"
  claude --model sonnet --effort high --dangerously-skip-permissions -p "/update-combos" >> "%LOG%" 2>&1
  call :log "--- update-combos END exit=!errorlevel! ---"
) else (
  call :log "update-combos gia' committato oggi -> skip"
)

findstr /c:"mine reddit combos" "%CHECK%" >nul
if errorlevel 1 (
  call :log "--- mine-reddit START ---"
  claude --model sonnet --effort medium --dangerously-skip-permissions -p "/mine-reddit" >> "%LOG%" 2>&1
  call :log "--- mine-reddit END exit=!errorlevel! ---"
) else (
  call :log "mine-reddit gia' committato oggi -> skip"
)

call :log "=== RECOVER END ==="
del /q "%CHECK%" 2>nul
endlocal
goto :eof

:log
echo [%date% %time%] %~1
echo [%date% %time%] %~1>> "%LOG%"
goto :eof
