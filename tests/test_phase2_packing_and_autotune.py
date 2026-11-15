#!/usr/bin/env python3
"""
Unit & Integration Tests for Phase 2 GPU Optimization:
1. 1D Sequence Packing (FFD bin packing, position_ids resets, -100 doc-boundary label masking,
   and 4D block-diagonal causal attention isolation).
2. Cross-document attention invariance verified through real HuggingFace Qwen2ForCausalLM SDPA.
3. Contributor --vram-pct tracking, VRAM-aware micro-batch auto-tuner, and architecture-gated
   DataLoader pin_memory / num_workers selection.
4. Reactive OOM micro-batch backoff and end-to-end packed PEFT LoRA training inside run_lora_training.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import torch
import torch.nn as nn

from worker.nebula_worker import (
    _WorkerGpuRuntime,
    apply_vram_limit,
    get_current_vram_allocation_pct,
)


def test_pack_sequences_ffd_resets_positions_masks_boundaries_and_blocks_cross_doc_attention():
    # 4 short sequences (lens 4, 3, 5, 2) + eos appended -> should pack cleanly into 2 bins of cap=10
    seqs = [
        torch.tensor([11, 12, 13, 14], dtype=torch.long),
        torch.tensor([21, 22, 23], dtype=torch.long),
        torch.tensor([31, 32, 33, 34, 35], dtype=torch.long),
        torch.tensor([41, 42], dtype=torch.long),
    ]
    packed = _WorkerGpuRuntime._pack_sequences_ffd(
        seqs,
        max_seq_length=10,
        micro_batch_size=1,
        pad_token_id=0,
        pin_memory=False,
        eos_token_id=2,
    )
    # FFD with cap=10 (with +1 EOS each), sorted shortest-first for clean padding:
    # bin 0: len5 [11..14,2] + len3 [41,42,2] = 8
    # bin 1: len6 [31..35,2] + len4 [21..23,2] = 10
    assert len(packed) == 2

    ids0, labels0, mask0, pos0 = packed[0]
    assert ids0.shape == (1, 8)
    assert pos0.tolist() == [[0, 1, 2, 3, 4, 0, 1, 2]]
    # Opening token of doc 2 (index 5) MUST be masked with -100 so doc 1's EOS isn't trained to predict doc 2
    assert labels0[0, 5].item() == -100
    assert labels0[0, 4].item() == 2
    assert labels0[0, 6].item() == 42

    # Verify 4D block-diagonal causal mask prevents doc 2 (idx >= 5) from attending to doc 1 (idx < 5)
    assert mask0 is not None and mask0.dim() == 4
    assert mask0[0, 0, 6, 5].item() == 0.0        # doc 2 attends to earlier token in doc 2
    assert mask0[0, 0, 5, 6].item() < -1e4        # future token masked
    assert mask0[0, 0, 6, 2].item() < -1e4        # doc 1 token masked from doc 2!

    ids1, labels1, mask1, pos1 = packed[1]
    assert ids1.shape == (1, 10)
    assert pos1.tolist() == [[0, 1, 2, 3, 4, 5, 0, 1, 2, 3]]
    assert labels1[0, 6].item() == -100


def test_packed_sdpa_cross_document_isolation_on_real_hf_model():
    from transformers import Qwen2Config, Qwen2ForCausalLM

    cfg = Qwen2Config(
        vocab_size=64,
        hidden_size=32,
        intermediate_size=64,
        num_hidden_layers=2,
        num_attention_heads=4,
        num_key_value_heads=2,
    )
    cfg._attn_implementation = "sdpa"
    model = Qwen2ForCausalLM(cfg)
    model.eval()

    doc1_a = torch.tensor([5, 6, 7, 8, 2], dtype=torch.long)
    doc1_b = torch.tensor([15, 16, 17, 18, 2], dtype=torch.long)
    doc2 = torch.tensor([9, 10, 11, 12, 2], dtype=torch.long)

    b_a = _WorkerGpuRuntime._pack_sequences_ffd(
        [doc1_a, doc2], max_seq_length=12, micro_batch_size=1, pad_token_id=0, eos_token_id=2
    )
    b_b = _WorkerGpuRuntime._pack_sequences_ffd(
        [doc1_b, doc2], max_seq_length=12, micro_batch_size=1, pad_token_id=0, eos_token_id=2
    )
    ids_a, labels_a, mask_a, pos_a = b_a[0]
    ids_b, labels_b, mask_b, pos_b = b_b[0]

    with torch.no_grad():
        out_a = model(input_ids=ids_a, attention_mask=mask_a, position_ids=pos_a, labels=labels_a)
        out_b = model(input_ids=ids_b, attention_mask=mask_b, position_ids=pos_b, labels=labels_b)

    # Identical doc2 tokens at indices 5..9 MUST produce identical logits regardless of doc1!
    doc2_logits_a = out_a.logits[:, 5:, :]
    doc2_logits_b = out_b.logits[:, 5:, :]
    assert torch.allclose(doc2_logits_a, doc2_logits_b, atol=1e-5, rtol=1e-5)
    assert torch.isfinite(out_a.loss)


def test_vram_pct_tracking_and_architecture_gated_batch_plan():
    prev_pct = get_current_vram_allocation_pct()
    try:
        res_80 = apply_vram_limit(80)
        assert res_80["vram_allocation_pct"] == 80
        assert get_current_vram_allocation_pct() == 80

        rt = _WorkerGpuRuntime()
        dummy_lm = SimpleNamespace(
            config=SimpleNamespace(hidden_size=896, num_hidden_layers=24, vocab_size=32000),
            parameters=lambda: [],
        )

        # Generous 8 GB discrete GPU at 80% with small model loaded (1.1 GB) -> scales up micro_batch_size
        plan_high = rt._resolve_execution_batch_plan(
            dev="cuda",
            model=dummy_lm,
            requested_batch_size=2,
            requested_grad_accum=4,
            effective_seq_len=512,
            vram_allocation_pct=80,
            total_vram_gb=8.0,
            allocated_vram_gb=1.1,
            arch_type="cuda",
            platform_name="linux",
        )
        assert plan_high["micro_batch_size"] >= 4
        assert plan_high["micro_batch_size"] * plan_high["grad_accum_steps"] >= 8
        assert plan_high["pin_memory"] is True
        assert plan_high["num_workers"] == 2

        # Same GPU on Windows -> keeps pin_memory=True but forces num_workers=0 to prevent spawn hangs
        plan_win = rt._resolve_execution_batch_plan(
            dev="cuda",
            model=dummy_lm,
            requested_batch_size=4,
            requested_grad_accum=1,
            effective_seq_len=512,
            vram_allocation_pct=80,
            total_vram_gb=8.0,
            allocated_vram_gb=1.1,
            arch_type="cuda",
            platform_name="win32",
        )
        assert plan_win["pin_memory"] is True
        assert plan_win["num_workers"] == 0

        # Tight --vram-pct=20 -> shrinks micro_batch_size safely to avoid exceeding user cap
        plan_tight = rt._resolve_execution_batch_plan(
            dev="cuda",
            model=dummy_lm,
            requested_batch_size=8,
            requested_grad_accum=1,
            effective_seq_len=512,
            vram_allocation_pct=20,
            total_vram_gb=8.0,
            allocated_vram_gb=1.0,
            arch_type="cuda",
            platform_name="win32",
        )
        assert plan_tight["micro_batch_size"] <= 2
        assert plan_tight["micro_batch_size"] * plan_tight["grad_accum_steps"] >= 8

        # Apple Silicon MPS Unified Memory -> pin_memory=False, num_workers=0
        plan_mps = rt._resolve_execution_batch_plan(
            dev="mps",
            model=dummy_lm,
            requested_batch_size=2,
            requested_grad_accum=2,
            effective_seq_len=512,
            vram_allocation_pct=80,
            total_vram_gb=12.0,
            allocated_vram_gb=1.5,
            arch_type="apple_mps",
            platform_name="darwin",
        )
        assert plan_mps["pin_memory"] is False
        assert plan_mps["num_workers"] == 0

        # AMD ROCm & Intel XPU discrete accelerators on Linux -> pin_memory=True, num_workers=2
        for arch in ("amd_rocm", "intel_xpu"):
            pin, workers = _WorkerGpuRuntime._resolve_dataloader_config(
                "cuda", arch_type=arch, platform_name="linux"
            )
            assert pin is True
            assert workers == 2
    finally:
        apply_vram_limit(prev_pct)


def test_run_lora_training_reactive_oom_backoff_completes_cleanly():
    rt = _WorkerGpuRuntime()

    class _VarTok:
        pad_token_id = 0
        eos_token_id = 2

        def __call__(self, text, truncation=True, max_length=512, return_tensors="pt"):
            tlen = max(3, min(10, len(text) % 8 + 3))
            return {"input_ids": torch.arange(1, tlen + 1, dtype=torch.long).unsqueeze(0)}

    class _OomOnBatch4Model(nn.Module):
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
            self.observed_batch_sizes = []

        def prepare_inputs_for_generation(self, *args, **kwargs):
            return {}

        def forward(self, input_ids=None, labels=None, **kwargs):
            bsz = int(input_ids.shape[0])
            self.observed_batch_sizes.append(bsz)
            if self.training and bsz >= 4:
                raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")
            logits = self.head(self.q_proj(self.emb(input_ids)))
            loss = nn.functional.cross_entropy(logits.view(-1, 64), labels.clamp(min=0).view(-1))
            return SimpleNamespace(loss=loss, logits=logits)

        def unload(self):
            return self

    model = _OomOnBatch4Model()
    mock_resp = MagicMock(status_code=200)
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json = MagicMock(return_value={"ckpt_url": "s3://nebula-checkpoints/oom/ep.safetensors"})

    records = [{"instruction": f"q {i}" * ((i % 3) + 1), "response": f"a {i}"} for i in range(10)]
    epochs_done = []

    with (
        patch.object(rt, "ensure_model", return_value=(model, _VarTok(), "cpu")),
        patch.object(_WorkerGpuRuntime, "_clear_device_cache") as mock_clear,
        patch("worker.nebula_worker.requests.post", return_value=mock_resp),
        patch("worker.nebula_worker.time.sleep", return_value=None),
    ):
        res = rt.run_lora_training(
            job_payload={
                "job_id": "job-phase2-oom",
                "base_model_id": "dummy/oom",
                "records": records,
                "total_epochs": 2,
                "batch_size": 4,
                "packing": False,
                "auto_batch": False,
            },
            server_url="http://127.0.0.1:8000",
            worker_id="w-oom",
            headers={},
            on_epoch=lambda ep, *a: epochs_done.append(ep),
        )

    assert res["status"] == "completed"
    assert res["total_epochs"] == 2
    assert epochs_done == [1, 2]
    assert mock_clear.called
    # First attempt saw bsz=4 (failed), then dynamically backed off to bsz <= 2 for all remaining steps
    assert 4 in model.observed_batch_sizes
    assert 2 in model.observed_batch_sizes


def test_run_lora_training_with_real_peft_qwen_and_packing():
    from transformers import Qwen2Config, Qwen2ForCausalLM

    rt = _WorkerGpuRuntime()
    cfg = Qwen2Config(
        vocab_size=128,
        hidden_size=32,
        intermediate_size=64,
        num_hidden_layers=1,
        num_attention_heads=4,
        num_key_value_heads=2,
    )
    cfg._attn_implementation = "sdpa"
    tiny_qwen = Qwen2ForCausalLM(cfg)

    class _MiniTok:
        pad_token_id = 0
        eos_token_id = 2

        def __call__(self, text, truncation=True, max_length=512, return_tensors="pt"):
            tlen = max(6, min(20, len(text) % 15 + 6))
            return {"input_ids": torch.randint(3, 120, (1, tlen), dtype=torch.long)}

    mock_resp = MagicMock(status_code=200)
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json = MagicMock(return_value={"ckpt_url": "s3://nebula-checkpoints/packed/ep1.safetensors"})

    records = [{"instruction": f"prompt number {i}", "response": f"answer {i}"} for i in range(12)]
    epochs_done = []

    with (
        patch.object(rt, "ensure_model", return_value=(tiny_qwen, _MiniTok(), "cpu")),
        patch("worker.nebula_worker.requests.post", return_value=mock_resp),
        patch("worker.nebula_worker.time.sleep", return_value=None),
    ):
        res = rt.run_lora_training(
            job_payload={
                "job_id": "job-phase2-packed-qwen",
                "base_model_id": "dummy/tiny-qwen",
                "records": records,
                "total_epochs": 1,
                "batch_size": 2,
                "max_seq_length": 64,
                "packing": True,
            },
            server_url="http://127.0.0.1:8000",
            worker_id="w-packed",
            headers={},
            on_epoch=lambda ep, *a: epochs_done.append(ep),
        )

    assert res["status"] == "completed"
    assert res["total_epochs"] == 1
    assert epochs_done == [1]
    assert res["final_loss"] > 0.0
