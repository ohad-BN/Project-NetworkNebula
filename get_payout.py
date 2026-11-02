#!/usr/bin/env python3
"""
Project NetworkNebula — CLI Payout & Fleet Telemetry Reporter (get_payout.py)
"""
import argparse
import json
import os
import sys
import requests

DEFAULT_SERVER_URL = os.environ.get("NEBULA_SERVER_URL", "http://localhost:8000")


def main():
    parser = argparse.ArgumentParser(description="Query worker payout and fleet telemetry.")
    parser.add_argument("--server", default=DEFAULT_SERVER_URL, help="Orchestrator URL")
    parser.add_argument("--worker-id", default=None, help="Worker ID")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    server_url = args.server.rstrip("/")
    try:
        res = requests.get(f"{server_url}/api/v1/cluster/telemetry", timeout=10)
        res.raise_for_status()
        data = res.json()
    except Exception as e:
        if args.json:
            print(json.dumps({"status": "error", "error": str(e), "nodes": []}))
        else:
            print(f"[ERROR] Failed to query telemetry: {e}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(data))
        return 0

    print("=" * 70)
    print("  REGISTERED GPU WORKER NODES — FLEET PAYOUT TELEMETRY")
    print("=" * 70)
    for n in data.get("nodes", []):
        print(
            f"Node: {n.get('node_id')} | Status: {n.get('status')} | "
            f"Alloc: {n.get('vram_allocation_pct')}% | Tasks: {n.get('total_tasks_completed', 0)} | "
            f"Earned: ${n.get('total_earnings_usd', 0.0):.4f}"
        )
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
