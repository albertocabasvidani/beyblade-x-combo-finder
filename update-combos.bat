@echo off
cd /d "c:\claude-code\Personale\beyblade combos"
echo === Raccolta dati da fonti esterne ===
call npm run collect:sources
echo.
echo === Analisi combo con Claude ===
claude --dangerously-skip-permissions -p "Esegui /update-combos"
