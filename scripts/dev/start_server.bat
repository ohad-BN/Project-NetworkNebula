@echo off
setlocal enabledelayedexpansion

echo ==============================================================================
echo   🌌 Project NetworkNebula — Dedicated Server Stack Startup
echo ==============================================================================
echo.

:: Switch to repository root directory
cd /d "%~dp0..\.."

:: Check Docker installation
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not running.
    echo Please install Docker Desktop and start it before running this script.
    pause
    exit /b 1
)

echo [*] Starting Docker Compose stack (Postgres, Redis, MinIO S3, FastAPI, Celery, React 19 Console)...
docker compose -f docker-compose.server.yml up -d --build

if %errorlevel% equ 0 (
    echo.
    echo ==============================================================================
    echo   🚀 NetworkNebula Server is LIVE!
    echo ==============================================================================
    echo.
    echo   * Web Console:        http://localhost:5173  (or http://localhost:80)
    echo   * API Docs (Swagger): http://localhost:8000/docs
    echo   * MinIO S3 Console:   http://localhost:9001  (User: nebula, Pass: nebula123)
    echo.
    echo   Find this machine's local IP on LAN by running 'ipconfig' (e.g. 192.168.1.50).
    echo   Other PCs on your network can join using:
    echo     python nebula_worker.py join --server http://^<THIS_PC_IP^>:8000 --tunnel
    echo.
    echo ==============================================================================
) else (
    echo [ERROR] Docker Compose failed to start.
)

pause
