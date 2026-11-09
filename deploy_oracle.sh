#!/usr/bin/env bash
# ==============================================================================
# Project NetworkNebula — Zero-Touch Automated Cloud Server Deployment
# Optimized for Oracle Cloud Always Free (Ubuntu 22.04 / 24.04 LTS, ARM64 & x86_64)
# ==============================================================================
# Run with a single command:
#   curl -sSL https://raw.githubusercontent.com/ohad-BN/Project-NetworkNebula/oracle-server/deploy_oracle.sh | bash
# ==============================================================================

set -eo pipefail

# Text formatting
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

echo -e "${CYAN}${BOLD}"
echo "======================================================================"
echo "    PROJECT NETWORK NEBULA — AUTOMATED CLOUD SERVER DEPLOYMENT        "
echo "======================================================================"
echo -e "${RESET}"

# 1. Determine running user and sudo privilege
if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
    TARGET_USER="${SUDO_USER:-root}"
    USER_HOME=$(eval echo "~$TARGET_USER")
else
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
        TARGET_USER="$USER"
        USER_HOME="$HOME"
    else
        echo -e "${RED}[ERROR] This script requires sudo or root privileges.${RESET}"
        exit 1
    fi
fi

ARCH=$(uname -m)
echo -e "[*] Target User: ${BOLD}${TARGET_USER}${RESET} (Home: ${USER_HOME})"
echo -e "[*] Detected Architecture: ${BOLD}${ARCH}${RESET}"

# 2. Update System & Install Core Packages
echo -e "\n${CYAN}[1/5] Updating system packages and installing prerequisites...${RESET}"
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -y -q
$SUDO apt-get install -y -q \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    lsb-release \
    iptables \
    iptables-persistent \
    netfilter-persistent

# 3. Install Docker & Docker Compose Plugin if not installed
echo -e "\n${CYAN}[2/5] Configuring Docker container runtime...${RESET}"
if ! command -v docker >/dev/null 2>&1; then
    echo "[*] Installing Docker Engine..."
    $SUDO apt-get install -y -q docker.io docker-compose-v2
fi

# Ensure docker service is running
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true

# Add target user to docker group
if [ -n "$TARGET_USER" ] && [ "$TARGET_USER" != "root" ]; then
    $SUDO usermod -aG docker "$TARGET_USER" || true
fi

# Test Docker Compose command
DOCKER_COMPOSE="docker compose"
if ! $DOCKER_COMPOSE version >/dev/null 2>&1; then
    if command -v docker-compose >/dev/null 2>&1; then
        DOCKER_COMPOSE="docker-compose"
    else
        echo -e "${RED}[ERROR] Neither 'docker compose' nor 'docker-compose' found.${RESET}"
        exit 1
    fi
fi
echo -e "${GREEN}[OK] Docker runtime active: $($DOCKER_COMPOSE version)${RESET}"

# 4. Open Oracle Cloud Linux Internal Firewall (iptables & ufw)
echo -e "\n${CYAN}[3/5] Configuring firewall rules (Ports 80, 443, 8000, 5173, 9000, 9001)...${RESET}"
PORTS=(80 443 8000 5173 9000 9001)

for PORT in "${PORTS[@]}"; do
    # Check if rule already exists; if not, insert at position 6
    if ! $SUDO iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
        $SUDO iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || \
        $SUDO iptables -I INPUT -p tcp --dport "$PORT" -j ACCEPT
    fi
done

# Persist iptables rules
$SUDO netfilter-persistent save >/dev/null 2>&1 || true

# Also configure UFW if enabled
if command -v ufw >/dev/null 2>&1; then
    if $SUDO ufw status | grep -q "Status: active"; then
        echo "[*] Adding rules to UFW..."
        for PORT in "${PORTS[@]}"; do
            $SUDO ufw allow "$PORT"/tcp >/dev/null 2>&1 || true
        done
    fi
fi
echo -e "${GREEN}[OK] Firewall configured and ports opened.${RESET}"

# 5. Fetch / Clone Project NetworkNebula Repository
echo -e "\n${CYAN}[4/5] Setting up Project NetworkNebula repository...${RESET}"
REPO_URL="https://github.com/ohad-BN/Project-NetworkNebula.git"
BRANCH="oracle-server"
PROJECT_DIR="${USER_HOME}/Project-NetworkNebula"

