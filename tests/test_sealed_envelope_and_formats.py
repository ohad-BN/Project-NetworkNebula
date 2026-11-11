"""
Milestone 3 Test Suite: Zero-Storage Data Plane, Private Model Registry,
X25519 Ephemeral Sealed Envelope, and Universal Dataset Format Parsers.
"""

import io
import os
import json
import uuid
import zipfile
import hashlib
from typing import Generator

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import User, Worker, PrivateModel, TrainingJob
from worker.nebula_worker import (
    seal_envelope,
    unseal_envelope,
    zero_memory,
    _WorkerGpuRuntime,
    parse_universal_dataset,
)


@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db_session() -> Generator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def tenant_users(db_session) -> Generator:
    """Create two isolated tenant accounts for testing private model registry."""
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]

    tenant_a = User(
        id=f"tenant-a-{suffix_a}",
        email=f"tenant_a_{suffix_a}@example.com",
        api_key=f"nebula_key_a_{suffix_a}",
        api_secret=f"nebula_secret_a_{suffix_a}",
        name="Tenant A",
        is_active=True,
    )
    tenant_b = User(
        id=f"tenant-b-{suffix_b}",
        email=f"tenant_b_{suffix_b}@example.com",
        api_key=f"nebula_key_b_{suffix_b}",
        api_secret=f"nebula_secret_b_{suffix_b}",
        name="Tenant B",
        is_active=True,
    )

    db_session.add_all([tenant_a, tenant_b])
    db_session.commit()
    db_session.refresh(tenant_a)
    db_session.refresh(tenant_b)

    user_id_a = str(tenant_a.id)
    user_id_b = str(tenant_b.id)

    yield {
        "tenant_a": tenant_a,
        "tenant_b": tenant_b,
        "headers_a": {"X-API-Key": tenant_a.api_key, "X-API-Secret": tenant_a.api_secret},
        "headers_b": {"X-API-Key": tenant_b.api_key, "X-API-Secret": tenant_b.api_secret},
    }

    # Cleanup
    try:
        db_session.rollback()
        db_session.query(PrivateModel).filter(
            PrivateModel.user_id.in_([user_id_a, user_id_b])
        ).delete(synchronize_session=False)
        db_session.query(TrainingJob).filter(
            TrainingJob.user_id.in_([user_id_a, user_id_b])
        ).delete(synchronize_session=False)
        db_session.query(User).filter(
            User.id.in_([user_id_a, user_id_b])
        ).delete(synchronize_session=False)
        db_session.commit()
    except Exception:
        db_session.rollback()


# ==============================================================================
# 1. Ephemeral X25519 Sealed Envelope Cryptography Tests
# ==============================================================================

def test_x25519_sealed_envelope_roundtrip():
    """
    Verify ECDH (X25519) + HKDF-SHA256 + AES-256-GCM sealed envelope encryption & unsealing.
    Tests both packed binary base64 envelope and structured dictionary payload.
    """
    runtime = _WorkerGpuRuntime()
    worker_pubkey = runtime.tunnel_pubkey_x25519
    assert worker_pubkey is not None, "Worker runtime must generate ephemeral X25519 pubkey in RAM"
    assert len(worker_pubkey) > 30

    job_id = f"job-sec-{uuid.uuid4().hex[:8]}"
    secrets = {
        "hf_token": "hf_priv_live_test_token_8899aabbcc",
        "dek_b64": "3N9qZ5vY1wX8r7t6p5m4k3j2h1g0f9e8",
        "dataset_get_url": "https://r2.cloudflarestorage.com/byos-bucket/finetune_clean.jsonl?sig=xyz",
        "checkpoint_put_url": "https://r2.cloudflarestorage.com/byos-bucket/checkpoints/adapter.safetensors?sig=abc",
    }

    # Client seals secrets bound to job_id
    envelope_data = seal_envelope(secrets, worker_pubkey, job_id)
    assert "sealed_secrets_b64" in envelope_data
    assert "ephemeral_pubkey_x25519" in envelope_data
    assert "ciphertext" in envelope_data
    assert "tag" in envelope_data
    assert "nonce" in envelope_data

    # Worker unseals from binary base64 string
    unsealed, mutable_buf = runtime.unseal_secrets(envelope_data["sealed_secrets_b64"], job_id)
    assert unsealed == secrets
    assert isinstance(mutable_buf, bytearray)
    assert len(mutable_buf) > 0

    # Worker unseals from structured dictionary
    unsealed_dict, _ = runtime.unseal_secrets(envelope_data, job_id)
    assert unsealed_dict == secrets


