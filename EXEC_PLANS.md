# Project NetworkNebula — Execution Plans

## Multi-Worker Task Dispatch & Payout Hardening
1. **User Authentication & Hardware Binding**:
   - Every worker node connecting via CLI or WebSocket tunnel authenticates using an assigned API key.
   - Payout transactions and earnings attribution are bound directly to the verified owner's account balance.
2. **Elimination of Fake Payouts**:
   - Idle worker nodes receive explicit idle status without synthetic tasks or phantom revenue credits.
   - Payouts are exclusively generated from verified, completed client training and inference tasks.
3. **Horsepower-Aware Batch Sharding**:
   - High-throughput CUDA GPUs handle the majority share of training micro-batches (e.g. 80%+).
   - CPU and consumer fallback nodes receive proportional sub-shards without bottlenecking the cluster.
