# Project NetworkNebula — Enterprise Technical Architecture

This document defines the high-level and component architecture for the **Enterprise B2B Decentralized AI Compute Network**.

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph EnterpriseClients ["Enterprise Clients & ML Engineers"]
        SDK["OpenAI SDK / Python Client"]
        Console["React 19 Enterprise Cloud Console (:5173)"]
    end

    subgraph APIOrchestrator ["FastAPI Orchestrator (:8000)"]
        Auth["Enterprise Token & Scoped Auth"]
        TrainRouter["Training Router (/api/v1/training)"]
        OpenAIRouter["OpenAI Gateway Router (/v1)"]
        TokenRouter["API Token Router (/api/v1/tokens)"]
        Coord["Distributed Coordinator (app/distributed.py)"]
    end

    subgraph StorageQueue ["Storage & Message Layer"]
        PG[("PostgreSQL (:5433)\nUsers, TrainingJobs, InferenceEndpoints, ApiTokens")]
        Redis[("Redis (:6379)\nCelery Queue Broker")]
        MinIO[("MinIO S3 (:9000)\nnebula-datasets\nnebula-checkpoints\nnebula-models")]
    end

    subgraph WorkerFleet ["Decentralized Host Worker Fleet"]
        W1["Host Node 1 (NVIDIA RTX 4070)"]
        W2["Host Node 2 (Remote GPU)"]
        gRPC["gRPC Mesh (Tensor Passing & All-Reduce)"]
    end

    Console --> Auth
    SDK --> Auth
    Auth --> TrainRouter
    Auth --> OpenAIRouter
    Auth --> TokenRouter

    TrainRouter --> PG
    OpenAIRouter --> PG
    TokenRouter --> PG

    TrainRouter --> Coord
    Coord --> Redis
    OpenAIRouter --> Redis
    Coord --> MinIO

    Redis --> W1
    Redis --> W2
    W1 <--> gRPC <--> W2
    W1 --> MinIO
    W2 --> MinIO
```

---

## 2. Core Data Flows

### A. Enterprise Model Training Lifecycle

```mermaid
sequenceDiagram
    participant Client as Enterprise Client
    participant API as FastAPI Orchestrator
    participant S3 as MinIO S3 (nebula-datasets)
    participant Redis as Redis Task Broker
    participant Worker as Host Worker (GPU)
    participant OutS3 as MinIO S3 (nebula-checkpoints)

    Client->>API: 1. Request presigned upload URL
    API-->>Client: S3 PUT URL for dataset
    Client->>S3: 2. Upload dataset (data.jsonl)
    Client->>API: 3. POST /api/v1/training/jobs (model, dataset_url, epochs, lr, rank)
    API->>Redis: 4. Enqueue execute_training_job
    API-->>Client: Return TrainingJob ID (status: queued)
    Redis->>Worker: 5. Worker claims training job
    Worker->>S3: 6. Download dataset & foundation model
    loop Each Training Epoch
        Worker->>Worker: 7. Forward/Backward step & gradient update
        Worker->>API: 8. Update loss telemetry & progress
    end
    Worker->>OutS3: 9. Upload adapter_model.safetensors checkpoint
    Worker->>API: 10. Mark TrainingJob status: completed
    Client->>API: 11. GET /api/v1/training/jobs/{id}/checkpoints
    API-->>Client: Checkpoint URLs & loss curve telemetry
```

### B. Enterprise Model Serving Lifecycle (OpenAI-Compatible Gateway)

```mermaid
sequenceDiagram
    participant App as Enterprise Application
    participant Gateway as OpenAI Gateway (/v1/chat/completions)
    participant Redis as Redis Queue
    participant Worker as Host Worker Node
    participant DB as PostgreSQL Ledger

    App->>Gateway: POST /v1/chat/completions (Bearer API_TOKEN, model, messages)
    Gateway->>DB: Validate token, check rate limits & credit balance
    Gateway->>Redis: Dispatch inference request to warm worker pool
    Redis->>Worker: Worker executes inference in VRAM
    Worker-->>Gateway: Return completion text & token usage
    Gateway->>DB: Record token debit and host worker 70% revenue share
    Gateway-->>App: OpenAI-format JSON response (id, choices, usage)
```

---

## 3. Storage Hierarchy (MinIO S3)

All object storage buckets are partitioned by organization ID to ensure strict enterprise data isolation:

```text
nebula-datasets/
  └── {org_id}/
      └── {dataset_id}/
          ├── data.jsonl
          └── metadata.json

nebula-checkpoints/
  └── {training_job_id}/
      ├── epoch_1/
      │   ├── adapter_config.json
      │   └── adapter_model.safetensors
      ├── epoch_final/
      │   ├── adapter_config.json
      │   └── adapter_model.safetensors
      └── loss_history.json

nebula-models/
  └── {base_model_id}/
      └── weights/
```

---

## 4. Multi-Tenancy Database Entities

| Entity | Primary Table | Purpose |
| :--- | :--- | :--- |
| **`User`** | `users` | Account profile, role (`creator`/`worker`), base credits |
| **`TrainingJob`** | `training_jobs` | Fine-tuning run, base model, dataset S3 URL, loss history, checkpoints |
| **`InferenceEndpoint`** | `inference_endpoints` | Deployed model endpoint, model ID, adapter URL, status, latency metrics |
| **`ApiToken`** | `api_tokens` | Enterprise scoped API tokens with RPM/TPM rate limits and expiration |
| **`Transaction`** | `transactions` | Immutable financial ledger auditing credits, debits, and worker payouts |
| **`Worker`** | `workers` | Decentralized host GPU hardware specs, online status, tasks completed |

---

## 5. Worker Distributed Ring All-Reduce Protocol

When multiple decentralized host workers are assigned to a distributed training job:
1. Workers form a **`WorkerGroup`** identified by group ID.
2. In data-parallel training, each worker computes local gradients for its batch shard.
3. The **`GradientAggregator`** in `app/distributed.py` collects bucket gradients from each worker.
4. Once all worker gradients for a layer bucket arrive, all-reduce computes the mean gradient tensor.
5. The aggregated gradient is broadcast back to all worker nodes via gRPC streaming (`app/grpc_endpoints.py`), ensuring weights remain synchronized across nodes without a central bottleneck.
