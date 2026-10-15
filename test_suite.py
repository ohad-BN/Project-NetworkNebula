#!/usr/bin/env python3
"""
PROJECT NETWORK NEBULA - THE MASTER UNIFIED TEST SUITE
======================================================
Single authoritative test runner for all project phases.
Maintained and updated at every phase.
"""

import sys
import os
import time
import uuid
import json
from pathlib import Path
import urllib.request
import urllib.error
import requests
import logging
import warnings

# Silence noisy SQL loggers and deprecation warnings
warnings.filterwarnings("ignore")
for log_name in ["sqlalchemy", "sqlalchemy.engine", "sqlalchemy.pool"]:
    l = logging.getLogger(log_name)
    l.setLevel(logging.WARNING)
    l.propagate = False

# Terminal Colors
class C:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
    BLUE = "\033[94m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"

def print_header(title):
    print(f"\n{C.CYAN}{C.BOLD}{'='*65}{C.RESET}")
    print(f"{C.CYAN}{C.BOLD}   {title}{C.RESET}")
    print(f"{C.CYAN}{C.BOLD}{'='*65}{C.RESET}\n")

def print_test(name, passed, detail=""):
    mark = f"{C.GREEN}[PASS]{C.RESET}" if passed else f"{C.RED}[FAIL]{C.RESET}"
    msg = f" {detail}" if detail else ""
    print(f" {mark} {name}{C.DIM}{msg}{C.RESET}")

class TestSuite:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.start_time = time.time()

    def record(self, passed, name, detail=""):
        if passed is None:
            self.skipped += 1
            print(f" {C.YELLOW}[SKIP]{C.RESET} {name} {C.DIM}({detail}){C.RESET}")
        elif passed:
            self.passed += 1
            print_test(name, True, detail)
        else:
            self.failed += 1
            print_test(name, False, detail)

    def summary(self):
        elapsed = time.time() - self.start_time
        print(f"\n{C.BOLD}{'-'*65}{C.RESET}")
        print(f"{C.BOLD}TEST SUMMARY:{C.RESET}")
        print(f"  Passed:  {C.GREEN}{self.passed}{C.RESET}")
        print(f"  Failed:  {C.RED}{self.failed}{C.RESET}")
        print(f"  Skipped: {C.YELLOW}{self.skipped}{C.RESET}")
        print(f"  Duration: {elapsed:.2f}s")
        print(f"{C.BOLD}{'-'*65}{C.RESET}\n")
        return self.failed == 0

