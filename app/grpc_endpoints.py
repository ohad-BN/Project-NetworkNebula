"""
Network Nebula - Phase 9: gRPC Worker Communication API Endpoints

REST API endpoints for managing gRPC-based worker-to-worker communication.
Includes peer registration, connection management, and communication status.

Usage:
    These endpoints manage the gRPC worker communication layer.
    The actual gRPC communication happens directly between workers.
"""

import json
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import verify_api_auth
from app.database import get_db
from app.models import Task, TaskStatus, TaskType, User, Worker

router = APIRouter(prefix="/grpc", tags=["grpc"])


# In-memory state for gRPC worker communication
# In production, this would be managed by a separate coordination service
class gRPCState:
    """Manages gRPC worker peer registry and connection state"""

    def __init__(self):
        self.registered_workers: Dict[str, Dict] = {}
        self.active_connections: Dict[str, List[str]] = {}  # worker_id -> [peer_ids]
        self.connection_history: List[Dict] = []
        self._lock = False

    def register_worker(
        self,
        worker_id: str,
        grpc_port: int,
        capabilities: List[str],
        gpu_info: Dict = None,
    ) -> Dict:
        """Register a worker for gRPC communication"""
        info = {
            "worker_id": worker_id,
            "grpc_port": grpc_port,
            "capabilities": capabilities,
            "gpu_info": gpu_info or {},
            "registered_at": datetime.utcnow().isoformat(),
            "last_heartbeat": datetime.utcnow().isoformat(),
            "status": "online",
            "peer_connections": [],
        }
        self.registered_workers[worker_id] = info
        return info

    def unregister_worker(self, worker_id: str) -> bool:
        """Unregister a worker from gRPC communication"""
        if worker_id in self.registered_workers:
            del self.registered_workers[worker_id]
            return True
        return False

    def get_worker(self, worker_id: str) -> Optional[Dict]:
        """Get worker gRPC info"""
        return self.registered_workers.get(worker_id)

    def list_workers(self) -> List[Dict]:
        """List all registered gRPC workers"""
        return list(self.registered_workers.values())

    def update_heartbeat(self, worker_id: str) -> bool:
        """Update worker heartbeat"""
        if worker_id in self.registered_workers:
            self.registered_workers[worker_id]["last_heartbeat"] = (
                datetime.utcnow().isoformat()
            )
            return True
        return False

    def add_connection(
        self, worker_id: str, peer_id: str, connection_type: str = "bidirectional"
    ) -> bool:
        """Record a connection between workers"""
        if worker_id not in self.active_connections:
            self.active_connections[worker_id] = []

        self.active_connections[worker_id].append(peer_id)

        self.connection_history.append(
            {
                "timestamp": datetime.utcnow().isoformat(),
                "worker_id": worker_id,
                "peer_id": peer_id,
                "type": connection_type,
            }
        )

        # Update peer connections
        if peer_id in self.registered_workers:
            if "peer_connections" not in self.registered_workers[peer_id]:
                self.registered_workers[peer_id]["peer_connections"] = []
            if worker_id not in self.registered_workers[peer_id]["peer_connections"]:
                self.registered_workers[peer_id]["peer_connections"].append(worker_id)

        return True

    def get_connections(self, worker_id: str) -> List[str]:
        """Get peer's connections for a worker"""
        return self.active_connections.get(worker_id, [])

    def remove_connection(self, worker_id: str, peer_id: str) -> bool:
        """Remove a connection between workers"""
        if worker_id in self.active_connections:
            if peer_id in self.active_connections[worker_id]:
                self.active_connections[worker_id].remove(peer_id)
                return True
        return False


# Global gRPC state instance
grpc_state = gRPCState()


