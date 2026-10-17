@echo off
setlocal enabledelayedexpansion

echo ==============================================================================
echo   ⚡ Project NetworkNebula — GPU Worker Node Connect
echo ==============================================================================
echo.

:: Check Python installation
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.10+ to run this worker node.
    pause
    exit /b 1
)

:: Prompt for Server IP
set /p SERVER_IP="Enter NetworkNebula Server IP/Host [default: 127.0.0.1]: "
if "%SERVER_IP%"=="" set SERVER_IP=127.0.0.1

:: Prompt for VRAM Contribution %
set /p VRAM_PCT="Enter GPU VRAM Contribution Percentage (10-100) [default: 75]: "
if "%VRAM_PCT%"=="" set VRAM_PCT=75

echo.
echo [*] Probing local GPU and connecting to http://%SERVER_IP%:8000 with %VRAM_PCT%%% VRAM limit...
echo [*] Press Ctrl+C at any time to disconnect gracefully.
echo.

python nebula_worker.py join --server http://%SERVER_IP%:8000 --vram-pct %VRAM_PCT% --tunnel

pause
