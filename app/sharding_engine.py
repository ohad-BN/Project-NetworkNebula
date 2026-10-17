#!/usr/bin/env python3
"""
Project NetworkNebula — Transformer Layer Sharding Protocol & Pipeline Topology Engine
=====================================================================================
Decomposes 70B+ LLMs into discrete contiguous layer block slices and coordinates
peer-to-peer pipeline stages across distributed consumer GPU workers.
"""

import logging
import math
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np

logger = logging.getLogger("sharding_engine")

# ---------------------------------------------------------------------------
# Supported Sharded Foundation Models Catalog
# ---------------------------------------------------------------------------
SUPPORTED_SHARDED_MODELS: Dict[str, Dict[str, Any]] = {
    "meta-llama/Llama-3-70B": {
        "model_id": "meta-llama/Llama-3-70B",
        "name": "Llama 3 70B Instruct",
        "total_layers": 80,
        "hidden_size": 8192,
        "num_heads": 64,
        "num_kv_heads": 8,
        "vocab_size": 128256,
        "total_params_b": 70.6,
        "default_quantization": "4bit",
        "vram_gb": {"fp16": 140.0, "8bit": 75.0, "4bit": 38.0},
    },
    "Qwen/Qwen2.5-72B-Instruct": {
        "model_id": "Qwen/Qwen2.5-72B-Instruct",
        "name": "Qwen 2.5 72B Instruct",
        "total_layers": 80,
        "hidden_size": 8192,
        "num_heads": 64,
        "num_kv_heads": 8,
        "vocab_size": 152064,
        "total_params_b": 72.7,
        "default_quantization": "4bit",
        "vram_gb": {"fp16": 145.0, "8bit": 78.0, "4bit": 40.0},
    },
    "deepseek-ai/DeepSeek-Coder-33B-Instruct": {
        "model_id": "deepseek-ai/DeepSeek-Coder-33B-Instruct",
        "name": "DeepSeek Coder 33B Instruct",
        "total_layers": 62,
        "hidden_size": 7168,
        "num_heads": 56,
        "num_kv_heads": 8,
        "vocab_size": 32256,
        "total_params_b": 33.0,
        "default_quantization": "4bit",
        "vram_gb": {"fp16": 66.0, "8bit": 35.0, "4bit": 18.0},
    },
    "meta-llama/Llama-3-8B": {
        "model_id": "meta-llama/Llama-3-8B",
        "name": "Llama 3 8B Instruct",
        "total_layers": 32,
        "hidden_size": 4096,
        "num_heads": 32,
        "num_kv_heads": 8,
        "vocab_size": 128256,
        "total_params_b": 8.0,
        "default_quantization": "fp16",
        "vram_gb": {"fp16": 16.0, "8bit": 8.5, "4bit": 4.5},
    },
    "Qwen/Qwen2.5-0.5B-Instruct": {
        "model_id": "Qwen/Qwen2.5-0.5B-Instruct",
        "name": "Qwen 2.5 0.5B Instruct (Lightweight Swarm Shard)",
        "total_layers": 24,
        "hidden_size": 896,
        "num_heads": 14,
        "num_kv_heads": 2,
        "vocab_size": 151936,
        "total_params_b": 0.5,
        "default_quantization": "fp16",
        "vram_gb": {"fp16": 1.0, "8bit": 0.5, "4bit": 0.3},
    },
}


class PipelineStage:
    """Represents a discrete contiguous slice of transformer layer blocks."""

    def __init__(
        self,
        stage_idx: int,
        start_layer: int,
        end_layer: int,
        estimated_vram_gb: float,
        has_embeddings: bool = False,
        has_lm_head: bool = False,
        primary_worker_id: Optional[str] = None,
        standby_worker_ids: Optional[List[str]] = None,
    ):
        self.stage_idx = stage_idx
        self.start_layer = start_layer
        self.end_layer = end_layer
        self.layer_count = end_layer - start_layer + 1
        self.estimated_vram_gb = round(estimated_vram_gb, 2)
        self.has_embeddings = has_embeddings
        self.has_lm_head = has_lm_head
        self.primary_worker_id = primary_worker_id
        self.standby_worker_ids = standby_worker_ids or []
        self.status = "ready" if primary_worker_id else "unassigned"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage_idx": self.stage_idx,
            "start_layer": self.start_layer,
            "end_layer": self.end_layer,
            "layer_count": self.layer_count,
            "estimated_vram_gb": self.estimated_vram_gb,
            "has_embeddings": self.has_embeddings,
            "has_lm_head": self.has_lm_head,
            "primary_worker_id": self.primary_worker_id,
            "standby_worker_ids": self.standby_worker_ids,
            "status": self.status,
            "is_covered": bool(self.primary_worker_id),
            "redundancy_count": len(self.standby_worker_ids) + (1 if self.primary_worker_id else 0),
        }


