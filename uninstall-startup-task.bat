@echo off
title Remove ComputerMonitor Startup Task
color 0C
echo =================================================================
echo   [COMPUTER MONITOR] Removing Windows Startup Task
echo =================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Unregister-ScheduledTask -TaskName 'ComputerMonitorAgent' -Confirm:$false -ErrorAction SilentlyContinue; Stop-Process -Name 'ComputerMonitorAgent' -Force -ErrorAction SilentlyContinue"

echo [*] ComputerMonitorAgent has been removed from Windows Task Scheduler.
echo.
pause