def test_sealed_envelope_aad_binding():
    """
    Verify that sealed envelope strictly binds to job_id via AES-GCM Associated Data (AAD).
    Attempting to unseal with mismatched job_id MUST fail with decryption error.
    """
    runtime = _WorkerGpuRuntime()
    worker_pubkey = runtime.tunnel_pubkey_x25519

    correct_job_id = "job-bound-tenant-alpha-001"
    wrong_job_id = "job-hijacked-tenant-beta-002"

    secrets = {"hf_token": "hf_secret_12345", "target_model": "meta-llama/Llama-3.1-8B"}
    envelope_data = seal_envelope(secrets, worker_pubkey, correct_job_id)

    # Correct job_id succeeds
    unsealed, _ = runtime.unseal_secrets(envelope_data["sealed_secrets_b64"], correct_job_id)
    assert unsealed["hf_token"] == "hf_secret_12345"

    # Mismatched job_id MUST raise ValueError
    with pytest.raises(ValueError, match="Sealed envelope decryption failed"):
        runtime.unseal_secrets(envelope_data["sealed_secrets_b64"], wrong_job_id)


def test_sealed_envelope_tamper_rejection():
    """
    Verify authentication tag integrity: modifying a single bit in ciphertext, tag, or IV
    MUST trigger decryption failure / InvalidTag exception.
    """
    import base64
    runtime = _WorkerGpuRuntime()
    job_id = "job-tamper-test"
    secrets = {"dek_b64": "super_secret_data_encryption_key_123"}
    envelope_data = seal_envelope(secrets, runtime.tunnel_pubkey_x25519, job_id)

    raw_bin = bytearray(base64.b64decode(envelope_data["sealed_secrets_b64"]))

    # Tamper single byte in ciphertext (offset > 76)
    tampered_ct = bytearray(raw_bin)
    tampered_ct[-1] ^= 0x01
    with pytest.raises(ValueError, match="Sealed envelope decryption failed"):
        runtime.unseal_secrets(base64.b64encode(tampered_ct).decode("ascii"), job_id)

    # Tamper single byte in tag (offset 60:76)
    tampered_tag = bytearray(raw_bin)
    tampered_tag[65] ^= 0x01
    with pytest.raises(ValueError, match="Sealed envelope decryption failed"):
        runtime.unseal_secrets(base64.b64encode(tampered_tag).decode("ascii"), job_id)

    # Tamper single byte in IV (offset 48:60)
    tampered_iv = bytearray(raw_bin)
    tampered_iv[50] ^= 0x01
    with pytest.raises(ValueError, match="Sealed envelope decryption failed"):
        runtime.unseal_secrets(base64.b64encode(tampered_iv).decode("ascii"), job_id)


def test_ram_memory_zeroing():
    """
    Verify memory zeroing protocol: zero_memory overwrites decrypted buffers with 0s
    and clears secrets dictionary to guarantee zero persistent RAM footprint.
    """
    runtime = _WorkerGpuRuntime()
    job_id = "job-wipe-test"
    secrets = {"hf_token": "hf_ephemeral_token_998877", "sensitive": "private_data"}
    envelope_data = seal_envelope(secrets, runtime.tunnel_pubkey_x25519, job_id)

    unsealed, mutable_buf = runtime.unseal_secrets(envelope_data["sealed_secrets_b64"], job_id)
    assert len(mutable_buf) > 0
    assert any(b != 0 for b in mutable_buf)
    assert len(unsealed) == 2

    # Execute secure memory wipe
    zero_memory(mutable_buf, unsealed)

    # Assert buffer is 100% zeroed
    assert all(b == 0 for b in mutable_buf), "Mutable buffer was not completely wiped with zeroes!"
    assert len(unsealed) == 0, "Secrets dictionary was not cleared during zero_memory!"


# ==============================================================================
# 2. Private Model Registry API & Tenant Isolation Tests
# ==============================================================================

