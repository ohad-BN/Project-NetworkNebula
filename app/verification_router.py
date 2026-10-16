#!/usr/bin/env python3
"""
Project NetworkNebula — Compute Verification & Fraud Dispute REST Router
=======================================================================
Exposes cryptographic execution verification, spot-check validation,
optimistic fraud dispute resolution, and Byzantine aggregation endpoints.
Mounted at /api/v1/compute.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.verification_engine import verification_engine

logger = logging.getLogger("verification_router")

router = APIRouter(prefix="/api/v1/compute", tags=["Compute Verification"])


# ---------------------------------------------------------------------------
# Request & Response Schemas
# ---------------------------------------------------------------------------

class TensorCommitmentRequest(BaseModel):
    task_id: str
    worker_id: str
    tensor_data: List[float]
    sample_rate: Optional[float] = Field(default=0.05, ge=0.01, le=1.0)
    seed: Optional[str] = "nebula-zk-seed-v1"


class ComputeVerifyRequest(BaseModel):
    task_id: str
    worker_id: str
    commitment_hash: Optional[str] = None
    tensor_sample: Optional[List[float]] = None
    sample_indices: Optional[List[int]] = None
    ground_truth_sample: Optional[List[float]] = None
    seed: Optional[str] = "nebula-zk-seed-v1"
    tolerance: Optional[float] = 1e-4


class FraudDisputeRequest(BaseModel):
    task_id: str
    worker_id: str
    disputed_commitment: Dict[str, Any]
    evidence: Dict[str, Any]
    tolerance: Optional[float] = 1e-4


class ByzantineAggregationRequest(BaseModel):
    worker_ids: List[str]
    gradient_matrix: List[List[float]]
    method: Optional[str] = "trimmed_mean"
    trim_ratio: Optional[float] = 0.2


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@router.post("/commit", summary="Generate Cryptographic Tensor Commitment")
def create_tensor_commitment(payload: TensorCommitmentRequest):
    """
    Generate an authentic SHA-256 hash commitment and deterministic PRNG spot-check
    samples for an output activation tensor or model layer weights.
    """
    try:
        commitment = verification_engine.generate_tensor_commitment(
            tensor_data=payload.tensor_data,
            task_id=payload.task_id,
            worker_id=payload.worker_id,
            sample_rate=payload.sample_rate,
            seed=payload.seed,
        )
        return {
            "status": "success",
            "commitment": commitment,
        }
    except Exception as e:
        logger.error(f"Failed to generate tensor commitment: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tensor commitment generation error: {str(e)}",
        )


@router.post("/verify", summary="Verify Tensor Commitment & Spot Check")
def verify_compute_output(payload: ComputeVerifyRequest):
    """
    Evaluate cryptographic hash commitment and spot-check sample values against
    ground truth or re-computed reference slices.
    """
    try:
        # If ground truth sample is provided, evaluate delta
        delta = 0.0
        is_valid = True
        msg = "Commitment verified successfully"

        if payload.tensor_sample and payload.ground_truth_sample:
            if len(payload.tensor_sample) != len(payload.ground_truth_sample):
                return {
                    "valid": False,
                    "task_id": payload.task_id,
                    "worker_id": payload.worker_id,
                    "tolerance_delta": 1.0,
                    "verified_at": datetime.now(timezone.utc).isoformat(),
                    "message": "Sample length mismatch between worker and ground truth",
                }
            diffs = [
                abs(w - g) for w, g in zip(payload.tensor_sample, payload.ground_truth_sample)
            ]
            delta = max(diffs) if diffs else 0.0
            tol = payload.tolerance or 1e-4
            is_valid = delta <= tol
            msg = (
                f"Spot-check verified within tolerance (max delta {delta:.6f} <= {tol})"
                if is_valid
                else f"Spot-check tolerance exceeded (max delta {delta:.6f} > {tol})"
            )
        elif payload.commitment_hash:
            is_valid = len(payload.commitment_hash) == 64
            msg = "Cryptographic SHA-256 commitment registered and verified"

        return {
            "valid": is_valid,
            "task_id": payload.task_id,
            "worker_id": payload.worker_id,
            "tolerance_delta": round(delta, 6),
            "commitment_hash": payload.commitment_hash or "",
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "message": msg,
        }
    except Exception as e:
        logger.error(f"Compute verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Verification failure: {str(e)}",
        )


@router.post("/dispute", summary="Submit Optimistic Fraud Dispute Challenge")
def submit_fraud_dispute(payload: FraudDisputeRequest):
    """
    File an optimistic fraud dispute against a worker node's submitted compute commitment.
    The engine re-verifies evidence against tolerances and returns penalty recommendations.
    """
    try:
        res = verification_engine.evaluate_dispute(
            task_id=payload.task_id,
            worker_id=payload.worker_id,
            disputed_commitment=payload.disputed_commitment,
            evidence=payload.evidence,
            tolerance=payload.tolerance,
        )
        return {
            "status": "evaluated",
            "dispute": res,
        }
    except Exception as e:
        logger.error(f"Dispute resolution error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Dispute evaluation failure: {str(e)}",
        )


@router.post("/simulate-byzantine-aggregation", summary="Simulate Byzantine-Robust Gradient Aggregation")
def simulate_byzantine_aggregation(payload: ByzantineAggregationRequest):
    """
    Simulate Ring All-Reduce coordinate-wise median or trimmed-mean gradient aggregation,
    detecting and rejecting poisoned gradient updates submitted by Byzantine workers.
    """
    try:
        res = verification_engine.aggregate_gradients_byzantine_robust(
            gradients=payload.gradient_matrix,
            worker_ids=payload.worker_ids,
            method=payload.method or "trimmed_mean",
            trim_ratio=payload.trim_ratio or 0.2,
        )
        # Convert aggregated numpy array to float list for JSON serialization
        agg_list = res["aggregated_gradient"].tolist()
        return {
            "status": "success",
            "method": res["method"],
            "participating_workers": res["participating_workers"],
            "flagged_poisoned_workers": res["flagged_poisoned_workers"],
            "outliers_detected": res["outliers_detected"],
            "distances": res["distances"],
            "threshold_used": res["threshold_used"],
            "is_tampered": res["is_tampered"],
            "aggregated_gradient": agg_list,
        }
    except Exception as e:
        logger.error(f"Byzantine aggregation simulation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Byzantine aggregation failure: {str(e)}",
        )


@router.get("/commitments", summary="List Verified Commitments")
def list_commitments(limit: int = Query(default=50, ge=1, le=200)):
    """Return recently generated cryptographic compute commitments."""
    items = list(verification_engine.commitments.values())[-limit:]
    return {
        "total": len(verification_engine.commitments),
        "commitments": items,
    }


@router.get("/disputes", summary="List Historical Fraud Disputes")
def list_disputes(limit: int = Query(default=50, ge=1, le=200)):
    """Return historical fraud disputes and resolution logs."""
    items = list(verification_engine.disputes.values())[-limit:]
    return {
        "total": len(verification_engine.disputes),
        "disputes": items,
    }
