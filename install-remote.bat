@echo off
title Installing ComputerMonitor Agent...
echo =======================================================
echo Downloading ComputerMonitor Agent from Website...
echo ======================================================
curl -L -o ComputerMonitorAgent.exe https://computermonitor.pages.dev/ComputerMonitorAgent.exe
if exist "ComputerMonitorAgent.exe" (
    echo [OK] ComputerMonitorAgent.exe downloaded successfully!
    echo Starting agent in background...
    start "" "ComputerMonitorAgent.exe" --background
    echo.
    echo ======================================================
    echo ComputerMonitor Agent is now running!
    echo.
    echo Your computer's local IP address is:
    for /f "tokens=2" %%a in ('ipconfig ^< | findstr "IPv4"') do echo    %%a
    echo.
    echo Add this IP into your dashboard at: https://computermonitor.pages.dev
    echo (example: http://192.168.1.50:5500)
    echo ======================================================
) else (
    echo [ERROR] Failed to download ComputerMonitorAgent.exe.
)
pause
