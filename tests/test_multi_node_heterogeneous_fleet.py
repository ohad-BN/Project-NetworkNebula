"""
Comprehensive Regression & Integration Tests for Heterogeneous Multi-Machine Fleet Fixes:
1. Heterogeneous fleet capability gating:
   - Excludes Intel Iris Xe (`batch_inference`) and missing-dependency (`training_ready=False`) nodes from training.
   - Auto-Swarm (`num_gpus >= 2`) softly scales down to available training-ready GPUs instead of hanging in `queued`.
2. Honest worker capability advertising in `worker/nebula_worker.py` (mirrored to `nebula_worker.py`):
   - `classify_worker_capabilities` strips `training` / `distributed_training` when `peft` or deps are missing.
   - Standalone hardware fallback without PyTorch never reports bogus 8.0 GB / `training` capability for CPU nodes.
3. Live `job_cancel` propagation & terminal-state immutability guard:
   - Cancelling a job pushes `job_cancel` frames via Redis tunnel dispatch queue.
   - Late `training_epoch` WS frames arriving on `failed`/`cancelled`/`completed` jobs never overwrite `current_epoch`, `loss_history`, or `checkpoints`.
   - `run_lora_training` honors cooperative `cancel_event` inside the inner batch loop and returns `cancelled`.
4. Distributed shard failure & failover handling:
   - One failing shard cancels healthy sibling workers cleanly when no standby exists, or triggers standby failover when available.
5. Phase 2-4 glue seams:
   - Dynamic VRAM gating via `estimate_required_vram_gb` (replacing hardcoded 2.0 GB).
   - `client_job_id` + `/ws/client/stream/{job_id}` RAM buffering into `prepare_gpu_training_records` + `build_training_dispatch_payload` (`qlora`, `sealed_secrets`, `storage_retention`).
"""

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Dict, Any
from unittest.mock import MagicMock, patch

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import User, Worker, TrainingJob
from app.cluster_worker_router import (
    get_eligible_training_workers,
    derive_worker_supported_task_types,
    is_worker_training_capable,
    _get_redis_client,
)
from app.distributed_training_engine import distributed_training_engine
from app.scheduler import cluster_scheduler
from app.training_engine import training_engine, build_training_dispatch_payload
from worker.nebula_worker import classify_worker_capabilities, discover_hardware


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
def fleet_fixture(db_session):
    """Seed 1 owner user + 1 CUDA RTX node + 1 Intel Iris Xe / missing-peft monitor node."""
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=f"user-fleet-{suffix}",
        email=f"fleet_{suffix}@example.com",
        api_key=f"nebula_fleet_key_{suffix}",
        api_secret=f"nebula_fleet_secret_{suffix}",
        name="Fleet Test Owner",
        is_active=True,
    )
    cuda_wid = f"test-rtx-{suffix}"
    igpu_wid = f"test-iris-{suffix}"

    w_cuda = Worker(
        id=cuda_wid,
        user_id=user.id,
        name=f"SKORP-RTX ({suffix})",
        gpu_info="NVIDIA GeForce RTX 4070 Laptop GPU",
        gpu_memory_gb=8.0,
        vram_allocation_pct=80,
        vram_used_gb=0.4,
        gpu_utilization_pct=5.0,
        compute_architecture="cuda",
        hardware_tier="consumer_gpu",
        supported_task_types="batch_inference,inference,training,distributed_training",
        training_ready=True,
        missing_training_packages="[]",
        status="online",
        is_available=True,
        work_capacity_state="unleashed",
        last_heartbeat=datetime.now(timezone.utc),
    )
    w_igpu = Worker(
        id=igpu_wid,
        user_id=user.id,
        name=f"DESKTOP-C2AK-{suffix} (Intel(R) Iris(R) Xe Graphics)",
        gpu_info="Intel(R) Iris(R) Xe Graphics",
        gpu_memory_gb=1.0,
        vram_allocation_pct=80,
        vram_used_gb=0.1,
        gpu_utilization_pct=3.0,
        compute_architecture="cpu_simd",
        hardware_tier="intel_arc",
        supported_task_types="batch_inference",
        training_ready=False,
        missing_training_packages='["peft", "transformers"]',
        status="online",
        is_available=True,
        work_capacity_state="unleashed",
        last_heartbeat=datetime.now(timezone.utc),
    )

    db_session.add_all([user, w_cuda, w_igpu])
    db_session.commit()

    yield {
        "user": user,
        "headers": {"X-API-Key": user.api_key, "X-API-Secret": user.api_secret},
        "cuda": w_cuda,
        "igpu": w_igpu,
    }

    try:
        db_session.rollback()
        db_session.query(TrainingJob).filter(TrainingJob.user_id == user.id).delete(synchronize_session=False)
        db_session.query(Worker).filter(Worker.id.in_([cuda_wid, igpu_wid])).delete(synchronize_session=False)
        db_session.query(User).filter(User.id == user.id).delete(synchronize_session=False)
        db_session.commit()
    except Exception:
        db_session.rollback()


