@echo off
setlocal
echo ========================================================
echo   ComputerMonitor Game & Auto-Clicker Guard Installer
echo ========================================================

:: Check for Administrator elevation and self-elevate if necessary
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Requesting Administrator privileges...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

set "DEST_DIR=%ProgramData%\ComputerMonitor"
if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

echo [*] Creating GameGuard.ps1 watchdog script...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$psContent = @'" + [Environment]::NewLine + ^
    "# ComputerMonitor Game & Auto-Clicker Guard Watchdog" + [Environment]::NewLine + ^
    "# Runs 24/7 under NT AUTHORITY\SYSTEM with highest resilience against tampering." + [Environment]::NewLine + ^
    "$ErrorActionPreference = 'SilentlyContinue'" + [Environment]::NewLine + ^
    "$blocked_patterns = @('roblox*', '*autoclick*', '*auto_click*', 'tgmacro*', '*fastclicker*', 'gsautoclicker*')" + [Environment]::NewLine + ^
    "while ($true) {" + [Environment]::NewLine + ^
    "    foreach ($pat in $blocked_patterns) {" + [Environment]::NewLine + ^
    "        Get-Process -Name $pat -ErrorAction SilentlyContinue | ForEach-Object {" + [Environment]::NewLine + ^
    "            try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}" + [Environment]::NewLine + ^
    "        }" + [Environment]::NewLine + ^
    "    }" + [Environment]::NewLine + ^
    "    $agent = Get-Process -Name 'ComputerMonitorAgent' -ErrorAction SilentlyContinue" + [Environment]::NewLine + ^
    "    if (-not $agent) {" + [Environment]::NewLine + ^
    "        $agentExe = 'C:\ProgramData\ComputerMonitor\ComputerMonitorAgent.exe'" + [Environment]::NewLine + ^
    "        if (Test-Path $agentExe) {" + [Environment]::NewLine + ^
    "            Start-Process -FilePath $agentExe -ArgumentList '--background' -WindowStyle Hidden -ErrorAction SilentlyContinue" + [Environment]::NewLine + ^
    "        }" + [Environment]::NewLine + ^
    "    }" + [Environment]::NewLine + ^
    "    Start-Sleep -Seconds 2" + [Environment]::NewLine + ^
    "}" + [Environment]::NewLine + ^
    "'@;" + [Environment]::NewLine + ^
    "Set-Content -Path '%DEST_DIR%\GameGuard.ps1' -Value $psContent -Encoding UTF8;"

echo [*] Registering ComputerMonitorGameGuard Scheduled Task as SYSTEM...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DEST_DIR%\GameGuard.ps1\"' -WorkingDirectory '%DEST_DIR%';" ^
    "$trigBoot = New-ScheduledTaskTrigger -AtStartup;" ^
    "$trigLogon = New-ScheduledTaskTrigger -AtLogOn;" ^
    "$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest;" ^
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0) -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1);" ^
    "Unregister-ScheduledTask -TaskName 'ComputerMonitorGameGuard' -Confirm:$false -ErrorAction SilentlyContinue;" ^
    "Register-ScheduledTask -TaskName 'ComputerMonitorGameGuard' -Action $action -Trigger @($trigBoot, $trigLogon) -Principal $principal -Settings $settings -Force;" ^
    "Start-ScheduledTask -TaskName 'ComputerMonitorGameGuard' -ErrorAction SilentlyContinue;"

echo [*] Immediately terminating any active Roblox or auto-clicker processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$blocked_patterns = @('roblox*', '*autoclick*', '*auto_click*', 'tgmacro*', '*fastclicker*', 'gsautoclicker*');" ^
    "foreach ($pat in $blocked_patterns) {" ^
    "    Get-Process -Name $pat -ErrorAction SilentlyContinue | ForEach-Object {" ^
    "        Write-Host '[TERMINATED]' $_.ProcessName '(PID' $_.Id ')';" ^
    "        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue;" ^
    "    }" ^
    "}"

echo.
echo ========================================================
echo  [SUCCESS] ComputerMonitorGameGuard is Active!
echo  - Protected targets: Roblox and Auto-Clicker processes
echo  - Registered under NT AUTHORITY\SYSTEM (child cannot stop)
echo  - Auto-restarts at system startup and user logon
echo ========================================================
timeout /t 4 >nul
