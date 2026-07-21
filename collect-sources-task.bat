@echo off
setlocal enabledelayedexpansion
REM Raccolta fonti, task Windows AUTONOMO (07:30), separato dalla pipeline delle 08:00.
REM
REM Perche' separato: collect:sources apre browser Chrome headed (Reddit/WBO/arca).
REM Quando uno di questi si chiude male porta con se' il .bat che lo ha lanciato:
REM nei log storici compare "collect:sources START" ma mai "END", e gli step
REM successivi (/judge-youtube, /update-combos) non partivano MAI. Risultato: il
REM database combo restava indietro in silenzio (buco 03/07 -> 18/07 recuperato a mano).
REM
REM La causa esatta non e' deterministica (37 log analizzati il 21/07/2026: la
REM correlazione con i singoli fetcher regge 30 volte su 37). Invece di inseguirla,
REM la raccolta e' isolata in un task suo: se muore, muore da sola e la pipeline
REM delle 08:00 elabora comunque le cache gia' presenti.
REM
REM Fonti che richiedono il browser visibile: Reddit riusa il login del profilo
REM .playwright-beyblade; WBO usa .playwright-wbo (dedicato, vedi fetch-wbo.ts) e puo'
REM chiedere il captcha Cloudflare. Per questo il task e' registrato con /it.

cd /d "%~dp0"

for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"
if not exist logs mkdir logs
set "LOG=logs\collect-%TODAY%.log"

REM lock di un Chrome chiuso male: bloccherebbero l'apertura del profilo
del /q "C:\Users\cinqu\.playwright-beyblade\SingletonLock" 2>nul
del /q "C:\Users\cinqu\.playwright-beyblade\SingletonCookie" 2>nul
del /q "C:\Users\cinqu\.playwright-beyblade\SingletonSocket" 2>nul
del /q "C:\Users\cinqu\.playwright-wbo\SingletonLock" 2>nul
del /q "C:\Users\cinqu\.playwright-wbo\SingletonCookie" 2>nul
del /q "C:\Users\cinqu\.playwright-wbo\SingletonSocket" 2>nul

set REDDIT_HEADED=1
set WBO_HEADED=1
set ARCA_HEADED=1

call :log "=== COLLECT START ==="
call npm run collect:sources >> "%LOG%" 2>&1
call :log "=== COLLECT END exit=!errorlevel! ==="
endlocal
goto :eof

:log
echo [%date% %time%] %~1
echo [%date% %time%] %~1>> "%LOG%"
goto :eof
