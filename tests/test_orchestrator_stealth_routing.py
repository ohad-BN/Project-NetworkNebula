"""
Project NetworkNebula - Phase 4 Integration Tests
Orchestrator Fleet Management & Capacity-Aware Adaptive Scheduling

Validates:
- TC-028: DB Schema persistence of stealth fields (is_always_silent, work_capacity_state, etc.)
- TC-029: Worker Heartbeat Telemetry Ingestion & Serialization
- TC-030: Worker Config Patching (always_silent toggle)
- TC-031: Capacity-Aware Scheduler: Straggler Exclusion from Synchronous Distributed Training
- TC-032: Asynchronous Micro-Task & Inference Routing to Stealth Regulated Nodes
- TC-033: Gaming Mode Complete Disqualification from All Tasks
- TC-034: Dynamic SLA Verification Timeout Scaling (60s stealth vs 15s unleashed)
- TC-035: Cluster Monitor Snapshot Fleet Capacity Counts
- TC-036: Mid-Run Adaptive Failover on Stealth Transition
"""

import sys
import os
import time
import uuid
import unittest
from datetime import datetime, timezone

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app.database import engine, SessionLocal
from app.models import Worker, Task, TaskStatus, TrainingJob, ComputeSlice
from app.scheduler import ClusterScheduler
from app.cluster_worker_router import serialize_worker_node


