"""
Project NetworkNebula — System & Remote Server Management Router
Enables zero-touch, headless remote administration and in-browser updates:
- System status introspection (Git commit, uptime, CPU/RAM/Disk metrics, active workers)
- Remote Git update detection and 1-click pull deployment from any browser
- Network & Tailscale Funnel / remote connectivity discovery
"""

import os
import platform
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import verify_enterprise_auth
from app.database import get_db
from app.models import Task, User, Worker

router = APIRouter(prefix="/api/v1/system", tags=["System & Remote Management"])

_PROCESS_START_TIME = time.time()
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


class SystemGitInfo(BaseModel):
    commit: str = Field(..., description="Short Git commit hash")
    full_commit: str = Field(..., description="Full Git commit SHA")
    branch: str = Field(..., description="Current Git branch")
    message: str = Field(..., description="Last commit message")
    timestamp: str = Field(..., description="Commit author date")
    is_dirty: bool = Field(..., description="True if local uncommitted changes exist")


class SystemResourceMetrics(BaseModel):
    cpu_percent: float
    memory_used_gb: float
    memory_total_gb: float
    memory_percent: float
    disk_used_gb: float
    disk_total_gb: float
    disk_percent: float


class SystemStatusResponse(BaseModel):
    status: str
    uptime_seconds: float
    uptime_human: str
    hostname: str
    os: str
    platform_system: str
    local_ips: List[str]
    tailscale_ip: Optional[str] = None
    git: SystemGitInfo
    resources: SystemResourceMetrics
    cluster_overview: Dict[str, Any]


class GitCheckUpdateResponse(BaseModel):
    update_available: bool
    local_commit: str
    remote_commit: str
    commits_behind: int
    pending_commits: List[str]
    message: str


class GitApplyUpdateResponse(BaseModel):
    success: bool
    previous_commit: str
    new_commit: str
    output: str
    restart_recommended: bool
    message: str


def _get_git_info() -> SystemGitInfo:
    """Read local Git repository information safely."""
    commit = "unknown"
    full_commit = "unknown"
    branch = "unknown"
    message = "No commit info available"
    timestamp = ""
    is_dirty = False

    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=PROJECT_ROOT,
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).decode("utf-8").strip()

        full_commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=PROJECT_ROOT,
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).decode("utf-8").strip()

        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=PROJECT_ROOT,
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).decode("utf-8").strip()

        message = subprocess.check_output(
            ["git", "log", "-1", "--pretty=%s"],
            cwd=PROJECT_ROOT,
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).decode("utf-8").strip()

        timestamp = subprocess.check_output(
            ["git", "log", "-1", "--pretty=%cd", "--date=iso"],
            cwd=PROJECT_ROOT,
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).decode("utf-8").strip()

        diff_stat = subprocess.check_output(
            ["git", "status", "--porcelain"],
            cwd=PROJECT_ROOT,
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).decode("utf-8").strip()
        is_dirty = len(diff_stat) > 0
    except Exception:
        pass

    return SystemGitInfo(
        commit=commit,
        full_commit=full_commit,
        branch=branch,
        message=message,
        timestamp=timestamp,
        is_dirty=is_dirty,
    )


def _get_tailscale_ip() -> Optional[str]:
    """Detect Tailscale IPv4 address if Tailscale is running on this node."""
    tailscale_bin = shutil.which("tailscale")
    if tailscale_bin:
        try:
            out = subprocess.check_output(
                [tailscale_bin, "ip", "-4"],
                stderr=subprocess.DEVNULL,
                timeout=3,
            ).decode("utf-8").strip()
            if out:
                return out.splitlines()[0]
        except Exception:
            pass
    # Check socket interfaces for 100.x.y.z (standard Tailscale CGNAT subnet)
    try:
        _, _, ips = socket.gethostbyname_ex(socket.gethostname())
        for ip in ips:
            if ip.startswith("100."):
                return ip
    except Exception:
        pass
    return None


def _get_local_ips() -> List[str]:
    """Return local IPv4 network addresses."""
    ips_set = set()
    try:
        _, _, ips = socket.gethostbyname_ex(socket.gethostname())
        for ip in ips:
            if not ip.startswith("127."):
                ips_set.add(ip)
    except Exception:
        pass

    # Fallback using UDP socket connect (doesn't send packets)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        out_ip = s.getsockname()[0]
        s.close()
        if out_ip and not out_ip.startswith("127."):
            ips_set.add(out_ip)
    except Exception:
        pass

    return sorted(list(ips_set))


def _get_resource_metrics() -> SystemResourceMetrics:
    """Collect hardware utilization metrics (CPU, RAM, Disk)."""
    cpu_pct = 0.0
    mem_used = 0.0
    mem_total = 0.0
    mem_pct = 0.0
    disk_used = 0.0
    disk_total = 0.0
    disk_pct = 0.0

    try:
        import psutil
        cpu_pct = float(psutil.cpu_percent(interval=None))
        mem = psutil.virtual_memory()
        mem_used = round(mem.used / (1024 ** 3), 2)
        mem_total = round(mem.total / (1024 ** 3), 2)
        mem_pct = float(mem.percent)

        disk = psutil.disk_usage(PROJECT_ROOT)
        disk_used = round(disk.used / (1024 ** 3), 2)
        disk_total = round(disk.total / (1024 ** 3), 2)
        disk_pct = float(disk.percent)
    except Exception:
        pass

    return SystemResourceMetrics(
        cpu_percent=cpu_pct,
        memory_used_gb=mem_used,
        memory_total_gb=mem_total,
        memory_percent=mem_pct,
        disk_used_gb=disk_used,
        disk_total_gb=disk_total,
        disk_percent=disk_pct,
    )


