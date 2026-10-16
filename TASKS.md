# 🌌 Project NetworkNebula — Enterprise B2B Status & Tasks Checklist
> **Project Phase:** Alpha Milestone 3 — Phase 3.1 Active (Multi-Node Distributed Training & Ring All-Reduce Protocol)  
> **Target:** Enterprise B2B Decentralized AI Compute (Model Training & Model Serving)  
> **Single Source of Testing Truth:** [`test_suite.py`](test_suite.py) (**122/122 Passed — 100% Green**)  
> **Master Architecture Guide:** [Enterprise Architecture Guide](ARCHITECTURE.md)

---

## 📊 Enterprise Architecture at a Glance

| Layer | Component | Status | Port / URL | Role in Enterprise Architecture |
| :--- | :--- | :---: | :--- | :--- |
| **Frontend UI** | React 19 Enterprise Cloud Console | ✅ | `http://localhost:5173` | Training Studio, Model Serving Hub, API Tokens, Cluster Fleet |
| **Backend API** | FastAPI Orchestrator | ✅ | `http://localhost:8000` | Orchestration, Auth, Training APIs, and OpenAI Gateway |
| **OpenAI Gateway**| Compatible Serving API | ✅ | `/v1/chat/completions` | Drop-in inference endpoint for enterprise Python/cURL SDKs |
| **Training Engine**| Distributed Cluster & PEFT | ✅ | `app/distributed_training_engine.py` | Multi-GPU LoRA/QLoRA fine-tuning, Ring All-Reduce, S3 checkpoints |
| **Compute Fleet** | Local RTX 4070 / Remote GPUs | ✅ | [`nebula_worker.py`](nebula_worker.py) | Standalone CLI & WebSocket tunnel (`/ws/worker/{id}`) with 10%–100% GPU limit |
| **Object Storage**| MinIO S3 Buckets | ✅ | `http://localhost:9000` | `nebula-datasets`, `nebula-checkpoints`, `nebula-models` |
| **Database** | PostgreSQL | ✅ | `localhost:5433` | Schemas for Organizations, Jobs, Endpoints, and Transactions |
| **Master Test Suite**| Single Test Runner | ✅ | [`test_suite.py`](test_suite.py) | **122/122 tests passed (0 failed, 0 skipped)** |

---

## 📋 Phased Enterprise Implementation Checklist

### ✅ Phase 1: Core Specifications, Schemas & S3 Storage (COMPLETED)
- [x] Created the 4 core specification markdown files:
  - [`SKILLS.md`](SKILLS.md) (Enterprise ML ops rules, coding guidelines)
  - [`ROADMAP.md`](ROADMAP.md) (Phased milestone delivery roadmap)
  - [`ARCHITECTURE.md`](ARCHITECTURE.md) (System diagrams, multi-tenancy schemas, gRPC protocols)
  - [`EXEC_PLANS.md`](EXEC_PLANS.md) (Step-by-step instructions for inside-IDE agent)
- [x] Defined Enterprise database models in [`app/models.py`](app/models.py) (`TrainingJob`, `InferenceEndpoint`, `ApiToken`) and created tables in PostgreSQL
- [x] Initialized enterprise S3 buckets in [`app/storage.py`](app/storage.py) (`nebula-datasets`, `nebula-checkpoints`, `nebula-models`) with byte transfer verification
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 1 Enterprise assertions (**52/52 passed — 100%**)

### ✅ Phase 2: Enterprise Model Training Engine (COMPLETED)
- [x] Built Enterprise Training REST router ([`app/enterprise_training_router.py`](app/enterprise_training_router.py)) mounted at `/api/v1/training`:
  - `POST /api/v1/training/datasets/upload-url` (Presigned S3 PUT URLs for customer datasets)
  - `POST /api/v1/training/jobs` (Distributed/PEFT training submission)
  - `GET /api/v1/training/jobs` (Job fleet listing with status filters)
  - `GET /api/v1/training/jobs/{id}` (Real-time loss descent and epoch telemetry)
  - `GET /api/v1/training/jobs/{id}/checkpoints` (Checkpoints and direct `.safetensors` download URLs)
  - `POST /api/v1/training/jobs/{id}/cancel` (Idempotent job lifecycle cancellation)
