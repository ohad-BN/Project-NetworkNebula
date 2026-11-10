#!/usr/bin/env python3
"""
Project NetworkNebula - Foundation Model Cache & Hardware Binding Manager
========================================================================
Manages local weights caching, automatic downloads, GPU/CUDA memory allocation,
and tokenizer/model lifecycle for open-source foundation models.
"""

import os
import gc
import sys
import logging
import psutil
from typing import Dict, Any, Optional, Tuple, List

# Silence huggingface symlink warnings on Windows
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

logger = logging.getLogger("model_cache")

# Default high-efficiency, un-gated Apache 2.0 foundation model
DEFAULT_FOUNDATION_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"

# Catalog of verified open models compatible with RTX 4070 (8GB VRAM)
MODEL_CATALOG: Dict[str, Dict[str, Any]] = {
    "Qwen/Qwen2.5-0.5B-Instruct": {
        "name": "Qwen 2.5 0.5B Instruct",
        "parameters": "500M",
        "vram_fp16_mb": 950,
        "is_gated": False,
        "license": "Apache 2.0",
        "recommended_for": "Ultra-low latency serving, swift CI/CD and edge fine-tuning",
    },
    "Qwen/Qwen2.5-1.5B-Instruct": {
        "name": "Qwen 2.5 1.5B Instruct",
        "parameters": "1.5B",
        "vram_fp16_mb": 3100,
        "is_gated": False,
        "license": "Apache 2.0",
        "recommended_for": "Production enterprise instruction and coding",
    },
    "HuggingFaceTB/SmolLM2-1.7B-Instruct": {
        "name": "SmolLM2 1.7B Instruct",
        "parameters": "1.7B",
        "vram_fp16_mb": 3400,
        "is_gated": False,
        "license": "Apache 2.0",
        "recommended_for": "General purpose reasoning and conversation",
    },
    "meta-llama/Llama-3.2-1B-Instruct": {
        "name": "Llama 3.2 1B Instruct",
        "parameters": "1B",
        "vram_fp16_mb": 2200,
        "is_gated": True,
        "license": "Llama 3.2 Community",
        "recommended_for": "Official Meta Llama ecosystem (requires HF_TOKEN)",
    },
    "meta-llama/Llama-3-8B": {
        "name": "Llama 3 8B Base",
        "parameters": "8B",
        "vram_fp16_mb": 16000,
        "is_gated": True,
        "license": "Llama 3 Community",
        "recommended_for": "Heavy multi-GPU cluster workloads (requires 4-bit quantization on single 8GB GPU)",
    },
}


