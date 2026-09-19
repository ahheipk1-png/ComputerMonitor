@echo off
title Install ComputerMonitor Startup Task
color 0A
echo =================================================================
echo   [COMPUTER MONITOR] Registering Windows Startup Task
echo =================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$action = New-ScheduledTaskAction -Execute '%~dp0ComputerMonitorAgent.exe' -Argument '--background'; $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited; $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName 'ComputerMonitorAgent' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force; Start-ScheduledTask -TaskName 'ComputerMonitorAgent'"

if %errorlevel% equ 0 (
    echo.
    echo [*] SUCCESS! ComputerMonitorAgent is now registered in Windows Task Scheduler.
    echo [*] It will now automatically run quietly in the background whenever your computer boots!
) else (
    echo.
    echo [!] Failed to register task.
)

echo.
pause
