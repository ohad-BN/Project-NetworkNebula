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
