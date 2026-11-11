# Multi-Machine Fleet Training Failure — Root-Cause Analysis & Implementation Plan

> **Target Branch:** `oracle-server`  
> **Live Production Baseline:** `158.178.251.80` (currently running commit `c1598ac`)  
> **Status:** Analysis Complete — Ready for Implementation & Deployment  

---

## Executive Summary

Connecting a second machine (`DESKTOP-C2AK165`, Intel Iris Xe Graphics, 1 GB VRAM, missing `peft` / `transformers` training packages) to the same fleet caused distributed training jobs to fail while **connectivity and fleet monitoring continued working normally**. Single-machine training on the primary RTX 4070 Laptop GPU machine (`node-skorp`) succeeds when connected alone.

Live database records, Redis tunnel state, Celery logs, API logs, and a full diff audit between the live `c1598ac` server and the local workspace reveal **four interacting bugs**:

1. **Scheduler & UI Blindly Included a Non-Training Machine:** The UI's `Auto-Swarm` toggle counted every online node regardless of `supported_task_types`, asking for `num_gpus = 2`. Live `c1598ac` bypassed eligibility filtering and pushed a training shard to the Intel Iris Xe node (`supported_task_types='batch_inference'`). Worse, **deploying the current local workspace without fixing this plan would turn that crash into a silent infinite hang** (`status='queued'` forever), because `Training Studio` still requests `num_gpus = 2` while local `DistributedTrainingEngine.resolve_worker_fleet()` returns `[]` whenever `len(eligible_workers) < num_gpus`.
2. **Dishonest Worker Capability Reporting & Silent Missing Dependencies:** `worker/nebula_worker.py` unconditionally advertises `"compute_capabilities": ["inference", "training"]` over the WebSocket tunnel even when `probe_compute_dependencies()["ready"]` is `False` (missing `peft`/`transformers`/`safetensors`/`accelerate`). Meanwhile `/connect.ps1` and `/connect.sh` never pre-check or offer to install ML training dependencies.
3. **No Sibling Cancellation, Shard Failover, or Terminal-State DB Guard:** When the second machine crashed within 2 seconds and Celery marked the job `failed`, the primary GPU (`node-skorp`) was never told to stop, continued running all epochs, and the WebSocket `training_epoch` handler overwrote `current_epoch = 3` and appended loss curves onto already-`failed` and `cancelled` jobs.
4. **Un-deployed Local Phase 2–4 Glue Seams:** Several wiring gaps from the Private BYO Training rollout exist in the local workspace (`required_vram_gb=2.0` hardcoding, dropped `train_type`/`sealed_secrets`/`storage_retention` forwarding, and placeholder `"tunnel_stream://client-ram"`) and should be cleanly closed in the same rollout.

---

## 1. Live Debug & Root-Cause Evidence (`158.178.251.80`, `c1598ac`)

### 1.1 Second Machine Registration Telemetry (`2026-11-11 06:49:23 UTC`)

The second machine accurately identified its hardware and excluded `"training"` from `supported_task_types`, yet was still assigned distributed training jobs:

```text
id='node-desktop-c2ak'
name='DESKTOP-C2AK165 (Intel(R) Iris(R) Xe Graphics)'
gpu_info='Intel(R) Iris(R) Xe Graphics'
cpu_cores=8, memory_gb=15.79, gpu_memory_gb=1.0, vram_allocation_pct=80
compute_architecture='cpu_simd'
hardware_tier='intel_arc'
supported_task_types='batch_inference'
```

*(Note: `node-desktop-c2ak` was manually removed at `06:54:36 UTC`; `node-skorp` RTX 4070 Laptop GPU 8 GB remains online.)*

### 1.2 Observed Job Failures & Orphaned Execution Trace (`06:52–06:57 UTC`)

