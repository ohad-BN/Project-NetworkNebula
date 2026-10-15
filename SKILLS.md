---
name: enterprise-b2b-ai-compute
description: Architectural standards, tech stack constraints, and engineering guidelines for the Project NetworkNebula Enterprise B2B Decentralized Model Training & Serving Platform.
version: 2.0.0
---

# Enterprise B2B AI Compute Platform: Developer Skill & Architecture Guide

This skill governs the architectural principles, tech stack standards, and implementation protocols for developing Project NetworkNebula's **Enterprise B2B Decentralized AI Compute Network**.

---

## 1. Core Purpose & Mission

NetworkNebula is a high-performance decentralized cloud infrastructure engineered exclusively for enterprise AI engineering teams and foundation model startups. The platform delivers two core commercial services:

1. **Enterprise AI Model Training**:
   - Parameter-efficient fine-tuning (LoRA, QLoRA, DreamBooth) and multi-GPU distributed training across decentralized host nodes.
   - S3-backed dataset ingestion (`nebula-datasets`) and automated step checkpointing (`nebula-checkpoints`).
   - High-throughput gradient synchronization via all-reduce aggregation and gRPC worker mesh.

2. **Enterprise AI Model Serving & Inference**:
   - Dedicated high-throughput model endpoints.
   - **OpenAI-Compatible REST Gateway** (`/v1/chat/completions`, `/v1/models`) supporting streaming and token accounting.
   - Enterprise API token provisioning, rate limits (RPM/TPM), and quota management.

---

## 2. Tech Stack Constraints

All development must strictly adhere to the following technological boundaries:

| Layer | Approved Technology | Purpose / Configuration |
| :--- | :--- | :--- |
| **Backend Framework** | Python 3.12, `FastAPI` (async) | High-concurrency REST orchestrator & OpenAI gateway |
| **ORM & Database** | `SQLAlchemy` 2.x, `PostgreSQL` 15 | Relational persistence for organizations, jobs, tokens, ledgers |
| **Task Queue & Broker** | `Celery`, `Redis` 7 | Asynchronous workload distribution (Windows: `-P solo`) |
| **Object Storage** | `MinIO` S3 | Buckets: `nebula-datasets`, `nebula-checkpoints`, `nebula-models` |
| **Worker Compute** | `PyTorch` 2.x, CUDA, `PEFT`, `HuggingFace` | Local & remote GPU execution with memory-efficient attention |
| **Cluster Comms** | `gRPC` / HTTP/2 streaming | Worker-to-worker tensor exchange and barrier synchronization |
| **Frontend Framework** | `React` 19, `Vite`, `Bun`, `TailwindCSS` | Enterprise Cloud Console (Zustand state management, Radix UI) |
| **Automated Testing** | `test_suite.py` | **The Single Authoritative Source of Testing Truth** |

---

## 3. Strict Architectural Rules

1. **The Single Test File Mandate**:
   - Never create ad-hoc test scripts, separate test folders, or temporary batch files.
50:    - All unit, integration, and end-to-end tests MUST reside in [`test_suite.py`](test_suite.py).
51:    - Before completing any phase or milestone, `python test_suite.py` must run and achieve a 100% green pass.
52: 
53: 2. **Enterprise Security & Multi-Tenancy**:
54:    - Every request to `/api/v1/*` and `/v1/*` must be authenticated via scoped Bearer API tokens or API key headers (`X-API-Key`, `X-API-Secret`).
55:    - All customer datasets and model weights in MinIO must be isolated by organization ID.
56:    - Worker nodes are treated as zero-trust compute units: workloads run isolated without raw database write privileges.
57: 
58: 3. **Storage Hygiene & Hierarchy**:
59:    - S3 Storage must adhere to this exact directory layout:
60:      - `nebula-datasets/{org_id}/{dataset_id}/data.jsonl`
61:      - `nebula-checkpoints/{job_id}/epoch_{N}/adapter_model.safetensors`
62:      - `nebula-models/{model_id}/weights/`
63: 
64: 4. **Fast Testing Mode Support**:
65:    - Compute workers and training tasks must support `FAST_POC_MODE=true`. In test mode, training simulates gradient descent steps with valid mathematical decay in ~1s, enabling rapid test suite execution without downloading 15GB+ model weights.
66: 
67: ---
68: 
69: ## 4. Communication & Handover Protocol
70: 
71: - Always report status by referencing the active milestone in [`TASKS.md`](TASKS.md).
72: - Keep all explanations concise, clear, and professional.