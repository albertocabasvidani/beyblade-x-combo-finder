@echo off
REM Raccolta dati combo da tutte le fonti (Reddit, YouTube, Sheets, MetaBeys, WBO).
REM Scrive le cache grezze in data\*-cache.json. NON include i transcript (girano separati).
REM Schedulare: ogni giorno alle 03:30 (Task Scheduler).
cd /d "c:\claude-code\Personale\beyblade combos"
echo === Raccolta dati combo (Reddit, YouTube, Sheets, MetaBeys, WBO) ===
call npm run collect:sources
