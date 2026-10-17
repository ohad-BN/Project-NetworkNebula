"""
Project NetworkNebula - Commercial Billing, Stripe Checkout & Web3 Micro-Escrow Router (Phase 6.4)
==================================================================================================
REST endpoints for enterprise credit card deposits via Stripe Checkout, webhook verification,
Web3 USDC micro-escrow deposits with EIP-712 signature verification & anti-replay protection,
and automated host worker compute earnings disbursement with cryptographically signed receipts.
"""

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import verify_enterprise_auth
from app.database import get_db
from app.models import PayoutRequest, Transaction, User, Worker
from app.payment_rails import (
    MIN_WITHDRAWAL_THRESHOLD_USD,
    NETWORK_FEES,
    STRIPE_WEBHOOK_SECRET,
    SUPPORTED_CHAINS,
    create_stripe_checkout_session,
    generate_stripe_webhook_signature,
    get_usdc_deposit_addresses,
    get_worker_payout_receipt,
    process_stripe_webhook,
    process_worker_payout_disbursement,
    verify_crypto_deposit,
    verify_payout_receipt_authenticity,
    verify_stripe_webhook_signature,
)

router = APIRouter(prefix="/api/v1/billing", tags=["Commercial Billing & Escrow Rails"])


# ==============================================================================
# Pydantic Schemas
# ==============================================================================

class CreateStripeSessionRequest(BaseModel):
    amount_usd: float = Field(..., gt=0.0, description="Deposit amount in USD")
    customer_email: Optional[str] = Field(None, description="Enterprise billing contact email")
    user_id: Optional[str] = Field(None, description="Enterprise user/organization identifier")
    success_url: Optional[str] = Field(None, description="Redirect URL upon successful payment")
    cancel_url: Optional[str] = Field(None, description="Redirect URL upon checkout cancellation")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Custom metadata tags")


class VerifyCryptoDepositRequest(BaseModel):
    chain: str = Field(..., description="Target chain: base, ethereum, arbitrum, solana")
    tx_hash: str = Field(..., description="On-chain transaction hash or transfer signature")
    amount_usdc: float = Field(..., gt=0.0, description="Amount in USDC to deposit")
    sender_address: str = Field(..., description="Sender wallet address")
    recipient_address: str = Field(..., description="Recipient deposit address")
    signature: str = Field(..., description="Cryptographic EIP-712 signature (0x...)")
    nonce: int = Field(..., ge=0, description="Unique replay-protection nonce")
    user_id: Optional[str] = Field(None, description="Target enterprise user ID")


class ProcessWorkerPayoutRequest(BaseModel):
    worker_id: str = Field(..., description="GPU Worker node ID requesting payout")
    amount_usd: float = Field(..., description="Withdrawal amount in USD (min $10.00)")
    payout_method: str = Field("usdc_base", description="Payout method: usdc_base, usdc_solana, stripe_connect")
    destination_address: str = Field(..., description="Destination wallet or banking payout target")


# ==============================================================================
# Stripe Checkout & Webhook Endpoints
# ==============================================================================

@router.post("/stripe/create-checkout-session")
def create_checkout_session(
    payload: CreateStripeSessionRequest,
    user: Optional[User] = Depends(verify_enterprise_auth),
):
    """
    Creates a pre-configured Stripe Checkout session for enterprise compute balance deposit.
    Returns session metadata, payment intent ID, and checkout redirect URL.
    """
    resolved_user_id = payload.user_id or (user.id if user else "usr-enterprise")
    resolved_email = payload.customer_email or (user.email if user else None)

    try:
        session_data = create_stripe_checkout_session(
            amount_usd=payload.amount_usd,
            customer_email=resolved_email,
            user_id=resolved_user_id,
            success_url=payload.success_url,
            cancel_url=payload.cancel_url,
            metadata=payload.metadata,
        )
        return {
            "status": "success",
            "session": session_data,
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/stripe/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(None, alias="stripe-signature"),
    db: Session = Depends(get_db),
):
    """
    Authoritative Stripe Webhook endpoint. Cryptographically verifies HMAC-SHA256 signature
    header against replay attacks, credits user balance upon payment completion, and records
    double-entry ledger transactions with full idempotency.
    """
    raw_body = await request.body()

    if not stripe_signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required 'stripe-signature' header",
        )

    # Cryptographic signature validation
    is_valid = verify_stripe_webhook_signature(
        payload_bytes=raw_body,
        sig_header=stripe_signature,
        secret=STRIPE_WEBHOOK_SECRET,
        tolerance_seconds=300,
    )
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired Stripe webhook HMAC signature",
        )

    try:
        event_dict = json.loads(raw_body.decode("utf-8"))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Malformed JSON in Stripe webhook payload: {str(e)}",
        )

    result = process_stripe_webhook(event_payload=event_dict, db=db)
    return result


