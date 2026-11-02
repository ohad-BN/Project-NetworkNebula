#!/usr/bin/env python3
"""
Project NetworkNebula — Intelligent Capacity-Aware Job Scheduler & Failover Dispatcher
======================================================================================
Automatically routes training and inference workloads to the optimal GPU worker node(s)
in the decentralized fleet based on:
1. Allocated VRAM Ceiling (`gpu_memory_gb * vram_allocation_pct / 100`) vs. required VRAM
2. Available VRAM Headroom (`allocated_vram_gb - vram_used_gb`)
3. Real-Time GPU Utilization & Heartbeat Freshness
4. Historical SLA Reputation (`total_tasks_completed`) & Cost Efficiency (`hourly_rate_usd`)
5. Transparent Mid-Task Failover Re-Routing when a worker disconnects or times out
"""

import json
import math
import socket
import time
import uuid
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

from sqlalchemy.orm import Session

from app.models import Worker, Task, TrainingJob

logger = logging.getLogger("cluster_scheduler")

def get_local_primary_node_id() -> str:
    safe_host = socket.gethostname().lower().replace(" ", "-").replace(".", "-")
    return f"node-{safe_host}"

LOCAL_PRIMARY_NODE_ID = get_local_primary_node_id()


class ClusterScheduler:
    """
    Singleton Capacity-Aware Job Scheduler & Automatic Failover Dispatcher.
    Scores candidate GPU nodes, enforces user-configured VRAM contribution ceilings,
    and transparently re-routes interrupted workloads to healthy standby nodes.
    """

    _instance: Optional["ClusterScheduler"] = None

    def __init__(self):
        self.total_dispatches: int = 0
        self.total_failovers_handled: int = 0
        self.dispatch_history: List[Dict[str, Any]] = []
        self.failover_history: List[Dict[str, Any]] = []

    @classmethod
    def get_instance(cls) -> "ClusterScheduler":
        if cls._instance is None:
            cls._instance = ClusterScheduler()
        return cls._instance

    def score_worker_node(
        self,
        worker: Worker,
        required_vram_gb: float = 2.0,
        task_type: str = "training",
        exclude_worker_ids: Optional[List[str]] = None,
        target_region: Optional[str] = None,
        enforce_region: Optional[str] = None,
        max_latency_rtt_ms: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Evaluate a Worker ORM record against task hardware requirements and compute
        a deterministic multi-factor scheduling score (0.0 - 100.0).
        Enforces geographic data sovereignty and low-latency (<15ms RTT) constraints.
        """
        excluded = set(exclude_worker_ids or [])
        total_vram_gb = round(float(worker.gpu_memory_gb or 8.0), 2)
        alloc_pct = int(worker.vram_allocation_pct if worker.vram_allocation_pct is not None else 80)
        allocated_vram_gb = round(total_vram_gb * (alloc_pct / 100.0), 2)
        used_vram_gb = round(float(worker.vram_used_gb or 0.0), 2)
        available_headroom_gb = round(max(0.0, allocated_vram_gb - used_vram_gb), 2)
        util_pct = round(float(worker.gpu_utilization_pct or 0.0), 1)
        tasks_done = int(worker.total_tasks_completed or 0)
        hourly_rate = round(float(worker.hourly_rate_usd or 0.45), 4)
        worker_region = (getattr(worker, "region", None) or "us-east").strip()
        worker_latency = round(float(getattr(worker, "latency_ping_ms", 15.0) or 15.0), 2)

        # Eligibility checks
        eligible = True
        disqualification_reason = None

        if worker.id in excluded:
            eligible = False
            disqualification_reason = "Explicitly excluded or failed over"
        elif not worker.is_available or (worker.status or "").lower() in ("offline", "failed", "maintenance"):
            eligible = False
            disqualification_reason = f"Node unavailable (status={worker.status}, is_available={worker.is_available})"
        elif allocated_vram_gb < required_vram_gb:
            eligible = False
            disqualification_reason = (
                f"Allocated VRAM ceiling ({allocated_vram_gb} GB at {alloc_pct}% limit) "
                f"is below task requirement ({required_vram_gb} GB)"
            )
        elif enforce_region and worker_region.lower() != enforce_region.strip().lower():
            eligible = False
            disqualification_reason = (
                f"Data sovereignty violation: worker region '{worker_region}' does not match "
                f"enforced sovereign region '{enforce_region}'"
            )
        elif max_latency_rtt_ms is not None and worker_latency > max_latency_rtt_ms:
            eligible = False
            disqualification_reason = (
                f"Latency ceiling exceeded: worker RTT {worker_latency}ms exceeds "
                f"maximum allowed threshold of {max_latency_rtt_ms}ms"
            )

        # Compute multi-factor score components (total 0 - 100 points)
        # 1. VRAM Headroom Score (0 - 35 points)
        headroom_ratio = available_headroom_gb / max(required_vram_gb, 0.5)
        vram_score = round(min(35.0, headroom_ratio * 14.0 + (alloc_pct / 100.0) * 10.0), 2)

        # 2. Load & Utilization Score (0 - 20 points)
        load_score = round(20.0 * (1.0 - min(util_pct, 100.0) / 100.0), 2)

        # 3. SLA Reputation & Reliability Score (0 - 15 points)
        rep_score = round(min(12.0, math.log1p(tasks_done) * 3.5), 2)
        if worker.id == LOCAL_PRIMARY_NODE_ID:
            rep_score = round(min(15.0, rep_score + 3.0), 2)

        # 4. Cost Efficiency Score (0 - 10 points)
        cost_score = round(max(1.0, 10.0 - hourly_rate * 5.0), 2)

        # 5. Regional & Latency Proximity Score (0 - 20 points)
        latency_component = round(10.0 * max(0.0, 1.0 - min(worker_latency, 100.0) / 100.0), 2)
        if target_region:
            region_match = 10.0 if worker_region.lower() == target_region.strip().lower() else 2.0
        else:
            region_match = 10.0
        latency_topology_score = round(latency_component + region_match, 2)

        total_score = (
            round(vram_score + load_score + rep_score + cost_score + latency_topology_score, 2)
            if eligible
            else 0.0
        )

        return {
            "worker_id": worker.id,
            "name": worker.name,
            "gpu_model": worker.gpu_info or "NVIDIA CUDA GPU",
            "status": worker.status or "online",
            "is_available": bool(worker.is_available),
            "region": worker_region,
            "latency_ping_ms": worker_latency,
            "eligible": eligible,
            "disqualification_reason": disqualification_reason,
            "total_vram_gb": total_vram_gb,
            "vram_allocation_pct": alloc_pct,
            "allocated_vram_gb": allocated_vram_gb,
            "vram_used_gb": used_vram_gb,
            "available_headroom_gb": available_headroom_gb,
            "required_vram_gb": required_vram_gb,
            "gpu_utilization_pct": util_pct,
            "total_tasks_completed": tasks_done,
            "hourly_rate_usd": hourly_rate,
            "score": total_score,
            "score_breakdown": {
                "vram_headroom_score": vram_score,
                "load_score": load_score,
                "sla_reputation_score": rep_score,
                "cost_efficiency_score": cost_score,
                "latency_topology_score": latency_topology_score,
            },
        }

    def select_optimal_workers(
        self,
        db: Session,
        required_vram_gb: float = 2.0,
        num_gpus: int = 1,
        task_type: str = "training",
        exclude_worker_ids: Optional[List[str]] = None,
        target_region: Optional[str] = None,
        enforce_region: Optional[str] = None,
        max_latency_ms: Optional[float] = None,
        topology_aware: bool = False,
        record_dispatch: bool = True,
    ) -> Dict[str, Any]:
        """
        Rank all registered worker nodes and select the top `num_gpus` eligible candidates,
        taking into account geographic region constraints and low-latency sub-networks.
        """
        try:
            from app.cluster_worker_router import sync_primary_local_worker
            sync_primary_local_worker(db)
        except Exception:
            pass

        effective_max_latency = max_latency_ms
        if topology_aware and effective_max_latency is None:
            effective_max_latency = 15.0

        all_workers = db.query(Worker).all()
        evaluated = [
            self.score_worker_node(
                w,
                required_vram_gb=required_vram_gb,
                task_type=task_type,
                exclude_worker_ids=exclude_worker_ids,
                target_region=target_region,
                enforce_region=enforce_region,
                max_latency_rtt_ms=effective_max_latency,
            )
            for w in all_workers
        ]

        eligible_candidates = sorted(
            [c for c in evaluated if c["eligible"]],
            key=lambda x: (x["score"], x["available_headroom_gb"], -x["latency_ping_ms"], x["total_tasks_completed"]),
            reverse=True,
        )
        disqualified_nodes = [c for c in evaluated if not c["eligible"]]

        selected = eligible_candidates[: max(1, num_gpus)]
        selected_ids = [c["worker_id"] for c in selected]

        avg_cluster_latency = (
            round(sum(c["latency_ping_ms"] for c in selected) / len(selected), 2)
            if selected
            else 0.0
        )

        dispatch_record = {
            "dispatch_id": f"dsp-{uuid.uuid4().hex[:8]}",
            "task_type": task_type,
            "required_vram_gb": required_vram_gb,
            "requested_gpus": num_gpus,
            "selected_worker_ids": selected_ids,
            "top_candidate": selected[0] if selected else None,
            "eligible_count": len(eligible_candidates),
            "disqualified_count": len(disqualified_nodes),
            "target_region": target_region,
            "enforce_region": enforce_region,
            "max_latency_ms": effective_max_latency,
            "avg_cluster_latency_ms": avg_cluster_latency,
            "topology_aware": topology_aware or (effective_max_latency is not None),
            "timestamp": datetime.utcnow().isoformat(),
        }

        if record_dispatch and selected_ids:
            self.total_dispatches += 1
            self.dispatch_history.append(dispatch_record)
            if len(self.dispatch_history) > 50:
                self.dispatch_history = self.dispatch_history[-50:]

        return {
            **dispatch_record,
            "selected_workers": selected,
            "ranked_candidates": eligible_candidates,
            "disqualified_nodes": disqualified_nodes,
        }

    def trigger_task_failover(
        self,
        db: Session,
        task_id: str,
        failed_worker_id: str,
        required_vram_gb: float = 2.0,
        task_type: str = "training",
        reason: str = "worker_heartbeat_timeout",
    ) -> Dict[str, Any]:
        """
        Handle mid-task worker disconnection or heartbeat timeout by:
        1. Marking `failed_worker_id` offline/unavailable
        2. Selecting the highest-scoring healthy standby worker node
        3. Re-binding the active Task or TrainingJob to the standby worker node
        """
        failed_worker = db.query(Worker).filter(Worker.id == failed_worker_id).first()
        if failed_worker:
            failed_worker.status = "offline"
            failed_worker.is_available = False
            if failed_worker.current_task_id == task_id:
                failed_worker.current_task_id = None
            db.commit()

        # Select next best healthy candidate excluding the failed worker
        selection = self.select_optimal_workers(
            db=db,
            required_vram_gb=required_vram_gb,
            num_gpus=1,
            task_type=task_type,
            exclude_worker_ids=[failed_worker_id],
            record_dispatch=True,
        )
        standby_workers = selection.get("selected_workers", [])
        new_worker_id = standby_workers[0]["worker_id"] if standby_workers else LOCAL_PRIMARY_NODE_ID

        # Update Task or TrainingJob record if present in DB
        rebound_entity = None
        task_obj = db.query(Task).filter(Task.task_id == task_id).first()
        if task_obj:
            task_obj.claimed_by = new_worker_id
            rebound_entity = "task"
            db.commit()

        job_obj = db.query(TrainingJob).filter(TrainingJob.id == task_id).first()
        if job_obj:
            try:
                hp = json.loads(job_obj.hyperparameters) if job_obj.hyperparameters else {}
            except Exception:
                hp = {}
            w_list = hp.get("worker_ids", [])
            if failed_worker_id in w_list:
                w_list = [new_worker_id if w == failed_worker_id else w for w in w_list]
            else:
                w_list = [new_worker_id]
            hp["worker_ids"] = w_list
            hp["failover_recovered"] = True
            hp["failed_worker_id"] = failed_worker_id
            job_obj.hyperparameters = json.dumps(hp)
            rebound_entity = "training_job"
            db.commit()

        new_worker = db.query(Worker).filter(Worker.id == new_worker_id).first()
        if new_worker:
            new_worker.current_task_id = task_id
            db.commit()

        failover_event = {
            "failover_id": f"fo-{uuid.uuid4().hex[:8]}",
            "task_id": task_id,
            "failed_worker_id": failed_worker_id,
            "replacement_worker_id": new_worker_id,
            "replacement_score": standby_workers[0]["score"] if standby_workers else 0.0,
            "reason": reason,
            "rebound_entity": rebound_entity or "virtual_task",
            "status": "rerouted",
            "timestamp": datetime.utcnow().isoformat(),
        }

        self.total_failovers_handled += 1
        self.failover_history.append(failover_event)
        if len(self.failover_history) > 50:
            self.failover_history = self.failover_history[-50:]

        logger.info(
            f"[SCHEDULER] Failover completed for task {task_id}: "
            f"{failed_worker_id} -> {new_worker_id} (reason={reason})"
        )
        return failover_event

    def detect_and_failover_stale_workers(
        self,
        db: Session,
        timeout_seconds: int = 120,
    ) -> List[Dict[str, Any]]:
        """
        Scan online workers with an active `current_task_id` whose `last_heartbeat`
        is older than `timeout_seconds` and automatically trigger failover re-routing.
        """
        cutoff = datetime.utcnow() - timedelta(seconds=timeout_seconds)
        stale_workers = (
            db.query(Worker)
            .filter(
                Worker.id != LOCAL_PRIMARY_NODE_ID,
                Worker.status.in_(["online", "busy", "active"]),
                Worker.current_task_id.isnot(None),
                Worker.last_heartbeat < cutoff,
            )
            .all()
        )

        events = []
        for sw in stale_workers:
            ev = self.trigger_task_failover(
                db=db,
                task_id=sw.current_task_id,
                failed_worker_id=sw.id,
                reason=f"heartbeat_timeout_exceeded_{timeout_seconds}s",
            )
            events.append(ev)
        return events

    def form_low_latency_cluster(
        self,
        db: Session,
        num_gpus: int = 2,
        max_rtt_ms: float = 15.0,
        target_region: Optional[str] = None,
        enforce_region: Optional[str] = None,
        required_vram_gb: float = 2.0,
    ) -> Dict[str, Any]:
        """
        Form an optimal, tightly coupled sub-network cluster (<15ms RTT) for Ring All-Reduce
        distributed training, strictly honoring geographic data sovereignty if enforce_region is set.
        """
        selection = self.select_optimal_workers(
            db=db,
            required_vram_gb=required_vram_gb,
            num_gpus=num_gpus,
            task_type="distributed_training",
            target_region=target_region or enforce_region,
            enforce_region=enforce_region,
            max_latency_ms=max_rtt_ms,
            topology_aware=True,
            record_dispatch=True,
        )

        selected = selection.get("selected_workers", [])
        cluster_id = f"topo-cluster-{uuid.uuid4().hex[:8]}"

        if len(selected) < num_gpus:
            return {
                "cluster_id": cluster_id,
                "status": "insufficient_capacity",
                "message": (
                    f"Only {len(selected)} nodes meet low-latency threshold (<= {max_rtt_ms}ms) "
                    f"and sovereignty criteria (enforce_region={enforce_region}). Requested {num_gpus}."
                ),
                "requested_gpus": num_gpus,
                "available_compliant_gpus": len(selected),
                "selected_worker_ids": [c["worker_id"] for c in selected],
                "selected_workers": selected,
                "disqualified_nodes": selection.get("disqualified_nodes", []),
                "ring_allreduce_ready": False,
                "timestamp": datetime.utcnow().isoformat(),
            }

        latencies = [c["latency_ping_ms"] for c in selected]
        regions = [c["region"] for c in selected]
        primary_region = max(set(regions), key=regions.count) if regions else "us-east"
        avg_rtt = round(sum(latencies) / len(latencies), 2)
        max_rtt = round(max(latencies), 2)

        return {
            "cluster_id": cluster_id,
            "status": "ready",
            "primary_region": primary_region,
            "sovereign_compliant": bool(enforce_region),
            "enforce_region": enforce_region,
            "max_rtt_threshold_ms": max_rtt_ms,
            "cluster_avg_rtt_ms": avg_rtt,
            "cluster_max_rtt_ms": max_rtt,
            "ring_allreduce_ready": max_rtt <= max_rtt_ms,
            "total_nodes": len(selected),
            "selected_worker_ids": [c["worker_id"] for c in selected],
            "selected_workers": selected,
            "timestamp": datetime.utcnow().isoformat(),
        }

    def get_regional_breakdown(self, db: Session) -> Dict[str, Any]:
        """
        Aggregate fleet capacity, average latency, and sovereign compliance readiness
        across all geographic regions (e.g., us-east, us-west, eu-central, ap-southeast).
        """
        workers = db.query(Worker).all()
        STANDARD_REGIONS = ["us-east", "us-west", "eu-central", "ap-southeast"]
        regional_data: Dict[str, Dict[str, Any]] = {
            r: {
                "region": r,
                "total_nodes": 0,
                "online_nodes": 0,
                "total_vram_gb": 0.0,
                "allocated_vram_gb": 0.0,
                "avg_latency_ms": 0.0,
                "sub_15ms_nodes": 0,
                "sovereign_ready": False,
                "workers": [],
            }
            for r in STANDARD_REGIONS
        }

        latencies_by_region: Dict[str, List[float]] = {r: [] for r in STANDARD_REGIONS}

        for w in workers:
            w_reg = (getattr(w, "region", None) or "us-east").strip()
            if w_reg not in regional_data:
                regional_data[w_reg] = {
                    "region": w_reg,
                    "total_nodes": 0,
                    "online_nodes": 0,
                    "total_vram_gb": 0.0,
                    "allocated_vram_gb": 0.0,
                    "avg_latency_ms": 0.0,
                    "sub_15ms_nodes": 0,
                    "sovereign_ready": False,
                    "workers": [],
                }
                latencies_by_region[w_reg] = []

            rg = regional_data[w_reg]
            rg["total_nodes"] += 1
            if w.is_available and (w.status or "").lower() == "online":
                rg["online_nodes"] += 1

            total_vram = round(float(w.gpu_memory_gb or 8.0), 2)
            alloc_pct = int(w.vram_allocation_pct or 80)
            alloc_vram = round(total_vram * (alloc_pct / 100.0), 2)
            latency = round(float(getattr(w, "latency_ping_ms", 15.0) or 15.0), 2)

            rg["total_vram_gb"] = round(rg["total_vram_gb"] + total_vram, 2)
            rg["allocated_vram_gb"] = round(rg["allocated_vram_gb"] + alloc_vram, 2)
            latencies_by_region[w_reg].append(latency)
            if latency <= 15.0:
                rg["sub_15ms_nodes"] += 1

            rg["workers"].append({
                "worker_id": w.id,
                "name": w.name,
                "status": w.status,
                "latency_ping_ms": latency,
                "vram_total_gb": total_vram,
            })

        for r_name, r_dict in regional_data.items():
            l_list = latencies_by_region.get(r_name, [])
            r_dict["avg_latency_ms"] = round(sum(l_list) / len(l_list), 2) if l_list else 15.0
            r_dict["sovereign_ready"] = r_dict["online_nodes"] >= 1

        return {
            "status": "ok",
            "total_regions": len(regional_data),
            "regions": list(regional_data.values()),
            "timestamp": datetime.utcnow().isoformat(),
        }

    def get_scheduler_status(self, db: Session) -> Dict[str, Any]:
        """Return live scheduler telemetry, candidate ranking, and failover history."""
        ranking = self.select_optimal_workers(
            db=db,
            required_vram_gb=2.0,
            num_gpus=1,
            task_type="inspection",
            record_dispatch=False,
        )
        regional = self.get_regional_breakdown(db)
        return {
            "status": "active",
            "policy": "capacity_aware_topology_sovereign_v1",
            "total_dispatches": self.total_dispatches,
            "total_failovers_handled": self.total_failovers_handled,
            "eligible_workers_count": ranking["eligible_count"],
            "disqualified_workers_count": ranking["disqualified_count"],
            "top_recommended_worker": ranking["top_candidate"],
            "regional_summary": regional["regions"],
            "ranked_candidates": ranking["ranked_candidates"][:15],
            "recent_dispatches": self.dispatch_history[-10:],
            "failover_history": self.failover_history[-10:],
        }


# Global singleton instance
cluster_scheduler = ClusterScheduler.get_instance()
