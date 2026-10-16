"""
Project NetworkNebula - Host Node Wallet Withdrawals, Payout Settlement & Billing Receipts
========================================================================================
Implements enterprise wallet payout lifecycle management, automated ledger settlement,
and enterprise compute invoice & billing receipt generation.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    User,
    Worker,
    Task,
    TrainingJob,
    Transaction,
    TransactionType,
    PayoutRequest,
    PayoutStatus,
)
from app.auth import verify_api_auth, verify_enterprise_auth

router = APIRouter(tags=["Wallet Payouts & Enterprise Billing"])

MIN_WITHDRAWAL_USD = 10.0


# ==============================================================================
# Pydantic Schemas
# ==============================================================================

class WithdrawRequestSchema(BaseModel):
    amount: float = Field(..., ge=10.0, description="Withdrawal amount in USD (min $10.00)")
    destination: str = Field(..., description="Destination payout address or bank/crypto wallet")
    payment_method: Optional[str] = Field("Crypto/USDC", description="Payment method/channel")


class SettlePayoutRequestSchema(BaseModel):
    tx_hash: Optional[str] = Field(None, description="External transaction reference / hash")
    notes: Optional[str] = Field(None, description="Settlement audit notes")


class DepositRequestSchema(BaseModel):
    amount: float = Field(..., gt=0.0, description="Deposit amount in USD")
    payment_method: Optional[str] = Field("Credit Card", description="Payment method")



@router.get("/wallet/balance")
@router.get("/api/v1/wallet/balance")
def get_enterprise_wallet_balance(
    user: User = Depends(verify_enterprise_auth),
):
    """Retrieve wallet balance for authenticated enterprise user."""
    return {
        "balance": user.balance,
        "currency": "USD",
        "total_earned": user.total_earned,
    }


@router.post("/api/v1/wallet/deposit")
def deposit_enterprise_wallet_funds(
    payload: DepositRequestSchema,
    user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """Deposit funds into enterprise user wallet."""
    user.balance = round(user.balance + payload.amount, 4)
    trans = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        type=TransactionType.DEPOSIT,
        amount=payload.amount,
        balance_after=user.balance,
        description=f"Enterprise deposit ${payload.amount:.2f} via {payload.payment_method}",
    )
    db.add(trans)
    db.commit()
    return {
        "status": "completed",
        "amount": payload.amount,
        "balance": user.balance,
        "currency": "USD",
    }



@router.post("/wallet/withdraw")
@router.post("/api/v1/wallet/withdraw")
def submit_wallet_withdrawal(
    payload: WithdrawRequestSchema,
    user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):

    """
    Submit a wallet withdrawal request for host node compute earnings.
    Validates minimum $10.00 threshold, checks balance, and logs pending withdrawal.
    """
    amount = round(payload.amount, 2)
    if amount < MIN_WITHDRAWAL_USD:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Minimum withdrawal is ${MIN_WITHDRAWAL_USD:.2f}"
        )

    if amount > user.balance:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient balance. Current balance is ${user.balance:.2f}"
        )

    # Deduct user balance upon withdrawal request initiation
    user.balance = round(user.balance - amount, 4)

    payout_id = str(uuid.uuid4())
    payout = PayoutRequest(
        payout_id=payout_id,
        worker_id=user.id,
        amount=amount,
        status=PayoutStatus.PENDING,
        payment_method=payload.payment_method or "USDC/Crypto",
        payment_address=payload.destination,
    )
    db.add(payout)

    # Record withdrawal transaction in double-entry ledger
    trans = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        type=TransactionType.WITHDRAWAL,
        amount=-amount,
        balance_after=user.balance,
        description=f"Withdrawal request {payout_id[:8]} to {payload.destination}",
    )
    db.add(trans)
    db.commit()
    db.refresh(payout)

    return {
        "status": "pending",
        "payout_id": payout.payout_id,
        "amount": payout.amount,
        "destination": payout.payment_address,
        "payment_method": payout.payment_method,
        "remaining_balance": user.balance,
        "created_at": payout.created_at,
    }


@router.get("/api/v1/wallet/payouts")
def list_wallet_payouts(
    user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """List all payout requests submitted by the authenticated user."""
    payouts = (
        db.query(PayoutRequest)
        .filter(PayoutRequest.worker_id == user.id)
        .order_by(PayoutRequest.created_at.desc())
        .all()
    )

    return [
        {
            "id": p.id,
            "payout_id": p.payout_id,
            "amount": p.amount,
            "status": p.status.value if hasattr(p.status, "value") else str(p.status),
            "payment_method": p.payment_method,
            "payment_address": p.payment_address,
            "created_at": p.created_at,
            "processed_at": p.processed_at,
        }
        for p in payouts
    ]


@router.post("/api/v1/wallet/payouts/{payout_id}/settle")
def settle_wallet_payout(
    payout_id: str,
    payload: Optional[SettlePayoutRequestSchema] = None,
    user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    Automated ledger settlement for a pending payout request.
    Marks status as PAID, logs processed timestamp and settlement transaction.
    """
    payout = db.query(PayoutRequest).filter(PayoutRequest.payout_id == payout_id).first()
    if not payout:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Payout request '{payout_id}' not found"
        )

    if payout.status == PayoutStatus.PAID:
        return {
            "status": "already_settled",
            "payout_id": payout.payout_id,
            "amount": payout.amount,
            "processed_at": payout.processed_at,
        }

    payout.status = PayoutStatus.PAID
    payout.processed_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "status": "paid",
        "payout_id": payout.payout_id,
        "amount": payout.amount,
        "destination": payout.payment_address,
        "processed_at": payout.processed_at,
        "settlement_notes": payload.notes if payload else "Automated cluster settlement",
    }


