@echo off
setlocal enabledelayedexpansion
REM Pipeline giornaliera COMPLETA in sequenza, soglia 08:00 (PC acceso di giorno, utente loggato).
REM Job `beyblade-pipeline` del dispatcher generale: l'ora e' una soglia, non un appuntamento.
REM Un solo esecutore: l'ordine conta (parts -> collect -> judge youtube -> analyze -> mine reddit).
REM Reddit/WBO headed (REDDIT_HEADED/WBO_HEADED, lette da collect:sources): Reddit riusa il login del
REM profilo .playwright-beyblade; WBO puo' chiedere il captcha Cloudflare da risolvere nella finestra.
REM Task schedulato con /it (solo se l'utente e' loggato) perche' i fetcher social aprono un browser.
REM /judge-youtube giudica rilevanza+lingua dei video raccolti PRIMA di /update-combos, cosi' i flag
REM relevant esistono quando si leggono i transcript. I transcript YouTube girano a parte
REM (fetch-transcripts.bat ogni 5 min, rate-limit) e scaricano solo i video relevant.
REM /update-parts, /update-combos e /mine-reddit fanno commit/push autonomi su master.
REM Cutoff fonti: 12 mesi (scripts/lib/freshness.ts). La raccolta giornaliera pagina poche pagine/run
REM (META_MAX_PAGES/WBO_MAX_PAGES, default 3); il backfill storico avanza in piu' giorni. /update-combos
REM esegue prune:combos --apply (archivia le combo senza evidenza fresca in data/combos-archive.json).
REM Backfill profondo one-off (manuale, fuori da questo task):
REM   set META_MAX_PAGES=30 ^&^& npm run fetch:metabeys     (MetaBeys, headless ok)
REM   set WBO_HEADED=1 ^&^& set WBO_MAX_PAGES=30 ^&^& npm run fetch:wbo   (WBO, risolvi captcha Cloudflare)
REM
REM LOGGING: ogni step scrive su logs\pipeline-YYYY-MM-DD.log con marker START/END + exit code, cosi'
REM un'eventuale interruzione (PC sospeso, browser headed appeso, processo abortito) e' diagnosticabile
REM dall'ultimo marker. Se l'ultimo marker e' "... START" senza "... END", quello step e' dove e' morta.
cd /d "%~dp0"

REM --- data ISO per il nome del file di log ---
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"
if not exist logs mkdir logs
set "LOG=logs\pipeline-%TODAY%.log"

REM --- cleanup lock file del profilo Playwright (un Chrome chiuso male lascia lock che bloccano l'open) ---
del /q "%USERPROFILE%\.playwright-beyblade\SingletonLock" 2>nul
del /q "%USERPROFILE%\.playwright-beyblade\SingletonCookie" 2>nul
del /q "%USERPROFILE%\.playwright-beyblade\SingletonSocket" 2>nul

set REDDIT_HEADED=1
set WBO_HEADED=1

REM --- Claude dei job: configurazione del progetto piu' il pacchetto minimo ---
REM Sul server i progetti stanno sotto C:\Users\server: senza claudeMdExcludes Claude carica
REM ~\.claude\CLAUDE.md e le rule globali come memoria di una cartella superiore (+68k token
REM a sessione, misurato il 05/11/2026). Il pacchetto sta in claude-config, cartella headless.
REM Se manca, si parte con la configurazione completa e lo si scrive nel log.
set "JOBCFG=%USERPROFILE%\.claude\headless"
set "CLAUDE_JOB="
if exist "%JOBCFG%\impostazioni-job.json" if exist "%JOBCFG%\regole-job.md" set CLAUDE_JOB=--setting-sources project,local --settings "%JOBCFG%\impostazioni-job.json" --append-system-prompt-file "%JOBCFG%\regole-job.md"
if not defined CLAUDE_JOB echo [WARN] pacchetto job assente in %JOBCFG%: configurazione completa>> "%LOG%"

REM --- limite di sessione Claude ---
REM Con questa variabile ogni claude -p, arrivato al limite, aspetta l'orario di azzeramento
REM che il 429 riporta e poi riprende, invece di morire: senza, uno step al limite falliva e il
REM job - un solo tentativo nel manifest - perdeva la giornata. Doc ufficiale: pagina env-vars,
REM CLAUDE_CODE_RETRY_WATCHDOG, da v2.1.186. Il tetto all'attesa e' timeoutMin del dispatcher.
REM Ritenta fino a ~3 ore anche errori di server e di rete. Sta qui e non fra le variabili
REM dell'utente server perche' non arrivi alle sessioni Remote Control, dove il limite va visto.
REM Dal 05/10/2026.
set "CLAUDE_CODE_RETRY_WATCHDOG=1"

REM --- battito cardiaco (diagnostica, vedi scripts\heartbeat.ps1) ---
REM Gira NELLA STESSA CONSOLE (start /b), quindi ne condivide la sorte. Confrontando
REM dove si ferma il battito con l'ultimo marker qui sotto si distingue "e' stata uccisa
REM tutta la console" (battito fermo nello stesso istante) da "e' uscito solo cmd.exe"
REM (battito che prosegue). Path relativi: start tronca i path assoluti con spazi.
if not exist tmp mkdir tmp
set "FLAG=tmp\pipeline-alive.flag"
echo attiva> "%FLAG%"
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\heartbeat.ps1" "logs\heartbeat-%TODAY%.log" "%FLAG%"

REM Il log da solo non basta: l'esito degli step deve arrivare al dispatcher, che legge
REM l'exit code del bat. Senza il contatore qui sotto il file esce 0 anche con tutti gli
REM step falliti, e la verifica delle 09:00 registra "esito=ok" (02/09/2026: tre step morti
REM per sessione OAuth scaduta, dispatcher e verificatore silenziosi per tutta la notte).
set "FALLITI=0"
set "FALLITI_ELENCO="

call :log "=== PIPELINE START ==="
call :conta_allarmi ALLARMI_PRIMA

call :log "--- 1/4 update-parts START ---"
REM Modello fissato a Sonnet/effort medium: e' un lavoro meccanico e ripetitivo (diff revid, estrazione
REM strutturata, merge), non serve il modello di punta. I flag CLI rendono la scelta deterministica anche
REM se cambia il modello di default della sessione; il frontmatter del comando dice la stessa cosa.
claude %CLAUDE_JOB% --model sonnet --effort medium --dangerously-skip-permissions -p "/update-parts" >> "%LOG%" 2>&1
set "RC=!errorlevel!"
call :log "--- 1/4 update-parts END exit=!RC! ---"
call :conta "!RC!" "update-parts"

