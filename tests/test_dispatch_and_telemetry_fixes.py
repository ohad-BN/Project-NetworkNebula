"""
Regression & Unit Tests for Zero-GPU-Load Stall, Double-Dispatch Race, & Honest Telemetry Fixes.

Covers:
1. Honest GPU utilization & terminal-task heartbeat guard (no synthetic 72/75/85% floors;
   cancelled/completed jobs rejected on stale worker heartbeats and emitted `job_cancel`).
2. Ephemeral `training_status` phase streaming (`downloading_model`, `loading_weights`, `training`)
   exposed via `/api/v1/training/jobs` and cleared when jobs complete or cancel.
3. WS `capabilities` persists `tunnel_pubkey_x25519` and `supports_sealed_env` on reconnect.
4. Atomic SQL job claim prevents concurrent double execution & duplicate `tunnel_stream://` drains;
   `dispatch_training_job_resilient` honors `nebula:celery:online` so busy `-P solo` Celery isn't bypassed.
5. `prepare_gpu_training_records` fails closed on missing/empty `tunnel_stream://` datasets.
6. `nebula_worker` `prefetch_model_with_progress` reports download MB progress & aborts cleanly
   between files on `cancel_event` without locking CUDA/CPU or calling `ensure_model`.
"""

import json
import os
import threading
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import User, Worker, TrainingJob
from app.cluster_worker_router import (
    clear_training_job_phase,
    get_training_job_phase,
    set_training_job_phase,
    _get_redis_client,
)
from app.enterprise_training_router import dispatch_training_job_resilient
from app.training_engine import training_engine
from app.worker import execute_training_job
from worker.nebula_worker import _WorkerGpuRuntime


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as tc:
        yield tc


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def worker_job_fixture(db_session):
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=f"user-fix-{suffix}",
        email=f"fix_{suffix}@example.com",
        api_key=f"nebula_fix_key_{suffix}",
        api_secret=f"nebula_fix_sec_{suffix}",
        name="Fix Test Owner",
        is_active=True,
    )
    wid = f"test-fix-gpu-{suffix}"
    worker = Worker(
        id=wid,
        user_id=user.id,
        name=f"FIX-RTX ({suffix})",
        gpu_info="NVIDIA GeForce RTX 4070 Laptop GPU",
        cpu_cores=16,
        memory_gb=64.0,
        gpu_memory_gb=8.0,
        vram_allocation_pct=80,
        vram_used_gb=0.8,
        gpu_utilization_pct=0.0,
        cuda_version="CUDA 12.4 / PyTorch 2.6.0",
        status="online",
        is_available=True,
        compute_architecture="cuda",
        supported_task_types="batch_inference,inference,training,distributed_training",
        training_ready=True,
        missing_training_packages="[]",
        supports_sealed_env=False,
        supports_zero_disk_shm=False,
    )
    job_id = str(uuid.uuid4())
    job = TrainingJob(
        id=job_id,
        user_id=user.id,
        name=f"Fix-Test-Job-{suffix}",
        base_model="HuggingFaceTB/SmolLM2-135M-Instruct",
        train_type="qlora",
        parallelism="data_parallel",
        num_gpus=1,
        dataset_s3_url="s3://nebula-datasets/enterprise/real_alpaca_dataset.jsonl",
        hyperparameters=json.dumps({"worker_ids": [wid]}),
        status="running",
        current_epoch=0,
        total_epochs=3,
        loss_history="[]",
        checkpoints="[]",
    )
    db_session.add_all([user, worker, job])
    db_session.commit()

    yield {"user": user, "worker": worker, "job": job}

    clear_training_job_phase(job_id)
    try:
        db_session.query(TrainingJob).filter(TrainingJob.id == job_id).delete(synchronize_session=False)
        db_session.query(Worker).filter(Worker.id == wid).delete(synchronize_session=False)
        db_session.query(User).filter(User.id == user.id).delete(synchronize_session=False)
        db_session.commit()
    except Exception:
        db_session.rollback()


