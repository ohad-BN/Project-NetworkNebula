import json
import random
import time
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import (
    create_api_key_pair,
    get_user_by_email,
    hash_password,
    verify_api_auth,
    verify_enterprise_auth,
    verify_password,
)
from app.config import settings
from app.database import Base, engine, get_db
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
from app.worker import celery_app, render_image, run_batch_inference, train_model

app = FastAPI(title=settings.APP_NAME, version="1.9.1")

# CORS middleware - allow frontend on port 5173 to communicate with API on port 8000
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def nebula_distributed_tracing_middleware(request: Request, call_next):
    """
    Distributed request tracing & Prometheus telemetry middleware (Phase 4.4).
    Injects X-Nebula-Trace-ID, X-Nebula-Node-ID, and X-Nebula-Latency-Ms headers
    on every gateway response and updates latency percentiles.
    """
    start_time = time.time()
    trace_id = request.headers.get("X-Nebula-Trace-ID") or f"nebula-trc-{uuid.uuid4().hex[:16]}"
    node_id = getattr(settings, "NODE_ID", "nebula-gateway-us-east-1")

    response = await call_next(request)

    duration_ms = (time.time() - start_time) * 1000.0
    response.headers["X-Nebula-Trace-ID"] = trace_id
    response.headers["X-Nebula-Node-ID"] = str(node_id)
    response.headers["X-Nebula-Latency-Ms"] = f"{duration_ms:.2f}"

    try:
        from app.metrics_service import metrics_service
        metrics_service.record_request_latency(
            endpoint=request.url.path,
            method=request.method,
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
    except Exception:
        pass

    return response

PRICING_RATE = 0.001
WORKER_SHARE = 0.70

# Batch and training pricing (per unit)
BATCH_PRICE_PER_IMAGE = 0.0005
TRAINING_PRICE_PER_EPOCH = 0.01


def calculate_task_cost(
    width, height, steps, task_type=TaskType.INFERENCE, batch_size=1, epochs=1
):
    """Calculate cost based on task type"""
    megapixels = (width * height) / 1000000

    if task_type == TaskType.INFERENCE:
        return round(megapixels * steps * PRICING_RATE, 4)
    elif task_type == TaskType.BATCH_INFERENCE:
        return round(
            megapixels * steps * PRICING_RATE * batch_size * 0.8, 4
        )  # 20% bulk discount
    elif task_type == TaskType.TRAINING:
        return round(epochs * TRAINING_PRICE_PER_EPOCH, 4)
    elif task_type == TaskType.DISTRIBUTED_TRAINING:
        return round(
            epochs * TRAINING_PRICE_PER_EPOCH * 1.5, 4
        )  # Premium for distributed
    return round(megapixels * steps * PRICING_RATE, 4)


class ConnectionManager:
    def __init__(self):
        self.active_connections = {}

    async def connect(self, websocket, task_id):
        await websocket.accept()
        self.active_connections[task_id] = websocket

    def disconnect(self, task_id):
        if task_id in self.active_connections:
            del self.active_connections[task_id]


manager = ConnectionManager()


@app.on_event("startup")
def startup_event():
    Base.metadata.create_all(bind=engine)
    # Ensure Closed Alpha columns & seed invite codes exist
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code VARCHAR(16);"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMP;"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by_code VARCHAR(64);"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_faucet_claim TIMESTAMP;"))
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            try:
                conn.execute(text("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'FAUCET_GRANT';"))
            except Exception:
                pass
            conn.execute(text("""
                INSERT INTO invite_codes (code, max_uses, times_used, initial_credits, is_active, created_at)
                VALUES ('NEBULA-ALPHA-2026', 1000, 0, 100.0, TRUE, NOW())
                ON CONFLICT (code) DO NOTHING;
            """))
            conn.commit()
    except Exception as exc:
        import logging
        logging.getLogger("main").warning(f"Schema check: {exc}")


