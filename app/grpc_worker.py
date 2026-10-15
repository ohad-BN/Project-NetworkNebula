"""
Network Nebula - Phase 9: Worker-to-Worker gRPC Communication

Implements:
- gRPC service for direct worker-to-worker communication
- Worker-to-worker RPC calls (activation, gradient, weight sync)
- gRPC server/client for distributed training coordination
- NCCL-free all-reduce simulation via gRPC

Dependencies:
    pip install grpcio grpcio-tools

Usage:
    # Start gRPC server on worker
    python -m app.grpc_worker --mode server --port 50051

    # Run worker client
    python -m app.grpc_worker --mode client --server localhost:50051
"""

import asyncio
import json
import struct
import time
import uuid
from concurrent import futures
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

import grpc

# ============================================================================
# gRPC Protocol Buffers (compiled form)
# ============================================================================

# Proto definition string (would normally be compiled with grpcio-tools)
PROTO_DEFINITION = """
syntax = "proto3";

package nebula;

service WorkerComm {
    rpc SendActivation(Activation) returns (Ack);
    rpc SendGradient(Gradient) returns (Ack);
    rpc SyncWeights(WeightUpdate) returns (SyncResponse);
    rpc Barrier(BarrierRequest) returns (BarrierResponse);
    rpc Heartbeat(HeartbeatRequest) returns (HeartbeatResponse);
}

message Activation {
    string task_id = 1;
    int32 worker_id = 2;
    bytes tensor_data = 3;
    bool is_last_layer = 4;
    int32 layer_index = 5;
}

message Gradient {
    string task_id = 1;
    int32 worker_id = 2;
    bytes grad_data = 3;
    bool is_first_layer = 4;
    int32 layer_index = 5;
}

message WeightUpdate {
    string task_id = 1;
    int32 worker_id = 2;
    bytes weight_data = 3;
    int32 version = 4;
}

message Ack {
    bool success = 1;
    string message = 2;
}

message SyncResponse {
    bool success = 1;
    bytes aggregated_data = 2;
    int32 version = 3;
}

message BarrierRequest {
    string group_id = 1;
    string worker_id = 2;
    string barrier_id = 3;
}

message BarrierResponse {
    bool success = 1;
    bool can_proceed = 2;
    int32 waiting_count = 3;
}

message HeartbeatRequest {
    string worker_id = 1;
    string task_id = 2;
    float gpu_utilization = 3;
    float gpu_memory_used = 4;
}

message HeartbeatResponse {
    bool ok = 1;
    string instructions = 2;
}
"""


# ============================================================================
# Enums and Data Classes
# ============================================================================


class MessageType(str, Enum):
    ACTIVATION = "activation"
    GRADIENT = "gradient"
    WEIGHT = "weight"
    BARRIER = "barrier"
    HEARTBEAT = "heartbeat"


@dataclass
class WorkerPeer:
    """Represents a connected worker peer"""

    peer_id: str
    address: str
    port: int
    is_connected: bool = False
    last_heartbeat: float = 0.0
    capabilities: List[str] = field(default_factory=list)
    gpu_info: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GRPCMessage:
    """Wrapper for gRPC messages"""

    task_id: str
    worker_id: str
    message_type: MessageType
    data: bytes
    timestamp: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)


# ============================================================================
# Communication State
# ============================================================================


