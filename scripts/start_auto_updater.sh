#!/usr/bin/env bash
# Project NetworkNebula — Zero-Touch Auto-Updater Daemon (Linux / macOS)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

echo "========================================================"
echo "  Project NetworkNebula - Zero-Touch Auto-Updater"
echo "  Watches GitHub 'main' and auto-deploys updates."
echo "========================================================"
python3 scripts/auto_updater.py --interval 60
