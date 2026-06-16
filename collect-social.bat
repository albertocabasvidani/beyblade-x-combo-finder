@echo off
REM Raccolta fonti social HEADED (Reddit + WBO): richiedono browser visibile e sessione desktop.
REM - Reddit: riusa il login del profilo .playwright-beyblade (valido settimane), nessun captcha.
REM - WBO: se la clearance Cloudflare e' scaduta puo' chiedere il captcha (risolverlo nella finestra).
REM Schedulare la mattina (08:00) con /it: gira solo se l'utente e' loggato al desktop.
REM collect-combos.bat (03:30, headless) copre MetaBeys/YouTube/Sheets; questo aggiunge Reddit/WBO.
cd /d "c:\claude-code\Personale\beyblade combos"
set REDDIT_HEADED=1
set WBO_HEADED=1
echo === Raccolta social headed (Reddit + WBO) ===
call npm run scrape:reddit
call npm run fetch:wbo
