#!/usr/bin/env python3
"""
Unit & Integration Tests for Phase 1 GPU Utilization Optimization & Live Telemetry:
1. Orchestrator dispatch payload propagation (`batch_size`, `max_seq_length`, `gradient_accumulation_steps`, `packing`).
2. Length-sorted micro-batch collation with `-100` pad label masking.
3. Trainable-only fused/foreach optimizer construction.
4. Asynchronous background checkpoint uploader ordering & completion before `run_lora_training` returns.
5. `ensure_model` SDPA fallback compatibility.
6. Non-root macOS IOAccelerator telemetry parsing and active rolling compute telemetry overlay lifecycle.
"""

import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import torch
import torch.nn as nn

from app.training_engine import build_training_dispatch_payload
from worker.hardware_detector import probe_macos_gpu_live_telemetry
from worker.nebula_worker import (
    _WorkerGpuRuntime,
    _apply_active_telemetry_overlay,
    clear_active_gpu_telemetry,
    get_active_gpu_telemetry,
    record_active_gpu_telemetry,
)


def test_build_training_dispatch_payload_propagates_batch_and_packing_params():
    dp = build_training_dispatch_payload(
        job_id="job-phase1-01",
        worker_id="node-skorp",
        base_model_id="Qwen/Qwen2.5-0.5B-Instruct",
        dataset_s3_url="s3://nebula-datasets/sample.jsonl",
        total_epochs=3,
        batch_size=8,
        max_seq_length=1024,
        gradient_accumulation_steps=4,
        packing=True,
    )
    assert dp["batch_size"] == 8
    assert dp["max_seq_length"] == 1024
    assert dp["gradient_accumulation_steps"] == 4
    assert dp["packing"] is True

    dp_defaults = build_training_dispatch_payload(
        job_id="job-phase1-02",
        worker_id="node-mac",
        base_model_id="Qwen/Qwen2.5-0.5B-Instruct",
        dataset_s3_url=None,
        total_epochs=1,
    )
    assert dp_defaults["batch_size"] == 4
    assert dp_defaults["max_seq_length"] == 512
    assert dp_defaults["gradient_accumulation_steps"] == 1
    assert dp_defaults["packing"] is False


def test_collate_micro_batches_sorts_by_length_and_masks_padding():
    seqs = [
        torch.tensor([10, 11, 12, 13, 14, 15], dtype=torch.long),  # len 6
        torch.tensor([20, 21], dtype=torch.long),                  # len 2
        torch.tensor([30, 31, 32], dtype=torch.long),              # len 3
        torch.tensor([40, 41, 42, 43, 44, 45], dtype=torch.long),  # len 6
    ]
    batches = _WorkerGpuRuntime._collate_micro_batches(
        seqs, micro_batch_size=2, pad_token_id=99, pin_memory=False, sort_by_length=True
    )
    # Sorted lengths: [2, 3] -> pad to 3; [6, 6] -> equal len, no pad/mask needed!
    assert len(batches) == 2

    ids0, labels0, mask0 = batches[0]
    assert ids0.shape == (2, 3)
    assert mask0 is not None
    assert mask0[0].tolist() == [1, 1, 0]
    assert ids0[0].tolist() == [20, 21, 99]
    assert labels0[0].tolist() == [20, 21, -100]
    assert mask0[1].tolist() == [1, 1, 1]
    assert labels0[1].tolist() == [30, 31, 32]

    ids1, labels1, mask1 = batches[1]
    assert ids1.shape == (2, 6)
    assert mask1 is None
    assert torch.equal(ids1, labels1)


def test_create_lora_optimizer_selects_only_trainable_params():
    class _FrozenAndLora(nn.Module):
        def __init__(self):
            super().__init__()
            self.frozen = nn.Linear(4, 4)
            for p in self.frozen.parameters():
                p.requires_grad = False
            self.lora_a = nn.Linear(4, 2, bias=False)

    model = _FrozenAndLora()
    opt, trainable = _WorkerGpuRuntime._create_lora_optimizer(model, lr=1e-4, dev="cpu")
    assert len(trainable) == 1
    assert trainable[0] is model.lora_a.weight
    assert len(opt.param_groups[0]["params"]) == 1


