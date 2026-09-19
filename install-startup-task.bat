@echo off
setlocal
echo ========================================================
echo  Installing ComputerMonitorAgent as System-Wide Service
echo ========================================================

:: Check for Administrator elevation and self-elevate if necessary
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Requesting Administrator privileges...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

set "DEST_DIR=%ProgramData%\ComputerMonitor"
set "AGENT_EXE=%~dp0ComputerMonitorAgent.exe"

if not exist "%AGENT_EXE%" (
    echo [!] ComputerMonitorAgent.exe not found in %~dp0
    pause
    exit /b 1
)

if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"
copy /y "%AGENT_EXE%" "%DEST_DIR%\ComputerMonitorAgent.exe" >nul
if exist "%~dp0fleet_id.txt" copy /y "%~dp0fleet_id.txt" "%DEST_DIR%\fleet_id.txt" >nul
if exist "%~dp0alias.txt" copy /y "%~dp0alias.txt" "%DEST_DIR%\alias.txt" >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$action = New-ScheduledTaskAction -Execute '%DEST_DIR%\ComputerMonitorAgent.exe' -Argument '--background' -WorkingDirectory '%DEST_DIR%';" ^
    "$trigBoot = New-ScheduledTaskTrigger -AtStartup;" ^
    "$trigLogon = New-ScheduledTaskTrigger -AtLogOn;" ^
    "$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest;" ^
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1);" ^
    "Unregister-ScheduledTask -TaskName 'ComputerMonitorAgent' -Confirm:$false -ErrorAction SilentlyContinue;" ^
    "Register-ScheduledTask -TaskName 'ComputerMonitorAgent' -Action $action -Trigger @($trigBoot, $trigLogon) -Principal $principal -Settings $settings -Force;" ^
    "Start-ScheduledTask -TaskName 'ComputerMonitorAgent'"

echo.
echo [SUCCESS] ComputerMonitorAgent registered for ALL user accounts!
echo [*] Runs automatically at Windows startup (before logon) and for ANY account.
echo [*] Continuous 24/7 background telemetry is now active.
timeout /t 4 >nul
