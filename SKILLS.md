# Project NetworkNebula — System Skills & Agent Capabilities

## Overview
Project NetworkNebula provides decentralized GPU orchestration, federated LoRA fine-tuning, Ring All-Reduce aggregation, and OpenAI-compatible inference serving.

## Core Capabilities
1. **Physical Hardware Probing & VRAM Allocation**: Automatic detection of CUDA / Apple Silicon / CPU devices with user-controlled VRAM allocation limits (10%-100%).
2. **WebSocket & NAT-Tolerant Tunnels**: Bidirectional persistent communication between orchestrators and decentralized compute contributors across dynamic public networks.
3. **Horsepower-Aware Multi-Worker Sharding**: Workload distribution weighted by accelerator throughput, VRAM capacity, and latency metrics.
4. **Ring All-Reduce Tensor Synchronization**: High-efficiency float32 tensor aggregation across multi-node worker clusters.
5. **Decentralized Model Serving**: OpenAI-compatible `/v1/chat/completions` API supporting dynamic adapter hot-swapping and speculative decoding.
6. **SLA Accounting & Financial Ledger**: Cryptographic audit trails, 70% host compute revenue shares, Stripe deposit verification, and Web3 USDC payouts.
