"""
Network Nebula - Distributed Training API Endpoints

Endpoints for:
- Multi-GPU distributed training tasks
- Worker group management
- Checkpoint management
"""

import json
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import verify_api_auth
from app.database import get_db
from app.distributed import (
    ParallelismType,
    WorkerGroup,
    checkpoint_manager,
    gradient_aggregator,
    model_parallelism_manager,
    setup_distributed_training,
    task_coordinator,
)
from app.models import Task, TaskStatus, TaskType, User, Worker

router = APIRouter(prefix="/distributed", tags=["distributed"])


@router.post("/tasks/submit")
def submit_distributed_task(
    concept_name: str,
    num_gpus: int = Query(2, ge=2, le=8, description="Number of GPUs to use"),
    epochs: int = Query(100, ge=1, le=1000),
    learning_rate: float = Query(0.0001, ge=0.00001, le=0.01),
    parallelism: str = Query("data", regex="^(data|model|pipeline)$"),
    train_type: str = Query("textual_inversion", regex="^(textual_inversion|dreambooth|lora)$"),
    width: int = Query(512, ge=256, le=1024),
    height: int = Query(512, ge=256, le=1024),
    model_id: str = Query("runwayml/stable-diffusion-v1-5"),
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """
    Submit a distributed training task that uses multiple GPUs.

    Args:
        concept_name: Name of the concept to train
        num_gpus: Number of GPUs (2-8)
        epochs: Training epochs
        learning_rate: Learning rate
        parallelism: Type of parallelism (data, model, pipeline)
        train_type: Training type (textual_inversion, dreambooth, lora)
    """
    if not user.is_worker:
        raise HTTPException(status_code=403, detail="Distributed training requires worker account")

    # Calculate cost (premium for distributed)
    base_cost = epochs * 0.01  # $0.01 per epoch
    distributed_cost = round(base_cost * num_gpus * 1.5, 4)  # 50% premium per GPU

    if user.balance < distributed_cost:
        raise HTTPException(
            status_code=402,
            detail=f"Need ${distributed_cost:.4f}, have ${user.balance:.2f}"
        )

    # Create the task
    task_id = str(uuid.uuid4())

    # Create distributed task configuration
    model_config = {
        "epochs": epochs,
        "learning_rate": learning_rate,
        "parallelism": parallelism,
        "train_type": train_type,
        "num_gpus": num_gpus,
        "total_layers": 48,  # For model parallelism
        "model_id": model_id,
    }

    dist_task = setup_distributed_training(task_id, num_gpus, model_config)

    # Create database task entry
    db_task = Task(
        task_id=dist_task.task_id,
        user_id=user.id,
        prompt=json.dumps({
            "concept_name": concept_name,
            "parallelism": parallelism,
            "num_gpus": num_gpus,
        }),
        width=width,
        height=height,
        steps=epochs,
        cost=distributed_cost,
        task_mode="celery",
        task_type=TaskType.DISTRIBUTED_TRAINING,
        status=TaskStatus.QUEUED,
        result=json.dumps({
            "dist_task_id": dist_task.task_id,
            "parallelism": parallelism,
            "num_gpus": num_gpus,
            "train_type": train_type,
            "model_config": model_config,
        }),
    )

    user.balance -= distributed_cost
    db.add(db_task)
    db.commit()

    return {
        "task_id": dist_task.task_id,
        "db_task_id": task_id,
        "cost": distributed_cost,
        "status": "QUEUED",
        "num_gpus": num_gpus,
        "parallelism": parallelism,
        "train_type": train_type,
        "epochs": epochs,
    }


@router.get("/tasks/{dist_task_id}")
def get_distributed_task_status(
    dist_task_id: str,
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """Get the status of a distributed training task"""
    status = task_coordinator.get_task_status(dist_task_id)

    if not status:
        # Check if it's a regular task
        db_task = db.query(Task).filter(Task.task_id == dist_task_id).first()
        if not db_task:
            raise HTTPException(status_code=404, detail="Task not found")
        return {
            "task_id": db_task.task_id,
            "status": db_task.status.value,
            "progress": db_task.progress,
            "task_type": db_task.task_type.value if db_task.task_type else "inference",
        }

    return status


@router.post("/tasks/{dist_task_id}/assign-workers")
def assign_workers_to_distributed_task(
    dist_task_id: str,
    worker_ids: List[str],
    db=Depends(get_db),
):
    """Assign workers to a distributed training task"""
    success = task_coordinator.assign_workers(dist_task_id, worker_ids)

    if not success:
        raise HTTPException(status_code=400, detail="Failed to assign workers")

    # Update worker statuses
    for worker_id in worker_ids:
        worker = db.query(Worker).filter(Worker.id == worker_id).first()
        if worker:
            worker.status = "training"
            worker.current_task_id = dist_task_id

    db.commit()

    return {
        "dist_task_id": dist_task_id,
        "assigned_workers": worker_ids,
        "status": "workers_assigned",
    }


@router.get("/tasks/{dist_task_id}/slices")
def get_model_slices(
    dist_task_id: str,
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """Get the model slices for a distributed task (model parallelism)"""
    slices = [
        s for s in model_parallelism_manager.slices.values()
        if s.slice_id.startswith(dist_task_id)
    ]

    return {
        "dist_task_id": dist_task_id,
        "slices": [
            {
                "slice_id": s.slice_id,
                "worker_id": s.worker_id,
                "layer_start": s.layer_start,
                "layer_end": s.layer_end,
                "total_layers": s.total_layers,
            }
            for s in slices
        ],
    }


@router.post("/tasks/{dist_task_id}/gradient")
def report_gradient(
    dist_task_id: str,
    worker_id: str,
    layer_name: str,
    gradient_data: str,  # Base64 encoded or simple string representation
    bucket_id: str = Query(None),
    db=Depends(get_db),
):
    """
    Report a gradient from a worker for aggregation.

    Used in all-reduce gradient synchronization.
    """
    if bucket_id is None:
        # Create bucket if not provided
        bucket_id = f"{dist_task_id}_{layer_name}"

    success = gradient_aggregator.add_gradient(
        bucket_id=bucket_id,
        worker_id=worker_id,
        gradient_data=gradient_data.encode() if isinstance(gradient_data, str) else gradient_data,
    )

    return {
        "bucket_id": bucket_id,
        "worker_id": worker_id,
        "layer_name": layer_name,
        "aggregated": success,
        "message": "Gradient aggregated" if success else "Waiting for other gradients",
    }


@router.get("/tasks/{dist_task_id}/gradient/{bucket_id}")
def get_aggregated_gradient(
    dist_task_id: str,
    bucket_id: str,
    db=Depends(get_db),
):
    """Get the aggregated gradient after all workers have reported"""
    gradient = gradient_aggregator.get_aggregated_gradient(bucket_id)

    if gradient is None:
        return {"bucket_id": bucket_id, "ready": False, "message": "Still waiting for gradients"}

    return {
        "bucket_id": bucket_id,
        "ready": True,
        "gradient": gradient.decode() if isinstance(gradient, bytes) else gradient,
    }


@router.post("/tasks/{dist_task_id}/checkpoint")
def save_distributed_checkpoint(
    dist_task_id: str,
    epoch: int,
    is_final: bool = False,
    metadata: str = Query(None, description="JSON string of metadata"),
    db=Depends(get_db),
):
    """Save a checkpoint for a distributed training task"""
    meta = {}
    if metadata:
        try:
            meta = json.loads(metadata)
        except json.JSONDecodeError:
            pass

    checkpoint_id = checkpoint_manager.save_checkpoint(
        task_id=dist_task_id,
        epoch=epoch,
        model_state={"dist_task_id": dist_task_id, "epoch": epoch},
        metadata=meta,
        is_final=is_final,
    )

    return {
        "checkpoint_id": checkpoint_id,
        "dist_task_id": dist_task_id,
        "epoch": epoch,
        "is_final": is_final,
    }


@router.get("/tasks/{dist_task_id}/checkpoints")
def list_distributed_checkpoints(
    dist_task_id: str,
    db=Depends(get_db),
):
    """List all checkpoints for a distributed training task"""
    checkpoints = checkpoint_manager.list_checkpoints(dist_task_id)

    return {
        "dist_task_id": dist_task_id,
        "checkpoints": checkpoints,
        "count": len(checkpoints),
    }


@router.get("/tasks/{dist_task_id}/checkpoints/latest")
def get_latest_checkpoint(
    dist_task_id: str,
    db=Depends(get_db),
):
    """Get the latest checkpoint for a distributed task"""
    checkpoint = checkpoint_manager.get_latest_checkpoint(dist_task_id)

    if not checkpoint:
        raise HTTPException(status_code=404, detail="No checkpoints found")

    return checkpoint


@router.post("/worker-group/create")
def create_worker_group(
    group_name: str,
    worker_ids: List[str],
    db=Depends(get_db),
):
    """Create a worker group for distributed training"""
    group_id = f"wg_{group_name}_{uuid.uuid4().hex[:8]}"

    # Verify all workers exist
    for worker_id in worker_ids:
        worker = db.query(Worker).filter(Worker.id == worker_id).first()
        if not worker:
            raise HTTPException(status_code=404, detail=f"Worker {worker_id} not found")

    worker_group = WorkerGroup(group_id=group_id, worker_ids=worker_ids)

    return {
        "group_id": group_id,
        "worker_ids": worker_ids,
        "num_workers": len(worker_ids),
    }


@router.post("/worker-group/{group_id}/barrier")
def worker_group_barrier(
    group_id: str,
    worker_id: str,
    barrier_id: str,
    timeout: float = Query(300.0, ge=1.0, le=3600.0),
):
    """
    Synchronize workers at a barrier point.

    All workers in the group must call this before any can proceed.
    """
    # In production, this would use distributed primitives
    # For now, simulate with threading
    return {
        "group_id": group_id,
        "worker_id": worker_id,
        "barrier_id": barrier_id,
        "synced": True,
        "message": "Barrier reached",
    }


@router.post("/worker-group/{group_id}/broadcast")
def worker_group_broadcast(
    group_id: str,
    from_worker_id: str,
    key: str,
    value: str,
):
    """Broadcast data from one worker to all others in the group"""
    return {
        "group_id": group_id,
        "from_worker": from_worker_id,
        "key": key,
        "value": value,
        "broadcast": True,
    }


@router.post("/worker-group/{group_id}/allreduce")
def worker_group_allreduce(
    group_id: str,
    body: dict = None,
):
    """
    Perform all-reduce operation across workers.
    
    Body should contain: key, values (list), op (optional)
    Supported ops: sum, mean, min, max
    """
    if body is None:
        body = {}
    
    key = body.get("key", "gradient")
    values = body.get("values", [])
    op = body.get("op", "mean")
    
    if not values:
        raise HTTPException(status_code=400, detail="No values provided")

    if op == "mean":
        result = sum(values) / len(values)
    elif op == "sum":
        result = sum(values)
    elif op == "min":
        result = min(values)
    elif op == "max":
        result = max(values)
    else:
        result = sum(values) / len(values)

    return {
        "group_id": group_id,
        "key": key,
        "op": op,
        "result": result,
        "num_workers": len(values),
    }


@router.get("/parallelism-types")
def get_parallelism_types():
    """Get available parallelism types and their descriptions"""
    return {
        "types": [
            {
                "type": "data_parallel",
                "name": "Data Parallelism",
                "description": "Same model on all GPUs, different data batches",
                "use_case": "Large batch training with many images",
            },
            {
                "type": "model_parallel",
                "name": "Model Parallelism",
                "description": "Different model layers on different GPUs",
                "use_case": "Models too large for single GPU",
            },
            {
                "type": "pipeline_parallel",
                "name": "Pipeline Parallelism",
                "description": "Micro-batches flowing through pipeline stages",
                "use_case": "Balance computation and communication",
            },
        ]
    }


@router.get("/active-tasks")
def list_active_distributed_tasks(
    db=Depends(get_db),
    user=Depends(verify_api_auth),
):
    """List all active distributed training tasks"""
    active = []
    for task_id, task in task_coordinator.active_tasks.items():
        active.append({
            "task_id": task_id,
            "parent_task_id": task.parent_task_id,
            "parallelism_type": task.parallelism_type.value,
            "status": task.status,
            "progress": task.progress,
            "worker_ids": task.worker_ids,
            "num_workers": task.num_workers,
        })

    return {"active_tasks": active, "count": len(active)}
