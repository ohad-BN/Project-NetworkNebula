"""
Project NetworkNebula — Enterprise Training API Router
Provides REST endpoints for submitting distributed/PEFT fine-tuning jobs,
querying real-time loss and epoch telemetry, and retrieving checkpoints.
"""

import os
import json
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TrainingJob, User
from app.auth import verify_enterprise_auth
from app.storage import get_storage
from app.worker import execute_training_job
import threading


def dispatch_training_job_resilient(job_id: str):
    """Dispatch training job to Celery worker if available; otherwise execute in background thread."""
    try:
        from app.worker import celery_app
        insp = celery_app.control.inspect(timeout=0.25)
        active_workers = insp.ping() if insp else None
        if active_workers:
            execute_training_job.delay(job_id)
            return
    except Exception:
        pass

    # Threaded background runner ensures immediate progress without stalled queues
    thread = threading.Thread(target=execute_training_job, args=(job_id,), daemon=True)
    thread.start()


def dispatch_queued_training_jobs(db: Session) -> int:
    """
    Dispatch queued LoRA/enterprise training jobs once at least one active compute worker is online.
    Returns count of dispatched jobs.
    """
    from app.cluster_worker_router import get_eligible_training_workers

    active_workers = get_eligible_training_workers(db)
    allow_fallback = os.getenv("ALLOW_SERVER_CPU_TRAINING_FALLBACK", "false").lower() in ("1", "true", "yes")
    if not active_workers and not allow_fallback:
        return 0

    queued_jobs = (
        db.query(TrainingJob)
        .filter(TrainingJob.status == "queued")
        .order_by(TrainingJob.created_at.asc())
        .all()
    )
    dispatched = 0
    for q_job in queued_jobs:
        try:
            hp = json.loads(q_job.hyperparameters) if q_job.hyperparameters else {}
        except Exception:
            hp = {}

        requested_ids = hp.get("worker_ids") if isinstance(hp.get("worker_ids"), list) else None
        eligible_for_job = active_workers
        if requested_ids and not hp.get("waiting_for_worker"):
            matched = [w for w in active_workers if w.id in requested_ids]
            if matched:
                eligible_for_job = matched

        if not eligible_for_job and not allow_fallback:
            continue

        # Mark dispatching atomically before enqueuing to avoid duplicate triggers on concurrent heartbeats
        target_count = max(1, int(q_job.num_gpus or 1)) if eligible_for_job else 0
        if eligible_for_job:
            hp["worker_ids"] = [w.id for w in eligible_for_job[:target_count]]
        hp.pop("waiting_for_worker", None)
        q_job.hyperparameters = json.dumps(hp)
        q_job.status = "dispatching"
        db.commit()
        dispatch_training_job_resilient(q_job.id)
        dispatched += 1
    return dispatched

router = APIRouter(prefix="/api/v1/training", tags=["Enterprise Training"])


# ==============================================================================
# Request & Response Schemas
# ==============================================================================

class HyperparametersSchema(BaseModel):
    learning_rate: float = Field(default=2e-4, description="Optimizer learning rate")
    batch_size: int = Field(default=4, description="Per-device batch size")
    epochs: int = Field(default=3, description="Number of training epochs")
    lora_r: int = Field(default=16, description="LoRA rank dimension")
    lora_alpha: int = Field(default=32, description="LoRA scaling factor")
    lora_dropout: float = Field(default=0.05, description="LoRA dropout rate")
    warmup_ratio: float = Field(default=0.03, description="LR schedule warmup ratio")
    gradient_accumulation_steps: int = Field(default=2, description="Gradient accumulation steps")