REM La raccolta fonti NON sta piu' qui: e' il job `beyblade-collect` del dispatcher
REM generale, soglia 07:30 (collect-sources-task.bat). Motivo: i browser headed di collect:sources,
REM chiudendosi male, si portavano dietro questo bat e gli step sotto non partivano
REM MAI (37 log dal 29/06/2026 con "collect:sources START" e nessun "END").
REM Separandola, un browser che muore ferma al massimo la raccolta: qui si elaborano
REM comunque le cache presenti. Freschezza: 30 minuti prima, stessa mattina.
call :log "--- cache disponibili (raccolte dal task delle 07:30) ---"
for %%f in (reddit-cache.json wbo-cache.json metabeys-cache.json arca-cache.json youtube-cache.json) do (
  if exist "data\%%f" (
    for %%d in ("data\%%f") do call :log "    %%f  %%~td"
  ) else (
    call :log "    %%f  ASSENTE"
  )
)

REM Gate: senza elementi nuovi lo step non ha niente da fare e Claude non parte. Il conteggio lo
REM stampa lo script del batch col comando count. Se non si legge, per un errore o la cache assente, PEND resta vuoto,
REM diverso da "0", e lo step parte comunque. Niente parentesi nei messaggi dentro i blocchi.
set "PEND="
for /f "delims=" %%n in ('npx tsx scripts\youtube-judge-batch.ts count 2^>nul') do set "PEND=%%n"
if "!PEND!"=="0" (
  call :log "--- 2/4 judge-youtube SALTATO: niente da elaborare ---"
) else (
  call :log "--- 2/4 judge-youtube START, da elaborare: !PEND! ---"
  claude %CLAUDE_JOB% --model sonnet --effort medium --dangerously-skip-permissions -p "/judge-youtube" >> "%LOG%" 2>&1
  set "RC=!errorlevel!"
  call :log "--- 2/4 judge-youtube END exit=!RC! ---"
  call :conta "!RC!" "judge-youtube"
)

REM Transcript YouTube: al massimo YT_BLOCCHI blocchi per giro, dal video piu' recente. Sta prima
REM di /update-combos, che ricalcola lo score e committa anche le combo trovate qui.
set "YT_STOP="
if not defined YT_BLOCCHI set "YT_BLOCCHI=8"
for /l %%i in (1,1,!YT_BLOCCHI!) do call :mine_youtube_blocco %%i
call :mine_web

