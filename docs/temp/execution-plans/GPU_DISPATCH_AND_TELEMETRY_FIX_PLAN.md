# Zero-GPU-Load Training Stall & Telemetry Bug — Root-Cause Analysis & Fix Plan

> **Target Branch:** `oracle-server`  
> **Live Environment Audited:** `158.178.251.80` (deployed commit `bc426cd` / backend `ecaebfa`)  
> **Triggering Incident:** Job `46d125cb-e3f3-4854-9c72-4be622221758` (`SmolLM2-135M-Instruct-QLORA-46d125`, worker `node-skorp`)  
> **Status:** Root-Cause Verified — Awaiting Approval Before Implementation

---

## Executive Summary

When launching `HuggingFaceTB/SmolLM2-135M-Instruct` (`4-bit QLoRA`, `Zero-Setup Stream (RAM)`, `custom_model_test_dataset.jsonl`), the Web UI displayed **`Training-Ready GPU VRAM: 0.0 GB`** and **`Running (0 / 3 epochs, 0 saved)`** while your local RTX 4070 GPU monitor (Armoury Crate) remained at **`0% | 51 °C | 210 MHz`**.

Your Launch modal settings were **valid** — your job **did** reach `node-skorp` over the WebSocket tunnel at `08:25:19 UTC` (`10:25:19` local). However, live server logs, Postgres state, Nginx logs, and the local HuggingFace cache on `SkorP` prove **five interacting bugs** combined to stall the run silently and falsify UI telemetry:

1. **Silent 10–15 Minute Weight Download + Zero Phase Telemetry + Fabricated `72%–85%` GPU Load:**  
   Unlike `Qwen/Qwen2.5-0.5B-Instruct` (already cached locally since Oct 15), `HuggingFaceTB/SmolLM2-135M-Instruct` had to pull its `269 MB` `model.safetensors` from `us.aws.cdn.hf.co`. Measured throughput on this machine is `~292 KB/s` (`hf-xet 1.8.0`) / `~445 KB/s` (`requests`), leaving `blobs\...incomplete` at `83,164 bytes` (`10:25:36`) while Xet buffered 61 MB blocks in memory. During those minutes before any CUDA kernels ran, the backend **fabricated `gpu_utilization_pct` (`85.0` → `72.0`/`75.0`)**, while reporting zero download phase/byte progress to the UI.
2. **UI Subtracts `"busy"` GPUs Into `0.0 GB` (`Training-Ready GPU VRAM`):**  
   `training-studio.tsx` (`onlineNodes`) and `worker-capabilities.ts` (`isWorkerTrainingCapable`) reject any node whose status is `"busy"`. As soon as `node-skorp` picked up the job, its VRAM disappeared from the Training Studio summary card (`0.0 GB`), and the Launch modal warned `"No workers online"`.
3. **Critical Double-Execution Race Between `nebula-celery` and `nebula-api`:**  
   `POST /api/v1/training/jobs` did not acquire the Redis dispatch dedup lock (`nebula:train_dispatch:{job_id}`), and `execute_training_job` spent ~7.8s importing PyTorch/Transformers before setting `status='running'`. Meanwhile, a worker heartbeat fired `dispatch_queued_training_jobs`, hit a 0.25s `control.inspect().ping()` timeout against busy `-P solo` Celery, and spawned a **second concurrent copy** in `nebula-api`. Both committed `status='running'` 37ms apart, **both drained `pop_buffered_client_stream_records()`** (causing the second copy to lose `tunnel_stream://` data and silently fall back to `DEFAULT_TRAINING_RECORDS`), and **both pushed duplicate `job_dispatch` payloads** to `node-skorp`.
4. **Cancel Blocked Behind Download Lock + Terminal Heartbeat Overwrite + Stale Running Worker:**  
   - Postgres shows `node-skorp` never re-called `/workers/register` after `ecaebfa` deployed (`07:47:32 UTC`): `tunnel_pubkey_x25519` is empty and `node-skorp` reconnected an older script process that ignored `job_cancel`, keeping `current_task_id='train-46d125cb'` alive for 38s after Cancel (`08:26:59`–`08:27:38`).
   - Even in current `worker/nebula_worker.py`, `ensure_model()` / `from_pretrained()` does not check `cancel_event` and holds `self._lock`, so cancelling during a slow download cannot abort cleanly.
   - Server heartbeat handlers blindly restore `status='busy'` and fake `gpu_utilization_pct=72/75` even after the DB job is already `'cancelled'`/`'failed'`/`'completed'`.