class CommunicationState:
    """Manages worker-to-worker communication state"""

    def __init__(self):
        self.peers: Dict[str, WorkerPeer] = {}
        self.pending_activations: Dict[str, List[GRPCMessage]] = {}
        self.pending_gradients: Dict[str, List[GRPCMessage]] = {}
        self.weight_versions: Dict[str, int] = {}
        self.barrier_state: Dict[str, Dict] = {}
        self._lock = asyncio.Lock()

    async def add_peer(self, peer: WorkerPeer):
        async with self._lock:
            self.peers[peer.peer_id] = peer

    async def remove_peer(self, peer_id: str):
        async with self._lock:
            if peer_id in self.peers:
                del self.peers[peer_id]

    async def get_peer(self, peer_id: str) -> Optional[WorkerPeer]:
        return self.peers.get(peer_id)

    async def get_all_peers(self) -> List[WorkerPeer]:
        return list(self.peers.values())

    async def store_activation(self, task_id: str, message: GRPCMessage):
        async with self._lock:
            if task_id not in self.pending_activations:
                self.pending_activations[task_id] = []
            self.pending_activations[task_id].append(message)

    async def get_activations(self, task_id: str) -> List[GRPCMessage]:
        async with self._lock:
            return self.pending_activations.get(task_id, [])

    async def clear_activations(self, task_id: str):
        async with self._lock:
            if task_id in self.pending_activations:
                del self.pending_activations[task_id]

    async def store_gradient(self, task_id: str, message: GRPCMessage):
        async with self._lock:
            if task_id not in self.pending_gradients:
                self.pending_gradients[task_id] = []
            self.pending_gradients[task_id].append(message)

    async def get_gradients(self, task_id: str) -> List[GRPCMessage]:
        async with self._lock:
            return self.pending_gradients.get(task_id, [])

    async def clear_gradients(self, task_id: str):
        async with self._lock:
            if task_id in self.pending_gradients:
                del self.pending_gradients[task_id]


# ============================================================================
# AllReduce Implementation
# ============================================================================


class AllReduceOperation(str, Enum):
    SUM = "sum"
    MEAN = "mean"
    MIN = "min"
    MAX = "max"
    PRODUCT = "product"


class AllReduceEngine:
    """
    AllReduce engine using gRPC for gradient synchronization.

    This simulates what NCCL would do for GPU-native all-reduce,
    but uses gRPC for portability across machines.
    """

    def __init__(self):
        self.gradient_buckets: Dict[str, Dict] = {}
        self._lock = asyncio.Lock()

    async def add_gradient(
        self, bucket_id: str, worker_id: str, gradient_data: bytes, num_workers: int
    ) -> Optional[bytes]:
        """
        Add a gradient to the bucket.
        Returns aggregated gradient when all workers have contributed.
        """
        async with self._lock:
            if bucket_id not in self.gradient_buckets:
                self.gradient_buckets[bucket_id] = {
                    "gradients": [],
                    "worker_ids": set(),
                    "ready": False,
                    "aggregated": None,
                }

            bucket = self.gradient_buckets[bucket_id]

            if worker_id in bucket["worker_ids"]:
                return None  # Already contributed

            bucket["gradients"].append(gradient_data)
            bucket["worker_ids"].add(worker_id)

            # Check if all workers have contributed
            if len(bucket["worker_ids"]) >= num_workers:
                bucket["ready"] = True
                bucket["aggregated"] = self._reduce(
                    bucket["gradients"], AllReduceOperation.MEAN
                )
                return bucket["aggregated"]

            return None

    def _reduce(self, gradients: List[bytes], operation: AllReduceOperation) -> bytes:
        """Perform reduction operation on gradients"""
        import numpy as np

        arrays = []
        for g in gradients:
            try:
                arr = np.frombuffer(g, dtype=np.float32)
                arrays.append(arr)
            except Exception:
                # Fallback: concatenate as bytes
                return gradients[0]

        if not arrays:
            return gradients[0] if gradients else b""

        # Stack and reduce
        stacked = np.stack(arrays, axis=0)

        if operation == AllReduceOperation.SUM:
            result = np.sum(stacked, axis=0)
        elif operation == AllReduceOperation.MEAN:
            result = np.mean(stacked, axis=0)
        elif operation == AllReduceOperation.MIN:
            result = np.min(stacked, axis=0)
        elif operation == AllReduceOperation.MAX:
            result = np.max(stacked, axis=0)
        else:
            result = np.mean(stacked, axis=0)

        return result.astype(np.float32).tobytes()

    async def reset_bucket(self, bucket_id: str):
        async with self._lock:
            if bucket_id in self.gradient_buckets:
                del self.gradient_buckets[bucket_id]

    async def is_ready(self, bucket_id: str) -> bool:
        bucket = self.gradient_buckets.get(bucket_id)
        return bucket["ready"] if bucket else False

    async def get_aggregated(self, bucket_id: str) -> Optional[bytes]:
        bucket = self.gradient_buckets.get(bucket_id)
        return bucket["aggregated"] if bucket and bucket["ready"] else None