@app.get("/")
def root():
    return {"message": "Network Nebula v1.7.0 - Task Types Ready"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/pricing")
def get_pricing():
    return {
        "rate": PRICING_RATE,
        "worker_share": WORKER_SHARE * 100,
        "batch_price_per_image": BATCH_PRICE_PER_IMAGE,
        "training_price_per_epoch": TRAINING_PRICE_PER_EPOCH,
        "example_512_20steps": calculate_task_cost(512, 512, 20),
        "example_batch_10": calculate_task_cost(
            512, 512, 20, TaskType.BATCH_INFERENCE, batch_size=10
        ),
        "example_training_10epochs": calculate_task_cost(
            512, 512, 20, TaskType.TRAINING, epochs=10
        ),
    }


class RegisterRequest(BaseModel):
    email: str
    password: str
    confirm_password: Optional[str] = None
    role: Optional[str] = "creator"
    invite_code: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/auth/register")
def register_user(request: RegisterRequest, db=Depends(get_db)):
    # Check if email already exists
    clean_email = request.email.strip().lower()
    existing_user = get_user_by_email(db, clean_email)
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Closed Alpha Gatekeeper: validate invite code if gatekeeper is enforced or invite code is provided
    import os
    gatekeeper_enforced = os.getenv("CLOSED_ALPHA_GATE", "false").lower() in ("true", "1", "yes")
    code_record = None
    if gatekeeper_enforced or request.invite_code:
        inv_code = (request.invite_code or "").strip().upper()
        if not inv_code:
            raise HTTPException(status_code=400, detail="Alpha invite code is required to join Closed Alpha")
        from app.models import InviteCode
        code_record = db.query(InviteCode).filter(InviteCode.code == inv_code, InviteCode.is_active == True).first()
        if not code_record or (code_record.expires_at and code_record.expires_at < datetime.utcnow()):
            raise HTTPException(status_code=400, detail="Invalid or expired invite code")
        if code_record.times_used >= code_record.max_uses:
            raise HTTPException(status_code=400, detail="Invite code has reached its maximum usage limit")
        code_record.times_used += 1

    # Generate 6-digit OTP verification code
    from datetime import timedelta
    otp = f"{random.randint(100000, 999999)}"
    otp_expiry = datetime.utcnow() + timedelta(minutes=15)

    api_key, api_secret = create_api_key_pair()
    user = User(
        id=str(uuid.uuid4()),
        api_key=api_key,
        api_secret=api_secret,
        email=clean_email,
        password_hash=hash_password(request.password),
        name=request.email.split("@")[0],
        is_worker=(request.role == "worker"),
        balance=50.0,
        is_verified=False,
        verification_code=otp,
        verification_expires_at=otp_expiry,
        invited_by_code=request.invite_code.strip().upper() if request.invite_code else None,
    )
    db.add(user)
    db.commit()

    # Dispatch verification email (non-blocking)
    email_delivered = False
    try:
        from app.email_service import send_verification_email
        email_delivered = bool(send_verification_email(user.email, otp))
    except Exception as exc:
        import logging
        logging.getLogger("main").warning(f"Failed to dispatch verification email: {exc}")

    from app.email_service import has_configured_mailer
    has_mailer = has_configured_mailer()

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": "worker" if user.is_worker else "creator",
            "is_worker": user.is_worker,
            "balance": user.balance,
            "is_verified": user.is_verified,
            "created_at": str(user.created_at),
        },
        "api_key": api_key,
        "api_secret": api_secret,
        "dev_otp": None if email_delivered else otp,
        "mailer_active": email_delivered or has_mailer,
        "message": "Account registered. Please enter the 6-digit verification OTP sent to your email.",
    }


@app.post("/auth/login")
def login(request: LoginRequest, db=Depends(get_db)):
    clean_email = request.email.strip().lower()
    user = get_user_by_email(db, clean_email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.is_active and user.is_verified:
        raise HTTPException(status_code=403, detail="Account is disabled")

    # Strict Verification Gatekeeper
    if not user.is_verified:
        raise HTTPException(
            status_code=403,
            detail="Account email not verified. Please enter the 6-digit verification OTP code sent to your email.",
        )

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": "worker" if user.is_worker else "creator",
            "is_worker": user.is_worker,
            "balance": user.balance,
            "is_verified": user.is_verified,
            "created_at": str(user.created_at),
        },
        "api_key": user.api_key,
        "api_secret": user.api_secret,
    }


