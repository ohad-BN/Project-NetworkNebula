import enum

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.sql import func

from app.database import Base


class TaskStatus(str, enum.Enum):
    PENDING = "PENDING"
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"


class TaskType(str, enum.Enum):
    INFERENCE = "inference"
    TRAINING = "training"
    BATCH_INFERENCE = "batch_inference"
    DISTRIBUTED_TRAINING = "distributed_training"


class TransactionType(str, enum.Enum):
    DEPOSIT = "DEPOSIT"
    PAYMENT = "PAYMENT"
    WITHDRAWAL = "WITHDRAWAL"
    EARNING = "EARNING"
    REFUND = "REFUND"
    STAKE = "STAKE"
    UNSTAKE = "UNSTAKE"
    SLASH_PENALTY = "SLASH_PENALTY"
    COMPENSATION = "COMPENSATION"
    FAUCET_GRANT = "FAUCET_GRANT"


class PayoutStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    PAID = "PAID"


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(255), unique=True, index=True, nullable=False)
    user_id = Column(String(36), nullable=True, index=True)
    prompt = Column(Text, nullable=False)
    status = Column(SQLEnum(TaskStatus), default=TaskStatus.PENDING, nullable=False)
    result = Column(Text, nullable=True)
    output_url = Column(String(500), nullable=True)
    width = Column(Integer, default=512)
    height = Column(Integer, default=512)
    steps = Column(Integer, default=20)
    seed = Column(Integer, nullable=True)
    progress = Column(Float, default=0.0)
    cost = Column(Float, default=0.0)
    task_type = Column(SQLEnum(TaskType), default=TaskType.INFERENCE, nullable=False)
    task_mode = Column(
        String(20), default="celery", nullable=False
    )  # "celery" or "standalone"
    claimed_by = Column(String(36), nullable=True, index=True)
    total_slices = Column(Integer, default=1)
    completed_slices = Column(Integer, default=0)
    total_compute_seconds = Column(Float, default=0.0)
    earned_so_far_usd = Column(Float, default=0.0)
    last_checkpoint_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True)
    api_key = Column(String(64), unique=True, index=True, nullable=False)
    api_secret = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    is_worker = Column(Boolean, default=False)
    balance = Column(Float, default=0.0)
    total_earned = Column(Float, default=0.0)
    is_verified = Column(Boolean, default=False)
    verification_code = Column(String(6), nullable=True)
    verification_expires_at = Column(DateTime(timezone=True), nullable=True)
    invited_by_code = Column(String(64), nullable=True)
    last_faucet_claim = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(64), unique=True, index=True, nullable=False)
    created_by = Column(String(36), nullable=True)
    max_uses = Column(Integer, default=1)
    times_used = Column(Integer, default=0)
    initial_credits = Column(Float, default=100.0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)


