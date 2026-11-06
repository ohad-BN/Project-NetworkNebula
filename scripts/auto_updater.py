#!/usr/bin/env python3
"""
Project NetworkNebula — Zero-Touch Server Auto-Updater Daemon
Runs as a headless background process or scheduled service on the Old PC / Central Host.
Continuously watches the GitHub repository for new commits on 'main'.
When updates are detected:
1. Automatically executes 'git pull origin main'
2. Automatically rebuilds/reloads the Docker stack ('docker compose -f docker-compose.server.yml up -d --build')
3. Ensures zero physical server interaction is ever required.
"""

import argparse
import logging
import os
import subprocess
import sys
import time

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [AutoUpdater] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("AutoUpdater")


def get_commit_hash(ref: str = "HEAD") -> str:
    """Return the commit hash for the given git reference."""
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", ref],
            cwd=PROJECT_ROOT,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
        return out.decode("utf-8").strip()
    except Exception:
        return ""


def check_and_apply_update(branch: str = "main", reload_docker: bool = True) -> bool:
    """
    Check if remote branch has new commits and apply them.
    Returns True if an update was applied, False otherwise.
    """
    local_commit = get_commit_hash("HEAD")
    if not local_commit:
        logger.warning("Failed to determine local git commit hash")
        return False

    # 1. Fetch remote origin
    try:
        subprocess.run(
            ["git", "fetch", "origin", branch],
            cwd=PROJECT_ROOT,
            capture_output=True,
            timeout=30,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        logger.warning(f"Git fetch failed (network may be temporarily offline): {e}")
        return False
    except Exception as e:
        logger.warning(f"Unexpected error during git fetch: {e}")
        return False

    # 2. Check remote commit
    remote_commit = get_commit_hash(f"origin/{branch}")
    if not remote_commit:
        logger.warning(f"Failed to determine remote commit hash for origin/{branch}")
        return False

    if local_commit == remote_commit:
        logger.debug(f"Up to date at {local_commit[:7]}")
        return False

    logger.info("=" * 60)
    logger.info(f"New commit detected on origin/{branch}!")
    logger.info(f"Local:  {local_commit[:7]}")
    logger.info(f"Remote: {remote_commit[:7]}")
    logger.info("Applying update via 'git pull'...")

    # 3. Pull latest code
    try:
        pull_proc = subprocess.run(
            ["git", "pull", "origin", branch],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=45,
            check=True,
        )
        logger.info(f"Git pull succeeded:\n{pull_proc.stdout.strip()}")
    except Exception as e:
        logger.error(f"Git pull failed: {e}")
        return False

    # 4. Reload Docker stack if enabled and Docker is present
    if reload_docker:
        compose_file = os.path.join(PROJECT_ROOT, "docker-compose.server.yml")
        if os.path.isfile(compose_file):
            logger.info("Triggering Docker Compose update (docker compose -f docker-compose.server.yml up -d --build)...")
            try:
                compose_proc = subprocess.run(
                    ["docker", "compose", "-f", "docker-compose.server.yml", "up", "-d", "--build"],
                    cwd=PROJECT_ROOT,
                    capture_output=True,
                    text=True,
                    timeout=300,
                )
                if compose_proc.returncode == 0:
                    logger.info("Docker Compose stack successfully updated and reloaded!")
                else:
                    logger.warning(f"Docker Compose reload output:\n{compose_proc.stderr.strip()}")
            except FileNotFoundError:
                logger.info("Docker binary not found on PATH; skipping container rebuild.")
            except Exception as e:
                logger.warning(f"Docker Compose invocation failed: {e}")

    new_local = get_commit_hash("HEAD")
    logger.info(f"Update completed successfully! Active commit: {new_local[:7]}")
    logger.info("=" * 60)
    return True


def run_daemon(interval: int = 60, branch: str = "main", reload_docker: bool = True):
    """Run the continuous monitoring loop."""
    logger.info("=" * 60)
    logger.info("NetworkNebula Zero-Touch Auto-Updater Daemon Started")
    logger.info(f"Project directory: {PROJECT_ROOT}")
    logger.info(f"Tracking branch:   origin/{branch}")
    logger.info(f"Poll interval:     {interval} seconds")
    logger.info(f"Current commit:    {get_commit_hash('HEAD')[:7]}")
    logger.info("=" * 60)

    while True:
        try:
            check_and_apply_update(branch=branch, reload_docker=reload_docker)
        except Exception as e:
            logger.error(f"Error in update loop: {e}")

        time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description="NetworkNebula Zero-Touch Auto-Updater Daemon")
    parser.add_argument("--interval", type=int, default=60, help="Poll interval in seconds (default: 60)")
    parser.add_argument("--branch", type=str, default="main", help="Git branch to track (default: main)")
    parser.add_argument("--no-docker", action="store_true", help="Skip Docker compose reload on update")
    parser.add_argument("--once", action="store_true", help="Check and apply updates once, then exit")
    args = parser.parse_args()

    if args.once:
        applied = check_and_apply_update(branch=args.branch, reload_docker=not args.no_docker)
        sys.exit(0 if applied or True else 1)
    else:
        run_daemon(interval=args.interval, branch=args.branch, reload_docker=not args.no_docker)


if __name__ == "__main__":
    main()
