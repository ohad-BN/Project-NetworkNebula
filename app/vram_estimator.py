#!/usr/bin/env python3
"""
Project NetworkNebula — Dynamic VRAM Estimator
==============================================
Calculates deterministic memory requirements (in GB) for fine-tuning workloads
based on model parameter count, training precision (4-bit NF4 QLoRA vs. 16-bit LoRA vs. Full),
batch size, sequence length, and LoRA rank.

Formulas:
  - 4-bit NF4 QLoRA (Double Quantization + Gradient Checkpointing):
      VRAM_QLoRA = 0.65 * params_b + 1.8 + activation_headroom
  - 16-bit LoRA (fp16 / bf16):
      VRAM_LoRA  = 2.2 * params_b + 2.0 + activation_headroom
  - Full Fine-Tuning (Model + Gradients + AdamW Optimizer Moments):
      VRAM_Full  = 8.0 * params_b + 4.0

Activation Headroom:
  headroom(B, L) = max(0.5, (B * L * 4) / (1024^2))
"""

import json
import math
import re
from typing import Optional, Dict, Any

# Known foundation model parameter catalog (in billions of parameters)
KNOWN_MODEL_PARAMS_B: Dict[str, float] = {
    # Qwen family
    "qwen/qwen2.5-0.5b-instruct": 0.5,
    "qwen/qwen2.5-0.5b": 0.5,
    "qwen/qwen2.5-1.5b-instruct": 1.5,
    "qwen/qwen2.5-1.5b": 1.5,
    "qwen/qwen2.5-3b-instruct": 3.0,
    "qwen/qwen2.5-3b": 3.0,
    "qwen/qwen2.5-7b-instruct": 7.0,
    "qwen/qwen2.5-7b": 7.0,
    "qwen/qwen2.5-14b-instruct": 14.0,
    "qwen/qwen2.5-14b": 14.0,
    "qwen/qwen2.5-32b-instruct": 32.0,
    "qwen/qwen2.5-32b": 32.0,
    "qwen/qwen2.5-72b-instruct": 72.0,
    "qwen/qwen2.5-72b": 72.0,
    # LLaMA family
    "meta-llama/llama-3.2-1b-instruct": 1.0,
    "meta-llama/llama-3.2-1b": 1.0,
    "meta-llama/llama-3.2-3b-instruct": 3.0,
    "meta-llama/llama-3.2-3b": 3.0,
    "meta-llama/llama-3.1-8b-instruct": 8.0,
    "meta-llama/llama-3.1-8b": 8.0,
    "meta-llama/llama-3.1-70b-instruct": 70.0,
    "meta-llama/llama-3.1-70b": 70.0,
    "meta-llama/llama-2-7b": 7.0,
    "meta-llama/llama-2-13b": 13.0,
    "meta-llama/llama-2-70b": 70.0,
    # Mistral family
    "mistralai/mistral-7b-instruct-v0.3": 7.0,
    "mistralai/mistral-7b-v0.1": 7.0,
    "mistralai/mixtral-8x7b-instruct-v0.1": 46.7,
    # Gemma family
    "google/gemma-2-2b-it": 2.6,
    "google/gemma-2-9b-it": 9.2,
    "google/gemma-2-27b-it": 27.2,
    # Small / lightweight test models
    "gpt2": 0.124,
    "gpt2-medium": 0.355,
    "gpt2-large": 0.774,
    "gpt2-xl": 1.558,
    "facebook/opt-125m": 0.125,
    "facebook/opt-350m": 0.35,
    "facebook/opt-1.3b": 1.3,
    "facebook/opt-2.7b": 2.7,
    "facebook/opt-6.7b": 6.7,
    "facebook/opt-13b": 13.0,
}


