@echo off
:: ComputerMonitor - Uninstall System-Wide Chrome & Edge Extension
setlocal EnableDelayedExpansion

net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo [*] Removing Chrome extension policies...
reg delete "HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /v 101 /f >nul 2>&1
reg delete "HKLM\Software\Policies\Google\Chrome\ExtensionInstallSources" /v 101 /f >nul 2>&1
reg delete "HKLM\Software\Policies\Google\Chrome\ExtensionInstallSources" /v 102 /f >nul 2>&1
reg delete "HKLM\Software\Google\Chrome\Extensions\ijfbfnckpabilcbgenhjddgchockeobe" /f >nul 2>&1
reg delete "HKLM\Software\WOW6432Node\Google\Chrome\Extensions\ijfbfnckpabilcbgenhjddgchockeobe" /f >nul 2>&1

echo [*] Removing Edge extension policies...
reg delete "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" /v 101 /f >nul 2>&1
reg delete "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallSources" /v 101 /f >nul 2>&1
reg delete "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallSources" /v 102 /f >nul 2>&1

echo [SUCCESS] Extension policies removed.
timeout /t 3
