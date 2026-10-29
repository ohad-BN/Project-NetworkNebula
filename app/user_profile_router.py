#!/usr/bin/env python3
"""
Project NetworkNebula — Flagship User Profile & Activity Router
===============================================================
Delivers cross-device user profile persistence, usage metrics, activity timelines,
and unverified registration cancellation.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import verify_api_auth
from app.database import get_db
from app.models import ApiToken, AuditLog, Task, TaskStatus, TrainingJob, Transaction, User

router = APIRouter(tags=["User Profile & Activity"])


class CancelRegistrationRequest(BaseModel):
    email: str


@router.get("/api/v1/user/profile", summary="Get Full Account Profile & Compute Totals")
def get_user_profile(
    user: User = Depends(verify_api_auth),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Returns complete authenticated user profile, masked API keys,
    and aggregate compute totals across all worker and creator jobs.
    """
    total_tasks = db.query(Task).filter(Task.user_id == user.id).count()
    completed_tasks = (
        db.query(Task).filter(Task.user_id == user.id, Task.status == TaskStatus.SUCCESS).count()
    )

    total_training = db.query(TrainingJob).filter(TrainingJob.user_id == user.id).count()
    completed_training = (
        db.query(TrainingJob)
        .filter(TrainingJob.user_id == user.id, TrainingJob.status == "completed")
        .count()
    )

    total_tokens = (
        db.query(ApiToken).filter(ApiToken.user_id == user.id, ApiToken.is_active == True).count()
    )

    masked_key = f"{user.api_key[:8]}...{user.api_key[-4:]}" if user.api_key else "None"

    return {
        "id": user.id,
        "email": user.email,
        "name": user.name or user.email.split("@")[0],
        "role": "worker" if user.is_worker else "creator",
        "is_worker": user.is_worker,
        "balance": round(float(user.balance or 0.0), 2),
        "total_earned": round(float(user.total_earned or 0.0), 2),
        "is_verified": bool(user.is_verified),
        "invited_by_code": user.invited_by_code or "NEBULA-ALPHA-2026",
        "api_key": user.api_key,
        "api_key_masked": masked_key,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "stats": {
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "total_training_jobs": total_training,
            "completed_training_jobs": completed_training,
            "active_api_tokens": total_tokens,
        },
    }


@router.get("/api/v1/user/activity", summary="Get Unified User Activity & Audit Timeline")
def get_user_activity(
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(verify_api_auth),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Returns a chronological activity timeline combining audit events,
    transactions, training runs, and inference tasks belonging strictly to this user.
    """
    events: List[Dict[str, Any]] = []

    # 1. Audit Logs (Actor = current_user.id)
    audits = (
        db.query(AuditLog)
        .filter(AuditLog.actor_id == user.id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    for a in audits:
        try:
            details_dict = json.loads(a.details) if a.details else {}
        except Exception:
            details_dict = {}
        events.append({
            "id": f"audit-{a.id}",
            "category": "security",
            "title": a.action,
            "description": details_dict.get("message") or a.event_type,
            "timestamp": a.created_at.isoformat() if a.created_at else datetime.utcnow().isoformat(),
            "status": "info" if a.severity == "info" else "warning",
            "metadata": details_dict,
        })

    # 2. Transactions (Ledger grants, spends, claims)
    txs = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id)
        .order_by(Transaction.created_at.desc())
        .limit(limit)
        .all()
    )
    for tx in txs:
        raw_type = tx.type.value if hasattr(tx.type, "value") else str(tx.type)
        is_credit = tx.amount > 0 and raw_type in ["DEPOSIT", "FAUCET_GRANT", "EARNING"]
        events.append({
            "id": f"tx-{tx.id}",
            "category": "wallet",
            "title": f"{raw_type.replace('_', ' ').title()}: {'+' if is_credit else '-'}${abs(tx.amount):.2f}",
            "description": tx.description or f"Wallet balance updated to ${tx.balance_after:.2f}",
            "timestamp": tx.created_at.isoformat() if tx.created_at else datetime.utcnow().isoformat(),
            "status": "success",
            "metadata": {"type": raw_type, "amount": tx.amount, "balance_after": tx.balance_after},
        })

    # 3. Training Jobs launched by user
    jobs = (
        db.query(TrainingJob)
        .filter(TrainingJob.user_id == user.id)
        .order_by(TrainingJob.created_at.desc())
        .limit(limit)
        .all()
    )
    for j in jobs:
        events.append({
            "id": f"job-{j.id}",
            "category": "training",
            "title": f"Fine-Tuning Run: {j.name}",
            "description": f"Model: {j.base_model} · Epochs: {j.current_epoch}/{j.total_epochs} · Status: {j.status}",
            "timestamp": j.created_at.isoformat() if j.created_at else datetime.utcnow().isoformat(),
            "status": "success" if j.status == "completed" else ("running" if j.status == "running" else "info"),
            "metadata": {"job_id": j.id, "base_model": j.base_model, "status": j.status},
        })

    # 4. Tasks (Inference runs)
    tasks = (
        db.query(Task)
        .filter(Task.user_id == user.id)
        .order_by(Task.created_at.desc())
        .limit(limit)
        .all()
    )
    for t in tasks:
        raw_status = t.status.value if hasattr(t.status, "value") else str(t.status)
        events.append({
            "id": f"task-{t.id}",
            "category": "task",
            "title": f"Image Generation: {t.prompt[:40]}...",
            "description": f"Cost: ${t.cost:.4f} · Resolution: {t.width}x{t.height} · Status: {raw_status}",
            "timestamp": t.created_at.isoformat() if t.created_at else datetime.utcnow().isoformat(),
            "status": "success" if raw_status == "SUCCESS" else "info",
            "metadata": {"task_id": t.task_id, "prompt": t.prompt, "cost": t.cost},
        })

    # Sort all merged events by timestamp desc
    events.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return events[:limit]


@router.post("/auth/cancel-registration", summary="Purge Details of Unverified Pending Registration")
def cancel_registration(
    payload: CancelRegistrationRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Allows a user or frontend to abandon a registration before email OTP verification.
    Purges unverified account details completely from the database.
    """
    clean_email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == clean_email).first()
    if not user:
        return {"status": "ok", "message": "No account found."}

    if user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel an already verified account. Please contact support or request account deletion.",
        )

    # Purge unverified pending record
    db.delete(user)
    db.commit()
    return {
        "status": "cancelled",
        "message": f"Pending unverified account for {clean_email} has been completely purged.",
    }
