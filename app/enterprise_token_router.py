"""
Project NetworkNebula — Enterprise API Token Management Router
Provides secure scoped Bearer token provisioning, listing, and revocation
for enterprise clients accessing the OpenAI Gateway and Training Engine.
"""

import uuid
import secrets
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiToken, User
from app.auth import verify_enterprise_auth, hash_token

router = APIRouter(prefix="/api/v1/tokens", tags=["Enterprise API Tokens"])


# ==============================================================================
# Schemas
# ==============================================================================

class CreateTokenRequest(BaseModel):
    name: str = Field(default="Default API Key", description="Descriptive identifier for the token")
    scopes: str = Field(default="training,inference", description="Comma-separated permission scopes")
    rate_limit_rpm: Optional[int] = Field(default=120, ge=1, le=10000, description="Rate limit requests per minute")


class TokenCreatedResponse(BaseModel):
    id: str
    name: str
    token: str = Field(..., description="Full secret token — shown only once upon creation")
    token_prefix: str
    scopes: str
    rate_limit_rpm: int
    is_active: bool
    created_at: datetime


class TokenListItem(BaseModel):
    id: str
    name: str
    token_prefix: str
    scopes: str
    rate_limit_rpm: int
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime] = None


# ==============================================================================
# Endpoints
# ==============================================================================

@router.post("", response_model=TokenCreatedResponse, status_code=status.HTTP_201_CREATED)
def create_api_token(
    payload: CreateTokenRequest,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    Generate a new scoped enterprise Bearer token (e.g. nebula_sk_...).
    The raw token is returned once in the response and securely hashed via SHA-256 for storage.
    """
    token_id = str(uuid.uuid4())
    raw_secret = secrets.token_urlsafe(32)
    raw_token = f"nebula_sk_{raw_secret}"
    token_prefix = raw_token[:13] + "..."
    token_digest = hash_token(raw_token)

    new_token = ApiToken(
        id=token_id,
        user_id=current_user.id,
        name=payload.name,
        token_hash=token_digest,
        token_prefix=token_prefix,
        scopes=payload.scopes,
        rate_limit_rpm=payload.rate_limit_rpm or 120,
        is_active=True,
    )
    db.add(new_token)
    db.commit()
    db.refresh(new_token)

    try:
        from app.metrics_service import record_audit_log
        record_audit_log(
            db=db,
            event_type="TOKEN_CREATED",
            severity="info",
            action=f"Provisioned API token '{payload.name}'",
            actor_id=str(current_user.id),
            target_id=new_token.id,
            details={"token_prefix": token_prefix, "scopes": payload.scopes, "rate_limit_rpm": new_token.rate_limit_rpm},
        )
    except Exception:
        pass

    return TokenCreatedResponse(
        id=new_token.id,
        name=new_token.name,
        token=raw_token,
        token_prefix=new_token.token_prefix,
        scopes=new_token.scopes,
        rate_limit_rpm=new_token.rate_limit_rpm,
        is_active=new_token.is_active,
        created_at=new_token.created_at,
    )


@router.get("", response_model=List[TokenListItem])
def list_api_tokens(
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """List all scoped API tokens registered under the authenticated enterprise tenant."""
    tokens = (
        db.query(ApiToken)
        .filter(ApiToken.user_id == current_user.id)
        .order_by(ApiToken.created_at.desc())
        .all()
    )
    return [
        TokenListItem(
            id=t.id,
            name=t.name,
            token_prefix=t.token_prefix,
            scopes=t.scopes,
            rate_limit_rpm=t.rate_limit_rpm,
            is_active=t.is_active,
            created_at=t.created_at,
            last_used_at=t.last_used_at,
        )
        for t in tokens
    ]


@router.delete("/{token_id}")
def revoke_api_token(
    token_id: str,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    Revoke an API token immediately. Any ongoing or future requests using this token
    will be rejected with 401 Unauthorized.
    """
    token = (
        db.query(ApiToken)
        .filter(ApiToken.id == token_id, ApiToken.user_id == current_user.id)
        .first()
    )
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    token.is_active = False
    db.commit()

    try:
        from app.metrics_service import record_audit_log
        record_audit_log(
            db=db,
            event_type="TOKEN_REVOKED",
            severity="warning",
            action=f"Revoked API token '{token.name}'",
            actor_id=str(current_user.id),
            target_id=token.id,
            details={"token_prefix": token.token_prefix, "name": token.name},
        )
    except Exception:
        pass

    return {"status": "revoked", "token_id": token_id}
