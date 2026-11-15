#!/usr/bin/env python3
"""
Unit & Integration Tests for Phase 5 Throughput-Calibrated Heterogeneous Fleet Sharding:
1. Worker precomputes supervised tokens per batch with zero GPU sync and returns measured tokens_per_sec
   inside run_lora_training result and active telemetry cache.
2. Orchestrator records EMA tokens_per_sec telemetry cleanly in Redis / RAM fallback.
3. compute_worker_weights & partition_dataset_shards calibrate shards to measured tokens_per_sec
   (eliminating fast-CUDA idle tails behind slower UMA/CPU nodes) with safe skew clamping.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import torch
import torch.nn as nn

from app.cluster_worker_router import (
    _WORKER_TPS_RAM_CACHE,
    get_worker_throughput_tps,
    record_worker_throughput_tps,
)
from app.distributed_training_engine import distributed_training_engine
from worker.nebula_worker import (
    _WorkerGpuRuntime,
    clear_active_gpu_telemetry,
    get_active_worker_tps,
)


def test_count_batch_tokens_and_run_lora_training_reports_tokens_per_sec():
    clear_active_gpu_telemetry()
    batches = [
        (torch.zeros((2, 5), dtype=torch.long), torch.tensor([[1, 2, -100, -100, -100], [1, 2, 3, -100, -100]]), None),
        (torch.zeros((1, 4), dtype=torch.long), torch.tensor([[1, 2, 3, 4]]), None, torch.zeros((1, 4), dtype=torch.long)),
    ]
    assert _WorkerGpuRuntime._count_batch_tokens(batches) == [5, 4]

    rt = _WorkerGpuRuntime()

    class _Tok:
        pad_token_id = 0
        eos_token_id = 2

        def __call__(self, text, truncation=True, max_length=512, return_tensors="pt"):
            return {"input_ids": torch.tensor([[1, 2, 3, 4, 5, 6]], dtype=torch.long)}

    class _FastLM(nn.Module):
        def __init__(self):
            super().__init__()
            self.emb = nn.Embedding(16, 4)
            self.q_proj = nn.Linear(4, 4)
            self.head = nn.Linear(4, 16)
            self.config = SimpleNamespace(
                model_type="custom",
                tie_word_embeddings=False,
                to_dict=lambda: {"model_type": "custom"},
                get=lambda k, d=None: d,
            )

        def prepare_inputs_for_generation(self, *args, **kwargs):
            return {}

        def forward(self, input_ids=None, labels=None, **kwargs):
            logits = self.head(self.q_proj(self.emb(input_ids)))
            loss = nn.functional.cross_entropy(logits.view(-1, 16), labels.view(-1))
            return SimpleNamespace(loss=loss, logits=logits)

        def unload(self):
            return self

    mock_resp = MagicMock(status_code=200)
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json = MagicMock(return_value={"ckpt_url": "s3://nebula-checkpoints/p5/ep.safetensors"})

    records = [{"instruction": f"prompt {i}", "response": f"ans {i}"} for i in range(6)]
    status_msgs = []

    with (
        patch.object(rt, "ensure_model", return_value=(_FastLM(), _Tok(), "cpu")),
        patch("worker.nebula_worker.requests.post", return_value=mock_resp),
    ):
        res = rt.run_lora_training(
            job_payload={
                "job_id": "job-phase5-tps",
                "base_model_id": "dummy/p5",
                "records": records,
                "total_epochs": 1,
                "batch_size": 2,
                "packing": False,
                "auto_batch": False,
            },
            server_url="http://127.0.0.1:8000",
            worker_id="w-p5",
            headers={},
            on_status=lambda *a: status_msgs.append(a),
        )

    assert res["status"] == "completed"
    assert float(res.get("tokens_per_sec", 0.0)) > 0.0
    assert (get_active_worker_tps() or 0.0) > 0.0
    assert any("tok/s" in str(m[1]) for m in status_msgs)
    clear_active_gpu_telemetry()


def test_orchestrator_throughput_ema_and_calibrated_sharding():
    _WORKER_TPS_RAM_CACHE.clear()
    with patch("app.cluster_worker_router._get_redis_client", return_value=None):
        assert record_worker_throughput_tps("node-rtx", -5.0) is None
        assert record_worker_throughput_tps("node-rtx", 3000.0) == 3000.0
        # EMA: 0.7 * 4000 + 0.3 * 3000 = 3700.0
        assert record_worker_throughput_tps("node-rtx", 4000.0) == 3700.0
        assert record_worker_throughput_tps("node-m4", 600.0) == 600.0

        tps_map = get_worker_throughput_tps(["node-rtx", "node-m4", "node-unknown"])
        assert tps_map == {"node-rtx": 3700.0, "node-m4": 600.0}

        weights = distributed_training_engine.compute_worker_weights(
            ["node-rtx", "node-m4"], measured_tps=tps_map
        )
        # 3700 / 600 = 6.167x faster -> RTX must receive ~6x weight of M4!
        ratio = weights["node-rtx"] / weights["node-m4"]
        assert 5.8 <= ratio <= 6.5

        records = [{"instruction": f"q{i}", "response": f"a{i}"} for i in range(100)]
        shards = distributed_training_engine.partition_dataset_shards(
            records, ["node-rtx", "node-m4"], weights=weights
        )
        assert len(shards["node-rtx"]) >= 80
        assert len(shards["node-m4"]) >= 10
        assert len(shards["node-rtx"]) + len(shards["node-m4"]) == 100

        # Skew clamp test: 500x speed difference caps at 12x weight ratio so peer isn't starved to 0
        capped_w = distributed_training_engine.compute_worker_weights(
            ["fast", "slow"], measured_tps={"fast": 50000.0, "slow": 100.0}
        )
        assert round(capped_w["fast"] / capped_w["slow"], 2) == 12.0
    _WORKER_TPS_RAM_CACHE.clear()