| Job ID | Config | What Happened in Live Logs & Postgres | Root Failure |
| :--- | :--- | :--- | :--- |
| `de7ed8a7-cedb-464f-b0bf-2eafac5a7b0d` | `1` epoch, `num_gpus=2`, `["node-skorp", "node-desktop-c2ak"]` | Celery marked `failed` at `06:52:06` (`No module named 'peft'`); `node-skorp` kept executing and posted Epoch 1 at `06:52:59` (`current_epoch=1` persisted on `failed` row). | Bug 1 + Bug 2 + Bug 3 |
| `d4a6e2be-dd7e-438b-a764-ba64faf30a7b` | `3` epochs, `num_gpus=2` | `node-desktop-c2ak` failed in `~2.2s` at `06:52:54` (`No module named 'peft'`); `node-skorp` ran all 3 epochs until `06:54:33` (`status="failed"`, `current_epoch=3`). | Bug 1 + Bug 2 + Bug 3 |
| `ac7106df-ce37-4ca7-aa89-0c660eedba99` | `3` epochs, `num_gpus=2` | Failed at `06:53:42` at dispatch (`Worker missing required training package (No module named 'peft'). Install with: pip install transformers peft safetensors accelerate`); `node-skorp` continued epochs 1–3 (`06:55:06`, `06:55:38`, `06:56:03`), mutating `loss_history` & `current_epoch=3`. | Bug 1 + Bug 2 + Bug 3 |
| `c10cf31a-b378-4092-ad23-ea227d0dfe5b` | `3` epochs, `1` GPU (`node-skorp`) | User clicked Cancel at `06:55:16` (`status="cancelled"`), yet `node-skorp` kept training through `06:57:30` and wrote `current_epoch=3`. | Bug 3 (`job_cancel` missing) |

### 1.3 Critical Un-deployed Local Regression Trap (`Auto-Swarm` Infinite Queue)

In the current local workspace (not yet deployed):
- `network-nebula/src/pages/training-studio.tsx` (L171, L294–303) still computes:
  ```tsx
  const onlineNodes = clusterNodes.filter((n) => n.status === "online" && n.is_available !== false);
  // Auto-Swarm sets targetGpus = onlineNodes.length
  ```
- When `node-skorp` (training-capable) and `node-desktop-c2ak` (`batch_inference` only) are both online, the UI submits `num_gpus = 2`.
- Meanwhile, `app/distributed_training_engine.py` (L123–129) in the local workspace now returns `[]` if `len(worker_ids) < num_gpus`:
  ```python
  if len(worker_ids) < num_gpus:
      if os.getenv("ALLOW_SERVER_CPU_TRAINING_FALLBACK", "false").lower() in ("1", "true", "yes"):
          ...
      return []
  ```
- Therefore, deploying the local code as-is with both machines online would request `num_gpus=2`, find only `1` training node, resolve `worker_ids = []`, and leave jobs **stuck in `queued` forever**.

---

## 2. Workstream A — Honest Worker Capability & Dependency Gating

**Goal:** Every connected machine must accurately advertise whether it can actually run PyTorch/PEFT training right now, both from hardware capability and Python package readiness, even when running standalone via `/connect.ps1` or `/connect.sh`.

### Changes