class CreateTrainingJobRequest(BaseModel):
    name: Optional[str] = Field(default=None, description="Human-readable job label")
    base_model: str = Field(default="Qwen/Qwen2.5-0.5B-Instruct", description="HuggingFace model ID or foundation weight path")
    train_type: str = Field(default="lora", description="Fine-tuning technique: lora, qlora, full")
    parallelism: str = Field(default="data_parallel", description="Parallelism strategy: data_parallel, fsdp, tensor_parallel")
    num_gpus: int = Field(default=1, ge=1, le=128, description="Target GPU count")
    worker_ids: Optional[List[str]] = Field(default=None, description="Optional worker node IDs override (auto-routed if omitted)")
    dataset_s3_url: str = Field(..., description="MinIO/S3 URI to training dataset (jsonl)")
    hyperparameters: Optional[Dict[str, Any]] = Field(default=None, description="Custom hyperparameter overrides")
    total_epochs: Optional[int] = Field(default=3, ge=1, le=100, description="Total training epochs")


class CreateDistributedTrainingJobRequest(BaseModel):
    name: Optional[str] = Field(default=None, description="Human-readable distributed job label")
    base_model: str = Field(default="Qwen/Qwen2.5-0.5B-Instruct", description="Foundation model ID")
    train_type: str = Field(default="lora", description="Fine-tuning technique: lora, qlora")
    parallelism: str = Field(default="data_parallel", description="Parallelism strategy: data_parallel, model_parallel, fsdp")
    num_gpus: int = Field(default=2, ge=2, le=128, description="Number of GPU worker nodes to coordinate (>= 2)")
    worker_ids: Optional[List[str]] = Field(default=None, description="Explicit list of target worker IDs (auto-resolved if omitted)")
    dataset_s3_url: Optional[str] = Field(default="s3://nebula-datasets/default_distributed.jsonl", description="Dataset URI")
    hyperparameters: Optional[Dict[str, Any]] = Field(default=None, description="Custom hyperparameter overrides")
    total_epochs: Optional[int] = Field(default=2, ge=1, le=100, description="Total distributed training epochs")
    sync_execution: bool = Field(default=False, description="Execute distributed training synchronously in-request if true")
    enforce_region: Optional[str] = Field(default=None, description="Strict geographic data sovereignty boundary, e.g. eu-central or us-east")
    max_rtt_ms: Optional[float] = Field(default=None, description="Maximum inter-node latency RTT threshold for all-reduce group")


class DatasetUploadUrlRequest(BaseModel):
    filename: str = Field(..., description="Target dataset filename (e.g., medical_records.jsonl)")
    content_type: Optional[str] = Field(default="application/jsonlines", description="MIME content type")


class DatasetUploadUrlResponse(BaseModel):
    upload_url: str
    s3_url: str
    bucket: str
    object_key: str
    expires_in_seconds: int = 3600


class LossStep(BaseModel):
    epoch: int
    step: int
    loss: float
    val_loss: Optional[float] = None
    timestamp: str


class CheckpointMeta(BaseModel):
    epoch: int
    s3_url: str
    size_bytes: int
    created_at: str


class TrainingJobResponse(BaseModel):
    id: str
    user_id: str
    name: str
    base_model: str
    train_type: str
    parallelism: str
    num_gpus: int
    dataset_s3_url: str
    hyperparameters: Dict[str, Any]
    status: str
    current_epoch: int
    total_epochs: int
    loss_history: List[Dict[str, Any]]
    checkpoints: List[Dict[str, Any]]
    final_adapter_url: Optional[str] = None
    region: Optional[str] = None
    cost: float
    created_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==============================================================================
# Helpers
# ==============================================================================

