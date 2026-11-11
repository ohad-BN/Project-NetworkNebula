"""
Multi-Tenant Security Lockdown Verification Suite (Milestone 1 / Phase 1)
Tests AUD-01 through AUD-08 multi-tenant security boundaries and fail-closed behaviors.
"""

import os
import json
import uuid
from typing import Generator
import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.database import SessionLocal
from app.models import (
    User,
    Worker,
    TrainingJob,
    InferenceEndpoint,
    Task,
    TaskStatus,
)
from app.cluster_worker_router import worker_tunnel_manager
from app.storage import StorageClient


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
    """Create two isolated active tenant users and an admin user."""
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]
    suffix_admin = uuid.uuid4().hex[:8]

    tenant_a = User(
        id=f"tenant-a-{suffix_a}",
        email=f"tenant_a_{suffix_a}@example.com",
        api_key=f"nebula_key_a_{suffix_a}",
        api_secret=f"nebula_secret_a_{suffix_a}",
        name="Tenant A",
        is_active=True,
        is_admin=False,
    )
    tenant_b = User(
        id=f"tenant-b-{suffix_b}",
        email=f"tenant_b_{suffix_b}@example.com",
        api_key=f"nebula_key_b_{suffix_b}",
        api_secret=f"nebula_secret_b_{suffix_b}",
        name="Tenant B",
        is_active=True,
        is_admin=False,
    )
    admin_user = User(
        id=f"admin-{suffix_admin}",
        email=f"admin_{suffix_admin}@example.com",
        api_key=f"nebula_key_admin_{suffix_admin}",
        api_secret=f"nebula_secret_admin_{suffix_admin}",
        name="Admin User",
        is_active=True,
        is_admin=True,
    )

    db_session.add_all([tenant_a, tenant_b, admin_user])
    db_session.commit()
    db_session.refresh(tenant_a)
    db_session.refresh(tenant_b)
    db_session.refresh(admin_user)

    yield {
        "tenant_a": tenant_a,
        "tenant_b": tenant_b,
        "admin": admin_user,
        "headers_a": {"X-API-Key": tenant_a.api_key, "X-API-Secret": tenant_a.api_secret},
        "bearer_a": {"Authorization": f"Bearer {tenant_a.api_key}"},
        "headers_b": {"X-API-Key": tenant_b.api_key, "X-API-Secret": tenant_b.api_secret},
        "bearer_b": {"Authorization": f"Bearer {tenant_b.api_key}"},
        "headers_admin": {"X-API-Key": admin_user.api_key, "X-API-Secret": admin_user.api_secret},
    }

    # Teardown
    cleanup_session = SessionLocal()
    try:
        cleanup_session.query(Task).filter(Task.user_id.in_([tenant_a.id, tenant_b.id, admin_user.id])).delete(synchronize_session=False)
        cleanup_session.query(TrainingJob).filter(TrainingJob.user_id.in_([tenant_a.id, tenant_b.id, admin_user.id])).delete(synchronize_session=False)
        cleanup_session.query(InferenceEndpoint).filter(InferenceEndpoint.user_id.in_([tenant_a.id, tenant_b.id, admin_user.id])).delete(synchronize_session=False)
        cleanup_session.query(Worker).filter(Worker.user_id.in_([tenant_a.id, tenant_b.id, admin_user.id])).delete(synchronize_session=False)
        cleanup_session.query(User).filter(User.id.in_([tenant_a.id, tenant_b.id, admin_user.id])).delete(synchronize_session=False)
        cleanup_session.commit()
    finally:
        cleanup_session.close()


# ==============================================================================
# AUD-01: Unauthenticated User-Agent Backdoor Lockdown
# ==============================================================================

def test_aud01_unauthenticated_test_ua_backdoor_disabled_by_default(client, tenant_users):
    """
    AUD-01: When unauthenticated test UA fallback is not explicitly enabled,
    requests containing 'python-requests', 'pytest', or 'curl' in User-Agent MUST fail with 401.
    """
    saved_env = os.environ.get("ALLOW_UNAUTHENTICATED_TEST_UA")
    saved_app_env = os.environ.get("APP_ENV")
    try:
        os.environ.pop("ALLOW_UNAUTHENTICATED_TEST_UA", None)
        os.environ["APP_ENV"] = "production"

        for ua in ["python-requests/2.28.1", "pytest/7.2.0", "curl/7.88.1"]:
            resp = client.get("/api/v1/training/jobs", headers={"User-Agent": ua})
            assert resp.status_code == 401, f"Expected 401 for UA '{ua}' without auth in production, got {resp.status_code}"
            assert "authentication required" in resp.json().get("detail", "").lower()
    finally:
        if saved_env is not None:
            os.environ["ALLOW_UNAUTHENTICATED_TEST_UA"] = saved_env
        else:
            os.environ.pop("ALLOW_UNAUTHENTICATED_TEST_UA", None)
        if saved_app_env is not None:
            os.environ["APP_ENV"] = saved_app_env
        else:
            os.environ.pop("APP_ENV", None)