- [x] Wired training task coordinator with Celery worker `execute_training_job` in [`app/worker.py`](app/worker.py)
- [x] Implemented checkpoint serialization (`.safetensors` + `adapter_config.json`) and auto-upload to MinIO S3 (`nebula-checkpoints`)
- [x] Implemented mathematical loss descent telemetry and epoch progress tracking
- [x] Updated [`test_suite.py`](test_suite.py) with Phase 2 Training assertions & verified 100% green (**60/60 tests passed**)

### ✅ Phase 3: Enterprise Model Serving & OpenAI API Gateway (COMPLETED)
- [x] Built OpenAI-compatible gateway ([`app/openai_inference_router.py`](app/openai_inference_router.py)) mounted at `/v1`:
  - `POST /v1/chat/completions` (full standard schema, streaming SSE & usage token telemetry)
  - `GET /v1/models` (lists foundation models, dedicated endpoints, and fine-tuned checkpoints)
- [x] Built Dedicated Endpoint deployment & scaling manager (`/api/v1/inference/endpoints`)
- [x] Built Scoped Bearer API Token manager ([`app/enterprise_token_router.py`](app/enterprise_token_router.py)) (`/api/v1/tokens`) with SHA-256 storage and instant revocation
- [x] Wired Celery worker `serve_inference_request` in [`app/worker.py`](app/worker.py) with latency tracking and token consumption
- [x] Updated [`test_suite.py`](test_suite.py) with Phase 3 Serving assertions & verified 100% green (**68/68 tests passed**)

### ✅ Phase 4: React 19 Enterprise Cloud Console (COMPLETED)
- [x] Purge legacy consumer art generator views and gamer marketing copy
- [x] Build **Training Studio UI** (`/training`: dataset drag-and-drop, hyperparameter tuning, loss graphs, checkpoint downloads)
- [x] Build **Model Serving Hub UI** (`/inference`: deploy endpoint, interactive playground, cURL/Python snippet generator)
- [x] Build **API Token Manager UI** (`/api-tokens`: scoped tokens, rate limits, revocation)
- [x] Build **GPU Fleet Telemetry UI** (`/cluster`: decentralized host nodes, VRAM usage)
- [x] Verify production build (`bun run build`) with zero TypeScript errors
- [x] Updated [`test_suite.py`](test_suite.py) with Phase 4 UI & route assertions & verified 100% green (**74/74 tests passed**)

### ✅ Phase 5: End-to-End Enterprise Validation & Production Handover (COMPLETED)
- [x] Run full enterprise lifecycle simulation:
  1. Company registers enterprise account & provisions scoped API token
  2. Uploads dataset and launches distributed LoRA fine-tuning run
  3. Real-time telemetry logs loss descent and uploads checkpoint `.safetensors`
  4. Deploys fine-tuned model to an active inference endpoint
  5. Executes inference via `POST /v1/chat/completions` using Python SDK & cURL
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 5 End-to-End assertions (**83/83 green — 100%**)
- [x] Production zero-leak verification and git repository synchronization

---

## 🚀 Alpha Milestone 1: Real AI Model Execution (Replacing Simulation)
> **Goal:** Transition from simulated templates to **genuine PyTorch neural network execution** on the local RTX 4070 GPU for both serving and LoRA fine-tuning.

### ✅ Phase 1.1: CUDA Hardware Acceleration & ML Dependencies (COMPLETED)
- [x] Upgraded PyTorch to CUDA 12.4 build for Python 3.12 (`torch 2.6.0+cu124`)
- [x] Installed `peft` (v0.21.2) and verified `accelerate` (v1.13.0) & `transformers` (v5.5.0)
- [x] Verified PyTorch detects NVIDIA GeForce RTX 4070 Laptop GPU (`torch.cuda.is_available() == True`, 8.0 GB VRAM)
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 1.1 hardware tensor & PEFT assertions (**86/86 passed — 100%**)