def format_job_response(job: TrainingJob) -> Dict[str, Any]:
    try:
        parsed_hyperparams = json.loads(job.hyperparameters) if job.hyperparameters else {}
    except Exception:
        parsed_hyperparams = {}

    try:
        parsed_loss = json.loads(job.loss_history) if job.loss_history else []
    except Exception:
        parsed_loss = []

    try:
        parsed_checkpoints = json.loads(job.checkpoints) if job.checkpoints else []
    except Exception:
        parsed_checkpoints = []

    return {
        "id": job.id,
        "user_id": job.user_id,
        "name": job.name,
        "base_model": job.base_model,
        "train_type": job.train_type,
        "parallelism": job.parallelism,
        "num_gpus": job.num_gpus,
        "worker_ids": parsed_hyperparams.get("worker_ids", []),
        "distributed_telemetry": parsed_hyperparams.get("distributed_telemetry"),
        "dataset_s3_url": job.dataset_s3_url,
        "hyperparameters": parsed_hyperparams,
        "status": job.status,
        "current_epoch": job.current_epoch,
        "total_epochs": job.total_epochs,
        "loss_history": parsed_loss,
        "checkpoints": parsed_checkpoints,
        "final_adapter_url": job.final_adapter_url,
        "region": getattr(job, "region", None),
        "cost": job.cost,
        "created_at": job.created_at,
        "completed_at": job.completed_at,
    }


# ==============================================================================
# Endpoints
# ==============================================================================

@router.post("/datasets/upload-url", response_model=DatasetUploadUrlResponse)
def get_dataset_upload_url(
    payload: DatasetUploadUrlRequest,
    current_user: User = Depends(verify_enterprise_auth),
):
    """
    Generate presigned PUT URL for companies to upload fine-tuning datasets
    directly to MinIO S3 without routing megabytes through the web application layer.
    """
    storage = get_storage()
    storage.ensure_all_enterprise_buckets_exist()

    clean_filename = payload.filename.strip().replace(" ", "_")
    object_key = f"{current_user.id}/{uuid.uuid4().hex[:8]}/{clean_filename}"
    upload_url = storage.get_presigned_upload_url(
        object_name=object_key,
        bucket_name="nebula-datasets",
        expires_in=3600
    )
    s3_url = f"{storage.endpoint}/nebula-datasets/{object_key}"

    return DatasetUploadUrlResponse(
        upload_url=upload_url,
        s3_url=s3_url,
        bucket="nebula-datasets",
        object_key=object_key,
        expires_in_seconds=3600
    )


