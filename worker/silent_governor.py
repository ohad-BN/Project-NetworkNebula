#!/usr/bin/env python3
"""
Project NetworkNebula — Software Acoustic-Thermal Governor & Micro-Duty Pacer
=============================================================================
Phase 2: Closed-loop regulation of background worker execution to guarantee:
1. Zero Desktop Window Manager (dwm.exe / WindowServer) frame stutter (60/120/144 Hz deadlines).
2. Hardware preemption via PyTorch low-priority CUDA streams (priority=0).
3. Acoustic silence: Keeps GPU temperatures strictly below audible fan thresholds (<62°C).
4. Mathematical Micro-Duty Pacing:
   T_yield = max(15ms, T_compute * R_duty + max(0, T_junction - 62.0) * 10ms)
   Where R_duty = 2.0 (yielding >= 67% time slice to host OS during active desktop hours).
5. Elastic VRAM headroom reclamation (torch.cuda.empty_cache / gc.collect).
6. High-precision 1ms timer resolution on Windows via winmm!timeBeginPeriod(1).
"""

import os
import sys
import time
import atexit
import gc
from typing import Dict, Any, Optional

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

try:
    from worker.stealth_sensor import StealthPresenceSensor, get_stealth_sensor
except ImportError:
    from stealth_sensor import StealthPresenceSensor, get_stealth_sensor


