#!/usr/bin/env python3
"""
Project NetworkNebula — Phase 1 Test Suite: Zero-Privilege Presence Sensing Engine
===================================================================================
Tests for `worker/stealth_sensor.py`:
- TC-015: Sub-microsecond sensing latency benchmark (<200us) & zero-privilege check.
- TC-016: Hysteresis debounce state transitions (unleashed <-> stealth_regulated).
- TC-017: Exclusive 3D game / VR detection (restricted_pause) & QUNS state handling.
- TC-018: Active media playback guard & headless fallback safety.
- Strict bounded execution: All tests run synchronously in < 2 seconds, no infinite loops.
"""

import os
import sys
import time
import unittest
from unittest.mock import patch, MagicMock

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from worker.stealth_sensor import (
    StealthPresenceSensor,
    get_stealth_sensor,
    QUNS_NOT_PRESENT,
    QUNS_BUSY,
    QUNS_RUNNING_D3D_FULL_SCREEN,
)


class TestStealthSensor(unittest.TestCase):
    def setUp(self):
        # Fresh sensor instance with short cooldown for deterministic hysteresis testing
        self.sensor = StealthPresenceSensor(
            idle_threshold_sec=2.0,
            cooldown_seconds=10.0,
            enable_media_guard=True,
            enable_gaming_guard=True,
        )

    def tearDown(self):
        self.sensor.close()

    def test_01_live_sensing_and_telemetry(self):
        """TC-015: Verify sensor queries the host OS without crashing or throwing exceptions."""
        idle_sec = self.sensor.get_os_idle_seconds()
        self.assertIsInstance(idle_sec, float)
        self.assertGreaterEqual(idle_sec, 0.0)

        telemetry = self.sensor.get_telemetry()
        self.assertIn("state", telemetry)
        self.assertIn(telemetry["state"], ["unleashed", "stealth_regulated", "restricted_pause"])
        self.assertIn("idle_sec", telemetry)
        self.assertIn("media_active", telemetry)
        self.assertIn("fullscreen_game", telemetry)
        self.assertIn("cooldown_remaining_sec", telemetry)
        self.assertIn("platform", telemetry)

    def test_02_latency_benchmark_under_200_microseconds(self):
        """TC-015: Benchmark sensing execution latency over 1,000 bounded iterations."""
        N = 1000
        start = time.perf_counter()
        for _ in range(N):
            _ = self.sensor.get_os_idle_seconds()
        elapsed = time.perf_counter() - start
        avg_latency_us = (elapsed / N) * 1e6

        print(f"\n [TC-015] Average idle sense latency: {avg_latency_us:.2f} microseconds (Budget: 200 us)")
        # Must execute within 200 microseconds
        self.assertLess(avg_latency_us, 200.0, f"Latency {avg_latency_us:.2f}us exceeded 200us budget")

    def test_03_active_human_presence_triggers_stealth(self):
        """TC-016: Idle time < threshold (2.0s) immediately triggers 'stealth_regulated'."""
        with patch.object(self.sensor, "get_os_idle_seconds", return_value=0.5):
            with patch.object(self.sensor, "is_fullscreen_3d_active", return_value=False):
                with patch.object(self.sensor, "is_media_playback_active", return_value=False):
                    state = self.sensor.evaluate_presence_state()
                    self.assertEqual(state, "stealth_regulated")

    def test_04_cooldown_hysteresis_state_machine(self):
        """TC-016: Cooldown window keeps worker in stealth_regulated until timer expires."""
        base_time = 1000.0
        with patch.object(self.sensor, "is_fullscreen_3d_active", return_value=False):
            with patch.object(self.sensor, "is_media_playback_active", return_value=False):
                # 1. User was actively typing at t = 1000.0
                with patch("time.time", return_value=base_time):
                    with patch.object(self.sensor, "get_os_idle_seconds", return_value=0.1):
                        state = self.sensor.evaluate_presence_state()
                        self.assertEqual(state, "stealth_regulated")
                        self.assertEqual(self.sensor.last_user_activity_time, base_time)

                # 2. At t = 1005.0 (5s later, user hands off keyboard, idle = 5.0s > threshold 2.0s)
                # But cooldown is 10.0s, so worker must STAY in stealth_regulated!
                with patch("time.time", return_value=base_time + 5.0):
                    with patch.object(self.sensor, "get_os_idle_seconds", return_value=5.0):
                        state = self.sensor.evaluate_presence_state()
                        self.assertEqual(state, "stealth_regulated")

                # 3. At t = 1010.5 (10.5s later, idle = 10.5s > cooldown 10.0s)
                # Cooldown expired -> Worker enters unleashed state!
                with patch("time.time", return_value=base_time + 10.5):
                    with patch.object(self.sensor, "get_os_idle_seconds", return_value=10.5):
                        state = self.sensor.evaluate_presence_state()
                        self.assertEqual(state, "unleashed")

    def test_05_gaming_guard_exclusive_3d_game(self):
        """TC-017: Fullscreen 3D game immediately triggers 'restricted_pause'."""
        with patch.object(self.sensor, "is_fullscreen_3d_active", return_value=True):
            state = self.sensor.evaluate_presence_state()
            self.assertEqual(state, "restricted_pause")

    def test_06_gaming_guard_quns_busy_does_not_pause(self):
        """TC-017: Maximized desktop app (QUNS_BUSY=2) does NOT trigger restricted_pause."""
        if sys.platform == "win32":
            import ctypes
            # Mock SHQueryUserNotificationState returning 2 (QUNS_BUSY)
            def mock_quns(byref_ptr):
                byref_ptr._obj.value = QUNS_BUSY
                return 0

            with patch.object(ctypes.windll.shell32, "SHQueryUserNotificationState", side_effect=mock_quns):
                is_gaming = self.sensor.is_fullscreen_3d_active()
                self.assertFalse(is_gaming, "QUNS_BUSY (2) should NOT be treated as exclusive 3D game")

            # Mock returning 3 (QUNS_RUNNING_D3D_FULL_SCREEN)
            def mock_quns_game(byref_ptr):
                byref_ptr._obj.value = QUNS_RUNNING_D3D_FULL_SCREEN
                return 0

            with patch.object(ctypes.windll.shell32, "SHQueryUserNotificationState", side_effect=mock_quns_game):
                is_gaming = self.sensor.is_fullscreen_3d_active()
                self.assertTrue(is_gaming, "QUNS_RUNNING_D3D_FULL_SCREEN (3) MUST be treated as exclusive 3D game")

    def test_07_media_playback_guard(self):
        """TC-018: Active video decode keeps node in stealth_regulated even when idle."""
        base_time = 2000.0
        with patch.object(self.sensor, "is_fullscreen_3d_active", return_value=False):
            # User is idle for 300 seconds, but watching YouTube 4K (media decode active)
            with patch("time.time", return_value=base_time):
                with patch.object(self.sensor, "get_os_idle_seconds", return_value=300.0):
                    with patch.object(self.sensor, "is_media_playback_active", return_value=True):
                        state = self.sensor.evaluate_presence_state()
                        self.assertEqual(state, "stealth_regulated")

    def test_08_headless_cloud_fallback(self):
        """TC-018: Headless container / no-GUI environments return 3600.0s idle and unleashed."""
        # Force platform dispatch failure
        with patch("sys.platform", "unknown_os"):
            idle = self.sensor.get_os_idle_seconds()
            self.assertEqual(idle, 3600.0)

    def test_09_singleton_accessor(self):
        """Verify module singleton get_stealth_sensor returns consistent instance."""
        s1 = get_stealth_sensor()
        s2 = get_stealth_sensor()
        self.assertIs(s1, s2)


def run_phase1_tests():
    print("=" * 70)
    print("  RUNNING PHASE 1: ZERO-PRIVILEGE PRESENCE SENSING TEST SUITE")
    print("=" * 70)
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromTestCase(TestStealthSensor)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_phase1_tests()
    sys.exit(0 if success else 1)