class ModelCacheManager:
    """
    Singleton manager controlling foundation model caching,
    VRAM lifecycle, and device binding on the local GPU node.
    """
    _instance: Optional["ModelCacheManager"] = None

    def __init__(self):
        self.active_model_id: Optional[str] = None
        self.model: Optional[Any] = None
        self.tokenizer: Optional[Any] = None
        self.device: str = "cuda" if torch.cuda.is_available() else "cpu"
        self.hf_token: Optional[str] = os.getenv("HF_TOKEN")

    @classmethod
    def get_instance(cls) -> "ModelCacheManager":
        if cls._instance is None:
            cls._instance = ModelCacheManager()
        return cls._instance

    def get_catalog(self) -> List[Dict[str, Any]]:
        """Return list of supported models with hardware specs"""
        catalog = []
        for model_id, specs in MODEL_CATALOG.items():
            entry = dict(specs)
            entry["model_id"] = model_id
            entry["is_active"] = (self.active_model_id == model_id)
            entry["is_cached"] = self.is_cached_locally(model_id)
            catalog.append(entry)
        return catalog

    def is_cached_locally(self, model_id: str) -> bool:
        """Check if model weights and tokenizer exist in local HuggingFace cache"""
        try:
            from huggingface_hub import try_to_load_from_cache
            # Check for config.json in local cache
            res = try_to_load_from_cache(model_id, "config.json")
            return isinstance(res, str)
        except Exception:
            return False

    def get_vram_usage_mb(self) -> float:
        """Return currently allocated VRAM in MB"""
        if torch.cuda.is_available():
            return round(torch.cuda.memory_allocated() / (1024**2), 1)
        return 0.0

    def _estimate_min_ram_gb(self, model_id: str) -> float:
        """Estimate minimum system RAM/VRAM (GB) required to load real bf16/fp16 weights."""
        if model_id in MODEL_CATALOG and "vram_fp16_mb" in MODEL_CATALOG[model_id]:
            return round(float(MODEL_CATALOG[model_id]["vram_fp16_mb"]) / 1024.0, 2)
        lower_id = (model_id or "").lower()
        for tag, gb in [
            ("72b", 145.0),
            ("70b", 140.0),
            ("33b", 66.0),
            ("14b", 28.0),
            ("8b", 16.0),
            ("7b", 14.0),
            ("3b", 6.0),
            ("1.7b", 3.4),
            ("1.5b", 3.1),
            ("1b", 2.2),
            ("0.5b", 1.0),
        ]:
            if tag in lower_id:
                return gb
        return 1.5

    def load_model(
        self,
        model_id: Optional[str] = None,
        force_reload: bool = False,
        dtype: torch.dtype = torch.float16,
    ) -> Tuple[Any, Any]:
        """
        Load real tokenizer and foundation model weights onto the target device.
        Raises descriptive errors instead of substituting fake/compact dummy weights.
        """
        target_model_id = (model_id or "").strip() or self.active_model_id or DEFAULT_FOUNDATION_MODEL

        # Fast path: already loaded
        if self.model is not None and self.tokenizer is not None:
            if self.active_model_id == target_model_id and not force_reload:
                return self.model, self.tokenizer
            # Unload previous model before loading new one
            self.unload_model()

        if self.device == "cpu":
            mem = psutil.virtual_memory()
            swap = psutil.swap_memory()
            avail_ram_gb = mem.available / (1024 ** 3)
            headroom_gb = (mem.available + swap.free) / (1024 ** 3)
            est_gb = self._estimate_min_ram_gb(target_model_id)
            if headroom_gb < est_gb + 0.6:
                raise RuntimeError(
                    f"Model '{target_model_id}' requires ~{est_gb:.1f} GB memory for real weights, "
                    f"exceeding server CPU capacity ({avail_ram_gb:.1f} GB RAM free, {headroom_gb:.1f} GB incl. swap). "
                    f"Connect a GPU worker node with sufficient VRAM to run this model."
                )

        print(f"[MODEL_CACHE] Loading REAL foundation model '{target_model_id}' onto {self.device.upper()}...")

        tokenizer = AutoTokenizer.from_pretrained(
            target_model_id,
            token=self.hf_token,
            trust_remote_code=True,
        )
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model_kwargs: Dict[str, Any] = {
            "token": self.hf_token,
            "trust_remote_code": True,
            "low_cpu_mem_usage": True,
        }
        if self.device == "cuda":
            model_kwargs["dtype"] = dtype
            model_kwargs["device_map"] = "cuda"
        else:
            # Real bfloat16/float16-memory footprint on CPU (halves RAM vs fp32)
            model_kwargs["dtype"] = torch.bfloat16
            model_kwargs["device_map"] = "cpu"

        model = AutoModelForCausalLM.from_pretrained(
            target_model_id,
            **model_kwargs
        )

        self.model = model
        self.tokenizer = tokenizer
        self.active_model_id = target_model_id

        vram = self.get_vram_usage_mb()
        print(f"[MODEL_CACHE] Model '{target_model_id}' successfully bound to {model.device} (VRAM: {vram} MB)")
        return self.model, self.tokenizer

    def unload_model(self) -> None:
        """Reclaim VRAM by deleting model tensors and garbage collecting"""
        if self.model is not None:
            prev_id = self.active_model_id
            print(f"[MODEL_CACHE] Unloading model '{prev_id}' to free VRAM...")
            del self.model
            del self.tokenizer
            self.model = None
            self.tokenizer = None
            self.active_model_id = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            print(f"[MODEL_CACHE] VRAM freed. Current allocated: {self.get_vram_usage_mb()} MB")

    def get_status(self) -> Dict[str, Any]:
        """Get live memory, hardware device, and active model status"""
        return {
            "active_model_id": self.active_model_id,
            "device": self.device,
            "cuda_available": torch.cuda.is_available(),
            "device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
            "allocated_vram_mb": self.get_vram_usage_mb(),
            "default_model": DEFAULT_FOUNDATION_MODEL,
            "hf_token_configured": bool(self.hf_token),
        }


# Global singleton access
model_cache = ModelCacheManager.get_instance()
