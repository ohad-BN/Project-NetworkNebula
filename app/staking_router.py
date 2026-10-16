#!/usr/bin/env python3
"""
Project NetworkNebula — Node Staking & Automated Slashing REST Router
===================================================================
Exposes collateral deposit, release, automated slashing, and slashing
history endpoints for decentralized GPU worker nodes.
Mounted under /api/v1.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.staking_engine import staking_engine

logger = logging.getLogger("staking_router")

router = APIRouter(prefix="/api/v1", tags=["Node Staking & Slashing"])


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class StakeRequest(BaseModel):
    amount_usd: float = Field(gt=0.0, description="Amount in USD to deposit as collateral stake")
    user_id: Optional[str] = Field(default=None, description="Host user ID providing the collateral")


class UnstakeRequest(BaseModel):
    amount_usd: float = Field(gt=0.0, description="Amount in USD to release from staked collateral")
    user_id: Optional[str] = Field(default=None, description="Host user ID receiving the released collateral")


class SlashRequest(BaseModel):
    reason: str = Field(description="Reason for SLA slashing penalty (e.g. UNANNOUNCED_DISCONNECT, VERIFIED_FRAUD)")
    penalty_pct: float = Field(gt=0.0, le=100.0, description="Percentage of stake to slash (e.g. 25.0 or 100.0)")
    task_id: Optional[str] = Field(default=None, description="ID of the impacted training/inference task")
    victim_user_id: Optional[str] = Field(default=None, description="Impacted enterprise customer user ID to compensate")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/workers/{worker_id}/stake", summary="Deposit Node Collateral Stake")
def stake_worker_collateral(
    worker_id: str,
    payload: StakeRequest,
    db: Session = Depends(get_db),
):
    """
    Lock collateral funds into a worker node's staking pool to qualify for
    high-priority enterprise training or inference workloads.
    """
    try:
        res = staking_engine.stake_collateral(
            db=db,
            worker_id=worker_id,
            amount_usd=payload.amount_usd,
            user_id=payload.user_id,
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to stake collateral on node {worker_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/workers/{worker_id}/unstake", summary="Release Node Collateral Stake")
def unstake_worker_collateral(
    worker_id: str,
    payload: UnstakeRequest,
    db: Session = Depends(get_db),
):
    """
    Withdraw unlocked collateral from a worker node back to the host user's wallet.
    Node must be idle and not mid-computation.
    """
    try:
        res = staking_engine.unstake_collateral(
            db=db,
            worker_id=worker_id,
            amount_usd=payload.amount_usd,
            user_id=payload.user_id,
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to unstake collateral on node {worker_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/workers/{worker_id}/slash", summary="Execute Automated Slashing Penalty")
def slash_worker_penalty(
    worker_id: str,
    payload: SlashRequest,
    db: Session = Depends(get_db),
):
    """
    Deduct a penalty percentage from a worker node's staked collateral for SLA
    violations or cryptographic fraud, redistributing 80% to the enterprise customer.
    """
    try:
        res = staking_engine.slash_worker(
            db=db,
            worker_id=worker_id,
            reason=payload.reason,
            penalty_pct=payload.penalty_pct,
            task_id=payload.task_id,
            victim_user_id=payload.victim_user_id,
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to execute slash on node {worker_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/workers/{worker_id}/staking", summary="Get Worker Staking Status")
def get_worker_staking_status(
    worker_id: str,
    db: Session = Depends(get_db),
):
    """Fetch live collateral balance, reputation score, and tier qualification."""
    try:
        return staking_engine.get_staking_status(db=db, worker_id=worker_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to fetch staking status for node {worker_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/workers/{worker_id}/slashing-history", summary="Get Worker Slashing History")
def get_worker_slashing_history(
    worker_id: str,
    db: Session = Depends(get_db),
):
    """Fetch immutable historical slashing penalties and customer compensation records."""
    try:
        history = staking_engine.get_slashing_history(db=db, worker_id=worker_id)
        return {
            "worker_id": worker_id,
            "total_slash_events": len(history),
            "events": history,
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to fetch slashing history for node {worker_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/staking/leaderboard", summary="Get Staking Leaderboard")
def get_staking_leaderboard(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """List highest-staked and highest-reputation GPU nodes in the cluster."""
    try:
        nodes = staking_engine.get_staking_leaderboard(db=db, limit=limit)
        return {
            "total": len(nodes),
            "leaderboard": nodes,
        }
    except Exception as e:
        logger.error(f"Failed to fetch staking leaderboard: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
