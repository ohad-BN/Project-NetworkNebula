#!/usr/bin/env python3
"""
================================================================================
Project NetworkNebula — Real-Time Fleet & Telemetry Terminal Dashboard (monitor.py)
================================================================================
Live ASCII / ANSI terminal cockpit providing real-time visibility into:
  1. Connected Network Fleet: who is online, hardware specs, region, ping latency.
  2. Hardware Measurement & Load: GPU utilization %, VRAM allocated/used headroom bar.
  3. Workload Distribution: active/queued tasks, assigned worker nodes, shard progression.
  4. PoDS Micro-Earnings Settlement: live ticker of delivered slices and compute rewards.

Usage:
  python scripts/dev/monitor.py
  python scripts/dev/monitor.py --once
  python scripts/dev/monitor.py --interval 1.0 --url http://127.0.0.1:8000
================================================================================
"""

import argparse
import datetime
import json
import os
import platform
import sys
import time
from typing import Any, Dict, List, Optional

# Suppress Windows modal error dialog popups for broken third-party DLLs (e.g. xformers mismatch)
if sys.platform == "win32":
    try:
        import ctypes
        ctypes.windll.kernel32.SetErrorMode(0x0001 | 0x0002)
    except Exception:
        pass

try:
    import requests
except ImportError:
    import subprocess
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "requests"])
    except Exception:
        pass
    import requests

# ANSI Colors & Formatting
class C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    ITALIC = "\033[3m"
    UNDERLINE = "\033[4m"
    
    # Foreground
    BLACK = "\033[30m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"
    
    # Background
    BG_BLUE = "\033[44m"
    BG_CYAN = "\033[46m"
    BG_DARK = "\033[40m"


def enable_windows_ansi() -> None:
    """Enable VT100 escape sequence processing and UTF-8 encoding on Windows consoles."""
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    if sys.platform == "win32":
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
            mode = ctypes.c_ulong()
            if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                # ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
                kernel32.SetConsoleMode(handle, mode.value | 0x0004)
        except Exception:
            pass


def clear_screen() -> None:
    """Clear terminal screen and move cursor to home position."""
    if sys.platform == "win32" and "WT_SESSION" not in os.environ and "TERM" not in os.environ:
        os.system("cls")
    else:
        sys.stdout.write("\033[2J\033[H")
        sys.stdout.flush()


def make_bar(percent: float, width: int = 14, filled_char: str = "█", empty_char: str = "░") -> str:
    """Generate a colored Unicode/ASCII progress bar."""
    pct = max(0.0, min(100.0, float(percent)))
    fill_len = int(round((pct / 100.0) * width))
    empty_len = width - fill_len
    
    if pct >= 85.0:
        color = C.RED
    elif pct >= 60.0:
        color = C.YELLOW
    else:
        color = C.GREEN
        
    return f"{color}{filled_char * fill_len}{C.DIM}{empty_char * empty_len}{C.RESET} {pct:4.1f}%"


def truncate(text: str, max_len: int) -> str:
    s = str(text or "")
    if len(s) > max_len:
        return s[:max_len - 2] + ".."
    return s


