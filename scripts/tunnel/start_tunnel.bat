@echo off
setlocal enabledelayedexpansion

echo ==============================================================================
echo   ⚡ Project NetworkNebula — Cloudflare Zero-Trust WAN Tunnel
echo ==============================================================================
echo.
echo [*] Exposing local orchestrator (port 8000) to the public internet securely...
echo [*] Safe, encrypted TLS tunnel. No router port-forwarding or public IP required!
echo.

:: Set up local bin directory
set "ROOT_DIR=%~dp0..\.."
set "BIN_DIR=%ROOT_DIR%\bin"
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
set "CLOUDFLARED=%BIN_DIR%\cloudflared.exe"

:: Check if cloudflared exists locally or in system PATH
where cloudflared >nul 2>&1
if %errorlevel% equ 0 (
    set "CLOUDFLARED=cloudflared"
) else if not exist "%CLOUDFLARED%" (
    echo [*] cloudflared not found. Downloading official Cloudflare binary to bin/...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CLOUDFLARED%'"
    if not exist "%CLOUDFLARED%" (
        echo [ERROR] Failed to download cloudflared.exe. Please check your internet connection.
        pause
        exit /b 1
    )
    echo [OK] cloudflared.exe downloaded successfully.
    echo.
)

echo ==============================================================================
echo   🚀 Starting Secure Cloudflare Tunnel...
echo   Copy the public 'https://*.trycloudflare.com' URL displayed below.
echo.
echo   Remote workers can join from anywhere on the internet using:
echo     python worker/nebula_worker.py join --server https://^<YOUR_TUNNEL_URL^> --tunnel
echo ==============================================================================
echo.

"%CLOUDFLARED%" tunnel --url http://localhost:8000

pause
