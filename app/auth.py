import secrets
from typing import Optional
from fastapi import Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User

pwd_context = CryptContext(schemes=["sha256_crypt"], deprecated="auto")

API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)
API_SECRET_HEADER = APIKeyHeader(name="X-API-Secret", auto_error=False)


def generate_api_key() -> str:
    """Generate a random API key"""
    return secrets.token_urlsafe(32)


def hash_password(password: str) -> str:
    """Hash a password using sha256_crypt"""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def create_api_key_pair():
    """Generate a new API key pair (key, secret)"""
    api_key = generate_api_key()
    api_secret = secrets.token_urlsafe(32)
    return api_key, api_secret


def get_user_by_api_key(db: Session, api_key: str) -> Optional[User]:
    """Get user by API key"""
    return db.query(User).filter(User.api_key == api_key).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """Get user by email"""
    return db.query(User).filter(User.email == email).first()


def verify_api_auth(
    api_key: Optional[str] = Security(API_KEY_HEADER),
    api_secret: Optional[str] = Security(API_SECRET_HEADER),
    db: Session = Depends(get_db),
) -> User:
    """Verify API key and secret, return user"""
    if not api_key or not api_secret:
        raise HTTPException(status_code=401, detail="Missing API credentials")

    user = get_user_by_api_key(db, api_key)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is disabled")

    if user.api_secret != api_secret:
        raise HTTPException(status_code=401, detail="Invalid API secret")

    return user
