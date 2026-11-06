@echo off
title NetworkNebula — Central Server Launcher
cd /d "%~dp0\.."
echo ========================================================
echo   Project NetworkNebula - Headless Server Launcher
echo ========================================================
echo Starting PostgreSQL, Redis, MinIO, FastAPI, Celery, and Web Console...
docker compose -f docker-compose.server.yml up -d --build
echo.
echo ========================================================
echo Server stack running in background!
echo Web Console: http://localhost:80
echo API Gateway: http://localhost:8000
echo ========================================================
pause