@app.api_route("/auth/verify", methods=["GET", "POST"])
def verify_auth(user=Depends(verify_api_auth)):
    return {
        "id": user.id,
        "user_id": user.id,
        "email": user.email,
        "name": user.name,
        "role": "worker" if user.is_worker else "creator",
        "is_worker": user.is_worker,
        "balance": user.balance,
        "status": "authenticated",
    }


@app.get("/auth/me")
def get_me(user=Depends(verify_api_auth)):
    return {
        "id": user.id,
        "user_id": user.id,
        "email": user.email,
        "name": user.name,
        "role": "worker" if user.is_worker else "creator",
        "is_worker": user.is_worker,
        "balance": user.balance,
    }


@app.get("/wallet")
def get_wallet(user=Depends(verify_enterprise_auth), db=Depends(get_db)):
    return {
        "user_id": user.id,
        "balance": user.balance,
        "total_earned": user.total_earned,
    }


@app.post("/wallet/deposit")
def deposit_funds(amount: float, user=Depends(verify_api_auth), db=Depends(get_db)):
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    user.balance += amount
    trans = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        type=TransactionType.DEPOSIT,
        amount=amount,
        balance_after=user.balance,
        description=f"Deposit ${amount}",
    )
    db.add(trans)
    db.commit()
    return {"user_id": user.id, "amount_added": amount, "new_balance": user.balance}


@app.post("/wallet/withdraw")
def withdraw_funds(
    payload: dict, user=Depends(verify_enterprise_auth), db=Depends(get_db)
):
    amount = float(payload.get("amount", 0.0))
    address = payload.get("destination") or payload.get("address", "Default Wallet")
    payment_method = payload.get("payment_method", "Crypto/USDC")

    if amount < 10.0:
        raise HTTPException(status_code=400, detail="Minimum withdrawal is $10.00")
    if amount > user.balance:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    user.balance = round(user.balance - amount, 4)
    payout = PayoutRequest(
        payout_id=str(uuid.uuid4()),
        worker_id=user.id,
        amount=amount,
        status=PayoutStatus.PENDING,
        payment_method=payment_method,
        payment_address=address,
    )
    db.add(payout)

    trans = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        type=TransactionType.WITHDRAWAL,
        amount=-amount,
        balance_after=user.balance,
        description=f"Withdrawal to {address}",
    )
    db.add(trans)
    db.commit()

    return {
        "payout_id": payout.payout_id,
        "amount": amount,
        "status": payout.status.value,
        "destination": address,
        "balance": user.balance,
    }



@app.post("/tasks/render")
def submit_render_task(
    prompt: str,
    width: int = Query(512, ge=256, le=2048),
    height: int = Query(512, ge=256, le=2048),
    steps: int = Query(20, ge=1, le=150),
    seed: int = None,
    task_mode: str = Query("celery", regex="^(celery|standalone)$"),
    task_type: TaskType = Query(TaskType.INFERENCE),
    batch_size: int = Query(1, ge=1, le=100),
    model_id: str = Query("runwayml/stable-diffusion-v1-5"),
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """Submit a render task - supports inference, batch, and training types"""

    # Validate task_type specific parameters
    if task_type == TaskType.BATCH_INFERENCE and batch_size <= 1:
        raise HTTPException(
            status_code=400, detail="batch_size must be > 1 for batch_inference"
        )

    cost = calculate_task_cost(width, height, steps, task_type, batch_size)

    if user.balance < cost:
        raise HTTPException(
            status_code=402, detail=f"Need ${cost:.4f}, have ${user.balance:.2f}"
        )

    if seed is None:
        seed = random.randint(0, 2**31 - 1)

    # Generate task ID based on mode
    celery_task_id = None
    if task_mode == "celery":
        # Submit to Celery queue
        if task_type == TaskType.INFERENCE:
            celery_task = render_image.delay(
                prompt=prompt,
                width=width,
                height=height,
                steps=steps,
                seed=seed,
                user_id=user.id,
                model_id=model_id,
            )
            celery_task_id = celery_task.id
        elif task_type == TaskType.BATCH_INFERENCE:
            celery_task = run_batch_inference.delay(
                prompt=prompt,
                width=width,
                height=height,
                steps=steps,
                seed=seed,
                user_id=user.id,
                batch_size=batch_size,
                model_id=model_id,
            )
            celery_task_id = celery_task.id
        elif (
            task_type == TaskType.TRAINING or task_type == TaskType.DISTRIBUTED_TRAINING
        ):
            celery_task = train_model.delay(
                prompt=prompt,
                width=width,
                height=height,
                steps=steps,
                user_id=user.id,
                model_id=model_id,
            )
            celery_task_id = celery_task.id
    else:
        # Standalone mode - generate UUID for worker to claim
        celery_task_id = str(uuid.uuid4())

    db_task = Task(
        task_id=celery_task_id,
        user_id=user.id,
        prompt=prompt,
        width=width,
        height=height,
        steps=steps,
        seed=seed,
        cost=cost,
        task_mode=task_mode,
        task_type=task_type,
        status=TaskStatus.QUEUED,
        result=json.dumps({"model_id": model_id, "batch_size": batch_size}),
    )
    user.balance -= cost
    trans = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        task_id=celery_task_id,
        type=TransactionType.PAYMENT,
        amount=-cost,
        balance_after=user.balance,
        description=f"Task cost ({task_type.value})",
    )
    db.add(db_task)
    db.add(trans)
    db.commit()

    return {
        "task_id": celery_task_id,
        "cost": cost,
        "status": "QUEUED",
        "task_type": task_type.value,
        "batch_size": batch_size if task_type == TaskType.BATCH_INFERENCE else 1,
    }


