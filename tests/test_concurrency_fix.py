"""
Test Multi-Node Concurrency & Anti-Pausing Lifecycle
Validates that multiple nodes (e.g. PC and Mac) can run concurrently without mutual pausing.
"""

import sys
import time
import requests

BASE_URL = "http://127.0.0.1:8000"

def run_test():
    print("=" * 65)
    print("  VERIFYING MULTI-NODE CONCURRENCY & INDEPENDENT AVAILABILITY")
    print("=" * 65)

    node_pc = "node-skorp"
    node_mac = "node-mac-bbrouter"

    # Step 1: Ensure both nodes are registered and available
    for nid, name in [(node_pc, "SkorP (RTX 4070)"), (node_mac, "Mac.bbrouter (Apple M4)")]:
        res = requests.post(f"{BASE_URL}/api/v1/workers/register", json={
            "worker_id": nid,
            "name": name,
            "gpu_info": "GPU Accelerator",
            "gpu_memory_gb": 8.0,
            "vram_allocation_pct": 80,
            "status": "online",
            "is_available": True
        })
        assert res.status_code == 200, f"Failed to register {nid}: {res.text}"

    # Step 2: Send heartbeats for both nodes
    hb1 = requests.post(f"{BASE_URL}/api/v1/workers/{node_pc}/heartbeat", json={
        "status": "online", "gpu_utilization_pct": 12.0
    })
    hb2 = requests.post(f"{BASE_URL}/api/v1/workers/{node_mac}/heartbeat", json={
        "status": "online", "gpu_utilization_pct": 10.0
    })
    assert hb1.status_code == 200 and hb2.status_code == 200

    # Step 3: Check monitor snapshot - both should be active and available
    snap = requests.get(f"{BASE_URL}/api/v1/cluster/monitor/snapshot").json()
    nodes_map = {n["id"]: n for n in snap.get("nodes", [])}
    
    assert node_pc in nodes_map, f"{node_pc} missing from snapshot"
    assert node_mac in nodes_map, f"{node_mac} missing from snapshot"
    assert nodes_map[node_pc]["is_available"] == True, f"{node_pc} not available"
    assert nodes_map[node_mac]["is_available"] == True, f"{node_mac} not available"
    print(f" [PASS] Both nodes concurrently active in snapshot ({node_pc}: {nodes_map[node_pc]['status']}, {node_mac}: {nodes_map[node_mac]['status']})")

    # Step 4: Mac claims a task and becomes busy
    claim_res = requests.post(f"{BASE_URL}/api/v1/workers/{node_mac}/claim-task", json={"auto_create": True})
    assert claim_res.status_code == 200
    task_id = claim_res.json()["task"]["task_id"]
    print(f" [INFO] Node {node_mac} claimed task {task_id[:12]}...")

    # Step 5: Verify Mac is 'busy' AND PC remains 'online', neither paused!
    snap = requests.get(f"{BASE_URL}/api/v1/cluster/monitor/snapshot").json()
    nodes_map = {n["id"]: n for n in snap.get("nodes", [])}
    assert nodes_map[node_mac]["status"] == "busy", f"Expected {node_mac} status 'busy', got {nodes_map[node_mac]['status']}"
    assert nodes_map[node_mac]["is_available"] == True, f"{node_mac} was erroneously marked unavailable!"
    assert nodes_map[node_pc]["status"] == "online", f"Expected {node_pc} status 'online', got {nodes_map[node_pc]['status']}"
    assert nodes_map[node_pc]["is_available"] == True, f"{node_pc} was erroneously paused when {node_mac} claimed work!"
    print(f" [PASS] Zero cross-talk: {node_mac} is 'busy' while {node_pc} remains 'online' and available!")

    # Step 6: Complete Mac task
    comp_res = requests.post(f"{BASE_URL}/api/v1/workers/{node_mac}/tasks/{task_id}/complete", json={
        "result": {"status": "completed"}
    })
    assert comp_res.status_code == 200
    print(f" [INFO] Node {node_mac} completed task {task_id[:12]}")

    # Step 7: Verify Mac returned to 'online'
    snap = requests.get(f"{BASE_URL}/api/v1/cluster/monitor/snapshot").json()
    nodes_map = {n["id"]: n for n in snap.get("nodes", [])}
    assert nodes_map[node_mac]["status"] == "online"
    assert nodes_map[node_mac]["is_available"] == True
    print(f" [PASS] {node_mac} cleanly restored to 'online' after task completion")

    # Step 8: Test Pause and Resume independence
    # Pause PC
    patch_pc = requests.patch(f"{BASE_URL}/api/v1/workers/{node_pc}/config", json={"is_available": False})
    assert patch_pc.status_code == 200
    snap = requests.get(f"{BASE_URL}/api/v1/cluster/monitor/snapshot").json()
    nodes_map = {n["id"]: n for n in snap.get("nodes", [])}
    assert nodes_map[node_pc]["is_available"] == False, f"{node_pc} should be paused"
    assert nodes_map[node_mac]["is_available"] == True, f"{node_mac} was affected by pausing {node_pc}!"
    print(f" [PASS] Pausing {node_pc} left {node_mac} completely active & unaffected!")

    # Resume PC
    patch_pc = requests.patch(f"{BASE_URL}/api/v1/workers/{node_pc}/config", json={"is_available": True})
    assert patch_pc.status_code == 200
    snap = requests.get(f"{BASE_URL}/api/v1/cluster/monitor/snapshot").json()
    nodes_map = {n["id"]: n for n in snap.get("nodes", [])}
    assert nodes_map[node_pc]["is_available"] == True, f"{node_pc} should be resumed"
    assert nodes_map[node_mac]["is_available"] == True, f"{node_mac} should remain available"
    print(f" [PASS] Resuming {node_pc} leaves BOTH nodes online and available!")

    # Step 9: Heartbeat does not unpause a manually paused worker
    requests.patch(f"{BASE_URL}/api/v1/workers/{node_pc}/config", json={"is_available": False})
    requests.post(f"{BASE_URL}/api/v1/workers/{node_pc}/heartbeat", json={"status": "online"})
    snap = requests.get(f"{BASE_URL}/api/v1/cluster/monitor/snapshot").json()
    nodes_map = {n["id"]: n for n in snap.get("nodes", [])}
    assert nodes_map[node_pc]["is_available"] == False, "Heartbeat should NOT override manual user pause!"
    assert nodes_map[node_pc]["status"] == "offline", f"Paused node should stay offline, got {nodes_map[node_pc]['status']}"
    print(" [PASS] User pause intent is strictly preserved against incoming heartbeats")

    # Restore PC to available
    requests.patch(f"{BASE_URL}/api/v1/workers/{node_pc}/config", json={"is_available": True})

    print("=" * 65)
    print("  ALL CONCURRENCY & AVAILABILITY CHECKS PASSED (100%)")
    print("=" * 65)
    return True

if __name__ == "__main__":
    success = run_test()
    sys.exit(0 if success else 1)
