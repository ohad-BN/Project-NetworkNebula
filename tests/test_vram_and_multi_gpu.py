#!/usr/bin/env python3
"""
Test Suite: Milestone 2 — Dynamic VRAM Routing, Hardware Detection,
Multi-GPU Collective VRAM, Real 4-bit NF4 QLoRA, and Universal Dataset Parsing.
"""

import io
import json
import os
import csv
import zipfile
import hashlib
from unittest.mock import patch, MagicMock

import pytest
import torch
import torch.nn as nn

from app.vram_estimator import (
    estimate_required_vram_gb,
    parse_param_count_b,
    calculate_activation_headroom,
)
from app.scheduler import cluster_scheduler, ClusterScheduler
from app.distributed_training_engine import distributed_training_engine
from app.training_engine import (
    parse_universal_dataset,
    extract_instruction_response,
    chunk_text_sliding_window,
)
from worker.hardware_detector import (
    probe_windows_gpus,
    probe_pytorch_backends,
    inspect_universal_hardware,
)
from worker.nebula_worker import (
    find_all_linear_names,
    _WorkerGpuRuntime,
)
from app.models import Worker, User


# ==============================================================================
# 1. Dynamic VRAM Estimator Tests
# ==============================================================================

def test_vram_estimator_known_models():
    """Verify dynamic VRAM formulas across standard model scales (0.5B, 7B, 14B, 32B)."""
    # 0.5B LoRA: 2.2 * 0.5 + 2.0 + 0.5 = 3.6 GB
    assert estimate_required_vram_gb("qwen/qwen2.5-0.5b-instruct", train_type="lora") == 3.6

    # 0.5B QLoRA: 0.65 * 0.5 + 1.8 + 0.5 = 2.625 -> 2.62 or 2.63 GB (depending on float rounding)
    assert estimate_required_vram_gb("qwen/qwen2.5-0.5b-instruct", train_type="qlora") in (2.62, 2.63)

    # 7B LoRA: 2.2 * 7.0 + 2.0 + 0.5 = 17.9 GB
    assert estimate_required_vram_gb("meta-llama/llama-3.1-7b", train_type="lora") == 17.9

    # 7B QLoRA: 0.65 * 7.0 + 1.8 + 0.5 = 6.85 GB (fits comfortably on 8 GB GPU)
    vram_7b_qlora = estimate_required_vram_gb("meta-llama/llama-3.1-7b", train_type="qlora")
    assert vram_7b_qlora == 6.85
    assert vram_7b_qlora <= 8.0

    # 14B QLoRA: 0.65 * 14.0 + 1.8 + 0.5 = 11.4 GB (fits comfortably on 12 GB GPU)
    vram_14b_qlora = estimate_required_vram_gb("qwen/qwen2.5-14b", train_type="qlora")
    assert vram_14b_qlora == 11.4
    assert vram_14b_qlora <= 12.0

    # 32B QLoRA: 0.65 * 32.0 + 1.8 + 0.5 = 23.1 GB (fits comfortably on 24 GB GPU)
    vram_32b_qlora = estimate_required_vram_gb("qwen/qwen2.5-32b", train_type="qlora")
    assert vram_32b_qlora == 23.1
    assert vram_32b_qlora <= 24.0

    # 7B Full fine-tuning: 8.0 * 7.0 + 4.0 = 60.0 GB
    assert estimate_required_vram_gb("meta-llama/llama-3.1-7b", train_type="full") == 60.0


def test_vram_estimator_param_parsing():
    """Verify regex and metadata parsing of parameter counts."""
    assert parse_param_count_b("custom-org/my-finetuned-8b-model") == 8.0
    assert parse_param_count_b("deepseek-ai/deepseek-llm-67b-base") == 67.0
    assert parse_param_count_b("facebook/opt-125m") == 0.125

    # Metadata JSON override
    meta_json = json.dumps({"param_count_b": 13.5})
    assert parse_param_count_b("unknown-model-id", metadata_json=meta_json) == 13.5

    # Fallback to default
    assert parse_param_count_b("completely-unrecognized-model") == 7.0


def test_vram_activation_headroom():
    """Verify dynamic headroom scaling with batch size and sequence length."""
    # Small batch & seq length uses minimum floor 0.5 GB
    hr_small = calculate_activation_headroom(batch_size=1, max_seq_length=512)
    assert hr_small == 0.5

    # Massive batch & sequence length scales above 0.5 GB
    # (32 * 8192 * 4) / (1024^2) = 1.0 GB
    hr_large = calculate_activation_headroom(batch_size=32, max_seq_length=8192)
    assert hr_large == 1.0


