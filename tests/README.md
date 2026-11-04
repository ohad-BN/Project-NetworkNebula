# 🧪 Project NetworkNebula — Automated Testing Framework

This directory contains the automated test suites and validation harnesses for NetworkNebula.

## Test Suites

- **`test_suite.py`**: The authoritative unified end-to-end regression test suite covering all architecture phases (Phase 1 through Phase 13):
  - Hardware discovery & VRAM allocation fraction enforcement
  - Multi-worker batch sharding & Ring All-Reduce gradient aggregation
  - Cloudflare & WebSocket zero-trust tunnel streaming
  - Distributed MoE expert routing & speculative decoding
  - EIP-712 / Stripe billing and escrow settlement
  - Production SPA compilation and route integrity

## Running Tests

From the repository root:
```bash
python tests/test_suite.py
```
Or run individual phases:
```bash
python tests/test_suite.py --phase 2
```