# ============================================================================
# gRPC Message Serialization Helpers
# ============================================================================


def encode_tensor(data: Any) -> bytes:
    """Encode numpy array or list to bytes"""
    import numpy as np

    if isinstance(data, np.ndarray):
        return data.astype(np.float32).tobytes()
    elif isinstance(data, list):
        arr = np.array(data, dtype=np.float32)
        return arr.tobytes()
    elif isinstance(data, bytes):
        return data
    else:
        return json.dumps(data).encode()


def decode_tensor(data: bytes, shape: tuple = None) -> Any:
    """Decode bytes to numpy array"""
    import numpy as np

    arr = np.frombuffer(data, dtype=np.float32)
    if shape:
        arr = arr.reshape(shape)
    return arr


def encode_dict(d: Dict) -> bytes:
    """Encode dictionary to JSON bytes"""
    return json.dumps(d).encode()


def decode_dict(data: bytes) -> Dict:
    """Decode JSON bytes to dictionary"""
    return json.loads(data.decode())


# ============================================================================
# Callback System
# ============================================================================


class CallbackManager:
    """Manages callbacks for async events"""

    def __init__(self):
        self.callbacks: Dict[str, List[Callable]] = {
            "on_activation": [],
            "on_gradient": [],
            "on_weight_update": [],
            "on_barrier": [],
            "on_heartbeat": [],
            "on_peer_connected": [],
            "on_peer_disconnected": [],
        }

    def register(self, event: str, callback: Callable):
        if event in self.callbacks:
            self.callbacks[event].append(callback)

    def unregister(self, event: str, callback: Callable):
        if event in self.callbacks and callback in self.callbacks[event]:
            self.callbacks[event].remove(callback)

    async def trigger(self, event: str, *args, **kwargs):
        if event in self.callbacks:
            for callback in self.callbacks[event]:
                try:
                    if asyncio.iscoroutinefunction(callback):
                        await callback(*args, **kwargs)
                    else:
                        callback(*args, **kwargs)
                except Exception as e:
                    print(f"[gRPC Callback Error] {event}: {e}")


# ============================================================================
# gRPC Client
# ============================================================================