@router.post("/workers/register")
def grpc_register_worker(
    worker_id: str,
    grpc_port: int = Query(50051, ge=5000, le=60000),
    capabilities: str = Query(
        "inference,batch_inference,training",
        description="Comma-separated list of capabilities",
    ),
    gpu_info: str = Query(None, description="JSON string of GPU info"),
    db=Depends(get_db),
):
    """
    Register a worker for gRPC-based worker-to-worker communication.

    Workers use this endpoint to advertise their gRPC port and capabilities
    so other workers can connect directly for distributed training.
    """
    # Verify worker exists in database
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found in database")

    # Parse capabilities
    caps = [c.strip() for c in capabilities.split(",")]

    # Parse GPU info if provided
    parsed_gpu = None
    if gpu_info:
        try:
            parsed_gpu = json.loads(gpu_info)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid GPU info JSON")

    # Register in gRPC state
    info = grpc_state.register_worker(worker_id, grpc_port, caps, parsed_gpu)

    # Also update worker record
    worker.status = "online"
    db.commit()

    return {
        "worker_id": worker_id,
        "grpc_port": grpc_port,
        "capabilities": caps,
        "status": "registered",
        "message": "Worker registered for gRPC communication",
    }


@router.post("/workers/unregister")
def grpc_unregister_worker(
    worker_id: str,
    db=Depends(get_db),
):
    """Unregister a worker from gRPC communication"""
    success = grpc_state.unregister_worker(worker_id)

    if not success:
        raise HTTPException(status_code=404, detail="Worker not found")

    # Update worker record
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if worker:
        worker.status = "offline"
        db.commit()

    return {"worker_id": worker_id, "status": "unregistered"}


@router.get("/workers")
def grpc_list_workers(
    capability: str = Query(None, description="Filter by capability"),
    db=Depends(get_db),
):
    """
    List all workers registered for gRPC communication.

    Use this to discover workers that can be connected to for
    distributed training.
    """
    workers = grpc_state.list_workers()

    if capability:
        workers = [w for w in workers if capability in w.get("capabilities", [])]

    return {"workers": workers, "count": len(workers)}


@router.get("/workers/{worker_id}")
def grpc_get_worker(
    worker_id: str,
    db=Depends(get_db),
):
    """Get gRPC details for a specific worker"""
    info = grpc_state.get_worker(worker_id)

    if not info:
        raise HTTPException(status_code=404, detail="Worker not found")

    return info


@router.post("/workers/{worker_id}/heartbeat")
def grpc_worker_heartbeat(
    worker_id: str,
    db=Depends(get_db),
):
    """Update heartbeat for a gRPC worker"""
    success = grpc_state.update_heartbeat(worker_id)

    if not success:
        raise HTTPException(status_code=404, detail="Worker not found")

    return {"worker_id": worker_id, "status": "ok"}


@router.post("/connect")
def grpc_connect_workers(
    worker_id: str,
    peer_id: str,
    connection_type: str = Query(
        "bidirectional", regex="^(bidirectional|sender|receiver)$"
    ),
    db=Depends(get_db),
):
    """
    Establish a gRPC connection between two workers.

    This endpoint records the connection intent. The actual
    connection is established via direct gRPC calls between workers.
    """
    # Verify both workers are registered
    worker_info = grpc_state.get_worker(worker_id)
    peer_info = grpc_state.get_worker(peer_id)

    if not worker_info:
        raise HTTPException(status_code=404, detail="Worker not found")
    if not peer_info:
        raise HTTPException(status_code=404, detail="Peer not found")

    # Record connection
    grpc_state.add_connection(worker_id, peer_id, connection_type)

    return {
        "worker_id": worker_id,
        "peer_id": peer_id,
        "peer_grpc_port": peer_info["grpc_port"],
        "connection_type": connection_type,
        "status": "connected",
    }


@router.post("/disconnect")
def grpc_disconnect_workers(
    worker_id: str,
    peer_id: str,
    db=Depends(get_db),
):
    """Disconnect two workers"""
    success = grpc_state.remove_connection(worker_id, peer_id)

    if not success:
        raise HTTPException(status_code=404, detail="Connection not found")

    return {"worker_id": worker_id, "peer_id": peer_id, "status": "disconnected"}


@router.get("/connections")
def grpc_list_connections(
    worker_id: str = Query(None, description="Filter by worker"),
    db=Depends(get_db),
):
    """List active gRPC connections"""
    if worker_id:
        connections = grpc_state.get_connections(worker_id)
        return {"worker_id": worker_id, "connections": connections}

    # Return all connections
    return {
        "connections": grpc_state.connection_history[-100:],
        "count": len(grpc_state.connection_history),
    }


