#!/usr/bin/env bash
set -e

echo "=============================================================================="
echo "  ⚡ Project NetworkNebula — GPU Worker Node Connect"
echo "=============================================================================="
echo ""

read -p "Enter NetworkNebula Server IP/Host [default: 127.0.0.1]: " SERVER_IP
SERVER_IP=${SERVER_IP:-127.0.0.1}

read -p "Enter GPU VRAM Contribution Percentage (10-100) [default: 75]: " VRAM_PCT
VRAM_PCT=${VRAM_PCT:-75}

echo ""
echo "[*] Probing local GPU and connecting to http://${SERVER_IP}:8000 with ${VRAM_PCT}% VRAM limit..."
echo "[*] Press Ctrl+C at any time to disconnect gracefully."
echo ""

python3 nebula_worker.py join --server "http://${SERVER_IP}:8000" --vram-pct "${VRAM_PCT}" --tunnel
