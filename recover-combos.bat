@echo off
setlocal enabledelayedexpansion
REM RECUPERO idempotente della parte combo della pipeline.
REM Motivo: la daily-pipeline gira alle 08:00 in sessione interattiva (/it) e dura ~1h; se il PC viene
REM sospeso/spento o un browser headed si appende, gli step che committano (update-combos, mine-reddit)
REM possono non completare e combos.json resta indietro (successo gia' 25-26/06/2026).
REM Questo script, schedulato nel POMERIGGIO (utente al PC), controlla via git se gli step combo sono
REM stati committati OGGI; se mancano, rifa' collect:sources fresco -> judge-youtube -> update-combos
REM e/o mine-reddit. E' idempotente: se la mattina e' andata, non fa nulla (solo log).
cd /d "%~dp0"

for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"
if not exist logs mkdir logs
set "LOG=logs\recover-%TODAY%.log"
set "CHECK=%TEMP%\bey-recover-check.txt"

del /q "%USERPROFILE%\.playwright-beyblade\SingletonLock" 2>nul
del /q "%USERPROFILE%\.playwright-beyblade\SingletonCookie" 2>nul
del /q "%USERPROFILE%\.playwright-beyblade\SingletonSocket" 2>nul

set REDDIT_HEADED=1
set WBO_HEADED=1

REM Il log da solo non basta: l'esito degli step deve arrivare al dispatcher, che legge
REM l'exit code del bat. Senza il contatore qui sotto il file esce 0 anche con tutti gli
REM step falliti, e la verifica delle 09:00 registra "esito=ok" (02/09/2026: tre step morti
REM per sessione OAuth scaduta, dispatcher e verificatore silenziosi per tutta la notte).
set "FALLITI=0"
set "FALLITI_ELENCO="

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
  set "RC=!errorlevel!"
  call :log "--- judge-youtube END exit=!RC! ---"
  call :conta "!RC!" "judge-youtube"
  call :log "--- update-combos START ---"
  claude --model sonnet --effort high --dangerously-skip-permissions -p "/update-combos" >> "%LOG%" 2>&1
  set "RC=!errorlevel!"
  call :log "--- update-combos END exit=!RC! ---"
  call :conta "!RC!" "update-combos"
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
  set "RC=!errorlevel!"
  call :log "--- mine-reddit END exit=!RC! ---"
  call :conta "!RC!" "mine-reddit"
) else (
  call :log "mine-reddit gia' committato oggi: skip"
)

call :guardia_push

if not "!FALLITI!"=="0" goto :fine_errore
call :log "=== RECOVER END ==="
del /q "%CHECK%" 2>nul
endlocal
goto :eof

REM Esce non-zero: il dispatcher registra l'occorrenza come fallita (maxAttempts 1,
REM quindi nessun ritentativo: si riprova domani) e la verifica delle 09:00 la mette
REM fra i problemi invece di dire che e' andato tutto bene.
:fine_errore
call :log "=== RECOVER END: falliti !FALLITI! step:!FALLITI_ELENCO! ==="
del /q "%CHECK%" 2>nul
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

REM Gemella di quella in daily-pipeline.bat: gli step committano e pushano da soli, ma il push
REM lo fa il modello e nessuno lo verificava. L'08/09/2026 /mine-reddit ha committato 1888f1f
REM senza pushare ed e' uscito 0, e i dati sono rimasti su una macchina sola per 22 ore. Qui
REM il recupero e' l'ultima occasione della giornata di accorgersene.
REM AVANTI va inizializzato: senza upstream il for non assegna niente e "" non e' "0", quindi
REM si spingerebbe a vuoto. --rebase --autostash per non restare bloccati da un file sporco
REM lasciato da un altro job dello stesso repo.
:guardia_push
set "AVANTI=0"
for /f %%c in ('git rev-list --count @{u}..HEAD 2^>nul') do set "AVANTI=%%c"
if "!AVANTI!"=="0" goto :eof
call :log "--- push mancante: !AVANTI! commit locali, li spingo io ---"
git pull --rebase --autostash >> "%LOG%" 2>&1
git push >> "%LOG%" 2>&1
if errorlevel 1 (
  call :log "push FALLITO"
  set /a FALLITI+=1
  set "FALLITI_ELENCO=!FALLITI_ELENCO! push-finale"
) else (
  call :log "push fatto"
)
goto :eof
