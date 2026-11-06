@echo off
setlocal enabledelayedexpansion
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

:: ---------------------------------------------------------------------
:: 1. Detect Environment Capabilities
:: ---------------------------------------------------------------------
set "HAS_UVICORN=0"
set "HAS_CELERY=0"
set "HAS_FRONTEND=0"

where uvicorn >nul 2>&1
if !ERRORLEVEL! EQU 0 set "HAS_UVICORN=1"

where celery >nul 2>&1
if !ERRORLEVEL! EQU 0 set "HAS_CELERY=1"

where bun >nul 2>&1
if !ERRORLEVEL! EQU 0 set "HAS_FRONTEND=1"
where npm >nul 2>&1
if !ERRORLEVEL! EQU 0 set "HAS_FRONTEND=1"

:: If any parameter like --server or --docker was passed, or if local dev tools are missing:
if "%1"=="--server" goto :run_docker_stack
if "%1"=="--docker" goto :run_docker_stack

if "!HAS_UVICORN!"=="0" (
    echo [DETECTED] Host Python 'uvicorn' is not installed in Windows PATH.
    echo [ACTION]   Auto-switching to Full Containerized Docker Server Stack!
    echo            (Postgres, Redis, MinIO, FastAPI API, Celery, and Web Console)
    echo            Zero host Python or Node.js required on this machine.
    echo.
    goto :run_docker_stack
)

if "!HAS_CELERY!"=="0" (
    echo [DETECTED] Host Python 'celery' is not installed in Windows PATH.
    echo [ACTION]   Auto-switching to Full Containerized Docker Server Stack!
    echo.
    goto :run_docker_stack
)

if "!HAS_FRONTEND!"=="0" (
    echo [DETECTED] Host frontend tool 'npm' / 'bun' is not installed in Windows PATH.
    echo [ACTION]   Auto-switching to Full Containerized Docker Server Stack!
    echo.
    goto :run_docker_stack
)

:: ---------------------------------------------------------------------
:: 2. Developer Laptop Mode (All dev tools present, hot-reloading)
:: ---------------------------------------------------------------------
echo [MODE] Local Development Mode with Hot-Reload (Dev Workstation detected)
echo.

echo [1/4] Starting Database, Redis, and MinIO containers...
where docker >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    docker compose up -d db redis minio 2>nul || docker-compose up -d db redis minio
    echo       [OK] Infrastructure online: Postgres :5433, Redis :6379, MinIO :9000
) else (
    echo       [INFO] Docker not detected in PATH. Assuming local standalone services.
)
echo.

echo [2/4] Starting Celery GPU Compute Worker...
start "Network Nebula — GPU Compute Worker" /D "%ROOT_DIR%" cmd /k "title Network Nebula — GPU Worker && celery -A app.worker.celery_app worker --loglevel=info -P solo"
echo       [OK] Celery GPU Worker launched in dedicated window.
echo.

echo [3/4] Starting Backend API Orchestrator on Port 8000...
start "Network Nebula — API Gateway" /D "%ROOT_DIR%" cmd /k "title Network Nebula — API Gateway && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
echo       [OK] Uvicorn API Gateway launched in dedicated window.
echo.

echo [4/4] Starting Enterprise Web UI on Port 5173...
where bun >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    start "Network Nebula — Web UI" /D "%ROOT_DIR%network-nebula" cmd /k "title Network Nebula — Web UI && bun run dev"
) else (
    start "Network Nebula — Web UI" /D "%ROOT_DIR%network-nebula" cmd /k "title Network Nebula — Web UI && npm run dev"
)
echo       [OK] Frontend Web UI launched in dedicated window.
echo.

echo Waiting for services to initialize...
ping -n 5 127.0.0.1 >nul
start http://localhost:5173/

echo ===================================================================
echo  NETWORK NEBULA PLATFORM IS ONLINE!
echo ===================================================================
echo  - Enterprise Web UI:    http://localhost:5173/
echo  - API Gateway:          http://localhost:8000
echo  - Interactive Swagger:  http://localhost:8000/docs
echo ===================================================================
goto :finish


:: ---------------------------------------------------------------------
:: 3. Server / Old PC Mode (100% Docker, Zero Terminal Popups)
:: ---------------------------------------------------------------------
:run_docker_stack
echo [1/2] Verifying Docker daemon status...
where docker >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    echo ===================================================================
    echo [ERROR] Docker is not installed or not in PATH!
    echo         Please install Docker Desktop and ensure it is running.
    echo ===================================================================
    pause
    exit /b 1
)

echo [2/2] Launching Full Containerized Server Stack...
echo       (Building and starting Postgres, Redis, MinIO, API, Celery, and Web Console)
docker compose -f docker-compose.server.yml up -d --build 2>nul || docker-compose -f docker-compose.server.yml up -d --build

if !ERRORLEVEL! EQU 0 (
    echo.
    echo ===================================================================
    echo  NETWORK NEBULA DEDICATED SERVER IS LIVE!
    echo ===================================================================
    echo  - Web Console:        http://localhost:80  (or http://localhost:5173)
    echo  - API Gateway:        http://localhost:8000
    echo  - Swagger Docs:       http://localhost:8000/docs
    echo  - MinIO Storage:      http://localhost:9001 (user: nebula / pass: nebula123)
    echo ===================================================================
    echo  All services are running cleanly inside isolated Docker containers.
    echo  No terminal popup windows required!
    echo ===================================================================
    ping -n 4 127.0.0.1 >nul
    start http://localhost:80/
) else (
    echo.
    echo [ERROR] Docker Compose failed to start the stack.
    echo Check Docker Desktop dashboard to ensure the Docker daemon is running.
)

:finish
pause
