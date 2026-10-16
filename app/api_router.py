"""
Project NetworkNebula - Frontend Compatibility Bridge Router
Mounts under '/api' to provide 100% contract compatibility with React frontend services.
"""

import json
import random
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_user_by_email, verify_api_auth
from app.database import get_db
from app.models import (
    PayoutRequest,
    PayoutStatus,
    Task,
    TaskStatus,
    TaskType,
    Transaction,
    TransactionType,
    User,
    Worker,
)
from app.worker import render_image

api_router = APIRouter(prefix="/api")

PRICING_RATE = 0.001


def calculate_cost(width: int, height: int, steps: int) -> float:
    megapixels = (width * height) / 1000000
    return round(megapixels * steps * PRICING_RATE, 4)


# ==============================================================================
# Task Endpoints (Frontend Contract)
# ==============================================================================


class TaskSubmitPayload(BaseModel):
    prompt: str
    width: int = 512
    height: int = 512
    num_images: int = 1
    steps: int = 20
    model: Optional[str] = "runwayml/stable-diffusion-v1-5"


@api_router.post("/tasks")
def submit_task(
    payload: TaskSubmitPayload,
    user=Depends(verify_api_auth),
    db: Session = Depends(get_db),
):
    """Submit a new image generation task from React UI"""
    cost = calculate_cost(payload.width, payload.height, payload.steps)

    if user.balance < cost:
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient balance. Task cost: ${cost:.4f}, available: ${user.balance:.2f}",
        )

    seed = random.randint(0, 2**31 - 1)

    # Queue Celery worker task
    try:
        celery_task = render_image.delay(
            prompt=payload.prompt,
            width=payload.width,
            height=payload.height,
            steps=payload.steps,
            seed=seed,
            user_id=user.id,
            model_id=payload.model or "runwayml/stable-diffusion-v1-5",
        )
        task_id = celery_task.id
    except Exception as e:
        # Fallback if Celery broker is starting up or in standalone mode
        task_id = str(uuid.uuid4())

    db_task = Task(
        task_id=task_id,
        user_id=user.id,
        prompt=payload.prompt,
        width=payload.width,
        height=payload.height,
        steps=payload.steps,
        seed=seed,
        cost=cost,
        task_mode="celery",
        task_type=TaskType.INFERENCE,
        status=TaskStatus.QUEUED,
        result=json.dumps({"prompt": payload.prompt}),
    )

    user.balance -= cost
    trans = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        task_id=task_id,
        type=TransactionType.PAYMENT,
        amount=-cost,
        balance_after=user.balance,
        description=f"Image generation task: {payload.prompt[:30]}...",
    )

    db.add(db_task)
    db.add(trans)
    db.commit()

    return {
        "id": db_task.task_id,
        "task_id": db_task.task_id,
        "status": "pending",
        "prompt": db_task.prompt,
        "cost": cost,
        "created_at": str(db_task.created_at),
    }