def test_private_model_registry_crud_scoping(client, tenant_users):
    """
    Verify Private Model Registry API:
    - POST /api/v1/models/private registers model for Tenant A
    - GET /api/v1/models/private returns Tenant A's models
    - Tenant B listing returns empty list (tenant isolation)
    - Tenant B deleting Tenant A's model returns 404
    - Tenant A deleting model deactivates it cleanly
    """
    headers_a = tenant_users["headers_a"]
    headers_b = tenant_users["headers_b"]

    # 1. Tenant A registers private model
    reg_resp = client.post(
        "/api/v1/models/private",
        headers=headers_a,
        json={
            "name": "Custom-Fin-Llama-7B",
            "source_type": "byos_s3",
            "source_uri": "s3://corp-private-models/weights/llama-7b-v1/",
            "base_model_ref": "meta-llama/Llama-3.1-8B",
            "param_count_b": 8.0,
            "artifact_format": "safetensors",
            "encryption_alg": "aes-256-gcm",
            "metadata_json": {"author": "Finance Dept", "domain": "sec-filings"},
        },
    )
    assert reg_resp.status_code == 201
    model_data = reg_resp.json()
    model_id = model_data["id"]
    assert model_id.startswith("pm-")
    assert model_data["name"] == "Custom-Fin-Llama-7B"
    assert model_data["user_id"] == tenant_users["tenant_a"].id
    assert model_data["is_active"] is True

    # 2. Tenant A lists private models -> sees model
    list_a = client.get("/api/v1/models/private", headers=headers_a)
    assert list_a.status_code == 200
    ids_a = [m["id"] for m in list_a.json()]
    assert model_id in ids_a

    # 3. Tenant B lists private models -> 0 models (isolated)
    list_b = client.get("/api/v1/models/private", headers=headers_b)
    assert list_b.status_code == 200
    ids_b = [m["id"] for m in list_b.json()]
    assert model_id not in ids_b

    # 4. Tenant B attempts to delete Tenant A's model -> 404 Not Found
    del_b = client.delete(f"/api/v1/models/private/{model_id}", headers=headers_b)
    assert del_b.status_code == 404

    # 5. Tenant A deletes model -> 200 OK
    del_a = client.delete(f"/api/v1/models/private/{model_id}", headers=headers_a)
    assert del_a.status_code == 200
    assert del_a.json()["status"] == "deleted"

    # 6. Tenant A lists again -> model is deactivated, not in list
    list_a_after = client.get("/api/v1/models/private", headers=headers_a)
    assert list_a_after.status_code == 200
    ids_after = [m["id"] for m in list_a_after.json()]
    assert model_id not in ids_after


def test_worker_pubkey_endpoint(client, tenant_users):
    """
    Verify GET /api/v1/workers/{worker_id}/pubkey returns worker's ephemeral X25519 public key
    and capability flags, and returns 404 for unknown workers.
    """
    worker_id = f"worker-pubkey-test-{uuid.uuid4().hex[:8]}"
    runtime = _WorkerGpuRuntime()
    pubkey = runtime.tunnel_pubkey_x25519

    # Register worker with ephemeral pubkey and flags
    reg = client.post(
        "/api/v1/workers/register",
        headers=tenant_users["headers_a"],
        json={
            "worker_id": worker_id,
            "name": "GPU Node With Sealed Env Support",
            "gpu_info": "NVIDIA RTX 4090",
            "gpu_memory_gb": 24.0,
            "vram_allocation_pct": 85,
            "tunnel_pubkey_x25519": pubkey,
            "supports_sealed_env": True,
            "supports_zero_disk_shm": True,
            "tee_attestation_type": "none",
            "gpu_count": 1,
            "collective_vram_gb": 24.0,
            "largest_single_gpu_gb": 24.0,
        },
    )
    assert reg.status_code == 200

    # Query pubkey endpoint
    res = client.get(f"/api/v1/workers/{worker_id}/pubkey")
    assert res.status_code == 200
    data = res.json()
    assert data["worker_id"] == worker_id
    assert data["tunnel_pubkey_x25519"] == pubkey
    assert data["supports_sealed_env"] is True
    assert data["supports_zero_disk_shm"] is True
    assert data["collective_vram_gb"] == 24.0

    # Unknown worker returns 404
    missing_res = client.get(f"/api/v1/workers/non-existent-worker-999/pubkey")
    assert missing_res.status_code == 404


# ==============================================================================
# 3. In-Memory WebSocket Streaming Relay Tests
# ==============================================================================