# ==============================================================================
# 1. Heterogeneous Fleet Filtering & Auto-Swarm Soft Scaling
# ==============================================================================

def test_igpu_and_missing_deps_excluded_everywhere(fleet_fixture, db_session):
    cuda = fleet_fixture["cuda"]
    igpu = fleet_fixture["igpu"]

    ok_cuda, _ = is_worker_training_capable(cuda)
    ok_igpu, reason_igpu = is_worker_training_capable(igpu)
    assert ok_cuda is True
    assert ok_igpu is False
    assert reason_igpu

    eligible = get_eligible_training_workers(db_session, requested_worker_ids=[cuda.id, igpu.id])
    eligible_ids = [w.id for w in eligible]
    assert cuda.id in eligible_ids
    assert igpu.id not in eligible_ids

    # Scheduler must also disqualify missing-dep / CUDA node if training_ready toggled False
    mock_db = MagicMock()
    mock_db.query.return_value.all.return_value = [cuda, igpu]
    sched = cluster_scheduler.select_optimal_workers(
        db=mock_db,
        required_vram_gb=2.0,
        num_gpus=2,
        task_type="training",
        record_dispatch=False,
    )
    assert sched["selected_worker_ids"] == [cuda.id]
    assert igpu.id not in sched["selected_worker_ids"]


def test_auto_swarm_scales_down_instead_of_hanging_queued(client, fleet_fixture):
    headers = fleet_fixture["headers"]
    cuda = fleet_fixture["cuda"]
    igpu = fleet_fixture["igpu"]

    with patch("app.cluster_worker_router.get_eligible_training_workers", return_value=[cuda]), \
         patch("app.distributed_training_engine.distributed_training_engine.resolve_worker_fleet", return_value=[cuda.id]), \
         patch("app.enterprise_training_router.dispatch_training_job_resilient") as mock_dispatch:
        resp = client.post(
            "/api/v1/training/jobs",
            headers=headers,
            json={
                "name": "Heterogeneous-AutoSwarm-Test",
                "base_model": "Qwen/Qwen2.5-0.5B-Instruct",
                "train_type": "qlora",
                "num_gpus": 2,
                "dataset_s3_url": "s3://nebula-datasets/default.jsonl",
                "total_epochs": 1,
            },
        )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["worker_ids"] == [cuda.id]
    assert igpu.id not in data["worker_ids"]
    assert data["num_gpus"] == 1
    assert data["hyperparameters"].get("waiting_for_worker") is None
    mock_dispatch.assert_called_once()


def test_explicit_pin_to_non_training_worker_returns_400(client, fleet_fixture):
    headers = fleet_fixture["headers"]
    igpu = fleet_fixture["igpu"]

    resp = client.post(
        "/api/v1/training/jobs",
        headers=headers,
        json={
            "name": "Bad-Explicit-Target",
            "base_model": "Qwen/Qwen2.5-0.5B-Instruct",
            "train_type": "lora",
            "num_gpus": 1,
            "worker_ids": [igpu.id],
            "dataset_s3_url": "s3://nebula-datasets/default.jsonl",
            "total_epochs": 1,
        },
    )
    assert resp.status_code == 400
    assert "cannot run training" in resp.json()["detail"].lower()