REM Interruttore manuale per il solo /update-combos: se il file esiste, lo step viene saltato
REM e il resto della pipeline prosegue. E' lo step piu' lungo (~20 min: legge combos.json da
REM 19,7 MB, estrae con l'IA dalle fonti narrative, riscora ~4900 combo, ricompila il sito).
REM Per riattivarlo basta cancellare il file. Stesso interruttore in recover-combos.bat,
REM altrimenti il recupero delle 14:00 lo rifarebbe comunque.
if exist "%~dp0.pausa-update-combos" (
  call :log "--- 3/4 update-combos SALTATO: esiste .pausa-update-combos ---"
) else (
  call :log "--- 3/4 update-combos START ---"
  claude %CLAUDE_JOB% --model sonnet --effort medium --dangerously-skip-permissions -p "/update-combos" >> "%LOG%" 2>&1
  set "RC=!errorlevel!"
  call :log "--- 3/4 update-combos END exit=!RC! ---"
  call :conta "!RC!" "update-combos"
)

REM Gate: senza elementi nuovi lo step non ha niente da fare e Claude non parte. Il conteggio lo
REM stampa lo script del batch col comando count. Se non si legge, per un errore o la cache assente, PEND resta vuoto,
REM diverso da "0", e lo step parte comunque. Niente parentesi nei messaggi dentro i blocchi.
set "PEND="
for /f "delims=" %%n in ('npx tsx scripts\reddit-batch.ts count 2^>nul') do set "PEND=%%n"
if "!PEND!"=="0" (
  call :log "--- 4/4 mine-reddit SALTATO: niente da elaborare ---"
) else (
  call :log "--- 4/4 mine-reddit START, da elaborare: !PEND! ---"
  claude %CLAUDE_JOB% --model sonnet --effort medium --dangerously-skip-permissions -p "/mine-reddit" >> "%LOG%" 2>&1
  set "RC=!errorlevel!"
  call :log "--- 4/4 mine-reddit END exit=!RC! ---"
  call :conta "!RC!" "mine-reddit"
)

REM Allarmi degli script che lancia il modello (guardrail del prune, invariante dello score):
REM claude esce 0 anche quando uno di loro fallisce, quindi lo script scrive in
REM logs\allarmi-DATA.log (scripts\lib\allarme-step.ts) e qui conta lo step come fallito.
REM Si contano solo le righe nuove di questo giro, non quelle di un giro precedente della giornata.
call :conta_allarmi ALLARMI_DOPO
if !ALLARMI_DOPO! GTR !ALLARMI_PRIMA! (
  call :log "--- allarmi degli script: vedi logs\allarmi-%TODAY%.log ---"
  type "logs\allarmi-%TODAY%.log" >> "%LOG%"
  set /a FALLITI+=1
  set "FALLITI_ELENCO=!FALLITI_ELENCO! allarmi-script"
)

call :guardia_push

REM Rimuovere il flag prima del marker finale: il battito lo vede entro 30s e si chiude
REM da solo. Se il bat muore prima di qui, il flag resta e il battito prosegue fino a
REM scadenza - ed e' proprio quel proseguire a dire che la console era ancora viva.
del /q "%FLAG%" 2>nul
if not "!FALLITI!"=="0" goto :fine_errore
call :log "=== PIPELINE END ==="
endlocal
goto :eof

REM Esce non-zero: il dispatcher registra l'occorrenza come fallita (maxAttempts 1,
REM quindi nessun ritentativo: si riprova domani) e la verifica delle 09:00 la mette
REM fra i problemi invece di dire che e' andato tutto bene.
:fine_errore
call :log "=== PIPELINE END: falliti !FALLITI! step:!FALLITI_ELENCO! ==="
endlocal
exit /b 1

:log
echo [%date% %time%] %~1
echo [%date% %time%] %~1>> "%LOG%"
goto :eof

REM %~1 = nome della variabile in cui scrivere quante righe ha oggi logs\allarmi-DATA.log.
:conta_allarmi
set "%~1=0"
if exist "logs\allarmi-%TODAY%.log" for /f %%c in ('type "logs\allarmi-%TODAY%.log" ^| %SystemRoot%\System32\find.exe /c /v ""') do set "%~1=%%c"
goto :eof