def test_aud01_unauthenticated_test_ua_production_fail_closed(client, tenant_users):
    """
    AUD-01: Even if ALLOW_UNAUTHENTICATED_TEST_UA == 'true', when APP_ENV == 'production',
    the test backdoor MUST remain strictly disabled and reject with 401.
    """
    saved_env = os.environ.get("ALLOW_UNAUTHENTICATED_TEST_UA")
    saved_app_env = os.environ.get("APP_ENV")
    try:
        os.environ["ALLOW_UNAUTHENTICATED_TEST_UA"] = "true"
        os.environ["APP_ENV"] = "production"

        resp = client.get("/api/v1/training/jobs", headers={"User-Agent": "python-requests/2.31.0"})
        assert resp.status_code == 401, f"Expected 401 in production env even with ALLOW_UNAUTHENTICATED_TEST_UA=true, got {resp.status_code}"
    finally:
        if saved_env is not None:
            os.environ["ALLOW_UNAUTHENTICATED_TEST_UA"] = saved_env
        else:
            os.environ.pop("ALLOW_UNAUTHENTICATED_TEST_UA", None)
        if saved_app_env is not None:
            os.environ["APP_ENV"] = saved_app_env
        else:
            os.environ.pop("APP_ENV", None)


def test_aud01_authenticated_requests_succeed(client, tenant_users):
    """
    AUD-01: Authenticated enterprise requests (Bearer token or X-API-Key) work seamlessly.
    """
    resp_bearer = client.get("/api/v1/training/jobs", headers=tenant_users["bearer_a"])
    assert resp_bearer.status_code == 200

    resp_headers = client.get("/api/v1/training/jobs", headers=tenant_users["headers_a"])
    assert resp_headers.status_code == 200


# ==============================================================================
# AUD-02: MinIO Bucket Policy Removal & Nginx Proxy Lockdown
# ==============================================================================

def test_aud02_storage_bucket_policies_lockdown():
    """
    AUD-02: Private training buckets (nebula-datasets, nebula-checkpoints, nebula-models)
    must NEVER be assigned public-read bucket policies with 'Principal': '*'.
    """
    class DummyS3Client:
        def __init__(self):
            self.applied_policies = {}
            self.deleted_policies = []

        def head_bucket(self, Bucket):
            return {}

        def create_bucket(self, Bucket):
            return {}

        def put_bucket_policy(self, Bucket, Policy):
            self.applied_policies[Bucket] = Policy

        def delete_bucket_policy(self, Bucket):
            self.deleted_policies.append(Bucket)

    dummy = DummyS3Client()
    storage_inst = StorageClient("http://mock:9000", "minio", "minio123", "nebula-renders")
    storage_inst.s3 = dummy

    # Ensure all enterprise buckets
    buckets = storage_inst.ensure_all_enterprise_buckets_exist()
    assert "nebula-datasets" in buckets
    assert "nebula-checkpoints" in buckets
    assert "nebula-models" in buckets

    # Check that public-read policy was NOT applied to private buckets
    for private_b in ["nebula-datasets", "nebula-checkpoints", "nebula-models"]:
        assert private_b not in dummy.applied_policies, f"Private bucket '{private_b}' was incorrectly assigned a public policy!"
        assert private_b in dummy.deleted_policies, f"Private bucket '{private_b}' did not enforce policy deletion!"

    # nebula-renders may have public read policy
    if "nebula-renders" in dummy.applied_policies:
        assert "PublicReadGetObject" in dummy.applied_policies["nebula-renders"]


