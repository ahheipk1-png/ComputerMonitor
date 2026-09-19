@echo off
title Stop ComputerMonitor Agent
color 0C
echo =================================================================
echo   [COMPUTER MONITOR] Stopping Telemetry Agent
echo =================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName 'ComputerMonitorAgent' -ErrorAction SilentlyContinue; Stop-Process -Name 'ComputerMonitorAgent' -Force -ErrorAction SilentlyContinue"

echo [*] Agent process and scheduled task have been stopped.
echo [*] Your web dashboard will now show the Red Disconnected Alert!
echo.
pause
