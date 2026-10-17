#!/usr/bin/env python3
"""
Project NetworkNebula — Sparse Mixture-of-Experts (MoE) REST Router
===================================================================
Exposes REST endpoints for managing decentralized MoE pipelines, dynamic
Top-k gating router execution, expert slot assignment, and swarm telemetry.
Mounted under /api/v1/moe.
"""

import logging
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.moe_engine import SUPPORTED_MOE_MODELS, moe_engine

logger = logging.getLogger("moe_router")

router = APIRouter(prefix="/api/v1/moe", tags=["Sparse Mixture-of-Experts (MoE)"])


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class CreateMoEPipelineRequest(BaseModel):
    model_id: str = Field(
        default="mistralai/Mixtral-8x7B-Instruct-v0.1",
        description="Foundation MoE model ID to partition",
    )
    quantization: Optional[str] = Field(default="4bit", description="Quantization: 4bit, 8bit, or fp16")
    name: Optional[str] = Field(default=None, description="Optional friendly name for the pipeline")
    worker_assignments: Optional[Dict[int, str]] = Field(
        default=None, description="Mapping of expert_id -> worker_id"
    )
    standby_assignments: Optional[Dict[int, List[str]]] = Field(
        default=None, description="Mapping of expert_id -> list of standby worker_ids"
    )


class AssignExpertRequest(BaseModel):
    pipeline_id: str = Field(description="Target MoE pipeline ID")
    expert_id: int = Field(ge=0, description="Expert index to assign")
    worker_id: str = Field(description="Worker node ID to assign")
    is_standby: Optional[bool] = Field(default=False, description="Whether to assign as standby replica")
    vram_ceiling_gb: Optional[float] = Field(default=8.0, ge=1.0, le=96.0, description="Worker VRAM limit")


class AssignExpertPairRequest(BaseModel):
    pipeline_id: str = Field(description="Target MoE pipeline ID")
    expert_ids: List[int] = Field(description="List of expert indices to assign to this worker")
    worker_id: str = Field(description="Worker node ID to assign")
    is_standby: Optional[bool] = Field(default=False, description="Whether to assign as standby replica")
    vram_ceiling_gb: Optional[float] = Field(default=8.0, ge=1.0, le=96.0, description="Worker VRAM limit")


class RouteTokensRequest(BaseModel):
    token_count: Optional[int] = Field(default=4, ge=1, le=128, description="Number of tokens to route")
    prompt: Optional[str] = Field(default=None, description="Optional text prompt to simulate tokens for")
    failing_worker_ids: Optional[List[str]] = Field(
        default=None, description="Optional worker IDs to simulate as dropped/offline"
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/models/supported", summary="List supported MoE models catalog")
def get_supported_moe_models() -> Dict[str, Any]:
    """Returns list of all supported sparse MoE models with architectural specs and VRAM budgets."""
    catalog = moe_engine.get_catalog()
    return {
        "status": "success",
        "total_models": len(catalog),
        "models": catalog,
    }


@router.get("/models/{model_id:path}", summary="Get MoE model specification")
def get_moe_model_spec(model_id: str) -> Dict[str, Any]:
    """Returns detailed specification for a given MoE model."""
    spec = moe_engine.get_model_spec(model_id)
    if not spec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"MoE model '{model_id}' not found in catalog.",
        )
    return {"status": "success", "model": spec}


@router.post("/pipelines", summary="Create a new MoE swarm pipeline")
def create_moe_pipeline(payload: CreateMoEPipelineRequest) -> Dict[str, Any]:
    """Initializes a new sparse MoE pipeline for decentralized expert routing."""
    try:
        pipe = moe_engine.create_pipeline(
            model_id=payload.model_id,
            quantization=payload.quantization or "4bit",
            name=payload.name,
            worker_assignments=payload.worker_assignments,
            standby_assignments=payload.standby_assignments,
        )
        return {
            "status": "success",
            "message": f"MoE pipeline '{pipe.pipeline_id}' created successfully.",
            "pipeline": pipe.to_dict(),
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/pipelines", summary="List active MoE pipelines")
def list_moe_pipelines() -> Dict[str, Any]:
    """Lists all registered MoE pipelines."""
    pipelines = [p.to_dict() for p in moe_engine.list_pipelines()]
    return {
        "status": "success",
        "total_pipelines": len(pipelines),
        "pipelines": pipelines,
    }


@router.get("/pipelines/{pipeline_id}", summary="Get MoE pipeline status and layout")
def get_moe_pipeline(pipeline_id: str) -> Dict[str, Any]:
    """Returns full details, expert assignments, and health score for an MoE pipeline."""
    pipe = moe_engine.get_pipeline(pipeline_id)
    if not pipe:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"MoE pipeline '{pipeline_id}' not found.",
        )
    return {
        "status": "success",
        "pipeline": pipe.to_dict(),
    }