5. **UI `getModelParamsB()` Ignores `M`-Suffix Models:**  
   `SmolLM2-135M-Instruct` failed the UI `[bB]`-only regex and fell back to **`~7B Params` / `6.4 GB VRAM`** instead of **`0.135B` (~`1.9–2.4 GB`)**.

---

## 1. Forensic Timeline Evidence (`2026-11-11 08:25–08:27 UTC` / `10:25–10:27 +02:00`)

| Time (UTC) | Source | Exact Observed Event |
| :--- | :--- | :--- |
| `07:47:32` | `nebula-api` / `nebula-celery` | Deployed containers started (`ecaebfa` runtime). `node-skorp` did **not** re-download or `/register` — existing process reconnected WS at `07:48:20` & `08:17:14`, leaving `tunnel_pubkey_x25519=''`. |
| `08:25:10.147` | `nebula-api` | Browser streamed `10` records via `/ws/client/stream/46d125cb...`; `POST /api/v1/training/jobs` inserted `status='queued'` and queued `execute_training_job` in Celery (`08:25:10.615`). |
| `08:25:11.802` | `nebula-celery` | `[WORKER] Initiating enterprise training job: 46d125cb...`, then spent **~7.5s** before DB status update. |
| `08:25:13.715` | `nebula-api` | Worker WS heartbeat triggered `dispatch_queued_training_jobs`, saw DB `status='queued'`, missed `celery.control.inspect(timeout=0.25).ping()`, and launched a **duplicate thread** inside `nebula-api` (`08:25:14.011`). |
| `08:25:19.455` / `.492` | `nebula-api` + `nebula-celery` | Both set `status='running'` 37ms apart; `nebula-celery` set `workers.gpu_utilization_pct=85.0`; both drained RAM stream and pushed duplicate `job_dispatch` payloads (`08:25:19.622` / `.629`). |
| `08:25:21`–`08:25:31` | Local HF cache | `node-skorp` received `job_dispatch`, imported libs, and downloaded `config.json`, `tokenizer_config.json`, `vocab.json`, `merges.txt`, `tokenizer.json`. |
| `08:25:36` | Local HF cache | `model.safetensors` (`269,060,552` bytes) created `blobs\5af571...incomplete` (`83,164` bytes), while Xet (`~292 KB/s`) buffered blocks with **0% CUDA load** on `node-skorp`. |
| `08:25:21`–`08:26:59` | `nebula-api` SQL | HTTP heartbeats forced `gpu_utilization_pct=72.0` and WS heartbeats forced `gpu_utilization_pct=75.0` despite real GPU at `0%`. UI card showed `Training-Ready GPU VRAM: 0.0 GB`. |
| `08:26:59.719` | `nebula-api` / `nebula-celery` | User clicked **Cancel**. API set `training_jobs.status='cancelled'`, Celery exited (`109.84s`). Both pushed `job_cancel`. |
| `08:27:03`–`08:27:36` | `nebula-api` SQL | Stale worker kept sending `current_task_id='train-46d125cb'`, overwriting DB back to `status='busy'` and `gpu_utilization_pct=72/75` until user terminated worker at `08:27:38`. |

---

## 2. Detailed Fix Plan (5 Targeted Workstreams)

### Workstream A — Stop Fabricating GPU Utilization & Stream Real Worker Phases (`worker`, `backend`, `UI`)

**Goal:** Ensure `0%` GPU during downloads/prep is shown accurately with a live phase & download meter instead of fake `72%–85%` load over a static `Running (0 / 3)` row.

1. **`app/worker.py`** (`L871`, `L1116` / `set_workers_state`):
   - Remove hardcoded `85.0` utilization at dispatch (`set_workers_state("busy", f"train-{job_id[:8]}", 0.0)` or preserve last real `nvidia-smi` reading).
   - Clear Redis phase key `nebula:training_phase:{job_id}` upon terminal completion/failure/cancellation.