REM Un blocco di transcript YouTube per chiamata: contesto nuovo a ogni blocco, e il tetto di
REM blocchi per giro lo decide il for /l che chiama questa etichetta. %~1 = numero del blocco.
REM L'esito si legge dall'effetto: quanti video risultano letti in data\youtube-mined.json prima
REM e dopo. claude esce 0 anche quando non ha letto niente, ed e' cosi' che l'estrazione dalle
REM fonti narrative e' rimasta ferma dal 06/10 al 12/11/2026 con la pipeline sempre verde.
:mine_youtube_blocco
if defined YT_STOP goto :eof
set "PEND="
for /f "delims=" %%n in ('npx tsx scripts\youtube-mine-batch.ts count 2^>nul') do set "PEND=%%n"
if "!PEND!"=="0" (
  if "%~1"=="1" call :log "--- mine-youtube SALTATO: niente da leggere ---"
  set "YT_STOP=1"
  goto :eof
)
set "LETTI_PRIMA=0"
for /f "delims=" %%n in ('npx tsx scripts\youtube-mine-batch.ts letti 2^>nul') do set "LETTI_PRIMA=%%n"
call :log "--- mine-youtube blocco %~1 START, da leggere: !PEND! ---"
claude %CLAUDE_JOB% --model sonnet --effort medium --dangerously-skip-permissions -p "/mine-youtube" >> "%LOG%" 2>&1
set "RC=!errorlevel!"
set "LETTI_DOPO=0"
for /f "delims=" %%n in ('npx tsx scripts\youtube-mine-batch.ts letti 2^>nul') do set "LETTI_DOPO=%%n"
call :log "--- mine-youtube blocco %~1 END exit=!RC!, video letti da !LETTI_PRIMA! a !LETTI_DOPO! ---"
call :conta "!RC!" "mine-youtube"
if !LETTI_DOPO! LEQ !LETTI_PRIMA! (
  call :log "mine-youtube blocco %~1: nessun video letto, mi fermo"
  set /a FALLITI+=1
  set "FALLITI_ELENCO=!FALLITI_ELENCO! mine-youtube-fermo"
  set "YT_STOP=1"
)
goto :eof

REM Fonti web: una chiamata per giro, le pagine cambiate dall'ultima lettura stanno in un blocco.
REM Stessa prova sull'effetto di mine-youtube: le letture registrate in data\web-mined.json
REM devono essere aumentate.
:mine_web
set "PEND="
for /f "delims=" %%n in ('npx tsx scripts\web-mine-batch.ts count 2^>nul') do set "PEND=%%n"
if "!PEND!"=="0" (
  call :log "--- mine-web SALTATO: nessuna pagina cambiata ---"
  goto :eof
)
set "LETTI_PRIMA=0"
for /f "delims=" %%n in ('npx tsx scripts\web-mine-batch.ts letti 2^>nul') do set "LETTI_PRIMA=%%n"
call :log "--- mine-web START, pagine da leggere: !PEND! ---"
claude %CLAUDE_JOB% --model sonnet --effort medium --dangerously-skip-permissions -p "/mine-web" >> "%LOG%" 2>&1
set "RC=!errorlevel!"
set "LETTI_DOPO=0"
for /f "delims=" %%n in ('npx tsx scripts\web-mine-batch.ts letti 2^>nul') do set "LETTI_DOPO=%%n"
call :log "--- mine-web END exit=!RC!, letture da !LETTI_PRIMA! a !LETTI_DOPO! ---"
call :conta "!RC!" "mine-web"
if !LETTI_DOPO! LEQ !LETTI_PRIMA! (
  call :log "mine-web: nessuna pagina letta"
  set /a FALLITI+=1
  set "FALLITI_ELENCO=!FALLITI_ELENCO! mine-web-fermo"
)
goto :eof

REM %~1 = exit code dello step, %~2 = nome. Il contatore decide l'exit code del bat.
:conta
if not "%~1"=="0" (
  set /a FALLITI+=1
  set "FALLITI_ELENCO=!FALLITI_ELENCO! %~2"
)
goto :eof

REM Gli step committano e pushano da soli, ma il push lo fa il modello e nessuno lo verificava.
REM L'08/09/2026 /mine-reddit ha committato 1888f1f senza pushare ed e' uscito 0: i dati sono
REM rimasti su una macchina sola per 22 ore mentre la verifica delle 09:00 diceva "tutto a
REM posto". Qui si guarda il repo, non il racconto dello step: chi giudica dagli effetti
REM collaterali eredita i loro difetti.
REM AVANTI va inizializzato: senza upstream il for non assegna niente e "" non e' "0", quindi
REM si spingerebbe a vuoto. --rebase --autostash per non restare bloccati da un file sporco
REM lasciato da un altro job dello stesso repo.
:guardia_push
set "AVANTI=0"
for /f %%c in ('git rev-list --count @{u}..HEAD 2^>nul') do set "AVANTI=%%c"
if "!AVANTI!"=="0" goto :eof
call :log "--- push mancante: !AVANTI! commit locali, li spingo io ---"
git pull --rebase --autostash >> "%LOG%" 2>&1
git push >> "%LOG%" 2>&1
if errorlevel 1 (
  call :log "push FALLITO"
  set /a FALLITI+=1
  set "FALLITI_ELENCO=!FALLITI_ELENCO! push-finale"
) else (
  call :log "push fatto"
)
goto :eof
