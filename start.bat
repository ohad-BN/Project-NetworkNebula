@echo off
setlocal
title Project Network Nebula — Orchestrator Launcher

echo ===================================================================
echo     PROJECT NETWORK NEBULA — DECENTRALIZED AI SUPERCOMPUTING
echo ===================================================================
echo  Decentralized LLM Sharding, P2P Tensor Parallelism ^& GPU Swarm
echo ===================================================================
echo.

:: Switch to script root directory
cd /d "%~dp0"
set "ROOT_DIR=%~dp0"

:: 1. Check & Launch Docker Infrastructure
echo [1/4] Checking Docker infrastructure...
where docker >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       Starting Postgres, Redis, and MinIO containers...
    docker-compose up -d db redis minio
    echo       [OK] Infrastructure online: Postgres :5433, Redis :6379, MinIO :9000
) else (
    echo       [INFO] Docker not detected in PATH. Assuming local standalone services.
)
echo.

:: 2. Launch Celery GPU Worker Daemon
echo [2/4] Starting Celery GPU Compute Worker...
start "Network Nebula — GPU Compute Worker" /D "%ROOT_DIR%" cmd /k "title Network Nebula — GPU Worker && celery -A app.worker.celery_app worker --loglevel=info -P solo"
echo       [OK] Celery GPU Worker launched in dedicated window.
echo.

:: 3. Launch Backend API Orchestrator (FastAPI / Uvicorn)
echo [3/4] Starting Backend API Orchestrator on Port 8000...
start "Network Nebula — API Gateway" /D "%ROOT_DIR%" cmd /k "title Network Nebula — API Gateway && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
echo       [OK] Uvicorn API Gateway launched in dedicated window.
echo.

:: 4. Launch React 19 Frontend UI (Vite)
echo [4/4] Starting Enterprise Web UI on Port 5173...
where bun >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    start "Network Nebula — Web UI" /D "%ROOT_DIR%network-nebula" cmd /k "title Network Nebula — Web UI && bun run dev"
) else (
    start "Network Nebula — Web UI" /D "%ROOT_DIR%network-nebula" cmd /k "title Network Nebula — Web UI && npm run dev"
)
echo       [OK] Frontend Web UI launched in dedicated window.
echo.

:: 5. Wait for services to initialize and open browser
echo ===================================================================
echo Waiting 4 seconds for services to initialize...
ping -n 5 127.0.0.1 >nul

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
echo  - Governance and SLA:   http://localhost:5173/governance
echo  - MinIO Storage:        http://localhost:9001 (user: nebula / pass: nebula123)
echo ===================================================================
echo  Keep the opened terminal windows running to maintain the services.
echo  To shut down all services, run stop.bat or close the windows.
echo ===================================================================
echo.
pause