### ✅ Phase 1.2: Foundation Model Integration & Local Weight Cache (COMPLETED)
- [x] Selected high-efficiency un-gated open foundation model (`Qwen/Qwen2.5-0.5B-Instruct`, Apache 2.0, 942 MB FP16 VRAM)
- [x] Built `app/model_cache.py` singleton manager (`ModelCacheManager`) handling local weight caching, FP16 GPU binding, VRAM usage tracking, and safe garbage collection
- [x] Supported model catalog with verified specs (`Qwen2.5-0.5B`, `Qwen2.5-1.5B`, `SmolLM2-1.7B`, `Llama-3.2-1B`, `Llama-3-8B`)
- [x] Implemented `/api/v1/models/catalog` and `/api/v1/models/cache/status` in `app/openai_inference_router.py`
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 1.2 assertions (M1.4 catalog specs, M1.5 GPU telemetry, M1.6 local weight cache) (**89/89 passed — 100%**)

### ✅ Phase 1.3: Real Neural Inference Engine & Live Token Streaming (COMPLETED)
- [x] Built `app/inference_engine.py` singleton (`NeuralInferenceEngine`) wrapping `Qwen/Qwen2.5-0.5B-Instruct` on physical GPU (`cuda:0`)
- [x] Implemented real token-by-token streaming via `transformers.TextIteratorStreamer` with multi-threaded generation
- [x] Wired `serve_inference_request` in `app/worker.py` and Uvicorn orchestrator to execute real neural forward passes
- [x] Connected live SSE stream to `/v1/chat/completions` with exact tokenizer token usage counters (`prompt_tokens`, `completion_tokens`, `total_tokens`)
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 1.3 assertions (M1.7 real GPU chat, M1.8 live token streaming, M1.9 tokenizer alignment) (**92/92 passed — 100%**)

### ✅ Phase 1.4: Real PyTorch PEFT / LoRA Training Engine (COMPLETED)
- [x] Built `app/training_engine.py` singleton (`PeftTrainingEngine`) orchestrating real PyTorch forward/backward backpropagation on RTX 4070 (`cuda:0`)
- [x] Ingested instruction datasets from MinIO S3 (`nebula-datasets`) and tokenized conversation pairs
- [x] Attached trainable LoRA matrices via `peft.LoraConfig(r=16, lora_alpha=32)` (1,081,344 trainable parameters, 0.22% parameter footprint)
- [x] Executed PyTorch AdamW gradient descent optimization steps emitting verified loss decay metrics to `TrainingJob.loss_history`
- [x] Exported genuine `.safetensors` adapter checkpoints (96 LoRA weight matrices, 4.3 MB) and serialized directly to MinIO S3 (`nebula-checkpoints`)
- [x] Wired `execute_training_job` in `app/worker.py` to route through the real PEFT training engine
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 1.4 assertions (M1.10 backward pass & gradients, M1.11 loss decay, M1.12 authentic S3 safetensors) (**95/95 passed — 100%**)

### ✅ Phase 1.5: Dynamic S3 LoRA Adapter Hot-Swapping (COMPLETED)
- [x] Implemented `download_and_cache_adapter` in `app/inference_engine.py` downloading and hashing `.safetensors` & `adapter_config.json` from MinIO S3 into local cache (`data/adapters/{hash}/`)
- [x] Implemented in-memory dynamic PEFT adapter mounting (`_mount_adapter`) supporting hot-swapping multiple adapters or falling back to clean base model execution
- [x] Wired dedicated customer serving endpoints (`/api/v1/inference/endpoints`) with custom `adapter_url` to load fine-tuned LoRA weights in VRAM on demand for both streaming and non-streaming calls
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 1.5 assertions (M1.13 S3 adapter cache resolution, M1.14 in-memory dynamic PEFT mount, M1.15 fine-tuned endpoint chat completion) (**98/98 passed — 100%**)

### ✅ Phase 1.6: Master System Validation & Hardware VRAM Audit (COMPLETED)
- [x] Incorporated Phase 1.6 master validation tests into [`test_suite.py`](test_suite.py):
  - **M1.16**: Base Model Reversion & Adapter Disablement Verification (clean zero-bias generation)
  - **M1.17**: Multi-Adapter Hot-Swap & State Machine Transition (state integrity and rapid switching)
  - **M1.18**: OpenAI Gateway SSE Streaming Chunk Protocol Compliance (exact SSE format, chunk delta, and `data: [DONE]`)
  - **M1.19**: Live CUDA Hardware VRAM Stability & Allocation Audit (under 1.1 GB allocated, safely within RTX 4070 limits)
