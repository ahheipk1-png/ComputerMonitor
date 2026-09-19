@echo off
title ComputerMonitor Agent Launcher
color 0B
echo =================================================================
echo   [COMPUTER MONITOR] One-Click Agent Launcher
echo =================================================================
echo.
echo [*] Checking Python and dependencies...

python -c "import psutil" >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Installing psutil dependency...
    pip install psutil
)

echo [*] Starting Telemetry Agent...
echo [*] Opening live website in your default browser...
echo.
python agent.py

pause