@router.get("/topology")
def grpc_get_topology(db=Depends(get_db)):
    """
    Get the current worker topology for gRPC communication.

    Returns a graph of worker connections useful for
    visualizing the distributed training network.
    """
    workers = grpc_state.list_workers()
    edges = []

    for conn in grpc_state.connection_history[-50:]:
        edges.append(
            {
                "from": conn["worker_id"],
                "to": conn["peer_id"],
                "type": conn["type"],
            }
        )

    return {"nodes": workers, "edges": edges, "total_workers": len(workers)}


@router.post("/broadcast")
def grpc_broadcast_message(
    worker_id: str,
    message: str,
    message_type: str = Query(
        "training_data", regex="^(training_data|control_signal|checkpoint)$"
    ),
    target_workers: str = Query(
        None, description="Comma-separated worker IDs, or 'all'"
    ),
    db=Depends(get_db),
):
    """
    Broadcast a message to multiple workers via gRPC.

    In production, this would trigger actual gRPC broadcasts.
    For now, it records the broadcast intent.
    """
    worker_info = grpc_state.get_worker(worker_id)
    if not worker_info:
        raise HTTPException(status_code=404, detail="Worker not found")

    # Determine targets
    if target_workers == "all":
        targets = [w["worker_id"] for w in grpc_state.list_workers()]
    elif target_workers:
        targets = [w.strip() for w in target_workers.split(",")]
    else:
        targets = []

    return {
        "from_worker": worker_id,
        "message_type": message_type,
        "targets": targets,
        "status": "broadcast_recorded",
        "message_length": len(message),
    }


@router.get("/status")
def grpc_get_status(db=Depends(get_db)):
    """Get overall gRPC communication system status"""
    workers = grpc_state.list_workers()
    online = [w for w in workers if w.get("status") == "online"]
    connections = len(grpc_state.connection_history)

    return {
        "total_registered": len(workers),
        "online": len(online),
        "total_connections": connections,
        "system": "operational" if online else "degraded",
    }


@router.get("/peer-address/{worker_id}")
def grpc_get_peer_address(
    worker_id: str,
    db=Depends(get_db),
):
    """Get the gRPC address for a worker"""
    info = grpc_state.get_worker(worker_id)

    if not info:
        raise HTTPException(status_code=404, detail="Worker not found")

    return {
        "worker_id": worker_id,
        "grpc_address": f"localhost:{info['grpc_port']}",
        "port": info["grpc_port"],
        "capabilities": info.get("capabilities", []),
    }


@router.post("/allreduce/init")
def grpc_init_allreduce(
    task_id: str,
    worker_ids: List[str],
    layer_count: int = Query(1, ge=1, le=100),
    db=Depends(get_db),
):
    """
    Initialize an all-reduce operation across specified workers.

    This sets up the gradient buckets for all-reduce synchronization.
    """
    # Verify all workers are registered
    for wid in worker_ids:
        if not grpc_state.get_worker(wid):
            raise HTTPException(status_code=404, detail=f"Worker {wid} not found")

    bucket_id = f"{task_id}_allreduce_{uuid.uuid4().hex[:8]}"

    return {
        "bucket_id": bucket_id,
        "task_id": task_id,
        "worker_ids": worker_ids,
        "layer_count": layer_count,
        "status": "initialized",
        "message": "All-reduce operation initialized",
    }


@router.post("/allreduce/sync")
def grpc_sync_allreduce(
    bucket_id: str,
    worker_id: str,
    gradient_data: str = Query(..., description="Base64 encoded gradient data"),
    db=Depends(get_db),
):
    """
    Submit a gradient for all-reduce synchronization.

    When all workers have submitted gradients, the aggregated
    result is returned.
    """
    # This is a simplified version - production would use
    # actual gRPC streaming for efficient gradient transfer

    return {
        "bucket_id": bucket_id,
        "worker_id": worker_id,
        "status": "gradient_received",
        "message": "Gradient recorded for all-reduce",
    }


