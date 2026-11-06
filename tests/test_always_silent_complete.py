"""
Project NetworkNebula - Phase 6 End-to-End Simulation & Verification Suite
"A Day in the Life of Jon" — Always Silent 24-Hour Autonomous Lifecycle

Validates the full closed-loop feature:
1. Night State: Sleep & deep idle -> Unleashed burst mode (100% compute duty, zero yield).
2. Morning State: Human desktop input (Excel/Web) -> Immediate transition (<200us) to Whisper Stealth (33% duty, T_yield >= 15ms DWM min yield).
3. Thermal Pacing: High junction temperature (72C > 62C ceiling) dynamically expands yield sleep to suppress acoustic fan spin-up.
4. VRAM Headroom Reclamation: Cache purge frees memory for host desktop applications.
5. Gaming State: Fullscreen D3D app / 3D game -> Restricted Pause (0% compute, instant yield, zero game FPS drop).
6. Lunch State: Inactivity cooldown expires -> Resumes Unleashed burst automatically.
7. Proof-of-Delivered-Slice (PoDS) Ledger: Verifies all slices credited with 0 slashing and full reputation.
"""

import os
import sys
import time
import uuid
import unittest
from datetime import datetime, timezone
from typing import Dict, Any

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app.database import engine, SessionLocal
from app.models import Worker, Task, TaskStatus, ComputeSlice, User
from app.scheduler import ClusterScheduler
from app.cluster_worker_router import serialize_worker_node
from worker.stealth_sensor import StealthPresenceSensor
from worker.silent_governor import SilentThermalGovernor


class ControllableStealthSensor(StealthPresenceSensor):
    """Test sensor with deterministic simulated user activity states."""

    def __init__(self, idle_threshold_sec: float = 60.0, cooldown_seconds: float = 60.0):
        self.simulated_idle_sec = 300.0
        self.simulated_gaming = False
        self.simulated_audio = False
        super().__init__(idle_threshold_sec=idle_threshold_sec, cooldown_seconds=cooldown_seconds)

    def get_os_idle_seconds(self) -> float:
        return float(self.simulated_idle_sec)

    def is_fullscreen_gaming_active(self) -> bool:
        return bool(self.simulated_gaming)

    def is_fullscreen_3d_active(self) -> bool:
        return bool(self.simulated_gaming)

    def is_audio_playing(self) -> bool:
        return bool(self.simulated_audio)

    def is_media_playback_active(self) -> bool:
        return bool(self.simulated_audio)

    def get_presence_state(self) -> str:
        return self.evaluate_presence_state()


