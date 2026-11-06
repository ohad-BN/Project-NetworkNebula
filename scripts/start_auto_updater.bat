@echo off
title NetworkNebula — Zero-Touch Auto-Updater Daemon
cd /d "%~dp0\.."
echo ========================================================
echo   Project NetworkNebula - Zero-Touch Auto-Updater
echo   Watches GitHub 'main' and auto-deploys updates.
echo ========================================================
python scripts/auto_updater.py --interval 120
pause