def test_in_memory_websocket_streaming_relay(client, db_session, tenant_users):
    """
    Verify duplex in-memory chunk streaming relay (/ws/client/stream/{job_id}):
    - Connects client and worker to same job_id channel in memory
    - Relays binary chunk from client to worker with 0 bytes written to disk/MinIO
    - Responds to keepalive ping with pong
    """
    job_id = f"job-stream-{uuid.uuid4().hex[:8]}"
    t_a = tenant_users["tenant_a"]

    # Seed training job record
    job = TrainingJob(
        id=job_id,
        user_id=t_a.id,
        name="Zero-Storage Stream Job",
        base_model="Qwen/Qwen2.5-0.5B-Instruct",
        train_type="lora",
        data_source_type="tunnel_stream",
        storage_retention="zero_retention",
        status="running",
    )
    db_session.add(job)
    db_session.commit()

    # Connect client and worker WebSockets
    with client.websocket_connect(f"/ws/client/stream/{job_id}?role=client&api_key={t_a.api_key}") as ws_client:
        ready_client = ws_client.receive_json()
        assert ready_client["type"] == "stream_ready"
        assert ready_client["job_id"] == job_id
        assert ready_client["storage_mode"] == "zero_retention_in_memory"

        with client.websocket_connect(f"/ws/client/stream/{job_id}?role=worker") as ws_worker:
            ready_worker = ws_worker.receive_json()
            assert ready_worker["type"] == "stream_ready"

            # Client streams binary chunk -> Worker receives binary chunk in RAM
            test_chunk = b"\x1f\x8b\x08\x00_ENCRYPTED_STREAM_CHUNK_DATA_"
            ws_client.send_bytes(test_chunk)
            received_bytes = ws_worker.receive_bytes()
            assert received_bytes == test_chunk

            # Worker streams progress/adapter text chunk -> Client receives
            ws_worker.send_text(json.dumps({"type": "chunk_ack", "received": len(test_chunk)}))
            received_text = ws_client.receive_text()
            assert json.loads(received_text)["type"] == "chunk_ack"

            # Keepalive ping/pong
            ws_client.send_text("ping")
            assert ws_client.receive_text() == "pong"


# ==============================================================================
# 4. Universal Material Format Parser Tests
# ==============================================================================

def test_universal_parser_jsonl_alpaca():
    """Verify .jsonl parsing for standard Alpaca instruction-response format."""
    alpaca_data = (
        '{"instruction": "Define zero-storage computing.", "input": "", "output": "Computing without server persistence."}\n'
        '{"instruction": "What is X25519?", "input": "", "output": "An elliptic curve for ECDH key agreement."}\n'
    )
    records = parse_universal_dataset(alpaca_data, format_hint=".jsonl")
    assert len(records) == 2
    assert records[0]["instruction"] == "Define zero-storage computing."
    assert "without server persistence" in records[0]["response"]


def test_universal_parser_jsonl_chatml_and_messages():
    """Verify .jsonl parsing for OpenAI messages and ChatML role format."""
    chatml_data = (
        '{"messages": [{"role": "user", "content": "Hello AI"}, {"role": "assistant", "content": "Hello user!"}]}\n'
        '{"messages": [{"role": "system", "content": "You are a helper."}, {"role": "user", "content": "Tell me a joke."}, {"role": "assistant", "content": "Why did the GPU cross the road?"}]}\n'
    )
    records = parse_universal_dataset(chatml_data, format_hint=".jsonl")
    assert len(records) == 2
    assert records[0]["instruction"] == "Hello AI"
    assert records[0]["response"] == "Hello user!"


def test_universal_parser_jsonl_sharegpt():
    """Verify .jsonl parsing for ShareGPT conversation schema."""
    sharegpt_data = (
        '{"conversations": [{"from": "human", "value": "How do sealed envelopes work?"}, {"from": "gpt", "value": "Via X25519 ECDH and AES-GCM."}]}\n'
    )
    records = parse_universal_dataset(sharegpt_data, format_hint=".jsonl")
    assert len(records) == 1
    assert "sealed envelopes" in records[0]["instruction"]
    assert "AES-GCM" in records[0]["response"]


def test_universal_parser_jsonl_dpo():
    """Verify .jsonl parsing for Direct Preference Optimization (DPO) prompt/chosen pairs."""
    dpo_data = (
        '{"prompt": "Write secure code.", "chosen": "Use AES-GCM with authentication tag.", "rejected": "Use plaintext."}\n'
    )
    records = parse_universal_dataset(dpo_data, format_hint=".jsonl")
    assert len(records) == 1
    assert records[0]["instruction"] == "Write secure code."
    assert "AES-GCM" in records[0]["response"]


