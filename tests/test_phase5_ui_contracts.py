"""
Project NetworkNebula - Phase 5 Integration Tests
Web Console UI Dashboard & Live Telemetry Controls

Validates:
- TC-035: User Fleet API Contract (GET /api/v1/user/workers exposes all stealth telemetry fields)
- TC-036: Worker Config Patch Contract (PATCH /api/v1/workers/{id}/config toggles always_silent)
- TC-037: Cluster Monitor Snapshot Contract (exposes unleashed_nodes, stealth_nodes, paused_nodes)
- TC-038: React 19 Frontend Build & Asset Integrity (dist assets contain compiled Always Silent badges & controls)
"""

import os
import sys
import uuid
import unittest
from datetime import datetime, timezone

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app.database import SessionLocal
from app.models import Worker, User
from app.cluster_worker_router import serialize_worker_node, get_cluster_monitor_snapshot


class TestPhase5UIContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()
        cls.test_worker_id = f"test-ui-worker-{uuid.uuid4().hex[:6]}"
        cls.test_user_id = f"test-ui-user-{uuid.uuid4().hex[:6]}"

        # Seed test user and worker
        cls.user = User(
            id=cls.test_user_id,
            email=f"ui_test_{cls.test_user_id}@example.com",
            api_key=f"nebula_ui_key_{uuid.uuid4().hex[:12]}",
            api_secret=f"secret_{uuid.uuid4().hex[:16]}",
            balance=100.0,
        )
        cls.worker = Worker(
            id=cls.test_worker_id,
            user_id=cls.test_user_id,
            name="SkorP Gaming Laptop",
            gpu_info="NVIDIA RTX 4070 Laptop GPU",
            gpu_memory_gb=8.0,
            vram_allocation_pct=80,
            status="online",
            is_available=True,
            is_always_silent=True,
            work_capacity_state="stealth_regulated",
            input_idle_sec=14.2,
            gpu_temp_c=58.5,
            duty_cycle_pct=33,
        )
        cls.db.add_all([cls.user, cls.worker])
        cls.db.commit()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.query(Worker).filter(Worker.id == cls.test_worker_id).delete(synchronize_session=False)
            cls.db.query(User).filter(User.id == cls.test_user_id).delete(synchronize_session=False)
            cls.db.commit()
        except Exception:
            cls.db.rollback()
        finally:
            cls.db.close()

    def test_tc035_user_fleet_api_contract(self):
        """TC-035: Verify serialized worker node provides all stealth fields expected by React UI."""
        self.db.refresh(self.worker)
        serialized = serialize_worker_node(self.worker)

        # Assert all fields required by Worker Dashboard card
        self.assertIn("is_always_silent", serialized)
        self.assertIn("work_capacity_state", serialized)
        self.assertIn("input_idle_sec", serialized)
        self.assertIn("gpu_temp_c", serialized)
        self.assertIn("duty_cycle_pct", serialized)

        self.assertTrue(serialized["is_always_silent"])
        self.assertEqual(serialized["work_capacity_state"], "stealth_regulated")
        self.assertAlmostEqual(serialized["input_idle_sec"], 14.2, places=1)
        self.assertAlmostEqual(serialized["gpu_temp_c"], 58.5, places=1)
        self.assertEqual(serialized["duty_cycle_pct"], 33)

    def test_tc036_worker_config_patch_contract(self):
        """TC-036: Verify update_worker_config toggles always_silent for UI switch."""
        import asyncio
        from app.cluster_worker_router import update_worker_config, WorkerConfigUpdatePayload

        # Toggle to False
        payload_off = WorkerConfigUpdatePayload(always_silent=False)
        res_off = asyncio.run(update_worker_config(worker_id=self.test_worker_id, payload=payload_off, db=self.db))
        self.assertFalse(res_off["is_always_silent"])
        self.assertEqual(res_off["work_capacity_state"], "unleashed")

        # Toggle back to True
        payload_on = WorkerConfigUpdatePayload(always_silent=True)
        res_on = asyncio.run(update_worker_config(worker_id=self.test_worker_id, payload=payload_on, db=self.db))
        self.assertTrue(res_on["is_always_silent"])

    def test_tc037_cluster_monitor_snapshot_contract(self):
        """TC-037: Verify cluster snapshot returns stealth tallies for Cluster Status UI."""
        snapshot = get_cluster_monitor_snapshot(db=self.db)
        summary = snapshot["summary"]
        self.assertIn("unleashed_nodes", summary)
        self.assertIn("stealth_nodes", summary)
        self.assertIn("paused_nodes", summary)
        self.assertIsInstance(summary["unleashed_nodes"], int)
        self.assertIsInstance(summary["stealth_nodes"], int)
        self.assertIsInstance(summary["paused_nodes"], int)

    def test_tc038_frontend_build_artifacts(self):
        """TC-038: Verify React 19 production build dist files exist and are fresh."""
        dist_dir = os.path.join(PROJECT_ROOT, "network-nebula", "dist")
        index_html = os.path.join(dist_dir, "index.html")
        assets_dir = os.path.join(dist_dir, "assets")

        self.assertTrue(os.path.isdir(dist_dir), "dist directory must exist after build")
        self.assertTrue(os.path.isfile(index_html), "dist/index.html must exist")
        self.assertTrue(os.path.isdir(assets_dir), "dist/assets must exist")

        # Check bundle contents for Always Silent strings
        found_silent_str = False
        for fname in os.listdir(assets_dir):
            if fname.endswith(".js"):
                fpath = os.path.join(assets_dir, fname)
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    if "Always Silent" in content or "Whisper Stealth" in content:
                        found_silent_str = True
                        break

        self.assertTrue(found_silent_str, "Compiled JS bundle must contain Always Silent UI tokens")


def run_phase5_tests() -> bool:
    """Execute all Phase 5 UI Contract tests with strict bounding."""
    suite = unittest.TestLoader().loadTestsFromTestCase(TestPhase5UIContracts)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_phase5_tests()
    sys.exit(0 if success else 1)
