# API Reference & Developer Contract: Project NetworkNebula
## Enterprise B2B Decentralized AI Compute & Model Serving Network

> **Course:** Intro2SE (Software Engineering) · School of Computer Science, Ariel University  
> **Course Lecturer:** Prof. Boaz Ben-Moshe  
> **Document Code:** API-NN-2026-v1.0  
> **Traceability Reference:** Implements interfaces defined in [SRS REQ-01, REQ-06, REQ-11..16](file:///c:/Users/ohadb/Desktop/ALL/APPS/Project%20NetworkNebula/docs/SRS.md) & [SDD §3](file:///c:/Users/ohadb/Desktop/ALL/APPS/Project%20NetworkNebula/docs/SDD.md)  
> **Target Audience:** Client Developers, Frontend Engineers, Integrators  
> **Interactive Swagger UI:** Available live at `http://<server-ip>:8000/docs` or `http://localhost:8000/docs`

---

## 1. Overview & Authentication

### 1.1 Base URLs & Versioning
- **Production Server Gateway:** `http://<server-ip>:8000` (or `https://api.networknebula.ai`)
- **Local Development Gateway:** `http://localhost:8000`
- **OpenAI Compatible Endpoint Root:** `/v1`
- **Enterprise Platform Operations Root:** `/api/v1`

### 1.2 Authentication Schemes
NetworkNebula supports two authentication mechanisms:
1. **Bearer API Tokens (Recommended for SDKs & Automations):**  
   Header: `Authorization: Bearer sk-nebula-<token>`  
   Provisioned via the Cloud Console or `POST /api/v1/tokens`. Scoped by permission (`training`, `inference`, `admin`).
2. **API Key / Secret Pair (Header Based):**  
   Headers:  
   `X-API-Key: <api_key>`  
   `X-API-Secret: <api_secret>`

### 1.3 Telemetry & Observability Headers
Every HTTP response issued by the NetworkNebula gateway contains tracing headers:
- `X-Nebula-Trace-ID`: Unique UUID tracking the request across distributed workers.
- `X-Nebula-Node-ID`: The ID of the serving cluster node or worker.
- `X-Nebula-Latency-Ms`: Execution and network transit duration in milliseconds.

---

## 2. Standard Error Envelope & Status Codes

All 4xx and 5xx responses conform to a predictable error envelope:

```json
{
  "error": {
    "message": "Human-readable explanation of what went wrong",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

| HTTP Status | Meaning | Typical Trigger |
| :--- | :--- | :--- |
| **200 OK** | Request succeeded | Inference completed, token listed, status returned |
| **201 Created** | Resource created | Training job submitted, API token generated |
| **400 Bad Request** | Invalid payload | Missing required fields, unparsable JSONL |
| **401 Unauthorized** | Authentication failed | Missing or invalid Bearer token / API key |
| **402 Payment Required** | Balance depleted | Insufficient credit balance to complete job |
| **404 Not Found** | Resource missing | Training job or model ID does not exist |
| **422 Unprocessable** | Validation error | Pydantic validation failure on request body |
| **429 Too Many Requests**| Rate limit exceeded | User exceeded configured RPM/TPM limit |
| **500 Server Error** | Internal failure | Unhandled worker error, database disconnection |

---

## 3. OpenAI-Compatible Gateway Endpoints (`/v1`)

### 3.1 Create Chat Completion
`POST /v1/chat/completions`

Generates an LLM response from an array of conversational messages. Fully compatible with OpenAI client libraries.

#### Request Headers
```http
Content-Type: application/json
Authorization: Bearer sk-nebula-f8319a2c...
```

#### Request Body
```json
{
  "model": "qwen-2.5-0.5b",
  "messages": [
    {"role": "system", "content": "You are a helpful AI assistant."},
    {"role": "user", "content": "What is decentralized cloud compute?"}
  ],
  "temperature": 0.7,
  "max_tokens": 150,
  "stream": false
}
```

#### Response (200 OK)
```json
{
  "id": "chatcmpl-91a24d08-e21b-42fa",
  "object": "chat.completion",
  "created": 1744883492,
  "model": "qwen-2.5-0.5b",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Decentralized cloud compute distributes computing tasks across a peer-to-peer network of independent hardware providers rather than relying on a single centralized data center."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 24,
    "completion_tokens": 31,
    "total_tokens": 55
  }
}
```

#### Python Example (Using Official OpenAI SDK)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="sk-nebula-demo-token"
)

response = client.chat.completions.create(
    model="qwen-2.5-0.5b",
    messages=[{"role": "user", "content": "Explain LoRA fine-tuning in one sentence."}],
    max_tokens=60
)

print(response.choices[0].message.content)
```

---

### 3.2 List Available Models
`GET /v1/models`

Retrieves list of active base foundation models and deployed fine-tuned LoRA adapters.

#### Response (200 OK)
```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen-2.5-0.5b",
      "object": "model",
      "created": 1744800000,
      "owned_by": "nebula-foundation"
    },
    {
      "id": "llama-3.2-1b",
      "object": "model",
      "created": 1744800000,
      "owned_by": "nebula-foundation"
    },
    {
      "id": "ft-customer-support-v1",
      "object": "model",
      "created": 1744882100,
      "owned_by": "organization-4012"
    }
  ]
}
```

---

## 4. Enterprise Training Endpoints (`/api/v1/training`)

### 4.1 Request Dataset Upload URL
`POST /api/v1/training/upload-url`

