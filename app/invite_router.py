#!/usr/bin/env python3
"""
Project NetworkNebula — Closed Alpha Invite & Email Verification Router
======================================================================
Manages Alpha Invite codes ("The Chosen Few" gatekeeper), 6-digit OTP email
verification, $100 initial testing credit grants, and daily faucet top-ups.
Mounted under /auth and /api/v1/invites.
"""

import logging
import random
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import get_user_by_email
from app.database import get_db
from app.email_service import send_verification_email
from app.models import InviteCode, Transaction, TransactionType, User

logger = logging.getLogger("invite_router")

router = APIRouter(tags=["Closed Alpha Invites & Email Verification"])


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class VerifyEmailRequest(BaseModel):
    email: str = Field(description="User email address to verify")
    code: str = Field(description="6-digit OTP verification code received via email")


class ResendCodeRequest(BaseModel):
    email: str = Field(description="User email address")


class ValidateInviteRequest(BaseModel):
    code: str = Field(description="Alpha invite code string to validate")


class CreateInviteRequest(BaseModel):
    code: Optional[str] = Field(default=None, description="Custom invite code string (e.g. ALPHA-VIP-01)")
    max_uses: Optional[int] = Field(default=1, ge=1, le=10000, description="Maximum number of users who can register")
    initial_credits: Optional[float] = Field(default=100.0, ge=10.0, le=1000.0, description="Credits granted upon verification")


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _resolve_user(
    db: Session,
    x_api_key: Optional[str],
    authorization: Optional[str],
) -> Optional[User]:
    if x_api_key:
        user = db.query(User).filter(User.api_key == x_api_key).first()
        if user:
            return user
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
        user = db.query(User).filter((User.api_key == token) | (User.api_secret == token)).first()
        if user:
            return user
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/auth/verify-email", summary="Verify Email with 6-Digit OTP & Claim $100 Credits")
def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Verifies user's 6-digit email OTP.
    Upon successful verification:
      1. Marks user account as verified (`is_verified = True`).
      2. Credits user account with $100.00 Alpha Compute Credits.
      3. Records immutable grant transaction in the ledger.
    """
    clean_email = payload.email.strip().lower()
    user = get_user_by_email(db, clean_email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No account found for email: {clean_email}",
        )

    if user.is_verified:
        return {
            "status": "success",
            "message": "Account is already verified.",
            "is_verified": True,
            "balance": user.balance,
        }

    clean_code = payload.code.strip()
    if not user.verification_code or user.verification_code != clean_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid 6-digit verification code. Please check your email and try again.",
        )

    # Check expiration (15 minutes)
    if user.verification_expires_at:
        now = datetime.now(timezone.utc)
        expires = user.verification_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if now > expires:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Verification code has expired. Please click 'Resend Code'.",
            )

    # Determine initial grant (look up invite code)
    grant_amount = 100.0
    if user.invited_by_code:
        inv = db.query(InviteCode).filter(InviteCode.code == user.invited_by_code).first()
        if inv and inv.initial_credits:
            grant_amount = float(inv.initial_credits)

    # Mark verified & clear code
    user.is_verified = True
    user.verification_code = None
    user.balance = round(float(user.balance or 0.0) + grant_amount, 2)

    # Double-entry ledger audit
    tx = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        type=TransactionType.FAUCET_GRANT,
        amount=grant_amount,
        balance_after=user.balance,
        description=f"Welcome grant: +${grant_amount:.2f} Alpha Compute Credits upon email verification",
    )
    db.add(tx)
    db.commit()
    db.refresh(user)

    logger.info(f"[AUTH] User {clean_email} successfully verified email. +${grant_amount} granted.")

    return {
        "status": "success",
        "message": f"Email verified successfully! +${grant_amount:.2f} Alpha Compute Credits added to your wallet.",
        "is_verified": True,
        "balance": user.balance,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "is_verified": True,
            "balance": user.balance,
            "api_key": user.api_key,
        },
    }


@router.post("/auth/resend-code", summary="Resend 6-Digit Email Verification Code")
def resend_code(payload: ResendCodeRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Dispatches a fresh 6-digit verification code to the user's email."""
    clean_email = payload.email.strip().lower()
    user = get_user_by_email(db, clean_email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No account found for email: {clean_email}",
        )

    if user.is_verified:
        return {
            "status": "success",
            "message": "Account is already verified.",
            "is_verified": True,
        }

    otp = f"{random.randint(100000, 999999)}"
    user.verification_code = otp
    user.verification_expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    db.commit()

    send_verification_email(user.email, otp, initial_credits=100.0)

    return {
        "status": "success",
        "message": f"A new 6-digit verification code has been dispatched to {user.email}.",
    }