@api_router.get("/tasks/{task_id}")
def get_task_status_compat(
    task_id: str,
    db: Session = Depends(get_db),
):
    """Retrieve task status with lowercase statuses for React frontend"""
    task = db.query(Task).filter(Task.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    status_map = {
        "PENDING": "pending",
        "QUEUED": "pending",
        "PROCESSING": "processing",
        "SUCCESS": "completed",
        "FAILURE": "failed",
    }
    raw_status = task.status.value if hasattr(task.status, "value") else str(task.status)
    ui_status = status_map.get(raw_status, "processing")

    result_payload = {"image_url": task.output_url, "prompt": task.prompt}
    if task.result:
        try:
            extra = json.loads(task.result)
            result_payload.update(extra)
            if "output_url" in extra and not result_payload["image_url"]:
                result_payload["image_url"] = extra["output_url"]
        except Exception:
            pass

    return {
        "id": task.task_id,
        "task_id": task.task_id,
        "status": ui_status,
        "progress": task.progress,
        "cost": task.cost,
        "output_url": task.output_url,
        "result": result_payload,
        "created_at": str(task.created_at),
        "completed_at": str(task.updated_at) if ui_status in ["completed", "failed"] else None,
    }


@api_router.get("/tasks")
def list_tasks_compat(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    user=Depends(verify_api_auth),
):
    """List tasks for job history dashboard"""
    skip = (page - 1) * limit
    query = db.query(Task).order_by(Task.created_at.desc())

    if not user.is_admin:
        query = query.filter(Task.user_id == user.id)

    total = query.count()
    tasks = query.offset(skip).limit(limit).all()

    status_map = {
        "PENDING": "pending",
        "QUEUED": "pending",
        "PROCESSING": "processing",
        "SUCCESS": "completed",
        "FAILURE": "failed",
    }

    formatted = []
    for t in tasks:
        raw_status = t.status.value if hasattr(t.status, "value") else str(t.status)
        formatted.append({
            "id": t.task_id,
            "task_id": t.task_id,
            "prompt": t.prompt,
            "status": status_map.get(raw_status, "processing"),
            "cost": t.cost,
            "progress": t.progress,
            "output_url": t.output_url,
            "result": {"image_url": t.output_url},
            "created_at": str(t.created_at),
        })

    return {"tasks": formatted, "total": total}


# ==============================================================================
# Wallet Endpoints (Frontend Contract)
# ==============================================================================


@api_router.get("/wallet/balance")
def get_wallet_balance(user=Depends(verify_api_auth)):
    """Get wallet balance for current user"""
    return {
        "balance": user.balance,
        "currency": "USD",
        "total_earned": user.total_earned,
    }


@api_router.post("/wallet/deposit")
def deposit_funds_compat(
    data: dict,
    user=Depends(verify_api_auth),
    db: Session = Depends(get_db),
):
    """Deposit funds from React wallet modal"""
    amount = float(data.get("amount", 0.0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    user.balance += amount
    trans = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        type=TransactionType.DEPOSIT,
        amount=amount,
        balance_after=user.balance,
        description=f"Deposit ${amount:.2f} via {data.get('payment_method', 'Credit Card')}",
    )
    db.add(trans)
    db.commit()

    return {
        "id": trans.transaction_id,
        "amount": amount,
        "currency": "USD",
        "status": "completed",
        "balance": user.balance,
        "created_at": str(trans.created_at),
        "description": trans.description,
    }


@api_router.post("/wallet/withdraw")
def withdraw_funds_compat(
    data: dict,
    user=Depends(verify_api_auth),
    db: Session = Depends(get_db),
):
    """Withdraw funds from worker wallet"""
    amount = float(data.get("amount", 0.0))
    destination = data.get("destination", "Default Wallet")

    if amount < 10.0:
        raise HTTPException(status_code=400, detail="Minimum withdrawal is $10.00")
    if amount > user.balance:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    user.balance = round(user.balance - amount, 4)
    payout = PayoutRequest(
        payout_id=str(uuid.uuid4()),
        worker_id=user.id,
        amount=amount,
        status=PayoutStatus.PENDING,
        payment_method=data.get("payment_method", "Crypto/USDC"),
        payment_address=destination,
    )
    db.add(payout)

    trans = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        type=TransactionType.WITHDRAWAL,
        amount=-amount,
        balance_after=user.balance,
        description=f"Withdrawal to {destination}",
    )
    db.add(trans)
    db.commit()

    return {
        "id": payout.payout_id,
        "payout_id": payout.payout_id,
        "amount": amount,
        "currency": "USD",
        "status": "pending",
        "destination": destination,
        "balance": user.balance,
    }



@api_router.get("/wallet/transactions")
def get_wallet_transactions(
    limit: int = Query(50, ge=1, le=100),
    user=Depends(verify_api_auth),
    db: Session = Depends(get_db),
):
    """Get transaction history for wallet page"""
    transactions = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id)
        .order_by(Transaction.created_at.desc())
        .limit(limit)
        .all()
    )

    type_map = {
        TransactionType.DEPOSIT: "deposit",
        TransactionType.WITHDRAWAL: "withdraw",
        TransactionType.EARNING: "earning",
        TransactionType.PAYMENT: "payout",
        TransactionType.REFUND: "deposit",
    }

    return [
        {
            "id": t.transaction_id,
            "type": type_map.get(t.type, "deposit"),
            "amount": abs(t.amount),
            "currency": "USD",
            "status": "completed",
            "created_at": str(t.created_at),
            "description": t.description,
        }
        for t in transactions
    ]