def render_dashboard(data: Dict[str, Any], url: str, is_paused: bool = False) -> str:
    """Render full high-resolution terminal monitoring cockpit."""
    summary = data.get("summary", {})
    nodes = data.get("nodes", [])
    workloads = data.get("workloads", [])
    slices = data.get("recent_settlements", [])
    
    out: List[str] = []
    w_width = 100
    
    # --------------------------------------------------------------------------
    # 1. Header Banner
    # --------------------------------------------------------------------------
    ts_now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    out.append(f"{C.CYAN}{C.BOLD}╔{'═' * (w_width - 2)}╗{C.RESET}")
    title = "PROJECT NETWORK NEBULA — REAL-TIME CLUSTER & FLEET MONITOR [v1.7.0]"
    out.append(f"{C.CYAN}{C.BOLD}║{C.RESET}  {C.BOLD}{title.ljust(w_width - 6)}{C.RESET}  {C.CYAN}{C.BOLD}║{C.RESET}")
    sub = f"Gateway: {url}   •   Time: {ts_now}   •   Status: {'[PAUSED]' if is_paused else '[STREAMING LIVE]'}"
    out.append(f"{C.CYAN}{C.BOLD}║{C.RESET}  {C.DIM}{sub.ljust(w_width - 6)}{C.RESET}  {C.CYAN}{C.BOLD}║{C.RESET}")
    out.append(f"{C.CYAN}{C.BOLD}╚{'═' * (w_width - 2)}╝{C.RESET}")

    # --------------------------------------------------------------------------
    # 2. Cluster Vital Signs & High-Level Metrics
    # --------------------------------------------------------------------------
    tot_nodes = summary.get("total_nodes", len(nodes))
    act_nodes = summary.get("active_nodes", sum(1 for n in nodes if n.get("status") != "offline"))
    busy_nodes = summary.get("busy_nodes", sum(1 for n in nodes if n.get("status") == "busy"))
    
    tot_vram = summary.get("total_vram_gb", sum(float(n.get("vram_total_gb", 0)) for n in nodes))
    alloc_vram = summary.get("allocated_vram_gb", sum(float(n.get("vram_allocated_gb", 0)) for n in nodes))
    used_vram = summary.get("used_vram_gb", sum(float(n.get("vram_used_gb", 0)) for n in nodes))
    avg_util = summary.get("avg_gpu_utilization_pct", 0.0)
    
    tot_rewards = summary.get("total_rewards_minted_usd", 0.0)
    tot_compute_secs = summary.get("total_compute_seconds", 0.0)
    queued_t = summary.get("queued_tasks", 0)
    proc_t = summary.get("processing_tasks", 0)
    done_t = summary.get("completed_tasks", 0)

    vram_pct = (used_vram / max(0.1, alloc_vram)) * 100.0 if alloc_vram > 0 else 0.0
    vram_bar = make_bar(vram_pct, width=12)
    gpu_bar = make_bar(avg_util, width=12)

    out.append(f"\n{C.BOLD}▶ CLUSTER VITAL SIGNS{C.RESET}")
    out.append(
        f"  {C.CYAN}Fleet Nodes:{C.RESET} {C.GREEN}{act_nodes} Active{C.RESET} / {tot_nodes} Total ({busy_nodes} Busy)   "
        f"│ {C.CYAN}Tasks:{C.RESET} {C.YELLOW}{queued_t} Queued{C.RESET} • {C.MAGENTA}{proc_t} Active{C.RESET} • {C.GREEN}{done_t} Success{C.RESET}"
    )
    out.append(
        f"  {C.CYAN}Fleet VRAM Headroom:{C.RESET} {used_vram:.1f} / {alloc_vram:.1f} GB ({vram_bar})   "
        f"│ {C.CYAN}Fleet Avg GPU Util:{C.RESET} {gpu_bar}"
    )
    out.append(
        f"  {C.CYAN}PoDS Rewards Minted:{C.RESET} {C.GREEN}{C.BOLD}${tot_rewards:.4f} USD{C.RESET} ({tot_compute_secs:.1f}s verified compute time)"
    )

    # --------------------------------------------------------------------------
    # 3. Connected Worker Fleet & Hardware Utilization Table
    # --------------------------------------------------------------------------
    out.append(f"\n{C.BOLD}▶ CONNECTED FLEET & HARDWARE UTILIZATION (Universal Architecture & Geolocation){C.RESET}")
    out.append(f"{C.DIM}{'─' * w_width}{C.RESET}")
    node_hdr = f"{'NODE ID':<17} {'HARDWARE / ARCH':<22} {'LOCATION & RTT':<17} {'VRAM USAGE / ALLOC':<20} {'GPU UTIL':<12} {'RATE':<8} {'STATUS':<9}"
    out.append(f"{C.BOLD}{C.CYAN}{node_hdr}{C.RESET}")
    out.append(f"{C.DIM}{'─' * w_width}{C.RESET}")

    active_nodes_list = [n for n in nodes if str(n.get("status", "")).lower() in ("online", "busy")]
    offline_nodes_list = [n for n in nodes if str(n.get("status", "")).lower() not in ("online", "busy")]
    recent_offline = [n for n in offline_nodes_list if float(n.get("heartbeat_age_sec", 0.0) or 0.0) < 7200][:4]
    display_nodes = active_nodes_list + (recent_offline if active_nodes_list else offline_nodes_list[:4])

    if not display_nodes:
        out.append(f"  {C.YELLOW}(No worker nodes currently registered or connected){C.RESET}")
    else:
        for n in display_nodes:
            nid = truncate(n.get("id", "unknown"), 16)
            arch_raw = str(n.get("compute_architecture") or "cuda").lower()
            if "mps" in arch_raw:
                arch_tag = "MPS"
            elif "xpu" in arch_raw:
                arch_tag = "XPU"
            elif "rocm" in arch_raw:
                arch_tag = "ROCM"
            elif "arm" in arch_raw:
                arch_tag = "ARM"
            elif "cpu" in arch_raw:
                arch_tag = "CPU"
            else:
                arch_tag = "CUDA"

            gpu_model = n.get("gpu_model") or "Compute Node"
            gpu_display = f"{gpu_model} [{arch_tag}]"
            gpu = truncate(gpu_display, 21)

            city = n.get("city")
            country = n.get("country")
            ping_ms = float(n.get("latency_ping_ms", 15.0) or 15.0)
            if city and city not in ("Unknown", "None", ""):
                loc_text = f"{city} ({ping_ms:.0f}ms)"
            else:
                loc_text = f"{n.get('region', 'us-east')} ({ping_ms:.0f}ms)"
            reg = truncate(loc_text, 16)

            u_vram = float(n.get("vram_used_gb", 0.0) or 0.0)
            a_vram = float(n.get("vram_allocated_gb", 8.0) or 8.0)
            is_unif = bool(n.get("is_unified_memory", False))
            unit_suffix = "U" if is_unif else "G"
            vram_str = f"{u_vram:.1f}/{a_vram:.1f}{unit_suffix} ({int(n.get('vram_allocation_pct', 80))}%)"

            g_util = float(n.get("gpu_utilization_pct", 0.0) or 0.0)
            util_bar = make_bar(g_util, width=5)

            rate_str = f"${float(n.get('hourly_rate_usd', 0.45) or 0.45):.2f}/h"

            st = str(n.get("status", "offline")).lower()
            if st == "online":
                badge = f"{C.GREEN}[ONLINE]{C.RESET}"
            elif st == "busy":
                badge = f"{C.YELLOW}[BUSY]  {C.RESET}"
            else:
                age_s = float(n.get("heartbeat_age_sec", 0.0) or 0.0)
                if age_s < 3600:
                    ago_lbl = f"{int(max(1, age_s // 60))}m"
                elif age_s < 86400:
                    ago_lbl = f"{int(age_s // 3600)}h"
                else:
                    ago_lbl = f"{int(age_s // 86400)}d"
                badge = f"{C.DIM}{C.RED}[OFFLINE {ago_lbl}]{C.RESET}"

            line = f"{nid:<17} {gpu:<22} {reg:<17} {vram_str:<20} {util_bar:<21} {rate_str:<8} {badge}"
            out.append(line)

    # --------------------------------------------------------------------------
    # 4. Active Workloads & Shard Distribution
    # --------------------------------------------------------------------------
    out.append(f"\n{C.BOLD}▶ LIVE WORKLOAD DISTRIBUTION & TRAINING PROGRESSION{C.RESET}")
    out.append(f"{C.DIM}{'─' * w_width}{C.RESET}")
    task_hdr = f"{'TASK ID':<18} {'ASSIGNED NODE':<18} {'TYPE & WORKLOAD':<22} {'PROGRESS / SLICES':<22} {'TIME':<8} {'STATUS':<10}"
    out.append(f"{C.BOLD}{C.CYAN}{task_hdr}{C.RESET}")
    out.append(f"{C.DIM}{'─' * w_width}{C.RESET}")

    active_tasks = [t for t in workloads if t.get("status") in ("PROCESSING", "TRAINING", "RUNNING", "QUEUED")][:8]
    if not active_tasks:
        recent_done = workloads[:5]
        if recent_done:
            active_tasks = recent_done

    if not active_tasks:
        out.append(f"  {C.DIM}(Queue is currently idle — waiting for dispatch){C.RESET}")
    else:
        for t in active_tasks:
            tid = truncate(t.get("task_id", ""), 17)
            w_assign = truncate(t.get("claimed_by", "unassigned") or "unassigned", 17)
            p_text = truncate(t.get("prompt", "Inference"), 21)

            tot_s = max(1, int(t.get("total_slices", 1) or 1))
            comp_s = int(t.get("completed_slices", 0) or 0)
            s_pct = (comp_s / float(tot_s)) * 100.0
            
            is_training = t.get("task_type") == "training" or str(t.get("task_id", "")).startswith("train-")
            if is_training:
                slice_bar = f"Ep {comp_s}/{tot_s} {make_bar(s_pct, width=5)}"
            else:
                slice_bar = f"Sl {comp_s}/{tot_s} {make_bar(s_pct, width=5)}"

            t_sec = f"{float(t.get('total_compute_seconds', 0.0)):.1f}s"

            st = str(t.get("status", "QUEUED")).upper()
            if st in ("PROCESSING", "RUNNING"):
                st_badge = f"{C.MAGENTA}RUNNING{C.RESET}"
            elif st == "TRAINING":
                st_badge = f"{C.CYAN}TRAIN  {C.RESET}"
            elif st == "QUEUED":
                st_badge = f"{C.YELLOW}QUEUED {C.RESET}"
            elif st in ("SUCCESS", "COMPLETED"):
                st_badge = f"{C.GREEN}SUCCESS{C.RESET}"
            elif st in ("CANCELLED", "CANCEL"):
                st_badge = f"{C.YELLOW}CANCEL {C.RESET}"
            else:
                st_badge = f"{C.RED}{st[:7]}{C.RESET}"

            t_line = f"{tid:<18} {w_assign:<18} {p_text:<22} {slice_bar:<31} {t_sec:<8} {st_badge}"
            out.append(t_line)

    # --------------------------------------------------------------------------
    # 5. Real-Time PoDS Reward Minting Ticker (Tiny Delivered Slices)
    # --------------------------------------------------------------------------
    out.append(f"\n{C.BOLD}▶ REAL-TIME PoDS REWARD MINTING TICKER (Delivered slice micro-payouts){C.RESET}")
    out.append(f"{C.DIM}{'─' * w_width}{C.RESET}")
    pods_hdr = f"{'TIME':<10} {'TASK ID':<18} {'WORKER':<18} {'SLICE':<9} {'COMPUTE':<10} {'MINTED USD':<15} {'PROOF HASH':<16}"
    out.append(f"{C.BOLD}{C.CYAN}{pods_hdr}{C.RESET}")
    out.append(f"{C.DIM}{'─' * w_width}{C.RESET}")

    if not slices:
        out.append(f"  {C.DIM}(No compute slices verified yet — slices mint dynamically upon return){C.RESET}")
    else:
        for s in slices[:6]:
            created = s.get("created_at") or ""
            t_str = created.split("T")[-1][:8] if "T" in created else created[:8]
            s_task = truncate(s.get("task_id", ""), 17)
            s_worker = truncate(s.get("worker_id", ""), 17)
            s_idx = f"#{s.get('slice_index', 1)}"
            c_sec = f"{float(s.get('compute_time_sec', 0.0)):.2f}s"
            m_usd = f"{C.GREEN}+${float(s.get('reward_usd', 0.0)):.6f}{C.RESET}"
            p_hash = truncate(str(s.get("payload_hash", "")), 15)

            p_line = f"{t_str:<10} {s_task:<18} {s_worker:<18} {s_idx:<9} {c_sec:<10} {m_usd:<24} {p_hash:<16}"
            out.append(p_line)

    # --------------------------------------------------------------------------
    # 6. Keyboard Control Hints & Footer
    # --------------------------------------------------------------------------
    out.append(f"{C.DIM}{'─' * w_width}{C.RESET}")
    footer = f"{C.DIM}[Q] Quit  •  [R] Force Refresh  •  [Space] Pause/Resume  •  [O] Toggle Once Mode{C.RESET}"
    out.append(footer)

    return "\n".join(out)