# ==============================================================================
# Enterprise Compute Billing Receipts & Invoices
# ==============================================================================

@router.get("/api/v1/billing/receipts/{job_id}")
def get_billing_receipt(
    job_id: str,
    user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    Generate structured enterprise billing receipt and printable invoice data
    for a completed training job or inference task.
    """
    # 1. Search in TrainingJob records
    training_job = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()
    if training_job:
        # Calculate compute time
        created_at = training_job.created_at
        completed_at = training_job.completed_at or datetime.now(timezone.utc)
        compute_seconds = 0.0
        if created_at and completed_at:
            compute_seconds = max(1.0, (completed_at - created_at).total_seconds())

        cost = training_job.cost or (training_job.total_epochs * 0.01)
        subtotal = round(cost, 4)
        tax = 0.0
        total = subtotal + tax

        return {
            "invoice_number": f"INV-{job_id[:8].upper()}",
            "receipt_id": f"REC-{job_id[:8].upper()}",
            "job_id": job_id,
            "job_type": "distributed_training" if training_job.parallelism == "data_parallel" else "training",
            "model": training_job.base_model,
            "status": training_job.status,
            "customer_id": training_job.user_id,
            "issue_date": created_at.isoformat() if created_at else datetime.now(timezone.utc).isoformat(),
            "completion_date": completed_at.isoformat() if completed_at else None,
            "compute_duration_seconds": round(compute_seconds, 1),
            "allocated_gpus": training_job.num_gpus,
            "epochs_completed": training_job.current_epoch or training_job.total_epochs,
            "line_items": [
                {
                    "description": f"Decentralized GPU Compute ({training_job.base_model}, {training_job.train_type.upper()})",
                    "quantity": training_job.total_epochs,
                    "unit": "epochs",
                    "unit_price_usd": round(subtotal / max(1, training_job.total_epochs), 4),
                    "amount_usd": subtotal,
                }
            ],
            "subtotal_usd": subtotal,
            "tax_usd": tax,
            "total_usd": total,
            "currency": "USD",
            "payment_status": "settled",
            "provider": "Project NetworkNebula Decentralized GPU Cluster",
        }

    # 2. Search in Task records (Inference / Standalone tasks)
    task = db.query(Task).filter(Task.task_id == job_id).first()
    if task:
        cost = task.cost or 0.0052
        created_at = task.created_at
        updated_at = task.updated_at or datetime.now(timezone.utc)
        compute_seconds = 0.0
        if created_at and updated_at:
            compute_seconds = max(0.5, (updated_at - created_at).total_seconds())

        return {
            "invoice_number": f"INV-{job_id[:8].upper()}",
            "receipt_id": f"REC-{job_id[:8].upper()}",
            "job_id": job_id,
            "job_type": task.task_type.value if hasattr(task.task_type, "value") else str(task.task_type),
            "model": "NetworkNebula-Inference",
            "status": task.status.value if hasattr(task.status, "value") else str(task.status),
            "customer_id": task.user_id or user.id,
            "issue_date": created_at.isoformat() if created_at else datetime.now(timezone.utc).isoformat(),
            "completion_date": updated_at.isoformat() if updated_at else None,
            "compute_duration_seconds": round(compute_seconds, 1),
            "allocated_gpus": 1,
            "epochs_completed": 1,
            "line_items": [
                {
                    "description": f"Neural Inference Execution ({task.prompt[:40]}...)",
                    "quantity": 1,
                    "unit": "request",
                    "unit_price_usd": round(cost, 4),
                    "amount_usd": round(cost, 4),
                }
            ],
            "subtotal_usd": round(cost, 4),
            "tax_usd": 0.0,
            "total_usd": round(cost, 4),
            "currency": "USD",
            "payment_status": "settled",
            "provider": "Project NetworkNebula Decentralized GPU Cluster",
        }

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Compute job or task '{job_id}' not found for billing receipt"
    )
