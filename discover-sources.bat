@echo off
REM Scoperta settimanale di nuove fonti tornei. Gira via Claude Code headless (abbonamento, no API a
REM pagamento). WebSearch/WebFetch e l'invio email (gws) richiedono la sessione utente loggata -> il task
REM e' registrato con /it. Il comando /discover-sources si ferma allo staging (data/source-candidates.json)
REM + email a cinquequarti@gmail.com; NON aggiunge nulla a sources.json. Commit/push autonomo su master.
cd /d "c:\claude-code\Personale\Beyblade\beyblade combos"
echo === Scoperta nuove fonti tornei ===
claude --dangerously-skip-permissions -p "Esegui /discover-sources"
