#!/usr/bin/env python3
"""
Project NetworkNebula — Clean Account & History Purge Script
============================================================
Purges all user accounts, emails, transactions, jobs, tasks, API keys,
and resets invite codes to allow a 100% fresh out-of-the-box test.
"""

import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.getcwd())

from app.database import engine
from sqlalchemy import text


def purge_all_accounts():
    print("\n" + "=" * 70)
    print("   [NETWORK NEBULA] PURGING ALL USER ACCOUNTS & SESSION HISTORIES")
    print("=" * 70)

    with engine.begin() as conn:
        # 1. Unlink any workers attached to users
        conn.execute(text("UPDATE workers SET user_id = NULL;"))

        # 2. Delete user-scoped child records
        t_del = conn.execute(text("DELETE FROM transactions;")).rowcount
        tok_del = conn.execute(text("DELETE FROM api_tokens;")).rowcount
        job_del = conn.execute(text("DELETE FROM training_jobs;")).rowcount
        task_del = conn.execute(text("DELETE FROM tasks;")).rowcount
        audit_del = conn.execute(text("DELETE FROM audit_logs;")).rowcount
        payout_del = conn.execute(text("DELETE FROM payout_requests;")).rowcount
        ep_del = conn.execute(text("DELETE FROM inference_endpoints;")).rowcount

        # 3. Delete all users
        u_del = conn.execute(text("DELETE FROM users;")).rowcount

        # 4. Reset Alpha invite codes so max uses are restored
        conn.execute(
            text("""
            UPDATE invite_codes 
            SET times_used = 0, is_active = TRUE 
            WHERE code = 'NEBULA-ALPHA-2026';
        """)
        )

        # Ensure default Alpha invite code exists
        existing_code = conn.execute(
            text("SELECT id FROM invite_codes WHERE code = 'NEBULA-ALPHA-2026';")
        ).fetchone()
        if not existing_code:
            conn.execute(
                text("""
                INSERT INTO invite_codes (code, max_uses, times_used, initial_credits, is_active)
                VALUES ('NEBULA-ALPHA-2026', 1000, 0, 100.0, TRUE);
            """)
            )

    print(f" -> Deleted {u_del} user account(s)")
    print(f" -> Deleted {t_del} transaction ledger entry(ies)")
    print(f" -> Deleted {tok_del} API token(s)")
    print(f" -> Deleted {job_del} training job(s)")
    print(f" -> Deleted {task_del} inference task(s)")
    print(f" -> Deleted {audit_del} audit log(s)")
    print(f" -> Deleted {payout_del} payout request(s)")
    print(f" -> Deleted {ep_del} inference endpoint(s)")
    print(" -> Unlinked all worker nodes (user_id = NULL)")
    print(" -> Reset invite code 'NEBULA-ALPHA-2026' (times_used = 0, initial_credits = $100.00)")
    print("=" * 70)
    print(" [SUCCESS] System is 100% clean and ready for fresh user registration!\n")


if __name__ == "__main__":
    purge_all_accounts()
