# Project NetworkNebula — Architectural Roadmap

## Phase 1: Core Foundation & Telemetry
- Standalone CLI agent hardware discovery.
- Dynamic CUDA VRAM allocation ceiling enforcement.
- Central PostgreSQL and Redis telemetry pipelines.

## Phase 2: Distributed Multi-Node LoRA Training
- Dataset micro-batch partitioning with hardware capacity weighting.
- Ring All-Reduce byte bucket gradient aggregation.
- S3 checkpoint export and unified safetensors serialization.

## Phase 3: Autonomous Compute Fleet & WebSockets
- NAT/Firewall-friendly WebSocket tunneling over Cloudflare or direct sockets.
- Authenticated node registration and host ledger attribution.
- Fault-tolerant failover re-routing and standby node promotion.

## Phase 4: Production Serving & Commercial Settlement
- OpenAI gateway endpoints for inference and catalog discovery.
- Multi-rail billing (Stripe Checkout and EIP-712 Web3 USDC settlements).
- Closed Alpha access controls, OTP email verification, and community faucets.

## Phase 5: "Always Silent" Stealth Worker Daemon & Autonomous Compute Regulation
- **Zero-Privilege Human Presence Sensing:** Sub-microsecond OS-level input idle detection across Windows (`GetLastInputInfo`), macOS (`IOKit/HIDIdleTime`), and Linux (`XScreenSaver`/Wayland D-Bus) without keylogging or elevated root privileges.
- **Micro-Duty-Cycle Inter-Kernel Yielding:** Dynamic interleaving of compute mini-batches with microsecond yield sleeps (`15ms–40ms`) ensuring Desktop Window Manager (`dwm.exe`/`WindowServer`) never drops below 60/120/144 Hz frame deadlines.
- **Closed-Loop Acoustic & Thermal Governor:** Software-level temperature and fan speed gating maintaining GPU junction below 62°C to enforce whisper-quiet acoustic compliance (<32 dBA).
- **Two-Tier Elastic VRAM Reclamation:** Adaptive memory management guaranteeing at least 4.5 GB of free VRAM during interactive desktop hours for Chrome, Excel, and hardware-accelerated productivity apps.
- **PoDS Micro-Slice Pacing & Adaptive Orchestrator Scheduling:** Continuous generation of cryptographically verified Proof-of-Delivered-Slice (PoDS) micro-rewards in background stealth mode without straggler penalties or slashing risks.