class WorkerGRPCClient:
    """
    gRPC client for worker-to-worker communication.

    Usage:
        client = WorkerGRPCClient("worker-1", "localhost:50051")
        await client.connect()
        await client.send_gradient(task_id, gradient_data)
        await client.disconnect()
    """

    def __init__(self, worker_id: str, server_address: str, insecure: bool = True):
        self.worker_id = worker_id
        self.server_address = server_address
        self.insecure = insecure
        self.channel = None
        self.stub = None
        self.is_connected = False
        self.callbacks = CallbackManager()

    async def connect(self, timeout: float = 10.0) -> bool:
        """Connect to gRPC server"""
        try:
            if self.insecure:
                self.channel = grpc.aio.insecure_channel(self.server_address)
            else:
                credentials = grpc.ssl_channel_credentials()
                self.channel = grpc.aio.secure_channel(self.server_address, credentials)

            # Wait for channel to be ready
            await grpc.channel_ready_future(self.channel)

            # Create stub (would be generated from proto in production)
            self.stub = WorkerCommStub(self.channel)
            self.is_connected = True
            print(f"[gRPC Client] Connected to {self.server_address}")
            return True

        except Exception as e:
            print(f"[gRPC Client] Failed to connect: {e}")
            self.is_connected = False
            return False

    async def disconnect(self):
        """Disconnect from gRPC server"""
        if self.channel:
            await self.channel.close()
        self.is_connected = False
        print(f"[gRPC Client] Disconnected from {self.server_address}")

    async def send_activation(
        self,
        task_id: str,
        tensor_data: bytes,
        layer_index: int = 0,
        is_last_layer: bool = False,
    ) -> bool:
        """Send activation to next worker in pipeline"""
        if not self.is_connected:
            return False

        try:
            request = Activation(
                task_id=task_id,
                worker_id=self.worker_id,
                tensor_data=tensor_data,
                layer_index=layer_index,
                is_last_layer=is_last_layer,
            )
            response = await self.stub.SendActivation(request)
            return response.success
        except Exception as e:
            print(f"[gRPC Client] SendActivation failed: {e}")
            return False

    async def send_gradient(
        self,
        task_id: str,
        grad_data: bytes,
        layer_index: int = 0,
        is_first_layer: bool = False,
    ) -> bool:
        """Send gradient to previous worker for all-reduce"""
        if not self.is_connected:
            return False

        try:
            request = Gradient(
                task_id=task_id,
                worker_id=self.worker_id,
                grad_data=grad_data,
                layer_index=layer_index,
                is_first_layer=is_first_layer,
            )
            response = await self.stub.SendGradient(request)
            return response.success
        except Exception as e:
            print(f"[gRPC Client] SendGradient failed: {e}")
            return False

    async def sync_weights(
        self, task_id: str, weight_data: bytes, version: int = 1
    ) -> Optional[bytes]:
        """Sync model weights with all workers"""
        if not self.is_connected:
            return None

        try:
            request = WeightUpdate(
                task_id=task_id,
                worker_id=self.worker_id,
                weight_data=weight_data,
                version=version,
            )
            response = await self.stub.SyncWeights(request)
            if response.success:
                return response.aggregated_data
            return None
        except Exception as e:
            print(f"[gRPC Client] SyncWeights failed: {e}")
            return None

    async def barrier(self, group_id: str, barrier_id: str) -> tuple:
        """Synchronize at barrier point"""
        if not self.is_connected:
            return False, 0

        try:
            request = BarrierRequest(
                group_id=group_id, worker_id=self.worker_id, barrier_id=barrier_id
            )
            response = await self.stub.Barrier(request)
            return response.can_proceed, response.waiting_count
        except Exception as e:
            print(f"[gRPC Client] Barrier failed: {e}")
            return False, 0

    async def heartbeat(
        self,
        task_id: str = None,
        gpu_utilization: float = 0.0,
        gpu_memory_used: float = 0.0,
    ) -> bool:
        """Send heartbeat to coordinator"""
        if not self.is_connected:
            return False

        try:
            request = HeartbeatRequest(
                worker_id=self.worker_id,
                task_id=task_id or "",
                gpu_utilization=gpu_utilization,
                gpu_memory_used=gpu_memory_used,
            )
            response = await self.stub.Heartbeat(request)
            return response.ok
        except Exception as e:
            print(f"[gRPC Client] Heartbeat failed: {e}")
            return False


# ============================================================================
# gRPC Server
# ============================================================================


class WorkerGRPCServer:
    """
    gRPC server for worker-to-worker communication.

    Usage:
        server = WorkerGRPCServer("worker-1", 50051)
        await server.start()
        # ... handle requests ...
        await server.stop()
    """

    def __init__(
        self,
        worker_id: str,
        port: int,
        state: CommunicationState = None,
        allreduce: AllReduceEngine = None,
    ):
        self.worker_id = worker_id
        self.port = port
        self.state = state or CommunicationState()
        self.allreduce = allreduce or AllReduceEngine()
        self.callbacks = CallbackManager()
        self.server = None
        self.is_running = False
        self.num_workers = 2  # Default for all-reduce

    def set_num_workers(self, num: int):
        self.num_workers = num

    async def start(self):
        """Start the gRPC server"""
        self.server = grpc.aio.server()

        # Add service
        servicer = WorkerCommServicer(
            worker_id=self.worker_id,
            state=self.state,
            allreduce=self.allreduce,
            callbacks=self.callbacks,
        )
        WorkerCommServicer.add_to_server(servicer, self.server)

        # Bind to port
        listen_addr = f"[::]:{self.port}"
        self.server.add_insecure_port(listen_addr)

        await self.server.start()
        self.is_running = True
        print(f"[gRPC Server] Worker {self.worker_id} listening on port {self.port}")

    async def stop(self):
        """Stop the gRPC server"""
        if self.server:
            await self.server.stop(grace=5)
        self.is_running = False
        print(f"[gRPC Server] Worker {self.worker_id} stopped")

    async def wait_for_termination(self):
        """Wait for server to terminate"""
        if self.server:
            await self.server.wait_for_termination()


