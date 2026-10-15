# Project NetworkNebula — Inside-IDE Execution Plans

This document provides sequential execution instructions for the inside-IDE agent to implement the Enterprise B2B platform phase-by-phase.

---

## Execution Standards

1. Execute **one phase at a time**.
10: 2. Update [`test_suite.py`](test_suite.py) with automated assertions after completing each phase.
11: 3. Confirm `python test_suite.py` achieves a **100% green pass** before marking a phase complete in [`TASKS.md`](TASKS.md).
12: 
13: ---
14: 
15: ## 🏗️ Phase 1: Core Specifications, Schemas & S3 Storage
16: 
17: ### Objective
18: Establish the enterprise data layer, S3 bucket storage hierarchy, and architectural specifications.
19: 
20: ### Tasks
21: 1. **Author Specifications**:
22:    - `SKILLS.md`
23:    - `ROADMAP.md`
24:    - `ARCHITECTURE.md`
25:    - `EXEC_PLANS.md`
26: 2. **Database Models** ([`app/models.py`](app/models.py)):
27:    - Implement `TrainingJob` model (`id`, `user_id`, `name`, `base_model`, `train_type`, `dataset_s3_url`, `hyperparameters`, `loss_history`, `checkpoints`, `status`).
28:    - Implement `InferenceEndpoint` model (`id`, `user_id`, `name`, `model_id`, `adapter_url`, `status`, `avg_latency_ms`).
29:    - Implement `ApiToken` model (`id`, `user_id`, `token_hash`, `name`, `scopes`, `is_active`).
30:    - Call `Base.metadata.create_all(bind=engine)` to create tables in PostgreSQL.
31: 3. **S3 Storage Initialization** ([`app/storage.py`](app/storage.py)):
32:    - Ensure buckets exist: `nebula-datasets`, `nebula-checkpoints`, `nebula-models`.
33:    - Configure public-read / presigned access.
34: 4. **Verification**:
35:    - Add Phase 1 tests in `test_suite.py` asserting table creation and bucket accessibility.
36:    - Run `python test_suite.py` and verify all tests pass.
37: 
38: ---
39: 
40: ## ⚡ Phase 2: Enterprise Model Training Engine
41: 
42: ### Objective
43: Enable companies to submit fine-tuning jobs (LoRA, QLoRA) and download saved checkpoints.
44: 
45: ### Tasks
46: 1. **Training API Router** (`app/enterprise_training_router.py`):
47:    - `POST /api/v1/training/jobs`: Submit training run.
48:    - `GET /api/v1/training/jobs`: List training jobs.
49:    - `GET /api/v1/training/jobs/{id}`: Live telemetry, loss history, and epoch status.
50:    - `GET /api/v1/training/jobs/{id}/checkpoints`: Download links for saved checkpoints.
51:    - `POST /api/v1/training/datasets/upload-url`: Request presigned S3 dataset upload URL.
52: 2. **Worker Training Execution** ([`app/worker.py`](app/worker.py)):
53:    - Implement `@celery_app.task(name="execute_training_job")`.
54:    - Download dataset and simulate/train gradient steps with loss decay.
55:    - Upload `.safetensors` adapter checkpoints to `nebula-checkpoints`.
56: 3. **Verification**:
57:    - Add Phase 2 tests in `test_suite.py`: Submit training job, poll completion, verify loss history and S3 checkpoint download.
58:    - Run `python test_suite.py` and verify all tests pass.
59: 
60: ---
61: 
62: ## 🌐 Phase 3: Enterprise Model Serving & OpenAI API Gateway
63: 
64: ### Objective
65: Provide an OpenAI-compatible `/v1/chat/completions` API and model endpoint manager.
66: 
67: ### Tasks
68: 1. **OpenAI Gateway Router** (`app/openai_inference_router.py`):
69:    - `POST /v1/chat/completions`: Accept standard OpenAI payload format (`model`, `messages`, `temperature`, `max_tokens`).
70:    - `GET /v1/models`: Return list of available foundation models and fine-tuned adapters.
71:    - `POST /api/v1/inference/endpoints`: Deploy/scale a dedicated model endpoint.
72:    - `GET /api/v1/inference/endpoints`: List running endpoints.
73: 2. **Token Management Router** (`app/enterprise_auth_router.py`):
74:    - `POST /api/v1/tokens`: Generate scoped Bearer token.
75:    - `GET /api/v1/tokens`: List active tokens.
76:    - `DELETE /api/v1/tokens/{id}`: Revoke token.
77: 3. **Worker Serving Execution** ([`app/worker.py`](app/worker.py)):
   - Implement `@celery_app.task(name="serve_inference_request")`.
4. **Verification**:
   - Add Phase 3 tests in `test_suite.py`: Deploy endpoint, issue `/v1/chat/completions` request with Bearer token, assert valid OpenAI JSON response.
   - Run `python test_suite.py` and verify all tests pass.

---

## 🖥️ Phase 4: React 19 Enterprise Cloud Console UI

### Objective
Transform the frontend UI into a professional B2B cloud portal.

### Tasks
1. **Navigation & Routes**:
   - Update `App.tsx` and `routes/index.tsx` with `/training`, `/inference`, `/api-tokens`, `/cluster`.
2. **Training Studio** (`network-nebula/src/pages/training-studio.tsx`):
   - Job creation wizard, dataset uploader, loss charts.
3. **Model Serving Hub** (`network-nebula/src/pages/inference-hub.tsx`):
   - Deploy endpoint drawer, interactive playground, cURL/Python code generator.
4. **API Token Manager** (`network-nebula/src/pages/api-tokens.tsx`):
   - Token list, creation modal, copy keys.
5. **GPU Fleet Telemetry** (`network-nebula/src/pages/cluster-status.tsx`):
   - Active GPU nodes, VRAM utilization.
6. **Verification**:
   - Run `bun run build` and assert 0 errors.

---

## 🚀 Phase 5: End-to-End Enterprise Validation & Handover

### Objective
Execute full company lifecycle simulation and complete final project handover.

### Tasks
1. **Automated Lifecycle Test**:
   - Company registration &rarr; Bearer token provision &rarr; dataset upload &rarr; training job execution &rarr; checkpoint download &rarr; model deployment &rarr; `/v1/chat/completions` invocation.
2. **Run Master Test Suite**:
   - Execute `python test_suite.py` confirming 100% green pass across all phases.
3. **Handover**:
   - Update `TASKS.md` to 100% completion.