@app.post("/tasks/submit-batch")
def submit_batch_task(
    prompts: List[str],
    width: int = Query(512, ge=256, le=2048),
    height: int = Query(512, ge=256, le=2048),
    steps: int = Query(20, ge=1, le=150),
    seed: int = None,
    task_mode: str = Query("celery", regex="^(celery|standalone)$"),
    model_id: str = Query("runwayml/stable-diffusion-v1-5"),
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """Submit a batch inference task with multiple prompts"""

    batch_size = len(prompts)
    if batch_size < 2:
        raise HTTPException(
            status_code=400, detail="Need at least 2 prompts for batch submission"
        )
    if batch_size > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 prompts per batch")

    cost = calculate_task_cost(
        width, height, steps, TaskType.BATCH_INFERENCE, batch_size
    )

    if user.balance < cost:
        raise HTTPException(
            status_code=402, detail=f"Need ${cost:.4f}, have ${user.balance:.2f}"
        )

    if seed is None:
        seed = random.randint(0, 2**31 - 1)

    batch_task_id = str(uuid.uuid4())

    if task_mode == "celery":
        celery_task = run_batch_inference.delay(
            prompt=prompts[0],  # Use first prompt as base
            width=width,
            height=height,
            steps=steps,
            seed=seed,
            user_id=user.id,
            batch_size=batch_size,
            model_id=model_id,
            prompts=prompts,  # Pass all prompts for batch
        )
        celery_task_id = celery_task.id
    else:
        celery_task_id = batch_task_id

    db_task = Task(
        task_id=celery_task_id,
        user_id=user.id,
        prompt=json.dumps(prompts),  # Store all prompts
        width=width,
        height=height,
        steps=steps,
        seed=seed,
        cost=cost,
        task_mode=task_mode,
        task_type=TaskType.BATCH_INFERENCE,
        status=TaskStatus.QUEUED,
        result=json.dumps(
            {"model_id": model_id, "batch_size": batch_size, "prompts": prompts}
        ),
    )
    user.balance -= cost
    trans = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        task_id=celery_task_id,
        type=TransactionType.PAYMENT,
        amount=-cost,
        balance_after=user.balance,
        description=f"Batch task ({batch_size} images)",
    )
    db.add(db_task)
    db.add(trans)
    db.commit()

    return {
        "batch_task_id": batch_task_id,
        "task_id": celery_task_id,
        "cost": cost,
        "status": "QUEUED",
        "batch_size": batch_size,
    }


