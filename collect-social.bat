@echo off
REM Raccolta fonti social HEADED (Reddit + WBO): richiedono browser visibile e sessione desktop.
REM - Reddit: riusa il login del profilo .playwright-beyblade (valido settimane), nessun captcha.
REM - WBO: se la clearance Cloudflare e' scaduta puo' chiedere il captcha (risolverlo nella finestra).
REM Esecuzione MANUALE (refresh on-demand solo Reddit/WBO). Lo scheduling completo gira via
REM daily-pipeline.bat (08:00), che include gia' Reddit/WBO headed dentro collect:sources.
cd /d "c:\claude-code\Personale\Beyblade\beyblade combos"
set REDDIT_HEADED=1
set WBO_HEADED=1
echo === Raccolta social headed (Reddit + WBO) ===
call npm run scrape:reddit
call npm run fetch:wbo