2. **`app/cluster_worker_router.py`** (`worker_node_heartbeat` `L1778–1782`, WS `heartbeat` `L2037–2043`, WS `training_epoch` `L2169–2172`, new WS `training_status` handler):
   - **Remove fake utilization floors** `max(reported_util, 72.0)` (`L1780`) and `max(..., 75.0)` (`L2043`); record exact `reported_util` from the worker (`nvidia-smi` / PyTorch). Also do not force `50.0` in `nebula_worker.py:2088` if real `hw_snap` telemetry exists.
   - Add WS message handler for `msg_type == "training_status"` carrying `{job_id, phase, detail, progress_pct, downloaded_mb, total_mb, vram_used_gb, gpu_utilization_pct}` and store it ephemerally in Redis (`nebula:training_phase:{job_id}`, `ex=600`).
3. **`app/enterprise_training_router.py`** (`format_job_response`, `L272–315`):
   - Attach `training_phase` (parsed from `nebula:training_phase:{job.id}` while `status in ("queued", "running")`, best-effort) to job API responses (`GET /api/v1/training/jobs` and `GET /jobs/{id}`).
4. **`worker/nebula_worker.py`** (`ensure_model`, `run_lora_training`, `_handle_dispatch`):
   - Emit `training_status` events at each stage:
     - `initializing`: `"Preparing worker runtime & unsealing secrets"`
     - `downloading_model`: Resolve repo file sizes via `HfApi().repo_info(..., files_metadata=True)` (best-effort) and run a lightweight daemon watcher thread during `from_pretrained()` / `snapshot_download()` that measures downloaded bytes (cached + `.incomplete` blobs + HF Xet staging size deltas) every 2s to report `"Downloading HuggingFace weights (X / Y MB)"` and percentage.
     - `loading_weights`: `"Loading model & QLoRA/LoRA adapters onto CUDA"`
     - `training`: `"Running CUDA training (Epoch N / M)"`
     - `uploading_checkpoint`: `"Uploading encrypted adapter checkpoint"`
   - Also keep `_heartbeat_sender` reporting genuine `nvidia-smi` utilization.
5. **`network-nebula/src/pages/training-studio.tsx`** (`TrainingJobItem`, table `Status` cell, Telemetry modal):
   - Display `job.training_phase?.detail` under the `Running` badge and in the Telemetry modal header so slow weight downloads are immediately transparent (`"Downloading weights (42.0 / 256.6 MB) — GPU idle until load finishes"`).

---

### Workstream B — Fix `Training-Ready GPU VRAM: 0.0 GB` & Busy-Node Accounting (`frontend`)

**Goal:** Active (`busy`) training GPUs remain counted in fleet training capacity rather than collapsing to `0.0 GB`.

1. **`network-nebula/src/lib/worker-capabilities.ts`** (`L13–28`):
   - Update `isWorkerTrainingCapable(node, options?: { allowBusy?: boolean })`: treat `status` in `("online", "busy")` as capable when `is_available !== false && training_ready !== false` and `supported_task_types` includes `"training"` or `"distributed_training"` (matching backend `is_worker_training_capable()` in `app/cluster_worker_router.py:694`), with an explicit `allowBusy` flag (default `true` for fleet capability checks, `false` only where strictly idle slots are checked).
2. **`network-nebula/src/pages/training-studio.tsx`** (`L246–296`, `L1160–1166`):
   - Separate **`trainingFleetNodes`** (`status in ["online", "busy"]`, `is_available !== false`, `isWorkerTrainingCapable`) from **`idleTrainingNodes`** (`status === "online"`).
   - Compute `totalTrainingReadyVram` across `trainingFleetNodes` so `Training-Ready GPU VRAM` accurately stays at `6.4 GB` (instead of dropping to `0.0 GB`) when `node-skorp` is busy, with an informative subtitle e.g. `1 active (busy)` vs `1 ready (idle)`.
   - Compute `vramFitStatus` / Launch modal fit checks against `trainingFleetNodes` (mentioning when the matching GPU is currently busy on another run so jobs queue behind it cleanly rather than falsely claiming `"No workers online"`).

---

### Workstream C — Eliminate Double-Execution Race & Protect `tunnel_stream://` RAM Datasets (`backend`, `worker`)

