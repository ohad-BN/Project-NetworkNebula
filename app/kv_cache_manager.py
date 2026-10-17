#!/usr/bin/env python3
"""
Project NetworkNebula — Distributed Attention KV-Cache Manager
==============================================================
Maintains stateful attention Key-Value (KV) caches across decentralized
transformer pipeline stages to enable ultra-low latency token-by-token
continuous auto-regressive generation without recomputing prompt history.
Supports LRU eviction, dynamic memory bounds, and multi-tenant session isolation.
"""

import collections
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("kv_cache_manager")


class StageKVSlice:
    """
    Holds the cached Key and Value activation tensors for a single pipeline stage's
    assigned layer block [start_layer, end_layer] in a specific inference session.
    """

    def __init__(
        self,
        session_id: str,
        stage_idx: int,
        start_layer: int,
        end_layer: int,
        num_layers: int,
        num_heads: int = 64,
        head_dim: int = 128,
    ):
        self.session_id = session_id
        self.stage_idx = stage_idx
        self.start_layer = start_layer
        self.end_layer = end_layer
        self.num_layers = num_layers
        self.num_heads = num_heads
        self.head_dim = head_dim

        # Attention KV caches: shape (num_layers, batch_size=1, num_heads, seq_len, head_dim)
        self.keys: Optional[np.ndarray] = None
        self.values: Optional[np.ndarray] = None
        self.seq_len: int = 0
        self.created_at: float = time.time()
        self.last_accessed: float = time.time()
        self.access_count: int = 0

    @property
    def byte_size(self) -> int:
        """Calculate total memory in bytes consumed by this stage's KV tensors."""
        k_bytes = self.keys.nbytes if self.keys is not None else 0
        v_bytes = self.values.nbytes if self.values is not None else 0
        return k_bytes + v_bytes

    def initialize_kv(self, seq_len: int, seed: int = 42) -> Tuple[np.ndarray, np.ndarray]:
        """
        Initializes prefill KV state for all layers in this stage:
        Shape: (num_layers, 1, num_heads, seq_len, head_dim)
        """
        np.random.seed(seed + self.stage_idx * 31)
        self.keys = (
            np.random.randn(self.num_layers, 1, self.num_heads, seq_len, self.head_dim).astype(np.float32) * 0.05
        )
        self.values = (
            np.random.randn(self.num_layers, 1, self.num_heads, seq_len, self.head_dim).astype(np.float32) * 0.05
        )
        self.seq_len = seq_len
        self.last_accessed = time.time()
        self.access_count += 1
        return self.keys, self.values

    def append_token(self, new_k: Optional[np.ndarray] = None, new_v: Optional[np.ndarray] = None) -> Tuple[np.ndarray, np.ndarray]:
        """
        Appends a single new token's Key and Value to the existing cache:
        Expands seq_len from T -> T + 1.
        """
        self.last_accessed = time.time()
        self.access_count += 1

        if self.keys is None or self.values is None or self.seq_len == 0:
            # If empty, initialize single token
            return self.initialize_kv(seq_len=1)

        if new_k is None or new_v is None:
            np.random.seed(int(time.time() * 1000) % 65535)
            new_k = (
                np.random.randn(self.num_layers, 1, self.num_heads, 1, self.head_dim).astype(np.float32) * 0.05
            )
            new_v = (
                np.random.randn(self.num_layers, 1, self.num_heads, 1, self.head_dim).astype(np.float32) * 0.05
            )

        # Concatenate along seq_len dimension (axis=3)
        self.keys = np.concatenate([self.keys, new_k], axis=3)
        self.values = np.concatenate([self.values, new_v], axis=3)
        self.seq_len += 1

        return self.keys, self.values

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage_idx": self.stage_idx,
            "start_layer": self.start_layer,
            "end_layer": self.end_layer,
            "num_layers": self.num_layers,
            "seq_len": self.seq_len,
            "memory_bytes": self.byte_size,
            "memory_kb": round(self.byte_size / 1024, 2),
            "access_count": self.access_count,
            "last_accessed": datetime.fromtimestamp(self.last_accessed, tz=timezone.utc).isoformat(),
        }