1. **Intersect Capabilities with Dependency Probe (`worker/nebula_worker.py` & `nebula_worker.py`):**
   - Run `dep_status = probe_compute_dependencies()` **before** constructing `reg_payload` inside `cmd_join()` (`worker/nebula_worker.py` around L1600–1670) instead of only printing it at L1761.
   - Add a standalone `_classify_standalone_task_types(hw, dep_status)` helper used whenever `inspect_universal_hardware` is unavailable (so `/nebula_worker.py` downloaded on a bare machine never defaults `CPU Fallback Compute Node` to `gpu_memory_gb=8.0` or `"training"` without CUDA/MPS/ROCm + deps):
     - Require real GPU accelerator (`cuda` or `amd_rocm` >= 6 GB VRAM, or `apple_mps` >= 12 GB unified memory) **and** `dep_status["ready"] == True` (`torch`, `transformers`, `peft`, `safetensors`, `accelerate`) before including `"training"` or `"distributed_training"` in `supported_task_types`.
     - If `dep_status["ready"]` is `False`, strip `"training"` and `"distributed_training"` from `reg_payload["supported_task_types"]` (leaving `"batch_inference"` / `"inference"` / `"monitoring"` as appropriate) and add `"training_ready": False`, `"missing_training_packages": dep_status["missing"]`.
   - Fix `_run_tunnel()` (`worker/nebula_worker.py` L1824–1828) so the WebSocket `capabilities` frame only advertises `"training"` when `"training"` is in the worker's verified `supported_task_types` and `probe_compute_dependencies()["ready"]` is `True`.
   - Include `training_ready` and `supported_task_types` updates on periodic heartbeats if local environment changes, and print an unmistakable console status notice on startup:
     - `[ROLE: INFERENCE / MONITOR ONLY — missing peft/transformers or >=6GB CUDA GPU; excluded from training jobs]` vs `[ROLE: TRAINING + INFERENCE READY]`.

2. **Schema & Telemetry Exposure (`app/models.py`, `app/main.py`, `app/cluster_worker_router.py`):**
   - Add `training_ready` (Boolean, nullable/default derived safely) and `missing_training_packages` (`Text`, default `"[]"`) to `Worker` (`app/models.py`) + idempotent `ALTER TABLE workers ADD COLUMN IF NOT EXISTS ...` in `app/main.py` + `WorkerRegisterPayload` / `serialize_worker_node()` (`app/cluster_worker_router.py` L785–835) + `/register` fallback (`L1305`: default to `hw.get("supported_task_types", "batch_inference")` rather than blindly assuming `"inference,training"`).
   - *(Byte parity rule: copy `worker/nebula_worker.py` identically to root `nebula_worker.py` after every edit.)*

3. **Installer Script Upgrade (`app/cluster_worker_router.py` `/connect.ps1` L1002–1057 & `/connect.sh` L1060–1108):**
   - Before launching `nebula_worker.py join`, run a fast Python dependency check (`importlib.util.find_spec` for `torch`, `transformers`, `peft`, `safetensors`, `accelerate`, `websockets`, `requests`).
   - Support an opt-in install flag (`-InstallTrainingDeps` / `--install-training-deps`, or interactive prompt when an NVIDIA GPU / Apple Silicon is detected without packages) while keeping light-footprint monitoring/inference nodes fast to join without forcing multi-GB PyTorch downloads onto thin Intel Iris Xe machines.
   - Always print a clear banner indicating whether the machine is joining as a **Full Training Node** or **Monitor / Inference-Only Node**.

---

## 3. Workstream B — Smart Heterogeneous Fleet Scheduling & UI Filtering

**Goal:** Connecting extra monitoring, CPU, or Intel iGPU machines to the same account/fleet must **never** break, stall, or hijack training jobs targeting capable GPUs.

### Changes

1. **Strict Eligibility Filtering in Backend Router & Scheduler:**
   - **`get_eligible_training_workers()` (`app/cluster_worker_router.py` L643–660):**
     - Currently only filters `Worker.is_available == True` and `Worker.status.in_(["online", "busy"])`.
     - Add mandatory filters when `requested_worker_ids` is not overridden (or validate explicitly requested workers too and return a clear `400`/`422` diagnostic message instead of dispatching to a broken node):
       1. Exclude synthetic test nodes via `is_real_hardware_node(w)`.
       2. Require `"training"` or `"distributed_training"` in parsed `w.supported_task_types`.
       3. Require `getattr(w, "training_ready", True) is not False`.
       4. Require active WebSocket tunnel (`is_worker_tunnel_v2_online_anywhere(w.id) or is_worker_tunnel_online_anywhere(w.id)`) when dispatch requires tunnel execution (`not allow_fallback`).
   - **`ClusterScheduler.select_optimal_workers()` (`app/scheduler.py` L75–125 & L226–346):**
     - Call `reap_stale_workers_and_tasks(db)` before querying workers (so crashed/stale DB rows cannot look `"online"`).
     - Filter out non-real nodes cleanly when selecting production fleet workers, disqualify nodes where `training_ready is False` (`disqualification_reason = "Worker missing required PyTorch/PEFT training dependencies"`), and for tunnel-backed training verify live tunnel connectivity or rank active-tunnel nodes above stale rows.

