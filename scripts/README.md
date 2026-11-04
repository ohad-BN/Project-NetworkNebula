# 🛠️ Project NetworkNebula — Automation & Scripts Hub

This directory contains operational, developmental, and worker scripts for NetworkNebula.

## Directory Structure

```
scripts/
├── dev/
│   ├── start_server.bat / .sh    # Starts the complete Docker Compose production stack
│   └── stop.bat                  # Stops all running local services & Docker containers
├── tunnel/
│   ├── start_tunnel.bat / .sh    # Initializes secure Zero-Trust Cloudflare WAN tunnel
├── worker/
│   ├── join_mesh.bat / .sh       # Interactive GPU node discovery & fleet connector
└── data/
    ├── prepare_real_dataset.py   # Fetches Stanford Alpaca dataset and uploads to MinIO S3
    └── get_payout.py             # CLI worker payout and fleet telemetry inspector
```

## Quick Reference

| Purpose | Windows Command | Linux / macOS Command |
| :--- | :--- | :--- |
| **Start Server Stack** | `.\scripts\dev\start_server.bat` | `./scripts/dev/start_server.sh` |
| **Stop All Services** | `.\scripts\dev\stop.bat` | `docker compose -f docker-compose.server.yml down` |
| **Start WAN Tunnel** | `.\scripts\tunnel\start_tunnel.bat` | `./scripts/tunnel/start_tunnel.sh` |
| **Join GPU Worker** | `.\scripts\worker\join_mesh.bat` | `./scripts/worker/join_mesh.sh` |
| **Prepare Alpaca Dataset** | `python scripts/data/prepare_real_dataset.py` | `python3 scripts/data/prepare_real_dataset.py` |
| **Query Worker Payout** | `python scripts/data/get_payout.py` | `python3 scripts/data/get_payout.py` |
