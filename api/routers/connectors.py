"""Connector routes — connect/disconnect/poll external services."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth import get_current_user
from workers.ingest.connectors.base import ConnectorBase
from workers.ingest.connectors.gmail import GmailConnector
from workers.ingest.connectors.gdrive import GDriveConnector
from workers.ingest.connectors.telegram import TelegramConnector
from workers.ingest.connectors.whatsapp import WhatsAppConnector
from workers.ingest.connectors.arxiv import ArxivConnector

router = APIRouter()

CONNECTORS: dict[str, type[ConnectorBase]] = {
    "gmail": GmailConnector,
    "gdrive": GDriveConnector,
    "telegram": TelegramConnector,
    "whatsapp": WhatsAppConnector,
    "arxiv": ArxivConnector,
}


class ConnectRequest(BaseModel):
    connector_type: str
    credentials: dict[str, Any] = {}


class DisconnectRequest(BaseModel):
    connector_type: str


@router.post("/connect")
async def connect_service(req: ConnectRequest, user: dict = Depends(get_current_user)):
    """Initiate connection to an external service."""
    if req.connector_type not in CONNECTORS:
        raise HTTPException(status_code=400, detail=f"Unknown connector: {req.connector_type}")

    connector = CONNECTORS[req.connector_type]()
    try:
        success = await connector.connect(user["user_id"], req.credentials)
        return {"connected": success, "connector": req.connector_type}
    except NotImplementedError:
        raise HTTPException(status_code=501, detail=f"{req.connector_type} connector not yet available")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/disconnect")
async def disconnect_service(req: DisconnectRequest, user: dict = Depends(get_current_user)):
    """Disconnect from an external service."""
    if req.connector_type not in CONNECTORS:
        raise HTTPException(status_code=400, detail=f"Unknown connector: {req.connector_type}")

    connector = CONNECTORS[req.connector_type]()
    try:
        await connector.disconnect(user["user_id"])
        return {"disconnected": True, "connector": req.connector_type}
    except NotImplementedError:
        raise HTTPException(status_code=501, detail=f"{req.connector_type} connector not yet available")


@router.get("/connected-accounts")
async def list_connected_accounts(user: dict = Depends(get_current_user)):
    """List all connected accounts with status."""
    from shared.python.manfriday_core.gcs import read_text, exists, user_path
    import json

    accounts = []
    for name in CONNECTORS:
        status = {"connector": name, "connected": False, "last_polled": None}
        try:
            from workers.ingest.connectors.oauth import load_tokens
            tokens = load_tokens(name, user["user_id"])
            if tokens:
                status["connected"] = True
        except Exception:
            pass
        accounts.append(status)

    return {"accounts": accounts}


@router.post("/poll/{connector_type}")
async def poll_connector(connector_type: str, user: dict = Depends(get_current_user)):
    """Manually trigger a poll for a connector."""
    if connector_type not in CONNECTORS:
        raise HTTPException(status_code=400, detail=f"Unknown connector: {connector_type}")

    connector = CONNECTORS[connector_type]()
    try:
        items = await connector.poll(user["user_id"])
        # Enqueue each item for ingest
        results = []
        for item in items:
            from workers.ingest.main import ingest
            result = await ingest(
                url=item.source_url,
                user_id=user["user_id"],
                source_type=item.source_type,
            )
            results.append(result)
        return {"items_found": len(items), "ingested": len(results)}
    except NotImplementedError:
        raise HTTPException(status_code=501, detail=f"{connector_type} connector not yet available")
