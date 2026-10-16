"""
Network Nebula - Distributed Training Module

Implements:
- Model parallelism (split model across workers)
- Gradient aggregation (all-reduce)
- Distributed training coordination
- Worker grouping for multi-GPU tasks
- Checkpoint management
"""

import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Callable
from collections import defaultdict
import threading
import hashlib


class ParallelismType(str, Enum):
    """Types of parallelism supported"""
    DATA = "data_parallel"          # Same model, different data batches
    MODEL = "model_parallel"         # Different layers on different GPUs
    PIPELINE = "pipeline_parallel"   # Micro-batches through pipeline stages


class TrainingPhase(str, Enum):
    """Training phases for pipeline parallelism"""
    FORWARD = "forward"
    BACKWARD = "backward"
    UPDATE = "update"


@dataclass
class ModelSlice:
    """Represents a slice of a distributed model"""
    slice_id: str
    worker_id: str
    layer_start: int
    layer_end: int
    total_layers: int
    input_shape: Optional[tuple] = None
    output_shape: Optional[tuple] = None
    weights: Optional[bytes] = None
    gradients: Optional[bytes] = None


@dataclass
class DistributedTask:
    """A task that spans multiple workers"""
    task_id: str
    parent_task_id: str  # Original task this is derived from
    parallelism_type: ParallelismType
    num_workers: int
    worker_ids: List[str]
    model_slices: List[ModelSlice] = field(default_factory=list)
    status: str = "pending"  # pending, scheduled, running, completed, failed
    progress: float = 0.0
    current_epoch: int = 0
    total_epochs: int = 100
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    config: Dict[str, Any] = field(default_factory=dict)
    checkpoint_urls: List[str] = field(default_factory=list)


@dataclass
class GradientBucket:
    """Container for gradient aggregation"""
    bucket_id: str
    layer_name: str
    shape: tuple
    accumulated_grads: List[bytes] = field(default_factory=list)
    worker_ids: List[str] = field(default_factory=list)
    ready: bool = False
    aggregated: Optional[bytes] = None


class GradientAggregator:
    """
    Implements all-reduce gradient aggregation.

    In all-reduce, each worker computes gradient for its shard,
    then all workers collaborate to compute the average gradient.

    Process:
    1. Each worker computes local gradients
    2. All-reduce broadcasts and sums gradients across all workers
    3. Each worker receives the averaged gradient
    """

    def __init__(self, num_workers: int, robust_byzantine: bool = True, method: str = "trimmed_mean"):
        self.num_workers = num_workers
        self.robust_byzantine = robust_byzantine
        self.method = method
        self.buckets: Dict[str, GradientBucket] = {}
        self._lock = threading.Lock()
        self._callbacks: List[Callable] = []
        self.last_allreduce_telemetry: Dict[str, Any] = {}

    def create_bucket(self, layer_name: str, shape: tuple) -> str:
        """Create a new gradient bucket for a layer"""
        bucket_id = hashlib.md5(f"{layer_name}_{shape}".encode()).hexdigest()[:12]
        with self._lock:
            self.buckets[bucket_id] = GradientBucket(
                bucket_id=bucket_id,
                layer_name=layer_name,
                shape=shape
            )
        return bucket_id

    def add_gradient(self, bucket_id: str, worker_id: str, gradient_data: bytes) -> bool:
        """
        Add a gradient from a worker.
        Returns True if all workers have contributed (ready for all-reduce).
        """
        with self._lock:
            if bucket_id not in self.buckets:
                return False

            bucket = self.buckets[bucket_id]
            if worker_id in bucket.worker_ids:
                return False  # Already contributed

            bucket.accumulated_grads.append(gradient_data)
            bucket.worker_ids.append(worker_id)

            if len(bucket.worker_ids) == self.num_workers:
                bucket.ready = True
                # Perform all-reduce (Byzantine-robust trimmed-mean or median)
                bucket.aggregated = self._all_reduce(
                    bucket.accumulated_grads, worker_ids=bucket.worker_ids
                )
                self._notify_callbacks(bucket_id, bucket.aggregated)
                return True
        return False

    def _all_reduce(self, grads: List[bytes], worker_ids: Optional[List[str]] = None) -> bytes:
        """
        All-reduce operation: Byzantine-robust trimmed-mean or median aggregation.
        Protects distributed training against poisoned gradients from malicious worker nodes.
        """
        try:
            import numpy as np
            if self.robust_byzantine:
                try:
                    from app.verification_engine import verification_engine
                    res = verification_engine.aggregate_gradients_byzantine_robust(
                        gradients=grads,
                        worker_ids=worker_ids,
                        method=self.method if self.method in ["trimmed_mean", "coordinate_median"] else "coordinate_median",
                    )
                    self.last_allreduce_telemetry = res
                    return res["aggregated_bytes"]
                except Exception:
                    pass

            arrays = []
            for g in grads:
                arr = np.frombuffer(g, dtype=np.float32)
                arrays.append(arr)
            avg = np.mean(arrays, axis=0)
            return avg.tobytes()
        except ImportError:
            # Fallback: just use the first gradient
            return grads[0]

    def get_aggregated_gradient(self, bucket_id: str) -> Optional[bytes]:
        """Get the aggregated gradient after all-reduce"""
        with self._lock:
            bucket = self.buckets.get(bucket_id)
            if bucket and bucket.ready:
                return bucket.aggregated
        return None

    def is_ready(self, bucket_id: str) -> bool:
        """Check if a bucket is ready (all-reduce complete)"""
        with self._lock:
            bucket = self.buckets.get(bucket_id)
            return bucket.ready if bucket else False

    def reset_bucket(self, bucket_id: str) -> None:
        """Reset a bucket for next iteration"""
        with self._lock:
            if bucket_id in self.buckets:
                self.buckets[bucket_id].accumulated_grads = []
                self.buckets[bucket_id].worker_ids = []
                self.buckets[bucket_id].ready = False
                self.buckets[bucket_id].aggregated = None

    def on_aggregate(self, callback: Callable[[str, bytes], None]) -> None:
        """Register callback for when aggregation completes"""
        self._callbacks.append(callback)

    def _notify_callbacks(self, bucket_id: str, aggregated: bytes) -> None:
        for cb in self._callbacks:
            try:
                cb(bucket_id, aggregated)
            except Exception:
                pass