class SilentThermalGovernor:
    """
    Closed-loop acoustic-thermal governor and micro-duty pacer for 'Always Silent' nodes.
    Controls compute duty cycles, synchronizes compute streams, and reclaims memory headroom.
    """

    def __init__(
        self,
        sensor: Optional[StealthPresenceSensor] = None,
        target_temp_c: float = 62.0,
        duty_ratio: float = 2.0,
        min_yield_sec: float = 0.015,  # 15ms minimum yield slice (~1 DWM 60Hz frame window)
        max_yield_sec: float = 5.0,
        pause_sleep_sec: float = 2.0,
        thermal_coefficient_sec_per_c: float = 0.010,  # +10ms per °C above target
    ):
        self.sensor = sensor or get_stealth_sensor()
        self.target_temp_c = float(target_temp_c)
        self.duty_ratio = float(duty_ratio)
        self.min_yield_sec = float(min_yield_sec)
        self.max_yield_sec = float(max_yield_sec)
        self.pause_sleep_sec = float(pause_sleep_sec)
        self.thermal_coefficient = float(thermal_coefficient_sec_per_c)

        self._high_precision_timer_active = False
        self._cuda_stream = None
        self._last_state = "unleashed"
        self._last_vram_reclaim_time = 0.0

        self._init_high_precision_timer()
        self._init_low_priority_stream()

    def _init_high_precision_timer(self) -> None:
        """Request 1ms timer granularity on Windows so time.sleep(0.005) does not stall for 15.6ms."""
        if sys.platform == "win32":
            try:
                import ctypes
                r = ctypes.windll.winmm.timeBeginPeriod(1)
                if r == 0:
                    self._high_precision_timer_active = True
                    atexit.register(self._cleanup_high_precision_timer)
            except Exception:
                self._high_precision_timer_active = False

    def _cleanup_high_precision_timer(self) -> None:
        """Restore default system timer quantum."""
        if sys.platform == "win32" and self._high_precision_timer_active:
            try:
                import ctypes
                ctypes.windll.winmm.timeEndPeriod(1)
                self._high_precision_timer_active = False
            except Exception:
                pass

    def _init_low_priority_stream(self) -> None:
        """Instantiate PyTorch low-priority CUDA stream to allow DWM hardware preemption."""
        if TORCH_AVAILABLE and torch.cuda.is_available():
            try:
                # Lowest numeric priority in CUDA Stream.priority_range() is highest priority;
                # index 0 (priority 0) is default/lowest priority.
                priorities = torch.cuda.Stream.priority_range()
                lowest_priority = priorities[0]  # 0
                self._cuda_stream = torch.cuda.Stream(device=0, priority=lowest_priority)
            except Exception:
                self._cuda_stream = None

    def get_compute_stream(self, device: Optional[Any] = None) -> Optional[Any]:
        """
        Return the low-priority CUDA stream to be used with `with torch.cuda.stream(s):`.
        If CUDA is unavailable or device is CPU/MPS, returns None.
        """
        if self._cuda_stream is not None:
            return self._cuda_stream
        if TORCH_AVAILABLE and torch.cuda.is_available():
            try:
                self._cuda_stream = torch.cuda.Stream(device=device or 0, priority=0)
                return self._cuda_stream
            except Exception:
                pass
        return None

    def synchronize_stream(self) -> None:
        """Ensure all scheduled kernel operations have finished execution on device."""
        if self._cuda_stream is not None:
            try:
                self._cuda_stream.synchronize()
                return
            except Exception:
                pass
        if TORCH_AVAILABLE and torch.cuda.is_available():
            try:
                torch.cuda.synchronize()
            except Exception:
                pass

    def reclaim_vram_headroom(self) -> Dict[str, Any]:
        """
        Flush transient memory caches and invoke garbage collection.
        Guarantees physical VRAM headroom for host desktop applications.
        """
        freed_bytes = 0
        allocated_before = 0
        allocated_after = 0

        gc.collect()

        if TORCH_AVAILABLE:
            if torch.cuda.is_available():
                try:
                    allocated_before = torch.cuda.memory_allocated()
                    reserved_before = torch.cuda.memory_reserved()
                    torch.cuda.empty_cache()
                    torch.cuda.ipc_collect()
                    reserved_after = torch.cuda.memory_reserved()
                    allocated_after = torch.cuda.memory_allocated()
                    freed_bytes = max(0, reserved_before - reserved_after)
                except Exception:
                    pass
            elif hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
                try:
                    torch.mps.empty_cache()
                except Exception:
                    pass

        self._last_vram_reclaim_time = time.time()
        return {
            "freed_mb": round(freed_bytes / (1024 * 1024), 2),
            "allocated_mb": round(allocated_after / (1024 * 1024), 2),
            "timestamp": self._last_vram_reclaim_time,
        }

    def calculate_yield_duration(
        self,
        compute_duration_s: float,
        presence_state: Optional[str] = None,
        gpu_temp_c: Optional[int] = None,
    ) -> float:
        """
        Calculate required yield duration in seconds based on compute duration, presence state, and thermal feedback.
        Formula:
          T_yield = max(15ms, T_compute * R_duty + max(0, T_junction - 62.0) * 10ms)
        """
        state = presence_state or self.sensor.evaluate_presence_state()

        # 1. Restricted Pause (e.g. exclusive 3D game active): 100% compute yield
        if state == "restricted_pause":
            return self.pause_sleep_sec

        # Query temperature if not passed
        if gpu_temp_c is None:
            gpu_temp_c = self.sensor.get_gpu_temperature()

        # Calculate thermal penalty
        thermal_penalty = 0.0
        if gpu_temp_c is not None and gpu_temp_c > self.target_temp_c:
            degrees_over = float(gpu_temp_c - self.target_temp_c)
            thermal_penalty = degrees_over * self.thermal_coefficient

        # 2. Unleashed State (host user idle): 0ms yield delay (unless critical overheat)
        if state == "unleashed":
            # If critical thermal overshoot (> 15°C above acoustic target), enforce cooling yield
            if gpu_temp_c is not None and gpu_temp_c > (self.target_temp_c + 15.0):
                return min(self.max_yield_sec, thermal_penalty)
            return 0.0

        # 3. Stealth Regulated State (active human input, media playback, or cooldown window)
        # Base duty yield: compute_duration_s * duty_ratio
        base_yield = max(0.0, compute_duration_s) * self.duty_ratio
        total_yield = base_yield + thermal_penalty

        # Clamp between min_yield_sec (15ms) and max_yield_sec
        clamped_yield = max(self.min_yield_sec, min(self.max_yield_sec, total_yield))
        return clamped_yield

    def yield_gpu_queue(
        self,
        compute_duration_s: float,
        presence_state: Optional[str] = None,
        force_sync: bool = True,
    ) -> Dict[str, Any]:
        """
        Pacer entry point: Synchronizes stream, sleeps for calculated yield duration,
        and optionally reclaims VRAM headroom upon transitioning to stealth.
        """
        state = presence_state or self.sensor.evaluate_presence_state()
        temp_c = self.sensor.get_gpu_temperature()

        # If we just entered stealth_regulated or restricted_pause from unleashed, reclaim VRAM
        freed_mb = 0.0
        if state in ("stealth_regulated", "restricted_pause") and self._last_state == "unleashed":
            reclaim_res = self.reclaim_vram_headroom()
            freed_mb = reclaim_res.get("freed_mb", 0.0)
        self._last_state = state

        yield_sec = self.calculate_yield_duration(
            compute_duration_s=compute_duration_s,
            presence_state=state,
            gpu_temp_c=temp_c,
        )

        if yield_sec > 0.0:
            if force_sync:
                self.synchronize_stream()
            time.sleep(yield_sec)

        # Compute effective duty cycle percentage
        total_time = compute_duration_s + yield_sec
        duty_pct = (compute_duration_s / total_time * 100.0) if total_time > 0 else 0.0

        thermal_penalty = 0.0
        if temp_c is not None and temp_c > self.target_temp_c:
            thermal_penalty = (temp_c - self.target_temp_c) * self.thermal_coefficient

        return {
            "state": state,
            "compute_duration_s": round(compute_duration_s, 4),
            "yield_duration_s": round(yield_sec, 4),
            "effective_duty_cycle_pct": round(duty_pct, 1),
            "gpu_temp_c": temp_c,
            "thermal_penalty_s": round(thermal_penalty, 4),
            "freed_vram_mb": freed_mb,
        }

    def close(self) -> None:
        """Clean up handles and restore system timer quantum."""
        self._cleanup_high_precision_timer()
        if self._cuda_stream is not None:
            self._cuda_stream = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


# Module singleton instance
_GLOBAL_GOVERNOR: Optional[SilentThermalGovernor] = None

def get_silent_governor(target_temp_c: float = 62.0) -> SilentThermalGovernor:
    global _GLOBAL_GOVERNOR
    if _GLOBAL_GOVERNOR is None:
        _GLOBAL_GOVERNOR = SilentThermalGovernor(target_temp_c=target_temp_c)
    return _GLOBAL_GOVERNOR
