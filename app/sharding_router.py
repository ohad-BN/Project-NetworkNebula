#!/usr/bin/env python3
"""
Project NetworkNebula — Swarm Model Sharding & Pipeline Topology REST Router
===========================================================================
Exposes endpoints for creating sharded pipelines, allocating contiguous
transformer layer blocks to worker nodes, and verifying pipeline topology.
Mounted under /api/v1/swarm.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.sharding_engine import sharding_engine

logger = logging.getLogger("sharding_router")

router = APIRouter(prefix="/api/v1/swarm", tags=["Swarm Model Sharding & Pipelines"])


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class CreatePipelineRequest(BaseModel):
    model_id: str = Field(default="meta-llama/Llama-3-70B", description="Foundation model ID to shard")
    num_stages: int = Field(default=4, ge=1, le=64, description="Number of pipeline stages/nodes to partition across")
    quantization: Optional[str] = Field(default="4bit", description="Weight quantization: 4bit, 8bit, or fp16")
    worker_ids: Optional[List[str]] = Field(default=None, description="Optional primary worker IDs to assign to stages")
    standby_worker_ids: Optional[List[str]] = Field(default=None, description="Optional standby replica worker IDs")
    name: Optional[str] = Field(default=None, description="Optional friendly name for the pipeline")
    total_layers_override: Optional[int] = Field(default=None, description="Optional layer count override for custom models")


class AssignShardRequest(BaseModel):
    pipeline_id: str = Field(description="Target swarm pipeline ID")
    stage_idx: int = Field(ge=0, description="Stage index (0-based) to assign the worker to")
    worker_id: str = Field(description="Worker node ID to assign")
    is_standby: Optional[bool] = Field(default=False, description="Whether to assign as standby replica rather than primary")


class PartitionModelRequest(BaseModel):
    model_id: str = Field(default="meta-llama/Llama-3-70B")
    num_stages: int = Field(default=4, ge=1, le=64)
    quantization: Optional[str] = Field(default="4bit")


class PipelineForwardRequest(BaseModel):
    prompt: Optional[str] = Field(default=None, description="Input text prompt to tokenize and process")
    token_ids: Optional[List[int]] = Field(default=None, description="Direct token IDs list")
    session_id: Optional[str] = Field(default=None, description="Active swarm session ID")
    step: Optional[int] = Field(default=0, ge=0, description="Autoregressive generation step")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/models/supported", summary="List Supported Sharded Foundation Models")
def get_supported_sharded_models():
    """Returns pre-configured 70B+ and test foundation models available for swarm sharding."""
    return {
        "status": "success",
        "models": sharding_engine.get_supported_models(),
    }


@router.post("/partition-plan", summary="Compute Dry-Run Partition Plan")
def compute_partition_plan(payload: PartitionModelRequest):
    """
    Dry-run simulation of layer block boundaries, VRAM requirements, and embedding/head placement.
    """
    try:
        stages = sharding_engine.partition_model_layers(
            model_id=payload.model_id,
            num_stages=payload.num_stages,
            quantization=payload.quantization,
        )
        return {
            "status": "success",
            "model_id": payload.model_id,
            "num_stages": payload.num_stages,
            "quantization": payload.quantization,
            "stages": [s.to_dict() for s in stages],
            "total_vram_budget_gb": round(sum(s.estimated_vram_gb for s in stages), 2),
        }
    except Exception as e:
        logger.error(f"Partition calculation failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/pipelines", summary="Create New Swarm Pipeline Configuration")
def create_swarm_pipeline(payload: CreatePipelineRequest):
    """
    Create a new swarm pipeline, partitioning the target model and optionally binding workers.
    """
    try:
        pipeline = sharding_engine.create_pipeline(
            model_id=payload.model_id,
            num_stages=payload.num_stages,
            quantization=payload.quantization or "4bit",
            worker_ids=payload.worker_ids,
            standby_worker_ids=payload.standby_worker_ids,
            name=payload.name,
            total_layers_override=payload.total_layers_override,
        )
        return {
            "status": "success",
            "pipeline": pipeline.to_dict(),
        }
    except Exception as e:
        logger.error(f"Failed to create pipeline: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/pipelines", summary="List All Active Swarm Pipelines")
def list_swarm_pipelines():
    """Returns all registered swarm pipelines with health status and stage coverage."""
    return {
        "status": "success",
        "total": len(sharding_engine.list_pipelines()),
        "pipelines": sharding_engine.list_pipelines(),
    }


@router.get("/pipelines/{pipeline_id}", summary="Get Swarm Pipeline Topology")
def get_swarm_pipeline(pipeline_id: str):
    """Retrieve full pipeline topology, stage assignments, and layer boundaries."""
    pipeline = sharding_engine.get_pipeline(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline '{pipeline_id}' not found")
    return {
        "status": "success",
        "pipeline": pipeline.to_dict(),
    }


@router.post("/workers/assign-shard", summary="Assign Worker Node to Pipeline Stage")
def assign_worker_shard(payload: AssignShardRequest):
    """
    Bind a worker node to a specific contiguous layer slice in an active pipeline.
    """
    try:
        result = sharding_engine.assign_worker_to_stage(
            pipeline_id=payload.pipeline_id,
            stage_idx=payload.stage_idx,
            worker_id=payload.worker_id,
            is_standby=payload.is_standby or False,
        )
        return {
            "status": "success",
            "assignment": result,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/pipelines/{pipeline_id}/validate", summary="Validate Pipeline Topology & Completeness")
def validate_pipeline_topology(pipeline_id: str):
    """
    Audit pipeline completeness, missing layer blocks, duplicate ranges, and standby redundancy.
    """
    try:
        validation = sharding_engine.validate_pipeline(pipeline_id)
        return {
            "status": "success",
            "validation": validation,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/pipelines/{pipeline_id}/route", summary="Simulate Sequential P2P Hopping Route")
def get_pipeline_route(pipeline_id: str):
    """
    Returns the sequential order of physical nodes traversed during an activation forward pass.
    """
    try:
        route = sharding_engine.simulate_pipeline_route(pipeline_id)
        return {
            "status": "success",
            "pipeline_id": pipeline_id,
            "total_hops": len(route),
            "hops": route,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/pipelines/{pipeline_id}/forward", summary="Execute Sequential P2P Pipeline Forward Pass")
def execute_pipeline_forward(pipeline_id: str, payload: PipelineForwardRequest):
    """
    Executes a multi-hop sequential forward pass across the pipeline stages:
    Stage 0 (Embeddings + Blocks) -> Stage 1 (Blocks) -> ... -> Stage K (Blocks + LM Head).
    Transfers intermediate activation tensors via high-performance binary TensorWireCodec.
    """
    try:
        result = sharding_engine.execute_pipeline_forward_pass(
            pipeline_id=pipeline_id,
            prompt=payload.prompt,
            token_ids=payload.token_ids,
            session_id=payload.session_id,
            step=payload.step or 0,
        )
        return {
            "status": "success",
            "forward_result": result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Pipeline forward error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/pipelines/{pipeline_id}", summary="Delete Swarm Pipeline")
def delete_swarm_pipeline(pipeline_id: str):
    """Deregister and teardown an active swarm pipeline."""
    deleted = sharding_engine.delete_pipeline(pipeline_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Pipeline '{pipeline_id}' not found")
    return {
        "status": "success",
        "pipeline_id": pipeline_id,
        "message": "Pipeline deleted successfully",
    }