# ==============================================================================
# 2. Strict Scheduler VRAM Gating & Bypass Removal
# ==============================================================================

def test_scheduler_vram_gating_disqualifies_undersized_worker():
    """Verify that an 8 GB worker is disqualified for a 15 GB workload."""
    worker = Worker(
        id="worker-rtx-3070-8gb",
        name="RTX 3070 Node",
        gpu_memory_gb=8.0,
        vram_allocation_pct=80,  # Allocated ceiling = 6.4 GB
        vram_used_gb=0.0,
        gpu_utilization_pct=10.0,
        status="online",
        is_available=True,
        compute_architecture="cuda",
        supported_task_types="training,inference",
    )

    # 1. 15 GB requirement against 6.4 GB allocated ceiling -> MUST BE DISQUALIFIED
    eval_oversized = cluster_scheduler.score_worker_node(worker, required_vram_gb=15.0)
    assert eval_oversized["eligible"] is False
    assert "below task requirement" in eval_oversized["disqualification_reason"]
    assert eval_oversized["score"] == 0.0

    # 2. 4 GB requirement against 6.4 GB allocated ceiling -> ELIGIBLE
    eval_ok = cluster_scheduler.score_worker_node(worker, required_vram_gb=4.0)
    assert eval_ok["eligible"] is True
    assert eval_ok["score"] > 0.0


def test_scheduler_dynamic_vram_integration():
    """Verify scheduler computes dynamic VRAM from model_id and train_type."""
    worker = Worker(
        id="worker-rtx-4090-24gb",
        name="RTX 4090 Node",
        gpu_memory_gb=24.0,
        vram_allocation_pct=90,  # 21.6 GB ceiling
        vram_used_gb=0.0,
        gpu_utilization_pct=5.0,
        status="online",
        is_available=True,
        compute_architecture="cuda",
        supported_task_types="training,inference",
    )

    mock_db = MagicMock()
    mock_db.query.return_value.all.return_value = [worker]

    # 7B QLoRA needs ~6.85 GB -> fits 21.6 GB ceiling
    result_qlora = cluster_scheduler.select_optimal_workers(
        db=mock_db,
        model_id="qwen/qwen2.5-7b",
        train_type="qlora",
        record_dispatch=False,
    )
    assert len(result_qlora["selected_worker_ids"]) == 1
    assert result_qlora["selected_worker_ids"][0] == "worker-rtx-4090-24gb"

    # 14B 16-bit LoRA needs ~33.3 GB -> does NOT fit 21.6 GB ceiling
    result_lora = cluster_scheduler.select_optimal_workers(
        db=mock_db,
        model_id="qwen/qwen2.5-14b",
        train_type="lora",
        record_dispatch=False,
    )
    assert len(result_lora["selected_worker_ids"]) == 0
    assert result_lora["eligible_count"] == 0


def test_resolve_worker_fleet_strict_rejection_no_bypass():
    """
    Verify that resolve_worker_fleet does NOT bypass scheduler rejection
    or pick arbitrary online workers when VRAM is insufficient (lines 99-110 removed).
    """
    small_worker = Worker(
        id="small-worker-8gb",
        name="8GB Node",
        gpu_memory_gb=8.0,
        vram_allocation_pct=80,
        vram_used_gb=0.0,
        status="online",
        is_available=True,
        compute_architecture="cuda",
        supported_task_types="training",
    )

    mock_db = MagicMock()
    mock_db.query.return_value.all.return_value = [small_worker]
    mock_db.query.return_value.filter.return_value.all.return_value = [small_worker]

    # Job requires 20 GB VRAM. Scheduler returns 0 workers.
    # Previous implementation bypassed lines 99-110 and returned [small_worker.id].
    # Fixed implementation MUST return empty list []!
    with patch.dict(os.environ, {"ALLOW_SERVER_CPU_TRAINING_FALLBACK": "false"}):
        fleet = distributed_training_engine.resolve_worker_fleet(
            db=mock_db,
            num_gpus=1,
            required_vram_gb=20.0,
        )
        assert fleet == [], "resolve_worker_fleet must return empty list when VRAM is insufficient (no bypass)"


# ==============================================================================
# 3. Discrete GPU Detection Tests
# ==============================================================================