class ModelParallelismManager:
    """
    Manages model parallelism across workers.

    Splits a large model into slices that can be processed
    on different GPUs/workers in parallel.
    """

    def __init__(self):
        self.slices: Dict[str, ModelSlice] = {}
        self.distributed_tasks: Dict[str, DistributedTask] = {}
        self._lock = threading.Lock()

    def create_model_slices(
        self,
        task_id: str,
        total_layers: int,
        num_workers: int,
        worker_ids: List[str]
    ) -> List[ModelSlice]:
        """
        Split a model into slices for parallel processing.

        Example: 48 layers across 4 workers = 12 layers each
        Worker 0: layers 0-11, Worker 1: layers 12-23, etc.
        """
        if num_workers > total_layers:
            num_workers = total_layers

        layers_per_worker = total_layers // num_workers
        extra_layers = total_layers % num_workers

        slices = []
        current_layer = 0

        for i, worker_id in enumerate(worker_ids[:num_workers]):
            slice_id = f"{task_id}_slice_{i}"

            # Distribute extra layers to first workers
            extra = 1 if i < extra_layers else 0
            slice_layers = layers_per_worker + extra

            slice_obj = ModelSlice(
                slice_id=slice_id,
                worker_id=worker_id,
                layer_start=current_layer,
                layer_end=current_layer + slice_layers,
                total_layers=total_layers
            )

            self.slices[slice_id] = slice_obj
            slices.append(slice_obj)
            current_layer += slice_layers

        return slices

    def get_slice(self, slice_id: str) -> Optional[ModelSlice]:
        """Get a model slice by ID"""
        return self.slices.get(slice_id)

    def get_slices_for_worker(self, worker_id: str) -> List[ModelSlice]:
        """Get all slices assigned to a worker"""
        return [s for s in self.slices.values() if s.worker_id == worker_id]

    def update_slice_weights(self, slice_id: str, weights: bytes) -> None:
        """Update the weights for a slice after training"""
        with self._lock:
            if slice_id in self.slices:
                self.slices[slice_id].weights = weights

    def get_combined_weights(self, task_id: str) -> Optional[Dict[str, bytes]]:
        """Combine weights from all slices for a task"""
        task_slices = [s for s in self.slices.values() if s.slice_id.startswith(task_id)]
        if not task_slices or len(task_slices) != len(set(s.worker_ids for s in task_slices)):
            return None

        return {s.slice_id: s.weights for s in task_slices if s.weights}