Generates a presigned S3 PUT URL for uploading JSONL training datasets directly to MinIO.

#### Request Body
```json
{
  "filename": "customer_support_qa.jsonl",
  "filesize_bytes": 1048576
}
```

#### Response (200 OK)
```json
{
  "upload_url": "http://localhost:9000/nebula-datasets/org-1/customer_support_qa.jsonl?X-Amz-Signature=...",
  "s3_path": "s3://nebula-datasets/org-1/customer_support_qa.jsonl",
  "expires_in_seconds": 3600
}
```

---

### 4.2 Submit LoRA Training Job
`POST /api/v1/training/jobs`

Enqueues a distributed fine-tuning job across the GPU worker pool.

#### Request Body
```json
{
  "name": "support-agent-v1",
  "base_model": "llama-3.2-1b",
  "dataset_s3_url": "s3://nebula-datasets/org-1/customer_support_qa.jsonl",
  "train_type": "lora",
  "hyperparameters": {
    "epochs": 5,
    "learning_rate": 0.0002,
    "lora_rank": 16,
    "lora_alpha": 32,
    "batch_size": 4
  }
}
```

#### Response (201 Created)
```json
{
  "id": "trn-7f83b2a1",
  "name": "support-agent-v1",
  "status": "queued",
  "base_model": "llama-3.2-1b",
  "epochs": 5,
  "cost_estimate_usd": 0.85,
  "created_at": "2026-10-29T21:00:00Z"
}
```

---

### 4.3 Retrieve Job Status & Checkpoints
`GET /api/v1/training/jobs/{job_id}/checkpoints`

Returns training loss history and presigned download links for trained `.safetensors` checkpoints.

#### Response (200 OK)
```json
{
  "job_id": "trn-7f83b2a1",
  "status": "completed",
  "current_epoch": 5,
  "total_epochs": 5,
  "loss_history": [
    {"epoch": 1, "loss": 2.451},
    {"epoch": 2, "loss": 1.832},
    {"epoch": 3, "loss": 1.340},
    {"epoch": 4, "loss": 0.985},
    {"epoch": 5, "loss": 0.721}
  ],
  "checkpoints": [
    {
      "epoch": 5,
      "tag": "final",
      "download_url": "http://localhost:9000/nebula-checkpoints/trn-7f83b2a1/adapter_model.safetensors?X-Amz-Signature=..."
    }
  ]
}
```

---

## 5. Worker Fleet Management Endpoints (`/api/v1/workers`)

### 5.1 Register Compute Node
`POST /api/v1/workers/register`

Invoked by `nebula_worker.py` daemon to register hardware specs into the active compute pool.

#### Request Body
```json
{
  "name": "desktop-rtx4070-node",
  "gpu_info": "NVIDIA GeForce RTX 4070 12GB",
  "gpu_memory_gb": 12.0,
  "cpu_cores": 16,
  "memory_gb": 32.0,
  "cuda_version": "12.8",
  "role": "LoRA Training & Inference"
}
```

#### Response (200 OK)
```json
{
  "worker_id": "wrk-49102",
  "status": "ready",
  "heartbeat_interval_sec": 30,
  "allocated_vram_gb": 9.6,
  "reputation_score": 100.0,
  "always_silent_supported": true
}
```

### 5.2 Worker Telemetry & Adaptive Regulation Heartbeat
`POST /api/v1/workers/{worker_id}/heartbeat`

Periodic ping transmitted every 10–30s reporting live utilization, input idle timestamps, and "Always Silent" regulation state.

#### Request Body
```json
{
  "status": "online",
  "work_capacity_state": "stealth",
  "input_idle_sec": 1.4,
  "vram_used_gb": 3.2,
  "gpu_utilization_pct": 28.5,
  "gpu_temp_c": 59.0,
  "duty_cycle_pct": 30,
  "latency_ping_ms": 14.2
}
```

#### Response (200 OK)
```json
{
  "status": "ok",
  "vram_allocation_pct": 80,
  "assigned_work_mode": "async_inference",
  "slice_timeout_sec": 60,
  "always_silent_active": true
}
```

### 5.3 Worker Configuration & Silent Mode Toggle
`PATCH /api/v1/workers/{worker_id}/config`

Enables users to dynamically toggle "Always Silent" regulation and adjust VRAM ceilings without restarting the worker daemon.

#### Request Body
```json
{
  "always_silent": true,
  "vram_allocation_pct": 80,
  "target_temp_c": 62.0
}
```

#### Response (200 OK)
```json
{
  "worker_id": "wrk-49102",
  "always_silent": true,
  "vram_allocation_pct": 80,
  "target_temp_c": 62.0,
  "effective_state": "stealth"
}
```

---

## 6. Rate Limits & Quotas

| Tier | RPM (Requests / Min) | TPM (Tokens / Min) | Max Concurrent Training Runs |
| :--- | :--- | :--- | :--- |
| **Developer / Free** | 60 RPM | 40,000 TPM | 1 Job |
| **Pro Enterprise** | 600 RPM | 400,000 TPM | 5 Jobs |
| **Dedicated Scale** | Custom (10,000+ RPM) | Unlimited | 50 Jobs |

When a client breaches rate limits, the gateway returns `429 Too Many Requests` with headers:
- `X-RateLimit-Limit-RPM: 60`
- `X-RateLimit-Remaining-RPM: 0`
- `Retry-After: 12`
