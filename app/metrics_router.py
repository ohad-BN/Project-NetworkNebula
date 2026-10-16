#!/usr/bin/env python3
"""
Project NetworkNebula — Prometheus Metrics & Immutable Audit Log REST Router
=============================================================================
Exposes:
  - GET  /metrics                   (Standard Prometheus text/plain format)
  - GET  /api/v1/metrics/summary   (JSON real-time telemetry & latency quantiles)
  - GET  /api/v1/audit/logs        (Query immutable enterprise audit trail)
  - POST /api/v1/audit/logs        (Record security, staking, or governance event)
"""

import json
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuditLog
from app.metrics_service import metrics_service, record_audit_log

router = APIRouter(tags=["Enterprise Telemetry & Observability"])


class CreateAuditLogPayload(BaseModel):
    event_type: str = Field(..., description="Category of event (e.g. STAKING_SLASH, TOKEN_REVOKE, SECURITY_EVENT)")
    action: str = Field(..., description="Action performed")
    severity: str = Field(default="info", description="Severity level: info, warning, critical")
    actor_id: Optional[str] = Field(default=None, description="Initiating user ID or admin")
    target_id: Optional[str] = Field(default=None, description="Impacted entity ID (worker_id, token_id, job_id)")
    details: Optional[Dict[str, Any]] = Field(default=None, description="Contextual payload metadata")


def serialize_audit_log(entry: AuditLog) -> Dict[str, Any]:
    """Serialize AuditLog ORM row to dictionary."""
    try:
        details_obj = json.loads(entry.details) if entry.details else {}
    except Exception:
        details_obj = {}

    return {
        "id": entry.id,
        "log_id": entry.log_id,
        "event_type": entry.event_type,
        "severity": entry.severity,
        "actor_id": entry.actor_id,
        "target_id": entry.target_id,
        "action": entry.action,
        "details": details_obj,
        "ip_address": entry.ip_address,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


# ==============================================================================
# Prometheus Scraping Endpoint
# ==============================================================================

@router.get("/metrics", response_class=Response)
def get_prometheus_metrics(db: Session = Depends(get_db)):
    """
    Standard Prometheus metrics exposition format endpoint (version 0.0.4).
    Scraped periodically by Prometheus or OpenTelemetry collector.
    """
    metrics_text = metrics_service.generate_prometheus_metrics(db)
    return Response(
        content=metrics_text,
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


@router.get("/api/v1/metrics/summary")
def get_metrics_summary(db: Session = Depends(get_db)):
    """
    Return high-level cluster telemetry summary, latency quantiles (p50/p95/p99),
    token generation rates, and 99.9% SLA uptime tracking for web dashboards.
    """
    return metrics_service.get_metrics_summary(db)


# ==============================================================================
# Immutable Audit Trail Endpoints
# ==============================================================================

@router.get("/api/v1/audit/logs")
def list_audit_logs(
    event_type: Optional[str] = Query(default=None, description="Filter by event category"),
    severity: Optional[str] = Query(default=None, description="Filter by severity (info, warning, critical)"),
    actor_id: Optional[str] = Query(default=None, description="Filter by initiating actor"),
    target_id: Optional[str] = Query(default=None, description="Filter by target ID"),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Query immutable enterprise audit logs with optional filtering by event type,
    severity, actor, or target resource.
    """
    query = db.query(AuditLog)

    if event_type:
        query = query.filter(AuditLog.event_type == event_type.upper())
    if severity:
        query = query.filter(AuditLog.severity == severity.lower())
    if actor_id:
        query = query.filter(AuditLog.actor_id == actor_id)
    if target_id:
        query = query.filter(AuditLog.target_id == target_id)

    total_count = query.count()
    records = query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit).all()

    return {
        "status": "ok",
        "total_count": total_count,
        "returned_count": len(records),
        "limit": limit,
        "logs": [serialize_audit_log(r) for r in records],
    }


@router.post("/api/v1/audit/logs", status_code=status.HTTP_201_CREATED)
def create_audit_log_entry(
    payload: CreateAuditLogPayload,
    db: Session = Depends(get_db),
):
    """
    Explicitly write an immutable enterprise audit log entry for compliance tracking.
    """
    entry = record_audit_log(
        db=db,
        event_type=payload.event_type,
        action=payload.action,
        severity=payload.severity,
        actor_id=payload.actor_id,
        target_id=payload.target_id,
        details=payload.details,
    )
    return {
        "status": "recorded",
        "log": serialize_audit_log(entry),
    }