class Worker(Base):
    __tablename__ = "workers"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    gpu_info = Column(String(255), nullable=True)
    status = Column(String(50), default="offline")
    current_task_id = Column(String(255), nullable=True)
    cpu_cores = Column(Integer, default=0)
    memory_gb = Column(Float, default=0.0)
    gpu_memory_gb = Column(Float, default=0.0)
    vram_used_gb = Column(Float, default=0.0)
    vram_allocation_pct = Column(Integer, default=80)
    gpu_utilization_pct = Column(Float, default=0.0)
    cuda_version = Column(String(64), default="12.8")
    role = Column(String(100), default="LoRA Training & Inference")
    hourly_rate_usd = Column(Float, default=0.45)
    total_earnings_usd = Column(Float, default=0.0)
    is_available = Column(Boolean, default=True)
    total_tasks_completed = Column(Integer, default=0)
    staked_amount_usd = Column(Float, default=0.0)
    slashed_amount_usd = Column(Float, default=0.0)
    reputation_score = Column(Float, default=100.0)
    min_stake_required = Column(Float, default=50.0)
    slash_history = Column(Text, default="[]")
    gpus_json = Column(Text, default="[]", nullable=True)
    region = Column(String(64), default="us-east", nullable=False)
    latency_ping_ms = Column(Float, default=15.0, nullable=False)
    compute_architecture = Column(String(32), default="cuda", nullable=False)
    hardware_tier = Column(String(32), default="consumer_gpu", nullable=False)
    device_brand = Column(String(100), nullable=True)
    country = Column(String(64), nullable=True)
    city = Column(String(100), nullable=True)
    public_ip = Column(String(64), nullable=True)
    is_unified_memory = Column(Boolean, default=False)
    supported_task_types = Column(String(255), default="inference,training")
    last_heartbeat = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(String(36), unique=True, nullable=False)
    user_id = Column(String(36), nullable=False, index=True)
    worker_id = Column(String(36), nullable=True, index=True)
    task_id = Column(String(255), nullable=True, index=True)
    type = Column(SQLEnum(TransactionType), nullable=False)
    amount = Column(Float, nullable=False)
    balance_after = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PayoutRequest(Base):
    __tablename__ = "payout_requests"

    id = Column(Integer, primary_key=True, index=True)
    payout_id = Column(String(36), unique=True, nullable=False)
    worker_id = Column(String(36), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    status = Column(SQLEnum(PayoutStatus), default=PayoutStatus.PENDING)
    payment_method = Column(String(50), nullable=True)
    payment_address = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)


class TrainingJob(Base):
    __tablename__ = "training_jobs"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    base_model = Column(String(255), nullable=False)
    train_type = Column(String(50), default="lora", nullable=False)
    parallelism = Column(String(50), default="data_parallel", nullable=False)
    num_gpus = Column(Integer, default=1)
    dataset_s3_url = Column(String(500), nullable=False)
    hyperparameters = Column(Text, default="{}", nullable=False)
    status = Column(String(50), default="queued", nullable=False)
    current_epoch = Column(Integer, default=0)
    total_epochs = Column(Integer, default=10)
    loss_history = Column(Text, default="[]", nullable=False)
    checkpoints = Column(Text, default="[]", nullable=False)
    final_adapter_url = Column(String(500), nullable=True)
    region = Column(String(64), nullable=True)
    cost = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


class InferenceEndpoint(Base):
    __tablename__ = "inference_endpoints"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    model_id = Column(String(255), nullable=False)
    adapter_url = Column(String(500), nullable=True)
    status = Column(String(50), default="ready", nullable=False)
    min_replicas = Column(Integer, default=1)
    max_replicas = Column(Integer, default=4)
    total_requests = Column(Integer, default=0)
    avg_latency_ms = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ApiToken(Base):
    __tablename__ = "api_tokens"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    token_hash = Column(String(255), unique=True, index=True, nullable=False)
    token_prefix = Column(String(16), nullable=False)
    scopes = Column(String(255), default="training,inference", nullable=False)
    rate_limit_rpm = Column(Integer, default=60)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    log_id = Column(String(36), unique=True, nullable=False, index=True)
    event_type = Column(String(64), nullable=False, index=True)
    severity = Column(String(16), default="info", nullable=False)
    actor_id = Column(String(36), nullable=True, index=True)
    target_id = Column(String(255), nullable=True, index=True)
    action = Column(String(255), nullable=False)
    details = Column(Text, default="{}", nullable=False)
    ip_address = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ComputeSlice(Base):
    __tablename__ = "compute_slices"

    id = Column(Integer, primary_key=True, index=True)
    slice_id = Column(String(64), unique=True, index=True, nullable=False)
    task_id = Column(String(255), index=True, nullable=False)
    worker_id = Column(String(36), index=True, nullable=False)
    slice_index = Column(Integer, nullable=False)
    compute_time_sec = Column(Float, nullable=False)
    reward_usd = Column(Float, nullable=False)
    payload_hash = Column(String(64), nullable=False)
    checkpoint_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)



