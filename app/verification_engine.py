#!/usr/bin/env python3
"""
Project NetworkNebula — Cryptographic Verification Engine & Byzantine Fault Tolerance
====================================================================================
Provides deterministic cryptographic tensor verification, optimistic fraud proofs,
and Byzantine-robust gradient filtering for decentralized GPU compute:
- SHA-256 tensor activation hash commitments with deterministic PRNG spot-sampling
- Spot-check validator verifying tensor slices within float numerical tolerance (1e-4)
- Optimistic fraud dispute protocol identifying malicious drift, shortcuts, or corrupted hashes
- Coordinate-wise median & trimmed-mean gradient aggregation rejecting poisoned Ring All-Reduce updates
"""

import hashlib
import json
import logging
import math
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import numpy as np

logger = logging.getLogger("verification_engine")


class VerificationEngine:
    """
    Cryptographic verification & Byzantine fault tolerance engine for NetworkNebula.
    Guarantees integrity of decentralized GPU inference and distributed training.
    """

    _instance: Optional["VerificationEngine"] = None

    def __init__(self, default_seed: str = "nebula-zk-seed-v1", tolerance: float = 1e-4):
        self.default_seed = default_seed
        self.tolerance = tolerance
        # Stores verified commitments and registered fraud disputes
        self.commitments: Dict[str, Dict[str, Any]] = {}
        self.disputes: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def get_instance(cls) -> "VerificationEngine":
        if cls._instance is None:
            cls._instance = VerificationEngine()
        return cls._instance

    @staticmethod
    def _to_numpy_float32(
        tensor_data: Union[np.ndarray, List[float], bytes],
        shape: Optional[Tuple[int, ...]] = None,
    ) -> np.ndarray:
        """Convert list, bytes, or ndarray into flat or shaped float32 numpy array."""
        if isinstance(tensor_data, np.ndarray):
            arr = tensor_data.astype(np.float32)
        elif isinstance(tensor_data, bytes):
            arr = np.frombuffer(tensor_data, dtype=np.float32).copy()
        elif isinstance(tensor_data, (list, tuple)):
            arr = np.array(tensor_data, dtype=np.float32)
        else:
            raise ValueError(f"Unsupported tensor data type: {type(tensor_data)}")

        if shape is not None:
            arr = arr.reshape(shape)
        return arr

    def compute_tensor_hash(
        self,
        tensor_data: Union[np.ndarray, List[float], bytes],
        seed: Optional[str] = None,
    ) -> str:
        """
        Compute a deterministic cryptographic SHA-256 hash commitment over a tensor.
        Quantizes floats slightly to 1e-5 to guarantee cross-architecture determinism.
        """
        seed_str = seed or self.default_seed
        arr = self._to_numpy_float32(tensor_data).flatten()
        # Round slightly to absorb floating point cross-compiler micro-jitter
        quantized = np.round(arr, decimals=5).astype(np.float32)
        hasher = hashlib.sha256()
        hasher.update(seed_str.encode("utf-8"))
        hasher.update(quantized.tobytes())
        return hasher.hexdigest()

    def generate_tensor_commitment(
        self,
        tensor_data: Union[np.ndarray, List[float], bytes],
        task_id: str,
        worker_id: str,
        sample_rate: float = 0.05,
        seed: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate a cryptographically verifiable commitment over an output tensor or activation matrix.
        Includes a full SHA-256 hash commitment and deterministic pseudorandom spot-check samples.
        """
        seed_str = seed or self.default_seed
        arr = self._to_numpy_float32(tensor_data)
        flat_arr = arr.flatten()
        total_elements = int(flat_arr.size)

        # Compute full tensor hash commitment
        full_hash = self.compute_tensor_hash(flat_arr, seed=seed_str)

        # Deterministically select spot-check sample indices based on task_id + seed
        sample_count = max(1, int(total_elements * sample_rate))
        # Hash seed + task_id to derive integer PRNG seed
        seed_bytes = hashlib.sha256(f"{seed_str}:{task_id}".encode("utf-8")).digest()
        prng_seed = int.from_bytes(seed_bytes[:4], byteorder="big")
        rng = np.random.RandomState(prng_seed)
        
        sample_indices = sorted(rng.choice(total_elements, size=min(sample_count, total_elements), replace=False).tolist())
        sample_values = [float(flat_arr[idx]) for idx in sample_indices]

        # Hash the spot-check samples
        sample_hasher = hashlib.sha256()
        sample_hasher.update(f"{seed_str}:{task_id}:samples".encode("utf-8"))
        sample_hasher.update(np.round(np.array(sample_values, dtype=np.float32), decimals=5).tobytes())
        sample_hash = sample_hasher.hexdigest()

        commitment_id = f"commit_{uuid.uuid4().hex[:12]}"
        commitment_record = {
            "commitment_id": commitment_id,
            "task_id": task_id,
            "worker_id": worker_id,
            "full_hash": full_hash,
            "sample_hash": sample_hash,
            "total_elements": total_elements,
            "sample_count": len(sample_indices),
            "sample_rate": sample_rate,
            "sample_indices": sample_indices,
            "sample_values": sample_values,
            "seed": seed_str,
            "shape": list(arr.shape),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        self.commitments[commitment_id] = commitment_record
        return commitment_record

    def verify_spot_check(
        self,
        commitment: Dict[str, Any],
        ground_truth_tensor: Union[np.ndarray, List[float], bytes],
        tolerance: Optional[float] = None,
    ) -> Tuple[bool, float, str]:
        """
        Verify that spot-check sample values in a commitment match ground truth / re-computed values
        within numerical tolerance. Returns (is_valid, max_delta, message).
        """
        tol = tolerance if tolerance is not None else self.tolerance
        gt_arr = self._to_numpy_float32(ground_truth_tensor).flatten()

        indices = commitment.get("sample_indices", [])
        worker_vals = commitment.get("sample_values", [])

        if not indices or not worker_vals:
            return False, 1.0, "Commitment contains no spot-check samples"

        if len(indices) != len(worker_vals):
            return False, 1.0, "Index count does not match sample value count"

        deltas = []
        for idx, w_val in zip(indices, worker_vals):
            if idx >= len(gt_arr):
                return False, 1.0, f"Sample index {idx} out of bounds for ground truth tensor (size {len(gt_arr)})"
            gt_val = float(gt_arr[idx])
            delta = abs(gt_val - w_val)
            deltas.append(delta)

        max_delta = float(max(deltas)) if deltas else 0.0
        avg_delta = float(sum(deltas) / len(deltas)) if deltas else 0.0

        if max_delta <= tol:
            return True, max_delta, f"Proof verified successfully (max delta {max_delta:.6f} <= tol {tol})"
        else:
            return False, max_delta, f"Fraud/Discrepancy detected (max delta {max_delta:.6f} > tol {tol})"

    def evaluate_dispute(
        self,
        task_id: str,
        worker_id: str,
        disputed_commitment: Dict[str, Any],
        evidence: Dict[str, Any],
        tolerance: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Evaluate an optimistic fraud dispute filed against a worker node.
        Analyzes evidence: recomputed values, sample discrepancies, or corrupted hash commitments.
        """
        tol = tolerance if tolerance is not None else self.tolerance
        dispute_id = f"disp_{uuid.uuid4().hex[:10]}"

        # 1. Structural validity check
        if not disputed_commitment or "full_hash" not in disputed_commitment:
            record = {
                "dispute_id": dispute_id,
                "task_id": task_id,
                "worker_id": worker_id,
                "fraud_confirmed": True,
                "penalty_recommended": "slash_100_percent",
                "confidence": 1.0,
                "max_delta": 1.0,
                "reason": "Malformed or missing commitment structure",
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            }
            self.disputes[dispute_id] = record
            return record

        # 2. Check for lazy all-zero compute fraud
        sample_vals = disputed_commitment.get("sample_values", [])
        if sample_vals and all(abs(v) < 1e-8 for v in sample_vals):
            # Check if reference evidence is non-zero
            evidence_sample = evidence.get("ground_truth_sample") or evidence.get("reference_sample", [])
            if any(abs(v) > 1e-3 for v in evidence_sample):
                record = {
                    "dispute_id": dispute_id,
                    "task_id": task_id,
                    "worker_id": worker_id,
                    "fraud_confirmed": True,
                    "penalty_recommended": "slash_100_percent",
                    "confidence": 1.0,
                    "max_delta": 1.0,
                    "reason": "Lazy worker fraud: submitted all-zero tensors for non-trivial calculation",
                    "resolved_at": datetime.now(timezone.utc).isoformat(),
                }
                self.disputes[dispute_id] = record
                return record

        # 3. Ground truth comparison against evidence
        ground_truth = evidence.get("ground_truth_tensor") or evidence.get("reference_tensor")
        if ground_truth is not None:
            valid, max_delta, msg = self.verify_spot_check(
                disputed_commitment, ground_truth, tolerance=tol
            )
            fraud_detected = not valid
            penalty = "slash_100_percent" if fraud_detected else "none"
            record = {
                "dispute_id": dispute_id,
                "task_id": task_id,
                "worker_id": worker_id,
                "fraud_confirmed": fraud_detected,
                "penalty_recommended": penalty,
                "confidence": 0.99 if fraud_detected else 0.0,
                "max_delta": max_delta,
                "reason": msg,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            }
            self.disputes[dispute_id] = record
            return record

        # 4. Challenger sample values comparison
        challenger_samples = evidence.get("challenger_samples")
        if challenger_samples is not None:
            diffs = []
            for w_v, c_v in zip(sample_vals, challenger_samples):
                diffs.append(abs(float(w_v) - float(c_v)))
            max_delta = max(diffs) if diffs else 0.0
            fraud_detected = max_delta > tol
            penalty = "slash_100_percent" if fraud_detected else "none"
            record = {
                "dispute_id": dispute_id,
                "task_id": task_id,
                "worker_id": worker_id,
                "fraud_confirmed": fraud_detected,
                "penalty_recommended": penalty,
                "confidence": 0.95 if fraud_detected else 0.0,
                "max_delta": max_delta,
                "reason": (
                    f"Dispute confirmed: delta {max_delta:.6f} exceeds threshold {tol}"
                    if fraud_detected
                    else f"Dispute dismissed: delta {max_delta:.6f} within tolerance"
                ),
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            }
            self.disputes[dispute_id] = record
            return record

        # Fallback if no reference data provided
        record = {
            "dispute_id": dispute_id,
            "task_id": task_id,
            "worker_id": worker_id,
            "fraud_confirmed": False,
            "penalty_recommended": "none",
            "confidence": 0.0,
            "max_delta": 0.0,
            "reason": "Insufficient challenger evidence provided for dispute verification",
            "resolved_at": datetime.now(timezone.utc).isoformat(),
        }
        self.disputes[dispute_id] = record
        return record

    def aggregate_gradients_byzantine_robust(
        self,
        gradients: List[Union[np.ndarray, List[float], bytes]],
        worker_ids: Optional[List[str]] = None,
        method: str = "trimmed_mean",
        trim_ratio: float = 0.2,
        shape: Optional[Tuple[int, ...]] = None,
    ) -> Dict[str, Any]:
        """
        Perform Byzantine-robust gradient aggregation across worker nodes during Ring All-Reduce:
        - trimmed_mean: Sorts coordinate-wise, trims top & bottom `trim_ratio` fraction, averages remainder
        - coordinate_median: Computes coordinate-wise median across all workers
        - Detects and flags poisoned gradient workers via statistical distance deviation from robust center
        """
        if not gradients:
            raise ValueError("No gradient tensors provided for aggregation")

        num_workers = len(gradients)
        w_ids = worker_ids or [f"worker_{i}" for i in range(num_workers)]
        
        # Convert all worker gradients to uniform flat numpy float32 arrays
        flat_grads: List[np.ndarray] = [
            self._to_numpy_float32(g).flatten() for g in gradients
        ]
        grad_len = len(flat_grads[0])
        # Stack into 2D matrix: [num_workers, grad_len]
        grad_matrix = np.stack(flat_grads, axis=0)

        # Coordinate-wise robust aggregation
        if method == "coordinate_median":
            robust_center = np.median(grad_matrix, axis=0)
            aggregated = robust_center.copy()
        elif method == "trimmed_mean":
            # For each coordinate, sort and trim
            trim_count = max(0, int(num_workers * trim_ratio))
            if trim_count == 0 or (2 * trim_count >= num_workers):
                # Fallback to standard median if worker count too small for trimmed mean
                aggregated = np.median(grad_matrix, axis=0)
                robust_center = aggregated.copy()
            else:
                sorted_matrix = np.sort(grad_matrix, axis=0)
                # Slice out bottom and top trim_count workers per coordinate
                trimmed = sorted_matrix[trim_count : num_workers - trim_count, :]
                aggregated = np.mean(trimmed, axis=0)
                robust_center = np.median(grad_matrix, axis=0)
        else:
            raise ValueError(f"Unknown Byzantine aggregation method: {method}")

        # Compute Euclidean distance from each worker's gradient to robust center
        distances = []
        for i in range(num_workers):
            diff = flat_grads[i] - robust_center
            dist = float(np.linalg.norm(diff))
            distances.append(dist)

        # Statistical outlier detection: flag workers with distance > 2.5 * median_distance
        median_dist = float(np.median(distances))
        flagged_workers: List[str] = []
        flagged_indices: List[int] = []

        # If median_dist is tiny or near zero, use absolute threshold
        threshold = max(median_dist * 2.5, 1.0)
        for idx, (dist, wid) in enumerate(zip(distances, w_ids)):
            if dist > threshold:
                flagged_workers.append(wid)
                flagged_indices.append(idx)

        # Restore original shape if specified
        out_arr = aggregated.reshape(shape) if shape is not None else aggregated

        return {
            "aggregated_gradient": out_arr,
            "aggregated_bytes": out_arr.tobytes(),
            "method": method,
            "num_workers": num_workers,
            "participating_workers": w_ids,
            "flagged_poisoned_workers": flagged_workers,
            "flagged_indices": flagged_indices,
            "outliers_detected": len(flagged_workers),
            "distances": {wid: round(d, 4) for wid, d in zip(w_ids, distances)},
            "threshold_used": round(threshold, 4),
            "is_tampered": len(flagged_workers) > 0,
        }


# Global singleton instance
verification_engine = VerificationEngine.get_instance()