def test_http_heartbeat_reports_honest_zero_util_and_rejects_stale_cancelled_task(client, db_session, worker_job_fixture):
    worker = worker_job_fixture["worker"]
    job = worker_job_fixture["job"]

    # 1. While job is running and worker reports real 0% GPU (during model download),
    #    backend must preserve 0.0% rather than faking 72.0%.
    res1 = client.post(
        f"/api/v1/workers/{worker.id}/heartbeat",
        json={
            "current_task_id": f"train-{job.id[:8]}",
            "vram_used_gb": 1.1,
            "gpu_utilization_pct": 0.0,
            "status": "busy",
        },
    )
    assert res1.status_code == 200
    assert res1.json()["node_status"] == "busy"
    db_session.expire_all()
    w_row = db_session.query(Worker).filter(Worker.id == worker.id).first()
    assert w_row.gpu_utilization_pct == 0.0
    assert w_row.current_task_id == f"train-{job.id[:8]}"

    # 2. Cancel the job, then send a stale worker heartbeat still claiming `train-...`.
    #    Backend must clear current_task_id and restore worker to `online` without faking 72%.
    job.status = "cancelled"
    db_session.commit()

    res2 = client.post(
        f"/api/v1/workers/{worker.id}/heartbeat",
        json={
            "current_task_id": f"train-{job.id[:8]}",
            "vram_used_gb": 1.1,
            "gpu_utilization_pct": 0.0,
            "status": "busy",
        },
    )
    assert res2.status_code == 200
    assert res2.json()["node_status"] == "online"
    db_session.expire_all()
    w_row = db_session.query(Worker).filter(Worker.id == worker.id).first()
    assert w_row.status == "online"
    assert w_row.current_task_id is None
    assert w_row.gpu_utilization_pct == 0.0


def test_ws_capabilities_phase_streaming_and_stale_cancel_propagation(client, db_session, worker_job_fixture):
    user = worker_job_fixture["user"]
    worker = worker_job_fixture["worker"]
    job = worker_job_fixture["job"]
    headers = {"X-API-Key": user.api_key}

    with client.websocket_connect(f"/ws/worker/{worker.id}?api_key={user.api_key}") as ws:
        init_msg = ws.receive_json()
        assert init_msg["type"] == "init"

        # Capabilities should persist X25519 pubkey even on reconnect without /register
        ws.send_json({
            "type": "capabilities",
            "protocol_version": 2,
            "worker_version": "2026-11-11.2",
            "compute_capabilities": ["inference", "training"],
            "supported_task_types": "inference,training",
            "training_ready": True,
            "tunnel_pubkey_x25519": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            "supports_sealed_env": True,
            "supports_zero_disk_shm": True,
        })

        # Send live downloading phase with real 0% GPU utilization
        ws.send_json({
            "type": "training_status",
            "job_id": job.id,
            "phase": "downloading_model",
            "detail": "Downloading HuggingFaceTB/SmolLM2-135M-Instruct (42.0 / 256.6 MB)",
            "progress_pct": 16.4,
            "downloaded_mb": 42.0,
            "total_mb": 256.6,
            "vram_used_gb": 1.0,
            "gpu_utilization_pct": 0.0,
        })

        # Follow with a WS heartbeat so we drain until DB commit completes cleanly
        ws.send_json({
            "type": "heartbeat",
            "tunnel_protocol_v2": True,
            "vram_used_gb": 1.0,
            "gpu_utilization_pct": 0.0,
            "current_task_id": f"train-{job.id[:8]}",
        })
        ack1 = ws.receive_json()
        assert ack1["type"] == "ack"

        db_session.expire_all()
        w_db = db_session.query(Worker).filter(Worker.id == worker.id).first()
        assert w_db.tunnel_pubkey_x25519 == "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        assert w_db.supports_sealed_env is True
        assert w_db.gpu_utilization_pct == 0.0

        # Jobs REST endpoint exposes live training_phase to the UI
        jobs_resp = client.get("/api/v1/training/jobs", headers=headers)
        assert jobs_resp.status_code == 200
        j_entry = next(j for j in jobs_resp.json() if j["id"] == job.id)
        assert j_entry["training_phase"]["phase"] == "downloading_model"
        assert "42.0 / 256.6 MB" in j_entry["training_phase"]["detail"]

        # Cancel job in DB and send another stale heartbeat -> WS must emit job_cancel & free node
        job.status = "cancelled"
        db_session.commit()

        ws.send_json({
            "type": "heartbeat",
            "tunnel_protocol_v2": True,
            "vram_used_gb": 1.0,
            "gpu_utilization_pct": 0.0,
            "current_task_id": f"train-{job.id[:8]}",
        })
        msg_cancel = ws.receive_json()
        ack2 = ws.receive_json()
        assert msg_cancel["type"] == "job_cancel"
        assert msg_cancel["job_id"] == job.id
        assert ack2["type"] == "ack"

        db_session.expire_all()
        w_db = db_session.query(Worker).filter(Worker.id == worker.id).first()
        assert w_db.status == "online"
        assert w_db.current_task_id is None