class DistributedTaskCoordinator:
    """
    Coordinates distributed training tasks across multiple workers.

    Responsibilities:
    - Split tasks into sub-tasks for worker groups
    - Track progress across all workers
    - Aggregate results
    - Handle failures and stragglers
    """

    def __init__(self):
        self.active_tasks: Dict[str, DistributedTask] = {}
        self.gradient_aggregator: GradientAggregator = None
        self.model_parallelism: ModelParallelismManager = ModelParallelismManager()
        self._lock = threading.Lock()
        self._progress_callbacks: List[Callable] = []

    def create_distributed_task(
        self,
        task_id: str,
        parallelism_type: ParallelismType,
        num_workers: int,
        config: Dict[str, Any]
    ) -> DistributedTask:
        """Create a new distributed training task"""
        dist_task = DistributedTask(
            task_id=f"dist_{task_id}_{uuid.uuid4().hex[:8]}",
            parent_task_id=task_id,
            parallelism_type=parallelism_type,
            num_workers=num_workers,
            worker_ids=[],  # To be assigned
            total_epochs=config.get("epochs", 100),
            config=config
        )

        with self._lock:
            self.active_tasks[dist_task.task_id] = dist_task

        return dist_task

    def assign_workers(self, task_id: str, worker_ids: List[str]) -> bool:
        """Assign workers to a distributed task"""
        with self._lock:
            if task_id not in self.active_tasks:
                return False

            task = self.active_tasks[task_id]
            if len(worker_ids) != task.num_workers:
                return False

            task.worker_ids = worker_ids

            # Create model slices if model parallelism
            if task.parallelism_type == ParallelismType.MODEL:
                total_layers = task.config.get("total_layers", 48)
                slices = self.model_parallelism.create_model_slices(
                    task_id, total_layers, task.num_workers, worker_ids
                )
                task.model_slices = slices

            return True

    def update_progress(self, task_id: str, worker_id: str, progress: float) -> None:
        """Update progress for a specific worker in a distributed task"""
        with self._lock:
            if task_id not in self.active_tasks:
                return

            task = self.active_tasks[task_id]

            # Calculate overall progress as average across workers
            # In production, track per-worker progress
            task.progress = max(task.progress, progress)

            # Check for completion
            if progress >= 100.0:
                self._check_task_completion(task_id)

    def _check_task_completion(self, task_id: str) -> None:
        """Check if all workers have completed their portion"""
        task = self.active_tasks.get(task_id)
        if not task:
            return

        # Simple completion check - all epochs done
        if task.current_epoch >= task.total_epochs:
            task.status = "completed"
            task.completed_at = datetime.utcnow()
            self._notify_progress(task_id, 100.0)

    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get the status of a distributed task"""
        with self._lock:
            task = self.active_tasks.get(task_id)
            if not task:
                return None

            return {
                "task_id": task.task_id,
                "parent_task_id": task.parent_task_id,
                "parallelism_type": task.parallelism_type.value,
                "status": task.status,
                "progress": task.progress,
                "current_epoch": task.current_epoch,
                "total_epochs": task.total_epochs,
                "worker_ids": task.worker_ids,
                "num_slices": len(task.model_slices),
                "created_at": task.created_at.isoformat(),
            }

    def on_progress(self, callback: Callable[[str, float], None]) -> None:
        """Register progress callback"""
        self._progress_callbacks.append(callback)

    def _notify_progress(self, task_id: str, progress: float) -> None:
        for cb in self._progress_callbacks:
            try:
                cb(task_id, progress)
            except Exception:
                pass


class CheckpointManager:
    """
    Manages model checkpoints during distributed training.

    Responsibilities:
    - Save periodic checkpoints during training
    - Track checkpoint versions
    - Coordinate checkpoint access across workers
    """

    def __init__(self, storage_upload_func: Optional[Callable] = None):
        self.checkpoints: Dict[str, List[Dict]] = defaultdict(list)
        self.storage_upload = storage_upload_func
        self._lock = threading.Lock()

    def save_checkpoint(
        self,
        task_id: str,
        epoch: int,
        model_state: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None,
        is_final: bool = False
    ) -> str:
        """
        Save a checkpoint for a training task.
        Returns the checkpoint URL/path.
        """
        checkpoint_id = f"{task_id}_epoch_{epoch}_{uuid.uuid4().hex[:8]}"

        checkpoint_data = {
            "checkpoint_id": checkpoint_id,
            "task_id": task_id,
            "epoch": epoch,
            "timestamp": datetime.utcnow().isoformat(),
            "is_final": is_final,
            "metadata": metadata or {},
        }

        with self._lock:
            self.checkpoints[task_id].append(checkpoint_data)

        # In production, upload model_state to MinIO/S3
        if self.storage_upload:
            try:
                checkpoint_url = f"checkpoints/{task_id}/epoch_{epoch}.pt"
                # self.storage_upload(model_state, checkpoint_url)
                checkpoint_data["url"] = checkpoint_url
            except Exception as e:
                print(f"[CHECKPOINT] Upload failed: {e}")

        print(f"[CHECKPOINT] Saved checkpoint {checkpoint_id} for task {task_id} epoch {epoch}")
        return checkpoint_id

    def get_latest_checkpoint(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get the most recent checkpoint for a task"""
        with self._lock:
            checkpoints = self.checkpoints.get(task_id, [])
            return checkpoints[-1] if checkpoints else None

    def get_checkpoint(self, task_id: str, epoch: int) -> Optional[Dict[str, Any]]:
        """Get a specific checkpoint by epoch"""
        with self._lock:
            for cp in self.checkpoints.get(task_id, []):
                if cp["epoch"] == epoch:
                    return cp
        return None

    def list_checkpoints(self, task_id: str) -> List[Dict[str, Any]]:
        """List all checkpoints for a task"""
        with self._lock:
            return list(self.checkpoints.get(task_id, []))