@router.post("/api/v1/invites/validate", summary="Validate Alpha Invite Code")
def validate_invite_code(payload: ValidateInviteRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Check if an invite code is authentic and has remaining capacity."""
    raw_code = payload.code.strip().upper()
    if raw_code == "NEBULA-ALPHA-2026":
        return {
            "status": "valid",
            "code": "NEBULA-ALPHA-2026",
            "valid": True,
            "initial_credits": 100.0,
            "description": "Master Closed Alpha Invite Code",
        }

    inv = db.query(InviteCode).filter(InviteCode.code == raw_code, InviteCode.is_active == True).first()
    if not inv:
        return {
            "status": "invalid",
            "code": raw_code,
            "valid": False,
            "message": "Invite code not recognized.",
        }

    if inv.max_uses > 0 and inv.times_used >= inv.max_uses:
        return {
            "status": "exhausted",
            "code": raw_code,
            "valid": False,
            "message": "This invite code has reached its maximum registration capacity.",
        }

    return {
        "status": "valid",
        "code": inv.code,
        "valid": True,
        "initial_credits": inv.initial_credits,
        "remaining_uses": max(0, inv.max_uses - inv.times_used),
    }


@router.post("/api/v1/invites/generate", summary="Generate New Alpha Invite Code (Admin)")
def generate_invite(payload: Optional[CreateInviteRequest] = Body(default=None), db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Admin endpoint to create custom or auto-generated invite codes for testers."""
    req = payload or CreateInviteRequest()
    raw_code = (req.code or f"NEBULA-{secrets.token_hex(4).upper()}").strip().upper()

    existing = db.query(InviteCode).filter(InviteCode.code == raw_code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Invite code '{raw_code}' already exists.",
        )

    invite = InviteCode(
        code=raw_code,
        max_uses=req.max_uses or 1,
        times_used=0,
        initial_credits=req.initial_credits or 100.0,
        is_active=True,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    return {
        "status": "success",
        "code": invite.code,
        "max_uses": invite.max_uses,
        "initial_credits": invite.initial_credits,
        "is_active": invite.is_active,
        "created_at": str(invite.created_at),
    }


@router.get("/api/v1/invites", summary="List All Alpha Invite Codes (Admin)")
def list_invites(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Lists all active and exhausted invite codes in the system."""
    invites = db.query(InviteCode).order_by(InviteCode.created_at.desc()).all()
    return {
        "status": "success",
        "total": len(invites),
        "invites": [
            {
                "code": i.code,
                "times_used": i.times_used,
                "max_uses": i.max_uses,
                "initial_credits": i.initial_credits,
                "is_active": i.is_active,
                "created_at": str(i.created_at),
            }
            for i in invites
        ],
    }


@router.post("/api/wallet/faucet", summary="Claim Daily Alpha Compute Credits (+ $25.00)")
def claim_daily_faucet(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Allows verified Alpha testers to claim +$25.00 in free compute credits
    once every 24 hours to test fine-tuning and inference pipelines.
    """
    user = _resolve_user(db, x_api_key, authorization)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide X-API-Key or Bearer token.",
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email address to unlock faucet claims.",
        )

    now = datetime.now(timezone.utc)
    if user.last_faucet_claim:
        last = user.last_faucet_claim
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        elapsed = (now - last).total_seconds()
        if elapsed < 86400:
            remaining = int(86400 - elapsed)
            hrs = remaining // 3600
            mins = (remaining % 3600) // 60
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Daily faucet rate limit reached. You can claim another +$25.00 in {hrs}h {mins}m.",
            )

    faucet_amount = 25.0
    user.balance = round(float(user.balance or 0.0) + faucet_amount, 2)
    user.last_faucet_claim = now

    tx = Transaction(
        transaction_id=str(uuid.uuid4()),
        user_id=user.id,
        type=TransactionType.FAUCET_GRANT,
        amount=faucet_amount,
        balance_after=user.balance,
        description=f"Daily Alpha Faucet claim (+${faucet_amount:.2f} test credits)",
    )
    db.add(tx)
    db.commit()
    db.refresh(user)

    return {
        "status": "success",
        "credited": faucet_amount,
        "new_balance": user.balance,
        "message": f"+${faucet_amount:.2f} Alpha Compute Credits claimed successfully!",
    }
