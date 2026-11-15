#!/usr/bin/env python3
"""
Unit & Integration Tests for Phase 4 Graph Compilation & Silent Governor Cache Preservation:
1. SilentThermalGovernor must NOT flush PyTorch VRAM caches on unleashed <-> stealth_regulated
   transitions, and MUST reclaim once on transition into restricted_pause.
2. _maybe_compile_model gates torch.compile(dynamic=True) cleanly via NEBULA_TORCH_COMPILE=auto|1|0
   with eager fallback if compilation throws.
3. run_lora_training cooperates with silent_governor (0 yield in unleashed, force_sync=False yield
   in stealth_regulated) and extracts PEFT checkpoints from uncompiled peft_model.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import torch
import torch.nn as nn

from worker.nebula_worker import _WorkerGpuRuntime, resolve_architecture_profile
from worker.silent_governor import SilentThermalGovernor


def test_silent_governor_preserves_cache_on_stealth_and_reclaims_on_restricted_pause():
    fake_sensor = SimpleNamespace(
        evaluate_presence_state=lambda: "unleashed",
        get_gpu_temperature=lambda: 55,
    )
    gov = SilentThermalGovernor(sensor=fake_sensor, duty_ratio=2.0)

    with patch.object(gov, "reclaim_vram_headroom", return_value={"freed_mb": 128.0}) as mock_reclaim, \
         patch("time.sleep"):
        # 1. Start unleashed -> no reclaim, zero yield
        r1 = gov.yield_gpu_queue(0.05, presence_state="unleashed")
        assert r1["yield_duration_s"] == 0.0
        assert mock_reclaim.call_count == 0

        # 2. Transition unleashed -> stealth_regulated -> MUST NOT flush allocator cache
        r2 = gov.yield_gpu_queue(0.02, presence_state="stealth_regulated")
        assert r2["state"] == "stealth_regulated"
        assert r2["freed_vram_mb"] == 0.0
        assert mock_reclaim.call_count == 0

        # 3. Transition into restricted_pause -> MUST flush VRAM once cleanly
        r3 = gov.yield_gpu_queue(0.02, presence_state="restricted_pause")
        assert r3["state"] == "restricted_pause"
        assert r3["freed_vram_mb"] == 128.0
        assert mock_reclaim.call_count == 1

        # 4. Subsequent ticks still in restricted_pause -> no redundant repeated flushes
        gov.yield_gpu_queue(0.02, presence_state="restricted_pause")
        assert mock_reclaim.call_count == 1


def test_maybe_compile_model_gating_and_fallback():
    dummy_model = nn.Linear(4, 4)
    cuda_prof = resolve_architecture_profile(
        dev="cuda",
        torch_mod=SimpleNamespace(
            cuda=SimpleNamespace(is_available=lambda: True, is_bf16_supported=lambda: True),
            version=SimpleNamespace(hip=None),
        ),
        platform_name="linux",
    )
    mps_prof = resolve_architecture_profile(
        dev="mps",
        torch_mod=SimpleNamespace(backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False))),
        platform_name="darwin",
    )

    with patch("torch.compile", side_effect=lambda m, **kw: ("COMPILED", m, kw)) as compile_mock:
        # auto + short run -> skipped
        m_short, flag_short = _WorkerGpuRuntime._maybe_compile_model(
            dummy_model, arch_profile=cuda_prof, total_steps=10, is_real_lm=True, env_mode="auto", platform_name="linux"
        )
        assert flag_short is False and m_short is dummy_model

        # auto + Windows -> skipped
        m_win, flag_win = _WorkerGpuRuntime._maybe_compile_model(
            dummy_model, arch_profile=cuda_prof, total_steps=40, is_real_lm=True, env_mode="auto", platform_name="win32"
        )
        assert flag_win is False and m_win is dummy_model

        # auto + MPS -> skipped
        m_mps, flag_mps = _WorkerGpuRuntime._maybe_compile_model(
            dummy_model, arch_profile=mps_prof, total_steps=40, is_real_lm=True, env_mode="auto", platform_name="darwin"
        )
        assert flag_mps is False and m_mps is dummy_model

        # env_mode=0 -> explicitly disabled even on long Linux CUDA
        m_off, flag_off = _WorkerGpuRuntime._maybe_compile_model(
            dummy_model, arch_profile=cuda_prof, total_steps=40, is_real_lm=True, env_mode="0", platform_name="linux"
        )
        assert flag_off is False and m_off is dummy_model
        assert compile_mock.call_count == 0

        # auto + Linux CUDA + >=20 steps + real LM -> compiled with dynamic=True
        m_ok, flag_ok = _WorkerGpuRuntime._maybe_compile_model(
            dummy_model, arch_profile=cuda_prof, total_steps=24, is_real_lm=True, env_mode="auto", platform_name="linux"
        )
        assert flag_ok is True
        assert m_ok[0] == "COMPILED" and m_ok[2].get("dynamic") is True

    # Forced compile failure falls back cleanly to eager without raising
    with patch("torch.compile", side_effect=RuntimeError("Triton backend missing")):
        m_fb, flag_fb = _WorkerGpuRuntime._maybe_compile_model(
            dummy_model, arch_profile=cuda_prof, total_steps=5, is_real_lm=False, env_mode="1", platform_name="win32"
        )
        assert flag_fb is False and m_fb is dummy_model


def test_run_lora_training_with_compiled_wrapper_and_silent_governor():
    rt = _WorkerGpuRuntime()

    class _Tok:
        pad_token_id = 0
        eos_token_id = 2

        def __call__(self, text, truncation=True, max_length=512, return_tensors="pt"):
            return {"input_ids": torch.tensor([[1, 2, 3, 4]], dtype=torch.long)}

    class _MiniLM(nn.Module):
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

    class _CompiledProxy:
        """Simulates torch.compile OptimizedModule forwarding calls while leaving uncompiled peft_model intact."""
        def __init__(self, inner):
            self._inner = inner
            self.calls = 0

        def __call__(self, **kwargs):
            self.calls += 1
            return self._inner(**kwargs)

    state_seq = ["unleashed", "stealth_regulated"]
    state_idx = {"i": 0}

    def _next_state():
        val = state_seq[min(state_idx["i"], len(state_seq) - 1)]
        state_idx["i"] += 1
        return val

    fake_sensor = SimpleNamespace(
        evaluate_presence_state=_next_state,
        get_gpu_temperature=lambda: 56,
    )
    gov = SilentThermalGovernor(sensor=fake_sensor, duty_ratio=2.0)

    mock_resp = MagicMock(status_code=200)
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json = MagicMock(return_value={"ckpt_url": "s3://nebula-checkpoints/p4/ep.safetensors"})

    compiled_holder = {}

    def _fake_maybe_compile(peft_model, **_kwargs):
        proxy = _CompiledProxy(peft_model)
        compiled_holder["proxy"] = proxy
        return proxy, True

    records = [{"instruction": f"hi {i}", "response": f"yo {i}"} for i in range(6)]
    with (
        patch.object(rt, "ensure_model", return_value=(_MiniLM(), _Tok(), "cpu")),
        patch.object(_WorkerGpuRuntime, "_maybe_compile_model", side_effect=_fake_maybe_compile),
        patch.object(gov, "yield_gpu_queue", wraps=gov.yield_gpu_queue) as yield_spy,
        patch.object(gov, "reclaim_vram_headroom") as reclaim_spy,
        patch("worker.nebula_worker.requests.post", return_value=mock_resp),
        patch("worker.silent_governor.time.sleep", return_value=None),
    ):
        res = rt.run_lora_training(
            job_payload={
                "job_id": "job-phase4-compile-silent",
                "base_model_id": "dummy/p4",
                "records": records,
                "total_epochs": 1,
                "batch_size": 2,
                "packing": False,
                "auto_batch": False,
            },
            server_url="http://127.0.0.1:8000",
            worker_id="w-p4",
            headers={},
            silent_governor=gov,
        )

    assert res["status"] == "completed"
    assert compiled_holder["proxy"].calls >= 3
    # First step was 'unleashed' (0 yield calls); subsequent steps in 'stealth_regulated' yielded with force_sync=False
    assert yield_spy.call_count >= 1
    assert all(c.kwargs.get("force_sync") is False for c in yield_spy.call_args_list)
    assert reclaim_spy.call_count == 0