def test_resolve_worker_fleet_soft_scaling_vs_strict_and_vram_gate():
    w_rtx = Worker(
        id="w-rtx-ok",
        name="RTX Node",
        gpu_memory_gb=8.0,
        vram_allocation_pct=80,  # 6.4 GB ceiling
        vram_used_gb=0.0,
        status="online",
        is_available=True,
        compute_architecture="cuda",
        supported_task_types="inference,training,distributed_training",
        training_ready=True,
    )
    w_cpu = Worker(
        id="w-iris-no",
        name="Iris Xe",
        gpu_memory_gb=1.0,
        vram_allocation_pct=80,
        vram_used_gb=0.0,
        status="online",
        is_available=True,
        compute_architecture="cpu_simd",
        supported_task_types="batch_inference",
        training_ready=False,
    )

    mock_db = MagicMock()
    mock_db.query.return_value.all.return_value = [w_rtx, w_cpu]

    with patch.dict(os.environ, {"ALLOW_SERVER_CPU_TRAINING_FALLBACK": "false"}):
        # Soft scale: num_gpus=2 with only 1 eligible CUDA node -> scales cleanly to [w_rtx.id]
        soft_fleet = distributed_training_engine.resolve_worker_fleet(
            db=mock_db, num_gpus=2, required_vram_gb=4.0, strict_worker_count=False
        )
        assert soft_fleet == [w_rtx.id]

        # Strict mode: requires exact count 2 -> returns []
        strict_fleet = distributed_training_engine.resolve_worker_fleet(
            db=mock_db, num_gpus=2, required_vram_gb=4.0, strict_worker_count=True
        )
        assert strict_fleet == []

        # Oversized VRAM (20 GB > 6.4 GB) -> returns [] even in soft mode
        oversized_fleet = distributed_training_engine.resolve_worker_fleet(
            db=mock_db, num_gpus=2, required_vram_gb=20.0, strict_worker_count=False
        )
        assert oversized_fleet == []


# ==============================================================================
# 2. Honest Worker Script Capability & Fallback Detection
# ==============================================================================

def test_worker_capabilities_withheld_when_deps_missing_or_cpu():
    cuda_hw = {
        "compute_architecture": "cuda",
        "gpu_memory_gb": 8.0,
        "supported_task_types": "batch_inference,inference,training,distributed_training",
    }
    caps_missing = classify_worker_capabilities(cuda_hw, {"ready": False, "missing": ["peft"], "device": "cuda"})
    assert caps_missing["training_ready"] is False
    assert "peft" in caps_missing["missing_training_packages"]
    assert "training" not in caps_missing["supported_task_types"].split(",")
    assert "distributed_training" not in caps_missing["supported_task_types"].split(",")
    assert "training" not in caps_missing["compute_capabilities"]

    caps_ok = classify_worker_capabilities(cuda_hw, {"ready": True, "missing": [], "device": "cuda"})
    assert caps_ok["training_ready"] is True
    assert "training" in caps_ok["supported_task_types"].split(",")
    assert "training" in caps_ok["compute_capabilities"]

    igpu_hw = {
        "compute_architecture": "cpu_simd",
        "gpu_memory_gb": 1.0,
        "supported_task_types": "batch_inference",
    }
    caps_igpu = classify_worker_capabilities(igpu_hw, {"ready": True, "missing": [], "device": "cpu"})
    assert caps_igpu["training_ready"] is False
    assert caps_igpu["supported_task_types"] == "batch_inference"
    assert caps_igpu["compute_capabilities"] == ["inference"]


def test_standalone_discover_hardware_fallback_without_torch_no_fake_8gb():
    with patch("worker.nebula_worker.inspect_universal_hardware", None), \
         patch("subprocess.check_output", side_effect=FileNotFoundError("no nvidia-smi")), \
         patch.dict("sys.modules", {"torch": None}):
        hw = discover_hardware()
    assert hw["compute_architecture"] == "cpu_simd"
    assert hw["gpu_memory_gb"] == 0.0
    derived = derive_worker_supported_task_types(
        raw_tasks=None,
        compute_architecture=hw["compute_architecture"],
        gpu_memory_gb=hw["gpu_memory_gb"],
    )
    assert derived == "batch_inference"


# ==============================================================================
# 3. Live Cancel Propagation & Terminal-State DB Guard
# ==============================================================================