@router.delete("/pipelines/{pipeline_id}", summary="Delete an MoE pipeline")
def delete_moe_pipeline(pipeline_id: str) -> Dict[str, Any]:
    """Deletes an active MoE pipeline."""
    deleted = moe_engine.delete_pipeline(pipeline_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"MoE pipeline '{pipeline_id}' not found.",
        )
    return {"status": "success", "message": f"Pipeline '{pipeline_id}' deleted."}


@router.post("/workers/assign-expert", summary="Assign worker node to single expert slot")
def assign_worker_to_expert(payload: AssignExpertRequest) -> Dict[str, Any]:
    """Assigns a worker node to host a specific expert subnetwork with VRAM boundary enforcement."""
    pipe = moe_engine.get_pipeline(payload.pipeline_id)
    if not pipe:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"MoE pipeline '{payload.pipeline_id}' not found.",
        )

    try:
        res = pipe.assign_worker(
            expert_id=payload.expert_id,
            worker_id=payload.worker_id,
            is_standby=payload.is_standby or False,
            vram_ceiling_gb=payload.vram_ceiling_gb or 8.0,
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/workers/assign-pair", summary="Assign worker node to multiple expert slots")
def assign_worker_to_expert_pair(payload: AssignExpertPairRequest) -> Dict[str, Any]:
    """
    Assigns a worker node to a slice of multiple experts (e.g. 2 experts for an 8GB GPU).
    Enforces that combined VRAM fits within worker memory ceiling.
    """
    pipe = moe_engine.get_pipeline(payload.pipeline_id)
    if not pipe:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"MoE pipeline '{payload.pipeline_id}' not found.",
        )

    try:
        res = pipe.assign_worker_expert_pair(
            expert_ids=payload.expert_ids,
            worker_id=payload.worker_id,
            is_standby=payload.is_standby or False,
            vram_ceiling_gb=payload.vram_ceiling_gb or 8.0,
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/pipelines/{pipeline_id}/route-tokens", summary="Route activations through MoE Top-k Gating")
def route_tokens_through_moe(pipeline_id: str, payload: RouteTokensRequest) -> Dict[str, Any]:
    """
    Executes dynamic top-k gating router on token activations,
    dispatches activations to assigned expert hosts, and returns routing telemetry.
    """
    pipe = moe_engine.get_pipeline(pipeline_id)
    if not pipe:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"MoE pipeline '{pipeline_id}' not found.",
        )

    try:
        res = moe_engine.route_tokens(
            pipeline_id=pipeline_id,
            token_count=payload.token_count or 4,
            failing_worker_ids=payload.failing_worker_ids,
        )
        # Convert numpy arrays to serializable lists/stats
        output_matrix = res["output"]
        routing_info = res["routing"]

        return {
            "status": "success",
            "pipeline_id": pipeline_id,
            "model_id": res["model_id"],
            "num_tokens": routing_info["num_tokens"],
            "top_k": routing_info["top_k"],
            "top_k_indices": routing_info["top_k_indices"],
            "top_k_weights": routing_info["top_k_weights"],
            "expert_token_counts": routing_info["expert_token_counts"],
            "entropy": routing_info["entropy"],
            "diversity_score": routing_info["diversity_score"],
            "duration_ms": res["duration_ms"],
            "expert_latencies": res["expert_latencies"],
            "output_shape": list(output_matrix.shape),
            "output_norm": float(np.linalg.norm(output_matrix)),
            "active_experts": res["active_experts"],
            "coverage_pct": res["coverage_pct"],
            "total_failovers": res["total_failovers"],
        }
    except Exception as e:
        logger.error(f"Error routing tokens through MoE pipeline {pipeline_id}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/pipelines/{pipeline_id}/telemetry", summary="Get live MoE pipeline telemetry")
def get_moe_pipeline_telemetry(pipeline_id: str) -> Dict[str, Any]:
    """Returns live expert token load histogram, routing entropy, and auto-healing records."""
    pipe = moe_engine.get_pipeline(pipeline_id)
    if not pipe:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"MoE pipeline '{pipeline_id}' not found.",
        )

    t = pipe.get_telemetry()
    return {
        "status": "success",
        "pipeline_id": pipe.pipeline_id,
        "total_tokens_routed": t.get("total_tokens_routed", 0),
        "average_dispatch_latency_ms": t.get("average_dispatch_latency_ms", 1.2),
        "expert_entropy": t.get("expert_entropy", 2.974),
        "telemetry": t,
    }