def test_run_lora_training_batched_grad_accum_and_async_checkpoint_order():
    rt = _WorkerGpuRuntime()

    class _VarLenTokenizer:
        pad_token_id = 0
        eos_token_id = 2

        def __call__(self, text, truncation=True, max_length=512, return_tensors="pt"):
            # Produce deterministic variable-length sequences based on text length
            tok_len = max(2, min(12, len(text) % 10 + 3))
            return {"input_ids": torch.arange(1, tok_len + 1, dtype=torch.long).unsqueeze(0)}

    class _TrainableTinyModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.emb = nn.Embedding(64, 8)
            self.q_proj = nn.Linear(8, 8)
            self.head = nn.Linear(8, 64)
            self.config = SimpleNamespace(
                model_type="custom",
                tie_word_embeddings=False,
                to_dict=lambda: {"model_type": "custom"},
                get=lambda k, d=None: d,
            )

        def prepare_inputs_for_generation(self, *args, **kwargs):
            return {}

        def forward(self, input_ids=None, labels=None, attention_mask=None, **kwargs):
            x = self.q_proj(self.emb(input_ids))
            logits = self.head(x)
            loss_fn = nn.CrossEntropyLoss(ignore_index=-100)
            loss = loss_fn(logits.view(-1, 64), labels.view(-1))
            return SimpleNamespace(loss=loss)

        def unload(self):
            return self

    model = _TrainableTinyModel()
    observed_batches = []
    orig_forward = model.forward

    def _spy_forward(input_ids=None, labels=None, attention_mask=None, **kwargs):
        if model.training:
            observed_batches.append(tuple(input_ids.shape))
        return orig_forward(input_ids=input_ids, labels=labels, attention_mask=attention_mask, **kwargs)

    model.forward = _spy_forward

    records = [{"instruction": f"prompt {'x' * i}", "response": f"ans {'y' * (i * 2)}"} for i in range(6)]
    epoch_events = []
    status_events = []
    upload_epochs = []

    def _mock_post(url, headers=None, json=None, timeout=None):
        upload_epochs.append(json["epoch"])
        time.sleep(0.03)
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = {
            "ckpt_url": f"http://mock/ckpt_ep_{json['epoch']}.safetensors",
            "size_bytes": 128,
        }
        return resp

    with patch.object(rt, "ensure_model", return_value=(model, _VarLenTokenizer(), "cpu")), \
         patch("worker.nebula_worker.requests.post", side_effect=_mock_post):
        res = rt.run_lora_training(
            job_payload={
                "job_id": "job-phase1-async",
                "base_model_id": "dummy/tiny",
                "records": records,
                "total_epochs": 2,
                "batch_size": 2,
                "gradient_accumulation_steps": 2,
                "max_seq_length": 64,
            },
            server_url="http://127.0.0.1:8000",
            worker_id="w-phase1",
            headers={},
            on_epoch=lambda ep, loss, val, url, sz: epoch_events.append((ep, url)),
            on_status=lambda phase, detail, pct, dl, tot: status_events.append(phase),
        )

    assert res["status"] == "completed"
    assert res["total_epochs"] == 2
    assert res["final_adapter_url"] == "http://mock/ckpt_ep_2.safetensors"
    assert upload_epochs == [1, 2]
    assert epoch_events == [
        (1, "http://mock/ckpt_ep_1.safetensors"),
        (2, "http://mock/ckpt_ep_2.safetensors"),
    ]
    # 6 records -> 90% = 5 train samples -> with batch_size=2 -> 3 batches per epoch across 2 epochs = 6 forward batches
    assert len(observed_batches) == 6
    assert observed_batches[0][0] == 2
    assert "training" in status_events


def test_macos_ioreg_live_telemetry_and_active_compute_overlay():
    clear_active_gpu_telemetry()
    sample_ioreg = '''
    +-o AGXAcceleratorG16G <class AGXAcceleratorG16G, id 0x100000412>
        "PerformanceStatistics" = {"Device Utilization %"=76,"Renderer Utilization %"=74,"In use system memory"=4831838208}
    '''
    with patch("worker.hardware_detector.platform.system", return_value="Darwin"), \
         patch("worker.hardware_detector._run_cmd_clean", return_value=sample_ioreg):
        util_pct, mem_gb = probe_macos_gpu_live_telemetry(total_ram_gb=16.0, mps_available=False)

    assert util_pct == 76.0
    assert mem_gb == 4.5

    record_active_gpu_telemetry(84.5, 5.25)
    act_u, act_v = get_active_gpu_telemetry()
    assert act_u == 84.5
    assert act_v == 5.25

    hw = _apply_active_telemetry_overlay({
        "gpu_utilization_pct": 0.0,
        "vram_used_gb": 1.1,
        "gpus": [{"gpu_utilization_pct": 0.0, "vram_used_gb": 1.1}],
    })
    assert hw["gpu_utilization_pct"] == 84.5
    assert hw["vram_used_gb"] == 5.25
    assert hw["gpus"][0]["gpu_utilization_pct"] == 84.5

    clear_active_gpu_telemetry()
    assert get_active_gpu_telemetry() == (None, None)


def test_ensure_model_requests_sdpa_and_falls_back_cleanly():
    rt = _WorkerGpuRuntime()
    seen_kwargs = []

    class _FakeModel:
        def parameters(self):
            return iter([torch.zeros(1)])

    def _fake_from_pretrained(model_id, **kwargs):
        seen_kwargs.append(dict(kwargs))
        if "attn_implementation" in kwargs:
            raise ValueError("attn_implementation='sdpa' unsupported for custom model")
        return _FakeModel()

    fake_tok = SimpleNamespace(pad_token="</s>", eos_token="</s>")
    with patch.object(rt, "_get_device", return_value="mps"), \
         patch("transformers.AutoTokenizer.from_pretrained", return_value=fake_tok), \
         patch("transformers.AutoModelForCausalLM.from_pretrained", side_effect=_fake_from_pretrained):
        model, tok, dev = rt.ensure_model("dummy/custom-model", for_training=True, train_type="lora")

    assert dev == "mps"
    assert tok is fake_tok
    assert len(seen_kwargs) == 2
    assert seen_kwargs[0].get("attn_implementation") == "sdpa"
    assert "attn_implementation" not in seen_kwargs[1]