def test_atomic_claim_blocks_duplicate_execution_and_preserves_ram_stream(db_session, worker_job_fixture):
    worker = worker_job_fixture["worker"]
    job = worker_job_fixture["job"]
    job.status = "queued"
    job.dataset_s3_url = f"tunnel_stream://{job.id}"
    db_session.commit()

    dispatch_calls = []

    def _fake_prep(url, min_records=64, job_id=None):
        dispatch_calls.append((url, job_id))
        return [{"instruction": "i", "response": "r"}] * min_records

    fake_redis = MagicMock()
    fake_redis.blpop.return_value = (
        f"nebula:training_result:{job.id}",
        json.dumps({"status": "completed", "final_adapter_url": "s3://nebula-checkpoints/ok.safetensors"}),
    )

    with patch("app.cluster_worker_router.is_worker_tunnel_v2_online_anywhere", return_value=True), \
         patch("app.cluster_worker_router.is_worker_tunnel_online_anywhere", return_value=True), \
         patch("app.cluster_worker_router._get_redis_client", return_value=fake_redis), \
         patch("app.training_engine.training_engine.prepare_gpu_training_records", side_effect=_fake_prep):
        r1 = execute_training_job(job.id)
        r2 = execute_training_job(job.id)

    assert r1["status"] == "completed"
    # Second runner must immediately observe non-queued state and exit without draining/dispatching
    assert r2["status"] == "completed"
    assert len(dispatch_calls) == 1
    assert fake_redis.rpush.call_count == 1


def test_dispatch_resilient_respects_celery_presence_and_dedup_lock():
    fake_redis = MagicMock()
    fake_redis.set.side_effect = [True, False]  # 2nd concurrent call rejected by NX lock
    fake_redis.get.return_value = "1"  # nebula:celery:online active even if inspect.ping() would stall

    with patch("app.cluster_worker_router._get_redis_client", return_value=fake_redis), \
         patch("app.worker.celery_app.control.inspect") as mock_insp, \
         patch("app.enterprise_training_router.execute_training_job") as mock_exec:
        mock_insp.return_value.ping.return_value = None  # simulates busy `-P solo` worker timeout!
        dispatch_training_job_resilient("job-solo-test")
        dispatch_training_job_resilient("job-solo-test")

    mock_exec.delay.assert_called_once_with("job-solo-test")


def test_prepare_gpu_training_records_fails_closed_on_missing_tunnel_stream():
    with patch("app.cluster_worker_router.pop_buffered_client_stream_records", return_value=[]):
        with pytest.raises(RuntimeError, match="empty or expired"):
            training_engine.prepare_gpu_training_records(
                dataset_s3_url="tunnel_stream://missing-stream-id",
                min_records=64,
                job_id="missing-stream-id",
            )