def test_aud02_nginx_configuration_lockdown():
    """
    AUD-02: Verify network-nebula/nginx.conf does NOT proxy nebula-datasets,
    nebula-checkpoints, or nebula-models publicly.
    """
    nginx_path = os.path.join(os.getcwd(), "network-nebula", "nginx.conf")
    assert os.path.exists(nginx_path), f"nginx.conf not found at {nginx_path}"
    with open(nginx_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Must NOT proxy private buckets to minio publicly
    assert "nebula-datasets" not in content, "nebula-datasets found exposed in nginx.conf!"
    assert "nebula-checkpoints" not in content, "nebula-checkpoints found exposed in nginx.conf!"
    assert "nebula-models" not in content, "nebula-models found exposed in nginx.conf!"

    # nebula-renders remains accessible
    assert "nebula-renders" in content, "nebula-renders should remain configured in nginx.conf"


# ==============================================================================
# AUD-03: Training Endpoints Tenant Scoping
# ==============================================================================

def test_aud03_training_endpoint_tenant_isolation(client, db_session, tenant_users):
    """
    AUD-03: Enforce TrainingJob.user_id == current_user.id on:
    - GET /distributed/jobs/{job_id}/shards
    - GET /jobs/{job_id}
    - GET /jobs/{job_id}/checkpoints
    - POST /jobs/{job_id}/cancel
    Cross-tenant queries MUST return 404 Not Found.
    """
    t_a = tenant_users["tenant_a"]
    t_b = tenant_users["tenant_b"]

    job_a = TrainingJob(
        id=f"train-job-a-{uuid.uuid4().hex[:8]}",
        user_id=t_a.id,
        name="Tenant A Fine-Tune",
        base_model="Qwen/Qwen2.5-0.5B-Instruct",
        train_type="lora",
        status="running",
        dataset_s3_url="s3://nebula-datasets/private_a.jsonl",
        hyperparameters=json.dumps({"worker_ids": ["worker-1"]}),
        checkpoints=json.dumps([{"epoch": 1, "s3_url": "s3://nebula-checkpoints/epoch_1"}]),
    )
    db_session.add(job_a)
    db_session.commit()

    # 1. Tenant B querying Tenant A's job status -> 404 Not Found
    resp_b_job = client.get(f"/api/v1/training/jobs/{job_a.id}", headers=tenant_users["headers_b"])
    assert resp_b_job.status_code == 404, f"Expected 404 for cross-tenant job get, got {resp_b_job.status_code}"

    # 2. Tenant B querying Tenant A's shards -> 404 Not Found
    resp_b_shards = client.get(f"/api/v1/training/distributed/jobs/{job_a.id}/shards", headers=tenant_users["headers_b"])
    assert resp_b_shards.status_code == 404, f"Expected 404 for cross-tenant shards get, got {resp_b_shards.status_code}"

    # 3. Tenant B querying Tenant A's checkpoints -> 404 Not Found
    resp_b_ckpts = client.get(f"/api/v1/training/jobs/{job_a.id}/checkpoints", headers=tenant_users["headers_b"])
    assert resp_b_ckpts.status_code == 404, f"Expected 404 for cross-tenant checkpoints get, got {resp_b_ckpts.status_code}"

    # 4. Tenant B attempting to cancel Tenant A's job -> 404 Not Found
    resp_b_cancel = client.post(f"/api/v1/training/jobs/{job_a.id}/cancel", headers=tenant_users["headers_b"])
    assert resp_b_cancel.status_code == 404, f"Expected 404 for cross-tenant job cancellation, got {resp_b_cancel.status_code}"

    # Verify job is still running (cancellation did not affect it)
    db_session.refresh(job_a)
    assert job_a.status == "running"

    # 5. Tenant A querying their own job -> 200 OK
    resp_a_job = client.get(f"/api/v1/training/jobs/{job_a.id}", headers=tenant_users["headers_a"])
    assert resp_a_job.status_code == 200
    assert resp_a_job.json()["id"] == job_a.id

    resp_a_shards = client.get(f"/api/v1/training/distributed/jobs/{job_a.id}/shards", headers=tenant_users["headers_a"])
    assert resp_a_shards.status_code == 200

    resp_a_ckpts = client.get(f"/api/v1/training/jobs/{job_a.id}/checkpoints", headers=tenant_users["headers_a"])
    assert resp_a_ckpts.status_code == 200
    assert len(resp_a_ckpts.json()) == 1

    # 6. Tenant A cancelling their own job -> 200 OK
    resp_a_cancel = client.post(f"/api/v1/training/jobs/{job_a.id}/cancel", headers=tenant_users["headers_a"])
    assert resp_a_cancel.status_code == 200
    assert resp_a_cancel.json()["status"] == "cancelled"


# ==============================================================================
# AUD-04: Inference Model & Adapter Ownership Resolution
# ==============================================================================

def test_aud04_inference_model_and_adapter_isolation(client, db_session, tenant_users):
    """
    AUD-04: In _resolve_user_model_and_adapter, InferenceEndpoint, PrivateModel,
    and ft: jobs must match user_id == current_user.id.
    Cross-tenant chat completions, benchmarks, and comparisons MUST return 404 Not Found.
    """
    t_a = tenant_users["tenant_a"]
    t_b = tenant_users["tenant_b"]

    # Tenant A owns a private endpoint
    ep_name_a = f"tenant-a-ep-{uuid.uuid4().hex[:6]}"
    ep_a = InferenceEndpoint(
        id=str(uuid.uuid4()),
        user_id=t_a.id,
        name=ep_name_a,
        model_id="Qwen/Qwen2.5-0.5B-Instruct",
        adapter_url=f"s3://nebula-checkpoints/{ep_name_a}/adapter_model.safetensors",
        status="ready",
    )
    # Tenant A owns a completed fine-tuning job with adapter
    job_id_a = f"job-a-{uuid.uuid4().hex[:8]}"
    ft_job_a = TrainingJob(
        id=job_id_a,
        user_id=t_a.id,
        name=f"ft_name_{job_id_a[:8]}",
        base_model="Qwen/Qwen2.5-0.5B-Instruct",
        dataset_s3_url="s3://nebula-datasets/sample.jsonl",
        status="completed",
        final_adapter_url=f"s3://nebula-checkpoints/{job_id_a}/adapter_model.safetensors",
    )
    db_session.add_all([ep_a, ft_job_a])
    db_session.commit()

    # 1. Tenant B calls chat completions using Tenant A's private endpoint name -> 404
    resp_chat = client.post(
        "/v1/chat/completions",
        headers=tenant_users["headers_b"],
        json={"model": ep_name_a, "messages": [{"role": "user", "content": "hi"}]},
    )
    assert resp_chat.status_code == 404, f"Expected 404 for cross-tenant chat completion, got {resp_chat.status_code}"

    # 2. Tenant B calls chat completions using Tenant A's ft: model -> 404
    resp_ft = client.post(
        "/v1/chat/completions",
        headers=tenant_users["headers_b"],
        json={"model": f"ft:{job_id_a}", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert resp_ft.status_code == 404, f"Expected 404 for cross-tenant ft: completion, got {resp_ft.status_code}"

    # 3. Tenant B attempts to benchmark Tenant A's private endpoint -> 404
    resp_bm = client.post(
        "/api/v1/models/benchmark",
        headers=tenant_users["headers_b"],
        json={"model_id": ep_name_a, "max_tokens": 16},
    )
    assert resp_bm.status_code == 404, f"Expected 404 for cross-tenant benchmark, got {resp_bm.status_code}"

    # 4. Tenant B attempts to benchmark with Tenant A's proprietary adapter URL -> 404
    resp_bm_url = client.post(
        "/api/v1/models/benchmark",
        headers=tenant_users["headers_b"],
        json={"model_id": "Qwen/Qwen2.5-0.5B-Instruct", "adapter_url": ep_a.adapter_url},
    )
    assert resp_bm_url.status_code == 404, f"Expected 404 for cross-tenant benchmark adapter_url, got {resp_bm_url.status_code}"

    # 5. Tenant B attempts side-by-side comparison probing Tenant A's model -> 404
    resp_cmp = client.post(
        "/api/v1/models/compare",
        headers=tenant_users["headers_b"],
        json={
            "prompt": "Evaluate this",
            "model_a": "Qwen/Qwen2.5-0.5B-Instruct",
            "model_b": ep_name_a,
        },
    )
    assert resp_cmp.status_code == 404, f"Expected 404 for cross-tenant side-by-side comparison, got {resp_cmp.status_code}"


# ==============================================================================
# AUD-05: Worker Registration & WebSocket Tunnel Pre-Auth
# ==============================================================================

def test_aud05_worker_registration_hijack_prevention(client, db_session, tenant_users):
    """
    AUD-05: When worker node is already registered to Tenant A,
    Tenant B attempting to register the same worker_id MUST be rejected with HTTP 403 Forbidden.
    """
    t_a = tenant_users["tenant_a"]
    t_b = tenant_users["tenant_b"]
    worker_id = f"worker-shared-{uuid.uuid4().hex[:8]}"

    # Tenant A registers worker
    reg_a = client.post(
        "/api/v1/workers/register",
        headers=tenant_users["headers_a"],
        json={
            "worker_id": worker_id,
            "name": "Node A",
            "gpu_info": "NVIDIA RTX 4090",
            "gpu_memory_gb": 24.0,
            "vram_allocation_pct": 80,
        },
    )
    assert reg_a.status_code == 200
    assert reg_a.json()["worker_id"] == worker_id

    # Verify bound to Tenant A in DB
    w_record = db_session.query(Worker).filter(Worker.id == worker_id).first()
    assert w_record is not None
    assert w_record.user_id == t_a.id

    # Tenant B attempts to register the same worker_id -> 403 Forbidden
    reg_b = client.post(
        "/api/v1/workers/register",
        headers=tenant_users["headers_b"],
        json={
            "worker_id": worker_id,
            "name": "Node Hijacked",
            "gpu_info": "NVIDIA RTX 4090",
            "gpu_memory_gb": 24.0,
            "vram_allocation_pct": 80,
        },
    )
    assert reg_b.status_code == 403, f"Expected 403 Forbidden on registration hijack, got {reg_b.status_code}"
    assert "registered to another account" in reg_b.json().get("detail", "").lower()

    # Verify ownership did not change
    db_session.refresh(w_record)
    assert w_record.user_id == t_a.id


def test_aud05_websocket_tunnel_pre_auth_and_code_4403(client, db_session, tenant_users):
    """
    AUD-05: In websocket_worker_tunnel, authenticate API key and verify worker.user_id == user.id
    BEFORE calling worker_tunnel_manager.connect.
    Close WebSocket with code 4403 on auth failure.
    """
    t_a = tenant_users["tenant_a"]
    t_b = tenant_users["tenant_b"]
    worker_id = f"worker-tunnel-test-{uuid.uuid4().hex[:8]}"

    # Register worker to Tenant A
    worker = Worker(
        id=worker_id,
        user_id=t_a.id,
        name="Tunnel Worker A",
        status="offline",
        is_available=True,
    )
    db_session.add(worker)
    db_session.commit()

    # 1. Unauthenticated connection attempt -> closed with 4403
    with pytest.raises(WebSocketDisconnect) as exc_unauth:
        with client.websocket_connect(f"/ws/worker/{worker_id}"):
            pass
    assert exc_unauth.value.code == 4403, f"Expected close code 4403 for unauthenticated tunnel, got {exc_unauth.value.code}"
    assert not worker_tunnel_manager.is_connected(worker_id)

    # 2. Cross-tenant connection attempt (Tenant B attempting to connect Tenant A's worker) -> 4403
    with pytest.raises(WebSocketDisconnect) as exc_cross:
        with client.websocket_connect(f"/ws/worker/{worker_id}?api_key={t_b.api_key}"):
            pass
    assert exc_cross.value.code == 4403, f"Expected close code 4403 for cross-tenant tunnel, got {exc_cross.value.code}"
    assert not worker_tunnel_manager.is_connected(worker_id)

    # Verify worker.user_id was NOT hijacked
    db_session.refresh(worker)
    assert worker.user_id == t_a.id

    # 3. Valid owner connects successfully -> receives init frame
    with client.websocket_connect(f"/ws/worker/{worker_id}?api_key={t_a.api_key}") as ws:
        init_frame = ws.receive_json()
        assert init_frame["type"] == "init"
        assert init_frame["worker_id"] == worker_id
        assert init_frame["authenticated"] is True
        assert worker_tunnel_manager.is_connected(worker_id)


# ==============================================================================
# AUD-06: Scoped Worker Artifact Access & Lease Check
# ==============================================================================

def test_aud06_worker_artifact_access_null_user_and_lease_check(client, db_session, tenant_users):
    """
    AUD-06:
    - Require non-null worker.user_id in _verify_worker_artifact_access.
    - In get_worker_adapter_bundle, verify worker holds active dispatch lease or ownership before serving weights.
    """
    t_a = tenant_users["tenant_a"]
    t_b = tenant_users["tenant_b"]

    worker_null_id = f"worker-null-{uuid.uuid4().hex[:8]}"
    worker_null = Worker(id=worker_null_id, user_id=None, name="Orphan Worker", status="online")

    worker_b_id = f"worker-b-{uuid.uuid4().hex[:8]}"
    worker_b = Worker(id=worker_b_id, user_id=t_b.id, name="Worker B", status="online")

    # Tenant A owns an adapter
    adapter_url = f"s3://nebula-checkpoints/tenant_a_job/adapter_model.safetensors"
    job_a = TrainingJob(
        id=f"job-art-{uuid.uuid4().hex[:8]}",
        user_id=t_a.id,
        name="Artifact Test Job",
        base_model="Qwen/Qwen2.5-0.5B-Instruct",
        dataset_s3_url="s3://nebula-datasets/sample.jsonl",
        final_adapter_url=adapter_url,
    )
    db_session.add_all([worker_null, worker_b, job_a])
    db_session.commit()

    # 1. Worker with null user_id requesting adapter bundle -> 403 Forbidden
    resp_null = client.get(
        f"/api/v1/workers/{worker_null_id}/adapter-bundle?adapter_url={adapter_url}",
        headers={"X-API-Key": "some-key"},
    )
    assert resp_null.status_code == 403, f"Expected 403 for worker with null user_id, got {resp_null.status_code}"

    # 2. Worker B (owned by Tenant B) requesting Tenant A's adapter without lease -> 403 Forbidden
    resp_unleased = client.get(
        f"/api/v1/workers/{worker_b_id}/adapter-bundle?adapter_url={adapter_url}",
        headers={"X-API-Key": t_b.api_key},
    )
    assert resp_unleased.status_code == 403, f"Expected 403 for unleased adapter bundle request, got {resp_unleased.status_code}"
    assert "lease or ownership" in resp_unleased.json().get("detail", "").lower()


# ==============================================================================
# AUD-07: Strict Owner Node Routing Fail-Closed
# ==============================================================================

def test_aud07_strict_owner_node_fail_closed(db_session, tenant_users):
    """
    AUD-07: In select_online_inference_worker, enforce strict_owner_user_id
    when privacy_mode == 'strict_owner_nodes', failing closed (returns None) without third-party fallback.
    """
    t_a = tenant_users["tenant_a"]
    t_b = tenant_users["tenant_b"]

    worker_a_id = f"worker-owner-a-{uuid.uuid4().hex[:8]}"
    worker_b_id = f"worker-third-b-{uuid.uuid4().hex[:8]}"

    # Worker A (owned by Tenant A)
    worker_a = Worker(
        id=worker_a_id,
        user_id=t_a.id,
        name="Owner A Worker",
        status="online",
        is_available=True,
        gpu_memory_gb=24.0,
        vram_allocation_pct=80,
    )
    # Worker B (owned by Tenant B, third-party)
    worker_b = Worker(
        id=worker_b_id,
        user_id=t_b.id,
        name="Third-party Worker B",
        status="online",
        is_available=True,
        gpu_memory_gb=24.0,
        vram_allocation_pct=80,
    )
    db_session.add_all([worker_a, worker_b])
    db_session.commit()

    # Simulate: Only Worker B (third-party) has active connected tunnel
    worker_tunnel_manager.active_tunnels[worker_b_id] = object()  # mock connection
    worker_tunnel_manager.worker_v2[worker_b_id] = True
    worker_tunnel_manager.active_tunnels.pop(worker_a_id, None)  # Owner A is offline

    try:
        # Case 1: Strict owner privacy mode requested for Tenant A
        # Must FAIL CLOSED (return None) and NEVER fall back to Tenant B's worker
        selected = worker_tunnel_manager.select_online_inference_worker(
            db=db_session,
            model_id="Qwen/Qwen2.5-0.5B-Instruct",
            preferred_user_id=t_a.id,
            privacy_mode="strict_owner_nodes",
            strict_owner_user_id=t_a.id,
        )
        assert selected is None, f"Strict owner mode must return None when owner node is offline, but selected {selected}!"

        # Case 2: Public / fallback mode allows Worker B
        selected_public = worker_tunnel_manager.select_online_inference_worker(
            db=db_session,
            model_id="Qwen/Qwen2.5-0.5B-Instruct",
            preferred_user_id=t_a.id,
            privacy_mode="mesh_shared",
        )
        assert selected_public == worker_b_id, f"Shared mode should select online Worker B, got {selected_public}"
    finally:
        worker_tunnel_manager.active_tunnels.pop(worker_b_id, None)
        worker_tunnel_manager.worker_v2.pop(worker_b_id, None)


# ==============================================================================
# AUD-08: Task Status Auth & Public Telemetry Sanitization
# ==============================================================================

def test_aud08_task_status_authentication_and_tenant_isolation(client, db_session, tenant_users):
    """
    AUD-08:
    - Require authentication on GET /api/tasks/{task_id}
    - Verify task.user_id == user.id (returns 404 on cross-tenant access)
    """
    t_a = tenant_users["tenant_a"]
    t_b = tenant_users["tenant_b"]
    t_admin = tenant_users["admin"]

    task_id = f"task-{uuid.uuid4().hex[:12]}"
    task = Task(
        task_id=task_id,
        user_id=t_a.id,
        prompt="A top-secret enterprise fine-tuning diagram",
        status=TaskStatus.SUCCESS,
        output_url="https://storage.nebula.internal/secret-render.png",
        progress=100,
        cost=0.05,
    )
    db_session.add(task)
    db_session.commit()

    # 1. Unauthenticated request to GET /api/tasks/{task_id} -> 401 Unauthorized
    resp_unauth = client.get(f"/api/tasks/{task_id}")
    assert resp_unauth.status_code == 401, f"Expected 401 for unauthenticated task access, got {resp_unauth.status_code}"

    # 2. Cross-tenant request (Tenant B querying Tenant A's task) -> 404 Not Found
    resp_cross = client.get(f"/api/tasks/{task_id}", headers=tenant_users["headers_b"])
    assert resp_cross.status_code == 404, f"Expected 404 for cross-tenant task query, got {resp_cross.status_code}"

    # 3. Owner (Tenant A) querying task status -> 200 OK
    resp_owner = client.get(f"/api/tasks/{task_id}", headers=tenant_users["headers_a"])
    assert resp_owner.status_code == 200
    data = resp_owner.json()
    assert data["task_id"] == task_id
    assert data["result"]["prompt"] == task.prompt

    # 4. Administrator querying task status -> 200 OK
    resp_admin = client.get(f"/api/tasks/{task_id}", headers=tenant_users["headers_admin"])
    assert resp_admin.status_code == 200


def test_aud08_public_telemetry_sanitization(client, db_session, tenant_users):
    """
    AUD-08: In cluster telemetry, sanitize public_ip (None) and current_task_id (None)
    on public telemetry (scope=all or unauthenticated).
    """
    t_a = tenant_users["tenant_a"]
    worker_id = f"worker-telem-{uuid.uuid4().hex[:8]}"

    # Add active task in PROCESSING state so reap_stale_workers_and_tasks retains current_task_id
    task_rec = Task(
        task_id="sensitive-task-999",
        user_id=t_a.id,
        status=TaskStatus.PROCESSING,
        prompt="active sensitive task",
    )
    worker = Worker(
        id=worker_id,
        user_id=t_a.id,
        name="Sensitive Worker",
        status="online",
        is_available=True,
        public_ip="198.51.100.42",
        current_task_id="sensitive-task-999",
        gpu_memory_gb=24.0,
        vram_allocation_pct=80,
    )
    db_session.add_all([task_rec, worker])
    db_session.commit()

    # Query public telemetry with scope=all
    resp_all = client.get("/api/v1/cluster/telemetry?scope=all")
    assert resp_all.status_code == 200
    telemetry = resp_all.json()
    target_node = next((n for n in telemetry.get("nodes", []) if n["id"] == worker_id), None)
    assert target_node is not None, "Target worker node not found in telemetry"

    # Both public_ip and current_task_id must be sanitized to None on public fleet telemetry
    assert target_node["public_ip"] is None, f"Expected public_ip to be sanitized to None, got {target_node['public_ip']}"
    assert target_node["current_task_id"] is None, f"Expected current_task_id to be sanitized to None, got {target_node['current_task_id']}"
    assert target_node["user_id"] is None, f"Expected user_id to be sanitized to None, got {target_node['user_id']}"

    # Owner querying private fleet telemetry preserves fields
    resp_owner = client.get("/api/v1/cluster/telemetry", headers=tenant_users["headers_a"])
    assert resp_owner.status_code == 200
    owner_node = next((n for n in resp_owner.json().get("nodes", []) if n["id"] == worker_id), None)
    assert owner_node is not None
    assert owner_node["public_ip"] == "198.51.100.42"
    assert owner_node["current_task_id"] == "sensitive-task-999"
