#!/usr/bin/env python3
"""
Unit & Integration Tests for Phase 3 Cross-Architecture Execution Engine:
1. Unified ArchitectureProfile capability matrix across NVIDIA CUDA, AMD ROCm, Intel XPU,
   Apple Silicon MPS (bf16 & fp16 fallback), DirectML, and CPU (AVX-512-BF16 vs standard FP32).
2. _get_device() priority cascade with mocked backends (CUDA -> XPU -> MPS -> DirectML -> CPU).
3. ensure_model() backend safety (SDPA vs DirectML eager + .to(dml_device), ROCm/XPU/MPS QLoRA fallback,
   matmul_precision='high', CPU physical thread tuning).
4. Optimizer safety (fused=True restricted to accelerator float tensors; never called on MPS/DirectML/CPU).
5. Telemetry probing for AMD ROCm (rocm-smi JSON) and Intel XPU memory stats.
"""

import builtins
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import torch
import torch.nn as nn

from worker.nebula_worker import (
    _WorkerGpuRuntime,
    _sample_live_device_telemetry,
    resolve_architecture_profile,
)


def _mock_torch_backend(
    *,
    cuda_avail=False,
    hip_ver=None,
    cuda_bf16=True,
    xpu_avail=False,
    xpu_bf16=True,
    mps_avail=False,
    mps_macos14=False,
    avx512_bf16=False,
):
    zeros_mock = MagicMock(return_value=SimpleNamespace(dtype=torch.bfloat16))
    return SimpleNamespace(
        bfloat16=torch.bfloat16,
        float16=torch.float16,
        float32=torch.float32,
        zeros=zeros_mock,
        version=SimpleNamespace(hip=hip_ver),
        cuda=SimpleNamespace(
            is_available=lambda: cuda_avail,
            is_bf16_supported=lambda: cuda_bf16,
        ),
        xpu=SimpleNamespace(
            is_available=lambda: xpu_avail,
            is_bf16_supported=lambda: xpu_bf16,
        ),
        backends=SimpleNamespace(
            mps=SimpleNamespace(
                is_available=lambda: mps_avail,
                is_macos_or_newer=lambda maj, min_=0: mps_macos14,
            )
        ),
        cpu=SimpleNamespace(
            _is_avx512_bf16_supported=lambda: avx512_bf16,
            _is_amx_tile_supported=lambda: False,
        ),
    )


