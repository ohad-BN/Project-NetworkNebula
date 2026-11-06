"""
Unit tests for app/system_router.py (System & Remote Server Management)
Verifies:
- GET /api/v1/system/status returns 200 with valid git info, resource metrics, and cluster overview.
- GET /api/v1/system/check-update returns 200 and valid schema.
- GET /api/v1/system/remote-access-guide returns 200 and valid guidance.
"""

import os
import sys
import unittest
import uuid

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models import User, Worker


class TestSystemRouter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.db = SessionLocal()

        # Seed a test admin user for authenticated endpoints
        cls.test_key = f"adm_key_{uuid.uuid4().hex[:12]}"
        cls.test_secret = f"adm_sec_{uuid.uuid4().hex[:12]}"
        cls.admin_user = User(
            id=f"adm-{uuid.uuid4().hex[:6]}",
            email=f"admin_{uuid.uuid4().hex[:4]}@nebula.ai",
            api_key=cls.test_key,
            api_secret=cls.test_secret,
            is_active=True,
        )
        cls.db.add(cls.admin_user)
        cls.db.commit()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.delete(cls.admin_user)
            cls.db.commit()
        except Exception:
            pass
        finally:
            cls.db.close()

    def test_01_get_system_status(self):
        """Verify GET /api/v1/system/status returns 200 and populated system introspection."""
        res = self.client.get("/api/v1/system/status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("uptime_seconds", data)
        self.assertIn("uptime_human", data)
        self.assertIn("git", data)
        self.assertIn("commit", data["git"])
        self.assertIn("branch", data["git"])
        self.assertIn("resources", data)
        self.assertIn("cpu_percent", data["resources"])
        self.assertIn("memory_percent", data["resources"])
        self.assertIn("cluster_overview", data)

    def test_02_get_check_update(self):
        """Verify GET /api/v1/system/check-update returns 200 and update status schema."""
        res = self.client.get("/api/v1/system/check-update")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("update_available", data)
        self.assertIn("local_commit", data)
        self.assertIn("commits_behind", data)

    def test_03_get_remote_access_guide(self):
        """Verify GET /api/v1/system/remote-access-guide provides browser accessibility instructions."""
        res = self.client.get("/api/v1/system/remote-access-guide")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("hostname", data)
        self.assertIn("local_network_urls", data)
        self.assertIn("tailscale_funnel_public_instructions", data)

    def test_04_apply_update_auth(self):
        """Verify POST /api/v1/system/update requires valid authentication."""
        # Unauthenticated attempt should fail with 401
        res = self.client.post("/api/v1/system/update")
        self.assertEqual(res.status_code, 401)

        # Authenticated attempt with Bearer token
        res_auth = self.client.post(
            "/api/v1/system/update",
            headers={"Authorization": f"Bearer {self.test_key}"},
        )
        # Should succeed or return clean git message
        self.assertIn(res_auth.status_code, (200, 500))
        if res_auth.status_code == 200:
            data = res_auth.json()
            self.assertIn("success", data)
            self.assertIn("new_commit", data)


def run_system_tests() -> bool:
    suite = unittest.TestLoader().loadTestsFromTestCase(TestSystemRouter)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    import sys
    sys.exit(0 if run_system_tests() else 1)
