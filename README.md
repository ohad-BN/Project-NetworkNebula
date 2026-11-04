# Project NetworkNebula
> **Enterprise B2B decentralized AI compute and model serving network providing drop-in OpenAI-compatible inference and distributed LoRA fine-tuning at 70% lower cloud cost.**

---

## ⚡ Quick Start: Get Running in 2 Minutes

NetworkNebula is fully containerized. You can bring up the entire multi-tenant orchestrator, database, cache, S3 storage, and web console with a single command:

### 1. Launch the Complete Server Stack
```bash
# Clone the repository
git clone https://github.com/org/project-networknebula.git
cd "Project NetworkNebula"

# Launch all services in the background (Postgres, Redis, MinIO S3, API Orchestrator, Celery, React 19 Web)
docker compose -f docker-compose.server.yml up -d --build
```

### 2. Access the Services
| Service | Local URL | Description |
| :--- | :--- | :--- |
| **Enterprise Cloud Console** | [http://localhost](http://localhost) (or `:5173`) | React 19 Management Dashboard & Playground |
| **FastAPI Orchestrator & Gateway**| [http://localhost:8000](http://localhost:8000) | REST API & OpenAI Drop-In Gateway |
| **Interactive API Documentation**| [http://localhost:8000/docs](http://localhost:8000/docs) | Live Swagger / OpenAPI Spec |
| **MinIO S3 Storage Console** | [http://localhost:9001](http://localhost:9001) | Object Storage Browser (`nebula` / `nebula123`) |

### 3. Connect a GPU Host Worker Node
Have an idle NVIDIA GPU (e.g., RTX 4070 / 4080 / 4090 / A100)? Join the compute fleet:
```bash
# Windows
.\join_mesh.bat --server http://localhost:8000 --key <your_worker_api_key>

# Linux / macOS
./join_mesh.sh --server http://localhost:8000 --key <your_worker_api_key>
```

### 4. Zero-Cost Public WAN Tunnel (Closed Alpha over Internet)
To test with real remote users outside your local Wi-Fi without paying for a cloud server or opening router ports:
```bash
# Windows
.\start_tunnel.bat

# Linux / macOS
./start_tunnel.sh
```
*Creates an encrypted, secure Cloudflare Zero-Trust HTTPS & WSS tunnel (`https://*.trycloudflare.com`) routing public traffic to your local orchestrator.*

---

## 💻 Usage Examples

### A. Calling the Drop-In OpenAI Gateway (Python SDK)
Any application using the official `openai` SDK can switch to NetworkNebula by changing just two lines:

```python
from openai import OpenAI

# Point to your NetworkNebula endpoint
client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="sk-nebula-demo-token"
)

# Call standard chat completions
response = client.chat.completions.create(
    model="qwen-2.5-0.5b",
    messages=[
        {"role": "system", "content": "You are a specialized enterprise AI assistant."},
        {"role": "user", "content": "Explain how decentralized GPU clusters reduce latency."}
    ],
    temperature=0.7,
    max_tokens=150
)

print(response.choices[0].message.content)
```

### B. Calling Chat Completions via cURL
```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-nebula-demo-token" \
  -d '{
    "model": "qwen-2.5-0.5b",
    "messages": [{"role": "user", "content": "Hello Nebula!"}],
    "temperature": 0.7
  }'
```

### C. Launching a LoRA Fine-Tuning Job
```bash
curl -X POST http://localhost:8000/api/v1/training/jobs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-nebula-demo-token" \
  -d '{
    "name": "customer-support-lora-v1",
    "base_model": "llama-3.2-1b",
    "dataset_s3_url": "s3://nebula-datasets/org-1/support_faq.jsonl",
    "train_type": "lora",
    "hyperparameters": {
      "epochs": 5,
      "learning_rate": 0.0002,
      "lora_rank": 16
    }
  }'
```

---

## ⚙️ Configuration & Environment

Environment variables are managed in `.env` (copy from `.env.example`):

```dotenv
# Orchestrator & App Config
APP_NAME=NetworkNebula
APP_ENV=production
SECRET_KEY=super-secret-random-32-byte-key
NODE_ID=nebula-gateway-us-east-1

# Relational Database (PostgreSQL 16)
DATABASE_URL=postgresql://nebula:nebula123@localhost:5432/nebula_db

# Message Broker & Cache (Redis 7)
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/0

# Object Storage (MinIO S3)
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=nebula
MINIO_SECRET_KEY=nebula123
MINIO_BUCKET=nebula-datasets

# Hardware VRAM Threshold
VRAM_ALLOCATION_PCT=80
```

---

## 🧪 How to Run the Tests

The platform includes an automated master test runner covering every tier:

```bash
# Run the unified master test suite
python test_suite.py

# Verify the React 19 Frontend Web Console build
cd network-nebula
bun run build
```

The test runner will validate all 5 architectural phases:
- **Phase 1:** Core Architecture, Schemas & MinIO S3 Buckets
- **Phase 2:** Enterprise LoRA Training & Checkpoint Serialization
- **Phase 3:** OpenAI Serving Gateway & Ledger Double-Entry Accounting
- **Phase 4:** React 19 Dark-Mode Cloud Console UI
- **Phase 5:** Autonomous End-to-End B2B Customer Journey Simulation

---

## 📁 Project Structure

```text
Project NetworkNebula/
├── app/                              # FastAPI Backend Orchestrator & Engines
│   ├── main.py                       # Application entrypoint & middleware
│   ├── models.py                     # SQLAlchemy multi-tenant DB models
│   ├── auth.py                       # JWT & API key verification
│   ├── worker.py                     # Celery task definitions (Train & Infer)
│   ├── openai_inference_router.py    # OpenAI-compatible /v1/chat/completions
│   ├── enterprise_training_router.py # /api/v1/training endpoints
│   ├── cluster_worker_router.py      # /api/v1/workers fleet management
│   ├── scheduler.py                  # Intelligent GPU dispatch algorithm
│   └── storage.py                    # MinIO S3 bucket and presigned URL fabric
│
├── network-nebula/                   # React 19 Enterprise Cloud Console
│   ├── src/                          # TypeScript React source
│   │   ├── pages/                    # Training Studio, Playground, Fleet
│   │   └── components/               # Dark-mode dashboard components
│   ├── vite.config.ts                # Vite frontend bundler configuration
│   └── Dockerfile                    # Multi-stage production Nginx container
│
├── docs/                             # 📚 Central Documentation & Artifacts Hub
│   ├── README.md                     # Master Documentation Catalog Index
│   ├── long-term/                    # Permanent specifications, architecture & API
│   │   ├── architecture/             # ARCHITECTURE.md, SDD.md, EDD.md
│   │   ├── specifications/           # SRS.md, SOW.md, TRACEABILITY.md
│   │   ├── api/                      # API.md
│   │   ├── testing/                  # STP.md, STD.md
│   │   └── product/                  # ROADMAP.md, SKILLS.md
│   └── temp/                         # Temporary working artifacts & scratchpad
│       ├── execution-plans/          # EXEC_PLANS.md
│       ├── scratchpad/               # Ephemeral scratch & debug logs
│       └── reports/                  # Benchmark runs & test reports
│
├── nebula_worker.py                  # Standalone GPU host worker daemon
├── test_suite.py                     # Master test suite runner
├── docker-compose.server.yml         # Production server Docker stack
└── docker-compose.yml                # Local developer stack
```

---

## 📚 Software Engineering Documentation Suite

All specifications, architectural designs, and QA test plans are consolidated in [`docs/`](docs/README.md), following university-standard software engineering practices (Intro2SE · Prof. Boaz Ben-Moshe):

| Document | Purpose | File Link |
| :--- | :--- | :--- |
| **Documentation Index** | Complete documentation catalog and directory guide | [`docs/README.md`](docs/README.md) |
| **SOW** | Scope of Work: objectives, deliverables, milestones, and acceptance | [`docs/long-term/specifications/SOW.md`](docs/long-term/specifications/SOW.md) |
| **SRS** | Software Requirements Specification: functional/NFR requirements & use cases | [`docs/long-term/specifications/SRS.md`](docs/long-term/specifications/SRS.md) |
| **SDD** | System Design Document: decomposition, components, database & deployment | [`docs/long-term/architecture/SDD.md`](docs/long-term/architecture/SDD.md) |
| **EDD** | Engineering Design Document: worker engine internals, algorithms & state machine | [`docs/long-term/architecture/EDD.md`](docs/long-term/architecture/EDD.md) |
| **API** | API Reference: contract, error envelopes, and OpenAI drop-in specs | [`docs/long-term/api/API.md`](docs/long-term/api/API.md) |
| **STP** | Software Test Plan: strategy, levels, entry/exit criteria | [`docs/long-term/testing/STP.md`](docs/long-term/testing/STP.md) |
| **STD** | Software Test Description: concrete test cases and automated procedures | [`docs/long-term/testing/STD.md`](docs/long-term/testing/STD.md) |
| **Traceability** | Bidirectional matrix linking SOW &rarr; SRS &rarr; SDD &rarr; EDD &rarr; STD | [`docs/long-term/specifications/TRACEABILITY.md`](docs/long-term/specifications/TRACEABILITY.md) |
| **Architecture** | System architecture, cluster topologies, and tensor flow | [`docs/long-term/architecture/ARCHITECTURE.md`](docs/long-term/architecture/ARCHITECTURE.md) |
| **Roadmap** | Multi-phase development roadmap and deliverables | [`docs/long-term/product/ROADMAP.md`](docs/long-term/product/ROADMAP.md) |
| **Execution Plans** | Multi-worker dispatch & payout hardening plan | [`docs/temp/execution-plans/EXEC_PLANS.md`](docs/temp/execution-plans/EXEC_PLANS.md) |

---

## 🤝 How to Contribute

1. **Docs-as-Code Rule:** Any functional modification or endpoint addition must be reflected in `docs/long-term/specifications/SRS.md`, `docs/long-term/api/API.md`, and `docs/long-term/testing/STD.md` in the same pull request.
2. **Regression Check:** All pull requests must achieve a 100% green pass in `python test_suite.py` before merge.
3. **Branching Strategy:** Work in dedicated feature branches (`feature/<feature-name>`) and target `main`.

---

## 📄 License & Contact

Distributed under the **MIT License**.  
For enterprise inquiries, cluster onboarding, or academic review, contact the core development team at `engineering@networknebula.ai`.