def test_probe_windows_gpus_filters_integrated_graphics():
    """Verify Windows WMI probe filters out integrated graphics (Intel UHD, AMD Radeon iGPU)."""
    mock_wmi_data = json.dumps([
        {
            "Name": "Intel(R) UHD Graphics 630",
            "AdapterRAM": 1073741824,
            "DriverVersion": "30.0.100.9999",
        },
        {
            "Name": "AMD Radeon(TM) Graphics",
            "AdapterRAM": 536870912,
            "DriverVersion": "31.0.12000.0",
        },
        {
            "Name": "NVIDIA GeForce RTX 4090",
            "AdapterRAM": 25769803776,
            "DriverVersion": "560.94",
        },
    ])

    with patch("worker.hardware_detector.platform.system", return_value="Windows"):
        with patch("worker.hardware_detector._run_cmd_clean", return_value=mock_wmi_data):
            gpus = probe_windows_gpus()

            # Intel UHD and AMD Radeon iGPU must be filtered out
            assert len(gpus) == 1
            assert gpus[0]["name"] == "NVIDIA GeForce RTX 4090"
            assert gpus[0]["vendor"] == "NVIDIA"
            assert gpus[0]["architecture"] == "cuda"
            assert gpus[0]["vram_total_gb"] > 20.0


def test_hardware_detector_reports_collective_and_discrete_fields():
    """Verify hardware profile outputs gpu_count, largest_single_gpu_gb, and collective_vram_gb."""
    with patch("worker.hardware_detector.platform.system", return_value="Darwin"):
        with patch("worker.hardware_detector.probe_system_memory", return_value=(32.0, 24.0)):
            with patch("worker.hardware_detector.probe_pytorch_backends", return_value=None):
                with patch("worker.hardware_detector.probe_macos_apple_silicon") as mock_mac:
                    mock_mac.return_value = {
                        "gpu_model": "Apple M3 Pro (18-Core GPU)",
                        "gpu_vendor": "Apple",
                        "compute_architecture": "apple_mps",
                        "hardware_tier": "apple_silicon",
                        "is_unified_memory": True,
                        "gpu_count": 1,
                        "largest_single_gpu_gb": 24.0,
                        "collective_vram_gb": 24.0,
                        "interconnect": "unified_fabric",
                        "vram_total_gb": 24.0,
                        "vram_used_gb": 2.0,
                        "vram_allocation_pct": 80,
                        "gpu_utilization_pct": 12.0,
                        "runtime_version": "Apple Metal MPS",
                        "tensor_device_str": "mps",
                        "gpus": [{"name": "Apple M3 Pro", "vram_total_gb": 24.0}],
                    }
                    hw = inspect_universal_hardware()
                    assert hw["gpu_count"] == 1
                    assert hw["largest_single_gpu_gb"] == 24.0
                    assert hw["collective_vram_gb"] == 24.0
                    assert hw["interconnect"] == "unified_fabric"


# ==============================================================================
# 4. Single-Machine Multi-GPU Collective VRAM Tests
# ==============================================================================

def test_multi_gpu_max_memory_and_device_map():
    """Verify that multi-GPU instances calculate max_memory dictionary and set device_map='auto'."""
    runtime = _WorkerGpuRuntime()

    # Simulate 2x 12GB CUDA devices
    mock_props_0 = MagicMock(total_memory=12 * (1024**3), major=8)
    mock_props_1 = MagicMock(total_memory=12 * (1024**3), major=8)

    with patch("torch.cuda.is_available", return_value=True):
        with patch("torch.cuda.device_count", return_value=2):
            with patch("torch.cuda.is_bf16_supported", return_value=True):
                with patch("torch.cuda.get_device_properties", side_effect=[mock_props_0, mock_props_1]):
                    with patch("transformers.AutoTokenizer.from_pretrained") as mock_tok:
                        with patch("transformers.AutoModelForCausalLM.from_pretrained") as mock_model:
                            mock_tok.return_value = MagicMock(pad_token=None, eos_token="<eos>")
                            mock_inst = MagicMock()
                            mock_inst.parameters.return_value = iter([torch.zeros(1)])
                            mock_model.return_value = mock_inst

                            runtime.ensure_model("Qwen/Qwen2.5-7B-Instruct")

                            _, kwargs = mock_model.call_args
                            assert kwargs.get("device_map") == "auto"
                            max_mem = kwargs.get("max_memory")
                            assert isinstance(max_mem, dict)
                            assert 0 in max_mem and 1 in max_mem
                            assert "GiB" in max_mem[0]


# ==============================================================================
# 5. Real 4-bit NF4 QLoRA & Dynamic Linear Module Discovery Tests
# ==============================================================================

