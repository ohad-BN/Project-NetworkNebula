@echo off
setlocal enabledelayedexpansion
title Project Network Nebula — Shutdown

echo ===================================================================
echo     PROJECT NETWORK NEBULA — GRACEFUL SHUTDOWN
echo ===================================================================
echo.

cd /d "%~dp0..\.."

echo [1/2] Terminating Background Application Processes...
:: Kill by window titles
taskkill /F /FI "WINDOWTITLE eq Network Nebula*" >nul 2>&1

:: Kill processes bound to ports 8000 and 5173 if still lingering
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo       [OK] Uvicorn, Celery, and Vite services stopped.
echo.

echo [2/2] Stopping Docker Infrastructure & Containers...
where docker >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    docker compose -f docker-compose.server.yml down >nul 2>&1
    docker compose stop db redis minio >nul 2>&1
    docker-compose stop db redis minio >nul 2>&1
    echo       [OK] Docker containers stopped.
) else (
    echo       [OK] Docker not in PATH, skipping.
)

echo.
echo ===================================================================
echo  ALL NETWORK NEBULA SERVICES HAVE BEEN STOPPED CLEANLY.
echo ===================================================================
echo.
pause