- [x] Verified full end-to-end execution of all 102 automated tests across Enterprise B2B, MinIO S3, PyTorch CUDA training, and real-time streaming inference (**102/102 passed — 100% Green, 0 failed, 0 skipped in 159.9s**)
- [x] **Milestone 1 (Real AI Model Execution) Signoff:** All 6 phases (1.1 - 1.6) fully realized and verified.

---

## 🚀 Alpha Milestone 2: Standalone Worker CLI Agent & Live Multi-Node Fleet Network

### ✅ Phase 2.1: Enhanced Worker Telemetry Schema & Fleet Registry API (COMPLETED)
- [x] Extended `Worker` model in [`app/models.py`](app/models.py) with `user_id`, `vram_used_gb`, `vram_allocation_pct` (`10%–100%`), `gpu_utilization_pct`, `cuda_version`, `role`, `hourly_rate_usd`, and `total_earnings_usd`
- [x] Built [`app/cluster_worker_router.py`](app/cluster_worker_router.py) with automatic PostgreSQL column migration (`ensure_worker_schema_columns`) and physical RTX 4070 hardware introspection (`probe_local_gpu_hardware`)
- [x] Implemented `GET /api/v1/cluster/telemetry`, `POST /api/v1/workers/register`, `PATCH /api/v1/workers/{id}/config` (with `torch.cuda.set_per_process_memory_fraction` enforcement), `POST /api/v1/workers/{id}/heartbeat`, and `GET /api/v1/workers/{id}/stats`
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 2.1 assertions (`M2.1` live cluster telemetry, `M2.2` worker registration with 75% contribution limit, `M2.3` dynamic 75% -> 50% slider & CUDA fraction enforcement) (**105/105 passed — 100%**)

### ✅ Phase 2.2: Standalone "Nebula Worker" CLI Agent (`nebula_worker.py`) (COMPLETED)
- [x] Created standalone [`nebula_worker.py`](nebula_worker.py) CLI script supporting `join`, `status`, and `set-limit` subcommands
- [x] Implemented automatic CUDA GPU discovery (model, total VRAM, allocated VRAM, CUDA version, CPU cores, RAM) and `--vram-pct` (`10–100%`) memory ceiling enforcement via `torch.cuda.set_per_process_memory_fraction()`
- [x] Added `--once` deterministic execution mode and `--json` output for automated testing & quick PowerShell verification alongside continuous daemon mode
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 2.2 assertions (`M2.4` hardware discovery & CUDA fraction, `M2.5` CLI `join --once`, `M2.6` CLI `set-limit` & `status` roundtrip) (**108/108 passed — 100%**)

### ✅ Phase 2.3: Real-Time WebSocket Worker Tunnel & NAT Traversal (COMPLETED)
- [x] Implemented `WS /ws/worker/{worker_id}` bidirectional tunnel in [`app/cluster_worker_router.py`](app/cluster_worker_router.py) with initial handshake frame, live telemetry heartbeats, and instant server-pushed `vram_allocation_pct` config updates without polling
- [x] Implemented `WS /ws/cluster` live broadcast stream for connected Cloud Console clients emitting snapshot frames and handling ping/pong
- [x] Connected [`nebula_worker.py`](nebula_worker.py) with `--tunnel` support via `run_websocket_tunnel()`
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 2.3 assertions (`M2.7` tunnel handshake & heartbeat, `M2.8` real-time server-push config update down open tunnel, `M2.9` cluster telemetry broadcast & ping/pong) (**111/111 passed — 100%**)

### ✅ Phase 2.4: Dynamic Task Routing, SLA Accounting & Automated Worker Earnings (COMPLETED)
- [x] Wired `execute_training_job`, `serve_inference_request`, `render_image`, and `train_model` in [`app/worker.py`](app/worker.py) to credit completed tasks (`Worker.total_tasks_completed += 1`) and USD compute earnings (`WORKER_SHARE = 0.70`, `Worker.total_earnings_usd += earnings`) to the active `Worker` node and owner `User` wallet (`TransactionType.EARNING`)
- [x] Upgraded [`get_payout.py`](get_payout.py) CLI agent with `--json` machine-readable output, sorted fleet node telemetry table, active `vram_allocation_pct` contribution percentages, task counters, and accrued per-node USD earnings
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 2.4 assertions (`M2.10` worker SLA task execution accounting, `M2.11` automated compute earnings credit & ledger audit, `M2.12` `get_payout.py` fleet telemetry CLI reporting) (**114/114 passed — 100%**)

