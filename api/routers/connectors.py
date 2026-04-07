"""Connector routes — connect/disconnect/poll external services + OAuth flow."""

from __future__ import annotations

import json
import logging
import os
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from api.middleware.auth import get_current_user
from workers.ingest.connectors.base import ConnectorBase
from workers.ingest.connectors.gmail import GmailConnector
from workers.ingest.connectors.gdrive import GDriveConnector
from workers.ingest.connectors.telegram import TelegramConnector
from workers.ingest.connectors.whatsapp import WhatsAppConnector
from workers.ingest.connectors.arxiv import ArxivConnector
from workers.ingest.connectors.oauth import store_tokens

logger = logging.getLogger(__name__)

router = APIRouter()

GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

OAUTH_SCOPES = {
    "gmail": "https://www.googleapis.com/auth/gmail.readonly",
    "gdrive": "https://www.googleapis.com/auth/drive.readonly",
}

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


# ── OAuth flow ────────────────────────────────────────────


@router.get("/oauth/{connector_type}")
async def oauth_initiate(connector_type: str, request: Request, user_id: str = ""):
    """Step 1: Redirect user to Google OAuth consent screen."""
    if connector_type not in OAUTH_SCOPES:
        raise HTTPException(status_code=400, detail=f"OAuth not supported for: {connector_type}")
    if not GOOGLE_OAUTH_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")

    # Callback URL on our API
    callback_url = str(request.base_url).rstrip("/") + "/connectors/oauth/callback"

    # Encode connector_type + user_id in state
    state = json.dumps({"type": connector_type, "uid": user_id})

    params = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": callback_url,
        "response_type": "code",
        "scope": OAUTH_SCOPES[connector_type],
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }

    return RedirectResponse(url=f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/oauth/callback")
async def oauth_callback(
    code: str = "",
    state: str = "",
    error: str = "",
    request: Request = None,
):
    """Step 2: Google redirects here with auth code. Exchange for tokens."""
    if error:
        return HTMLResponse(f"<html><body><p>Authorization denied: {error}</p><script>setTimeout(()=>window.close(),2000)</script></body></html>")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")

    # Parse state
    try:
        state_data = json.loads(state)
        connector_type = state_data["type"]
        user_id = state_data.get("uid", "unknown")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    # Callback URL must match exactly what we sent to Google
    callback_url = str(request.base_url).rstrip("/") + "/connectors/oauth/callback"

    # Exchange code for tokens
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
            "redirect_uri": callback_url,
            "grant_type": "authorization_code",
        })

    if resp.status_code != 200:
        logger.error("Token exchange failed: %s %s", resp.status_code, resp.text)
        return HTMLResponse(f"<html><body><p>Token exchange failed. Please try again.</p><script>setTimeout(()=>window.close(),3000)</script></body></html>")

    tokens = resp.json()
    tokens["client_id"] = GOOGLE_OAUTH_CLIENT_ID
    tokens["client_secret"] = GOOGLE_OAUTH_CLIENT_SECRET

    # Store tokens for this user
    store_tokens(connector_type, user_id, tokens)
    logger.info("OAuth tokens stored for %s/%s", connector_type, user_id)

    # Close popup and notify parent window
    return HTMLResponse(f"""<html><body>
<p>Connected successfully! This window will close.</p>
<script>
window.opener && window.opener.postMessage({{type:'oauth_success',connector:'{connector_type}'}}, '*');
setTimeout(()=>window.close(), 1500);
</script>
</body></html>""")


# ── Standard connect/disconnect/poll ──────────────────────


@router.post("/connect")
async def connect_service(req: ConnectRequest, user: dict = Depends(get_current_user)):
    """Connect to an external service (non-OAuth connectors)."""
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
    from workers.ingest.connectors.oauth import load_tokens
    from shared.python.manfriday_core.secrets import key_exists

    accounts = []
    for name in CONNECTORS:
        connected = False
        try:
            if name in OAUTH_SCOPES:
                tokens = load_tokens(name, user["user_id"])
                connected = tokens is not None
            else:
                connected = key_exists(name, user["user_id"])
        except Exception:
            pass
        accounts.append({"connector_type": name, "connected": connected, "last_polled": None})

    return {"accounts": accounts}


@router.post("/poll/{connector_type}")
async def poll_connector(connector_type: str, user: dict = Depends(get_current_user)):
    """Manually trigger a poll for a connector."""
    if connector_type not in CONNECTORS:
        raise HTTPException(status_code=400, detail=f"Unknown connector: {connector_type}")

    connector = CONNECTORS[connector_type]()
    try:
        items = await connector.poll(user["user_id"])
        results = []
        for item in items:
            from workers.ingest.main import ingest
            result = await ingest(url=item.source_url, user_id=user["user_id"], source_type=item.source_type)
            results.append(result)
        return {"items_found": len(items), "ingested": len(results)}
    except NotImplementedError:
        raise HTTPException(status_code=501, detail=f"{connector_type} connector not yet available")
