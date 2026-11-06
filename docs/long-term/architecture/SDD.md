# System Design Document (SDD): Project NetworkNebula
## Enterprise B2B Decentralized AI Compute & Model Serving Network

> **Course:** Intro2SE (Software Engineering) · School of Computer Science, Ariel University  
> **Course Lecturer:** Prof. Boaz Ben-Moshe  
> **Document Code:** SDD-NN-2026-v1.0  
> **Traceability Reference:** Satisfies [SOW D-1 through D-5](file:///c:/Users/ohadb/Desktop/ALL/APPS/Project%20NetworkNebula/docs/SOW.md) and maps to [SRS REQ-01 through REQ-19](file:///c:/Users/ohadb/Desktop/ALL/APPS/Project%20NetworkNebula/docs/SRS.md)  
> **Target Audience:** System Architects, Tech Leads, Senior Backend/DevOps Engineers  
> **Document Purpose:** Define the whole-system architecture, decomposition, component interfaces, data storage, deployment topology, and architectural trade-offs.

---

## 1. Context & External Environment

Project NetworkNebula serves two primary external stakeholder groups: **Enterprise AI Creators** (consuming compute) and **Decentralized GPU Hosts** (supplying compute). The system bridges these groups through a secure, orchestrated, containerized cloud layer:

```mermaid
flowchart TD
    subgraph ExternalClients ["Enterprise Clients & Consumers"]
        SDK["OpenAI SDK / Python Client"]
        ConsoleClient["Web Browser (React 19 Console)"]
        CurlClient["cURL / Automated CI/CD Pipelines"]
    end

    subgraph NetworkNebulaBoundary ["NetworkNebula System Boundary"]
        Gateway["FastAPI Orchestrator Gateway (:8000)"]
        AuthLayer["Authentication & Rate Limiter"]
        Queue["Celery Task Broker (Redis :6379)"]
        Coord["Distributed Scheduler & P2P Mesh Coordinator"]
        DB[("PostgreSQL 16 Multi-Tenant DB (:5432)")]
        Storage[("MinIO S3 Object Storage Fabric (:9000)")]
    end

    subgraph ExternalWorkers ["Decentralized Host Fleet"]
        Host1["Local Host Node (NVIDIA RTX 4070)"]
        Host2["Remote Community GPU Node"]
        HostN["Remote Data Center GPU Node"]
    end

    SDK -->|HTTPS /v1/chat/completions| Gateway
    ConsoleClient -->|HTTP / React 19 UI| Gateway
    CurlClient -->|HTTPS REST| Gateway

    Gateway --> AuthLayer
    AuthLayer --> DB
    AuthLayer --> Queue
    Gateway --> Coord
    Gateway --> Storage

    Queue --> Host1
    Queue --> Host2
    Queue --> HostN
    Host1 <--> Storage
    Host2 <--> Storage
    HostN <--> Storage
```

---

## 2. Subsystem Decomposition & Component View

The system is decomposed into five autonomous, loosely coupled subsystems:

```mermaid
flowchart TD
    subgraph UI ["1. Presentation Layer"]
        Console["React 19 Cloud Console<br/>(Vite, Tailwind, Recharts)"]
    end

    subgraph API ["2. API & Ingestion Layer"]
        AuthRouter["Auth & Token Router<br/>(app/enterprise_token_router.py)"]
        TrainRouter["Training Router<br/>(app/enterprise_training_router.py)"]
        InferenceRouter["OpenAI Gateway Router<br/>(app/openai_inference_router.py)"]
        WorkerRouter["Cluster & Fleet Router<br/>(app/cluster_worker_router.py)"]
        WalletRouter["Wallet & Staking Router<br/>(app/wallet_router.py)"]
    end

    subgraph Core ["3. Orchestration & Engine Layer"]
        Scheduler["Distributed Scheduler (app/scheduler.py)"]
        DHT["Kademlia P2P DHT (app/kademlia_dht.py)"]
        MoE["MoE Dispatch Engine (app/moe_engine.py)"]
        Speculative["Speculative Engine (app/speculative_engine.py)"]
        Verification["Verification & Slashing (app/verification_engine.py)"]
    end

    subgraph StorageLayer ["4. Persistence & Broker Layer"]
        PG[("PostgreSQL 16 DB<br/>Relational & Ledger")]
        RedisStore[("Redis 7<br/>Broker, Cache & Pub/Sub")]
        MinIOS3[("MinIO S3 Store<br/>Datasets & Checkpoints")]
    end

    subgraph Execution ["5. Worker Execution Layer"]
        CeleryWorker["Celery Worker Node (app/worker.py)"]
        StandaloneAgent["Nebula Worker CLI (nebula_worker.py)"]
        StealthSensor["Stealth Presence Sensor (worker/stealth_sensor.py)"]
        SilentGovernor["Acoustic-Thermal Governor (worker/silent_governor.py)"]
        TorchEngine["PyTorch / PEFT Engine (app/training_engine.py)"]
        InferenceRuntime["Neural Inference Engine (app/inference_engine.py)"]
    end

    Console --> API
    API --> Core
    API --> StorageLayer
    Core --> StorageLayer
    StorageLayer --> Execution
    Execution --> StorageLayer
```

### Component Breakdown
1. **Presentation Layer (`network-nebula/`):** React 19 single-page application built with Vite and Tailwind CSS. Provides the Training Studio, Model Playground, Token Management, and Fleet Telemetry views.
2. **API & Ingestion Layer (`app/`):** FastAPI asynchronous framework mounting modular APIRouters. Enforces JWT auth, rate limits, CORS policies, and distributed request tracing headers (`X-Nebula-Trace-ID`).
3. **Orchestration & Engine Layer:** Intelligent routing engine directing workloads based on worker VRAM, locality, reputation score, and hardware capabilities. Includes fault recovery and verification engines.
4. **Persistence & Broker Layer:**
   - **PostgreSQL 16:** ACID transactions, relational models, user balances, training run history, audit logs.
   - **Redis 7:** Celery task message queues, transient cache, rate limiting counters, and pub/sub heartbeat channels.
   - **MinIO S3:** High-volume object storage partitioned into three multi-tenant buckets (`nebula-datasets`, `nebula-checkpoints`, `nebula-models`).
5. **Worker Execution Layer:** Standalone daemon and Celery workers running PyTorch, Hugging Face `peft`, and `safetensors`. Executes forward/backward passes on NVIDIA GPUs.

---

## 3. Communication Protocols & Component Interfaces

The following table summarizes all internal and external network communication interfaces:

| Source | Destination | Protocol | Port | Data Format | Authentication / Encryption |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Client SDK / Console | API Orchestrator | HTTPS / REST | 8000 | JSON / SSE Streams | Bearer Token (`sk-nebula-...`) |
| API Orchestrator | PostgreSQL | TCP / SQL | 5432 | Binary PostgreSQL wire | Password / Connection Pool |
| API Orchestrator | Redis | TCP / RESP | 6379 | Redis Serialization | Redis Auth |
| API / Workers | MinIO S3 | HTTP / S3 API | 9000 | Binary Safetensors / JSONL | S3 Access Key & Secret / HMAC |
| Remote Worker | API Orchestrator | HTTP / WebSocket | 8000 | JSON Heartbeat & Tasks | Worker Secret Token |
| Worker to Worker | P2P gRPC Mesh | HTTP/2 / gRPC | 50051 | Protocol Buffers (Tensors) | Mutual TLS / Secret Token |

### 3.4 "Always Silent" Adaptive Regulation & Stealth Sensing Architecture

To eliminate desktop micro-stutters and frame drops during concurrent user interaction (Excel, Web browsing, IDEs), the worker daemon integrates a multi-tier adaptive regulation loop:

```mermaid
sequenceDiagram
    autonumber
    actor Jon as Host Desktop User
    participant OS as OS Input Subsystem (Win32/IOKit)
    participant Sensor as Stealth Presence Sensor
    participant Gov as Acoustic-Thermal Governor
    participant Worker as Nebula Worker Daemon
    participant DWM as Desktop Window Manager (dwm.exe)
    participant Orch as Central Orchestrator Scheduler

    Note over Jon,Worker: Night Hours: Idle > 60s (UNLEASHED MODE - 100% Throughput)
    Worker->>Worker: Full-blast training batch execution
    
    Note over Jon,OS: Morning: Jon wakes up & moves mouse in Excel
    Jon->>OS: Mouse Movement / Keyboard Input
    Sensor->>OS: Query GetLastInputInfo() / IOKit (Latency < 200us)
    OS-->>Sensor: elapsed_ms = 45ms (Active human input detected!)
    Sensor->>Worker: Transition signal -> STEALTH_REGULATED
    
    activate Worker
    Worker->>Gov: Request duty-cycle yield profile
    Gov-->>Worker: Enforce 30% duty cycle + 25ms yield sleep
    Worker->>Worker: Deliver current micro-slice & flush VRAM cache
    Worker->>DWM: YIELD GPU QUEUE: Hardware command queue idle for 25ms
    DWM->>DWM: Composite Excel UI smoothly @ 144 Hz (0 frame drops!)
    Worker->>Orch: Heartbeat: status="online", work_mode="stealth"
    Orch-->>Worker: Route relaxed async inference slices (extended 60s timeout)
    deactivate Worker

    Note over Jon,OS: Lunchtime: Jon steps away (Idle for 60s)
    Sensor->>OS: Query input idle timer
    OS-->>Sensor: elapsed_ms = 60,400ms (Idle confirmed)
    Sensor->>Worker: Transition signal -> UNLEASHED
    Worker->>Orch: Heartbeat: work_mode="unleashed"
    Worker->>Worker: Resume 100% capacity compute burst
```

---

## 4. Data Architecture & Entity-Relationship Design

### 4.1 Database Domain Model (UML Class / Entity Relationship)

```mermaid
classDiagram
    class User {
        +String id (PK)
        +String email
        +String password_hash
        +String api_key
        +Float balance
        +Float total_earned
        +Boolean is_worker
        +DateTime created_at
    }

    class ApiToken {
        +String id (PK)
        +String user_id (FK)
        +String name
        +String token_hash
        +String token_prefix
        +String scopes
        +Integer rate_limit_rpm
        +Boolean is_active
        +DateTime created_at
    }

    class TrainingJob {
        +String id (PK)
        +String user_id (FK)
        +String name
        +String base_model
        +String train_type
        +String dataset_s3_url
        +String status
        +Integer current_epoch
        +Integer total_epochs
        +String loss_history (JSON)
        +String checkpoints (JSON)
        +Float cost
        +DateTime created_at
    }

    class InferenceEndpoint {
        +String id (PK)
        +String user_id (FK)
        +String name
        +String model_id
        +String adapter_url
        +String status
        +Integer min_replicas
        +Integer total_requests
        +Float avg_latency_ms
    }

    class Worker {
        +String id (PK)
        +String user_id (FK)
        +String name
        +String gpu_info
        +String status
        +Float gpu_memory_gb
        +Float vram_used_gb
        +Float hourly_rate_usd
        +Float staked_amount_usd
        +Float reputation_score
        +DateTime last_heartbeat
    }

    class Transaction {
        +Integer id (PK)
        +String transaction_id
        +String user_id (FK)
        +String worker_id (FK)
        +String type
        +Float amount
        +Float balance_after
        +DateTime created_at
    }

    User "1" --> "0..*" ApiToken : owns
    User "1" --> "0..*" TrainingJob : submits
    User "1" --> "0..*" InferenceEndpoint : deploys
    User "1" --> "0..*" Worker : operates
    User "1" --> "0..*" Transaction : records
    Worker "1" --> "0..*" Transaction : earns
```

### 4.2 Storage Partitioning Scheme (MinIO S3)

To ensure enterprise multi-tenancy isolation and zero cross-tenant leakage:
```text
MinIO Object Storage Fabric/
├── nebula-datasets/
│   └── {org_id}/
│       └── {dataset_uuid}/
│           ├── train.jsonl
│           └── manifest.json
├── nebula-checkpoints/
│   └── {training_job_uuid}/
│       ├── epoch_1/
│       │   ├── adapter_config.json
│       │   └── adapter_model.safetensors
│       ├── epoch_final/
│       │   ├── adapter_config.json
│       │   └── adapter_model.safetensors
│       └── training_telemetry.json
└── nebula-models/
    └── {base_model_slug}/
        └── base_weights.safetensors
```

---

## 5. Deployment Topology & Cloud Infrastructure

The entire platform is packaged as a production-ready containerized stack orchestrated via Docker Compose (`docker-compose.server.yml`):

```mermaid
flowchart TD
    subgraph HostServer ["Dedicated Cloud VM / On-Premise Host (e.g., Hetzner, AWS, Home Server)"]
        Nginx["Nginx Web Reverse Proxy (:80 / :5173)<br/>Container: nebula-web"]
        FastAPIApp["FastAPI Orchestrator (:8000)<br/>Container: nebula-api"]
        CeleryApp["Celery Worker (:solo)<br/>Container: nebula-celery"]
        PostgresContainer["PostgreSQL 16 (:5432)<br/>Container: nebula-db"]
        RedisContainer["Redis 7 (:6379)<br/>Container: nebula-redis"]
        MinIOContainer["MinIO S3 (:9000 / :9001)<br/>Container: nebula-minio"]

        VolumeDB[("Volume: postgres_data")]
        VolumeRedis[("Volume: redis_data")]
        VolumeMinIO[("Volume: minio_data")]
        VolumeCache[("Volume: model_cache")]
    end

    subgraph RemoteClients ["Internet Clients"]
        WebUsers["Web Users (:80)"]
        ApiUsers["API Developers (:8000)"]
    end

    subgraph GPUWorkerNodes ["Distributed Compute Fleet"]
        LocalGPU["Primary Local Worker (RTX 4070)"]
        RemoteGPU["Remote Worker via Internet"]
    end

    WebUsers --> Nginx
    ApiUsers --> FastAPIApp
    Nginx --> FastAPIApp

    FastAPIApp --> PostgresContainer
    FastAPIApp --> RedisContainer
    FastAPIApp --> MinIOContainer

    CeleryApp --> RedisContainer
    CeleryApp --> PostgresContainer
    CeleryApp --> MinIOContainer

    PostgresContainer --- VolumeDB
    RedisContainer --- VolumeRedis
    MinIOContainer --- VolumeMinIO
    CeleryApp --- VolumeCache

    LocalGPU -->|Celery / Redis / S3| HostServer
    RemoteGPU -->|WebSocket / HTTPS API| HostServer
```

---

## 6. Architecture Decision Records (ADR)

### ADR-01: Adoption of OpenAI API Compatibility Layer
- **Status:** Accepted
- **Context:** Enterprise customers already have client applications written for OpenAI's REST API. Requiring custom SDKs creates sales friction.
- **Decision:** Implement `POST /v1/chat/completions` and `GET /v1/models` in FastAPI conforming strictly to OpenAI JSON specifications.
- **Consequence:** Immediate drop-in migration for customers; standard tools like LangChain, LiteLLM, and LlamaIndex function without alteration.

### ADR-02: MinIO S3 Object Storage over Direct File System Storage
- **Status:** Accepted
- **Context:** Training checkpoints can range from 50 MB (LoRA) to 15 GB (full weights). Workers need direct, distributed read/write access.
- **Decision:** Deploy MinIO S3 and use presigned PUT/GET URLs for dataset uploads and checkpoint downloads.
- **Consequence:** Eliminates file streaming through the FastAPI web process, preventing API memory bottlenecks and enabling geo-distributed workers to access storage directly.

### ADR-03: Safetensors over Pickled PyTorch Binaries
- **Status:** Accepted
- **Context:** Standard PyTorch `.bin` / `.pt` files use Python's `pickle` module, which exposes workers to arbitrary remote code execution (RCE) vulnerabilities.
- **Decision:** Mandate Hugging Face `safetensors` format for all model adapters and checkpoints.
- **Consequence:** Zero arbitrary code execution risk, zero-copy memory mapping, and faster deserialization.

### ADR-04: Hybrid Worker Architecture (Celery + Standalone WebSocket CLI)
- **Status:** Accepted
- **Context:** Co-located workers on the same LAN benefit from low-latency Redis/Celery queues, while remote residential workers reside behind NAT firewalls.
- **Decision:** Support both native Celery execution (for local nodes) and a standalone CLI polling agent (`nebula_worker.py`) connecting via outbound HTTPS/WebSocket.
- **Consequence:** Flexibility to recruit both dedicated cloud GPUs and decentralized crowd-sourced GPUs with zero router port forwarding required.

### ADR-05: Interleaved Micro-Duty-Cycle Compute Yielding over Coarse-Grained GPU Preemption
- **Status:** Accepted
- **Context:** Monolithic GPU compute dispatches cause Windows DWM and macOS WindowServer compositors to miss VSync deadlines (6.9ms – 16.6ms), resulting in severe desktop UI stutter during background worker execution. Hardware compute preemption cannot guarantee sub-millisecond context switching across consumer architectures.
- **Decision:** Introduce a software-governed micro-duty-cycle yielding loop ($T_{\text{yield}} \ge 15\text{ms}$) combined with low-priority CUDA execution streams (`priority=0`) and closed-loop thermal governor (<62°C).
- **Consequence:** Eliminates 100% of human-perceived desktop stutter and fan noise; enables decentralized workers to run 24/7 without manual pausing while maintaining continuous PoDS revenue minting.
