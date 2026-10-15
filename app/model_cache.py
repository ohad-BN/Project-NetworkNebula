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

    def load_model(
        self,
        model_id: Optional[str] = None,
        force_reload: bool = False,
        dtype: torch.dtype = torch.float16,
    ) -> Tuple[Any, Any]:
        """
        Load tokenizer and model weights onto the target device.
        Reuses currently active instance unless force_reload is requested.
        """
        target_model_id = model_id or self.active_model_id or DEFAULT_FOUNDATION_MODEL

        # Fast path: already loaded
        if self.model is not None and self.tokenizer is not None:
            if self.active_model_id == target_model_id and not force_reload:
                return self.model, self.tokenizer
            # Unload previous model before loading new one
            self.unload_model()

        print(f"[MODEL_CACHE] Loading foundation model '{target_model_id}' onto {self.device.upper()}...")

        # Load Tokenizer
        tokenizer = AutoTokenizer.from_pretrained(
            target_model_id,
            token=self.hf_token,
            trust_remote_code=True,
        )

        # Set pad token if missing
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        # Load Model Weights
        model_kwargs = {
            "token": self.hf_token,
            "trust_remote_code": True,
        }

        if self.device == "cuda":
            model_kwargs["dtype"] = dtype
            model_kwargs["device_map"] = "cuda"
        else:
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