def poll_snapshot(server_url: str) -> Optional[Dict[str, Any]]:
    """Fetch live cluster telemetry snapshot from the orchestrator API."""
    candidates = [
        f"{server_url}/api/v1/cluster/monitor/snapshot",
        f"{server_url}/api/cluster/monitor/snapshot",
    ]
    for endpoint in candidates:
        try:
            res = requests.get(endpoint, timeout=3.0)
            if res.status_code == 200:
                return res.json()
        except Exception:
            pass
    return None


def check_keypress() -> Optional[str]:
    """Non-blocking keyboard reader across Windows and Unix."""
    if sys.platform == "win32":
        try:
            import msvcrt
            if msvcrt.kbhit():
                ch = msvcrt.getch()
                try:
                    return ch.decode("utf-8").lower()
                except Exception:
                    return None
        except Exception:
            return None
    else:
        try:
            import select
            r, _, _ = select.select([sys.stdin], [], [], 0.0)
            if r:
                return sys.stdin.read(1).lower()
        except Exception:
            return None
    return None


def main() -> int:
    enable_windows_ansi()
    
    parser = argparse.ArgumentParser(
        description="Project NetworkNebula Real-Time Fleet & Telemetry Terminal Dashboard",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--url",
        "--server",
        dest="url",
        default=os.environ.get("NEBULA_SERVER_URL", "http://127.0.0.1:8000"),
        help="FastAPI orchestrator URL (default: http://127.0.0.1:8000 or $NEBULA_SERVER_URL)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.5,
        help="Refresh polling interval in seconds (default: 1.5s)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Render exactly one dashboard snapshot frame and exit cleanly (useful for scripts & QA)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw telemetry JSON snapshot instead of ANSI dashboard and exit",
    )
    args = parser.parse_args()

    server_url = args.url.rstrip("/")

    # Single-shot JSON inspection mode
    if args.json:
        data = poll_snapshot(server_url)
        if not data:
            print(json.dumps({"error": f"Failed to connect to orchestrator at {server_url}"}))
            return 1
        print(json.dumps(data, indent=2))
        return 0

    # Single-shot ANSI dashboard render
    if args.once:
        data = poll_snapshot(server_url)
        if not data:
            # Fallback mock for disconnected preview
            data = {
                "summary": {"total_nodes": 0, "active_nodes": 0, "busy_nodes": 0, "total_vram_gb": 0.0, "allocated_vram_gb": 0.0, "used_vram_gb": 0.0, "avg_gpu_utilization_pct": 0.0, "total_rewards_minted_usd": 0.0, "total_compute_seconds": 0.0, "queued_tasks": 0, "processing_tasks": 0, "completed_tasks": 0},
                "nodes": [],
                "workloads": [],
                "recent_settlements": [],
            }
            print(f"{C.RED}[WARNING] Orchestrator at {server_url} not responding. Displaying idle frame.{C.RESET}\n")
        print(render_dashboard(data, server_url, is_paused=False))
        return 0

    # Interactive Live Refresh Loop
    is_paused = False
    last_data: Optional[Dict[str, Any]] = None

    try:
        while True:
            # Handle keypress events
            key = check_keypress()
            if key == "q":
                clear_screen()
                print(f"{C.CYAN}[*] Nebula Fleet Monitor exited cleanly.{C.RESET}")
                return 0
            elif key == " ":
                is_paused = not is_paused
            elif key == "r":
                last_data = poll_snapshot(server_url)

            if not is_paused:
                fresh = poll_snapshot(server_url)
                if fresh:
                    last_data = fresh

            clear_screen()
            if last_data:
                print(render_dashboard(last_data, server_url, is_paused=is_paused))
            else:
                print(f"{C.YELLOW}[*] Connecting to NetworkNebula Orchestrator at {server_url}...{C.RESET}")
                print(f"{C.DIM}Ensure backend is running (python -m uvicorn app.main:app --port 8000){C.RESET}")

            # Polling wait with sub-slice sleep for responsive keypresses
            poll_steps = max(1, int(args.interval / 0.15))
            for _ in range(poll_steps):
                time.sleep(0.15)
                sub_key = check_keypress()
                if sub_key == "q":
                    clear_screen()
                    print(f"{C.CYAN}[*] Nebula Fleet Monitor exited cleanly.{C.RESET}")
                    return 0
                elif sub_key == " ":
                    is_paused = not is_paused
                    break
                elif sub_key == "r":
                    break

    except KeyboardInterrupt:
        clear_screen()
        print(f"\n{C.CYAN}[*] Nebula Fleet Monitor terminated by user.{C.RESET}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
