@echo off
setlocal enabledelayedexpansion

echo ==============================================================================
echo   ⚡ Project NetworkNebula — Cloudflare Zero-Trust WAN Tunnel
echo ==============================================================================
echo.
echo [*] Exposing local orchestrator (port 8000) to the public internet securely...
echo [*] Safe, encrypted TLS tunnel. No router port-forwarding or public IP required!
echo.

:: Check if cloudflared exists locally
if not exist "cloudflared.exe" (
    echo [*] cloudflared.exe not found. Downloading official Cloudflare binary...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
    if not exist "cloudflared.exe" (
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
echo     python nebula_worker.py join --server https://^<YOUR_TUNNEL_URL^> --tunnel
echo ==============================================================================
echo.

.\cloudflared.exe tunnel --url http://localhost:8000

pause