# ============================================================================
# gRPC Servicer (implements the service)
# ============================================================================


class WorkerCommServicer:
    """
    Implementation of WorkerComm gRPC service.

    This class handles all RPC requests from other workers.
    """

    # Store servicer instances for add_to_server
    _servicers = []

    def __init__(
        self,
        worker_id: str,
        state: CommunicationState,
        allreduce: AllReduceEngine,
        callbacks: CallbackManager,
    ):
        self.worker_id = worker_id
        self.state = state
        self.allreduce = allreduce
        self.callbacks = callbacks
        WorkerCommServicer._servicers.append(self)

    @classmethod
    def add_to_server(cls, servicer, server):
        """Add servicer to server - simplified without generated stubs"""
        pass  # In production, this would be generated by grpcio-tools

    async def SendActivation(self, request, context):
        """Handle incoming activation from previous pipeline stage"""
        try:
            message = GRPCMessage(
                task_id=request.task_id,
                worker_id=request.worker_id,
                message_type=MessageType.ACTIVATION,
                data=request.tensor_data,
                metadata={
                    "layer_index": request.layer_index,
                    "is_last": request.is_last_layer,
                },
            )

            await self.state.store_activation(request.task_id, message)
            await self.callbacks.trigger("on_activation", message)

            return Ack(success=True, message="Activation received")
        except Exception as e:
            return Ack(success=False, message=str(e))

    async def SendGradient(self, request, context):
        """Handle incoming gradient for all-reduce"""
        try:
            message = GRPCMessage(
                task_id=request.task_id,
                worker_id=request.worker_id,
                message_type=MessageType.GRADIENT,
                data=request.grad_data,
                metadata={
                    "layer_index": request.layer_index,
                    "is_first": request.is_first_layer,
                },
            )

            # Add to all-reduce
            bucket_id = f"{request.task_id}_layer_{request.layer_index}"
            result = await self.allreduce.add_gradient(
                bucket_id=bucket_id,
                worker_id=request.worker_id,
                gradient_data=request.grad_data,
                num_workers=self.state.get_num_workers(),
            )

            await self.state.store_gradient(request.task_id, message)
            await self.callbacks.trigger("on_gradient", message, result)

            return Ack(success=True, message="Gradient received")
        except Exception as e:
            return Ack(success=False, message=str(e))

    async def SyncWeights(self, request, context):
        """Handle weight synchronization request"""
        try:
            # Update weight version
            self.state.weight_versions[request.task_id] = max(
                self.state.weight_versions.get(request.task_id, 0), request.version
            )

            await self.callbacks.trigger("on_weight_update", request)

            # In production, would broadcast to all workers
            return SyncResponse(
                success=True,
                aggregated_data=request.weight_data,
                version=request.version,
            )
        except Exception as e:
            return SyncResponse(success=False, version=0)

    async def Barrier(self, request, context):
        """Handle barrier synchronization"""
        try:
            barrier_key = f"{request.group_id}_{request.barrier_id}"

            if barrier_key not in self.state.barrier_state:
                self.state.barrier_state[barrier_key] = {
                    "workers": set(),
                    "total": self.state.get_num_workers(),
                }

            barrier = self.state.barrier_state[barrier_key]
            barrier["workers"].add(request.worker_id)

            can_proceed = len(barrier["workers"]) >= barrier["total"]
            waiting = len(barrier["workers"])

            await self.callbacks.trigger("on_barrier", barrier_key, can_proceed)

            return BarrierResponse(
                success=True, can_proceed=can_proceed, waiting_count=waiting
            )
        except Exception as e:
            return BarrierResponse(success=False, can_proceed=False, waiting_count=0)

    async def Heartbeat(self, request, context):
        """Handle heartbeat from worker"""
        try:
            # Update peer heartbeat
            peer = await self.state.get_peer(request.worker_id)
            if peer:
                peer.last_heartbeat = time.time()

            await self.callbacks.trigger("on_heartbeat", request)

            return HeartbeatResponse(ok=True, instructions="")
        except Exception as e:
            return HeartbeatResponse(ok=False, instructions=str(e))