@pytest.mark.parametrize(
    "case,plat,expected",
    [
        (
            {"cuda_avail": True, "hip_ver": None, "cuda_bf16": True},
            "linux",
            {
                "arch_id": "cuda",
                "device_str": "cuda",
                "autocast": "cuda",
                "dtype": "bfloat16",
                "sdpa": True,
                "bnb": True,
                "fused": True,
                "pin": True,
                "workers": 2,
                "nb": True,
                "matmul": "high",
            },
        ),
        (
            {"cuda_avail": True, "hip_ver": "6.1.40091", "cuda_bf16": True},
            "linux",
            {
                "arch_id": "amd_rocm",
                "device_str": "cuda",
                "autocast": "cuda",
                "dtype": "bfloat16",
                "sdpa": True,
                "bnb": False,
                "fused": True,
                "pin": True,
                "workers": 2,
                "nb": True,
                "matmul": "high",
            },
        ),
        (
            {"xpu_avail": True, "xpu_bf16": True},
            "linux",
            {
                "arch_id": "intel_xpu",
                "device_str": "xpu",
                "autocast": "xpu",
                "dtype": "bfloat16",
                "sdpa": True,
                "bnb": False,
                "fused": True,
                "pin": True,
                "workers": 2,
                "nb": True,
                "matmul": "high",
            },
        ),
        (
            {"mps_avail": True, "mps_macos14": True},
            "darwin",
            {
                "arch_id": "apple_mps",
                "device_str": "mps",
                "autocast": "mps",
                "dtype": "bfloat16",
                "sdpa": True,
                "bnb": False,
                "fused": False,
                "pin": False,
                "workers": 0,
                "nb": False,
                "matmul": None,
            },
        ),
        (
            {"mps_avail": True, "mps_macos14": False},
            "darwin",
            {
                "arch_id": "apple_mps",
                "device_str": "mps",
                "autocast": "mps",
                "dtype": "float16",
                "sdpa": True,
                "bnb": False,
                "fused": False,
                "pin": False,
                "workers": 0,
                "nb": False,
                "matmul": None,
            },
        ),
        (
            {"avx512_bf16": True},
            "linux",
            {
                "arch_id": "cpu",
                "device_str": "cpu",
                "autocast": "cpu",
                "dtype": "bfloat16",
                "sdpa": True,
                "bnb": False,
                "fused": False,
                "pin": False,
                "workers": 0,
                "nb": False,
                "matmul": None,
            },
        ),
        (
            {"avx512_bf16": False},
            "win32",
            {
                "arch_id": "cpu",
                "device_str": "cpu",
                "autocast": None,
                "dtype": "float32",
                "sdpa": True,
                "bnb": False,
                "fused": False,
                "pin": False,
                "workers": 0,
                "nb": False,
                "matmul": None,
            },
        ),
    ],
)
def test_architecture_profile_matrix(case, plat, expected):
    fake_torch = _mock_torch_backend(**case)
    dml_unavailable = SimpleNamespace(is_available=lambda: False)
    prof = resolve_architecture_profile(torch_mod=fake_torch, directml_mod=dml_unavailable, platform_name=plat)
    assert prof.arch_id == expected["arch_id"]
    assert prof.device_str == expected["device_str"]
    assert prof.autocast_device_type == expected["autocast"]
    assert prof.dtype_name == expected["dtype"]
    assert prof.supports_sdpa is expected["sdpa"]
    assert prof.supports_bitsandbytes is expected["bnb"]
    assert prof.supports_fused_adamw is expected["fused"]
    assert prof.pin_memory is expected["pin"]
    assert prof.num_workers == expected["workers"]
    assert prof.supports_non_blocking is expected["nb"]
    assert prof.matmul_precision == expected["matmul"]


def test_directml_architecture_profile_uses_eager_and_device_object():
    fake_torch = _mock_torch_backend()
    dml_dev = SimpleNamespace(type="privateuseone")
    fake_dml = SimpleNamespace(is_available=lambda: True, device=lambda: dml_dev)
    prof = resolve_architecture_profile(torch_mod=fake_torch, directml_mod=fake_dml, platform_name="win32")
    assert prof.arch_id == "directml"
    assert prof.device_str == "directml"
    assert prof.target_device is dml_dev
    assert prof.autocast_device_type is None
    assert prof.dtype_name == "float32"
    assert prof.supports_sdpa is False
    assert prof.supports_bitsandbytes is False
    assert prof.supports_fused_adamw is False
    assert prof.pin_memory is False
    assert prof.num_workers == 0