# ==============================================================================
# Web3 USDC Micro-Escrow Endpoints
# ==============================================================================

@router.get("/crypto/deposit-address")
def get_crypto_deposit_address(
    user_id: Optional[str] = Query(None, description="Optional user ID"),
    user: Optional[User] = Depends(verify_enterprise_auth),
):
    """
    Generates deterministic, isolated USDC deposit addresses across Base L2,
    Ethereum Mainnet, Arbitrum, and Solana for micro-escrow top-ups.
    """
    target_id = user_id or (user.id if user else "usr-default")
    return get_usdc_deposit_addresses(user_id=target_id)


@router.post("/crypto/verify-deposit")
def verify_usdc_deposit(
    payload: VerifyCryptoDepositRequest,
    user: Optional[User] = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    Verifies on-chain USDC deposit with EIP-712 cryptographic proofs, anti-replay
    nonce protection, and instant balance ledger credit.
    """
    target_user_id = payload.user_id or (user.id if user else None)
    return verify_crypto_deposit(
        chain=payload.chain,
        tx_hash=payload.tx_hash,
        amount_usdc=payload.amount_usdc,
        sender_address=payload.sender_address,
        recipient_address=payload.recipient_address,
        signature=payload.signature,
        nonce=payload.nonce,
        user_id=target_user_id,
        db=db,
    )


# ==============================================================================
# Host Worker Compute Earnings Disbursement Endpoints
# ==============================================================================

@router.post("/payouts/process")
def process_worker_payout(
    payload: ProcessWorkerPayoutRequest,
    db: Session = Depends(get_db),
):
    """
    Automated host worker compute earnings disbursement engine.
    Deducts earnings, enforces $10.00 minimum threshold, and issues
    a cryptographically signed HMAC settlement receipt.
    """
    return process_worker_payout_disbursement(
        worker_id=payload.worker_id,
        amount_usd=payload.amount_usd,
        payout_method=payload.payout_method,
        destination_address=payload.destination_address,
        db=db,
    )


@router.get("/payouts/{worker_id}")
def list_worker_payouts(
    worker_id: str,
    db: Session = Depends(get_db),
):
    """List historical payout disbursements and settlement status for a GPU worker."""
    payouts = (
        db.query(PayoutRequest)
        .filter(PayoutRequest.worker_id == worker_id)
        .order_by(PayoutRequest.created_at.desc())
        .all()
    )
    return {
        "worker_id": worker_id,
        "total_payouts": len(payouts),
        "history": [
            {
                "payout_id": p.payout_id,
                "amount": p.amount,
                "status": p.status.value if hasattr(p.status, "value") else str(p.status),
                "payment_method": p.payment_method,
                "payment_address": p.payment_address,
                "processed_at": p.processed_at,
            }
            for p in payouts
        ],
    }


@router.get("/receipts/disbursement/{receipt_id}")
def get_disbursement_receipt(receipt_id: str):
    """Retrieve and cryptographically verify a worker disbursement settlement receipt."""
    receipt = get_worker_payout_receipt(receipt_id)
    if not receipt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Disbursement receipt '{receipt_id}' not found",
        )

    is_authentic = verify_payout_receipt_authenticity(receipt)
    return {
        "receipt": receipt,
        "is_signature_authentic": is_authentic,
    }


@router.get("/ledger/{user_id}")
def get_user_financial_ledger(
    user_id: str,
    db: Session = Depends(get_db),
):
    """Retrieve double-entry financial ledger transactions for audits and reconciliation."""
    transactions = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id)
        .order_by(Transaction.created_at.desc())
        .limit(100)
        .all()
    )
    user = db.query(User).filter(User.id == user_id).first()

    return {
        "user_id": user_id,
        "current_balance_usd": user.balance if user else 0.0,
        "total_transactions": len(transactions),
        "transactions": [
            {
                "transaction_id": t.transaction_id,
                "type": t.type.value if hasattr(t.type, "value") else str(t.type),
                "amount": t.amount,
                "balance_after": t.balance_after,
                "description": t.description,
                "created_at": t.created_at,
            }
            for t in transactions
        ],
    }


@router.get("/stats")
def get_billing_system_stats():
    """Retrieve system billing configuration, supported chains, and settlement rails."""
    return {
        "status": "operational",
        "supported_fiat_rails": ["Stripe Credit Cards", "ACH Debit"],
        "supported_crypto_rails": ["USDC (Base L2)", "USDC (Ethereum)", "USDC (Arbitrum)", "USDC (Solana)"],
        "supported_chains": SUPPORTED_CHAINS,
        "min_payout_threshold_usd": MIN_WITHDRAWAL_THRESHOLD_USD,
        "network_fees_usd": NETWORK_FEES,
        "settlement_frequency": "Instant automated execution",
    }