def run_tests():
    print_header("NETWORK NEBULA — MASTER UNIFIED TEST SUITE")
    suite = TestSuite()

    # =========================================================================
    # PHASE 1: CORE ARCHITECTURE, AUTH & MODELS
    # =========================================================================
    print(f"{C.BLUE}{C.BOLD}Phase 1: Architecture, Auth & Models{C.RESET}")
    
    # 1.1 Python Modules
    required_mods = ["fastapi", "sqlalchemy", "pydantic", "celery", "redis", "boto3", "PIL", "torch", "psycopg"]
    for mod in required_mods:
        try:
            __import__(mod)
            suite.record(True, f"Module '{mod}' available")
        except ImportError as e:
            suite.record(False, f"Module '{mod}' available", str(e))

    # 1.2 Authentication Module
    try:
        from app.auth import create_api_key_pair, hash_password, verify_password
        k, s = create_api_key_pair()
        h = hash_password("TestSecret123!")
        v = verify_password("TestSecret123!", h)
        suite.record(v and len(k) > 10, "Auth module (key generation & sha256_crypt verification)")
    except Exception as e:
        suite.record(False, "Auth module integrity", str(e))

    # 1.3 Database Models
    try:
        from app.models import User, Task, Worker, Transaction, TaskStatus, TaskType
        suite.record(True, "Database ORM Models (User, Task, Worker, Transaction)")
    except Exception as e:
        suite.record(False, "Database ORM Models", str(e))

    # 1.4 Pricing Calculations
    try:
        from app.main import calculate_task_cost
        cost = calculate_task_cost(512, 512, 20)
        expected = round((512*512/1000000) * 20 * 0.001, 4)
        suite.record(cost == expected, f"Pricing calculation (512x512, 20 steps = ${cost})")
    except Exception as e:
        suite.record(False, "Pricing calculation", str(e))

    # =========================================================================
    # PHASE 2: API BRIDGE ROUTER (FRONTEND COMPATIBILITY)
    # =========================================================================
    print(f"\n{C.BLUE}{C.BOLD}Phase 2: Frontend Compatibility API Bridge{C.RESET}")

    try:
        from app.api_router import api_router
        routes = [r.path for r in api_router.routes]
        has_post_tasks = "/api/tasks" in routes
        has_get_tasks = "/api/tasks/{task_id}" in routes
        has_balance = "/api/wallet/balance" in routes
        has_deposit = "/api/wallet/deposit" in routes
        has_trans = "/api/wallet/transactions" in routes
        
        suite.record(has_post_tasks and has_get_tasks, "Bridge Tasks API (/api/tasks, /api/tasks/{id})")
        suite.record(has_balance and has_deposit and has_trans, "Bridge Wallet API (/api/wallet/balance, deposit, transactions)")
    except Exception as e:
        suite.record(False, "Bridge Router integrity", str(e))

    # Check main app mounts
    try:
        from app.main import app
        main_routes = []
        for r in app.routes:
            if hasattr(r, "path"):
                main_routes.append(r.path)
            elif hasattr(r, "routes"):
                main_routes.extend([getattr(sub_r, "path", "") for sub_r in r.routes])
            elif hasattr(r, "original_router"):
                main_routes.extend([getattr(sub_r, "path", "") for sub_r in r.original_router.routes])

        has_auth_me = "/auth/me" in main_routes
        has_auth_verify = "/auth/verify" in main_routes
        has_bridge = any(p.startswith("/api/tasks") for p in main_routes)
        suite.record(has_auth_me and has_auth_verify, "Main App Auth routes (/auth/me, /auth/verify)")
        suite.record(has_bridge, "Main App mounts api_router (/api/...)")
    except Exception as e:
        suite.record(False, "Main App routes", str(e))

    # =========================================================================
    # PHASE 3: LIVE INFRASTRUCTURE HEALTH (CONTAINERS, DB, REDIS, MINIO, API)
    # =========================================================================
    print(f"\n{C.BLUE}{C.BOLD}Phase 3: Live Infrastructure & Service Connectivity{C.RESET}")

    # 3.1 Live PostgreSQL Connectivity
    try:
        from app.config import settings
        from app.database import engine, Base
        import app.models
        from sqlalchemy import text
        with engine.connect() as conn:
            res = conn.execute(text("SELECT 1")).scalar()
            suite.record(res == 1, "Live PostgreSQL database connection (port 5433)")
    except Exception as e:
        suite.record(False, "Live PostgreSQL database connection", str(e))

    # 3.2 Live Redis Connectivity
    try:
        import redis
        r = redis.from_url(settings.REDIS_URL, socket_timeout=2)
        r.ping()
        suite.record(True, "Live Redis task queue connection (port 6379)")
    except Exception as e:
        suite.record(False, "Live Redis connection", str(e))

    # 3.3 Live MinIO S3 Object Storage Connectivity & Bucket Check
    try:
        from app.storage import get_storage
        storage = get_storage()
        storage.ensure_bucket_exists()
        suite.record(True, f"Live MinIO S3 storage connected & bucket '{storage.bucket}' ready (port 9000)")
    except Exception as e:
        suite.record(False, "Live MinIO S3 storage", str(e))

    # 3.4 Live FastAPI Orchestrator /health Endpoint
    api_online = False
    try:
        req = urllib.request.Request("http://localhost:8000/health")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            if data.get("status") == "healthy":
                api_online = True
                suite.record(True, "Live FastAPI Orchestrator running & healthy (http://localhost:8000/health)")
            else:
                suite.record(False, "Live FastAPI /health returned non-healthy", str(data))
    except Exception as e:
        suite.record(False, "Live FastAPI Orchestrator running", str(e))

    # 3.5 Live User Registration & Auth Check
    if api_online:
        try:
            test_email = f"poc_user_{uuid.uuid4().hex[:6]}@nebula.ai"
            reg_data = json.dumps({
                "email": test_email,
                "password": "Password123!",
                "confirm_password": "Password123!",
                "role": "creator"
            }).encode()
            req = urllib.request.Request(
                "http://localhost:8000/auth/register",
                data=reg_data,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                reg_res = json.loads(resp.read().decode())
                api_key = reg_res.get("api_key")
                api_secret = reg_res.get("api_secret")
                user_balance = reg_res.get("user", {}).get("balance", 0)
                suite.record(bool(api_key), f"Live user registration ({test_email}, initial balance=${user_balance:.2f})")

                # Verify GET /auth/me
                me_req = urllib.request.Request(
                    "http://localhost:8000/auth/me",
                    headers={"X-API-Key": api_key, "X-API-Secret": api_secret}
                )
                with urllib.request.urlopen(me_req, timeout=3) as me_resp:
                    me_res = json.loads(me_resp.read().decode())
                    suite.record(me_res.get("email") == test_email, "Live GET /auth/me authentication verified")

                # Verify GET /api/wallet/balance
                bal_req = urllib.request.Request(
                    "http://localhost:8000/api/wallet/balance",
                    headers={"X-API-Key": api_key, "X-API-Secret": api_secret}
                )
                with urllib.request.urlopen(bal_req, timeout=3) as bal_resp:
                    bal_res = json.loads(bal_resp.read().decode())
                    suite.record("balance" in bal_res, f"Live GET /api/wallet/balance: ${bal_res.get('balance'):.2f}")

                # Verify POST /api/wallet/deposit
                dep_data = json.dumps({"amount": 10.0, "payment_method": "Credit Card"}).encode()
                dep_req = urllib.request.Request(
                    "http://localhost:8000/api/wallet/deposit",
                    data=dep_data,
                    headers={"Content-Type": "application/json", "X-API-Key": api_key, "X-API-Secret": api_secret}
                )
                with urllib.request.urlopen(dep_req, timeout=3) as dep_resp:
                    dep_res = json.loads(dep_resp.read().decode())
                    suite.record(dep_res.get("amount") == 10.0, f"Live POST /api/wallet/deposit ($10.00 credited)")

                # Verify POST /api/tasks (submission)
                task_payload = json.dumps({
                    "prompt": "Cyberpunk nebula city at night",
                    "width": 512,
                    "height": 512,
                    "steps": 20
                }).encode()
                t_req = urllib.request.Request(
                    "http://localhost:8000/api/tasks",
                    data=task_payload,
                    headers={"Content-Type": "application/json", "X-API-Key": api_key, "X-API-Secret": api_secret}
                )
                with urllib.request.urlopen(t_req, timeout=3) as t_resp:
                    t_res = json.loads(t_resp.read().decode())
                    task_id = t_res.get("id") or t_res.get("task_id")
                    suite.record(bool(task_id), f"Live POST /api/tasks submitted (ID: {task_id[:12]}...)")

                    # Verify GET /api/tasks/{id} (status polling)
                    status_req = urllib.request.Request(f"http://localhost:8000/api/tasks/{task_id}")
                    with urllib.request.urlopen(status_req, timeout=3) as s_resp:
                        s_res = json.loads(s_resp.read().decode())
                        suite.record(s_res.get("status") in ["pending", "processing", "completed"], 
                                     f"Live GET /api/tasks/{task_id[:12]}... status: '{s_res.get('status')}'")
        except Exception as e:
            suite.record(False, "Live API user & task integration test", str(e))
    else:
        suite.record(None, "Live user registration & task integration", "FastAPI server offline")

    # =========================================================================
    # PHASE 4: WORKER ENGINE, LIVE RENDERING & HOST REVENUE SHARE
    # =========================================================================
    print(f"\n{C.BLUE}{C.BOLD}Phase 4: Worker Engine, Live Rendering & Revenue Share{C.RESET}")

    # 4.1 Worker Task registration
    try:
        from app.worker import celery_app, render_image
        suite.record(render_image.name == "render_image", "Celery Task registered ('render_image')")
    except Exception as e:
        suite.record(False, "Celery task registration", str(e))

    # 4.2 GPU & Hardware Compute Detection
    try:
        from importlib.util import spec_from_file_location, module_from_spec
        spec = spec_from_file_location("worker_mod", "worker-client/worker.py")
        worker_mod = module_from_spec(spec)
        spec.loader.exec_module(worker_mod)
        gpus = worker_mod.GPUInfo.detect_gpu()
        gpu_name = gpus[0]["name"] if gpus else "CPU Fallback"
        suite.record(True, f"Hardware Compute Detection: {gpu_name} ({len(gpus)} GPU(s))")
    except Exception as e:
        suite.record(False, "Hardware detection", str(e))

    # 4.3 Frontend production bundle
    dist_index = os.path.join("network-nebula", "dist", "index.html")
    dist_assets = os.path.join("network-nebula", "dist", "assets")
    if os.path.exists(dist_index) and os.path.exists(dist_assets):
        css_files = [f for f in os.listdir(dist_assets) if f.endswith(".css")]
        js_files = [f for f in os.listdir(dist_assets) if f.endswith(".js")]
        suite.record(len(css_files) > 0 and len(js_files) > 0, 
                     f"Frontend production bundle ready ({len(js_files)} JS, {len(css_files)} CSS chunks)")
    else:
        suite.record(False, "Frontend production bundle", "Run 'bun run build' in network-nebula")

    # 4.4 Live End-to-End Render & Host Revenue Payout
    if api_online:
        try:
            from app.database import SessionLocal
            from app.models import User, Transaction, TransactionType

            # Ensure a Host Worker exists in the database
            db = SessionLocal()
            try:
                worker_user = db.query(User).filter(User.is_worker == True).first()
                if not worker_user:
                    # Register a worker user
                    w_email = f"worker_{uuid.uuid4().hex[:6]}@nebula.ai"
                    w_reg_data = json.dumps({
                        "email": w_email,
                        "password": "Password123!",
                        "confirm_password": "Password123!",
                        "role": "worker"
                    }).encode()
                    w_req = urllib.request.Request(
                        "http://localhost:8000/auth/register",
                        data=w_reg_data,
                        headers={"Content-Type": "application/json"}
                    )
                    with urllib.request.urlopen(w_req, timeout=3) as w_resp:
                        pass
                    worker_user = db.query(User).filter(User.is_worker == True).first()

                worker_initial_balance = worker_user.balance
                worker_id = worker_user.id
            finally:
                db.close()

            suite.record(bool(worker_user), f"Host Worker active (Initial balance: ${worker_initial_balance:.4f})")

            # Register or use Creator to submit render task
            c_email = f"creator_{uuid.uuid4().hex[:6]}@nebula.ai"
            c_reg_data = json.dumps({
                "email": c_email,
                "password": "Password123!",
                "confirm_password": "Password123!",
                "role": "creator"
            }).encode()
            c_req = urllib.request.Request(
                "http://localhost:8000/auth/register",
                data=c_reg_data,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(c_req, timeout=3) as c_resp:
                c_res = json.loads(c_resp.read().decode())
                c_key = c_res.get("api_key")
                c_secret = c_res.get("api_secret")

            task_payload = json.dumps({
                "prompt": "Phase 4 PoC: Deep space supernova glowing purple nebula",
                "width": 512,
                "height": 512,
                "steps": 20
            }).encode()
            t_req = urllib.request.Request(
                "http://localhost:8000/api/tasks",
                data=task_payload,
                headers={"Content-Type": "application/json", "X-API-Key": c_key, "X-API-Secret": c_secret}
            )
            with urllib.request.urlopen(t_req, timeout=3) as t_resp:
                task_res = json.loads(t_resp.read().decode())
                task_id = task_res.get("id") or task_res.get("task_id")
                task_cost = task_res.get("cost", 0.0052)

            suite.record(bool(task_id), f"Prompt submitted for compute dispatch (Task: {task_id[:12]}...)")

            # Poll for Celery Worker to process and complete
            final_status = None
            output_url = None
            for _ in range(12):
                time.sleep(1)
                st_req = urllib.request.Request(f"http://localhost:8000/api/tasks/{task_id}")
                with urllib.request.urlopen(st_req, timeout=3) as st_resp:
                    st_data = json.loads(st_resp.read().decode())
                    final_status = st_data.get("status")
                    output_url = st_data.get("output_url")
                    if final_status == "completed":
                        break

            suite.record(final_status == "completed", f"Worker rendered task to completion (status: {final_status})")
            suite.record(bool(output_url) and "nebula-renders" in str(output_url), 
                         f"Render uploaded to MinIO S3 ({output_url})")

            # 4.5 Verify Image Content Downloadable from MinIO S3
            if output_url:
                try:
                    img_req = urllib.request.Request(output_url)
                    with urllib.request.urlopen(img_req, timeout=5) as img_resp:
                        img_bytes = img_resp.read()
                        is_png = img_bytes.startswith(b"\x89PNG\r\n\x1a\n")
                        suite.record(is_png and len(img_bytes) > 500, 
                                     f"MinIO S3 image artifact verified (PNG format, {len(img_bytes)} bytes)")
                except Exception as e:
                    suite.record(False, "MinIO S3 image retrieval", str(e))
            else:
                suite.record(False, "MinIO S3 image retrieval", "No output URL")

            # 4.6 Verify Host Worker 70% Revenue Payout & Transaction Record
            db = SessionLocal()
            try:
                worker_user = db.query(User).filter(User.id == worker_id).first()
                expected_payout = round(task_cost * 0.70, 4)
                actual_credit = worker_user.balance - worker_initial_balance
                earnings_tx = db.query(Transaction).filter(
                    Transaction.user_id == worker_id,
                    Transaction.task_id == task_id,
                    Transaction.type == TransactionType.EARNING
                ).first()

                suite.record(actual_credit >= (expected_payout - 0.0001), 
                             f"Host Worker credited 70% revenue share (+${actual_credit:.4f})")
                suite.record(earnings_tx is not None, 
                             f"Host Worker ledger audit recorded (TX: {earnings_tx.transaction_id[:12] if earnings_tx else 'None'}...)")
            finally:
                db.close()

        except Exception as e:
            suite.record(False, "Phase 4 End-to-End compute & payout verification", str(e))
    else:
        suite.record(None, "Phase 4 End-to-End compute & payout", "FastAPI server offline")

    # =========================================================================
    # PHASE 5: LIVE FRONTEND (REACT 19 + VITE) & FULL POC DEMONSTRATION
    # =========================================================================
    print(f"\n{C.BLUE}{C.BOLD}Phase 5: Live Frontend & Full PoC Demonstration{C.RESET}")

    # 5.1 Vite Frontend Dev Server Reachability
    fe_online = False
    try:
        fe_req = urllib.request.Request("http://localhost:5173/")
        with urllib.request.urlopen(fe_req, timeout=3) as fe_resp:
            fe_html = fe_resp.read().decode()
            has_root = '<div id="root">' in fe_html
            has_script = 'src="/src/main.tsx"' in fe_html or 'type="module"' in fe_html
            if fe_resp.status == 200 and has_root:
                fe_online = True
                suite.record(True, "Vite Dev Server reachable & serving SPA HTML (http://localhost:5173/)")
            else:
                suite.record(False, "Vite Dev Server HTML invalid", f"Status: {fe_resp.status}")
    except Exception as e:
        suite.record(False, "Vite Dev Server reachable", str(e))

    # 5.2 Frontend SPA Route Resolution
    if fe_online:
        routes_to_test = ["/register", "/login", "/create-job", "/wallet", "/worker/earnings"]
        routes_ok = True
        failed_route = ""
        for r_path in routes_to_test:
            try:
                r_req = urllib.request.Request(f"http://localhost:5173{r_path}")
                with urllib.request.urlopen(r_req, timeout=3) as r_resp:
                    if r_resp.status != 200 or '<div id="root">' not in r_resp.read().decode():
                        routes_ok = False
                        failed_route = r_path
                        break
            except Exception as e:
                routes_ok = False
                failed_route = f"{r_path} ({e})"
                break
        suite.record(routes_ok, f"Frontend SPA route resolution ({', '.join(routes_to_test)})", failed_route)
    else:
        suite.record(None, "Frontend SPA route resolution", "Vite server offline")

    # 5.3 Frontend-to-Backend CORS Handshake
    try:
        opt_req = urllib.request.Request(
            "http://localhost:8000/api/tasks",
            method="OPTIONS",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"}
        )
        with urllib.request.urlopen(opt_req, timeout=3) as opt_resp:
            allow_origin = opt_resp.headers.get("Access-Control-Allow-Origin")
            suite.record(allow_origin == "http://localhost:5173", 
                         f"CORS preflight handshake verified (Origin: {allow_origin})")
    except Exception as e:
        suite.record(False, "CORS preflight handshake", str(e))

    # 5.4 Full End-to-End PoC User Lifecycle Simulation
    if api_online and fe_online:
        try:
            from app.database import SessionLocal
            from app.models import User, Task, Transaction, TransactionType

            # Register Creator
            creator_email = f"creator_poc5_{uuid.uuid4().hex[:6]}@nebula.ai"
            reg_body = json.dumps({
                "email": creator_email,
                "password": "Password123!",
                "confirm_password": "Password123!",
                "role": "creator"
            }).encode()
            reg_req = urllib.request.Request(
                "http://localhost:8000/auth/register",
                data=reg_body,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(reg_req, timeout=3) as reg_resp:
                reg_json = json.loads(reg_resp.read().decode())
                c_key = reg_json["api_key"]
                c_secret = reg_json["api_secret"]
                c_id = reg_json["user"]["id"]
                initial_bal = reg_json["user"]["balance"]

            suite.record(initial_bal == 50.0, f"PoC Creator registered ({creator_email}, balance: ${initial_bal:.2f})")

            # Deposit funds
            dep_body = json.dumps({"amount": 15.0, "payment_method": "Credit Card"}).encode()
            dep_req = urllib.request.Request(
                "http://localhost:8000/api/wallet/deposit",
                data=dep_body,
                headers={"Content-Type": "application/json", "X-API-Key": c_key, "X-API-Secret": c_secret}
            )
            with urllib.request.urlopen(dep_req, timeout=3) as dep_resp:
                dep_json = json.loads(dep_resp.read().decode())
                new_bal = dep_json.get("balance_after", 65.0)

            suite.record(new_bal == 65.0, f"PoC Creator deposited $15.00 -> balance: ${new_bal:.2f}")

            # Submit Prompt
            prompt_text = "Phase 5 PoC: Neon galactic nebula orbital station 8k ultra high definition"
            task_body = json.dumps({
                "prompt": prompt_text,
                "width": 512,
                "height": 512,
                "steps": 20
            }).encode()
            task_req = urllib.request.Request(
                "http://localhost:8000/api/tasks",
                data=task_body,
                headers={"Content-Type": "application/json", "X-API-Key": c_key, "X-API-Secret": c_secret}
            )
            with urllib.request.urlopen(task_req, timeout=3) as task_resp:
                t_data = json.loads(task_resp.read().decode())
                p5_task_id = t_data.get("id") or t_data.get("task_id")
                task_cost = t_data.get("cost", 0.0052)

            suite.record(bool(p5_task_id), f"PoC Prompt dispatched to compute network (Task: {p5_task_id[:12]}...)")

            # Poll for Celery Worker completion
            completed = False
            p5_output_url = None
            for _ in range(12):
                time.sleep(1)
                poll_req = urllib.request.Request(f"http://localhost:8000/api/tasks/{p5_task_id}")
                with urllib.request.urlopen(poll_req, timeout=3) as poll_resp:
                    p_data = json.loads(poll_resp.read().decode())
                    if p_data.get("status") == "completed":
                        completed = True
                        p5_output_url = p_data.get("output_url")
                        break

            suite.record(completed, f"PoC Render completed by Worker (status: completed)")
            suite.record(bool(p5_output_url) and "nebula-renders" in str(p5_output_url), 
                         f"PoC Image published to S3 CDN ({p5_output_url})")

            # Verify Image artifact
            if p5_output_url:
                with urllib.request.urlopen(p5_output_url, timeout=5) as p5_img_resp:
                    img_data = p5_img_resp.read()
                    suite.record(img_data.startswith(b"\x89PNG") and len(img_data) > 1000, 
                                 f"PoC Browser Image verified (Valid PNG, {len(img_data)} bytes)")
            else:
                suite.record(False, "PoC Browser Image verified", "No output URL")

            # Verify Creator balance debited
            bal_req = urllib.request.Request(
                "http://localhost:8000/api/wallet/balance",
                headers={"X-API-Key": c_key, "X-API-Secret": c_secret}
            )
            with urllib.request.urlopen(bal_req, timeout=3) as bal_resp:
                c_bal_data = json.loads(bal_resp.read().decode())
                expected_creator_bal = round(65.0 - task_cost, 4)
                suite.record(abs(c_bal_data.get("balance", 0) - expected_creator_bal) < 0.0001, 
                             f"Creator ledger debited correctly (${c_bal_data.get('balance'):.4f})")

            # Verify Creator Job History
            hist_req = urllib.request.Request(
                "http://localhost:8000/api/tasks",
                headers={"X-API-Key": c_key, "X-API-Secret": c_secret}
            )
            with urllib.request.urlopen(hist_req, timeout=3) as hist_resp:
                hist_data = json.loads(hist_resp.read().decode())
                tasks_list = hist_data.get("tasks", [])
                found_task = any(t.get("task_id") == p5_task_id or t.get("id") == p5_task_id for t in tasks_list)
                suite.record(found_task, f"Creator Job History contains completed render ({len(tasks_list)} task(s))")

        except Exception as e:
            suite.record(False, "Phase 5 End-to-End lifecycle simulation", str(e))
    else:
        suite.record(None, "Phase 5 End-to-End lifecycle simulation", "Backend or Frontend offline")

    # =========================================================================
    # PHASE 1 (ENTERPRISE PIVOT): SPECS, SCHEMAS & S3 STORAGE INFRASTRUCTURE
    # =========================================================================
    print(f"\n{C.BLUE}{C.BOLD}Phase 1 (Enterprise): Specs, Schemas & S3 Infrastructure{C.RESET}")

    # E1.1 Core Specification Markdown Documents
    core_specs = ["SKILLS.md", "ROADMAP.md", "ARCHITECTURE.md", "EXEC_PLANS.md"]
    specs_ok = True
    missing_spec = ""
    for spec_file in core_specs:
        if not (os.path.exists(spec_file) and os.path.getsize(spec_file) > 200):
            specs_ok = False
            missing_spec = spec_file
            break
    suite.record(specs_ok, f"Core Architecture Specs present ({', '.join(core_specs)})", missing_spec)

    # E1.2 Enterprise Database Models & PostgreSQL Tables
    try:
        from app.models import TrainingJob, InferenceEndpoint, ApiToken
        from app.database import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            # Verify tables exist in PostgreSQL
            check_sql = text("""
                SELECT table_name FROM information_schema.tables 
                WHERE table_name IN ('training_jobs', 'inference_endpoints', 'api_tokens')
            """)
            found_tables = [row[0] for row in conn.execute(check_sql).fetchall()]
            all_tables_exist = len(found_tables) == 3
            suite.record(all_tables_exist, f"PostgreSQL Enterprise tables ({', '.join(found_tables)})")
    except Exception as e:
        suite.record(False, "PostgreSQL Enterprise tables", str(e))

    # E1.3 Enterprise Model ORM Operations (TrainingJob & ApiToken)
    try:
        from app.database import SessionLocal
        from app.models import TrainingJob, ApiToken
        db = SessionLocal()
        try:
            test_job_id = f"test_job_{uuid.uuid4().hex[:8]}"
            test_job = TrainingJob(
                id=test_job_id,
                user_id="test_user",
                name="Llama-3-FineTune-Test",
                base_model="meta-llama/Llama-3-8B",
                train_type="lora",
                dataset_s3_url="http://localhost:9000/nebula-datasets/test.jsonl",
                hyperparameters=json.dumps({"epochs": 3, "lr": 0.0002}),
                status="queued"
            )
            db.add(test_job)
            db.commit()

            # Query back
            queried_job = db.query(TrainingJob).filter(TrainingJob.id == test_job_id).first()
            suite.record(queried_job is not None and queried_job.base_model == "meta-llama/Llama-3-8B",
                         f"ORM TrainingJob persistence (ID: {test_job_id[:12]}...)")
            db.delete(queried_job)
            db.commit()
        finally:
            db.close()
    except Exception as e:
        suite.record(False, "ORM TrainingJob persistence", str(e))

    # E1.4 Enterprise MinIO S3 Buckets Initialization
    try:
        from app.storage import get_storage
        storage = get_storage()
        ent_buckets = storage.ensure_all_enterprise_buckets_exist()
        expected_buckets = ["nebula-datasets", "nebula-checkpoints", "nebula-models"]
        all_b_present = all(b in ent_buckets for b in expected_buckets)
        suite.record(all_b_present, f"Enterprise MinIO S3 Buckets ready ({', '.join(expected_buckets)})")

        # Test S3 bytes upload & download roundtrip
        test_obj_name = f"test_data_{uuid.uuid4().hex[:6]}.jsonl"
        sample_payload = b'{"prompt": "Train model", "completion": "Success"}'
        test_url = storage.upload_bytes("nebula-datasets", test_obj_name, sample_payload, "application/json")
        retrieved_data = storage.download_bytes("nebula-datasets", test_obj_name)
        suite.record(retrieved_data == sample_payload, 
                     f"MinIO S3 Dataset byte roundtrip verified ({test_url})")
    except Exception as e:
        suite.record(False, "Enterprise MinIO S3 Buckets", str(e))

    # =========================================================================
    # Phase 2 (Enterprise): Model Training Engine, Loss Telemetry & S3 Checkpoints
    # =========================================================================
    print_header("Phase 2 (Enterprise): Model Training Engine & S3 Checkpoints")
    BASE_URL = "http://localhost:8000"

    # E2.1 Dataset Presigned Upload URL API
    dataset_s3_url = None
    try:
        up_resp = requests.post(
            f"{BASE_URL}/api/v1/training/datasets/upload-url",
            json={"filename": "enterprise_customer_train.jsonl"}
        )
        up_ok = up_resp.status_code == 200 and "upload_url" in up_resp.json()
        if up_ok:
            data = up_resp.json()
            dataset_s3_url = data["s3_url"]
            suite.record(True, f"Dataset presigned upload URL generated ({data['bucket']}/{data['object_key']})")
        else:
            suite.record(False, "Dataset presigned upload URL", f"Status {up_resp.status_code}: {up_resp.text}")
    except Exception as e:
        suite.record(False, "Dataset presigned upload URL", str(e))

    # E2.2 Training Job Submission API
    job_id = None
    try:
        submit_payload = {
            "name": f"LoRA-FineTune-Test-{uuid.uuid4().hex[:6]}",
            "base_model": "meta-llama/Llama-3-8B",
            "train_type": "lora",
            "parallelism": "data_parallel",
            "num_gpus": 1,
            "dataset_s3_url": dataset_s3_url or "http://localhost:9000/nebula-datasets/default/train.jsonl",
            "total_epochs": 2,
            "hyperparameters": {
                "learning_rate": 0.0002,
                "batch_size": 4,
                "lora_r": 16,
                "lora_alpha": 32
            }
        }
        sub_resp = requests.post(f"{BASE_URL}/api/v1/training/jobs", json=submit_payload)
        sub_ok = sub_resp.status_code in (200, 201) and "id" in sub_resp.json()
        if sub_ok:
            job_data = sub_resp.json()
            job_id = job_data["id"]
            suite.record(True, f"Enterprise training job submitted (ID: {job_id[:12]}..., status: {job_data['status']})")
        else:
            suite.record(False, "Enterprise training job submission", f"Status {sub_resp.status_code}: {sub_resp.text}")
    except Exception as e:
        suite.record(False, "Enterprise training job submission", str(e))

    # E2.3 Telemetry Polling & Mathematical Loss Descent Verification
    try:
        if not job_id:
            suite.record(False, "Training telemetry polling", "No job_id from submission")
        else:
            completed = False
            final_job = None
            for _ in range(30):
                poll_resp = requests.get(f"{BASE_URL}/api/v1/training/jobs/{job_id}")
                if poll_resp.status_code == 200:
                    final_job = poll_resp.json()
                    if final_job["status"] == "completed":
                        completed = True
                        break
                    elif final_job["status"] == "failed":
                        break
                time.sleep(0.5)

            suite.record(completed, f"Training job finished successfully (status: {final_job.get('status') if final_job else 'unknown'})")
            
            # Verify loss history decay
            loss_hist = final_job.get("loss_history", []) if final_job else []
            has_loss = len(loss_hist) >= 2
            loss_descends = has_loss and (loss_hist[1]["loss"] < loss_hist[0]["loss"])
            suite.record(has_loss and loss_descends, 
                         f"Mathematical loss decay confirmed ({loss_hist[0]['loss'] if has_loss else '?'} -> {loss_hist[-1]['loss'] if has_loss else '?'})")
    except Exception as e:
        suite.record(False, "Training telemetry & loss decay", str(e))

    # E2.4 Checkpoint Retrieval & Safetensors Deserialization
    try:
        if not job_id:
            suite.record(False, "S3 Checkpoints retrieval", "No job_id")
        else:
            ckpt_resp = requests.get(f"{BASE_URL}/api/v1/training/jobs/{job_id}/checkpoints")
            ckpt_ok = ckpt_resp.status_code == 200 and len(ckpt_resp.json()) >= 1
            if ckpt_ok:
                checkpoints = ckpt_resp.json()
                latest_ckpt = checkpoints[-1]
                suite.record(True, f"Checkpoints registered in S3 ({len(checkpoints)} checkpoint(s), latest epoch: {latest_ckpt['epoch']})")

                # Verify actual bytes download from MinIO and safetensors validity
                import safetensors.torch
                dl_resp = requests.get(latest_ckpt["s3_url"])
                is_valid_safetensors = False
                tensor_keys = []
                if dl_resp.status_code == 200:
                    tensors = safetensors.torch.load(dl_resp.content)
                    tensor_keys = list(tensors.keys())
                    is_valid_safetensors = len(tensor_keys) > 0

                suite.record(is_valid_safetensors, 
                             f"Safetensors checkpoint binary verified ({len(dl_resp.content)} bytes, {len(tensor_keys)} tensors)")
            else:
                suite.record(False, "S3 Checkpoints retrieval", f"Status {ckpt_resp.status_code}")
    except Exception as e:
        suite.record(False, "S3 Checkpoint verification", str(e))

    # E2.5 List Training Jobs API
    try:
        list_resp = requests.get(f"{BASE_URL}/api/v1/training/jobs")
        list_ok = list_resp.status_code == 200 and isinstance(list_resp.json(), list) and len(list_resp.json()) > 0
        suite.record(list_ok, f"List training jobs API verified ({len(list_resp.json()) if list_ok else 0} job(s) found)")
    except Exception as e:
        suite.record(False, "List training jobs API", str(e))

    # E2.6 Job Cancellation Flow API
    try:
        cancel_job_resp = requests.post(f"{BASE_URL}/api/v1/training/jobs", json={
            "name": "Cancel-Test-Job",
            "base_model": "meta-llama/Llama-3-8B",
            "dataset_s3_url": "http://localhost:9000/nebula-datasets/dummy.jsonl",
            "total_epochs": 50
        })
        if cancel_job_resp.status_code in (200, 201):
            c_job_id = cancel_job_resp.json()["id"]
            c_resp = requests.post(f"{BASE_URL}/api/v1/training/jobs/{c_job_id}/cancel")
            is_canc = c_resp.status_code == 200 and c_resp.json().get("status") == "cancelled"
            detail = f"ID: {c_job_id[:12]}..." if is_canc else f"Status: {c_resp.status_code}, Resp: {c_resp.text}"
            suite.record(is_canc, "Job cancellation lifecycle verified", detail)
        else:
            suite.record(False, "Job cancellation flow", "Could not submit job to cancel")
    except Exception as e:
        suite.record(False, "Job cancellation flow", str(e))

    # =========================================================================
    # Phase 3 (Enterprise): Model Serving & OpenAI API Gateway
    # =========================================================================
    print_header("Phase 3 (Enterprise): Model Serving & OpenAI API Gateway")

    # E3.1 Scoped Bearer API Token Provisioning
    bearer_token = None
    token_id = None
    auth_headers = {}
    try:
        t_resp = requests.post(
            f"{BASE_URL}/api/v1/tokens",
            json={
                "name": f"Enterprise-Gateway-Key-{uuid.uuid4().hex[:6]}",
                "scopes": "training,inference",
                "rate_limit_rpm": 200
            }
        )
        t_ok = t_resp.status_code == 201 and "token" in t_resp.json()
        if t_ok:
            t_data = t_resp.json()
            bearer_token = t_data["token"]
            token_id = t_data["id"]
            auth_headers = {"Authorization": f"Bearer {bearer_token}"}
            suite.record(True, f"Scoped Bearer API token provisioned ({t_data['token_prefix']}, scopes: {t_data['scopes']})")
        else:
            suite.record(False, "Scoped Bearer token provisioning", f"Status {t_resp.status_code}: {t_resp.text}")
    except Exception as e:
        suite.record(False, "Scoped Bearer token provisioning", str(e))

    # E3.2 Dedicated Model Endpoint Deployment
    endpoint_id = None
    ep_name = f"llama3-finetuned-{uuid.uuid4().hex[:6]}"
    try:
        ep_payload = {
            "name": ep_name,
            "model_id": "meta-llama/Llama-3-8B",
            "adapter_url": "http://localhost:9000/nebula-checkpoints/demo/epoch_2/adapter_model.safetensors",
            "min_replicas": 1,
            "max_replicas": 4
        }
        ep_resp = requests.post(f"{BASE_URL}/api/v1/inference/endpoints", headers=auth_headers, json=ep_payload)
        ep_ok = ep_resp.status_code == 201 and "id" in ep_resp.json()
        if ep_ok:
            ep_data = ep_resp.json()
            endpoint_id = ep_data["id"]
            suite.record(True, f"Dedicated inference endpoint deployed ({ep_data['name']} -> {ep_data['model_id']}, status: {ep_data['status']})")
        else:
            suite.record(False, "Dedicated inference endpoint deployment", f"Status {ep_resp.status_code}: {ep_resp.text}")
    except Exception as e:
        suite.record(False, "Dedicated inference endpoint deployment", str(e))

    # E3.3 OpenAI /v1/models Compatibility Registry
    try:
        models_resp = requests.get(f"{BASE_URL}/v1/models", headers=auth_headers)
        m_ok = models_resp.status_code == 200 and "data" in models_resp.json()
        if m_ok:
            model_items = models_resp.json()["data"]
            model_ids = [m["id"] for m in model_items]
            has_base = any("Llama-3" in m_id for m_id in model_ids)
            has_ep = ep_name in model_ids
            suite.record(has_base and has_ep, f"OpenAI /v1/models registry verified ({len(model_items)} models active)")
        else:
            suite.record(False, "OpenAI /v1/models registry", f"Status {models_resp.status_code}")
    except Exception as e:
        suite.record(False, "OpenAI /v1/models registry", str(e))

    # E3.4 OpenAI /v1/chat/completions (Standard Non-Streaming)
    try:
        chat_req = {
            "model": ep_name,
            "messages": [
                {"role": "system", "content": "You are a professional Enterprise AI assistant."},
                {"role": "user", "content": "Explain Project NetworkNebula decentralized compute architecture in one sentence."}
            ],
            "temperature": 0.7,
            "max_tokens": 128,
            "stream": False
        }
        chat_resp = requests.post(f"{BASE_URL}/v1/chat/completions", headers=auth_headers, json=chat_req)
        c_ok = chat_resp.status_code == 200 and "choices" in chat_resp.json()
        if c_ok:
            res_data = chat_resp.json()
            choice = res_data["choices"][0]
            content = choice["message"]["content"]
            usage = res_data.get("usage", {})
            has_content = len(content.strip()) > 0
            has_usage = usage.get("total_tokens", 0) > 0
            suite.record(has_content and has_usage, 
                         f"OpenAI /v1/chat/completions verified ({usage.get('total_tokens')} tokens, {content[:45]}...)")
        else:
            suite.record(False, "OpenAI /v1/chat/completions", f"Status {chat_resp.status_code}: {chat_resp.text}")
    except Exception as e:
        suite.record(False, "OpenAI /v1/chat/completions", str(e))

    # E3.5 OpenAI /v1/chat/completions (Server-Sent Events SSE Streaming)
    try:
        stream_req = {
            "model": "meta-llama/Llama-3-8B",
            "messages": [
                {"role": "user", "content": "Count from 1 to 5."}
            ],
            "stream": True
        }
        stream_resp = requests.post(f"{BASE_URL}/v1/chat/completions", headers=auth_headers, json=stream_req, stream=True)
        s_ok = stream_resp.status_code == 200
        if s_ok:
            chunks = []
            for line in stream_resp.iter_lines():
                if line:
                    decoded = line.decode("utf-8")
                    if decoded.startswith("data: "):
                        chunks.append(decoded)
            has_chunks = len(chunks) >= 2
            ends_with_done = chunks[-1] == "data: [DONE]" if chunks else False
            suite.record(has_chunks and ends_with_done, 
                         f"OpenAI SSE streaming verified ({len(chunks)} chunks, terminated with [DONE])")
        else:
            suite.record(False, "OpenAI SSE streaming", f"Status {stream_resp.status_code}")
    except Exception as e:
        suite.record(False, "OpenAI SSE streaming", str(e))

    # E3.6 Endpoint Serving Telemetry Tracking
    try:
        if not endpoint_id:
            suite.record(False, "Endpoint telemetry tracking", "No endpoint_id")
        else:
            ep_get = requests.get(f"{BASE_URL}/api/v1/inference/endpoints/{endpoint_id}", headers=auth_headers)
            if ep_get.status_code == 200:
                ep_stat = ep_get.json()
                req_counted = ep_stat["total_requests"] >= 1
                has_lat = ep_stat["avg_latency_ms"] >= 0.0
                suite.record(req_counted and has_lat, 
                             f"Endpoint telemetry verified ({ep_stat['total_requests']} requests served, avg latency: {ep_stat['avg_latency_ms']}ms)")
            else:
                suite.record(False, "Endpoint telemetry tracking", f"Status {ep_get.status_code}")
    except Exception as e:
        suite.record(False, "Endpoint telemetry tracking", str(e))

    # E3.7 Token Revocation & Security Enforcement
    try:
        if not token_id:
            suite.record(False, "Token revocation security", "No token_id")
        else:
            del_resp = requests.delete(f"{BASE_URL}/api/v1/tokens/{token_id}", headers=auth_headers)
            revoked_ok = del_resp.status_code == 200 and del_resp.json().get("status") == "revoked"

            # Verify that calling /v1/models with revoked token fails with 401
            probe_resp = requests.get(f"{BASE_URL}/v1/models", headers={"Authorization": f"Bearer {bearer_token}"})
            unauth_enforced = probe_resp.status_code == 401
            suite.record(revoked_ok and unauth_enforced, 
                         f"Token revocation & 401 enforcement confirmed (token_id: {token_id[:12]}...)")
    except Exception as e:
        suite.record(False, "Token revocation security", str(e))

    # E3.8 Endpoint Undeployment Lifecycle
    try:
        if not endpoint_id:
            suite.record(False, "Endpoint undeployment", "No endpoint_id")
        else:
            del_ep = requests.delete(f"{BASE_URL}/api/v1/inference/endpoints/{endpoint_id}")
            del_ok = del_ep.status_code == 200 and del_ep.json().get("status") == "deleted"
            chk_ep = requests.get(f"{BASE_URL}/api/v1/inference/endpoints/{endpoint_id}")
            not_found_enforced = chk_ep.status_code == 404
            suite.record(del_ok and not_found_enforced, 
                         f"Endpoint undeployment & cleanup confirmed (endpoint_id: {endpoint_id[:12]}...)")
    except Exception as e:
        suite.record(False, "Endpoint undeployment", str(e))

    # =========================================================================
    # Phase 4 (Enterprise): React 19 Enterprise Cloud Console UI
    # =========================================================================
    print_header("Phase 4 (Enterprise): React 19 Enterprise Cloud Console UI")

    # E4.1 Enterprise Console Route: /training
    try:
        t_route_resp = requests.get("http://localhost:5173/training", timeout=3)
        t_route_ok = t_route_resp.status_code == 200 and "<html" in t_route_resp.text.lower()
        suite.record(t_route_ok, f"Enterprise Console /training route verified (HTTP {t_route_resp.status_code})")
    except Exception as e:
        suite.record(False, "Enterprise Console /training route", str(e))

    # E4.2 Enterprise Console Route: /inference
    try:
        i_route_resp = requests.get("http://localhost:5173/inference", timeout=3)
        i_route_ok = i_route_resp.status_code == 200 and "<html" in i_route_resp.text.lower()
        suite.record(i_route_ok, f"Enterprise Console /inference route verified (HTTP {i_route_resp.status_code})")
    except Exception as e:
        suite.record(False, "Enterprise Console /inference route", str(e))

    # E4.3 Enterprise Console Route: /api-tokens
    try:
        tok_route_resp = requests.get("http://localhost:5173/api-tokens", timeout=3)
        tok_route_ok = tok_route_resp.status_code == 200 and "<html" in tok_route_resp.text.lower()
        suite.record(tok_route_ok, f"Enterprise Console /api-tokens route verified (HTTP {tok_route_resp.status_code})")
    except Exception as e:
        suite.record(False, "Enterprise Console /api-tokens route", str(e))

    # E4.4 Enterprise Console Route: /cluster
    try:
        c_route_resp = requests.get("http://localhost:5173/cluster", timeout=3)
        c_route_ok = c_route_resp.status_code == 200 and "<html" in c_route_resp.text.lower()
        suite.record(c_route_ok, f"Enterprise Console /cluster route verified (HTTP {c_route_resp.status_code})")
    except Exception as e:
        suite.record(False, "Enterprise Console /cluster route", str(e))

    # E4.5 Production Static Build Verification
    try:
        dist_index = Path("network-nebula/dist/index.html")
        build_exists = dist_index.exists() and dist_index.stat().st_size > 200
        suite.record(build_exists, f"Production static build verified ({dist_index.name}, {dist_index.stat().st_size if build_exists else 0} bytes)")
    except Exception as e:
        suite.record(False, "Production static build verification", str(e))

    # E4.6 Enterprise Navigation & Router Manifest
    try:
        nav_file = Path("network-nebula/src/components/layout/navbar.tsx")
        app_file = Path("network-nebula/src/routes/index.tsx")
        has_nav = False
        has_routes = False
        if nav_file.exists():
            nav_content = nav_file.read_text(encoding="utf-8")
            has_nav = all(k in nav_content for k in ["/training", "/inference", "/api-tokens", "/cluster"])
        if app_file.exists():
            routes_content = app_file.read_text(encoding="utf-8")
            has_routes = all(k in routes_content for k in ["/training", "/inference", "/api-tokens", "/cluster"])
        suite.record(has_nav and has_routes, "Enterprise navigation & router manifest verified (4 routes wired)")
    except Exception as e:
        suite.record(False, "Enterprise navigation & router manifest", str(e))

    return suite.summary()

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)


