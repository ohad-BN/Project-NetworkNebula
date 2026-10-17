@echo off
setlocal enabledelayedexpansion
title Project Network Nebula — Orchestrator Launcher

echo ===================================================================
echo     ____             _           __     _   __     __          __     
echo    / __ \_________  (_)__  _____/ /_   / ^| / /__  / /_  __  __/ /___ _
echo   / /_/ / ___/ __ \/ / _ \/ ___/ __/  /  ^|/ / _ \/ __ \/ / / / / __ `/
echo  / ____/ /  / /_/ / /  __/ /__/ /_   / /^|  /  __/ /_/ / /_/ / / /_/ / 
echo /_/   /_/   \____/ /\___/\___/\__/  /_/ ^|_/\___/_.___/\__,_/_/\__,_/  
echo                /___/                                                   
echo ===================================================================
echo  Decentralized AI Supercomputing ^& GPU Worker Swarm Platform
echo ===================================================================
echo.

:: Switch to script root directory
cd /d "%~dp0"

:: 1. Check & Launch Docker Infrastructure
echo [1/4] Checking Docker infrastructure (Postgres, Redis, MinIO)...
where docker >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    docker-compose up -d db redis minio
    if %ERRORLEVEL% EQU 0 (
        echo       [OK] Database (5433), Redis (6379), MinIO (9000/9001) online.
    ) else (
        echo       [WARN] docker-compose encountered an issue. Ensure Docker Desktop is running.
    )
) else (
    echo       [WARN] Docker not found in PATH. Assuming local standalone services.
)
echo.

:: 2. Launch Celery GPU Worker Daemon
echo [2/4] Starting Celery GPU Compute Worker...
start "Network Nebula — GPU Compute Worker" cmd /k "cd /d "%~dp0" && title Network Nebula — GPU Worker && celery -A app.worker.celery_app worker --loglevel=info -P solo"
echo       [OK] GPU Compute Worker launched in dedicated window.
echo.

:: 3. Launch Backend API Orchestrator (FastAPI / Uvicorn)
echo [3/4] Starting Backend API Orchestrator (FastAPI on Port 8000)...
start "Network Nebula — API Gateway (Port 8000)" cmd /k "cd /d "%~dp0" && title Network Nebula — API Gateway && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
echo       [OK] API Gateway launched in dedicated window.
echo.

:: 4. Launch React 19 Frontend UI (Vite)
echo [4/4] Starting Enterprise Web UI (Vite on Port 5173)...
where bun >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    start "Network Nebula — Web UI (Port 5173)" cmd /k "cd /d "%~dp0network-nebula" && title Network Nebula — Web UI && bun run dev"
) else (
    start "Network Nebula — Web UI (Port 5173)" cmd /k "cd /d "%~dp0network-nebula" && title Network Nebula — Web UI && npm run dev"
)
echo       [OK] Frontend Web UI launched in dedicated window.
echo.

:: 5. Wait for services to initialize and open browser
echo ===================================================================
echo Waiting 4 seconds for services to initialize...
timeout /t 4 /nobreak >nul

echo Opening Network Nebula Web Dashboard in your default browser...
start http://localhost:5173/

echo.
echo ===================================================================
echo  NETWORK NEBULA PLATFORM IS ONLINE!
echo ===================================================================
echo  - Enterprise Web UI:    http://localhost:5173/
echo  - Interactive Swagger:  http://localhost:8000/docs
echo  - Redoc API Reference:  http://localhost:8000/redoc
echo  - Swarm Sharding Hub:   http://localhost:5173/swarm
echo  - GPU Fleet Cockpit:    http://localhost:5173/cluster-status
echo  - Governance ^& SLA:     http://localhost:5173/governance
echo  - MinIO Storage:        http://localhost:9001 (user: nebula / pass: nebula123)
echo ===================================================================
echo  Keep the opened terminal windows running to maintain the services.
echo  To shut down all services, run 'stop.bat' or close the windows.
echo ===================================================================
echo.
pause
