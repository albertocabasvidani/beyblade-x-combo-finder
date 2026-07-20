@echo off
REM Raccolta dati combo da tutte le fonti (Reddit, YouTube, Sheets, MetaBeys, WBO).
REM Scrive le cache grezze in data\*-cache.json. NON include i transcript (girano separati).
REM Esecuzione MANUALE (collect headless only). Lo scheduling completo gira via daily-pipeline.bat (08:00).
cd /d "c:\claude-code\Personale\Beyblade\beyblade combos"
echo === Raccolta dati combo (Reddit, YouTube, Sheets, MetaBeys, WBO) ===
call npm run collect:sources