@app.post("/tasks/submit-training")
def submit_training_task(
    concept_name: str,
    prompt_template: str = Query(
        "photo of a {concept}", description="Template with {concept} placeholder"
    ),
    training_data_url: str = Query(None, description="S3 URL to training images zip"),
    width: int = Query(512, ge=256, le=1024),
    height: int = Query(512, ge=256, le=1024),
    epochs: int = Query(100, ge=1, le=1000),
    learning_rate: float = Query(0.0001, ge=0.00001, le=0.01),
    task_mode: str = Query("celery", regex="^(celery|standalone)$"),
    model_id: str = Query("runwayml/stable-diffusion-v1-5"),
    train_type: str = Query(
        "textual_inversion", regex="^(textual_inversion|dreambooth|lora)$"
    ),
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """Submit a model training task (textual inversion, DreamBooth, or LoRA)"""

    if not user.is_worker:
        raise HTTPException(
            status_code=403, detail="Training tasks require worker account"
        )

    cost = calculate_task_cost(width, height, 20, TaskType.TRAINING, epochs=epochs)

    if user.balance < cost:
        raise HTTPException(
            status_code=402, detail=f"Need ${cost:.4f}, have ${user.balance:.2f}"
        )

    training_task_id = str(uuid.uuid4())

    if task_mode == "celery":
        celery_task = train_model.delay(
            prompt=concept_name,
            width=width,
            height=height,
            steps=epochs,
            user_id=user.id,
            model_id=model_id,
            train_type=train_type,
            prompt_template=prompt_template,
            training_data_url=training_data_url,
            learning_rate=learning_rate,
        )
        celery_task_id = celery_task.id
    else:
        celery_task_id = training_task_id

    db_task = Task(
        task_id=celery_task_id,
        user_id=user.id,
        prompt=json.dumps(
            {
                "concept_name": concept_name,
                "prompt_template": prompt_template,
                "train_type": train_type,
                "training_data_url": training_data_url,
            }
        ),
        width=width,
        height=height,
        steps=epochs,
        cost=cost,
        task_mode=task_mode,
        task_type=TaskType.TRAINING,
        status=TaskStatus.QUEUED,
        result=json.dumps(
            {
                "model_id": model_id,
                "train_type": train_type,
                "learning_rate": learning_rate,
            }
        ),
    )
    user.balance -= cost
    trans = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        task_id=celery_task_id,
        type=TransactionType.PAYMENT,
        amount=-cost,
        balance_after=user.balance,
        description=f"Training task ({train_type}, {epochs} epochs)",
    )
    db.add(db_task)
    db.add(trans)
    db.commit()

    return {
        "training_task_id": training_task_id,
        "task_id": celery_task_id,
        "cost": cost,
        "status": "QUEUED",
        "train_type": train_type,
        "epochs": epochs,
    }