2. **Eliminate the Infinite-Queue `Auto-Swarm` Trap (`app/distributed_training_engine.py`, `app/enterprise_training_router.py`):**
   - In `DistributedTrainingEngine.resolve_worker_fleet()` (`app/distributed_training_engine.py` L80–140):
     - Add `strict_worker_count: bool = False`.
     - When `num_gpus >= 2` is requested (e.g., via Auto-Swarm) and **1** or more eligible training workers exist (fewer than `num_gpus`), soft-scale down to the available eligible training workers (`len(eligible)`) when `strict_worker_count=False` (logging `[DIST_ENGINE] Requested 2 GPUs, 1 training-eligible GPU(s) online; scaling fleet to ['node-skorp']`), instead of returning `[]` or falling back to unsupported nodes!
     - Only return `[]` / wait in queue when **0** training-eligible workers exist (unless `ALLOW_SERVER_CPU_TRAINING_FALLBACK=true`), or when `strict_worker_count=True` was explicitly requested by an enterprise caller.
   - In `submit_training_job()` (`app/enterprise_training_router.py` L294–321):
     - If `len(resolved_workers) == 1`, automatically downgrade `hyperparams["distributed_mode"] = False` and set `num_gpus = 1` on the created/effective dispatch config so single eligible GPU jobs run the direct path cleanly without artificial distributed overhead.

3. **Frontend Training-Node Awareness (`network-nebula/src/pages/training-studio.tsx`):**
   - Split fleet counts in the UI (around L171 and L294–303):
     - `onlineNodes`: all connected online nodes (`monitor + inference + training`).
     - `trainingReadyNodes`: subset of `onlineNodes` where `(n.supported_task_types || "").split(",").includes("training" || "distributed_training")` **and** `n.training_ready !== false`.
   - Drive `Auto-Swarm` `targetGpus` from `Math.max(1, trainingReadyNodes.length)`, **never** from `onlineNodes.length`.
   - Update the UI node badge & selector so non-training machines (e.g., `DESKTOP-C2AK165 · Intel Iris Xe · 1 GB`) display a clear `"Inference / Monitor Only"` badge and are disabled/annotated in manual GPU picker rather than inflating `Auto-Swarm` GPU count.

---

## 4. Workstream C — Live `job_cancel` Propagation, Shard Failover & Terminal-State Guard

**Goal:** Cancelling a job or hitting a fatal shard error immediately halts work on all participating GPU workers and prevents post-mortem DB corruption.

### Changes

1. **Dispatch `job_cancel` Over WebSocket Tunnel (`app/enterprise_training_router.py`, `app/cluster_worker_router.py`, `app/worker.py`):**
   - Create a shared helper `dispatch_job_cancel(job_id: str, worker_ids: List[str], reason: str = "cancelled")` pushing `{"type": "job_cancel", "job_id": job_id, "worker_id": wid, "reason": reason}` onto Redis list `nebula:tunnel:dispatch`.
   - Call it from:
     - `cancel_training_job()` (`app/enterprise_training_router.py` L564–598) using the job's assigned `worker_ids` from `hyperparams` and any `Worker.current_task_id` matches.
     - Single-GPU and distributed wait loops (`app/worker.py` L1005–1025 & `app/distributed_training_engine.py` L394–418) whenever `check_cancelled_fn()` returns `True`, on disconnect timeout, or when another shard errors fatally.
   - Update `WorkerTunnelManager.run_redis_dispatch_bridge()` (`app/cluster_worker_router.py` L399–412) so failed delivery of `"type": "job_cancel"` (e.g., worker already disconnected) does **not** push an error frame into `nebula:training_result:{job_id}`.