class SwarmPipeline:
    """A coordinated sequence of pipeline stages forming an end-to-end sharded LLM."""

    def __init__(
        self,
        pipeline_id: str,
        model_id: str,
        total_layers: int,
        quantization: str,
        stages: List[PipelineStage],
        name: Optional[str] = None,
    ):
        self.pipeline_id = pipeline_id
        self.model_id = model_id
        self.name = name or f"swarm-pipe-{model_id.split('/')[-1]}-{pipeline_id[:6]}"
        self.total_layers = total_layers
        self.quantization = quantization
        self.stages = stages
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.updated_at = self.created_at
        self.total_vram_budget_gb = round(sum(s.estimated_vram_gb for s in stages), 2)

    @property
    def is_complete(self) -> bool:
        """Checks if all contiguous layers from 0 to total_layers-1 are assigned."""
        if not self.stages:
            return False
        # Check that primary workers are assigned
        if any(s.primary_worker_id is None for s in self.stages):
            return False
        # Check contiguous coverage without gaps
        covered_layers = set()
        for s in self.stages:
            covered_layers.update(range(s.start_layer, s.end_layer + 1))
        expected_layers = set(range(self.total_layers))
        return covered_layers == expected_layers

    @property
    def health_score(self) -> float:
        """Calculate health score (0-100%) based on stage coverage and redundancy."""
        if not self.stages:
            return 0.0
        covered = sum(1 for s in self.stages if s.primary_worker_id)
        coverage_ratio = covered / len(self.stages)
        has_redundancy = sum(1 for s in self.stages if len(s.standby_worker_ids) > 0) / len(self.stages)
        # 80% weight on full coverage, 20% on standby replication
        score = (coverage_ratio * 80.0) + (has_redundancy * 20.0)
        return round(score, 1)

    @property
    def status(self) -> str:
        if self.is_complete:
            return "ready" if self.health_score >= 100.0 else "degraded_ready"
        if any(s.primary_worker_id for s in self.stages):
            return "partially_assigned"
        return "unassigned"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "pipeline_id": self.pipeline_id,
            "name": self.name,
            "model_id": self.model_id,
            "total_layers": self.total_layers,
            "quantization": self.quantization,
            "num_stages": len(self.stages),
            "status": self.status,
            "is_complete": self.is_complete,
            "health_score": self.health_score,
            "total_vram_budget_gb": self.total_vram_budget_gb,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "stages": [s.to_dict() for s in self.stages],
        }


