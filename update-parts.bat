@echo off
REM Lancia il solo /update-parts, fuori dalla pipeline giornaliera. Utile per collaudarlo
REM a mano dopo una modifica al comando o agli script del diff wiki.
REM
REM Il percorso e' %~dp0 (la cartella di questo file), non un percorso assoluto: prima era
REM inchiodato a quello del portatile, e sul mini PC `cd /d` falliva in silenzio lasciando
REM girare claude in una cartella qualsiasi - cioe' su un altro repo, o su nessuno.
cd /d "%~dp0"
claude --model sonnet --effort medium --dangerously-skip-permissions -p "/update-parts"