if [ -d "$PROJECT_DIR/.git" ]; then
    echo "[*] Existing repository found at ${PROJECT_DIR}. Fetching latest updates..."
    cd "$PROJECT_DIR"
    $SUDO -u "$TARGET_USER" git fetch origin
    $SUDO -u "$TARGET_USER" git checkout "$BRANCH" || $SUDO -u "$TARGET_USER" git checkout -b "$BRANCH" "origin/$BRANCH"
    $SUDO -u "$TARGET_USER" git pull origin "$BRANCH" || true
else
    echo "[*] Cloning ${REPO_URL} (${BRANCH} branch)..."
    $SUDO -u "$TARGET_USER" git clone -b "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi

# Ensure production environment file
if [ ! -f ".env" ]; then
    if [ -f ".env.server.example" ]; then
        echo "[*] Creating .env from .env.server.example..."
        $SUDO -u "$TARGET_USER" cp .env.server.example .env
    fi
fi

# 6. Build and Launch Server Stack
echo -e "\n${CYAN}[5/5] Building and launching full Docker server stack...${RESET}"
echo "[*] Services: PostgreSQL, Redis, MinIO S3, FastAPI Orchestrator, Celery Worker, and Web Console"
$SUDO $DOCKER_COMPOSE -f docker-compose.server.yml up -d --build

# 7. Health Check Verification
echo -e "\n${CYAN}[*] Waiting for services to initialize...${RESET}"
MAX_RETRIES=30
RETRY=0
HEALTHY=false

while [ $RETRY -lt $MAX_RETRIES ]; do
    RETRY=$((RETRY + 1))
    if curl -s "http://127.0.0.1:8000/health" 2>/dev/null | grep -q "healthy"; then
        HEALTHY=true
        break
    fi
    printf "."
    sleep 2
done
echo ""

if [ "$HEALTHY" = true ]; then
    echo -e "${GREEN}${BOLD}[OK] All orchestrator services are healthy and online!${RESET}"
else
    echo -e "${YELLOW}[!] Services are taking longer than expected to report healthy, but containers are running.${RESET}"
fi

# 8. Discover Public IP Address
PUBLIC_IP=$(curl -s https://api.ipify.org 2>/dev/null || curl -s https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

# 9. Print Final Success Summary
echo -e "\n${GREEN}${BOLD}======================================================================"
echo "    🚀 PROJECT NETWORK NEBULA SERVER IS LIVE!                         "
echo -e "======================================================================${RESET}"
echo ""
echo -e "  ${BOLD}🌐 Enterprise Web Console:${RESET}   http://${PUBLIC_IP}  (or http://${PUBLIC_IP}:5173)"
echo -e "  ${BOLD}⚡ FastAPI Orchestrator:${RESET}     http://${PUBLIC_IP}:8000"
echo -e "  ${BOLD}📖 Interactive API Docs:${RESET}     http://${PUBLIC_IP}:8000/docs"
echo -e "  ${BOLD}📦 MinIO S3 Object Storage:${RESET}  http://${PUBLIC_IP}:9001  (User: nebula / Pass: nebula123)"
echo ""
echo -e "${CYAN}${BOLD}----------------------------------------------------------------------"
echo "  CONNECTING A GPU WORKER FROM ANY PC / TERMINAL:"
echo -e "----------------------------------------------------------------------${RESET}"
echo "  On your Windows PC (PowerShell) or Linux machine, run:"
echo ""
echo -e "  ${BOLD}python worker/nebula_worker.py join --server http://${PUBLIC_IP}:8000${RESET}"
echo ""
echo "  To enable autonomous 24/7 background mode (silent cooling/fan regulation):"
echo -e "  ${BOLD}python worker/nebula_worker.py join --server http://${PUBLIC_IP}:8000 --always-silent${RESET}"
echo ""
echo -e "${YELLOW}${BOLD}⚠️  IMPORTANT ORACLE CLOUD REMINDER:${RESET}"
echo "  Remember to add Ingress Rules in your Oracle Cloud Console:"
echo "  (VCN -> Default Security List -> Add Ingress Rule for Destination Ports 80, 443, 8000, 5173, 9001)"
echo -e "${GREEN}${BOLD}======================================================================${RESET}\n"
