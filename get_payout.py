#!/usr/bin/env python3
"""
Project NetworkNebula - Worker Payout & Earnings Estimator CLI (Milestone 2)
=============================================================================
Inspect registered GPU worker nodes, contribution percentages (10%-100%),
task execution counters, and accrued USD earnings directly from PowerShell or CMD.
"""

import sys
import os
import json
import argparse
import logging
import warnings

# Silence noisy SQL loggers
warnings.filterwarnings("ignore")
for log_name in ["sqlalchemy", "sqlalchemy.engine", "sqlalchemy.engine.Engine", "sqlalchemy.pool"]:
    l = logging.getLogger(log_name)
    l.setLevel(logging.CRITICAL)
    l.propagate = False

# Add project root to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal, engine
engine.echo = False

from app.models import User, Task, Worker, Transaction, TransactionType

# Terminal Colors
class C:
    GREEN = "\033[92m"
    CYAN = "\033[96m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"


def get_gpu_info():
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            mem_gb = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 1)
            cuda_ver = torch.version.cuda
            return f"{name} ({mem_gb} GB VRAM, CUDA {cuda_ver})", mem_gb
    except Exception:
        pass
    return "Generic Compute Node (CPU/Emulated)", 0.0


def main():
    parser = argparse.ArgumentParser(description="NetworkNebula Worker Payout & Fleet Telemetry CLI")
    parser.add_argument("--email", type=str, help="Filter by specific worker email")
    parser.add_argument("--worker-id", type=str, help="Filter by specific worker node ID")
    parser.add_argument("--limit", type=int, default=15, help="Max nodes to display in table (default: 15, 0 for all)")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        # Find active worker account or top user
        if args.email:
            user = db.query(User).filter(User.email == args.email).first()
        else:
            user = db.query(User).filter(User.email != None, User.is_worker == True).first()
            if not user:
                user = db.query(User).filter(User.email != None, User.total_earned > 0).first()
            if not user:
                user = db.query(User).filter(User.email != None).order_by(User.balance.desc()).first()

        # Query registered Worker nodes
        workers_query = db.query(Worker)
        if args.worker_id:
            workers_query = workers_query.filter(Worker.id == args.worker_id)
        workers = workers_query.all()

        # If fleet registry is empty, sync local primary worker node
        if not workers and not args.worker_id:
            try:
                from app.cluster_worker_router import sync_primary_local_worker
                sync_primary_local_worker(db)
                workers = db.query(Worker).all()
            except Exception:
                pass

        # Sort primary node and online nodes first
        workers.sort(key=lambda w: (
            0 if w.id == "node-gpu-local-01" else (1 if w.status == "online" else 2),
            -(w.total_earnings_usd or 0.0)
        ))

        gpu_desc, gpu_vram = get_gpu_info()

        # Pricing constants
        WORKER_SHARE = 0.70  # 70% to host node
        AVG_INFERENCE_EARNING = 0.0036   # $0.0052 task * 70%
        AVG_TRAINING_EARNING = 0.1750    # $0.2500 run * 70%

        balance = round(float(user.balance if user else 0.0), 4)
        total_earned = round(float(user.total_earned if user else 0.0), 4)
        email = user.email if user else "guest_host@nebula.ai"

        # Tasks completed
        total_db_tasks = db.query(Task).count()

        # Per-node statistics
        nodes_data = []
        cluster_earnings_total = 0.0
        cluster_tasks_total = 0

        for w in workers:
            w_total_vram = round(float(w.gpu_memory_gb or gpu_vram or 8.0), 2)
            w_alloc_pct = int(w.vram_allocation_pct if w.vram_allocation_pct is not None else 80)
            w_alloc_vram = round(w_total_vram * (w_alloc_pct / 100.0), 2)
            w_tasks = int(w.total_tasks_completed or 0)
            w_earned = round(float(w.total_earnings_usd or 0.0), 4)
            cluster_earnings_total += w_earned
            cluster_tasks_total += w_tasks

            nodes_data.append({
                "node_id": w.id,
                "name": w.name,
                "gpu_model": w.gpu_info or gpu_desc,
                "status": w.status or "online",
                "vram_allocation_pct": w_alloc_pct,
                "vram_total_gb": w_total_vram,
                "vram_allocated_gb": w_alloc_vram,
                "vram_used_gb": round(float(w.vram_used_gb or 0.0), 2),
                "gpu_utilization_pct": round(float(w.gpu_utilization_pct or 0.0), 1),
                "cuda_version": w.cuda_version or "12.8",
                "total_tasks_completed": w_tasks,
                "total_earnings_usd": w_earned,
                "hourly_rate_usd": round(float(w.hourly_rate_usd or 0.45), 4),
            })

        if args.json:
            out = {
                "user": {
                    "id": user.id if user else None,
                    "email": email,
                    "balance": balance,
                    "total_earned": total_earned,
                    "payout_eligible": balance >= 10.0,
                },
                "nodes": nodes_data,
                "total_cluster_earnings_usd": round(cluster_earnings_total, 4),
                "total_cluster_tasks_completed": cluster_tasks_total,
                "total_db_tasks": total_db_tasks,
            }
            print(json.dumps(out, indent=2))
            return

        # Human-Readable Formatted Output
        print(f"\n{C.CYAN}{C.BOLD}{'='*85}{C.RESET}")
        print(f"{C.CYAN}{C.BOLD}   Project NetworkNebula - GPU Host Payout & Fleet Telemetry (Milestone 2){C.RESET}")
        print(f"{C.CYAN}{C.BOLD}{'='*85}{C.RESET}\n")

        print(f"  {C.BOLD}Worker Node Hardware:{C.RESET}   {C.GREEN}{gpu_desc}{C.RESET}")
        print(f"  {C.BOLD}Account ID / Email:{C.RESET}     {email}")
        print(f"  {C.BOLD}Revenue Share Cut:{C.RESET}      {C.GREEN}70.0% (Host){C.RESET} / 30.0% (Network fee)")
        print(f"  {C.BOLD}Cluster Tasks Processed:{C.RESET} {cluster_tasks_total} node jobs ({total_db_tasks} total in ledger)\n")

        # Table of Registered GPU Worker Nodes & Fleet Telemetry
        print(f"  {C.BOLD}+---------------------------------------------------------------------------------------------------+{C.RESET}")
        print(f"  {C.BOLD}| REGISTERED GPU WORKER NODES & FLEET TELEMETRY                                                     |{C.RESET}")
        print(f"  {C.BOLD}+----------------------+-----------------------------+---------+---------+--------+-------+---------+{C.RESET}")
        print(f"  {C.BOLD}| Node ID              | GPU Model                   | Contrib | VRAM    | Status | Tasks | Earned  |{C.RESET}")
        print(f"  {C.BOLD}+----------------------+-----------------------------+---------+---------+--------+-------+---------+{C.RESET}")

        displayed_nodes = nodes_data[:args.limit] if (args.limit and args.limit > 0) else nodes_data
        if displayed_nodes:
            for n in displayed_nodes:
                node_id_disp = (n["node_id"][:20])
                gpu_disp = (n["gpu_model"][:27])
                contrib_disp = f"{n['vram_allocation_pct']}%"
                vram_disp = f"{n['vram_allocated_gb']}G"
                status_disp = n["status"][:6]
                tasks_disp = str(n["total_tasks_completed"])
                earned_disp = f"${n['total_earnings_usd']:.4f}"
                st_color = C.GREEN if n["status"] == "online" else C.YELLOW
                print(f"  | {node_id_disp:<20} | {gpu_disp:<27} | {contrib_disp:<7} | {vram_disp:<7} | {st_color}{status_disp:<6}{C.RESET} | {tasks_disp:<5} | {C.GREEN}{earned_disp:<7}{C.RESET} |")
            if len(nodes_data) > len(displayed_nodes):
                rem = len(nodes_data) - len(displayed_nodes)
                print(f"  | {C.DIM}... and {rem} more nodes registered across cluster (use --limit 0 to view all){C.RESET}{' '*28}|")
        else:
            print(f"  | No registered worker nodes found in cluster fleet.                                                |")
        print(f"  {C.BOLD}+----------------------+-----------------------------+---------+---------+--------+-------+---------+{C.RESET}\n")

        # Account Balance & Earnings Metrics
        print(f"  {C.BOLD}+---------------------------------------------------------------------------------------------------+{C.RESET}")
        print(f"  {C.BOLD}| CURRENT BALANCE & WITHDRAWAL METRICS                                                              |{C.RESET}")
        print(f"  {C.BOLD}+---------------------------------------------------------------------------------------------------+{C.RESET}")
        print(f"  |  Withdrawable Balance:        {C.GREEN}{C.BOLD}${balance:>10.4f}{C.RESET}                                                      |")
        print(f"  |  Total Historical Earned:     {C.BLUE}{C.BOLD}${total_earned:>10.4f}{C.RESET}                                                      |")
        payout_eligible = "ELIGIBLE (Balance >= $10.00)" if balance >= 10.0 else "ACCUMULATING (Min $10.00)"
        status_color = C.GREEN if balance >= 10.0 else C.YELLOW
        print(f"  |  Payout Withdrawal Status:    {status_color}{payout_eligible:<45}{C.RESET}   |")
        print(f"  {C.BOLD}+---------------------------------------------------------------------------------------------------+{C.RESET}\n")

        # Estimated projection models (Moderate, Peak demand)
        est_daily_moderate = round((25 * AVG_INFERENCE_EARNING) + (3 * AVG_TRAINING_EARNING), 2)
        est_monthly_moderate = round(est_daily_moderate * 30, 2)
        est_daily_high = round((80 * AVG_INFERENCE_EARNING) + (8 * AVG_TRAINING_EARNING), 2)
        est_monthly_high = round(est_daily_high * 30, 2)

        print(f"  {C.BOLD}+---------------------------------------------------------------------------------------------------+{C.RESET}")
        print(f"  {C.BOLD}| ESTIMATED PAYOUT PROJECTIONS (70% HOST SHARE)                                                     |{C.RESET}")
        print(f"  {C.BOLD}+---------------------------------------------------------------------------------------------------+{C.RESET}")
        print(f"  |  * Moderate Activity (25 inf + 3 train/day):                                                      |")
        print(f"  |    - Daily Estimated Payout:    {C.CYAN}${est_daily_moderate:.2f} / day{C.RESET}                                                            |")
        print(f"  |    - 30-Day Projected Payout:  {C.GREEN}${est_monthly_moderate:.2f} / month{C.RESET}                                                          |")
        print(f"  |                                                                                                   |")
        print(f"  |  * Peak Demand (80 inf + 8 train/day):                                                            |")
        print(f"  |    - Daily Estimated Payout:    {C.CYAN}${est_daily_high:.2f} / day{C.RESET}                                                            |")
        print(f"  |    - 30-Day Projected Payout:  {C.GREEN}${est_monthly_high:.2f} / month{C.RESET}                                                          |")
        print(f"  {C.BOLD}+---------------------------------------------------------------------------------------------------+{C.RESET}")

        print(f"\n  {C.DIM}CLI Control: python nebula_worker.py set-limit --vram-pct <10-100>{C.RESET}")
        print(f"  {C.DIM}Withdrawal: POST /wallet/withdraw (Min $10.00) | Web: http://localhost:5173/cluster{C.RESET}\n")

    finally:
        db.close()


if __name__ == "__main__":
    main()