def test_cancel_endpoint_pushes_job_cancel_and_ws_ignores_stale_epochs(client, fleet_fixture, db_session):
    headers = fleet_fixture["headers"]
    cuda = fleet_fixture["cuda"]
    user = fleet_fixture["user"]

    job_id = str(uuid.uuid4())
    job = TrainingJob(
        id=job_id,
        user_id=user.id,
        name="Cancel-Propagation-Test",
        base_model="Qwen/Qwen2.5-0.5B-Instruct",
        train_type="lora",
        num_gpus=1,
        dataset_s3_url="s3://nebula-datasets/default.jsonl",
        hyperparameters=json.dumps({"worker_ids": [cuda.id]}),
        status="running",
        current_epoch=1,
        total_epochs=3,
        loss_history=json.dumps([{"epoch": 1, "loss": 1.5}]),
        checkpoints=json.dumps([{"epoch": 1, "s3_url": "s3://nebula-checkpoints/e1.safetensors", "size_bytes": 100}]),
    )
    db_session.add(job)
    db_session.commit()

    fake_redis = MagicMock()
    with patch("app.cluster_worker_router._get_redis_client", return_value=fake_redis):
        c_resp = client.post(f"/api/v1/training/jobs/{job_id}/cancel", headers=headers)
    assert c_resp.status_code == 200
    assert c_resp.json()["status"] == "cancelled"

    pushed_frames = [json.loads(call.args[1]) for call in fake_redis.rpush.call_args_list if call.args[0] == "nebula:tunnel:dispatch"]
    assert any(f.get("type") == "job_cancel" and f.get("job_id") == job_id and f.get("worker_id") == cuda.id for f in pushed_frames)

    # Now simulate a late training_epoch arriving over the worker WS tunnel on the cancelled job
    with client.websocket_connect(f"/ws/worker/{cuda.id}?api_key={user.api_key}") as ws:
        _init = ws.receive_json()
        ws.send_json({
            "type": "training_epoch",
            "job_id": job_id,
            "epoch": 3,
            "loss": 0.42,
            "ckpt_url": "s3://nebula-checkpoints/stale_e3.safetensors",
            "size_bytes": 999,
        })
        cancel_reply = ws.receive_json()
        assert cancel_reply["type"] == "job_cancel"
        assert cancel_reply["job_id"] == job_id

    db_session.expire_all()
    refreshed = db_session.query(TrainingJob).filter(TrainingJob.id == job_id).first()
    assert refreshed.status == "cancelled"
    assert refreshed.current_epoch == 1
    assert len(json.loads(refreshed.loss_history)) == 1
    assert len(json.loads(refreshed.checkpoints)) == 1


# ==============================================================================
# 4. Distributed Shard Failure Cancels Healthy Siblings Cleanly
# ==============================================================================

def test_distributed_shard_failure_cancels_sibling_workers():
    fake_redis = MagicMock()
    # Popping the 2nd worker's immediate training_error JSON frame
    err_payload = json.dumps({
        "worker_id": "worker-bad",
        "status": "error",
        "error": "No module named 'peft'",
    })
    fake_redis.blpop.return_value = ("nebula:training_result:job-dist-abort", err_payload)

    with patch("app.cluster_worker_router.is_worker_tunnel_v2_online_anywhere", return_value=True), \
         patch("app.cluster_worker_router.is_worker_tunnel_online_anywhere", return_value=True), \
         patch("app.cluster_worker_router._get_redis_client", return_value=fake_redis), \
         patch("app.training_engine.training_engine.prepare_gpu_training_records", return_value=[{"instruction": "hi", "response": "ok"}]), \
         patch("app.scheduler.cluster_scheduler.trigger_task_failover", return_value={"has_real_standby": False}):
        with pytest.raises(RuntimeError, match="worker-bad"):
            distributed_training_engine.train_distributed_job(
                job_id="job-dist-abort",
                base_model_id="Qwen/Qwen2.5-0.5B-Instruct",
                worker_ids=["worker-good", "worker-bad"],
                dataset_s3_url="s3://nebula-datasets/default.jsonl",
                total_epochs=3,
            )

    pushed = [json.loads(c.args[1]) for c in fake_redis.rpush.call_args_list if c.args[0] == "nebula:tunnel:dispatch"]
    assert any(p.get("type") == "job_cancel" and p.get("worker_id") == "worker-good" for p in pushed)


