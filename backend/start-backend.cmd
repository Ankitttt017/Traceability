@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  Start the IndusTrace backend with its output written to a log file.
REM
REM  Runs independently of any editor terminal (closing the editor does not leave
REM  an orphan backend behind), refuses to start a second copy, and keeps a log.
REM  Ports (backend\.env): web API = PORT (9090), scanner TCP server = TCP_SERVER_PORT (5002).
REM
REM  Watch the log live:  powershell Get-Content logs\backend.log -Wait -Tail 50
REM ─────────────────────────────────────────────────────────────────────────────
cd /d "%~dp0"

netstat -ano | findstr /R /C:":9090 .*LISTENING" >nul
if %errorlevel%==0 (
  echo Port 9090 is already in use - a backend is already running.
  echo Stop it first ^(Ctrl+C in its window, or Task Manager^), then run this again.
  pause
  exit /b 1
)

if not exist logs mkdir logs
echo [%date% %time%] ===== backend start ===== >> logs\backend.log
echo Backend starting. Log: %~dp0logs\backend.log
node server.js >> logs\backend.log 2>&1
echo [%date% %time%] ===== backend stopped (exit code %errorlevel%) ===== >> logs\backend.log
echo Backend stopped (exit code %errorlevel%). See logs\backend.log
pause