class SessionKVCache:
    """Encapsulates all stage KV slices belonging to a specific inference session."""

    def __init__(
        self,
        session_id: str,
        model_id: str,
        hidden_dim: int = 8192,
        num_heads: int = 64,
        head_dim: int = 128,
    ):
        self.session_id = session_id
        self.model_id = model_id
        self.hidden_dim = hidden_dim
        self.num_heads = num_heads
        self.head_dim = head_dim

        self.stages: Dict[int, StageKVSlice] = {}
        self.seq_len: int = 0
        self.created_at: float = time.time()
        self.last_accessed: float = time.time()
        self.steps_completed: int = 0

    @property
    def total_memory_bytes(self) -> int:
        return sum(s.byte_size for s in self.stages.values())

    def get_or_create_stage(
        self,
        stage_idx: int,
        start_layer: int,
        end_layer: int,
    ) -> StageKVSlice:
        self.last_accessed = time.time()
        if stage_idx not in self.stages:
            num_layers = end_layer - start_layer + 1
            self.stages[stage_idx] = StageKVSlice(
                session_id=self.session_id,
                stage_idx=stage_idx,
                start_layer=start_layer,
                end_layer=end_layer,
                num_layers=num_layers,
                num_heads=self.num_heads,
                head_dim=self.head_dim,
            )
        return self.stages[stage_idx]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "model_id": self.model_id,
            "seq_len": self.seq_len,
            "steps_completed": self.steps_completed,
            "total_memory_bytes": self.total_memory_bytes,
            "total_memory_mb": round(self.total_memory_bytes / (1024 * 1024), 3),
            "num_stages_cached": len(self.stages),
            "stages": [s.to_dict() for s in self.stages.values()],
            "created_at": datetime.fromtimestamp(self.created_at, tz=timezone.utc).isoformat(),
            "last_accessed": datetime.fromtimestamp(self.last_accessed, tz=timezone.utc).isoformat(),
        }


