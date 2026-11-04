# 🖥️ Project NetworkNebula — Standalone GPU Worker Agent

Lightweight, self-contained CLI worker agent enabling any GPU or unified memory host to join the NetworkNebula decentralized supercomputing cluster.

## Features
- **Hardware Probing:** Automatically detects NVIDIA CUDA GPUs, Apple Silicon MPS unified memory, and fallback CPU cores.
- **Dynamic VRAM Limiting:** Enforces user-controlled memory caps (10%–100%) via `torch.cuda.set_per_process_memory_fraction()`.
- **Zero-Trust WebSocket Tunnels:** Persistent bidirectional streaming across NATs and firewalls.
- **Ring All-Reduce Synchronization:** Coordinates multi-node distributed LoRA gradients with fault-tolerant failovers.

## Quick Start

### 1. Installation
```bash
pip install -r requirements.txt
```

### 2. Join Fleet
```bash
# Connect with 80% VRAM contribution
python nebula_worker.py join --server http://<SERVER_IP>:8000 --name "My-RTX-4080" --vram-pct 80 --tunnel
```

### 3. Check Status
```bash
python nebula_worker.py status
```
