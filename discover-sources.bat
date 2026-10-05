@echo off
REM Scoperta settimanale di nuove fonti tornei. Gira via Claude Code headless (abbonamento, no API a
REM pagamento). WebSearch/WebFetch e l'invio email (gws) richiedono la sessione utente loggata -> il task
REM e' registrato con /it. Il comando /discover-sources si ferma allo staging (data/source-candidates.json)
REM + email a cinquequarti@gmail.com; NON aggiunge nulla a sources.json. Commit/push autonomo su master.
REM Limite di sessione Claude: con questa variabile claude -p aspetta l'azzeramento e riprende
REM invece di morire. Il job e' settimanale con un solo tentativo, quindi un fallimento costava
REM una settimana. Doc ufficiale: pagina env-vars, CLAUDE_CODE_RETRY_WATCHDOG. Il tetto all'attesa
REM e' timeoutMin del dispatcher. Qui e non fra le variabili utente, per non toccare le sessioni
REM Remote Control. Dal 05/10/2026.
set "CLAUDE_CODE_RETRY_WATCHDOG=1"
cd /d "%~dp0"
echo === Scoperta nuove fonti tornei ===
claude --model opus --effort medium --dangerously-skip-permissions -p "/discover-sources"
