#!/usr/bin/env bash
set -e

echo "=============================================================================="
echo "  🌌 Project NetworkNebula — Dedicated Server Stack Startup"
echo "=============================================================================="
echo ""

if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker is not installed. Please install Docker before running."
    exit 1
fi

echo "[*] Starting Docker Compose stack (Postgres, Redis, MinIO S3, FastAPI, Celery, React 19)..."
docker compose -f docker-compose.server.yml up -d --build

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo ""
echo "=============================================================================="
echo "  🚀 NetworkNebula Server is LIVE!"
echo "=============================================================================="
echo ""
echo "  * Web Console:        http://${SERVER_IP}:5173  (or http://${SERVER_IP}:80)"
echo "  * API Docs (Swagger): http://${SERVER_IP}:8000/docs"
echo "  * MinIO S3 Console:   http://${SERVER_IP}:9001  (nebula / nebula123)"
echo ""
echo "  Other PCs can join as GPU workers using:"
echo "    python nebula_worker.py join --server http://${SERVER_IP}:8000 --tunnel"
echo "=============================================================================="
