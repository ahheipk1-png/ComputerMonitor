# ComputerMonitor Game & Auto-Clicker Guard 1-Line Remote Installer
# Usage: irm https://computermonitor.pages.dev/install-game-guard.ps1 | iex

$ErrorActionPreference = 'SilentlyContinue'

# Require Elevation
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "Administrator rights required to install Game Guard as SYSTEM service."
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"irm https://computermonitor.pages.dev/install-game-guard.ps1 | iex`"" -Verb RunAs
    exit
}

$destDir = "$env:ProgramData\ComputerMonitor"
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }

$psContent = @'
# ComputerMonitor Game & Auto-Clicker Guard Watchdog
# Runs 24/7 under NT AUTHORITY\SYSTEM with highest resilience against tampering.
$ErrorActionPreference = 'SilentlyContinue'

$blocked_patterns = @(
    'roblox*',
    '*autoclick*',
    '*auto_click*',
    'tgmacro*',
    '*fastclicker*',
    'gsautoclicker*'
)

while ($true) {
    foreach ($pat in $blocked_patterns) {
        Get-Process -Name $pat -ErrorAction SilentlyContinue | ForEach-Object {
            try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
        }
    }

    $agent = Get-Process -Name 'ComputerMonitorAgent' -ErrorAction SilentlyContinue
    if (-not $agent) {
        $agentExe = "C:\ProgramData\ComputerMonitor\ComputerMonitorAgent.exe"
        if (Test-Path $agentExe) {
            Start-Process -FilePath $agentExe -ArgumentList "--background" -WindowStyle Hidden -ErrorAction SilentlyContinue
        }
    }

    Start-Sleep -Seconds 2
}
'@

Set-Content -Path "$destDir\GameGuard.ps1" -Value $psContent -Encoding UTF8

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$destDir\GameGuard.ps1`"" -WorkingDirectory $destDir
$trigBoot = New-ScheduledTaskTrigger -AtStartup
$trigLogon = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0) -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)

Unregister-ScheduledTask -TaskName 'ComputerMonitorGameGuard' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'ComputerMonitorGameGuard' -Action $action -Trigger @($trigBoot, $trigLogon) -Principal $principal -Settings $settings -Force
Start-ScheduledTask -TaskName 'ComputerMonitorGameGuard' -ErrorAction SilentlyContinue

# Immediately kill any active targets
$blocked = @('roblox*', '*autoclick*', '*auto_click*', 'tgmacro*', '*fastclicker*', 'gsautoclicker*')
foreach ($p in $blocked) {
    Get-Process -Name $p -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "Terminated blocked process: $($_.ProcessName) (PID $($_.Id))" -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "ComputerMonitorGameGuard installed and activated successfully under NT AUTHORITY\SYSTEM!" -ForegroundColor Green