### ✅ Phase 2.5: Live Frontend GPU Fleet (`/cluster`) & Contributor Control Panel (`/worker`) (COMPLETED)
- [x] Upgraded [`network-nebula/src/pages/cluster-status.tsx`](network-nebula/src/pages/cluster-status.tsx) to connect to live `/api/v1/cluster/telemetry` & `/ws/cluster` WebSocket broadcast stream, interactive **10%–100% GPU Contribution Sliders**, live summary cards, and a copyable PowerShell CLI join command widget
- [x] Upgraded [`network-nebula/src/pages/worker.tsx`](network-nebula/src/pages/worker.tsx) to provide real contributor node introspection (RTX 4070 VRAM, CUDA, heartbeat, tunnel status), dynamic VRAM contribution slider (`PATCH /api/v1/workers/{id}/config`), accrued earnings counter, and CLI commands
- [x] Verified clean frontend production bundle compilation (`bun run build` in 7.03s, 562 kB JS, 54 kB CSS) and expanded [`test_suite.py`](test_suite.py) with Phase 2.5 assertions (`M2.13`, `M2.14`, `M2.15`) (**117/117 passed — 100%**)

### ✅ Phase 2.6: Master Test Suite Expansion & Milestone 2 Signoff (COMPLETED)
- [x] Incorporated Phase 2.6 master validation tests into [`test_suite.py`](test_suite.py):
  - **`M2.16`**: Multi-Node Dynamic Load Distribution & Fleet Lifecycle Audit (peer node dynamic join, multi-node capacity aggregation, clean de-registration)
  - **`M2.17`**: End-to-End VRAM Governance & 10%–100% Boundary Clamp Enforcement (5%->10%, 120%->100%, 50%, restored to 80% via `nebula_worker.apply_vram_limit()`)
  - **`M2.18`**: Alpha Milestone 2 Master System Integrity Signoff (FastAPI health, foundation models catalog, cluster telemetry, worker CLI agent, and worker payout CLI all verified)
- [x] Executed full automated test suite achieving 100% green pass across all tests (**120/120 passed — 100% Green, 0 failed, 0 skipped in 224.7s**)
- [x] **Milestone 2 (Distributed Multi-Node Worker Network) Signoff:** All 6 phases (2.1 - 2.6) fully realized, verified, and operational.

---

## 🚀 Alpha Milestone 3: Multi-Node Distributed Training, Intelligent Scheduling & Model Benchmarking

### ✅ Phase 3.1: Multi-Node Distributed Training Orchestrator & Ring All-Reduce Protocol (COMPLETED)
- [x] Built [`app/distributed_training_engine.py`](app/distributed_training_engine.py) coordinating data-parallel training across 2+ registered worker nodes with deterministic dataset batch sharding and `WorkerGroup` loss synchronization
- [x] Added `POST /api/v1/training/distributed/jobs` and `GET /api/v1/training/distributed/jobs/{job_id}/shards` in [`app/enterprise_training_router.py`](app/enterprise_training_router.py) supporting `num_gpus >= 2`, batch sharding, and proportional multi-worker SLA earnings credit
- [x] Implemented `GradientAggregator` float32 tensor bucket serialization, mean tensor reduction across worker nodes, and unified `.safetensors` adapter checkpoint export to MinIO S3 (`nebula-checkpoints`)
- [x] Expanded [`test_suite.py`](test_suite.py) with Phase 3.1 assertions (`M3.1` multi-node job dispatch, dataset sharding & multi-worker SLA credit, `M3.2` ring all-reduce gradient tensor bucket aggregation & unified S3 safetensors export) (**122/122 passed — 100%**)