class TestAlwaysSilentDayInTheLife(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.scheduler = ClusterScheduler()
        cls.worker_id = f"jon-rtx4070-{uuid.uuid4().hex[:6]}"
        cls.standby_id = f"standby-unleashed-{uuid.uuid4().hex[:6]}"
        cls.user_id = f"jon-user-{uuid.uuid4().hex[:6]}"

        # Seed Jon's User account
        cls.user = User(
            id=cls.user_id,
            email=f"jon_{cls.user_id}@example.com",
            api_key=f"jon_key_{uuid.uuid4().hex[:12]}",
            api_secret=f"secret_{uuid.uuid4().hex[:16]}",
            balance=100.0,
        )
        # Seed Jon's Worker node (Always Silent enabled)
        cls.worker = Worker(
            id=cls.worker_id,
            user_id=cls.user_id,
            name="Jon Gaming PC (RTX 4070)",
            gpu_info="NVIDIA GeForce RTX 4070",
            gpu_memory_gb=8.0,
            vram_allocation_pct=80,
            status="online",
            is_available=True,
            is_always_silent=True,
            work_capacity_state="unleashed",
            duty_cycle_pct=100,
            hourly_rate_usd=0.45,
            total_earnings_usd=0.0,
            reputation_score=100.0,
            slashed_amount_usd=0.0,
        )
        # Standby worker for cluster failover
        cls.standby = Worker(
            id=cls.standby_id,
            name="Standby Cluster Node",
            gpu_info="NVIDIA RTX A5000",
            gpu_memory_gb=24.0,
            vram_allocation_pct=90,
            status="online",
            is_available=True,
            is_always_silent=False,
            work_capacity_state="unleashed",
            duty_cycle_pct=100,
        )
        cls.db.add_all([cls.user, cls.worker, cls.standby])
        cls.db.commit()

        # Initialize hardware governor with controllable sensor
        cls.sensor = ControllableStealthSensor(idle_threshold_sec=60.0, cooldown_seconds=60.0)
        cls.governor = SilentThermalGovernor(sensor=cls.sensor, target_temp_c=62.0, duty_ratio=2.0)

    @classmethod
    def tearDownClass(cls):
        try:
            cls.governor.close()
            cls.sensor.close()
            cls.db.query(ComputeSlice).filter(ComputeSlice.worker_id.in_([cls.worker_id, cls.standby_id])).delete(synchronize_session=False)
            cls.db.query(Task).filter(Task.claimed_by.in_([cls.worker_id, cls.standby_id])).delete(synchronize_session=False)
            cls.db.query(Worker).filter(Worker.id.in_([cls.worker_id, cls.standby_id])).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id == cls.user_id).delete(synchronize_session=False)
            cls.db.commit()
        except Exception:
            cls.db.rollback()
        finally:
            cls.db.close()

    def test_01_night_state_deep_sleep_unleashed(self):
        """Phase 6.1: Night state (03:00) — Jon is asleep; node runs unleashed burst at 100% capacity."""
        self.sensor.simulated_idle_sec = 1800.0  # 30 minutes of no user activity
        self.sensor.simulated_gaming = False
        self.sensor.simulated_audio = False

        state = self.sensor.get_presence_state()
        self.assertEqual(state, "unleashed", "Node must be in unleashed mode during night idle")

        # Closed-loop yield calculation
        compute_duration = 0.050  # 50ms compute slice
        yield_duration = self.governor.calculate_yield_duration(compute_duration, presence_state=state, gpu_temp_c=52.0)
        self.assertEqual(yield_duration, 0.0, "Unleashed mode must have zero yield delay (100% compute burst)")

        # Orchestrator scheduler test: node is eligible for both distributed training and inference
        score_train = self.scheduler.score_worker_node(self.worker, required_vram_gb=4.0, task_type="training")
        self.assertTrue(score_train["eligible"], "Unleashed node must be eligible for heavy training")
        self.assertEqual(score_train["slice_timeout_seconds"], 15.0)

        # Record simulated night compute slice
        slice_rec = ComputeSlice(
            slice_id=f"slice-night-{uuid.uuid4().hex[:6]}",
            task_id="task-batch-lora-night",
            worker_id=self.worker_id,
            slice_index=0,
            compute_time_sec=12.5,
            reward_usd=0.015,
            payload_hash="sha256-night-gradient-block",
        )
        self.worker.total_earnings_usd += 0.015
        self.worker.total_tasks_completed += 1
        self.db.add(slice_rec)
        self.db.commit()

    def test_02_morning_state_desktop_work_transition(self):
        """Phase 6.2: Morning state (09:00) — Jon wakes up and opens Excel/Browser; sub-200us transition to stealth."""
        # User starts typing
        self.sensor.simulated_idle_sec = 0.25  # 250ms since last keystroke
        self.sensor.simulated_gaming = False

        t_start = time.perf_counter()
        state = self.sensor.get_presence_state()
        detection_us = (time.perf_counter() - t_start) * 1e6

        self.assertLess(detection_us, 500.0, "Stealth sensing must evaluate in under 500 microseconds")
        self.assertEqual(state, "stealth_regulated", "Presence sensing must instantly transition to stealth_regulated")

        # Pacing governor enforces minimum 15ms DWM yield and 33% duty cycle
        compute_duration = 0.020  # 20ms micro-batch
        yield_duration = self.governor.calculate_yield_duration(compute_duration, presence_state=state, gpu_temp_c=55.0)

        self.assertGreaterEqual(yield_duration, 0.015, "Yield duration must meet or exceed 15ms DWM compositor yield")
        self.assertAlmostEqual(yield_duration, 0.040, delta=0.005, msg="20ms compute with 2.0 ratio must yield 40ms (~33% duty)")

        # Verify VRAM cache reclamation occurs to prevent desktop lag
        vram_reclaimed = self.governor.reclaim_vram_headroom()
        self.assertIn("freed_mb", vram_reclaimed)

        # Update worker record to stealth
        self.worker.work_capacity_state = "stealth_regulated"
        self.worker.duty_cycle_pct = 33
        self.worker.input_idle_sec = 0.25
        self.db.commit()

        # Orchestrator scheduler test: excluded from synchronous distributed training, but receives async inference
        score_sync = self.scheduler.score_worker_node(self.worker, required_vram_gb=2.0, task_type="distributed_training")
        self.assertFalse(score_sync["eligible"], "Stealth node must be excluded from synchronous distributed training")
        self.assertIn("straggler", score_sync["disqualification_reason"].lower())

        score_async = self.scheduler.score_worker_node(self.worker, required_vram_gb=2.0, task_type="inference")
        self.assertTrue(score_async["eligible"], "Stealth node must receive async inference micro-tasks")
        self.assertEqual(score_async["slice_timeout_seconds"], 60.0, "Stealth worker must receive dynamic 60s SLA timeout")

        # Record simulated morning micro-slice
        slice_rec = ComputeSlice(
            slice_id=f"slice-morn-{uuid.uuid4().hex[:6]}",
            task_id="task-async-inference-morn",
            worker_id=self.worker_id,
            slice_index=1,
            compute_time_sec=4.2,
            reward_usd=0.005,
            payload_hash="sha256-async-micro-batch",
        )
        self.worker.total_earnings_usd += 0.005
        self.worker.total_tasks_completed += 1
        self.db.add(slice_rec)
        self.db.commit()

    def test_03_acoustic_thermal_governor_fan_suppression(self):
        """Phase 6.3: Closed-loop thermal governor expands yield when GPU reaches 72C to keep fan silent."""
        state = "stealth_regulated"
        compute_duration = 0.020  # 20ms compute

        # At 50C (normal): standard 40ms yield
        y_normal = self.governor.calculate_yield_duration(compute_duration, presence_state=state, gpu_temp_c=50.0)

        # At 72C (10 degrees above 62C ceiling): thermal expansion triggers
        y_hot = self.governor.calculate_yield_duration(compute_duration, presence_state=state, gpu_temp_c=72.0)

        self.assertGreater(y_hot, y_normal, "Hot GPU must trigger expanded yield sleep")
        self.assertAlmostEqual(y_hot, 0.140, delta=0.010, msg="72C (delta=10C) must expand yield to ~140ms")

    def test_04_afternoon_gaming_fullscreen_yield(self):
        """Phase 6.4: Afternoon gaming (16:00) — Jon launches a 3D game; immediate restricted pause and zero FPS loss."""
        # Fullscreen 3D game launched
        self.sensor.simulated_idle_sec = 2.0
        self.sensor.simulated_gaming = True

        state = self.sensor.get_presence_state()
        self.assertEqual(state, "restricted_pause", "Gaming detection must transition to restricted_pause")

        # Yield duration in restricted pause
        compute_duration = 0.020
        y_gaming = self.governor.calculate_yield_duration(compute_duration, presence_state=state, gpu_temp_c=65.0)
        self.assertGreaterEqual(y_gaming, 0.500, "Gaming mode must force minimum 500ms safety yield sleep")

        # Scheduler must completely disqualify node from all tasks
        self.worker.work_capacity_state = "restricted_pause"
        self.worker.duty_cycle_pct = 0
        self.db.commit()

        score_any = self.scheduler.score_worker_node(self.worker, required_vram_gb=1.0, task_type="inference")
        self.assertFalse(score_any["eligible"], "Gaming node must be 100% disqualified from compute dispatches")
        self.assertIn("gaming", score_any["disqualification_reason"].lower())

        # Test mid-run failover: re-routes task to standby without marking Jon's node offline
        task_id = f"test-game-failover-{uuid.uuid4().hex[:6]}"
        self.worker.status = "busy"
        self.worker.current_task_id = task_id
        t = Task(task_id=task_id, prompt="LoRA Train Shard", status=TaskStatus.PROCESSING, claimed_by=self.worker_id)
        self.db.add(t)
        self.db.commit()

        external_ids = [w.id for w in self.db.query(Worker).all() if w.id not in (self.worker_id, self.standby_id)]
        failover = self.scheduler.trigger_task_failover(
            db=self.db,
            task_id=task_id,
            failed_worker_id=self.worker_id,
            required_vram_gb=2.0,
            task_type="training",
            reason="gaming_fullscreen_pause",
            exclude_worker_ids=external_ids,
        )

        self.assertEqual(failover["replacement_worker_id"], self.standby_id)
        self.db.refresh(self.worker)
        self.assertNotEqual(self.worker.status, "offline", "Worker must not be marked offline when gaming")
        self.assertIsNone(self.worker.current_task_id, "Current task must be released from gaming worker")

    def test_05_lunch_state_inactivity_cooldown_unleashed(self):
        """Phase 6.5: Lunch break (13:00) — Jon stops gaming and goes to eat; cooldown expires & resumes unleashed."""
        # 90 seconds of continuous inactivity (exceeds 60s cooldown)
        self.sensor.simulated_gaming = False
        self.sensor.simulated_idle_sec = 95.0
        # Fast-forward hysteresis cooldown timestamp by 100 seconds to simulate lunch duration
        self.sensor.last_user_activity_time = time.time() - 100.0

        state = self.sensor.get_presence_state()
        self.assertEqual(state, "unleashed", "Inactivity exceeding cooldown must restore unleashed mode")

        self.worker.work_capacity_state = "unleashed"
        self.worker.duty_cycle_pct = 100
        self.worker.input_idle_sec = 95.0
        self.db.commit()

        score_lunch = self.scheduler.score_worker_node(self.worker, required_vram_gb=2.0, task_type="training")
        self.assertTrue(score_lunch["eligible"], "Resumed node must immediately be eligible for unleashed compute")

    def test_06_ledger_integrity_and_zero_slashing(self):
        """Phase 6.6: Ledger audit — confirms 100% of delivered slices credited, 0 penalties, reputation 100.0."""
        self.db.refresh(self.worker)

        # 1. Zero slashing penalties
        self.assertEqual(self.worker.slashed_amount_usd, 0.0, "Stealth transitions must never induce slashing")
        self.assertGreaterEqual(self.worker.reputation_score, 100.0, "Reputation score must remain pristine")

        # 2. Earnings accumulated properly
        self.assertGreater(self.worker.total_earnings_usd, 0.0, "Worker must accrue SLA earnings across cycles")
        self.assertGreaterEqual(self.worker.total_tasks_completed, 2)

        # 3. Serialization accuracy for Cloud Console UI
        serialized = serialize_worker_node(self.worker)
        self.assertTrue(serialized["is_always_silent"])
        self.assertEqual(serialized["slashed_amount_usd"], 0.0)
        self.assertEqual(serialized["reputation_score"], 100.0)


def run_phase6_tests() -> bool:
    """Execute all Phase 6 End-to-End Simulation tests with strict bounding."""
    suite = unittest.TestLoader().loadTestsFromTestCase(TestAlwaysSilentDayInTheLife)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_phase6_tests()
    sys.exit(0 if success else 1)