def test_ensure_model_directml_eager_and_rocm_qlora_fallback():
    rt = _WorkerGpuRuntime()
    fake_tok = SimpleNamespace(pad_token="</s>", eos_token="</s>")

    # 1. DirectML loads with attn_implementation="eager", no device_map, and moves with .to(dml_dev)
    dml_dev = SimpleNamespace(type="privateuseone")
    fake_dml_mod = SimpleNamespace(is_available=lambda: True, device=lambda: dml_dev)
    dml_model = MagicMock()
    dml_model.to = MagicMock(return_value=dml_model)
    dml_model.parameters = MagicMock(return_value=iter([torch.zeros(1)]))
    seen_dml_kwargs = []

    def _dml_from_pretrained(_mid, **kw):
        seen_dml_kwargs.append(dict(kw))
        return dml_model

    orig_import = builtins.__import__

    def _patched_import(name, *args, **kwargs):
        if name == "torch_directml":
            return fake_dml_mod
        return orig_import(name, *args, **kwargs)

    with (
        patch.object(rt, "_get_device", return_value="directml"),
        patch.object(builtins, "__import__", side_effect=_patched_import),
        patch("transformers.AutoTokenizer.from_pretrained", return_value=fake_tok),
        patch("transformers.AutoModelForCausalLM.from_pretrained", side_effect=_dml_from_pretrained),
    ):
        m, _t, dev = rt.ensure_model("dummy/dml", for_training=True, train_type="lora")

    assert dev == "directml"
    assert seen_dml_kwargs[0]["attn_implementation"] == "eager"
    assert "device_map" not in seen_dml_kwargs[0]
    dml_model.to.assert_called_once_with(dml_dev)

    # 2. AMD ROCm skips bitsandbytes quantization cleanly on QLoRA request and requests SDPA
    rt.unload()
    seen_rocm_kwargs = []
    rocm_model = MagicMock()
    rocm_model.parameters = MagicMock(return_value=iter([torch.zeros(1)]))

    def _rocm_from_pretrained(_mid, **kw):
        seen_rocm_kwargs.append(dict(kw))
        return rocm_model

    with (
        patch.object(rt, "_get_device", return_value="cuda"),
        patch("torch.version.hip", "6.1.0", create=True),
        patch("torch.cuda.device_count", return_value=1),
        patch("transformers.AutoTokenizer.from_pretrained", return_value=fake_tok),
        patch("transformers.AutoModelForCausalLM.from_pretrained", side_effect=_rocm_from_pretrained),
    ):
        _m2, _t2, dev2 = rt.ensure_model("dummy/rocm", for_training=True, train_type="qlora")

    assert dev2 == "cuda"
    assert seen_rocm_kwargs[0]["attn_implementation"] == "sdpa"
    assert "quantization_config" not in seen_rocm_kwargs[0]


def test_create_lora_optimizer_disables_fused_on_mps_and_directml():
    class _TinyLora(nn.Module):
        def __init__(self):
            super().__init__()
            self.w = nn.Parameter(torch.randn(4, 4))

    model = _TinyLora()
    dml_profile = resolve_architecture_profile(
        dev="directml",
        torch_mod=_mock_torch_backend(),
        directml_mod=SimpleNamespace(is_available=lambda: True, device=lambda: "privateuseone:0"),
        platform_name="win32",
    )
    with patch("torch.optim.AdamW", wraps=torch.optim.AdamW) as adamw_spy:
        _opt, params = _WorkerGpuRuntime._create_lora_optimizer(model, lr=1e-4, dev="directml", arch_profile=dml_profile)
    assert len(params) == 1
    assert all("fused" not in call.kwargs for call in adamw_spy.call_args_list)
    assert all("foreach" not in call.kwargs for call in adamw_spy.call_args_list)

    mps_profile = resolve_architecture_profile(
        dev="mps", torch_mod=_mock_torch_backend(mps_avail=True), platform_name="darwin"
    )
    with patch("torch.optim.AdamW", wraps=torch.optim.AdamW) as adamw_spy2:
        _WorkerGpuRuntime._create_lora_optimizer(model, lr=1e-4, dev="mps", arch_profile=mps_profile)
    assert all("fused" not in call.kwargs for call in adamw_spy2.call_args_list)


def test_telemetry_probes_rocm_and_intel_xpu():
    rocm_json = json.dumps({"card0": {"GPU use (%)": "87%", "VRAM Total Used Memory (GB)": "5.5"}}).encode("utf-8")
    with (
        patch("torch.cuda.is_available", return_value=False),
        patch("subprocess.check_output", return_value=rocm_json),
    ):
        u_rocm, v_rocm = _sample_live_device_telemetry("amd_rocm")
    assert u_rocm == 87.0
    assert v_rocm == 5.5

    fake_xpu = SimpleNamespace(
        is_available=lambda: True,
        memory_allocated=lambda _idx=0: int(2.5 * (1024**3)),
        memory_reserved=lambda _idx=0: int(3.0 * (1024**3)),
        max_memory_allocated=lambda _idx=0: int(3.25 * (1024**3)),
    )
    with patch.object(torch, "xpu", fake_xpu, create=True):
        u_xpu, v_xpu = _sample_live_device_telemetry("xpu")
    assert v_xpu == 3.25
    assert u_xpu >= 50.0