# ============================================================================
# Simplified Stub Classes (without protobuf generation)
# ============================================================================


class Ack:
    def __init__(self, success: bool, message: str):
        self.success = success
        self.message = message


class Activation:
    def __init__(
        self,
        task_id: str,
        worker_id: str,
        tensor_data: bytes,
        layer_index: int,
        is_last_layer: bool,
    ):
        self.task_id = task_id
        self.worker_id = worker_id
        self.tensor_data = tensor_data
        self.layer_index = layer_index
        self.is_last_layer = is_last_layer


class Gradient:
    def __init__(
        self,
        task_id: str,
        worker_id: str,
        grad_data: bytes,
        layer_index: int,
        is_first_layer: bool,
    ):
        self.task_id = task_id
        self.worker_id = worker_id
        self.grad_data = grad_data
        self.layer_index = layer_index
        self.is_first_layer = is_first_layer


class WeightUpdate:
    def __init__(self, task_id: str, worker_id: str, weight_data: bytes, version: int):
        self.task_id = task_id
        self.worker_id = worker_id
        self.weight_data = weight_data
        self.version = version


class SyncResponse:
    def __init__(self, success: bool, aggregated_data: bytes = None, version: int = 0):
        self.success = success
        self.aggregated_data = aggregated_data
        self.version = version


class BarrierRequest:
    def __init__(self, group_id: str, worker_id: str, barrier_id: str):
        self.group_id = group_id
        self.worker_id = worker_id
        self.barrier_id = barrier_id


class BarrierResponse:
    def __init__(self, success: bool, can_proceed: bool, waiting_count: int):
        self.success = success
        self.can_proceed = can_proceed
        self.waiting_count = waiting_count


class HeartbeatRequest:
    def __init__(
        self,
        worker_id: str,
        task_id: str,
        gpu_utilization: float,
        gpu_memory_used: float,
    ):
        self.worker_id = worker_id
        self.task_id = task_id
        self.gpu_utilization = gpu_utilization
        self.gpu_memory_used = gpu_memory_used


class HeartbeatResponse:
    def __init__(self, ok: bool, instructions: str):
        self.ok = ok
        self.instructions = instructions


class WorkerCommStub:
    """Simplified stub for WorkerComm service"""

    def __init__(self, channel):
        self.channel = channel


# ============================================================================
# Communication Manager
# ============================================================================


