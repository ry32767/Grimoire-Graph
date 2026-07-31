@echo off
rem Start the auto-resume watchdog (Windows).
rem Usage: run-watchdog.cmd [deadline]   e.g. run-watchdog.cmd 2026-08-02T14:30:00
setlocal
set "HERE=%~dp0"
set "REPO=%HERE%..\.."
set "STATE=%USERPROFILE%\.claude\autoresume"
if not exist "%STATE%" mkdir "%STATE%"

set "DEADLINE=%~1"
if "%DEADLINE%"=="" set "DEADLINE=2026-08-02T14:30:00"

node "%HERE%watchdog.mjs" ^
  --project "%REPO%" ^
  --prompt-file "%HERE%resume-prompt.md" ^
  --stall 20 --poll 60 ^
  --deadline "%DEADLINE%" ^
  --log "%STATE%\grimoire.log" ^
  --state "%STATE%\grimoire-state.json" ^
  --stop-file "%HERE%STOP"
