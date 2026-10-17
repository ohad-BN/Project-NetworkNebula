#!/usr/bin/env python3
"""
Project NetworkNebula — P2P Kademlia DHT REST Router
====================================================
Exposes REST endpoints for peer node discovery, 160-bit XOR routing table
introspection, decentralized provider announcement, and multi-hop DHT lookups.
Mounted under /api/v1/dht.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.kademlia_dht import Contact, dht_node, generate_node_id, hash_key, hex_to_int, int_to_hex

logger = logging.getLogger("dht_router")

router = APIRouter(prefix="/api/v1/dht", tags=["P2P Kademlia DHT Mesh"])


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class BootstrapRequest(BaseModel):
    endpoint: str = Field(default="http://127.0.0.1:8000", description="Bootstrap peer endpoint")
    node_id_hex: Optional[str] = Field(default=None, description="Optional 160-bit hex node ID")
    worker_id: Optional[str] = Field(default=None, description="Optional worker identifier")
    region: Optional[str] = Field(default="us-east", description="Geographic region")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Metadata dictionary")


class AnnounceProviderRequest(BaseModel):
    content_key: str = Field(description="Content key identifier, e.g. sharded_model:meta-llama/Llama-3-70B:stage:0")
    provider_id: str = Field(description="Worker node ID advertising this content")
    endpoint: Optional[str] = Field(default="http://127.0.0.1:8000", description="Worker contact endpoint")
    vram_gb: Optional[float] = Field(default=8.0, ge=1.0, le=96.0, description="Available GPU VRAM")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional provider metadata")


class LookupRequest(BaseModel):
    content_key: str = Field(description="Content key or target topic to lookup in DHT")
    alpha: Optional[int] = Field(default=3, ge=1, le=8, description="Concurrency factor for iterative lookup")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/node/info", summary="Get local Kademlia DHT node identity and status")
def get_dht_node_info() -> Dict[str, Any]:
    """Returns the local node's 160-bit ID, endpoint, and routing table overview."""
    return {
        "status": "success",
        "node_id": dht_node.node_id_hex,
        "node_id_int": dht_node.node_id,
        "endpoint": dht_node.endpoint,
        "routing_summary": dht_node.routing_table.get_summary(),
        "total_providers_stored": dht_node.provider_store.total_records,
    }


@router.get("/routing-table", summary="List discovered peers in Kademlia routing table")
def get_routing_table() -> Dict[str, Any]:
    """Returns all active peer contacts categorized by k-bucket distance."""
    contacts: List[Dict[str, Any]] = []
    for bucket in dht_node.routing_table.buckets:
        for c in bucket.get_contacts():
            contacts.append(c.to_dict())

    return {
        "status": "success",
        "total_contacts": len(contacts),
        "local_node_id": dht_node.node_id_hex,
        "contacts": contacts,
        "summary": dht_node.routing_table.get_summary(),
    }


@router.post("/bootstrap", summary="Add bootstrap peer to Kademlia routing table")
def add_bootstrap_peer(payload: BootstrapRequest) -> Dict[str, Any]:
    """Bootstraps the local DHT node by adding a known contact to the routing table."""
    try:
        if payload.node_id_hex:
            nid = hex_to_int(payload.node_id_hex)
        else:
            nid = generate_node_id()

        contact = Contact(
            node_id=nid,
            endpoint=payload.endpoint,
            worker_id=payload.worker_id,
            region=payload.region or "us-east",
            metadata=payload.metadata,
        )
        added = dht_node.routing_table.add_contact(contact)
        return {
            "status": "success",
            "added": added,
            "peer": contact.to_dict(),
            "total_contacts": dht_node.routing_table.total_contacts,
        }
    except Exception as e:
        logger.error(f"Error bootstrapping peer: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/providers/announce", summary="Announce hosted layer shard or MoE expert to DHT")
def announce_provider(payload: AnnounceProviderRequest) -> Dict[str, Any]:
    """
    Publishes a provider record associating a content key (layer shard or expert)
    with the volunteer worker node hosting it.
    """
    res = dht_node.handle_store_provider(
        content_key=payload.content_key,
        provider_id=payload.provider_id,
        endpoint=payload.endpoint or "http://127.0.0.1:8000",
        vram_gb=payload.vram_gb or 8.0,
        metadata=payload.metadata,
    )
    return res


@router.get("/providers/{content_key:path}", summary="Resolve providers for a content key")
def resolve_providers(content_key: str) -> Dict[str, Any]:
    """Retrieves all active decentralized providers for the requested model shard or expert."""
    res = dht_node.handle_find_providers(content_key)
    return res


@router.post("/lookup", summary="Execute multi-hop iterative DHT lookup")
def execute_iterative_lookup(payload: LookupRequest) -> Dict[str, Any]:
    """
    Executes iterative lookup traversing peer nodes in O(log N) hops
    towards the target 160-bit content hash.
    """
    res = dht_node.iterative_lookup(content_key=payload.content_key, alpha=payload.alpha or 3)
    return {
        "status": "success",
        "lookup": res,
    }


@router.get("/stats", summary="Get DHT telemetry and efficiency metrics")
def get_dht_stats() -> Dict[str, Any]:
    """Returns complete DHT mesh metrics, RPC counts, and routing table statistics."""
    return {
        "status": "success",
        "stats": dht_node.get_stats(),
    }