class ShardingEngine:
    """
    Core orchestrator for model partitioning, swarm pipeline topology management,
    and P2P stage assignment.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._pipelines: Dict[str, SwarmPipeline] = {}

    def get_supported_models(self) -> List[Dict[str, Any]]:
        """Return list of pre-configured models suitable for swarm sharding."""
        return list(SUPPORTED_SHARDED_MODELS.values())

    def partition_model_layers(
        self,
        model_id: str,
        num_stages: int,
        quantization: str = "4bit",
        total_layers_override: Optional[int] = None,
    ) -> List[PipelineStage]:
        """
        Partition a model's transformer layers into `num_stages` balanced contiguous slices.
        Computes memory footprint per slice, marking stage 0 for embeddings and the final stage for LM head.
        """
        if num_stages <= 0:
            raise ValueError(f"num_stages must be at least 1, got {num_stages}")

        model_spec = SUPPORTED_SHARDED_MODELS.get(model_id, {})
        total_layers = total_layers_override or model_spec.get("total_layers", 80)
        total_vram_base = model_spec.get("vram_gb", {}).get(quantization, 40.0)

        # Baseline VRAM overhead per node (KV cache buffer, scratchpad activations)
        vram_overhead_per_node = 0.8
        vram_per_layer = (total_vram_base * 0.85) / max(1, total_layers)

        stages: List[PipelineStage] = []
        base_layers_per_stage = total_layers // num_stages
        remainder = total_layers % num_stages

        current_layer = 0
        for i in range(num_stages):
            count = base_layers_per_stage + (1 if i < remainder else 0)
            start_l = current_layer
            end_l = current_layer + count - 1
            current_layer += count

            has_embeddings = (i == 0)
            has_lm_head = (i == num_stages - 1)

            stage_vram = (count * vram_per_layer) + vram_overhead_per_node
            if has_embeddings:
                stage_vram += 0.5  # Embedding table
            if has_lm_head:
                stage_vram += 0.5  # Unembedding / logits projection

            stages.append(
                PipelineStage(
                    stage_idx=i,
                    start_layer=start_l,
                    end_layer=end_l,
                    estimated_vram_gb=round(stage_vram, 2),
                    has_embeddings=has_embeddings,
                    has_lm_head=has_lm_head,
                )
            )

        return stages

    def create_pipeline(
        self,
        model_id: str,
        num_stages: int,
        quantization: str = "4bit",
        worker_ids: Optional[List[str]] = None,
        standby_worker_ids: Optional[List[str]] = None,
        name: Optional[str] = None,
        total_layers_override: Optional[int] = None,
    ) -> SwarmPipeline:
        """
        Instantiate a new swarm pipeline and optionally assign workers to stages.
        """
        stages = self.partition_model_layers(
            model_id=model_id,
            num_stages=num_stages,
            quantization=quantization,
            total_layers_override=total_layers_override,
        )

        pipeline_id = f"pipe-{uuid.uuid4().hex[:8]}"

        # Assign primary workers if provided
        if worker_ids:
            for idx, wid in enumerate(worker_ids):
                if idx < len(stages):
                    stages[idx].primary_worker_id = wid
                    stages[idx].status = "ready"

        # Assign standby workers if provided
        if standby_worker_ids:
            for idx, wid in enumerate(standby_worker_ids):
                if idx < len(stages):
                    stages[idx].standby_worker_ids.append(wid)

        spec = SUPPORTED_SHARDED_MODELS.get(model_id, {})
        total_layers = total_layers_override or spec.get("total_layers", 80)

        pipeline = SwarmPipeline(
            pipeline_id=pipeline_id,
            model_id=model_id,
            total_layers=total_layers,
            quantization=quantization,
            stages=stages,
            name=name,
        )

        with self._lock:
            self._pipelines[pipeline_id] = pipeline

        logger.info(
            f"[SHARDING] Created pipeline '{pipeline_id}' for '{model_id}' "
            f"({num_stages} stages, {total_layers} layers, status={pipeline.status})"
        )
        return pipeline

    def assign_worker_to_stage(
        self,
        pipeline_id: str,
        stage_idx: int,
        worker_id: str,
        is_standby: bool = False,
    ) -> Dict[str, Any]:
        """
        Assign a worker node to a specific stage in a pipeline.
        """
        with self._lock:
            pipeline = self._pipelines.get(pipeline_id)
            if not pipeline:
                raise ValueError(f"Pipeline '{pipeline_id}' not found")

            if stage_idx < 0 or stage_idx >= len(pipeline.stages):
                raise ValueError(
                    f"Invalid stage_idx {stage_idx}. Pipeline has {len(pipeline.stages)} stages (0..{len(pipeline.stages)-1})"
                )

            stage = pipeline.stages[stage_idx]
            if is_standby:
                if worker_id not in stage.standby_worker_ids:
                    stage.standby_worker_ids.append(worker_id)
            else:
                stage.primary_worker_id = worker_id
                stage.status = "ready"

            pipeline.updated_at = datetime.now(timezone.utc).isoformat()

            return {
                "pipeline_id": pipeline_id,
                "stage_idx": stage_idx,
                "start_layer": stage.start_layer,
                "end_layer": stage.end_layer,
                "primary_worker_id": stage.primary_worker_id,
                "standby_worker_ids": stage.standby_worker_ids,
                "pipeline_status": pipeline.status,
                "is_complete": pipeline.is_complete,
            }

    def validate_pipeline(self, pipeline_id: str) -> Dict[str, Any]:
        """
        Audit pipeline completeness, contiguous layer boundaries, and stage redundancy.
        Returns detailed diagnostics suitable for validation assertions.
        """
        with self._lock:
            pipeline = self._pipelines.get(pipeline_id)
            if not pipeline:
                raise ValueError(f"Pipeline '{pipeline_id}' not found")

            issues: List[str] = []
            covered_layers = set()
            missing_stages: List[int] = []

            for s in pipeline.stages:
                if not s.primary_worker_id:
                    issues.append(f"Stage {s.stage_idx} (Layers {s.start_layer}-{s.end_layer}) has no primary worker assigned")
                    missing_stages.append(s.stage_idx)
                for l_idx in range(s.start_layer, s.end_layer + 1):
                    if l_idx in covered_layers:
                        issues.append(f"Duplicate/overlapping layer {l_idx} detected in Stage {s.stage_idx}")
                    covered_layers.add(l_idx)

            expected_layers = set(range(pipeline.total_layers))
            missing_layers = expected_layers - covered_layers
            if missing_layers:
                issues.append(f"Pipeline is missing {len(missing_layers)} layers: {sorted(list(missing_layers))[:10]}...")

            valid = len(issues) == 0 and len(missing_stages) == 0

            return {
                "pipeline_id": pipeline.pipeline_id,
                "model_id": pipeline.model_id,
                "valid": valid,
                "is_complete": pipeline.is_complete,
                "health_score": pipeline.health_score,
                "status": pipeline.status,
                "total_layers": pipeline.total_layers,
                "layers_covered": len(covered_layers),
                "missing_stages": missing_stages,
                "diagnostics": issues,
            }

    def simulate_pipeline_route(self, pipeline_id: str) -> List[Dict[str, Any]]:
        """
        Simulate the sequential activation tensor hopping order across nodes with estimated RTT.
        """
        with self._lock:
            pipeline = self._pipelines.get(pipeline_id)
            if not pipeline:
                raise ValueError(f"Pipeline '{pipeline_id}' not found")

            hops: List[Dict[str, Any]] = []
            for s in pipeline.stages:
                hops.append({
                    "hop_idx": s.stage_idx + 1,
                    "stage_idx": s.stage_idx,
                    "start_layer": s.start_layer,
                    "end_layer": s.end_layer,
                    "worker_id": s.primary_worker_id or "UNASSIGNED",
                    "standby_worker_ids": s.standby_worker_ids,
                    "role": "embeddings_and_blocks" if s.has_embeddings else ("lm_head_and_blocks" if s.has_lm_head else "hidden_blocks"),
                    "estimated_hop_latency_ms": 12.5,
                })
            return hops

    def execute_pipeline_forward_pass(
        self,
        pipeline_id: str,
        prompt: Optional[str] = None,
        token_ids: Optional[List[int]] = None,
        initial_activations: Optional[Union[np.ndarray, List[float]]] = None,
        session_id: Optional[str] = None,
        step: int = 0,
    ) -> Dict[str, Any]:
        """
        Executes a multi-hop sequential forward pass through the sharded pipeline:
        Stage 0 (Embeddings + Blocks) -> Stage 1 (Blocks) -> ... -> Stage K (Blocks + LM Head).
        Streams intermediate activation tensors using binary TensorWireCodec.
        """
        from app.tensor_stream import TensorWireCodec, LayerBlockExecutor

        with self._lock:
            pipeline = self._pipelines.get(pipeline_id)
            if not pipeline:
                raise ValueError(f"Pipeline '{pipeline_id}' not found")

            if not pipeline.is_complete:
                raise ValueError(
                    f"Pipeline '{pipeline_id}' is not complete (status={pipeline.status}). "
                    f"Ensure all {len(pipeline.stages)} stages have primary workers assigned."
                )

            spec = SUPPORTED_SHARDED_MODELS.get(pipeline.model_id, {})
            hidden_dim = spec.get("hidden_size", 8192)
            vocab_size = spec.get("vocab_size", 128256)

            sid = session_id or f"sess-{uuid.uuid4().hex[:8]}"

            # Determine input tokens
            if token_ids is None:
                text_input = prompt or "Hello, Network Nebula decentralized swarm!"
                token_ids = [ord(c) % vocab_size for c in text_input]
                if not token_ids:
                    token_ids = [1, 2, 3]

            activations: Optional[np.ndarray] = None
            if initial_activations is not None:
                if isinstance(initial_activations, np.ndarray):
                    activations = initial_activations
                else:
                    activations = np.array(initial_activations, dtype=np.float32)

            stage_telemetry: List[Dict[str, Any]] = []
            total_wire_bytes = 0
            start_wall = time.time()
            logits: Optional[np.ndarray] = None

            for stage in pipeline.stages:
                t0 = time.time()

                # 1. Handle Stage 0 embeddings if starting from tokens
                if stage.has_embeddings and activations is None:
                    activations = LayerBlockExecutor.embed_tokens(
                        token_ids=token_ids,
                        hidden_dim=hidden_dim,
                        vocab_size=vocab_size,
                    )

                if activations is None:
                    # Fallback initialize if missing
                    activations = np.zeros((1, len(token_ids), hidden_dim), dtype=np.float32)

                # 2. Compute transformer forward pass across stage's layer block slice
                activations = LayerBlockExecutor.forward_layer_slice(
                    activations=activations,
                    start_layer=stage.start_layer,
                    end_layer=stage.end_layer,
                    hidden_dim=hidden_dim,
                    stage_idx=stage.stage_idx,
                )

                # 3. Simulate wire serialization and CRC32 verification down the P2P pipe
                wire_packet = TensorWireCodec.pack(
                    tensor=activations,
                    session_id=sid,
                    stage_idx=stage.stage_idx,
                    step=step,
                    dtype="float32",
                )
                packet_size = len(wire_packet)
                total_wire_bytes += packet_size

                # Roundtrip unpack to verify exact wire integrity
                activations, header = TensorWireCodec.unpack(wire_packet)

                # 4. Handle terminal stage LM Head logits projection
                if stage.has_lm_head:
                    logits = LayerBlockExecutor.project_lm_head(
                        activations=activations,
                        vocab_size=vocab_size,
                    )

                stage_elapsed_ms = round((time.time() - t0) * 1000, 2)
                stage_telemetry.append({
                    "stage_idx": stage.stage_idx,
                    "worker_id": stage.primary_worker_id,
                    "start_layer": stage.start_layer,
                    "end_layer": stage.end_layer,
                    "layers_processed": stage.layer_count,
                    "has_embeddings": stage.has_embeddings,
                    "has_lm_head": stage.has_lm_head,
                    "tensor_shape": list(activations.shape),
                    "wire_bytes_transferred": packet_size,
                    "latency_ms": max(0.5, stage_elapsed_ms),
                    "activation_norm": round(float(np.linalg.norm(activations)), 4),
                })

            total_elapsed_ms = round((time.time() - start_wall) * 1000, 2)

            # Compute prediction metrics from final logits
            predicted_token_id = None
            top_candidates = []
            if logits is not None:
                top_indices = np.argsort(logits[0])[-5:][::-1].tolist()
                predicted_token_id = int(top_indices[0])
                top_candidates = [
                    {"token_id": int(tid), "logit": round(float(logits[0, tid]), 4)}
                    for tid in top_indices
                ]

            return {
                "pipeline_id": pipeline.pipeline_id,
                "model_id": pipeline.model_id,
                "session_id": sid,
                "step": step,
                "prompt": prompt,
                "token_count": len(token_ids),
                "total_wire_bytes": total_wire_bytes,
                "total_latency_ms": max(1.0, total_elapsed_ms),
                "hops_traversed": len(pipeline.stages),
                "output_tensor_shape": list(activations.shape) if activations is not None else None,
                "logits_shape": list(logits.shape) if logits is not None else None,
                "predicted_token_id": predicted_token_id,
                "top_candidates": top_candidates,
                "stage_telemetry": stage_telemetry,
            }

    def get_pipeline(self, pipeline_id: str) -> Optional[SwarmPipeline]:
        with self._lock:
            return self._pipelines.get(pipeline_id)

    def list_pipelines(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [p.to_dict() for p in self._pipelines.values()]

    def delete_pipeline(self, pipeline_id: str) -> bool:
        with self._lock:
            if pipeline_id in self._pipelines:
                del self._pipelines[pipeline_id]
                return True
            return False

    def reset(self):
        with self._lock:
            self._pipelines.clear()


# Global Singleton instance
sharding_engine = ShardingEngine()