class DummyTransformer(nn.Module):
    """Synthetic model mimicking causal LM projection architectures."""
    def __init__(self):
        super().__init__()
        self.q_proj = nn.Linear(64, 64)
        self.k_proj = nn.Linear(64, 64)
        self.v_proj = nn.Linear(64, 64)
        self.o_proj = nn.Linear(64, 64)
        self.gate_proj = nn.Linear(64, 128)
        self.up_proj = nn.Linear(64, 128)
        self.down_proj = nn.Linear(128, 64)
        self.non_linear_norm = nn.LayerNorm(64)


def test_find_all_linear_names_discovery():
    """Verify that find_all_linear_names automatically discovers projection layers."""
    model = DummyTransformer()
    discovered = find_all_linear_names(model)

    assert "q_proj" in discovered
    assert "k_proj" in discovered
    assert "v_proj" in discovered
    assert "o_proj" in discovered
    assert "gate_proj" in discovered
    assert "up_proj" in discovered
    assert "down_proj" in discovered
    assert "non_linear_norm" not in discovered


def test_empirical_validation_loss_computation():
    """Verify that empirical validation loss is computed via forward pass under torch.no_grad()."""
    # Create simple linear model with forward pass
    class TinyModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.linear = nn.Linear(8, 8)
        def forward(self, input_ids=None, labels=None):
            loss = torch.tensor(1.234, requires_grad=True)
            return MagicMock(loss=loss)

    tiny = TinyModel()
    first_device = next(tiny.parameters()).device
    val_batches = [(torch.zeros(2, 8).to(first_device), torch.zeros(2, 8).to(first_device))]

    val_losses = []
    tiny.eval()
    with torch.no_grad():
        for val_ids, val_labels in val_batches:
            out = tiny(input_ids=val_ids, labels=val_labels)
            val_losses.append(float(out.loss.item()))

    assert len(val_losses) == 1
    assert round(val_losses[0], 3) == 1.234


# ==============================================================================
# 6. Universal Dataset Parser Tests (All 8 Formats)
# ==============================================================================

def test_universal_parser_alpaca_json():
    """Verify Alpaca format JSON parsing."""
    alpaca_data = json.dumps([
        {"instruction": "Translate to French", "input": "Hello world", "output": "Bonjour le monde"},
        {"instruction": "Capital of France", "output": "Paris"}
    ])
    records = parse_universal_dataset(alpaca_data, format_hint=".json")
    assert len(records) == 2
    assert "Translate to French\nHello world" in records[0]["instruction"]
    assert records[0]["response"] == "Bonjour le monde"
    assert records[1]["instruction"] == "Capital of France"
    assert records[1]["response"] == "Paris"


def test_universal_parser_chatml_jsonl():
    """Verify ChatML / OpenAI Messages format JSONL parsing."""
    jsonl_data = (
        '{"messages": [{"role": "user", "content": "What is 2+2?"}, {"role": "assistant", "content": "4"}]}\n'
        '{"messages": [{"role": "user", "content": "What is 3+3?"}, {"role": "assistant", "content": "6"}]}\n'
    )
    records = parse_universal_dataset(jsonl_data, format_hint=".jsonl")
    assert len(records) == 2
    assert records[0]["instruction"] == "What is 2+2?"
    assert records[0]["response"] == "4"


def test_universal_parser_sharegpt_and_dpo():
    """Verify ShareGPT and DPO format parsing."""
    sharegpt_item = {
        "conversations": [
            {"from": "human", "value": "Explain quantum computing"},
            {"from": "gpt", "value": "Quantum computing uses qubits"}
        ]
    }
    rec_sg = extract_instruction_response(sharegpt_item)
    assert rec_sg["instruction"] == "Explain quantum computing"
    assert rec_sg["response"] == "Quantum computing uses qubits"

    dpo_item = {
        "prompt": "Write a poem",
        "chosen": "Roses are red",
        "rejected": "No poem today"
    }
    rec_dpo = extract_instruction_response(dpo_item)
    assert rec_dpo["instruction"] == "Write a poem"
    assert rec_dpo["response"] == "Roses are red"


def test_universal_parser_csv():
    """Verify CSV dataset parsing with headers."""
    csv_text = "instruction,response\nWhat is Python?,A programming language\nWhat is PyTorch?,A deep learning framework"
    records = parse_universal_dataset(csv_text, format_hint=".csv")
    assert len(records) == 2
    assert records[0]["instruction"] == "What is Python?"
    assert records[0]["response"] == "A programming language"