def test_worker_prefetch_emits_progress_and_aborts_on_cancel_mid_download():
    rt = _WorkerGpuRuntime()
    cancel_ev = threading.Event()
    status_events = []
    downloaded_files = []

    fake_info = SimpleNamespace(
        siblings=[
            SimpleNamespace(rfilename="config.json", size=1024),
            SimpleNamespace(rfilename="model.safetensors", size=269_000_000),
        ]
    )

    def _fake_download(repo_id, filename, token=None):
        downloaded_files.append(filename)
        if filename == "config.json":
            cancel_ev.set()  # user cancels mid-download before large weights file starts!
        return f"/tmp/{filename}"

    with patch("huggingface_hub.HfApi") as mock_api_cls, \
         patch("huggingface_hub.hf_hub_download", side_effect=_fake_download):
        mock_api_cls.return_value.repo_info.return_value = fake_info
        ok = rt.prefetch_model_with_progress(
            "HuggingFaceTB/SmolLM2-135M-Instruct",
            on_status=lambda phase, detail, pct, dl, tot: status_events.append((phase, detail, pct)),
            cancel_event=cancel_ev,
        )

    assert ok is False
    assert downloaded_files == ["config.json"]
    assert any(p == "downloading_model" for p, _, _ in status_events)

    # Also verify run_lora_training returns cancelled immediately without calling ensure_model
    cancel_ev.set()
    with patch.object(rt, "ensure_model", side_effect=AssertionError("Must not call ensure_model after cancel")):
        res = rt.run_lora_training(
            job_payload={
                "job_id": "job-dl-cancel",
                "base_model_id": "HuggingFaceTB/SmolLM2-135M-Instruct",
                "records": [{"instruction": "q", "response": "a"}],
                "total_epochs": 3,
            },
            server_url="http://127.0.0.1:8000",
            worker_id="node-test",
            headers={},
            cancel_event=cancel_ev,
        )
    assert res["status"] == "cancelled"
    assert res["total_epochs"] == 0


def test_authenticated_checkpoint_download_owner_and_isolation(client, db_session, worker_job_fixture):
    user = worker_job_fixture["user"]
    job = worker_job_fixture["job"]
    job.status = "completed"
    job.current_epoch = 3
    job.total_epochs = 3
    job.checkpoints = json.dumps([
        {
            "epoch": 3,
            "s3_url": f"http://minio:9000/nebula-checkpoints/{job.id}/epoch_3/adapter_model.safetensors",
            "size_bytes": 16,
        }
    ])
    job.final_adapter_url = f"http://minio:9000/nebula-checkpoints/{job.id}/epoch_3/adapter_model.safetensors"

    other_suffix = uuid.uuid4().hex[:8]
    other_user = User(
        id=f"user-other-{other_suffix}",
        email=f"other_{other_suffix}@example.com",
        api_key=f"nebula_other_key_{other_suffix}",
        api_secret=f"nebula_other_sec_{other_suffix}",
        name="Other Tenant",
        is_active=True,
    )
    db_session.add(other_user)
    db_session.commit()

    fake_safetensors = b"\x08\x00\x00\x00\x00\x00\x00\x00{\"k\":1}payload"
    fake_storage = MagicMock()
    fake_storage.download_bytes.return_value = fake_safetensors

    try:
        owner_headers = {"X-API-Key": user.api_key, "X-API-Secret": user.api_secret}
        other_headers = {"X-API-Key": other_user.api_key, "X-API-Secret": other_user.api_secret}

        # Unauthenticated request rejected
        unauth = client.get(f"/api/v1/training/jobs/{job.id}/checkpoints/3/download")
        assert unauth.status_code in (401, 403)

        # Cross-tenant request rejected with 404 (AUD-03)
        cross = client.get(
            f"/api/v1/training/jobs/{job.id}/checkpoints/3/download",
            headers=other_headers,
        )
        assert cross.status_code == 404

        with patch("app.enterprise_training_router.get_storage", return_value=fake_storage):
            # Disallowed artifact filename rejected cleanly (no path traversal)
            bad_file = client.get(
                f"/api/v1/training/jobs/{job.id}/checkpoints/3/download?file=../../etc/passwd",
                headers=owner_headers,
            )
            assert bad_file.status_code == 400

            # Owner receives authentic binary payload
            ok_resp = client.get(
                f"/api/v1/training/jobs/{job.id}/checkpoints/3/download",
                headers=owner_headers,
            )
            assert ok_resp.status_code == 200
            assert ok_resp.content == fake_safetensors
            assert "application/octet-stream" in ok_resp.headers.get("content-type", "")
            assert ok_resp.headers.get("x-content-type-options") == "nosniff"
            fake_storage.download_bytes.assert_called_with(
                "nebula-checkpoints",
                f"{job.id}/epoch_3/adapter_model.safetensors",
            )
    finally:
        try:
            db_session.delete(other_user)
            db_session.commit()
        except Exception:
            db_session.rollback()