### 📋 Phase 3.2: Intelligent Capacity-Aware Job Scheduler & Dynamic Task Dispatcher
- [ ] Build `app/scheduler.py` (`ClusterScheduler` singleton) scoring candidate worker nodes by VRAM headroom, latency, contribution limit, and SLA tier
- [ ] Implement automatic worker heartbeat timeout detection and transparent mid-task failover re-routing to healthy standby nodes
- [ ] Expose `GET /api/v1/cluster/scheduler/status` and `POST /api/v1/cluster/scheduler/simulate-dispatch`
- [ ] Expand [`test_suite.py`](test_suite.py) with Phase 3.2 assertions (`M3.3` capacity-aware node matching, `M3.4` fault-tolerant failover re-routing)

### 📋 Phase 3.3: Autonomous CLI Worker Task Execution (`nebula_worker.py --work`)
- [ ] Extend [`nebula_worker.py`](nebula_worker.py) with `work` subcommand (`python nebula_worker.py work --worker-id <id>`) to pull/receive tasks over WebSocket tunnel
- [ ] Execute local neural forward passes or PEFT training batches within enforced VRAM fraction ceilings and stream step progress back to orchestrator
- [ ] Add `--auto-claim` and `--max-tasks` options for headless autonomous node operation
- [ ] Expand [`test_suite.py`](test_suite.py) with Phase 3.3 assertions (`M3.5` CLI autonomous task claiming, `M3.6` tunnel task dispatch & progress telemetry)

### 📋 Phase 3.4: Live Model Evaluation Benchmarking Suite & Side-by-Side Playground
- [ ] Build `app/evaluation_engine.py` benchmarking fine-tuned adapters against foundation base models (instruction accuracy, perplexity, generation speed, latency)
- [ ] Add `/api/v1/models/benchmark` and `/api/v1/models/compare` endpoints in `app/openai_inference_router.py`
- [ ] Upgrade **Model Serving Hub UI** ([`network-nebula/src/pages/inference-hub.tsx`](network-nebula/src/pages/inference-hub.tsx)) with an interactive **Side-by-Side Comparison Playground** (dual streaming generation panes with token/sec and latency diffs)
- [ ] Expand [`test_suite.py`](test_suite.py) with Phase 3.4 assertions (`M3.7` model evaluation benchmark scoring, `M3.8` dual-model side-by-side completion)

### 📋 Phase 3.5: Host Node Automated Payouts, Wallet Withdrawals & Billing Receipts
- [ ] Enhance `app/wallet_router.py` with `POST /wallet/withdraw` (validates $10.00 min threshold) and `POST /api/v1/wallet/payouts/{id}/settle` (automated ledger settlement and balance deduction)
- [ ] Add `GET /api/v1/billing/receipts/{job_id}` generating structured JSON and printable/downloadable enterprise compute invoices
- [ ] Upgrade **Host Wallet Page** ([`network-nebula/src/pages/wallet.tsx`](network-nebula/src/pages/wallet.tsx)) with an interactive **Withdraw Funds Dialog**, live payout tracker, and printable invoice viewer
- [ ] Expand [`test_suite.py`](test_suite.py) with Phase 3.5 assertions (`M3.9` withdrawal lifecycle & ledger deduction, `M3.10` enterprise compute billing receipt generation)

### 📋 Phase 3.6: Master Test Suite Expansion & Milestone 3 Signoff
- [ ] Expand [`test_suite.py`](test_suite.py) with Phase 3.6 master validation tests (`M3.11` high-availability load balancing audit, `M3.12` Alpha Milestone 3 Master System Signoff)
- [ ] Verify clean production frontend compilation (`bun run build`) with zero TypeScript errors
- [ ] Run `python test_suite.py` to achieve 100% green pass across all **132+** automated tests and sign off Alpha Milestone 3

---

## ⚡ Instant Command Cheatsheet

```powershell
# Run the single authoritative test suite:
python test_suite.py

# Join GPU node / Control GPU Contribution % via Standalone CLI Agent:
python nebula_worker.py join --vram-pct 80 --once
python nebula_worker.py set-limit --vram-pct 60
python nebula_worker.py status

# Start Docker infrastructure (Postgres 5433, Redis 6379, MinIO 9000):
docker-compose up -d db redis minio

# Start Backend API Orchestrator (port 8000):
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Start GPU Compute Worker:
celery -A app.worker.celery_app worker --loglevel=info -P solo

# Start Enterprise Frontend UI (port 5173):
cd network-nebula && bun run dev
```