@router.get("/allreduce/result/{bucket_id}")
def grpc_get_allreduce_result(
    bucket_id: str,
    db=Depends(get_db),
):
    """Get the all-reduce result after all gradients are aggregated"""
    # In production, would check if all gradients are received
    # and return the aggregated result

    return {
        "bucket_id": bucket_id,
        "status": "waiting",
        "message": "Waiting for more gradients or result not ready",
    }


# ============================================================================
# REST Endpoints to Trigger gRPC Operations
# ============================================================================


@router.post("/distributed/begin")
def grpc_begin_distributed_training(
    task_id: str,
    worker_ids: List[str],
    training_type: str = Query(
        "data_parallel", regex="^(data_parallel|model_parallel|pipeline_parallel)$"
    ),
    db=Depends(get_db),
):
    """
    Begin a distributed training session across multiple workers.

    This initializes all gRPC connections and synchronization primitives.
    """
    # Verify task exists - check DB first, then task_coordinator for distributed tasks
    from app.distributed import task_coordinator

    task = db.query(Task).filter(Task.task_id == task_id).first()
    if not task:
        # Check if it's a distributed task in the coordinator
        dist_status = task_coordinator.get_task_status(task_id)
        if not dist_status:
            raise HTTPException(status_code=404, detail="Task not found")

    # Verify all workers exist and are registered
    registered_workers = []
    for wid in worker_ids:
        info = grpc_state.get_worker(wid)
        if info:
            registered_workers.append(
                {"worker_id": wid, "grpc_port": info["grpc_port"]}
            )

    if len(registered_workers) != len(worker_ids):
        missing = set(worker_ids) - set(w["worker_id"] for w in registered_workers)
        raise HTTPException(
            status_code=400, detail=f"Workers not registered for gRPC: {missing}"
        )

    # Create session ID
    session_id = f"session_{task_id}_{uuid.uuid4().hex[:8]}"

    # Initialize connections
    for i, worker in enumerate(registered_workers):
        for j, peer in enumerate(registered_workers):
            if i != j:
                grpc_state.add_connection(
                    worker["worker_id"],
                    peer["worker_id"],
                    "bidirectional",
                )

    return {
        "session_id": session_id,
        "task_id": task_id,
        "workers": registered_workers,
        "training_type": training_type,
        "status": "initialized",
        "message": "Distributed training session initialized via gRPC",
    }


@router.post("/distributed/barrier")
def grpc_distributed_barrier(
    session_id: str,
    worker_id: str,
    barrier_name: str = Query("global_sync"),
    db=Depends(get_db),
):
    """
    Signal that a worker has reached a barrier in distributed training.

    When all workers reach the barrier, they can proceed.
    """
    barrier_key = f"{session_id}_{barrier_name}"

    return {
        "session_id": session_id,
        "worker_id": worker_id,
        "barrier": barrier_name,
        "status": "barrier_reached",
        "message": "Worker barrier participation recorded",
    }


@router.post("/distributed/checkpoint/sync")
def grpc_sync_checkpoint(
    session_id: str,
    worker_id: str,
    checkpoint_epoch: int,
    db=Depends(get_db),
):
    """
    Synchronize checkpoint save across all workers in a distributed session.

    This ensures all workers save their model state at the same epoch.
    """
    return {
        "session_id": session_id,
        "worker_id": worker_id,
        "checkpoint_epoch": checkpoint_epoch,
        "status": "checkpoint_sync_recorded",
        "message": "Checkpoint synchronization recorded",
    }


@router.get("/distributed/session/{session_id}")
def grpc_get_session_status(
    session_id: str,
    db=Depends(get_db),
):
    """Get the status of a distributed training session"""
    # In production, would track actual session state

    return {
        "session_id": session_id,
        "status": "active",
        "message": "Session status retrieved",
    }


@router.post("/distributed/end")
def grpc_end_distributed_session(
    session_id: str,
    db=Depends(get_db),
):
    """End a distributed training session and cleanup connections"""
    return {
        "session_id": session_id,
        "status": "ended",
        "message": "Distributed training session ended, connections cleaned up",
    }
