@echo off
REM Analisi e aggiornamento del database combo con Claude (legge le cache + transcript del giorno,
REM riconosce i nomi parte multilingua via parts-master.json, dedup id-set, scoring, commit+push).
REM Esecuzione MANUALE (analisi-only). Lo scheduling completo gira via daily-pipeline.bat (08:00).
cd /d "c:\claude-code\Personale\Beyblade\beyblade combos"
echo === Analisi e aggiornamento combo con Claude ===
claude --model sonnet --effort high --dangerously-skip-permissions -p "/update-combos"