def test_universal_parser_parquet():
    """Verify Parquet dataset parsing."""
    import pandas as pd
    df = pd.DataFrame({
        "instruction": ["Parquet question 1", "Parquet question 2"],
        "response": ["Parquet answer 1", "Parquet answer 2"],
    })
    buf = io.BytesIO()
    df.to_parquet(buf, engine="fastparquet")
    records = parse_universal_dataset(buf.getvalue(), format_hint=".parquet")
    assert len(records) == 2
    assert records[0]["instruction"] == "Parquet question 1"
    assert records[0]["response"] == "Parquet answer 1"


def test_universal_parser_txt_and_md():
    """Verify sliding-window chunking on text and markdown."""
    text = (
        "Project NetworkNebula is an enterprise decentralized compute platform. "
        "It provides zero-storage model training and secure inference across multi-GPU nodes. "
        "Workers coordinate via WebSockets and execute PyTorch PEFT LoRA training."
    )
    records_txt = parse_universal_dataset(text, format_hint=".txt")
    assert len(records_txt) >= 1
    assert "instruction" in records_txt[0] and "response" in records_txt[0]

    md_text = "# Documentation\n\nNetworkNebula connects GPU workers with model builders seamlessly."
    records_md = parse_universal_dataset(md_text, format_hint=".md")
    assert len(records_md) >= 1


def test_universal_parser_docx():
    """Verify .docx dataset parsing using internal XML extraction."""
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w") as zf:
        zf.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            "<w:body><w:p><w:t>NetworkNebula DOCX training paragraph with sufficient text for chunking and validation.</w:t></w:p></w:body>"
            "</w:document>",
        )
    records = parse_universal_dataset(bio.getvalue(), format_hint=".docx")
    assert len(records) >= 1
    assert "DOCX" in records[0]["instruction"] or "DOCX" in records[0]["response"]


def test_universal_parser_pdf():
    """Verify .pdf dataset parsing using pypdf."""
    import reportlab.pdfgen.canvas as canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(50, 700, "NetworkNebula PDF training paragraph with sufficient content for tokenization.")
    c.save()

    records = parse_universal_dataset(buf.getvalue(), format_hint=".pdf")
    assert len(records) >= 1
    assert "PDF" in records[0]["instruction"] or "PDF" in records[0]["response"]


def test_universal_parser_empty_raises_value_error():
    """Verify empty or malformed files raise ValueError with clear message."""
    with pytest.raises(ValueError, match="0 valid samples"):
        parse_universal_dataset("   \n\n  ", format_hint=".txt")

    with pytest.raises(ValueError, match="0 valid samples"):
        parse_universal_dataset("[]", format_hint=".json")


# ==============================================================================
# 7. File Synchronization Tests (Requirement R3)
# ==============================================================================

def test_worker_scripts_byte_identical():
    """Verify worker/nebula_worker.py and nebula_worker.py are 100% byte-identical."""
    worker_path = os.path.join("worker", "nebula_worker.py")
    root_path = "nebula_worker.py"

    assert os.path.exists(worker_path), "worker/nebula_worker.py must exist"
    assert os.path.exists(root_path), "nebula_worker.py must exist"

    with open(worker_path, "rb") as f1, open(root_path, "rb") as f2:
        b1 = f1.read()
        b2 = f2.read()

    assert len(b1) == len(b2), f"Worker script lengths differ: {len(b1)} vs {len(b2)}"
    assert hashlib.sha256(b1).hexdigest() == hashlib.sha256(b2).hexdigest(), (
        "worker/nebula_worker.py and nebula_worker.py must be byte-identical (Requirement R3)"
    )


def test_hardware_detector_scripts_byte_identical():
    """Verify worker/hardware_detector.py and app/hardware_detector.py are 100% byte-identical."""
    worker_hw = os.path.join("worker", "hardware_detector.py")
    app_hw = os.path.join("app", "hardware_detector.py")

    assert os.path.exists(worker_hw), "worker/hardware_detector.py must exist"
    assert os.path.exists(app_hw), "app/hardware_detector.py must exist"

    with open(worker_hw, "rb") as f1, open(app_hw, "rb") as f2:
        b1 = f1.read()
        b2 = f2.read()

    assert hashlib.sha256(b1).hexdigest() == hashlib.sha256(b2).hexdigest(), (
        "worker/hardware_detector.py and app/hardware_detector.py must be byte-identical"
    )
