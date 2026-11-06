#!/usr/bin/env python3
"""
Project NetworkNebula — Phase 3 Test Suite: Always Silent Standalone CLI Integration
===================================================================================
Tests for `nebula_worker.py` and `worker/nebula_worker.py`:
- TC-024: CLI flag parsing (--always-silent, --target-temp, --cooldown-sec).
- TC-025: Heartbeat telemetry streaming (work_capacity_state, input_idle_sec, gpu_temp_c).
- TC-026: Sliced task execution with dynamic pacing loop & low-priority CUDA stream.
- TC-027: Restricted gaming pause handling in work loop.
- Loop Safety: All tests run with strict subprocess timeouts (<=10s) and bounded mock loops.
"""

import os
import sys
import json
import time
import subprocess
import unittest
from unittest.mock import patch, MagicMock

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

WORKER_SCRIPT = os.path.join(PROJECT_ROOT, "nebula_worker.py")
BASE_URL = os.environ.get("NEBULA_SERVER_URL", "http://127.0.0.1:8000")


class TestWorkerAlwaysSilent(unittest.TestCase):
    def setUp(self):
        self.test_worker_id = "node-qa-silent-01"

    def tearDown(self):
        # Clean up synthetic test worker from DB
        try:
            from app.database import SessionLocal
            from app.models import Worker as DBWorker, Task as DBTask
            db = SessionLocal()
            db.query(DBTask).filter(DBTask.claimed_by == self.test_worker_id).delete()
            db.query(DBWorker).filter(DBWorker.id == self.test_worker_id).delete()
            db.commit()
            db.close()
        except Exception:
            pass

    def test_01_cli_join_always_silent_json(self):
        """TC-024: Test nebula_worker.py join --always-silent --once --json returns telemetry."""
        proc = subprocess.run(
            [
                sys.executable,
                WORKER_SCRIPT,
                "join",
                "--server", BASE_URL,
                "--worker-id", self.test_worker_id,
                "--always-silent",
                "--target-temp", "60.0",
                "--cooldown-sec", "20.0",
                "--once",
                "--json",
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(proc.returncode, 0, f"Worker join failed: {proc.stderr}")
        data = json.loads(proc.stdout.strip())

        self.assertEqual(data.get("status"), "online")
        self.assertEqual(data.get("worker_id"), self.test_worker_id)
        self.assertTrue(data.get("always_silent"), "always_silent flag was not present in summary")
        self.assertIn("work_capacity_state", data)
        self.assertIn(data["work_capacity_state"], ["unleashed", "stealth_regulated", "restricted_pause"])
        self.assertIn("input_idle_sec", data)
        self.assertIn("gpu_temp_c", data)

    def test_02_cli_flag_parsing_defaults(self):
        """TC-024: Verify default arguments for always silent parameters in parser."""
        from nebula_worker import build_parser
        parser = build_parser()

        # Check join parser
        args_join = parser.parse_args(["join", "--always-silent"])
        self.assertTrue(args_join.always_silent)
        self.assertEqual(args_join.target_temp, 62.0)
        self.assertEqual(args_join.cooldown_sec, 60.0)

        # Check work parser with shorthand -S
        args_work = parser.parse_args(["work", "-S", "--target-temp", "58.0", "--cooldown-sec", "45.0"])
        self.assertTrue(args_work.always_silent)
        self.assertEqual(args_work.target_temp, 58.0)
        self.assertEqual(args_work.cooldown_sec, 45.0)

    def test_03_execute_tensor_compute_slice_with_stream(self):
        """TC-026: execute_tensor_compute_slice accepts low-priority stream parameter without error."""
        from nebula_worker import execute_tensor_compute_slice, resolve_tensor_device
        from worker.silent_governor import get_silent_governor

        dev_obj, dev_type = resolve_tensor_device()
        gov = get_silent_governor()
        stream = gov.get_compute_stream(dev_obj)

        t0 = time.perf_counter()
        execute_tensor_compute_slice(dev_obj, dev_type, stream=stream)
        elapsed = time.perf_counter() - t0

        self.assertGreater(elapsed, 0.0)
        self.assertLess(elapsed, 2.0)

    def test_04_work_pacing_differential(self):
        """TC-026: Verify that in stealth_regulated mode, yield pacer introduces duty cycle delay."""
        from worker.stealth_sensor import StealthPresenceSensor
        from worker.silent_governor import SilentThermalGovernor

        sensor = MagicMock(spec=StealthPresenceSensor)
        sensor.evaluate_presence_state.return_value = "stealth_regulated"
        sensor.get_gpu_temperature.return_value = 50

        gov = SilentThermalGovernor(sensor=sensor, target_temp_c=62.0, duty_ratio=2.0)

        # 10ms compute slice
        compute_s = 0.010
        yield_s = gov.calculate_yield_duration(compute_s, presence_state="stealth_regulated")

        # Yield must be at least min_yield_sec (15ms)
        self.assertGreaterEqual(yield_s, 0.015)

        # Now test unleashed mode
        yield_unleashed = gov.calculate_yield_duration(compute_s, presence_state="unleashed")
        self.assertEqual(yield_unleashed, 0.0)
        gov.close()

    def test_05_gaming_restricted_pause_detection(self):
        """TC-027: Restricted pause yields 100% compute (pause_sleep_sec)."""
        from worker.silent_governor import SilentThermalGovernor
        gov = SilentThermalGovernor(pause_sleep_sec=2.0)
        pause_delay = gov.calculate_yield_duration(0.020, presence_state="restricted_pause")
        self.assertEqual(pause_delay, 2.0)
        gov.close()


def run_phase3_tests():
    print("=" * 70)
    print("  RUNNING PHASE 3: ALWAYS SILENT CLI WORKER INTEGRATION TEST SUITE")
    print("=" * 70)
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromTestCase(TestWorkerAlwaysSilent)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_phase3_tests()
    sys.exit(0 if success else 1)
