#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN_DIR="$ROOT_DIR/bin"
mkdir -p "$BIN_DIR"

echo "=============================================================================="
echo "  ⚡ Project NetworkNebula — Cloudflare Zero-Trust WAN Tunnel (macOS / Linux)"
echo "=============================================================================="
echo ""

if ! command -v cloudflared &>/dev/null; then
    echo "[*] cloudflared not found in PATH."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "[*] Detected macOS. Installing via Homebrew or direct binary..."
        if command -v brew &>/dev/null; then
            brew install cloudflared
        else
            curl -L --output "$BIN_DIR/cloudflared" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64
            chmod +x "$BIN_DIR/cloudflared"
            export PATH="$BIN_DIR:$PATH"
        fi
    else
        echo "[*] Downloading Linux 64-bit binary to bin/..."
        curl -L --output "$BIN_DIR/cloudflared" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
        chmod +x "$BIN_DIR/cloudflared"
        export PATH="$BIN_DIR:$PATH"
    fi
fi

echo "=============================================================================="
echo "  🚀 Starting Secure Cloudflare Tunnel..."
echo "  Copy the public 'https://*.trycloudflare.com' URL displayed below."
echo ""
echo "  Remote workers can join from anywhere on the internet using:"
echo "    python3 nebula_worker.py join --server https://<YOUR_TUNNEL_URL> --tunnel"
echo "=============================================================================="
echo ""

cloudflared tunnel --url http://localhost:8000