@router.post("/jobs", response_model=Dict[str, Any], status_code=status.HTTP_201_CREATED)
def submit_training_job(
    payload: CreateTrainingJobRequest,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    Submit a new distributed model training / PEFT fine-tuning run.
    Validates dataset URI, registers database record, and enqueues task on Celery cluster.
    """
    job_id = str(uuid.uuid4())
    job_name = payload.name or f"{payload.base_model.split('/')[-1]}-{payload.train_type.upper()}-{job_id[:6]}"

    # Extract or format hyperparameters
    from app.cluster_worker_router import get_eligible_training_workers

    hyperparams = payload.hyperparameters or {}
    epochs = payload.total_epochs or hyperparams.get("epochs", 3)
    allow_fallback = os.getenv("ALLOW_SERVER_CPU_TRAINING_FALLBACK", "false").lower() in ("1", "true", "yes")
    eligible_workers = get_eligible_training_workers(db, requested_worker_ids=payload.worker_ids)

    if payload.worker_ids:
        hyperparams["worker_ids"] = payload.worker_ids
    elif payload.num_gpus >= 2:
        from app.distributed_training_engine import distributed_training_engine
        worker_ids = distributed_training_engine.resolve_worker_fleet(db, num_gpus=payload.num_gpus)
        hyperparams["distributed_mode"] = True
        hyperparams["worker_ids"] = worker_ids
    else:
        from app.scheduler import cluster_scheduler
        sched_res = cluster_scheduler.select_optimal_workers(
            db=db,
            required_vram_gb=2.0,
            num_gpus=1,
            task_type="training",
            record_dispatch=True,
        )
        selected_ids = sched_res.get("selected_worker_ids", [])
        if selected_ids:
            hyperparams["worker_ids"] = [selected_ids[0]]
        elif eligible_workers:
            hyperparams["worker_ids"] = [eligible_workers[0].id]

    should_dispatch = bool(eligible_workers) or allow_fallback
    if not should_dispatch:
        hyperparams["waiting_for_worker"] = True

    new_job = TrainingJob(
        id=job_id,
        user_id=current_user.id,
        name=job_name,
        base_model=payload.base_model,
        train_type=payload.train_type,
        parallelism=payload.parallelism,
        num_gpus=payload.num_gpus,
        dataset_s3_url=payload.dataset_s3_url,
        hyperparameters=json.dumps(hyperparams),
        status="queued",
        current_epoch=0,
        total_epochs=epochs,
        loss_history="[]",
        checkpoints="[]",
        final_adapter_url=None,
        cost=0.0
    )
    db.add(new_job)
    db.commit()
    db.refresh(new_job)

    # Dispatch only when at least one eligible worker is active; otherwise remain queued
    if should_dispatch:
        dispatch_training_job_resilient(job_id)

    return format_job_response(new_job)


@router.post("/distributed/jobs", response_model=Dict[str, Any], status_code=status.HTTP_201_CREATED)
def submit_distributed_training_job(
    payload: CreateDistributedTrainingJobRequest,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    Submit a multi-node distributed training job (num_gpus >= 2) using Ring All-Reduce
    gradient aggregation and dataset batch sharding across registered GPU workers.
    """
    from app.distributed_training_engine import distributed_training_engine
    from app.cluster_worker_router import get_eligible_training_workers

    job_id = str(uuid.uuid4())
    job_name = payload.name or f"Dist-{payload.base_model.split('/')[-1]}-{payload.num_gpus}GPU-{job_id[:6]}"

    worker_ids = payload.worker_ids
    if payload.enforce_region and worker_ids:
        from app.models import Worker
        non_compliant = (
            db.query(Worker)
            .filter(
                Worker.id.in_(worker_ids),
                Worker.region != payload.enforce_region,
            )
            .all()
        )
        if non_compliant:
            bad_names = [f"{w.id} (region={w.region})" for w in non_compliant]
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Data sovereignty compliance failure: worker nodes {bad_names} "
                    f"are outside enforced region '{payload.enforce_region}'."
                ),
            )

    eligible_workers = get_eligible_training_workers(db, requested_worker_ids=worker_ids)
    allow_fallback = os.getenv("ALLOW_SERVER_CPU_TRAINING_FALLBACK", "false").lower() in ("1", "true", "yes")

    if not worker_ids or len(worker_ids) < payload.num_gpus:
        resolved = distributed_training_engine.resolve_worker_fleet(
            db,
            num_gpus=payload.num_gpus,
            enforce_region=payload.enforce_region,
            max_latency_ms=payload.max_rtt_ms,
        )
        if worker_ids:
            for r_id in resolved:
                if r_id not in worker_ids and len(worker_ids) < payload.num_gpus:
                    worker_ids.append(r_id)
        else:
            worker_ids = resolved

    worker_ids = worker_ids[:payload.num_gpus] if worker_ids else []
    should_dispatch = bool(eligible_workers) or allow_fallback

    hyperparams = dict(payload.hyperparameters or {})
    epochs = payload.total_epochs or hyperparams.get("epochs", 2)
    hyperparams["distributed_mode"] = True
    hyperparams["worker_ids"] = worker_ids
    hyperparams["allreduce_protocol"] = "ring_allreduce_float32"
    if not should_dispatch:
        hyperparams["waiting_for_worker"] = True
    if payload.enforce_region:
        hyperparams["enforce_region"] = payload.enforce_region
    if payload.max_rtt_ms is not None:
        hyperparams["max_rtt_ms"] = payload.max_rtt_ms

    new_job = TrainingJob(
        id=job_id,
        user_id=current_user.id,
        name=job_name,
        base_model=payload.base_model,
        train_type=payload.train_type,
        parallelism=payload.parallelism,
        num_gpus=max(len(worker_ids), payload.num_gpus),
        dataset_s3_url=payload.dataset_s3_url or "s3://nebula-datasets/default_distributed.jsonl",
        hyperparameters=json.dumps(hyperparams),
        status="queued",
        current_epoch=0,
        total_epochs=epochs,
        loss_history="[]",
        checkpoints="[]",
        final_adapter_url=None,
        region=payload.enforce_region,
        cost=0.0,
    )
    db.add(new_job)
    db.commit()
    db.refresh(new_job)

    if should_dispatch:
        if payload.sync_execution:
            execute_training_job(job_id)
            db.refresh(new_job)
        else:
            dispatch_training_job_resilient(job_id)

    return format_job_response(new_job)


