"""
Project NetworkNebula — Private Model Registry & Worker Public Key Router (Milestone 3)
Provides scoped CRUD operations for private models and serves worker ephemeral X25519 public keys.
"""

import json
import uuid
from typing import Any, Dict, List, Optional, Union
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import verify_enterprise_auth
from app.database import get_db
from app.models import PrivateModel, User, Worker

router = APIRouter(tags=["Private Model Registry"])


class PrivateModelCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    source_type: str = Field(..., max_length=32, description="hf_public | hf_private | byos_s3 | adapter")
    source_uri: str = Field(..., min_length=1, max_length=512)
    base_model_ref: Optional[str] = Field(None, max_length=255)
    param_count_b: Optional[float] = Field(None, ge=0.0)
    artifact_format: str = Field("hf_repo", max_length=32)
    encryption_alg: str = Field("none", max_length=32)
    artifact_sha256: Optional[str] = Field(None, max_length=64)
    metadata_json: Optional[Union[str, Dict[str, Any]]] = "{}"


def _serialize_private_model(m: PrivateModel) -> Dict[str, Any]:
    meta = m.metadata_json or "{}"
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            pass
    return {
        "id": m.id,
        "user_id": m.user_id,
        "name": m.name,
        "source_type": m.source_type,
        "source_uri": m.source_uri,
        "base_model_ref": m.base_model_ref,
        "param_count_b": m.param_count_b,
        "artifact_format": m.artifact_format,
        "encryption_alg": m.encryption_alg,
        "artifact_sha256": m.artifact_sha256,
        "metadata": meta,
        "is_active": bool(m.is_active),
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


@router.post("/api/v1/models/private", status_code=status.HTTP_201_CREATED)
def register_private_model(
    payload: PrivateModelCreate,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    Register a private model or BYOS weight reference scoped strictly to current_user.
    """
    meta_str = payload.metadata_json
    if isinstance(meta_str, dict):
        meta_str = json.dumps(meta_str)
    elif not isinstance(meta_str, str):
        meta_str = "{}"

    model_id = f"pm-{uuid.uuid4().hex[:12]}"
    record = PrivateModel(
        id=model_id,
        user_id=current_user.id,
        name=payload.name.strip(),
        source_type=payload.source_type.strip(),
        source_uri=payload.source_uri.strip(),
        base_model_ref=payload.base_model_ref.strip() if payload.base_model_ref else None,
        param_count_b=payload.param_count_b,
        artifact_format=payload.artifact_format.strip() if payload.artifact_format else "hf_repo",
        encryption_alg=payload.encryption_alg.strip() if payload.encryption_alg else "none",
        artifact_sha256=payload.artifact_sha256.strip() if payload.artifact_sha256 else None,
        metadata_json=meta_str,
        is_active=True,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _serialize_private_model(record)


@router.get("/api/v1/models/private")
def list_private_models(
    source_type: Optional[str] = Query(None, description="Optional filter by source_type"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    List private models owned strictly by current_user.
    """
    query = (
        db.query(PrivateModel)
        .filter(PrivateModel.user_id == current_user.id, PrivateModel.is_active == True)
        .order_by(PrivateModel.created_at.desc())
    )
    if source_type:
        query = query.filter(PrivateModel.source_type == source_type.strip())

    models = query.offset(offset).limit(limit).all()
    return [_serialize_private_model(m) for m in models]


@router.delete("/api/v1/models/private/{model_id}")
def delete_private_model(
    model_id: str,
    current_user: User = Depends(verify_enterprise_auth),
    db: Session = Depends(get_db),
):
    """
    Deactivate / soft-delete a private model owned by current_user.
    """
    record = (
        db.query(PrivateModel)
        .filter(
            PrivateModel.id == model_id,
            PrivateModel.user_id == current_user.id,
            PrivateModel.is_active == True,
        )
        .first()
    )
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Private model '{model_id}' not found",
        )

    record.is_active = False
    db.commit()
    return {"status": "deleted", "id": model_id}


@router.get("/api/v1/workers/{worker_id}/pubkey")
@router.get("/api/workers/{worker_id}/pubkey")
def get_worker_public_key(
    worker_id: str,
    db: Session = Depends(get_db),
):
    """
    Return the worker's ephemeral X25519 public key and capability flags.
    """
    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Worker '{worker_id}' not found",
        )

    gpu_cnt = worker.gpu_count or 1
    coll_vram = float(worker.collective_vram_gb or worker.gpu_memory_gb or 0.0)
    largest_gpu = float(worker.largest_single_gpu_gb or worker.gpu_memory_gb or 0.0)

    return {
        "worker_id": worker.id,
        "tunnel_pubkey_x25519": worker.tunnel_pubkey_x25519,
        "supports_sealed_env": bool(worker.supports_sealed_env),
        "supports_zero_disk_shm": bool(worker.supports_zero_disk_shm),
        "tee_attestation_type": worker.tee_attestation_type or "none",
        "gpu_count": gpu_cnt,
        "collective_vram_gb": coll_vram,
        "largest_single_gpu_gb": largest_gpu,
    }