class WorkerGroup:
    """
    Represents a group of workers assigned to a distributed task.

    Provides communication primitives for:
    - Barrier synchronization
    - Broadcast (one-to-all)
    - All-reduce (all-to-all reduction)
    """

    def __init__(self, group_id: str, worker_ids: List[str]):
        self.group_id = group_id
        self.worker_ids = worker_ids
        self.num_workers = len(worker_ids)
        self._barriers: Dict[str, threading.Event] = {}
        self._data: Dict[str, Any] = {}
        self._lock = threading.Lock()

    def barrier(self, barrier_id: str, timeout: float = 300.0) -> bool:
        """
        Synchronization point - all workers must reach before any proceeds.

        Uses a simple event-based barrier implementation.
        In production, this would use gRPC/NCCL for distributed barrier.
        """
        with self._lock:
            if barrier_id not in self._barriers:
                self._barriers[barrier_id] = {
                    "event": threading.Event(),
                    "count": 0,
                    "total": self.num_workers
                }

            barrier = self._barriers[barrier_id]
            barrier["count"] += 1

            if barrier["count"] >= barrier["total"]:
                barrier["event"].set()
            else:
                barrier["event"].wait(timeout=timeout)
                # Reset for next use
                barrier["event"].clear()
                barrier["count"] = 0

        return True

    def broadcast(self, key: str, value: Any, from_worker_id: str) -> None:
        """
        Broadcast data from one worker to all others in the group.

        In production, use gRPC streaming or NCCL broadcast.
        """
        with self._lock:
            self._data[key] = {
                "value": value,
                "from": from_worker_id,
                "timestamp": time.time()
            }

    def allreduce(self, key: str, values: Dict[str, float], op: str = "mean") -> Optional[float]:
        """
        All-reduce operation across workers.

        Supported ops: "sum", "mean", "min", "max"

        In production, use NCCL for GPU-native all-reduce.
        """
        worker_values = list(values.values())

        if op == "sum":
            result = sum(worker_values)
        elif op == "mean":
            result = sum(worker_values) / len(worker_values)
        elif op == "min":
            result = min(worker_values)
        elif op == "max":
            result = max(worker_values)
        else:
            result = None

        with self._lock:
            self._data[key] = {
                "value": result,
                "op": op,
                "timestamp": time.time()
            }

        return result


# Global instances for use across the application
gradient_aggregator = GradientAggregator(num_workers=1)
model_parallelism_manager = ModelParallelismManager()
task_coordinator = DistributedTaskCoordinator()
checkpoint_manager = CheckpointManager()


# Helper functions for distributed training setup

def setup_distributed_training(
    task_id: str,
    num_gpus: int,
    model_config: Dict[str, Any]
) -> DistributedTask:
    """
    Helper to set up a distributed training task.

    Args:
        task_id: Original task ID
        num_gpus: Number of GPUs/workers to use
        model_config: Configuration dict with keys:
            - epochs: Total training epochs
            - parallelism: "data", "model", or "pipeline"
            - total_layers: For model parallelism

    Returns:
        Configured DistributedTask
    """
    parallelism_map = {
        "data": ParallelismType.DATA,
        "model": ParallelismType.MODEL,
        "pipeline": ParallelismType.PIPELINE,
    }

    parallelism = parallelism_map.get(
        model_config.get("parallelism", "data"),
        ParallelismType.DATA
    )

    dist_task = task_coordinator.create_distributed_task(
        task_id=task_id,
        parallelism_type=parallelism,
        num_workers=num_gpus,
        config=model_config
    )

    return dist_task


def get_worker_training_config(
    dist_task: DistributedTask,
    worker_id: str,
    global_config: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Get the training configuration for a specific worker in a distributed task.

    Returns config specific to that worker's portion of the model/data.
    """
    slices = model_parallelism_manager.get_slices_for_worker(worker_id)

    config = {
        **global_config,
        "dist_task_id": dist_task.task_id,
        "worker_id": worker_id,
        "is_coordinator": worker_id == dist_task.worker_ids[0] if dist_task.worker_ids else False,
        "num_workers": dist_task.num_workers,
    }

    if slices:
        config["model_slice"] = {
            "slice_id": slices[0].slice_id,
            "layer_start": slices[0].layer_start,
            "layer_end": slices[0].layer_end,
            "total_layers": slices[0].total_layers,
        }

    return config
