#!/usr/bin/env bash
set -e

echo "=============================================================================="
echo "  ⚡ Project NetworkNebula — Compute Worker Node Connect (macOS / Linux)"
echo "=============================================================================="
echo ""

# Ensure python3 exists
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] python3 is not installed or not in PATH."
    exit 1
fi

# Ensure lightweight dependencies (requests, websockets) are installed
if ! python3 -c "import requests, websockets" &>/dev/null; then
    echo "[*] Installing required client libraries (requests, websockets)..."
    pip3 install --quiet requests websockets || python3 -m pip install --quiet requests websockets || true
fi

read -p "Enter NetworkNebula Server IP/Host [default: 127.0.0.1]: " SERVER_IP
SERVER_IP=${SERVER_IP:-127.0.0.1}

read -p "Enter Node Display Name [default: MacBook-Worker]: " NODE_NAME
NODE_NAME=${NODE_NAME:-MacBook-Worker}

read -p "Enter Unique Worker ID [default: node-macbook]: " WORKER_ID
WORKER_ID=${WORKER_ID:-node-macbook}

read -p "Enter GPU/Unified Memory Contribution Percentage (10-100) [default: 75]: " VRAM_PCT
VRAM_PCT=${VRAM_PCT:-75}

echo ""
echo "[*] Connecting to http://${SERVER_IP}:8000 as '${NODE_NAME}' (${WORKER_ID}) with ${VRAM_PCT}% contribution limit..."
echo "[*] Press Ctrl+C at any time to disconnect gracefully."
echo ""

python3 nebula_worker.py join --server "http://${SERVER_IP}:8000" --name "${NODE_NAME}" --worker-id "${WORKER_ID}" --vram-pct "${VRAM_PCT}" --tunnel
