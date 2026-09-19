@echo off
setlocal
echo ========================================================
echo  Uninstalling ComputerMonitorAgent Startup Task
echo ========================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Requesting Administrator privileges...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Unregister-ScheduledTask -TaskName 'ComputerMonitorAgent' -Confirm:$false -ErrorAction SilentlyContinue;" ^
    "Stop-Process -Name 'ComputerMonitorAgent' -Force -ErrorAction SilentlyContinue"

echo.
echo [*] Task successfully removed and agent stopped.
timeout /t 3 >nul
