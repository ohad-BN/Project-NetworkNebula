#!/usr/bin/env python3
"""
Project NetworkNebula — Phase 2 Test Suite: Software Acoustic-Thermal Governor
=============================================================================
Tests for `worker/silent_governor.py`:
- TC-019: Mathematical micro-duty cycle pacing & min 15ms DWM slice clamping.
- TC-020: Acoustic-thermal feedback loop & linear penalty scaling (+10ms/°C).
- TC-021: Low-priority PyTorch CUDA stream & elastic VRAM reclamation.
- TC-022: High-precision Windows timer resolution & sub-millisecond yield execution.
- TC-023: Restricted pause 100% yield & state transition VRAM flush.
- Loop Safety: All tests run synchronously in < 1 second with mock sleep safeguards.
"""

import os
import sys
import time
import unittest
from unittest.mock import patch, MagicMock

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

from worker.stealth_sensor import StealthPresenceSensor
from worker.silent_governor import (
    SilentThermalGovernor,
    get_silent_governor,
)


class TestSilentGovernor(unittest.TestCase):
    def setUp(self):
        self.sensor = MagicMock(spec=StealthPresenceSensor)
        self.sensor.evaluate_presence_state.return_value = "unleashed"
        self.sensor.get_gpu_temperature.return_value = 50
        self.sensor.get_os_idle_seconds.return_value = 300.0

        self.governor = SilentThermalGovernor(
            sensor=self.sensor,
            target_temp_c=62.0,
            duty_ratio=2.0,
            min_yield_sec=0.015,
            max_yield_sec=5.0,
            pause_sleep_sec=2.0,
            thermal_coefficient_sec_per_c=0.010,
        )

    def tearDown(self):
        self.governor.close()

    def test_01_unleashed_zero_yield_delay(self):
        """TC-019: In unleashed state with normal temperatures, yield delay must be exactly 0.0s."""
        yield_sec = self.governor.calculate_yield_duration(
            compute_duration_s=0.040, presence_state="unleashed", gpu_temp_c=55
        )
        self.assertEqual(yield_sec, 0.0)

    def test_02_stealth_regulated_duty_cycle_formula(self):
        """TC-019: In stealth_regulated, yield delay must be >= 2.0 * compute_duration."""
        compute_s = 0.025  # 25ms compute
        yield_sec = self.governor.calculate_yield_duration(
            compute_duration_s=compute_s, presence_state="stealth_regulated", gpu_temp_c=50
        )
        # 25ms * 2.0 = 50ms yield
        self.assertAlmostEqual(yield_sec, 0.050, places=3)

    def test_03_min_yield_clamping_for_dwm_composition(self):
        """TC-019: Tiny compute duration (e.g. 2ms) must be clamped to min 15ms for DWM 60Hz frame deadline."""
        compute_s = 0.002  # 2ms compute -> 4ms raw duty yield
        yield_sec = self.governor.calculate_yield_duration(
            compute_duration_s=compute_s, presence_state="stealth_regulated", gpu_temp_c=50
        )
        self.assertEqual(yield_sec, 0.015)

    def test_04_thermal_penalty_scaling(self):
        """TC-020: Temperatures above 62°C expand yield sleep by +10ms per °C."""
        compute_s = 0.020  # 40ms base yield
        # At 62°C (target): penalty = 0ms -> 40ms yield
        y_62 = self.governor.calculate_yield_duration(compute_s, "stealth_regulated", gpu_temp_c=62)
        self.assertAlmostEqual(y_62, 0.040, places=3)

        # At 67°C (+5°C): penalty = +50ms -> 90ms yield
        y_67 = self.governor.calculate_yield_duration(compute_s, "stealth_regulated", gpu_temp_c=67)
        self.assertAlmostEqual(y_67, 0.090, places=3)

        # At 72°C (+10°C): penalty = +100ms -> 140ms yield
        y_72 = self.governor.calculate_yield_duration(compute_s, "stealth_regulated", gpu_temp_c=72)
        self.assertAlmostEqual(y_72, 0.140, places=3)

    def test_05_critical_thermal_protection_in_unleashed(self):
        """TC-020: Critical thermal overshoot in unleashed mode (>15°C above target) activates cooling yield."""
        # 62 + 16 = 78°C -> Critical: penalty = 16 * 10ms = 0.160s
        yield_sec = self.governor.calculate_yield_duration(
            compute_duration_s=0.050, presence_state="unleashed", gpu_temp_c=78
        )
        self.assertGreater(yield_sec, 0.10)

    def test_06_restricted_pause_full_yield(self):
        """TC-023: In restricted_pause mode (3D game active), yield sleep must equal pause_sleep_sec (2.0s)."""
        yield_sec = self.governor.calculate_yield_duration(
            compute_duration_s=0.030, presence_state="restricted_pause"
        )
        self.assertEqual(yield_sec, 2.0)

    def test_07_yield_gpu_queue_execution_and_telemetry(self):
        """TC-019: yield_gpu_queue synchronizes, sleeps, and returns correct telemetry."""
        with patch("time.sleep") as mock_sleep:
            res = self.governor.yield_gpu_queue(
                compute_duration_s=0.030, presence_state="stealth_regulated"
            )
            self.assertEqual(res["state"], "stealth_regulated")
            self.assertEqual(res["compute_duration_s"], 0.030)
            self.assertGreaterEqual(res["yield_duration_s"], 0.060)
            self.assertLessEqual(res["effective_duty_cycle_pct"], 35.0)
            mock_sleep.assert_called_once()

    def test_08_vram_headroom_reclamation(self):
        """TC-021: reclaim_vram_headroom invokes garbage collection and returns metrics."""
        res = self.governor.reclaim_vram_headroom()
        self.assertIn("freed_mb", res)
        self.assertIn("allocated_mb", res)
        self.assertIn("timestamp", res)

        if TORCH_AVAILABLE and torch.cuda.is_available():
            # Allocate 64MB tensor, delete, and assert empty_cache frees memory
            tensor = torch.empty((16, 1024, 1024), dtype=torch.float32, device="cuda")
            self.assertGreater(torch.cuda.memory_allocated(), 0)
            del tensor
            clean_res = self.governor.reclaim_vram_headroom()
            self.assertIsInstance(clean_res["freed_mb"], float)

    def test_09_cuda_low_priority_stream(self):
        """TC-021: get_compute_stream returns a low-priority CUDA stream on CUDA systems."""
        if TORCH_AVAILABLE and torch.cuda.is_available():
            stream = self.governor.get_compute_stream()
            self.assertIsNotNone(stream)
            self.assertIsInstance(stream, torch.cuda.Stream)
            self.assertEqual(stream.priority, 0)
        else:
            stream = self.governor.get_compute_stream()
            self.assertIsNone(stream)

    def test_10_timer_precision_initialization(self):
        """TC-022: High precision timer initializes without uncaught exceptions on Windows."""
        if sys.platform == "win32":
            self.assertTrue(hasattr(self.governor, "_high_precision_timer_active"))

    def test_11_singleton_accessor(self):
        """Verify module singleton get_silent_governor returns consistent instance."""
        g1 = get_silent_governor()
        g2 = get_silent_governor()
        self.assertIs(g1, g2)


def run_phase2_tests():
    print("=" * 70)
    print("  RUNNING PHASE 2: ACOUSTIC-THERMAL GOVERNOR TEST SUITE")
    print("=" * 70)
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromTestCase(TestSilentGovernor)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_phase2_tests()
    sys.exit(0 if success else 1)