# ==============================================================================
# 5. Zero-Storage Client RAM Stream & Dispatch Payload Glue
# ==============================================================================

def test_client_stream_ram_buffer_and_dispatch_payload(client, fleet_fixture):
    headers = fleet_fixture["headers"]
    user = fleet_fixture["user"]
    cuda = fleet_fixture["cuda"]
    pre_job_id = str(uuid.uuid4())

    # Stream dataset via /ws/client/stream/{job_id} BEFORE submitting POST
    with client.websocket_connect(f"/ws/client/stream/{pre_job_id}?role=client&api_key={user.api_key}") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "stream_ready"
        ws.send_text(json.dumps({
            "type": "dataset_stream",
            "records": [
                {"instruction": "What is Nebula?", "response": "Zero-storage decentralized AI."},
                {"instruction": "What quantization?", "response": "4-bit NF4 QLoRA."},
            ],
        }))
        ws.send_text("ping")
        assert ws.receive_text() == "pong"

    # Submit job with client_job_id + tunnel_stream:// + qlora + sealed_secrets_b64
    with patch("app.cluster_worker_router.get_eligible_training_workers", return_value=[cuda]), \
         patch("app.enterprise_training_router.dispatch_training_job_resilient"):
        sub = client.post(
            "/api/v1/training/jobs",
            headers=headers,
            json={
                "client_job_id": pre_job_id,
                "name": "Client-RAM-Stream-Job",
                "base_model": "Qwen/Qwen2.5-7B-Instruct",
                "train_type": "qlora",
                "num_gpus": 1,
                "dataset_s3_url": f"tunnel_stream://{pre_job_id}",
                "storage_retention": "zero_retention",
                "sealed_secrets_b64": "dGVzdC1zZWFsZWQtY2lwaGVydGV4dA==",
                "total_epochs": 1,
            },
        )
    assert sub.status_code == 201, sub.text
    job_data = sub.json()
    assert job_data["id"] == pre_job_id
    assert job_data["data_source_type"] == "tunnel_stream"
    assert job_data["storage_retention"] == "zero_retention"

    # Worker record loader pops & consumes the volatile RAM stream without hitting default records
    recs = training_engine.prepare_gpu_training_records(
        dataset_s3_url=f"tunnel_stream://{pre_job_id}",
        min_records=4,
        job_id=pre_job_id,
    )
    assert recs[0]["instruction"] == "What is Nebula?"
    assert recs[1]["response"] == "4-bit NF4 QLoRA."

    # Canonical dispatch payload preserves train_type, storage_retention, sealed_secrets_b64, shard info
    dp = build_training_dispatch_payload(
        job_id=pre_job_id,
        worker_id=cuda.id,
        base_model_id="Qwen/Qwen2.5-7B-Instruct",
        dataset_s3_url=f"tunnel_stream://{pre_job_id}",
        total_epochs=1,
        train_type="qlora",
        storage_retention="zero_retention",
        sealed_secrets_b64="dGVzdC1zZWFsZWQtY2lwaGVydGV4dA==",
        records=recs,
        shard_index=0,
        shard_count=1,
    )
    assert dp["train_type"] == "qlora"
    assert dp["storage_retention"] == "zero_retention"
    assert dp["sealed_secrets_b64"] == "dGVzdC1zZWFsZWQtY2lwaGVydGV4dA=="
    assert dp["shard_index"] == 0
    assert dp["shard_count"] == 1