2. **Cooperative Cancellation Inside Worker Tunnel & Training Loop (`worker/nebula_worker.py`):**
   - Maintain a thread-safe map `_active_job_cancels: Dict[str, threading.Event]` alongside `active_task`.
   - In `_receive_loop()` (`worker/nebula_worker.py` L1994–2010), handle `ftype == "job_cancel"`: set `_active_job_cancels[job_id].set()`, clear `active_task["id"]` if matching, and skip pushing spurious epoch updates.
   - Check `cancel_event.is_set()` **inside the inner batch loop** (`for input_ids, labels in train_batches:` at L1422+) as well as at the top of `for epoch in range(...)` (L1420), aborting mid-epoch cleanly without uploading bogus checkpoints, sending `"status": "cancelled"` back on the tunnel, and freeing CUDA cache (`torch.cuda.empty_cache()`).

3. **Shard Failover & Clean Abort in Distributed Training (`app/distributed_training_engine.py` L367–425):**
   - Add `shard_index` and `shard_count` to distributed `dispatch_payload` (L369–381) plus `total_workers`.
   - When a worker returns `status == "error"` or disconnects during `train_distributed_job()`:
     - Immediately dispatch `job_cancel` to all remaining `online_tunnel_workers` so healthy GPUs like `node-skorp` stop immediately instead of burning 3 epochs.
     - Before raising, attempt one clean **shard failover** if another healthy `training_ready` standby worker exists via `cluster_scheduler.trigger_task_failover()` (excluding the failed worker ID) — re-dispatching the failed shard or restarting from the last saved epoch checkpoint if supported; otherwise fail fast with an explicit per-worker error message (naming the exact failing `worker_id`).

4. **Terminal-State Immutability Guard in WebSocket Telemetry (`app/cluster_worker_router.py` L1874–1920 & `app/worker.py` L879–925):**
   - Inside the `training_epoch` WebSocket frame handler (`app/cluster_worker_router.py` L1874–1920) **and** Celery's `on_epoch` callback (`app/worker.py` L914–920):
     - Check `if ep_job.status in ("failed", "cancelled", "completed"):` — **do not** mutate `current_epoch`, `loss_history`, `checkpoints`, or `final_adapter_url`. Instead log/ignore the stale frame and optionally reply with a `job_cancel` frame if `status in ("failed", "cancelled")` so any stray worker stops right away.

---

## 5. Workstream D — Bundle Un-deployed Phase 2–4 Glue Fixes Before Rollout

Because the local workspace contains un-deployed Private BYO Training changes, close these three remaining seams before deploying to `158.178.251.80`:

1. **`submit_training_job()` (`app/enterprise_training_router.py` L116–141, L276–348):**
   - Pass `model_id=payload.base_model`, `train_type=payload.train_type`, `metadata_json=json.dumps(hyperparams)` into `cluster_scheduler.select_optimal_workers()` instead of hardcoded `required_vram_gb=2.0` so `vram_estimator` gates oversized models (`7B+`) accurately.
   - Persist and forward `sealed_secrets_b64` and `storage_retention` into `hyperparams` on both single and distributed job creation routes.
2. **Dispatch Payloads (`app/worker.py` L983–995 & `app/distributed_training_engine.py` L369–381):**
   - Forward `train_type` (`"lora"` / `"qlora"`), `sealed_secrets`, and `storage_retention` in both single-GPU and distributed `dispatch_payload` objects so QLoRA quantization and zero-storage / client-ram modes behave identically in multi-GPU and 1-GPU runs.
