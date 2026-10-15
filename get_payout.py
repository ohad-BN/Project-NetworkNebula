#!/usr/bin/env python3
"""
Project NetworkNebula - Worker Payout & Earnings Estimator CLI
=============================================================
Quickly inspect your GPU host node's current earnings, withdrawable balance,
and estimated payout projections directly from PowerShell or CMD.
"""

import sys
import os
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

from app.models import User, Task

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
    parser = argparse.ArgumentParser(description="NetworkNebula Worker Payout Estimator")
    parser.add_argument("--email", type=str, help="Filter by specific worker email")
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

        gpu_desc, gpu_vram = get_gpu_info()

        # Network Pricing constants
        WORKER_SHARE = 0.70  # 70% to host node
        AVG_INFERENCE_EARNING = 0.0036   # $0.0052 task * 70%
        AVG_TRAINING_EARNING = 0.1750    # $0.2500 run * 70%

        balance = user.balance if user else 0.0
        total_earned = user.total_earned if user else 0.0
        email = user.email if user else "guest_host@nebula.ai"

        # Tasks completed
        total_tasks = db.query(Task).count()

        # Estimated projection models (Low, Moderate, High utilization)
        est_daily_moderate = round((25 * AVG_INFERENCE_EARNING) + (3 * AVG_TRAINING_EARNING), 2)
        est_monthly_moderate = round(est_daily_moderate * 30, 2)
        est_daily_high = round((80 * AVG_INFERENCE_EARNING) + (8 * AVG_TRAINING_EARNING), 2)
        est_monthly_high = round(est_daily_high * 30, 2)

        print(f"\n{C.CYAN}{C.BOLD}{'='*65}{C.RESET}")
        print(f"{C.CYAN}{C.BOLD}   Project NetworkNebula - GPU Host Payout & Earnings{C.RESET}")
        print(f"{C.CYAN}{C.BOLD}{'='*65}{C.RESET}\n")

        print(f"  {C.BOLD}Worker Node Hardware:{C.RESET}   {C.GREEN}{gpu_desc}{C.RESET}")
        print(f"  {C.BOLD}Account ID / Email:{C.RESET}     {email}")
        print(f"  {C.BOLD}Revenue Share Cut:{C.RESET}      {C.GREEN}70.0% (Host){C.RESET} / 30.0% (Network fee)")
        print(f"  {C.BOLD}Network Tasks Processed:{C.RESET} {total_tasks} jobs\n")

        print(f"  {C.BOLD}+-------------------------------------------------------------+{C.RESET}")
        print(f"  {C.BOLD}|  CURRENT BALANCE & EARNINGS METRICS                         |{C.RESET}")
        print(f"  {C.BOLD}+-------------------------------------------------------------+{C.RESET}")
        print(f"  |  Withdrawable Balance:      {C.GREEN}{C.BOLD}${balance:>8.4f}{C.RESET}                        |")
        print(f"  |  Total Historical Earned:   {C.BLUE}{C.BOLD}${total_earned:>8.4f}{C.RESET}                        |")
        payout_eligible = "ELIGIBLE (Balance >= $10.00)" if balance >= 10.0 else "ACCUMULATING (Min $10.00)"
        status_color = C.GREEN if balance >= 10.0 else C.YELLOW
        print(f"  |  Payout Status:             {status_color}{payout_eligible:<31}{C.RESET}|")
        print(f"  {C.BOLD}+-------------------------------------------------------------+{C.RESET}\n")

        print(f"  {C.BOLD}+-------------------------------------------------------------+{C.RESET}")
        print(f"  {C.BOLD}|  ESTIMATED PAYOUT PROJECTIONS (70% HOST SHARE)              |{C.RESET}")
        print(f"  {C.BOLD}+-------------------------------------------------------------+{C.RESET}")
        print(f"  |  * Moderate Activity (25 inf + 3 train/day):                |")
        print(f"  |    - Daily Estimated Payout:    {C.CYAN}${est_daily_moderate:.2f} / day{C.RESET}                  |")
        print(f"  |    - 30-Day Projected Payout:  {C.GREEN}${est_monthly_moderate:.2f} / month{C.RESET}                |")
        print(f"  |                                                             |")
        print(f"  |  * Peak Demand (80 inf + 8 train/day):                      |")
        print(f"  |    - Daily Estimated Payout:    {C.CYAN}${est_daily_high:.2f} / day{C.RESET}                  |")
        print(f"  |    - 30-Day Projected Payout:  {C.GREEN}${est_monthly_high:.2f} / month{C.RESET}                |")
        print(f"  {C.BOLD}+-------------------------------------------------------------+{C.RESET}")

        print(f"\n  {C.DIM}To request a payout: POST /wallet/withdraw (Min $10.00){C.RESET}")
        print(f"  {C.DIM}Web Console: http://localhost:5173/worker/earnings{C.RESET}\n")

    finally:
        db.close()

if __name__ == "__main__":
    main()
