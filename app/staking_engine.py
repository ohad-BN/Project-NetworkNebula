#!/usr/bin/env python3
"""
Project NetworkNebula — Node Staking & Automated Slashing Controller
===================================================================
Implements cryptoeconomic, code-enforced SLAs for decentralized GPU workers:
- Host node collateral staking deposits & lockups ($50.00 - $500.00 USD)
- Safe collateral unstaking & unbonding verification (ensures node is not mid-job)
- Automated slashing penalties:
    * 25% slash for unannounced node disconnection / dropped training epochs
    * 100% slash + permanent ban for cryptographic fraud or poisoned weights
    * 10% slash for repeated SLA latency timeouts
- Customer compensatory redistribution: 80% of slashed collateral is credited
  directly to the affected enterprise customer's wallet balance
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import Transaction, TransactionType, User, Worker

logger = logging.getLogger("staking_engine")

MIN_INFERENCE_STAKE_USD = 50.0
MIN_TRAINING_STAKE_USD = 250.0
CUSTOMER_COMPENSATION_SHARE = 0.80  # 80% of slashed collateral credited to customer


class StakingEngine:
    """
    Singleton controller managing collateral deposits, slashing enforcement,
    and compensatory customer payouts across the decentralized GPU fleet.
    """

    _instance: Optional["StakingEngine"] = None

    def __init__(self):
        self.default_min_stake = MIN_INFERENCE_STAKE_USD

    @classmethod
    def get_instance(cls) -> "StakingEngine":
        if cls._instance is None:
            cls._instance = StakingEngine()
        return cls._instance

    def stake_collateral(
        self,
        db: Session,
        worker_id: str,
        amount_usd: float,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Deposit collateral into a worker node's staking pool.
        Deducts funds from host user's wallet balance if user_id is provided.
        """
        if amount_usd <= 0:
            raise ValueError("Staking deposit amount must be greater than $0.00")

        worker = db.query(Worker).filter(Worker.id == worker_id).first()
        if not worker:
            raise ValueError(f"Worker node '{worker_id}' not found")

        # Resolve owner user
        owner_id = user_id or worker.user_id
        owner = db.query(User).filter(User.id == owner_id).first() if owner_id else None

        if owner:
            if owner.balance < amount_usd:
                raise ValueError(
                    f"Insufficient wallet balance (${owner.balance:.2f}) to stake ${amount_usd:.2f}"
                )
            owner.balance = round(owner.balance - amount_usd, 4)

            # Record STAKE transaction
            stake_tx = Transaction(
                transaction_id=str(uuid.uuid4()),
                user_id=owner.id,
                worker_id=worker.id,
                type=TransactionType.STAKE,
                amount=-amount_usd,
                balance_after=owner.balance,
                description=f"Collateral stake deposit for GPU node {worker.name} ({worker.id})",
            )
            db.add(stake_tx)

        worker.staked_amount_usd = round(
            float(worker.staked_amount_usd or 0.0) + amount_usd, 4
        )
        # Restore reputation slightly upon active re-staking if penalized earlier
        if worker.status != "banned":
            worker.is_available = True
            worker.reputation_score = min(
                100.0, float(worker.reputation_score or 100.0) + 5.0
            )

        db.commit()
        db.refresh(worker)

        try:
            from app.metrics_service import record_audit_log
            record_audit_log(
                db=db,
                event_type="COLLATERAL_DEPOSIT",
                action=f"Staked ${amount_usd:.2f} USD on worker {worker.id}",
                actor_id=owner_id,
                target_id=worker.id,
                severity="info",
                details={"amount_usd": amount_usd, "total_staked": worker.staked_amount_usd},
            )
        except Exception:
            pass

        return {
            "status": "staked",
            "worker_id": worker.id,
            "worker_name": worker.name,
            "staked_amount_usd": worker.staked_amount_usd,
            "min_stake_required": worker.min_stake_required or MIN_INFERENCE_STAKE_USD,
            "reputation_score": worker.reputation_score,
            "is_qualified": worker.staked_amount_usd >= (worker.min_stake_required or MIN_INFERENCE_STAKE_USD),
            "owner_id": owner_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def unstake_collateral(
        self,
        db: Session,
        worker_id: str,
        amount_usd: float,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Withdraw collateral from a worker node back to the host user's wallet.
        Disallows unstaking if the node is actively executing a task.
        """
        if amount_usd <= 0:
            raise ValueError("Unstaking amount must be greater than $0.00")

        worker = db.query(Worker).filter(Worker.id == worker_id).first()
        if not worker:
            raise ValueError(f"Worker node '{worker_id}' not found")

        if worker.current_task_id or worker.status in ("busy", "running"):
            raise ValueError(
                f"Cannot unstake collateral while node is actively processing task '{worker.current_task_id}'"
            )

        current_stake = float(worker.staked_amount_usd or 0.0)
        if amount_usd > current_stake:
            raise ValueError(
                f"Requested unstake amount (${amount_usd:.2f}) exceeds current staked collateral (${current_stake:.2f})"
            )

        worker.staked_amount_usd = round(current_stake - amount_usd, 4)

        owner_id = user_id or worker.user_id
        owner = db.query(User).filter(User.id == owner_id).first() if owner_id else None

        if owner:
            owner.balance = round(owner.balance + amount_usd, 4)
            unstake_tx = Transaction(
                transaction_id=str(uuid.uuid4()),
                user_id=owner.id,
                worker_id=worker.id,
                type=TransactionType.UNSTAKE,
                amount=amount_usd,
                balance_after=owner.balance,
                description=f"Collateral stake release for GPU node {worker.name} ({worker.id})",
            )
            db.add(unstake_tx)

        db.commit()
        db.refresh(worker)

        try:
            from app.metrics_service import record_audit_log
            record_audit_log(
                db=db,
                event_type="COLLATERAL_UNSTAKE",
                action=f"Unstaked ${amount_usd:.2f} USD from worker {worker.id}",
                actor_id=user_id or worker.user_id,
                target_id=worker.id,
                severity="info",
                details={"amount_usd": amount_usd, "remaining_stake": worker.staked_amount_usd},
            )
        except Exception:
            pass

        return {
            "status": "unstaked",
            "worker_id": worker.id,
            "released_amount_usd": amount_usd,
            "remaining_stake_usd": worker.staked_amount_usd,
            "min_stake_required": worker.min_stake_required or MIN_INFERENCE_STAKE_USD,
            "is_qualified": worker.staked_amount_usd >= (worker.min_stake_required or MIN_INFERENCE_STAKE_USD),
            "owner_balance": owner.balance if owner else None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def slash_worker(
        self,
        db: Session,
        worker_id: str,
        reason: str,
        penalty_pct: float,
        task_id: Optional[str] = None,
        victim_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Execute automated slashing penalty against a worker node:
        1. Slashes `penalty_pct` of the node's staked collateral
        2. Redistributes 80% of slashed funds to the affected enterprise customer (`victim_user_id`)
        3. Deducts reputation score
        4. Permanently bans the node if penalty_pct is 100% (Byzantine fraud)
        5. Records immutable audit history in `slash_history` and `transactions`
        """
        worker = db.query(Worker).filter(Worker.id == worker_id).first()
        if not worker:
            raise ValueError(f"Worker node '{worker_id}' not found")

        current_stake = float(worker.staked_amount_usd or 0.0)
        penalty_ratio = min(1.0, max(0.0, penalty_pct / 100.0))
        slashed_amount = round(current_stake * penalty_ratio, 4)

        # Update worker stake and slashed counters
        worker.staked_amount_usd = round(current_stake - slashed_amount, 4)
        worker.slashed_amount_usd = round(
            float(worker.slashed_amount_usd or 0.0) + slashed_amount, 4
        )

        # Reputation and penalty enforcement
        if penalty_pct >= 100.0 or "fraud" in reason.lower() or "poison" in reason.lower():
            worker.reputation_score = 0.0
            worker.status = "banned"
            worker.is_available = False
        else:
            rep_deduction = round(penalty_pct * 0.8, 2)
            worker.reputation_score = max(
                0.0, round(float(worker.reputation_score or 100.0) - rep_deduction, 2)
            )

        # Compensatory redistribution: 80% to enterprise customer
        compensation_credited = 0.0
        if victim_user_id and slashed_amount > 0:
            compensation_credited = round(
                slashed_amount * CUSTOMER_COMPENSATION_SHARE, 4
            )
            victim = db.query(User).filter(User.id == victim_user_id).first()
            if victim:
                victim.balance = round(victim.balance + compensation_credited, 4)
                comp_tx = Transaction(
                    transaction_id=str(uuid.uuid4()),
                    user_id=victim.id,
                    worker_id=worker.id,
                    task_id=task_id,
                    type=TransactionType.COMPENSATION,
                    amount=compensation_credited,
                    balance_after=victim.balance,
                    description=(
                        f"SLA Breach Compensation: 80% of slashed node {worker.id} "
                        f"({reason}) for job {task_id or 'N/A'}"
                    ),
                )
                db.add(comp_tx)

        # Record penalty transaction on node owner ledger
        if worker.user_id and slashed_amount > 0:
            owner = db.query(User).filter(User.id == worker.user_id).first()
            if owner:
                slash_tx = Transaction(
                    transaction_id=str(uuid.uuid4()),
                    user_id=owner.id,
                    worker_id=worker.id,
                    task_id=task_id,
                    type=TransactionType.SLASH_PENALTY,
                    amount=-slashed_amount,
                    balance_after=owner.balance,
                    description=f"Automated SLA Slashing Penalty: -{penalty_pct}% on node {worker.id} ({reason})",
                )
                db.add(slash_tx)

        # Append to slash_history JSON
        history: List[Dict[str, Any]] = []
        if worker.slash_history:
            try:
                history = json.loads(worker.slash_history)
            except Exception:
                history = []

        slash_event = {
            "slash_id": f"slash_{uuid.uuid4().hex[:8]}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
            "penalty_pct": penalty_pct,
            "slashed_amount_usd": slashed_amount,
            "remaining_stake_usd": worker.staked_amount_usd,
            "compensation_credited_usd": compensation_credited,
            "victim_user_id": victim_user_id,
            "task_id": task_id,
            "reputation_score_after": worker.reputation_score,
            "banned": worker.status == "banned",
        }
        history.append(slash_event)
        worker.slash_history = json.dumps(history)

        db.commit()
        db.refresh(worker)

        try:
            from app.metrics_service import record_audit_log
            record_audit_log(
                db=db,
                event_type="STAKING_SLASH",
                action=f"Slashed {penalty_pct}% (${slashed_amount:.2f} USD) on worker {worker.id}: {reason}",
                actor_id="system",
                target_id=worker.id,
                severity="critical" if penalty_pct >= 100.0 else "warning",
                details={
                    "penalty_pct": penalty_pct,
                    "slashed_amount_usd": slashed_amount,
                    "remaining_stake_usd": worker.staked_amount_usd,
                    "reason": reason,
                    "victim_user_id": victim_user_id,
                    "compensation_credited_usd": compensation_credited,
                },
            )
        except Exception:
            pass

        logger.warning(
            f"[SLASH] Node {worker.id} slashed ${slashed_amount:.4f} ({penalty_pct}%) | "
            f"Reason: {reason} | Compensated customer: ${compensation_credited:.4f}"
        )

        return {
            "slashed": True,
            "worker_id": worker.id,
            "task_id": task_id,
            "reason": reason,
            "penalty_pct": penalty_pct,
            "slashed_amount_usd": slashed_amount,
            "remaining_stake_usd": worker.staked_amount_usd,
            "compensation_credited_usd": compensation_credited,
            "reputation_score": worker.reputation_score,
            "banned": worker.status == "banned",
            "timestamp": slash_event["timestamp"],
        }

    def get_staking_status(self, db: Session, worker_id: str) -> Dict[str, Any]:
        """Fetch real-time collateral staking status and qualification score."""
        worker = db.query(Worker).filter(Worker.id == worker_id).first()
        if not worker:
            raise ValueError(f"Worker node '{worker_id}' not found")

        staked = float(worker.staked_amount_usd or 0.0)
        min_req = float(worker.min_stake_required or MIN_INFERENCE_STAKE_USD)
        rep = float(worker.reputation_score or 100.0)

        return {
            "worker_id": worker.id,
            "name": worker.name,
            "gpu_info": worker.gpu_info,
            "status": worker.status,
            "staked_amount_usd": staked,
            "slashed_amount_usd": float(worker.slashed_amount_usd or 0.0),
            "min_stake_required": min_req,
            "reputation_score": rep,
            "is_qualified_inference": staked >= MIN_INFERENCE_STAKE_USD and worker.status != "banned",
            "is_qualified_training": staked >= MIN_TRAINING_STAKE_USD and worker.status != "banned",
            "banned": worker.status == "banned",
            "owner_id": worker.user_id,
            "total_tasks_completed": worker.total_tasks_completed or 0,
        }

    def get_slashing_history(self, db: Session, worker_id: str) -> List[Dict[str, Any]]:
        """Retrieve historical slashing penalties for a worker node."""
        worker = db.query(Worker).filter(Worker.id == worker_id).first()
        if not worker:
            raise ValueError(f"Worker node '{worker_id}' not found")

        if not worker.slash_history:
            return []
        try:
            return json.loads(worker.slash_history)
        except Exception:
            return []

    def get_staking_leaderboard(self, db: Session, limit: int = 50) -> List[Dict[str, Any]]:
        """Return highest-staked and highest-reputation nodes in the fleet."""
        workers = (
            db.query(Worker)
            .order_by(Worker.staked_amount_usd.desc(), Worker.created_at.desc(), Worker.reputation_score.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "worker_id": w.id,
                "name": w.name,
                "gpu_info": w.gpu_info,
                "region": getattr(w, "region", "us-east") or "us-east",
                "staked_amount_usd": float(w.staked_amount_usd or 0.0),
                "slashed_amount_usd": float(w.slashed_amount_usd or 0.0),
                "reputation_score": float(w.reputation_score or 100.0),
                "status": w.status,
                "is_available": w.is_available,
                "tier": (
                    "High-Priority Enterprise Cluster"
                    if float(w.staked_amount_usd or 0.0) >= MIN_TRAINING_STAKE_USD
                    else "Standard Dedicated Worker"
                    if float(w.staked_amount_usd or 0.0) >= MIN_INFERENCE_STAKE_USD
                    else "Unstaked Node"
                ),
            }
            for w in workers
        ]


# Global singleton instance
staking_engine = StakingEngine.get_instance()
