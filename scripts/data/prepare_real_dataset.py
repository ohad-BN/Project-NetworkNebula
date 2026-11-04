#!/usr/bin/env python3
"""
Prepares a real-world instruction tuning dataset (Stanford Alpaca)
and saves it as data/real_alpaca_dataset.jsonl and uploads to MinIO S3.
"""

import json
import os
import sys
from pathlib import Path

# Ensure project root is in sys.path
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import requests
from app.storage import get_storage

def main():
    print("[1/3] Fetching real-world Stanford Alpaca dataset...")
    url = "https://raw.githubusercontent.com/tatsu-lab/stanford_alpaca/main/alpaca_data.json"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    raw_data = resp.json()

    print(f"Total available instructions: {len(raw_data):,}")
    
    # Take 1,500 real instructions for a ~10-minute training run on an RTX 4070
    target_count = 1500
    selected = raw_data[:target_count]

    os.makedirs("data", exist_ok=True)
    local_path = os.path.join("data", "real_alpaca_dataset.jsonl")

    print(f"[2/3] Formatting {target_count} records into .jsonl at {local_path}...")
    with open(local_path, "w", encoding="utf-8") as f:
        for item in selected:
            inst = item.get("instruction", "").strip()
            inp = item.get("input", "").strip()
            out = item.get("output", "").strip()

            full_instruction = f"{inst}\nContext: {inp}" if inp else inst
            line_obj = {
                "instruction": full_instruction,
                "response": out
            }
            f.write(json.dumps(line_obj, ensure_ascii=False) + "\n")

    print(f"[3/3] Uploading real dataset to MinIO S3 (nebula-datasets)...")
    storage = get_storage()
    storage.ensure_all_enterprise_buckets_exist()

    with open(local_path, "rb") as f:
        file_bytes = f.read()

    s3_key = "enterprise/real_alpaca_dataset.jsonl"
    storage.upload_bytes(
        bucket="nebula-datasets",
        object_name=s3_key,
        data=file_bytes,
        content_type="application/jsonlines"
    )

    s3_url = f"http://localhost:9000/nebula-datasets/{s3_key}"
    print("\n[SUCCESS] Dataset successfully prepared and uploaded!")
    print(f"   Local File Path : {os.path.abspath(local_path)}")
    print(f"   MinIO S3 URL    : {s3_url}")
    print(f"   Total Records   : {target_count} instruction/response pairs")

if __name__ == "__main__":
    main()