def test_universal_parser_json():
    """Verify .json parsing for list of objects and nested datasets."""
    json_list = [
        {"instruction": "Question 1", "response": "Answer 1"},
        {"prompt": "Question 2", "completion": "Answer 2"},
    ]
    records = parse_universal_dataset(json.dumps(json_list), format_hint=".json")
    assert len(records) == 2
    assert records[0]["instruction"] == "Question 1"
    assert records[1]["response"] == "Answer 2"


def test_universal_parser_csv():
    """Verify .csv tabular training dataset parsing."""
    csv_content = "instruction,response\nWhat is QLoRA?,4-bit quantized Low-Rank Adaptation.\nWhat is DiLoCo?,Distributed Low-Communication training.\n"
    records = parse_universal_dataset(csv_content, format_hint=".csv")
    assert len(records) == 2
    assert records[0]["instruction"] == "What is QLoRA?"
    assert "4-bit" in records[0]["response"]


def test_universal_parser_parquet():
    """Verify .parquet columnar dataset parsing via pyarrow or pandas."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pa.table({
        "instruction": ["Parquet query 1", "Parquet query 2"],
        "response": ["Parquet output 1", "Parquet output 2"],
    })
    sink = io.BytesIO()
    pq.write_table(table, sink)
    parquet_bytes = sink.getvalue()

    records = parse_universal_dataset(parquet_bytes, format_hint=".parquet")
    assert len(records) == 2
    assert records[0]["instruction"] == "Parquet query 1"
    assert records[1]["response"] == "Parquet output 2"


def test_universal_parser_txt_and_md():
    """Verify sliding-window chunking for unstructured .txt and .md files."""
    text_content = "Project NetworkNebula provides zero-storage AI compute mesh. " * 30
    records_txt = parse_universal_dataset(text_content, format_hint=".txt")
    assert len(records_txt) >= 1
    assert "instruction" in records_txt[0] and "response" in records_txt[0]

    md_content = "# NetworkNebula Architecture\n\nTenants upload encrypted data directly to GPU workers.\n" * 20
    records_md = parse_universal_dataset(md_content, format_hint=".md")
    assert len(records_md) >= 1


def test_universal_parser_pdf():
    """Verify .pdf extraction and tokenization using reportlab and pypdf."""
    import reportlab.pdfgen.canvas as canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(50, 700, "NetworkNebula confidential technical specification for zero-storage ML training data plane.")
    c.save()

    records = parse_universal_dataset(buf.getvalue(), format_hint=".pdf")
    assert len(records) >= 1
    assert "confidential" in records[0]["instruction"] or "confidential" in records[0]["response"]


def test_universal_parser_docx():
    """Verify .docx extraction and tokenization via zipfile XML structure."""
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w") as zf:
        zf.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            "<w:body><w:p><w:t>Project NetworkNebula DOCX training paragraph demonstrating universal format ingestion.</w:t></w:p></w:body>"
            "</w:document>",
        )
    records = parse_universal_dataset(bio.getvalue(), format_hint=".docx")
    assert len(records) >= 1
    assert "DOCX" in records[0]["instruction"] or "DOCX" in records[0]["response"]


# ==============================================================================
# 5. File Synchronization Verification (Requirement R3)
# ==============================================================================

def test_worker_files_byte_identical_requirement_r3():
    """Requirement R3: Verify worker/nebula_worker.py and root nebula_worker.py are 100% byte-identical."""
    worker_path = os.path.join("worker", "nebula_worker.py")
    root_path = "nebula_worker.py"

    assert os.path.exists(worker_path), "worker/nebula_worker.py must exist"
    assert os.path.exists(root_path), "nebula_worker.py must exist"

    with open(worker_path, "rb") as f1, open(root_path, "rb") as f2:
        b1 = f1.read()
        b2 = f2.read()

    assert len(b1) == len(b2), f"File lengths differ: {len(b1)} vs {len(b2)}"
    assert hashlib.sha256(b1).hexdigest() == hashlib.sha256(b2).hexdigest(), (
        "worker/nebula_worker.py and root nebula_worker.py are not byte-identical!"
    )