class WorkerCommManager:
    """
    High-level manager for worker-to-worker communication.

    Coordinates multiple gRPC connections and provides
    a simple interface for distributed training.

    Usage:
        manager = WorkerCommManager("worker-1", 50051)
        await manager.start()

        # Connect to other workers
        await manager.connect_to_peer("worker-2", "localhost:50052")

        # Send data
        await manager.send_gradient("task-1", gradient_bytes)

        # Synchronize
        await manager.barrier("group-1", "sync-1")

        await manager.stop()
    """

    def __init__(self, worker_id: str, port: int = 50051):
        self.worker_id = worker_id
        self.port = port
        self.server = WorkerGRPCServer(worker_id, port)
        self.client = None  # For single-peer connections
        self.peers: Dict[str, WorkerGRPCClient] = {}
        self.allreduce = AllReduceEngine()
        self.state = CommunicationState()
        self.callbacks = CallbackManager()
        self.is_running = False

    async def start(self):
        """Start the communication manager"""
        await self.server.start()
        self.is_running = True
        print(f"[CommManager] Worker {self.worker_id} started on port {self.port}")

    async def stop(self):
        """Stop the communication manager"""
        # Disconnect all peers
        for peer_id in list(self.peers.keys()):
            await self.disconnect_peer(peer_id)

        await self.server.stop()
        self.is_running = False
        print(f"[CommManager] Worker {self.worker_id} stopped")

    async def connect_to_peer(
        self, peer_id: str, address: str, port: int = None
    ) -> bool:
        """Connect to another worker"""
        if port:
            address = f"{address}:{port}"

        client = WorkerGRPCClient(self.worker_id, address)
        success = await client.connect()

        if success:
            self.peers[peer_id] = client
            await self.state.add_peer(
                WorkerPeer(peer_id=peer_id, address=address, port=port or 50051)
            )
            await self.callbacks.trigger("on_peer_connected", peer_id)
            print(f"[CommManager] Connected to peer {peer_id} at {address}")
            return True

        return False

    async def disconnect_peer(self, peer_id: str):
        """Disconnect from a peer"""
        if peer_id in self.peers:
            await self.peers[peer_id].disconnect()
            del self.peers[peer_id]
            await self.state.remove_peer(peer_id)
            await self.callbacks.trigger("on_peer_disconnected", peer_id)

    async def broadcast_gradient(
        self, task_id: str, grad_data: bytes, layer_index: int = 0
    ) -> Dict[str, bool]:
        """Broadcast gradient to all peers for all-reduce"""
        results = {}
        for peer_id, client in self.peers.items():
            success = await client.send_gradient(task_id, grad_data, layer_index)
            results[peer_id] = success
        return results

    async def send_activation(
        self,
        peer_id: str,
        task_id: str,
        activation_data: bytes,
        layer_index: int = 0,
        is_last: bool = False,
    ) -> bool:
        """Send activation to a specific peer"""
        if peer_id not in self.peers:
            return False
        return await self.peers[peer_id].send_activation(
            task_id, activation_data, layer_index, is_last
        )

    async def barrier(
        self, group_id: str, barrier_id: str, peer_ids: List[str] = None
    ) -> bool:
        """Synchronize at barrier with specified peers"""
        if peer_ids is None:
            peer_ids = list(self.peers.keys())

        # All peers must call barrier
        results = []
        for peer_id in peer_ids:
            if peer_id in self.peers:
                can_proceed, waiting = await self.peers[peer_id].barrier(
                    group_id, barrier_id
                )
                results.append(can_proceed)

        # Local barrier
        barrier_key = f"{group_id}_{barrier_id}"
        if barrier_key not in self.state.barrier_state:
            self.state.barrier_state[barrier_key] = {
                "workers": set(),
                "total": len(peer_ids),
            }

        barrier = self.state.barrier_state[barrier_key]
        barrier["workers"].add(self.worker_id)

        can_proceed = len(barrier["workers"]) >= barrier["total"]

        return all(results) and can_proceed

    async def allreduce_gradient(
        self, task_id: str, grad_data: bytes, layer_index: int = 0
    ) -> Optional[bytes]:
        """Perform all-reduce on gradient across all workers"""
        bucket_id = f"{task_id}_layer_{layer_index}"

        # Add local gradient
        result = await self.allreduce.add_gradient(
            bucket_id=bucket_id,
            worker_id=self.worker_id,
            gradient_data=grad_data,
            num_workers=len(self.peers) + 1,  # Include self
        )

        if result:
            return result

        # If not ready, need to wait for peers
        # In production, would use async waiting
        return None

    def set_num_workers(self, num: int):
        """Set number of workers for all-reduce"""
        self.allreduce = AllReduceEngine()
        self.server.num_workers = num

    def on(self, event: str, callback: Callable):
        """Register event callback"""
        self.callbacks.register(event, callback)

    def off(self, event: str, callback: Callable):
        """Unregister event callback"""
        self.callbacks.unregister(event, callback)


# ============================================================================
# Main Entry Point
# ============================================================================


async def main():
    """Main entry point for gRPC worker"""
    import argparse

    parser = argparse.ArgumentParser(description="Network Nebula gRPC Worker")
    parser.add_argument("--mode", choices=["server", "client", "both"], default="both")
    parser.add_argument("--worker-id", default="worker-1")
    parser.add_argument("--port", type=int, default=50051)
    parser.add_argument("--server", default="localhost:50051")
    args = parser.parse_args()

    manager = WorkerCommManager(args.worker_id, args.port)

    if args.mode in ["server", "both"]:
        await manager.start()

    if args.mode in ["client", "both"]:
        # Connect to specified server
        if args.mode == "client":
            await manager.connect_to_peer("server", args.server)

    # Keep running
    if args.mode in ["server", "both"]:
        print(f"[Main] gRPC worker running. Press Ctrl+C to stop.")
        try:
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            print("[Main] Shutting down...")

    await manager.stop()


if __name__ == "__main__":
    asyncio.run(main())
