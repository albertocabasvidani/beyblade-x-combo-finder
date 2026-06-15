@echo off
REM Analisi e aggiornamento del database combo con Claude (legge le cache + transcript del giorno,
REM riconosce i nomi parte multilingua via parts-master.json, dedup id-set, scoring, commit+push).
REM Schedulare: ogni giorno alle 22:00 (dopo collect-combos delle 03:30 e i transcript del giorno).
cd /d "c:\claude-code\Personale\beyblade combos"
echo === Analisi e aggiornamento combo con Claude ===
claude --dangerously-skip-permissions -p "Esegui /update-combos"