def _format_uptime(seconds: float) -> str:
    """Format seconds into a human-readable duration."""
    s = int(seconds)
    days, rem = divmod(s, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, secs = divmod(rem, 60)
    if days > 0:
        return f"{days}d {hours}h {minutes}m"
    if hours > 0:
        return f"{hours}h {minutes}m {secs}s"
    return f"{minutes}m {secs}s"


@router.get("/status", response_model=SystemStatusResponse)
def get_system_status(db: Session = Depends(get_db)):
    """
    Introspect server status, hardware metrics, Git commit, and cluster overview.
    Accessible from any browser.
    """
    uptime_sec = time.time() - _PROCESS_START_TIME

    # Query cluster overview
    total_workers = db.query(Worker).count()
    online_workers = db.query(Worker).filter(Worker.status.in_(["online", "busy"])).count()
    always_silent_workers = db.query(Worker).filter(Worker.is_always_silent == True).count()
    total_users = db.query(User).count()
    active_tasks = db.query(Task).filter(Task.status.in_(["PENDING", "PROCESSING", "QUEUED"])).count()

    cluster_overview = {
        "total_workers": total_workers,
        "online_workers": online_workers,
        "always_silent_workers": always_silent_workers,
        "total_users": total_users,
        "active_tasks": active_tasks,
    }

    return SystemStatusResponse(
        status="ok",
        uptime_seconds=round(uptime_sec, 2),
        uptime_human=_format_uptime(uptime_sec),
        hostname=socket.gethostname(),
        os=f"{platform.system()} {platform.release()} ({platform.machine()})",
        platform_system=platform.system().lower(),
        local_ips=_get_local_ips(),
        tailscale_ip=_get_tailscale_ip(),
        git=_get_git_info(),
        resources=_get_resource_metrics(),
        cluster_overview=cluster_overview,
    )


@router.get("/check-update", response_model=GitCheckUpdateResponse)
def check_for_updates():
    """
    Check if a newer commit exists on the remote Git branch (origin/main)
    without modifying working tree files.
    """
    git_info = _get_git_info()
    local_commit = git_info.full_commit
    remote_commit = local_commit
    commits_behind = 0
    pending_commits: List[str] = []
    update_available = False

    try:
        # Perform non-destructive fetch
        subprocess.run(
            ["git", "fetch", "origin", "main"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            timeout=15,
            check=False,
        )

        remote_commit_bytes = subprocess.check_output(
            ["git", "rev-parse", "origin/main"],
            cwd=PROJECT_ROOT,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        remote_commit = remote_commit_bytes.decode("utf-8").strip()

        if remote_commit and remote_commit != local_commit:
            update_available = True
            log_output = subprocess.check_output(
                ["git", "log", f"{local_commit}..origin/main", "--oneline"],
                cwd=PROJECT_ROOT,
                stderr=subprocess.DEVNULL,
                timeout=5,
            ).decode("utf-8").strip()
            if log_output:
                pending_commits = [line.strip() for line in log_output.splitlines() if line.strip()]
                commits_behind = len(pending_commits)
    except Exception as e:
        return GitCheckUpdateResponse(
            update_available=False,
            local_commit=local_commit[:7] if local_commit else "unknown",
            remote_commit="unknown",
            commits_behind=0,
            pending_commits=[],
            message=f"Git check failed: {str(e)}",
        )

    msg = f"{commits_behind} update(s) available on origin/main" if update_available else "System is up to date"
    return GitCheckUpdateResponse(
        update_available=update_available,
        local_commit=local_commit[:7],
        remote_commit=remote_commit[:7],
        commits_behind=commits_behind,
        pending_commits=pending_commits,
        message=msg,
    )


@router.post("/update", response_model=GitApplyUpdateResponse)
def apply_system_update(
    request: Request,
    current_user: Optional[User] = Depends(verify_enterprise_auth),
):
    """
    Pull latest changes from Git and report update outcome.
    Requires enterprise / admin authentication.
    """
    initial_git = _get_git_info()
    previous_commit = initial_git.commit

    try:
        proc = subprocess.run(
            ["git", "pull", "origin", "main"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
        )
        output = proc.stdout if proc.stdout else proc.stderr
        new_git = _get_git_info()
        new_commit = new_git.commit

        success = proc.returncode == 0
        restart_recommended = success and (previous_commit != new_commit)
        msg = "Update applied successfully" if success else f"Git pull failed with exit code {proc.returncode}"

        return GitApplyUpdateResponse(
            success=success,
            previous_commit=previous_commit,
            new_commit=new_commit,
            output=output.strip(),
            restart_recommended=restart_recommended,
            message=msg,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {str(e)}")


@router.get("/remote-access-guide")
def get_remote_access_guide():
    """
    Return clean connectivity instructions for accessing this server
    from ANY browser without installing VPN software.
    """
    hostname = socket.gethostname()
    local_ips = _get_local_ips()
    tailscale_ip = _get_tailscale_ip()

    guides = {
        "hostname": hostname,
        "local_network_urls": [f"http://{ip}:8000" for ip in local_ips],
        "tailscale_ip": tailscale_ip,
        "tailscale_private_url": f"http://{tailscale_ip}:8000" if tailscale_ip else None,
        "tailscale_funnel_public_instructions": {
            "description": "Expose the web console to ANY browser on Earth with zero client apps and free HTTPS.",
            "command": "tailscale funnel 80 on",
            "public_url_pattern": f"https://{hostname.lower()}.<your-tailnet>.ts.net",
        },
        "cloudflare_tunnel_instructions": {
            "description": "Map a custom domain (e.g. https://nebula.yourdomain.com) with free Cloudflare zero-trust tunnel.",
            "docker_command": "docker run -d --name cloudflared --restart unless-stopped cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <YOUR_TOKEN>",
        },
    }
    return guides