class TestOrchestratorStealthRouting(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.scheduler = ClusterScheduler()
        cls.test_worker_ids = [
            f"test-w1-unleashed-{uuid.uuid4().hex[:6]}",
            f"test-w2-stealth-{uuid.uuid4().hex[:6]}",
            f"test-w3-gaming-{uuid.uuid4().hex[:6]}",
            f"test-w4-standby-{uuid.uuid4().hex[:6]}",
        ]

    @classmethod
    def tearDownClass(cls):
        try:
            for wid in cls.test_worker_ids:
                cls.db.query(Task).filter(Task.claimed_by == wid).delete(synchronize_session=False)
                cls.db.query(Worker).filter(Worker.id == wid).delete(synchronize_session=False)
            cls.db.commit()
        except Exception:
            cls.db.rollback()
        finally:
            cls.db.close()

    def setUp(self):
        # Clean up any lingering records for these specific test IDs
        for wid in self.test_worker_ids:
            self.db.query(Task).filter(Task.claimed_by == wid).delete(synchronize_session=False)
            self.db.query(Worker).filter(Worker.id == wid).delete(synchronize_session=False)
        self.db.commit()

    def test_tc028_schema_columns_persistence(self):
        """TC-028: Verify stealth schema columns exist and persist on Worker ORM."""
        wid = self.test_worker_ids[0]
        w = Worker(
            id=wid,
            name="SkorP Test Worker",
            gpu_info="NVIDIA RTX 4070",
            gpu_memory_gb=8.0,
            vram_allocation_pct=80,
            status="online",
            is_available=True,
            is_always_silent=True,
            work_capacity_state="stealth_regulated",
            input_idle_sec=12.5,
            gpu_temp_c=58.2,
            duty_cycle_pct=33,
        )
        self.db.add(w)
        self.db.commit()
        self.db.refresh(w)

        self.assertTrue(w.is_always_silent)
        self.assertEqual(w.work_capacity_state, "stealth_regulated")
        self.assertAlmostEqual(w.input_idle_sec, 12.5, places=1)
        self.assertAlmostEqual(w.gpu_temp_c, 58.2, places=1)
        self.assertEqual(w.duty_cycle_pct, 33)

        # Test serialization
        serialized = serialize_worker_node(w)
        self.assertTrue(serialized["is_always_silent"])
        self.assertEqual(serialized["work_capacity_state"], "stealth_regulated")
        self.assertAlmostEqual(serialized["input_idle_sec"], 12.5, places=1)
        self.assertAlmostEqual(serialized["gpu_temp_c"], 58.2, places=1)
        self.assertEqual(serialized["duty_cycle_pct"], 33)

    def test_tc029_heartbeat_telemetry_ingestion(self):
        """TC-029: Ingest stealth telemetry in heartbeat and verify DB state updates."""
        from app.cluster_worker_router import worker_node_heartbeat, WorkerHeartbeatPayload

        wid = self.test_worker_ids[0]
        w = Worker(
            id=wid,
            name="Test Node Unleashed",
            gpu_info="NVIDIA RTX 4070",
            gpu_memory_gb=8.0,
            status="online",
            is_available=True,
            is_always_silent=False,
            work_capacity_state="unleashed",
            duty_cycle_pct=100,
        )
        self.db.add(w)
        self.db.commit()

        # Send heartbeat transitioning to stealth
        hb_payload = WorkerHeartbeatPayload(
            current_task_id=None,
            is_always_silent=True,
            work_capacity_state="stealth_regulated",
            input_idle_sec=4.2,
            gpu_temp_c=61.5,
            duty_cycle_pct=30,
        )
        resp = worker_node_heartbeat(worker_id=wid, payload=hb_payload, db=self.db)

        self.assertEqual(resp["status"], "ok")
        self.assertTrue(resp["is_always_silent"])
        self.assertEqual(resp["work_capacity_state"], "stealth_regulated")
        self.assertEqual(resp["duty_cycle_pct"], 30)

        # Verify DB directly
        self.db.refresh(w)
        self.assertTrue(w.is_always_silent)
        self.assertEqual(w.work_capacity_state, "stealth_regulated")
        self.assertAlmostEqual(w.input_idle_sec, 4.2, places=1)
        self.assertAlmostEqual(w.gpu_temp_c, 61.5, places=1)

    def test_tc030_worker_config_patching(self):
        """TC-030: Test PATCH /api/v1/workers/{id}/config toggles always_silent."""
        import asyncio
        from app.cluster_worker_router import update_worker_config, WorkerConfigUpdatePayload

        wid = self.test_worker_ids[0]
        w = Worker(
            id=wid,
            name="Config Toggle Node",
            gpu_info="NVIDIA RTX 4070",
            gpu_memory_gb=8.0,
            status="online",
            is_available=True,
            is_always_silent=False,
            work_capacity_state="unleashed",
        )
        self.db.add(w)
        self.db.commit()

        # Patch to true
        payload = WorkerConfigUpdatePayload(always_silent=True)
        res = asyncio.run(update_worker_config(worker_id=wid, payload=payload, db=self.db))
        self.assertTrue(res["is_always_silent"])

        self.db.refresh(w)
        self.assertTrue(w.is_always_silent)

        # Patch back to false
        payload_off = WorkerConfigUpdatePayload(always_silent=False)
        res_off = asyncio.run(update_worker_config(worker_id=wid, payload=payload_off, db=self.db))
        self.assertFalse(res_off["is_always_silent"])

        self.db.refresh(w)
        self.assertFalse(w.is_always_silent)

    def test_tc031_scheduler_straggler_exclusion_and_inference_routing(self):
        """TC-031: Synchronous Ring All-Reduce excludes stealth workers; Async inference includes them."""
        w1_id, w2_id, w3_id = self.test_worker_ids[0], self.test_worker_ids[1], self.test_worker_ids[2]

        w1 = Worker(
            id=w1_id,
            name="Unleashed Node",
            gpu_info="NVIDIA RTX 4070",
            gpu_memory_gb=8.0,
            vram_used_gb=1.0,
            vram_allocation_pct=80,
            status="online",
            is_available=True,
            is_always_silent=False,
            work_capacity_state="unleashed",
            duty_cycle_pct=100,
        )
        w2 = Worker(
            id=w2_id,
            name="Stealth Node",
            gpu_info="NVIDIA RTX 4070",
            gpu_memory_gb=8.0,
            vram_used_gb=1.0,
            vram_allocation_pct=80,
            status="online",
            is_available=True,
            is_always_silent=True,
            work_capacity_state="stealth_regulated",
            duty_cycle_pct=33,
        )
        w3 = Worker(
            id=w3_id,
            name="Gaming Node",
            gpu_info="NVIDIA RTX 4070",
            gpu_memory_gb=8.0,
            vram_used_gb=6.0,
            vram_allocation_pct=80,
            status="online",
            is_available=True,
            is_always_silent=True,
            work_capacity_state="restricted_pause",
            duty_cycle_pct=0,
        )
        self.db.add_all([w1, w2, w3])
        self.db.commit()

        # 1. Distributed Training: Only Unleashed should be eligible
        score_w1_train = self.scheduler.score_worker_node(w1, required_vram_gb=2.0, task_type="distributed_training")
        score_w2_train = self.scheduler.score_worker_node(w2, required_vram_gb=2.0, task_type="distributed_training")
        score_w3_train = self.scheduler.score_worker_node(w3, required_vram_gb=2.0, task_type="distributed_training")

        self.assertTrue(score_w1_train["eligible"], "Unleashed node must be eligible for distributed training")
        self.assertFalse(score_w2_train["eligible"], "Stealth node must be disqualified from synchronous training")
        self.assertIn("straggler", score_w2_train["disqualification_reason"].lower())
        self.assertFalse(score_w3_train["eligible"], "Gaming node must be disqualified from distributed training")
        self.assertIn("gaming", score_w3_train["disqualification_reason"].lower())

        # 2. Async Inference: Unleashed AND Stealth should be eligible; Gaming still paused
        score_w1_infer = self.scheduler.score_worker_node(w1, required_vram_gb=2.0, task_type="inference")
        score_w2_infer = self.scheduler.score_worker_node(w2, required_vram_gb=2.0, task_type="inference")
        score_w3_infer = self.scheduler.score_worker_node(w3, required_vram_gb=2.0, task_type="inference")

        self.assertTrue(score_w1_infer["eligible"], "Unleashed node must be eligible for inference")
        self.assertTrue(score_w2_infer["eligible"], "Stealth node must be eligible for inference")
        self.assertFalse(score_w3_infer["eligible"], "Gaming node must be disqualified from inference")

        # 3. Dynamic SLA verification timeout
        self.assertEqual(score_w1_infer["slice_timeout_seconds"], 15.0)
        self.assertEqual(score_w2_infer["slice_timeout_seconds"], 60.0)

    def test_tc032_select_optimal_workers_timeout_scaling(self):
        """TC-032: select_optimal_workers dynamically scales slice timeout for stealth workers."""
        w2_id = self.test_worker_ids[1]
        w2 = Worker(
            id=w2_id,
            name="Stealth Node Only",
            gpu_info="NVIDIA RTX 4070",
            gpu_memory_gb=8.0,
            vram_used_gb=1.0,
            status="online",
            is_available=True,
            is_always_silent=True,
            work_capacity_state="stealth_regulated",
            duty_cycle_pct=33,
        )
        self.db.add(w2)
        self.db.commit()

        # Exclude all existing workers except w2 to test dynamic timeout scaling strictly on w2
        other_ids = [w.id for w in self.db.query(Worker).all() if w.id != w2_id]
        dispatch = self.scheduler.select_optimal_workers(
            db=self.db,
            required_vram_gb=2.0,
            num_gpus=1,
            task_type="inference",
            exclude_worker_ids=other_ids,
            record_dispatch=False,
        )
        self.assertEqual(dispatch["eligible_count"], 1)
        self.assertEqual(dispatch["slice_timeout_seconds"], 60.0)

    def test_tc033_cluster_monitor_snapshot_counts(self):
        """TC-033: Snapshot endpoint reports unleashed_nodes, stealth_nodes, and paused_nodes."""
        from app.cluster_worker_router import get_cluster_monitor_snapshot

        w1_id, w2_id, w3_id = self.test_worker_ids[0], self.test_worker_ids[1], self.test_worker_ids[2]
        w1 = Worker(
            id=w1_id,
            name="Unleashed Node",
            status="online",
            is_available=True,
            work_capacity_state="unleashed",
        )
        w2 = Worker(
            id=w2_id,
            name="Stealth Node",
            status="online",
            is_available=True,
            work_capacity_state="stealth_regulated",
        )
        w3 = Worker(
            id=w3_id,
            name="Paused Node",
            status="online",
            is_available=True,
            work_capacity_state="restricted_pause",
        )
        self.db.add_all([w1, w2, w3])
        self.db.commit()

        snapshot = get_cluster_monitor_snapshot(db=self.db)
        summary = snapshot["summary"]
        self.assertIn("unleashed_nodes", summary)
        self.assertIn("stealth_nodes", summary)
        self.assertIn("paused_nodes", summary)
        self.assertGreaterEqual(summary["unleashed_nodes"], 1)
        self.assertGreaterEqual(summary["stealth_nodes"], 1)
        self.assertGreaterEqual(summary["paused_nodes"], 1)

    def test_tc034_adaptive_failover_on_stealth_transition(self):
        """TC-034: Failover triggered when a worker enters stealth/gaming preserves worker online state."""
        w1_id, w4_id = self.test_worker_ids[0], self.test_worker_ids[3]
        task_id = f"test-task-{uuid.uuid4().hex[:6]}"

        w1 = Worker(
            id=w1_id,
            name="Active Training Node",
            status="busy",
            current_task_id=task_id,
            is_available=True,
            work_capacity_state="unleashed",
            gpu_memory_gb=8.0,
            vram_allocation_pct=80,
        )
        w4 = Worker(
            id=w4_id,
            name="Standby Unleashed Node",
            status="online",
            is_available=True,
            work_capacity_state="unleashed",
            gpu_memory_gb=8.0,
            vram_allocation_pct=80,
        )
        task = Task(
            task_id=task_id,
            prompt="Test LoRA Train",
            status=TaskStatus.PROCESSING,
            claimed_by=w1_id,
        )
        self.db.add_all([w1, w4, task])
        self.db.commit()

        # Worker 1 transitions to gaming (restricted_pause) mid-task
        w1.work_capacity_state = "restricted_pause"
        self.db.commit()

        # Isolate failover to w4 by excluding all other external cluster workers
        external_ids = [w.id for w in self.db.query(Worker).all() if w.id not in (w1_id, w4_id)]

        failover = self.scheduler.trigger_task_failover(
            db=self.db,
            task_id=task_id,
            failed_worker_id=w1_id,
            required_vram_gb=2.0,
            task_type="training",
            reason="restricted_pause_gaming_detected",
            exclude_worker_ids=external_ids,
        )

        self.assertEqual(failover["replacement_worker_id"], w4_id)

        # Worker 1 should NOT be marked offline, but released from current_task_id
        self.db.refresh(w1)
        self.assertIsNone(w1.current_task_id)
        self.assertNotEqual(w1.status, "offline")

        # Task claimed_by should point to standby node w4
        self.db.refresh(task)
        self.assertEqual(task.claimed_by, w4_id)


def run_phase4_tests() -> bool:
    """Run all Phase 4 Orchestrator Stealth Routing tests with strict bounding."""
    suite = unittest.TestLoader().loadTestsFromTestCase(TestOrchestratorStealthRouting)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_phase4_tests()
    sys.exit(0 if success else 1)