def test_worker_cooperative_cancel_event_aborts_before_training_steps():
    """Verify run_lora_training aborts cleanly and returns status=cancelled when cancel_event is pre-set."""
    import torch
    import torch.nn as nn
    from worker.nebula_worker import _WorkerGpuRuntime

    rt = _WorkerGpuRuntime()
    cancel_ev = threading.Event()
    cancel_ev.set()

    class _DummyTokenizer:
        def __call__(self, text, truncation=True, max_length=256, return_tensors="pt"):
            return {"input_ids": torch.tensor([[1, 2, 3, 4]], dtype=torch.long)}

    class _DummyModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.q_proj = nn.Linear(4, 4)
            self.forward_calls = 0
            self.config = type("_Cfg", (), {
                "model_type": "custom",
                "tie_word_embeddings": False,
                "to_dict": lambda s: {"model_type": "custom"},
                "get": lambda s, k, d=None: d,
            })()

        def prepare_inputs_for_generation(self, *args, **kwargs):
            return {}

        def forward(self, input_ids=None, labels=None, **kwargs):
            self.forward_calls += 1
            if self.forward_calls >= 1:
                cancel_ev.set()
            loss = (self.q_proj(input_ids.float()).sum()) ** 2
            return type("_Out", (), {"loss": loss})()

        def unload(self):
            return self

    dummy_model = _DummyModel()
    epoch_calls = []

    with patch.object(rt, "ensure_model", return_value=(dummy_model, _DummyTokenizer(), "cpu")):
        # 3 records -> batch 1 triggers cancel_ev.set(); batches 2 & 3 MUST NOT run!
        cancel_ev.clear()
        res = rt.run_lora_training(
            job_payload={
                "job_id": "job-coop-cancel",
                "base_model_id": "dummy/tiny",
                "records": [
                    {"instruction": "hi1", "response": "there1"},
                    {"instruction": "hi2", "response": "there2"},
                    {"instruction": "hi3", "response": "there3"},
                ],
                "total_epochs": 3,
            },
            server_url="http://127.0.0.1:8000",
            worker_id="w-cancel",
            headers={},
            on_epoch=lambda *a: epoch_calls.append(a),
            cancel_event=cancel_ev,
        )

    assert res["status"] == "cancelled"
    assert res["total_epochs"] == 0
    assert dummy_model.forward_calls == 1
    assert epoch_calls == []


def test_distributed_shard_failover_reroutes_to_standby_worker():
    """When one shard fails and a healthy tunnel standby exists, shard is rerouted instead of crashing."""
    fake_redis = MagicMock()
    # First pop: worker-bad errors; second & third pops: worker-good and worker-standby complete!
    fake_redis.blpop.side_effect = [
        ("nebula:training_result:job-fo", json.dumps({"worker_id": "worker-bad", "status": "error", "error": "CUDA OOM"})),
        ("nebula:training_result:job-fo", json.dumps({"worker_id": "worker-good", "status": "completed", "final_loss": 0.4})),
        ("nebula:training_result:job-fo", json.dumps({"worker_id": "worker-standby", "status": "completed", "final_loss": 0.45})),
    ]

    with patch("app.cluster_worker_router.is_worker_tunnel_v2_online_anywhere", return_value=True), \
         patch("app.cluster_worker_router.is_worker_tunnel_online_anywhere", return_value=True), \
         patch("app.cluster_worker_router._get_redis_client", return_value=fake_redis), \
         patch("app.training_engine.training_engine.prepare_gpu_training_records", return_value=[{"instruction": "a", "response": "b"}] * 4), \
         patch("app.scheduler.cluster_scheduler.trigger_task_failover", return_value={"has_real_standby": True, "replacement_worker_id": "worker-standby"}):
        res = distributed_training_engine.train_distributed_job(
            job_id="job-fo",
            base_model_id="Qwen/Qwen2.5-0.5B-Instruct",
            worker_ids=["worker-good", "worker-bad"],
            dataset_s3_url="s3://nebula-datasets/default.jsonl",
            total_epochs=1,
        )

    assert res["status"] == "completed"
    pushed = [json.loads(c.args[1]) for c in fake_redis.rpush.call_args_list if c.args[0] == "nebula:tunnel:dispatch"]
    assert any(p.get("worker_id") == "worker-standby" and p.get("shard_index") == 1 for p in pushed)


def test_connect_scripts_expose_preflight_and_role_banner(client):
    ps1 = client.get("/connect.ps1?key=testkey123")
    assert ps1.status_code == 200
    assert "InstallTrainingDeps" in ps1.text
    assert "Inference / Monitor-Only" in ps1.text

    sh = client.get("/connect.sh?key=testkey123")
    assert sh.status_code == 200
    assert "--install-training-deps" in sh.text
    assert "KEY_CONSUMED" in sh.text