3. **Client Stream / BYOS Upload Integration (`network-nebula/src/pages/training-studio.tsx` L347–381):**
   - Replace the static `"tunnel_stream://client-ram"` placeholder with real `/ws/client/stream/{job_id}` dataset streaming (when `"client-ram"` is selected) and real `byos-s3.ts` presigned PUT upload (when `"byos-s3"` is selected), aligned with the worker's `ClientStreamDataSource` / sealed envelope expectations.

---

## 6. Verification & Safe Rollout Plan

### 6.1 Automated Tests (`pytest` & Frontend Build)

Create `tests/test_multi_node_heterogeneous_fleet.py` testing all four root causes end-to-end (with mocked Redis/WS frames and in-memory SQLite DB, zero mocked skips on assertions):
1. **Heterogeneous Fleet Exclusion & Auto-Swarm Down-Scaling:** Seed 1 CUDA RTX node (`training_ready=True`, `supported_task_types="inference,training,distributed_training"`) + 1 Intel Iris Xe node (`gpu_memory_gb=1.0`, `supported_task_types="batch_inference"`, `training_ready=False`). Submit a job with `num_gpus=2` (simulating Auto-Swarm). Verify it never assigns `node-desktop-c2ak`, never hangs in `queued` with `worker_ids=[]`, and resolves cleanly onto the CUDA node.
2. **Missing Dependency Capability Gating (`worker/nebula_worker.py`):** Mock `probe_compute_dependencies()` returning `{"ready": False, "missing": ["peft"]}`. Verify `cmd_join` registration & `_run_tunnel` WS `capabilities` omit `"training"` and set `training_ready=False`. Verify standalone `discover_hardware()` fallback does not misreport `gpu_memory_gb=8.0` + `"training"` when PyTorch/CUDA is absent.
3. **Cancel Propagation & Terminal-State Guard:**
   - Call `POST /api/v1/enterprise/training/jobs/{id}/cancel`; assert `job_cancel` frames are queued to `nebula:tunnel:dispatch` for bound workers.
   - Simulate late `training_epoch` WS frames arriving after `status="failed"` and after `status="cancelled"`; assert `current_epoch`, `loss_history`, and `checkpoints` remain completely unchanged.
   - Exercise `worker/nebula_worker.py` cancel `threading.Event` mid-epoch loop to confirm immediate abort.
4. **Distributed Shard Failure Sibling Abort:** Simulate worker B returning an error result on Redis while worker A is still running; verify `job_cancel` is dispatched to worker A instead of letting worker A run unobserved.
5. **Byte Parity & Frontend Build Check:**
   - Assert exact hash/byte equality between `worker/nebula_worker.py` and `nebula_worker.py`.
   - Run `pytest` across both existing training/worker tests and `tests/test_multi_node_heterogeneous_fleet.py`.
   - Run `npm run build` in `network-nebula/`.

### 6.2 Safe Oracle Deployment Runbook (`158.178.251.80`)

1. Reclaim disk space on the 45 GB Oracle root volume (`~15 GB` free currently) before rebuilding:
   ```bash
   docker builder prune -af && docker image prune -f
   ```
2. Push verified changes to `oracle-server`, pull on `158.178.251.80`, rebuild and restart API, Celery worker, and frontend containers.
3. Re-connect **both** machines:
   - Machine 1 (`node-skorp`, RTX 4070) via updated `/connect.ps1` -> verify `Training Studio` badge shows `Training Ready`, `supported_task_types` includes `training`.
   - Machine 2 (`DESKTOP-C2AK165`, Intel Iris Xe) -> verify it connects smoothly for telemetry/inference, displays `"Inference / Monitor Only"` in UI, does **not** inflate Auto-Swarm GPU count, and leaves single-GPU + heterogeneous multi-machine jobs passing cleanly!
   - *(Optional bonus test)*: Connect a second CUDA GPU worker with `peft` installed and verify true 2-GPU distributed LoRA training + live Cancel button responsiveness.
