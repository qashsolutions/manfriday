"""Connector routes — connect/disconnect/poll external services + OAuth flow.

Uses same-window redirect (not popup) with PKCE + short-lived state tokens.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import time
from base64 import urlsafe_b64encode
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
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://manfriday.app")
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

# In-memory store for PKCE verifiers + state tokens (short-lived, 5 min)
_oauth_states: dict[str, dict[str, Any]] = {}
_STATE_TTL = 300  # 5 minutes


def _cleanup_expired_states() -> None:
    cutoff = time.time() - _STATE_TTL
    expired = [k for k, v in _oauth_states.items() if v["created"] < cutoff]
    for k in expired:
        del _oauth_states[k]


def _generate_pkce() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge."""
    verifier = secrets.token_urlsafe(64)
    challenge = urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


class ConnectRequest(BaseModel):
    connector_type: str
    credentials: dict[str, Any] = {}


class DisconnectRequest(BaseModel):
    connector_type: str


# ── OAuth flow (same-window redirect + PKCE) ─────────────


@router.get("/oauth/callback")
async def oauth_callback(
    code: str = "",
    state: str = "",
    error: str = "",
):
    """Step 2: Google redirects here. Exchange code for tokens using PKCE verifier."""
    if error:
        return RedirectResponse(f"{FRONTEND_URL}/settings?error={error}")

    if not code or not state:
        return RedirectResponse(f"{FRONTEND_URL}/settings?error=missing_params")

    # Validate state token
    _cleanup_expired_states()
    state_data = _oauth_states.pop(state, None)

    if not state_data:
        return RedirectResponse(f"{FRONTEND_URL}/settings?error=invalid_or_expired_state")

    connector_type = state_data["type"]
    user_id = state_data["uid"]
    code_verifier = state_data["verifier"]

    callback_url = f"{FRONTEND_URL}/api/connectors/oauth/callback"

    # Exchange code for tokens with PKCE verifier
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
            "redirect_uri": callback_url,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        })

    if resp.status_code != 200:
        logger.error("Token exchange failed: %s %s", resp.status_code, resp.text)
        return RedirectResponse(f"{FRONTEND_URL}/settings?error=token_exchange_failed")

    tokens = resp.json()
    tokens["client_id"] = GOOGLE_OAUTH_CLIENT_ID
    tokens["client_secret"] = GOOGLE_OAUTH_CLIENT_SECRET

    # Store tokens
    store_tokens(connector_type, user_id, tokens)
    logger.info("OAuth tokens stored for %s/%s", connector_type, user_id)

    # Redirect back to Connected Accounts page with success
    return RedirectResponse(f"{FRONTEND_URL}/settings?connected={connector_type}")


@router.get("/oauth/{connector_type}")
async def oauth_initiate(connector_type: str, user_id: str = ""):
    """Step 1: Redirect to Google consent screen with PKCE challenge."""
    if connector_type not in OAUTH_SCOPES:
        raise HTTPException(status_code=400, detail=f"OAuth not supported for: {connector_type}")
    if not GOOGLE_OAUTH_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")

    # Generate PKCE pair
    code_verifier, code_challenge = _generate_pkce()

    # Generate unique state token
    state_token = secrets.token_urlsafe(32)

    # Store state + PKCE verifier (5 min TTL)
    _cleanup_expired_states()
    _oauth_states[state_token] = {
        "type": connector_type,
        "uid": user_id,
        "verifier": code_verifier,
        "created": time.time(),
    }

    callback_url = f"{FRONTEND_URL}/api/connectors/oauth/callback"

    params = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": callback_url,
        "response_type": "code",
        "scope": OAUTH_SCOPES[connector_type],
        "access_type": "offline",
        "prompt": "consent",
        "state": state_token,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }

    return RedirectResponse(url=f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


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
