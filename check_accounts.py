#!/usr/bin/env python3
"""
Project NetworkNebula — Account & User Dataset Inspector
========================================================
Quick CLI utility to view all registered users, balances, verification statuses,
and wallet ledger transactions in the local PostgreSQL database.
"""

import os
import sys

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.getcwd())

from app.database import engine
from sqlalchemy import text


def inspect_accounts():
    print("\n" + "=" * 80)
    print("   [NETWORK NEBULA] USER ACCOUNT DATASET & LEDGER")
    print("=" * 80)

    with engine.connect() as conn:
        users = conn.execute(
            text("""
            SELECT id, email, name, is_worker, balance, is_verified, verification_code, invited_by_code, created_at
            FROM users
            ORDER BY created_at DESC
        """)
        ).fetchall()

        print(f"\nTotal Registered Accounts: {len(users)}\n")
        print(f"{'Email':<30} | {'Role':<8} | {'Balance':<9} | {'Verified':<8} | {'OTP Code':<8} | {'Invited By'}")
        print("-" * 80)

        for u in users:
            email = u.email or "(CLI/Anon Node)"
            role = "Worker" if u.is_worker else "Creator"
            balance = f"${u.balance:.2f}"
            verified = "[YES]" if u.is_verified else "[NO]"
            otp = u.verification_code or "---"
            invited = u.invited_by_code or "---"
            print(f"{email:<30} | {role:<8} | {balance:<9} | {verified:<8} | {otp:<8} | {invited}")

        print("\n" + "=" * 80)
        print("   [ACTIVE ALPHA INVITE CODES]")
        print("=" * 80)
        invites = conn.execute(
            text("""
            SELECT code, times_used, max_uses, initial_credits, is_active
            FROM invite_codes
        """)
        ).fetchall()

        for inv in invites:
            status = "Active" if inv.is_active else "Disabled"
            print(f"Code: {inv.code:<20} | Uses: {inv.times_used}/{inv.max_uses} | Grant: +${inv.initial_credits:.2f} | Status: {status}")

        print("=" * 80 + "\n")


if __name__ == "__main__":
    inspect_accounts()