class KVCacheManager:
    """
    Thread-safe Centralized & Distributed KV-Cache Manager.
    Controls attention memory allocations across multi-node pipelines,
    enforcing LRU eviction policies and global memory ceilings.
    """

    _instance: Optional["KVCacheManager"] = None
    _singleton_lock = threading.Lock()

    def __init__(self, max_memory_mb: float = 2048.0, max_sessions: int = 128, ttl_seconds: int = 1800):
        self.max_memory_mb = max_memory_mb
        self.max_sessions = max_sessions
        self.ttl_seconds = ttl_seconds

        self._lock = threading.Lock()
        # LRU ordered mapping: session_id -> SessionKVCache
        self._sessions: collections.OrderedDict[str, SessionKVCache] = collections.OrderedDict()

        # Telemetry counters
        self._cache_hits: int = 0
        self._cache_misses: int = 0
        self._eviction_count: int = 0
        self._total_tokens_cached: int = 0

    @classmethod
    def get_instance(cls) -> "KVCacheManager":
        if cls._instance is None:
            with cls._singleton_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @property
    def total_memory_bytes(self) -> int:
        with self._lock:
            return sum(sess.total_memory_bytes for sess in self._sessions.values())

    @property
    def total_memory_mb(self) -> float:
        return round(self.total_memory_bytes / (1024 * 1024), 3)

    def get_or_create_session(
        self,
        session_id: str,
        model_id: str = "meta-llama/Llama-3-70B",
        hidden_dim: int = 8192,
        num_heads: int = 64,
        head_dim: int = 128,
    ) -> SessionKVCache:
        with self._lock:
            if session_id in self._sessions:
                sess = self._sessions[session_id]
                sess.last_accessed = time.time()
                self._sessions.move_to_end(session_id)
                self._cache_hits += 1
                return sess

            self._cache_misses += 1

            # Check if memory or session limits reached, perform LRU eviction
            self._ensure_capacity_locked()

            sess = SessionKVCache(
                session_id=session_id,
                model_id=model_id,
                hidden_dim=hidden_dim,
                num_heads=num_heads,
                head_dim=head_dim,
            )
            self._sessions[session_id] = sess
            return sess

    def get_session(self, session_id: str) -> Optional[SessionKVCache]:
        with self._lock:
            if session_id in self._sessions:
                sess = self._sessions[session_id]
                sess.last_accessed = time.time()
                self._sessions.move_to_end(session_id)
                self._cache_hits += 1
                return sess
            self._cache_misses += 1
            return None

    def has_session(self, session_id: str) -> bool:
        with self._lock:
            return session_id in self._sessions

    def store_stage_kv(
        self,
        session_id: str,
        stage_idx: int,
        start_layer: int,
        end_layer: int,
        seq_len: int,
    ) -> StageKVSlice:
        """Stores or initializes prefill KV tensors for a specific stage."""
        with self._lock:
            if session_id not in self._sessions:
                sess = SessionKVCache(session_id=session_id, model_id="meta-llama/Llama-3-70B")
                self._sessions[session_id] = sess
            else:
                sess = self._sessions[session_id]
                self._sessions.move_to_end(session_id)

            stage_slice = sess.get_or_create_stage(stage_idx, start_layer, end_layer)
            stage_slice.initialize_kv(seq_len=seq_len)
            sess.seq_len = max(sess.seq_len, seq_len)
            sess.last_accessed = time.time()
            self._total_tokens_cached += seq_len
            return stage_slice

    def append_stage_token(
        self,
        session_id: str,
        stage_idx: int,
        start_layer: int,
        end_layer: int,
    ) -> StageKVSlice:
        """Extends attention KV tensors by 1 token in the decode phase."""
        with self._lock:
            if session_id not in self._sessions:
                sess = SessionKVCache(session_id=session_id, model_id="meta-llama/Llama-3-70B")
                self._sessions[session_id] = sess
            else:
                sess = self._sessions[session_id]
                self._sessions.move_to_end(session_id)

            stage_slice = sess.get_or_create_stage(stage_idx, start_layer, end_layer)
            stage_slice.append_token()
            sess.seq_len = max(sess.seq_len, stage_slice.seq_len)
            sess.last_accessed = time.time()
            self._total_tokens_cached += 1
            return stage_slice

    def evict_session(self, session_id: str) -> bool:
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                self._eviction_count += 1
                return True
            return False

    def clear_all(self):
        with self._lock:
            self._sessions.clear()

    def _ensure_capacity_locked(self):
        """Enforces max_sessions and max_memory_mb via LRU eviction."""
        # 1. Evict expired TTL sessions
        now = time.time()
        expired_keys = [
            sid for sid, sess in self._sessions.items()
            if (now - sess.last_accessed) > self.ttl_seconds
        ]
        for sid in expired_keys:
            del self._sessions[sid]
            self._eviction_count += 1

        # 2. Evict oldest if exceeding session count
        while len(self._sessions) >= self.max_sessions and self._sessions:
            oldest_key, _ = self._sessions.popitem(last=False)
            self._eviction_count += 1

        # 3. Evict oldest if exceeding memory ceiling
        current_mb = sum(s.total_memory_bytes for s in self._sessions.values()) / (1024 * 1024)
        while current_mb > self.max_memory_mb and self._sessions:
            oldest_key, _ = self._sessions.popitem(last=False)
            self._eviction_count += 1
            current_mb = sum(s.total_memory_bytes for s in self._sessions.values()) / (1024 * 1024)

    def get_stats(self) -> Dict[str, Any]:
        """Provides telemetry for enterprise observability dashboards and audit tests."""
        with self._lock:
            total_sessions = len(self._sessions)
            total_mem_bytes = sum(s.total_memory_bytes for s in self._sessions.values())
            total_mem_mb = round(total_mem_bytes / (1024 * 1024), 3)
            total_tokens = sum(s.seq_len for s in self._sessions.values())
            total_lookups = self._cache_hits + self._cache_misses
            hit_ratio = round((self._cache_hits / total_lookups) * 100, 2) if total_lookups > 0 else 100.0

            sessions_summary = [
                {
                    "session_id": sid,
                    "model_id": sess.model_id,
                    "seq_len": sess.seq_len,
                    "stages": len(sess.stages),
                    "memory_kb": round(sess.total_memory_bytes / 1024, 2),
                    "steps": sess.steps_completed,
                }
                for sid, sess in list(self._sessions.items())[-10:]
            ]

            return {
                "active_sessions": total_sessions,
                "total_cached_tokens": total_tokens,
                "total_memory_mb": total_mem_mb,
                "max_memory_mb": self.max_memory_mb,
                "memory_utilization_pct": round((total_mem_mb / max(1.0, self.max_memory_mb)) * 100, 2),
                "cache_hits": self._cache_hits,
                "cache_misses": self._cache_misses,
                "hit_ratio_pct": hit_ratio,
                "eviction_count": self._eviction_count,
                "recent_sessions": sessions_summary,
            }


# Global singleton instance
kv_cache_manager = KVCacheManager.get_instance()
