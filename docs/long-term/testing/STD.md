# Software Test Description (STD): Project NetworkNebula
## Concrete Test Cases & Verification Procedures

> **Course:** Intro2SE (Software Engineering) · School of Computer Science, Ariel University  
> **Course Lecturer:** Prof. Boaz Ben-Moshe  
> **Document Code:** STD-NN-2026-v1.0  
> **Parent Test Plan:** [Software Test Plan (STP)](file:///c:/Users/ohadb/Desktop/ALL/APPS/Project%20NetworkNebula/docs/STP.md)  
> **Traceability Reference:** Verifies [SRS REQ-01 through REQ-19](file:///c:/Users/ohadb/Desktop/ALL/APPS/Project%20NetworkNebula/docs/SRS.md)  
> **Target Audience:** Test Engineers, Auditors, Code Implementers

---

## 1. Test Suite Summary Table

| Test Case ID | Test Case Title | Target Requirement & UC | Test Level | Automated in `test_suite.py` | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-001** | User Registration & JWT Authentication | REQ-01, UC-01 | Integration | Phase 1 (Lines 83-122) | **PASS** |
| **TC-002** | Scoped API Token Provisioning & Revocation | REQ-02, REQ-03 | Integration | Phase 1 Enterprise (Lines 291-373) | **PASS** |
| **TC-003** | MinIO S3 Multi-Tenant Bucket Accessibility | REQ-05, REQ-09 | Integration | Phase 1 Enterprise (Lines 340-370) | **PASS** |
| **TC-004** | Dataset Presigned S3 Upload & Validation | REQ-05, UC-01 | Integration | Phase 2 Enterprise (Lines 380-420) | **PASS** |
| **TC-005** | LoRA Training Job Submission & Enqueueing | REQ-06, REQ-07 | Integration | Phase 2 Enterprise (Lines 421-470) | **PASS** |
| **TC-006** | Epoch Loss Telemetry & Safetensors Checkpoints | REQ-08, REQ-09, REQ-10 | E2E | Phase 2 Enterprise (Lines 471-510) | **PASS** |
| **TC-007** | OpenAI Non-Streaming Chat Completion | REQ-11, UC-02 | E2E | Phase 3 Enterprise (Lines 515-580) | **PASS** |
| **TC-008** | OpenAI Streaming Token Inference (SSE) | REQ-12, UC-02 | E2E | Phase 3 Enterprise (Lines 581-630) | **PASS** |
| **TC-009** | Decentralized Worker Node Registration | REQ-16, UC-03 | Integration | Phase 3 Infrastructure (Lines 164-210) | **PASS** |
| **TC-010** | Worker Heartbeat & 90s Timeout Eviction | REQ-17, UC-03 | Integration | Phase 3 Infrastructure (Lines 211-260) | **PASS** |
| **TC-011** | Double-Entry Token Metering & Revenue Share | REQ-14, REQ-18 | E2E | Phase 3 Enterprise (Lines 631-679) | **PASS** |
| **TC-012** | Worker Staking & Malicious Slashing Penalty | REQ-19 | Unit / Integ | Phase 3 Infrastructure (Lines 261-290) | **PASS** |
| **TC-013** | React 19 Frontend Web Console Build | INT-01 | Build / E2E | Phase 4 Enterprise (Lines 680-740) | **PASS** |
| **TC-014** | Full End-to-End B2B Customer Journey Simulation | REQ-01..19, D-1..D-7 | System E2E | Phase 5 Enterprise (Lines 741-999) | **PASS** |
| **TC-015** | Zero-Privilege OS Presence Sensing Latency | REQ-20, UC-08 | Unit / System | `tests/test_stealth_regulation.py` | **PLANNED** |
| **TC-016** | Micro-Duty GPU Yielding & 144Hz Frame Preservation | REQ-21, REQ-23, NFR-11 | System E2E | `tests/test_stealth_regulation.py` | **PLANNED** |
| **TC-017** | Software Acoustic-Thermal Governor (<62°C) | REQ-22, NFR-12 | Integration | `tests/test_stealth_regulation.py` | **PLANNED** |
| **TC-018** | PoDS Paced Micro-Slice Delivery & Extended Grace | REQ-24, UC-08 | System E2E | `tests/test_stealth_regulation.py` | **PLANNED** |

---

## 2. Detailed Test Case Specifications

### TC-001: User Registration & JWT Authentication
- **Test ID:** `TC-001`
- **Title:** Register new account and verify JWT + API key pair generation
- **Verifies:** REQ-01, UC-01
- **Preconditions:** Database container running, `users` table initialized.
- **Test Steps:**
  1. Send HTTP POST to `/api/v1/auth/register` with:
     ```json
     {
       "email": "qa_tester_01@nebula.ai",
       "password": "SecurePassword123!",
       "name": "QA Lead Tester"
     }
     ```
  2. Verify response status is HTTP 201 Created.
  3. Validate response contains non-empty `token`, `api_key`, and `api_secret`.
  4. Query database for user; verify `password_hash` is not plain text.
- **Expected Result:** Account registered successfully, valid JWT returned, password cryptographically hashed.
- **Result:** **PASS** (Automated in `test_suite.py`)

---

### TC-002: Scoped API Token Provisioning & Revocation
- **Test ID:** `TC-002`
- **Title:** Provision scoped enterprise API token and test instant revocation
- **Verifies:** REQ-02, REQ-03
- **Preconditions:** Authenticated user session from TC-001.
- **Test Steps:**
  1. POST `/api/v1/tokens` with `name: "ci-inference-token"`, `scopes: "inference"`, `rate_limit_rpm: 120`.
  2. Store returned raw token `sk-nebula-...`.
  3. Send test request to `/v1/chat/completions` using Bearer auth with the new token &rarr; Verify HTTP 200.
  4. Send DELETE to `/api/v1/tokens/{token_id}` &rarr; Verify HTTP 200.
  5. Repeat request to `/v1/chat/completions` using revoked token.
- **Expected Result:** Active token succeeds; revoked token is immediately rejected with HTTP 401 Unauthorized within 100 ms.
- **Result:** **PASS** (Automated in `test_suite.py`)

---

### TC-005: LoRA Training Job Submission & Enqueueing
- **Test ID:** `TC-005`
- **Title:** Submit LoRA training job with valid JSONL dataset and verify Celery queue state
- **Verifies:** REQ-06, REQ-07, UC-01
- **Preconditions:** MinIO bucket `nebula-datasets` contains `test_data.jsonl`, user balance $\ge \$10.00$.
- **Test Steps:**
  1. POST `/api/v1/training/jobs` with payload:
     ```json
     {
       "name": "support-lora-test",
       "base_model": "llama-3.2-1b",
       "dataset_s3_url": "s3://nebula-datasets/org-test/test_data.jsonl",
       "hyperparameters": {"epochs": 3, "learning_rate": 0.0002, "lora_rank": 8}
     }
     ```
  2. Verify response status code is HTTP 201 Created.
  3. Verify returned `status` field equals `"queued"`.
  4. Inspect Redis queue for task message containing `job_id`.
- **Expected Result:** TrainingJob is persisted in PostgreSQL, task enqueued into Redis with priority flag.
- **Result:** **PASS** (Automated in `test_suite.py`)

---

### TC-006: Epoch Loss Telemetry & Safetensors Checkpoints
- **Test ID:** `TC-006`
- **Title:** Execute training run, stream epoch loss, and download checkpoint safetensors
- **Verifies:** REQ-08, REQ-09, REQ-10, UC-01
- **Preconditions:** Celery worker running, TC-005 job enqueued.
- **Test Steps:**
  1. Worker executes training epochs 1, 2, and 3.
  2. Poll `GET /api/v1/training/jobs/{job_id}` after each epoch.
  3. Confirm `loss_history` array contains 3 floating point entries showing convergence.
  4. Wait for job `status` to transition to `"completed"`.
  5. Call `GET /api/v1/training/jobs/{job_id}/checkpoints`.
  6. Perform HTTP GET request against the presigned checkpoint URL.
- **Expected Result:** HTTP 200 returned; payload is a valid binary `.safetensors` file containing model weights.
- **Result:** **PASS** (Automated in `test_suite.py`)

---

### TC-007: OpenAI Non-Streaming Chat Completion
- **Test ID:** `TC-007`
- **Title:** Verify `/v1/chat/completions` compatibility with OpenAI JSON specification
- **Verifies:** REQ-11, UC-02
- **Preconditions:** Orchestrator running, warm worker registered with `qwen-2.5-0.5b`.
- **Test Steps:**
  1. POST `/v1/chat/completions` with payload:
     ```json
     {
       "model": "qwen-2.5-0.5b",
       "messages": [{"role": "user", "content": "Ping"}],
       "temperature": 0.1,
       "max_tokens": 10
     }
     ```
  2. Verify response status is HTTP 200 OK.
  3. Verify presence of fields: `id`, `object` (`"chat.completion"`), `created`, `model`, `choices`, and `usage`.
  4. Verify response headers include `X-Nebula-Trace-ID` and `X-Nebula-Latency-Ms`.
- **Expected Result:** Exact OpenAI-compliant JSON payload returned in under 1,500 ms.
- **Result:** **PASS** (Automated in `test_suite.py`)

---

### TC-008: OpenAI Streaming Token Inference (SSE)
- **Test ID:** `TC-008`
- **Title:** Verify real-time token streaming using Server-Sent Events (`stream: true`)
- **Verifies:** REQ-12, UC-02
- **Preconditions:** Valid API token, warm worker online.
- **Test Steps:**
  1. POST `/v1/chat/completions` with `"stream": true`.
  2. Verify response header `Content-Type: text/event-stream`.
  3. Read incoming chunks; confirm each chunk begins with `data: ` and contains valid JSON with delta text.
  4. Confirm final message is exactly `data: [DONE]`.
- **Expected Result:** Sequential token delivery over single HTTP connection terminating cleanly with `[DONE]`.
- **Result:** **PASS** (Automated in `test_suite.py`)

---

### TC-011: Double-Entry Token Metering & Revenue Share
- **Test ID:** `TC-011`
- **Title:** Verify accurate debit of client balance and 70% credit to serving host worker
- **Verifies:** REQ-14, REQ-18
- **Preconditions:** Client balance = \$10.00; Worker balance = \$0.00; Task fee = \$0.10.
- **Test Steps:**
  1. Execute inference task via client token assigned to worker node.
  2. Query `users` table for client balance &rarr; Verify balance is \$9.90.
  3. Query `workers` table for worker `total_earnings_usd` &rarr; Verify balance is \$0.07 (70% share).
  4. Query `transactions` table &rarr; Verify two corresponding immutable entries (`DEBIT` and `EARNING`).
- **Expected Result:** Ledger balances balance perfectly to zero rounding errors; worker receives exactly 70%.
- **Result:** **PASS** (Automated in `test_suite.py`)

---

### TC-012: Worker Staking & Malicious Slashing Penalty
- **Test ID:** `TC-012`
- **Title:** Enforce minimum stake and trigger 20% slash penalty on faulty output
- **Verifies:** REQ-19
- **Preconditions:** Worker staked \$50.00 in staking vault.
- **Test Steps:**
  1. Trigger verification check where worker returns corrupted gradient or hallucinated hash.
  2. Verification engine flags task as invalid.
  3. Call internal slash penalty function.
  4. Inspect `workers` record: `staked_amount_usd` should equal \$40.00 (\$50.00 - 20%).
  5. Inspect `slashed_amount_usd`: should equal \$10.00.
  6. Inspect `reputation_score`: should decrement from 100 to 80.
- **Expected Result:** Economic penalty deducted automatically and logged in `transactions` audit trail.
- **Result:** **PASS** (Automated in `test_suite.py`)

---

### TC-014: Full End-to-End Enterprise Customer Journey Simulation
- **Test ID:** `TC-014`
- **Title:** Execute complete autonomous B2B lifecycle (Token &rarr; Train &rarr; Checkpoint &rarr; Serve)
- **Verifies:** REQ-01 through REQ-19, SOW D-1 through D-7
- **Preconditions:** Full stack running (FastAPI, Redis, Postgres, MinIO).
- **Test Steps:**
  1. Register enterprise account `enterprise_corp@nebula.ai`.
  2. Generate scoped token `sk-nebula-corp-primary`.
  3. Presign and upload dataset `enterprise_knowledge.jsonl`.
  4. Submit training job `corp-model-v1`.
  5. Await training completion, validating loss telemetry.
  6. Retrieve `adapter_model.safetensors` download URL.
  7. Deploy inference endpoint mounting the trained adapter.
  8. Call `POST /v1/chat/completions` against deployed model.
  9. Confirm response quality, latency headers, and ledger settlement.
- **Expected Result:** Complete 9-step customer journey completes with 100% success without manual intervention.
- **Result:** **PASS** (Automated in `test_suite.py` Phase 5)

---

### TC-015: Zero-Privilege OS Presence Sensing Latency & Debounce Hysteresis
- **Test ID:** `TC-015`
- **Title:** Verify sub-microsecond OS-level input idle detection across platforms without root privileges
- **Verifies:** REQ-20, UC-08
- **Preconditions:** Worker agent running on Windows, macOS, or Linux.
- **Test Steps:**
  1. Call `StealthPresenceSensor.get_os_idle_seconds()`.
  2. Measure execution duration across 1,000 continuous samples.
  3. Simulate user keyboard/mouse event and verify detected idle duration resets to $<0.05\text{s}$.
  4. Verify debounce hysteresis: instant throttle to `stealth` upon input; requires 60s continuous idle before transitioning to `unleashed`.
- **Expected Result:** Sensing execution duration $\le 200\mu\text{s}$; state transition triggers in $<200\text{ms}$; zero keylogging hooks installed.
- **Result:** **PLANNED** (Target: `tests/test_stealth_regulation.py`)

---

### TC-016: Micro-Duty GPU Yielding & 144 Hz Frame Preservation
- **Test ID:** `TC-016`
- **Title:** Verify desktop window compositing maintains 60–144 Hz refresh deadlines during compute execution
- **Verifies:** REQ-21, REQ-23, NFR-11
- **Preconditions:** GPU compute workload executing tensor forward passes; monitor display active.
- **Test Steps:**
  1. Trigger human input event to place worker in `stealth_regulated` mode.
  2. Measure time between consecutive GPU compute dispatches ($T_{\text{yield}} \ge 15\text{ms}$).
  3. Verify Desktop Window Manager (`dwm.exe` / `WindowServer`) composition frame intervals.
  4. Check physical unreserved VRAM: ensure $\ge 4.5\text{ GB}$ remains free for desktop applications.
- **Expected Result:** DWM composition latency $\le 16.6\text{ms}$ (zero frame drops); desktop dragging and typing remain completely smooth.
- **Result:** **PLANNED** (Target: `tests/test_stealth_regulation.py`)

---

### TC-017: Software Acoustic-Thermal Governor & Fan Curve Ceiling
- **Test ID:** `TC-017`
- **Title:** Verify closed-loop thermal duty-cycle governor keeps GPU core $<62^\circ\text{C}$ (<32 dBA noise)
- **Verifies:** REQ-22, NFR-12
- **Preconditions:** Continuous background compute loop running for 10+ minutes.
- **Test Steps:**
  1. Sample GPU junction temperature via NVML / Metal metrics.
  2. Artificially simulate rising core temperature towards $65^\circ\text{C}$.
  3. Verify `SilentThermalGovernor` automatically increases yield sleep ($+10\text{ms}/^\circ\text{C}$).
  4. Monitor temperature equilibrium and physical fan acoustic levels.
- **Expected Result:** GPU junction temperature stabilizes between $58^\circ\text{C}$ and $62^\circ\text{C}$; cooling fans do not exceed whisper zone (<32 dBA).
- **Result:** **PLANNED** (Target: `tests/test_stealth_regulation.py`)

---

### TC-018: PoDS Paced Micro-Slice Delivery & Extended Grace Period
- **Test ID:** `TC-018`
- **Title:** Verify paced PoDS micro-slice submissions succeed with extended timeout window and zero slashing
- **Verifies:** REQ-24, UC-08
- **Preconditions:** Worker connected to orchestrator with `--always-silent` in `stealth_regulated` state.
- **Test Steps:**
  1. Orchestrator assigns a 10-slice task to the stealth worker.
  2. Worker processes slices with interleaved yield sleeps ($T_{\text{slice}} \approx 2.5\text{s}$ vs $0.8\text{s}$ in unleashed).
  3. Worker submits cryptographic SHA-256 slice proofs to `/tasks/{id}/slices/submit`.
  4. Verify orchestrator accepts paced slices without triggering worker timeout or stake slashing.
- **Expected Result:** All micro-slices cryptographically verified; pro-rata PoDS rewards minted successfully; zero reputation penalty.
- **Result:** **PLANNED** (Target: `tests/test_stealth_regulation.py`)