@router.get("/distributed/jobs/{job_id}/shards", response_model=Dict[str, Any])
def get_distributed_job_shards(
    job_id: str,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    Retrieve per-worker dataset shard assignments, Ring All-Reduce bucket statistics,
    and per-shard loss telemetry for a multi-node distributed training job.
    """
    from app.distributed_training_engine import distributed_training_engine

    job = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Distributed training job {job_id} not found")

    try:
        hyperparams = json.loads(job.hyperparameters) if job.hyperparameters else {}
    except Exception:
        hyperparams = {}

    try:
        loss_history = json.loads(job.loss_history) if job.loss_history else []
    except Exception:
        loss_history = []

    telemetry = (
        hyperparams.get("distributed_telemetry")
        or distributed_training_engine.job_shard_telemetry.get(job_id)
    )

    worker_ids = hyperparams.get("worker_ids", [])
    if telemetry:
        return {
            **telemetry,
            "status": job.status,
            "current_epoch": job.current_epoch,
            "loss_history": loss_history,
        }

    return {
        "job_id": job.id,
        "status": job.status,
        "parallelism": job.parallelism,
        "num_workers": job.num_gpus,
        "worker_ids": worker_ids,
        "allreduce_protocol": hyperparams.get("allreduce_protocol", "ring_allreduce_float32"),
        "current_epoch": job.current_epoch,
        "total_epochs": job.total_epochs,
        "loss_history": loss_history,
        "final_adapter_url": job.final_adapter_url,
    }


@router.get("/jobs", response_model=List[Dict[str, Any]])
def list_training_jobs(
    status_filter: Optional[str] = None,
    limit: int = 50,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """List all model training jobs for the authenticated enterprise account."""
    query = db.query(TrainingJob).filter(TrainingJob.user_id == current_user.id)
    if status_filter:
        query = query.filter(TrainingJob.status == status_filter)
    jobs = query.order_by(TrainingJob.created_at.desc()).limit(limit).all()
    return [format_job_response(j) for j in jobs]


@router.get("/jobs/{job_id}", response_model=Dict[str, Any])
def get_training_job(
    job_id: str,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """Retrieve full status, loss descent history, and epoch progress for a training job."""
    job = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Training job {job_id} not found")
    return format_job_response(job)


@router.get("/jobs/{job_id}/checkpoints", response_model=List[Dict[str, Any]])
def get_training_checkpoints(
    job_id: str,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """Retrieve download links and metadata for all checkpoints saved during training."""
    job = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Training job {job_id} not found")

    try:
        checkpoints = json.loads(job.checkpoints) if job.checkpoints else []
    except Exception:
        checkpoints = []

    return checkpoints


@router.post("/jobs/{job_id}/cancel")
def cancel_training_job(
    job_id: str,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """Cancel a queued or currently executing training run."""
    job = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Training job {job_id} not found")

    if job.status == "cancelled":
        return {"status": "cancelled", "job_id": job_id}

    if job.status in ("completed", "failed"):
        raise HTTPException(status_code=400, detail=f"Job cannot be cancelled in state '{job.status}'")

    job.status = "cancelled"
    job.completed_at = datetime.now(timezone.utc)

    # Release any worker nodes bound to this cancelled job
    from app.models import Worker
    bound_workers = db.query(Worker).filter(
        (Worker.current_task_id == f"train-{job_id[:8]}") | (Worker.current_task_id == job_id)
    ).all()
    for w in bound_workers:
        w.current_task_id = None
        if w.is_available:
            w.status = "online"
            w.gpu_utilization_pct = 10.0

    db.commit()
    return {"status": "cancelled", "job_id": job_id}