**Goal:** Guarantee each `job_id` executes in **exactly one** runner, and never loses/replaces volatile `tunnel_stream://` data.

1. **`app/worker.py`** (`execute_training_job`, `L718–845`, `L1006–1008`):
   - **Atomic DB state claim BEFORE heavy imports or stream drain:** Perform a lightweight atomic SQL update right after validation:
     ```sql
     UPDATE training_jobs SET status = 'running'
     WHERE id = :job_id AND status = 'queued'
     ```
     Check `result.rowcount == 1`. Only the single winner imports `training_engine` / drains Redis / dispatches to the worker; any losing runner immediately returns `{"status": "already_claimed", "job_id": job_id}`.
   - Add an early `is_cancelled()` check before pushing to `nebula:tunnel:dispatch`.
2. **`app/enterprise_training_router.py`** (`dispatch_training_job_resilient` `L25–40`, `create_training_job` `L464–465`, `create_distributed_training_job` `L605`):
   - Acquire Redis dispatch dedup lock `nebula:train_dispatch:{job_id}` (`nx=True, ex=60`) inside `dispatch_training_job_resilient()` **before** enqueueing to Celery or spawning a thread — closing the gap between `POST /training/jobs` and `dispatch_queued_training_jobs()`.
   - Fix the `-P solo` inspect false-negative: instead of falling back to an `api`-container thread whenever `celery_app.control.inspect(timeout=0.25).ping()` returns `None` (which *always* happens when the single-process solo Celery worker is already running another job!), push via `execute_training_job.delay(job_id)` directly whenever `CELERY_BROKER_URL` is configured (checking broker connectivity / `celery` heartbeat key rather than `inspect.ping()`, and reserving thread fallback only when Celery broker publish itself raises or `CELERY_ALWAYS_THREAD=true`).
3. **`app/training_engine.py`** (`prepare_gpu_training_records`, `L460–495`):
   - If `dataset_s3_url` starts with `tunnel_stream://` and `pop_buffered_client_stream_records(job_id)` returns empty, **do NOT silently fall back to `DEFAULT_TRAINING_RECORDS`**! Raise an explicit `RuntimeError` explaining the RAM stream buffer expired or was missing so users never silently train on default Alpaca text.
4. **`worker/nebula_worker.py`** (`_handle_dispatch` `L1979–2137`):
   - Track active/dispatched `job_id`s in `active_job_cancels` atomically before awaiting `asyncio.to_thread(_exec_train)` so any duplicate `job_dispatch` frame for the same `job_id` is ignored cleanly rather than queued behind `self._lock`.

---

### Workstream D — Fix Uninterruptible Cancel, Stale Heartbeats, & Worker Protocol Sync (`worker`, `backend`)

**Goal:** Cancelling a job during model download aborts fast without wedging `self._lock`, heartbeats never resurrect cancelled tasks, and old worker processes announce capabilities cleanly.