def parse_param_count_b(model_id: str, metadata_json: Optional[str] = None) -> float:
    """
    Determine the total parameter count (in billions, P) for a given model ID or metadata JSON.
    Resolution order:
      1. Explicit `param_count_b` or `params_b` inside `metadata_json`.
      2. Known model catalog lookup.
      3. Regex extraction of parameter size (e.g., '7B', '0.5B', '14b', '70B', '125M').
      4. Default fallback: 7.0B.
    """
    # 1. Inspect metadata_json if provided
    if metadata_json:
        try:
            meta = json.loads(metadata_json) if isinstance(metadata_json, str) else metadata_json
            if isinstance(meta, dict):
                for k in ("param_count_b", "params_b", "parameters_b", "num_parameters_b"):
                    if k in meta and meta[k] is not None:
                        val = float(meta[k])
                        if val > 0:
                            return round(val, 3)
                # Check for raw parameter count (e.g., 7000000000)
                for k in ("num_parameters", "total_params", "params_count"):
                    if k in meta and meta[k] is not None:
                        val = float(meta[k]) / 1e9
                        if val > 0:
                            return round(val, 3)
        except Exception:
            pass

    clean_id = (model_id or "").strip().lower()
    if not clean_id:
        return 7.0

    # 2. Known catalog match (exact and partial)
    if clean_id in KNOWN_MODEL_PARAMS_B:
        return KNOWN_MODEL_PARAMS_B[clean_id]

    for cat_id, params in KNOWN_MODEL_PARAMS_B.items():
        if cat_id in clean_id or clean_id in cat_id:
            return params

    # 3. Regex match for billions (e.g. "7b", "0.5b", "14b", "8.0b", "32b")
    # Matches patterns like "-7b", "/7b", "_7b", "7b-"
    b_match = re.search(r"[-/_]?(\d+(\.\d+)?)\s*b(?:\b|[-_])", clean_id)
    if b_match:
        try:
            return round(float(b_match.group(1)), 3)
        except ValueError:
            pass

    # Regex match for millions (e.g. "125m", "350m")
    m_match = re.search(r"[-/_]?(\d+(\.\d+)?)\s*m(?:\b|[-_])", clean_id)
    if m_match:
        try:
            return round(float(m_match.group(1)) / 1000.0, 3)
        except ValueError:
            pass

    # 4. Fallback default
    return 7.0


def calculate_activation_headroom(batch_size: int = 4, max_seq_length: int = 512) -> float:
    """
    Calculate dynamic activation memory headroom based on micro-batch size and sequence length:
      headroom = max(0.5, (batch_size * max_seq_length * 4) / (1024^2)) GB
    """
    b = max(1, int(batch_size or 1))
    seq_len = max(64, int(max_seq_length or 512))
    computed = (b * seq_len * 4.0) / (1024.0 ** 2)
    return round(max(0.5, computed), 3)


def estimate_required_vram_gb(
    model_id: str,
    train_type: str = "lora",
    batch_size: int = 4,
    max_seq_length: int = 512,
    lora_r: int = 16,
    metadata_json: Optional[str] = None,
) -> float:
    """
    Calculate required GPU VRAM in Gigabytes (GB) for a training job.

    Formulas:
      - 4-bit NF4 QLoRA: `0.65 * params_b + 1.8 + activation_headroom`
      - 16-bit LoRA:    `2.2 * params_b + 2.0 + activation_headroom`
      - Full fine-tune: `8.0 * params_b + 4.0`

    Args:
      model_id: HuggingFace model repo ID or name (e.g. "meta-llama/Llama-3.1-8B-Instruct")
      train_type: Fine-tuning type: "qlora" (4-bit NF4), "lora" (16-bit), or "full"
      batch_size: Training micro-batch size per GPU (default: 4)
      max_seq_length: Maximum sequence context length (default: 512)
      lora_r: LoRA adapter rank (default: 16)
      metadata_json: Optional JSON string containing model metadata (e.g. param_count_b)

    Returns:
      Estimated required VRAM in GB rounded to 2 decimal places.
    """
    params_b = parse_param_count_b(model_id, metadata_json=metadata_json)
    headroom = calculate_activation_headroom(batch_size=batch_size, max_seq_length=max_seq_length)

    norm_type = (train_type or "lora").strip().lower()

    if "qlora" in norm_type or "4bit" in norm_type or "4_bit" in norm_type:
        # 4-bit NF4 QLoRA
        required_gb = 0.65 * params_b + 1.8 + headroom
    elif "full" in norm_type:
        # Full Fine-Tuning (Model + Gradients + Optimizer)
        required_gb = 8.0 * params_b + 4.0
    else:
        # 16-bit LoRA (fp16 / bf16) default
        required_gb = 2.2 * params_b + 2.0 + headroom

    return round(float(required_gb), 2)