@app.get("/tasks/available")
def get_available_tasks(
    task_type: Optional[TaskType] = None,
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """Get standalone tasks available for workers to claim"""
    from datetime import datetime, timedelta

    grace_period = datetime.utcnow() - timedelta(seconds=5)

    query = db.query(Task).filter(
        Task.status == TaskStatus.QUEUED,
        Task.claimed_by == None,
        Task.task_mode == "standalone",
        Task.created_at < grace_period,
    )

    if task_type:
        query = query.filter(Task.task_type == task_type)

    tasks = query.order_by(Task.created_at.asc()).limit(20).all()

    return {
        "tasks": [
            {
                "task_id": t.task_id,
                "prompt": t.prompt,
                "task_type": t.task_type.value if t.task_type else "inference",
                "width": t.width,
                "height": t.height,
                "steps": t.steps,
                "seed": t.seed,
                "cost": t.cost,
            }
            for t in tasks
        ]
    }


@app.get("/tasks/types")
def get_task_types():
    """Get available task types and their descriptions"""
    return {
        "types": [
            {
                "type": "inference",
                "name": "Single Inference",
                "description": "Generate a single image from text prompt",
                "params": ["prompt", "width", "height", "steps", "seed"],
            },
            {
                "type": "batch_inference",
                "name": "Batch Inference",
                "description": "Generate multiple images in parallel",
                "params": ["prompt", "width", "height", "steps", "seed", "batch_size"],
            },
            {
                "type": "training",
                "name": "Model Training",
                "description": "Fine-tune model using textual inversion, DreamBooth, or LoRA",
                "params": [
                    "concept_name",
                    "prompt_template",
                    "training_data_url",
                    "epochs",
                    "learning_rate",
                ],
            },
            {
                "type": "distributed_training",
                "name": "Distributed Training",
                "description": "Multi-GPU model training for large datasets",
                "params": ["concept_name", "training_data_url", "epochs", "num_gpus"],
            },
        ]
    }


@app.get("/tasks/{task_id}")
def get_task_status(
    task_id: str,
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    db_task = db.query(Task).filter(Task.task_id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    if db_task.user_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")

    result_data = json.loads(db_task.result) if db_task.result else {}

    return {
        "task_id": db_task.task_id,
        "status": db_task.status.value,
        "task_type": db_task.task_type.value if db_task.task_type else "inference",
        "progress": db_task.progress,
        "cost": db_task.cost,
        "output_url": db_task.output_url,
        "result": result_data,
    }


@app.post("/tasks/claim/{task_id}")
def claim_task(
    task_id: str,
    worker_id: str = None,
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """Standalone worker claims a task"""
    if not worker_id:
        raise HTTPException(status_code=400, detail="worker_id required")

    db_task = db.query(Task).filter(Task.task_id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    if db_task.status != TaskStatus.QUEUED:
        raise HTTPException(
            status_code=400, detail=f"Task not QUEUED (status: {db_task.status.value})"
        )
    if db_task.claimed_by:
        raise HTTPException(status_code=409, detail="Task already claimed")

    db_task.claimed_by = worker_id
    db_task.status = TaskStatus.PROCESSING
    db.commit()

    return {
        "task_id": task_id,
        "status": "PROCESSING",
        "claimed_by": worker_id,
        "task_type": db_task.task_type.value if db_task.task_type else "inference",
        "prompt": db_task.prompt,
        "width": db_task.width,
        "height": db_task.height,
        "steps": db_task.steps,
        "seed": db_task.seed,
    }


@app.post("/tasks/{task_id}/complete")
def report_task_complete(
    task_id: str,
    output_url: str = None,
    output_urls: List[str] = None,
    model_url: str = None,
    error: str = None,
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """Report task completion from standalone worker"""
    db_task = db.query(Task).filter(Task.task_id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")
    if db_task.status != TaskStatus.PROCESSING:
        raise HTTPException(
            status_code=400,
            detail=f"Task not PROCESSING (status: {db_task.status.value})",
        )

    result_data = json.loads(db_task.result) if db_task.result else {}

    if error:
        db_task.status = TaskStatus.FAILURE
        db_task.result = json.dumps({"status": "failed", "error": error, **result_data})
    else:
        db_task.status = TaskStatus.SUCCESS
        db_task.progress = 100.0

        if db_task.task_type == TaskType.BATCH_INFERENCE:
            db_task.output_url = (
                json.dumps(output_urls) if output_urls else json.dumps([output_url])
            )
            db_task.result = json.dumps(
                {
                    "status": "completed",
                    "output_urls": output_urls or [output_url],
                    **result_data,
                }
            )
        elif db_task.task_type == TaskType.TRAINING:
            db_task.output_url = model_url
            db_task.result = json.dumps(
                {"status": "completed", "model_url": model_url, **result_data}
            )
        else:
            db_task.output_url = output_url
            db_task.result = json.dumps(
                {"status": "completed", "output_url": output_url, **result_data}
            )

        if db_task.claimed_by:
            try:
                from app.worker import attribute_worker_earnings
                attribute_worker_earnings(
                    db=db,
                    task_id=task_id,
                    gross_cost=float(db_task.cost or 0.0052),
                    description=f"Host 70% share for CLI worker task {task_id[:8]}",
                    worker_id=db_task.claimed_by,
                )
            except Exception as earn_err:
                print(f"[MAIN] Failed to credit worker earnings on complete: {earn_err}")

    db.commit()
    return {"task_id": task_id, "status": db_task.status.value}


@app.get("/tasks")
def list_tasks(
    skip: int = 0,
    limit: int = 10,
    task_type: Optional[TaskType] = None,
    status: Optional[TaskStatus] = None,
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    query = db.query(Task).order_by(Task.created_at.desc())

    if not user.is_admin:
        query = query.filter(Task.user_id == user.id)
    if task_type:
        query = query.filter(Task.task_type == task_type)
    if status:
        query = query.filter(Task.status == status)

    tasks = query.offset(skip).limit(limit).all()
    return {
        "tasks": [
            {
                "task_id": t.task_id,
                "status": t.status.value,
                "task_type": t.task_type.value if t.task_type else "inference",
                "cost": t.cost,
                "progress": t.progress,
            }
            for t in tasks
        ]
    }


@app.websocket("/ws/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    if task_id == "cluster":
        from app.cluster_worker_router import websocket_cluster_telemetry
        await websocket_cluster_telemetry(websocket)
        return

    await manager.connect(websocket, task_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(task_id)


@app.get("/workers")
def list_workers(db=Depends(get_db), user=Depends(verify_api_auth)):
    workers = db.query(Worker).filter(Worker.is_available == True).all()
    return {
        "workers": [
            {
                "id": w.id,
                "name": w.name,
                "gpu_info": w.gpu_info,
                "status": w.status,
                "gpu_memory_gb": w.gpu_memory_gb,
                "vram_used_gb": w.vram_used_gb or 0.0,
                "vram_allocation_pct": w.vram_allocation_pct if w.vram_allocation_pct is not None else 80,
                "gpu_utilization_pct": w.gpu_utilization_pct or 0.0,
                "cuda_version": w.cuda_version or "12.8",
                "role": w.role or "LoRA Training & Inference",
                "total_earnings_usd": w.total_earnings_usd or 0.0,
            }
            for w in workers
        ]
    }


@app.post("/workers/register")
def register_worker(
    name: str = Query(default="nebula-worker"),
    gpu_info: str = None,
    cpu_cores: int = 0,
    memory_gb: float = 0.0,
    gpu_memory_gb: float = 0.0,
    vram_allocation_pct: int = Query(default=80, ge=10, le=100),
    supported_task_types: List[str] = Query(
        default=["inference"],
        description="Supported task types: inference, batch_inference, training",
    ),
    db=Depends(get_db),
):
    worker = Worker(
        id=str(uuid.uuid4()),
        name=name,
        gpu_info=gpu_info,
        cpu_cores=cpu_cores,
        memory_gb=memory_gb,
        gpu_memory_gb=gpu_memory_gb,
        vram_allocation_pct=vram_allocation_pct,
        status="online",
    )
    db.add(worker)
    db.commit()
    return {
        "worker_id": worker.id,
        "name": worker.name,
        "vram_allocation_pct": worker.vram_allocation_pct,
        "supported_task_types": supported_task_types,
    }


@app.post("/workers/{worker_id}/heartbeat")
def worker_heartbeat(
    worker_id: str,
    current_task_id: str = None,
    vram_used_gb: Optional[float] = None,
    gpu_utilization_pct: Optional[float] = None,
    db=Depends(get_db),
):
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        return {"status": "error"}
    worker.last_heartbeat = datetime.utcnow()
    worker.current_task_id = current_task_id
    if vram_used_gb is not None:
        worker.vram_used_gb = vram_used_gb
    if gpu_utilization_pct is not None:
        worker.gpu_utilization_pct = gpu_utilization_pct
    worker.status = "busy" if current_task_id else "online"
    db.commit()
    return {
        "status": "ok",
        "vram_allocation_pct": worker.vram_allocation_pct if worker.vram_allocation_pct is not None else 80,
    }


@app.get("/workers/{worker_id}")
def get_worker(
    worker_id: str,
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """Get worker details"""
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return {
        "id": worker.id,
        "name": worker.name,
        "status": worker.status,
        "gpu_info": worker.gpu_info,
        "cpu_cores": worker.cpu_cores,
        "gpu_memory_gb": worker.gpu_memory_gb,
        "vram_used_gb": worker.vram_used_gb or 0.0,
        "vram_allocation_pct": worker.vram_allocation_pct if worker.vram_allocation_pct is not None else 80,
        "gpu_utilization_pct": worker.gpu_utilization_pct or 0.0,
        "cuda_version": worker.cuda_version or "12.8",
        "role": worker.role or "LoRA Training & Inference",
        "total_earnings_usd": worker.total_earnings_usd or 0.0,
        "total_tasks_completed": worker.total_tasks_completed,
        "is_available": worker.is_available,
    }


@app.post("/workers/{worker_id}/complete-task")
def worker_complete_task(
    worker_id: str,
    task_id: str,
    earnings: float,
    db=Depends(get_db),
):
    """Record task completion and pay worker"""
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    worker.total_tasks_completed += 1
    worker.total_earnings_usd = (worker.total_earnings_usd or 0.0) + earnings

    # Find user and add earnings
    task = db.query(Task).filter(Task.task_id == task_id).first()
    if task and task.user_id:
        user = db.query(User).filter(User.id == task.user_id).first()
        if user:
            user.balance += earnings
            user.total_earned += earnings

            trans = Transaction(
                transaction_id=str(uuid.uuid4()),
                user_id=user.id,
                worker_id=worker_id,
                task_id=task_id,
                type=TransactionType.EARNING,
                amount=earnings,
                balance_after=user.balance,
                description=f"Worker earnings for {task_id}",
            )
            db.add(trans)

    db.commit()
    return {"status": "ok", "earnings_paid": earnings}


# Include distributed training endpoints
from app.distributed_endpoints import router as distributed_router

app.include_router(distributed_router)


# Include gRPC worker communication endpoints
from app.grpc_endpoints import router as grpc_router

app.include_router(grpc_router)

# Include React Frontend API Compatibility Bridge Router
from app.api_router import api_router

app.include_router(api_router)

# Include Enterprise Model Training Engine Router (Phase 2)
from app.enterprise_training_router import router as enterprise_training_router

app.include_router(enterprise_training_router)

# Include Enterprise API Token Management Router (Phase 3)
from app.enterprise_token_router import router as enterprise_token_router

app.include_router(enterprise_token_router)

# Include OpenAI API Gateway & Inference Serving Router (Phase 3)
from app.openai_inference_router import router as openai_inference_router

app.include_router(openai_inference_router)

# Include Cluster Fleet & GPU Worker Telemetry Router (Alpha Milestone 2)
from app.cluster_worker_router import router as cluster_worker_router

app.include_router(cluster_worker_router)

# Include Host Node Wallet Payouts & Enterprise Billing Router (Alpha Milestone 3)
from app.wallet_router import router as wallet_router

app.include_router(wallet_router)

# Include Cryptographic Compute Verification & Dispute Router (Alpha Milestone 4)
from app.verification_router import router as verification_router

app.include_router(verification_router)

# Include Node Staking & Automated Slashing Router (Alpha Milestone 4)
from app.staking_router import router as staking_router

app.include_router(staking_router)

# Include Enterprise Telemetry & Prometheus Observability Router (Alpha Milestone 4)
from app.metrics_router import router as metrics_router

app.include_router(metrics_router)

# Include Swarm Model Sharding & Pipeline Topology Router (Alpha Milestone 5)
from app.sharding_router import router as sharding_router

app.include_router(sharding_router)

# Include Sparse Mixture-of-Experts (MoE) Router (Alpha Milestone 6)
from app.moe_router import router as moe_router

app.include_router(moe_router)

# Include Decentralized Speculative Decoding (DSD) Router (Alpha Milestone 6)
from app.speculative_router import router as speculative_router

app.include_router(speculative_router)

# Include P2P Kademlia DHT Swarm Mesh Router (Alpha Milestone 6)
from app.dht_router import router as dht_router

app.include_router(dht_router)

# Include Commercial Monetization, Stripe & Web3 Payment Rails Router (Alpha Milestone 6)
from app.payment_router import router as payment_router

app.include_router(payment_router)

# Include Closed Alpha Invites & Email Verification Router (Alpha Milestone 8)
from app.invite_router import router as invite_router

app.include_router(invite_router)

# Include Flagship User Profile & Activity Router
from app.user_profile_router import router as user_profile_router

app.include_router(user_profile_router)