1. **`app/cluster_worker_router.py`** (`worker_node_heartbeat` `L1755–1824`, WS `heartbeat` `L2022–2066`, WS `capabilities` `L1992–2020`):
   - In both HTTP `worker_node_heartbeat` and WS `heartbeat`, validate any incoming `task_id` starting with `"train-"`: query `TrainingJob` by prefix; if no matching job exists or `job.status in ("cancelled", "failed", "completed")`, **reject the stale `current_task_id`**, set `worker.current_task_id = None` and `worker.status = "online"` (if available), reset `gpu_utilization_pct` if no inference task is active, and over WS immediately emit a `job_cancel` reminder frame!
   - Accept optional `tunnel_pubkey_x25519` and `worker_protocol_version` in WS `capabilities` frames (`L1992`) and persist `Worker.tunnel_pubkey_x25519` + `supports_sealed_env` even across WS reconnects (so workers don't need `/workers/register` to recover their encryption key).
2. **`worker/nebula_worker.py`** (`ensure_model`, `run_lora_training`, `cmd_join` WS):
   - Pre-download uncached models via `huggingface_hub.snapshot_download` **outside `self._lock`** (skipping or checking `cancel_event` before starting AND right after download finishes before acquiring `self._lock` or allocating CUDA tensors!). Even better: iterate model repo files via `HfApi().list_repo_tree` + per-file `hf_hub_download(..., local_files_only=False)` so a user click on `Cancel` aborts **between files** cleanly and never enters `from_pretrained(..., local_files_only=True)` after cancel!
   - Also allow forcing `HF_HUB_DISABLE_XET=1` cleanly if `NEBULA_HF_DISABLE_XET=1` is set or retry via direct HTTP if Xet stalls without byte progress for >45s.
   - Include `"tunnel_pubkey_x25519": _gpu_runtime.tunnel_pubkey_x25519` and `"worker_version": "2026-11-11.2"` inside the WS `capabilities` payload.
   - Remind users / bootstrapper (`/connect.ps1`, `/connect.sh`) clearly when running a new worker so stale pre-update terminals are replaced cleanly.

---

### Workstream E — Fix `Est. Model Size` & Download Expectation UX (`frontend`)

**Goal:** Show accurate parameter counts & VRAM formulas for `M`-parameter custom models (e.g., `SmolLM2-135M`) and clarify first-run weight downloads.

1. **`network-nebula/src/pages/training-studio.tsx`** (`getModelParamsB`, `L190–200`, UI notes around `L710–722`):
   - Match `[bB]` and `[mM]` (`/[-\/_]?([0-9]+(?:\.[0-9]+)?)\s*m(?:\b|[-_])/i` → `/ 1000`, plus `smollm2-135m` / `360m` presets), mirroring `app/vram_estimator.py:119–132`, so `HuggingFaceTB/SmolLM2-135M-Instruct` shows `~0.14B Params` and `~1.9 GB VRAM` instead of `~7B Params` / `6.4 GB`.
   - Under the Custom HuggingFace Model ID input, add a concise helper note: uncached models are downloaded directly by the worker on first run before GPU kernels start (progress shown live in the Runs table).

---

## 3. Verification Plan

1. **Automated Unit & Integration Tests (Backend + Worker + Frontend):**
   - **Double-dispatch prevention (`pytest`):** Test `execute_training_job` concurrent invocation on the same `job_id` verifies only one runner claims `status='running'`, `tunnel_stream://` records are never wiped by a loser, and only one `job_dispatch` hits Redis.
   - **Tunnel-stream fail-closed test (`pytest`):** Verify `prepare_gpu_training_records("tunnel_stream://missing", job_id="...")` raises `RuntimeError` rather than silently substituting `DEFAULT_TRAINING_RECORDS`.
   - **Honest utilization & terminal heartbeat guard (`pytest`):** Verify dispatch + HTTP/WS heartbeats keep real worker `gpu_utilization_pct` (`0.0` when downloading) and reject stale `train-...` task IDs for already-`cancelled` jobs, returning the worker to `status="online"`.
   - **Worker phase & mid-download cancellation (`pytest`):** Mock HF file list + `hf_hub_download` in `nebula_worker.run_lora_training`, verify `training_status` download progress callbacks fire and `cancel_event.set()` aborts cleanly between files without touching CUDA or hanging `self._lock`.
   - **Frontend TypeScript build & unit checks (`npm run build` + vitest/component assertion if present):** Verify `getModelParamsB("HuggingFaceTB/SmolLM2-135M-Instruct") === 0.135`, `isWorkerTrainingCapable({ status: "busy", ... }) === true`, and `Training-Ready GPU VRAM` keeps `6.4 GB` while a job is running.
2. **Live End-to-End Verification on `158.178.251.80` (Post-Deploy):**
   - Restart local worker via updated `connect.ps1` so `node-skorp` picks up updated `nebula_worker.py` (verifying `tunnel_pubkey_x25519` populated and `capabilities` v2 logged).
   - Run `HuggingFaceTB/SmolLM2-135M-Instruct` (`4-bit QLoRA`, `custom_model_test_dataset.jsonl` via RAM Stream):
     - Confirm single Celery dispatch only (no duplicate `nebula-api` execution).
     - Confirm UI shows `Downloading weights (... MB)` + real `0%` GPU util while downloading, `Training-Ready GPU VRAM: 6.4 GB` throughout, then real GPU utilization + epoch progress + loss curves + `.safetensors` decryption once loaded.
     - Test cancelling a separate queued/downloading run and confirm immediate return of worker to `online` without ghost `busy` flapping.
