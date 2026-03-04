@echo off
REM Fetch 1 YouTube transcript per run. Schedule every 5 min via Task Scheduler.
REM YouTube rate-limits after ~20 requests, so spacing them out avoids blocks.
cd /d "c:\claude-code\Personale\beyblade combos"
python scripts/fetch-transcripts.py --batch 1
