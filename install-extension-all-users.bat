@echo off
:: ComputerMonitor - Chrome and Edge Tab Tracker Extension Installer
:: Registers extension for Current User and All Users (via Machine Policy when Admin).

setlocal EnableDelayedExpansion
echo =====================================================================
echo  ComputerMonitor - Install Tab Tracker Extension (Chrome and Edge)
echo =====================================================================
echo.

set "TARGET_DIR=%ProgramData%\ComputerMonitor\extension"
if not exist "%ProgramData%\ComputerMonitor" mkdir "%ProgramData%\ComputerMonitor" >nul 2>&1
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%" >nul 2>&1

:: Copy extension files
set "SRC_DIR=%~dp0extension"
if exist "%SRC_DIR%\manifest.json" (
    copy /y "%SRC_DIR%\*.*" "%TARGET_DIR%\" >nul 2>&1
    echo [OK] Extension files staged in %TARGET_DIR%
)
if exist "%~dp0extension.crx" (
    copy /y "%~dp0extension.crx" "%TARGET_DIR%\" >nul 2>&1
    echo [OK] Extension CRX staged in %TARGET_DIR%
)

:: 1. Always register for Current User (No Admin rights needed)
echo [*] Registering extension for Current User...
reg add "HKCU\Software\Google\Chrome\Extensions\ijfbfnckpabilcbgenhjddgchockeobe" /v "path" /t REG_SZ /d "%TARGET_DIR%\extension.crx" /f >nul 2>&1
reg add "HKCU\Software\Google\Chrome\Extensions\ijfbfnckpabilcbgenhjddgchockeobe" /v "version" /t REG_SZ /d "1.0.0" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Edge\Extensions\ijfbfnckpabilcbgenhjddgchockeobe" /v "path" /t REG_SZ /d "%TARGET_DIR%\extension.crx" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Edge\Extensions\ijfbfnckpabilcbgenhjddgchockeobe" /v "version" /t REG_SZ /d "1.0.0" /f >nul 2>&1

:: 2. Check for Administrator privileges to register System-Wide Policy (All Users)
net session >nul 2>&1
if %errorLevel% equ 0 (
    echo [*] Administrator privileges detected. Registering System-Wide Policies for ALL users...

    :: Chrome All-Users Policy (Chromium strictly requires sequential integer values starting at 1)
    reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "ijfbfnckpabilcbgenhjddgchockeobe;http://127.0.0.1:5500/extension/updates.xml" /f >nul 2>&1
    reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /v 101 /t REG_SZ /d "ijfbfnckpabilcbgenhjddgchockeobe;http://127.0.0.1:5500/extension/updates.xml" /f >nul 2>&1
    reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallSources" /v 1 /t REG_SZ /d "http://127.0.0.1:5500/*" /f >nul 2>&1
    reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallSources" /v 2 /t REG_SZ /d "https://computermonitor.pages.dev/*" /f >nul 2>&1
    reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallSources" /v 101 /t REG_SZ /d "http://127.0.0.1:5500/*" /f >nul 2>&1
    reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallSources" /v 102 /t REG_SZ /d "https://computermonitor.pages.dev/*" /f >nul 2>&1

    reg add "HKLM\Software\Google\Chrome\Extensions\ijfbfnckpabilcbgenhjddgchockeobe" /v "path" /t REG_SZ /d "%TARGET_DIR%\extension.crx" /f >nul 2>&1
    reg add "HKLM\Software\Google\Chrome\Extensions\ijfbfnckpabilcbgenhjddgchockeobe" /v "version" /t REG_SZ /d "1.0.0" /f >nul 2>&1
    reg add "HKLM\Software\WOW6432Node\Google\Chrome\Extensions\ijfbfnckpabilcbgenhjddgchockeobe" /v "path" /t REG_SZ /d "%TARGET_DIR%\extension.crx" /f >nul 2>&1
    reg add "HKLM\Software\WOW6432Node\Google\Chrome\Extensions\ijfbfnckpabilcbgenhjddgchockeobe" /v "version" /t REG_SZ /d "1.0.0" /f >nul 2>&1

    :: Edge All-Users Policy
    reg add "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "ijfbfnckpabilcbgenhjddgchockeobe;http://127.0.0.1:5500/extension/updates.xml" /f >nul 2>&1
    reg add "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v 101 /t REG_SZ /d "ijfbfnckpabilcbgenhjddgchockeobe;http://127.0.0.1:5500/extension/updates.xml" /f >nul 2>&1
    reg add "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallSources" /v 1 /t REG_SZ /d "http://127.0.0.1:5500/*" /f >nul 2>&1
    reg add "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallSources" /v 2 /t REG_SZ /d "https://computermonitor.pages.dev/*" /f >nul 2>&1
    reg add "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallSources" /v 101 /t REG_SZ /d "http://127.0.0.1:5500/*" /f >nul 2>&1
    reg add "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallSources" /v 102 /t REG_SZ /d "https://computermonitor.pages.dev/*" /f >nul 2>&1

    echo.
    echo =====================================================================
    echo  [SUCCESS] Tab Tracker installed for ALL Chrome and Edge users!
    echo =====================================================================
) else (
    echo.
    echo =====================================================================
    echo  [SUCCESS] Tab Tracker registered for CURRENT user!
    echo  (To install for ALL users on this PC, right-click and 'Run as administrator')
    echo =====================================================================
)

echo.
ping 127.0.0.1 -n 3 >nul
