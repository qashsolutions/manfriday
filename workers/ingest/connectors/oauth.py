"""Shared OAuth 2.0 helper for Google connectors (Gmail, Drive).

Handles token storage, refresh, and revocation via Secret Manager.
Client credentials (client_id, client_secret) are read from environment
variables — never from stored user tokens.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from shared.python.manfriday_core.secrets import get_byok_key, store_byok_key, delete_byok_key

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")


def _secret_name(service: str, user_id: str) -> str:
    return f"{service}-token-{user_id}"


async def exchange_code(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict[str, Any]:
    """Exchange OAuth authorization code for tokens."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
        resp.raise_for_status()
        return resp.json()


async def refresh_token(
    refresh_tok: str,
    client_id: str,
    client_secret: str,
) -> dict[str, Any]:
    """Refresh an expired access token."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "refresh_token": refresh_tok,
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
        })
        resp.raise_for_status()
        return resp.json()


async def revoke_token(token: str) -> None:
    """Revoke an OAuth token."""
    async with httpx.AsyncClient() as client:
        await client.post(GOOGLE_REVOKE_URL, params={"token": token})


def store_tokens(service: str, user_id: str, tokens: dict[str, Any]) -> None:
    """Store OAuth tokens in Secret Manager."""
    import json
    store_byok_key(service, user_id, json.dumps(tokens))


def load_tokens(service: str, user_id: str) -> dict[str, Any] | None:
    """Load OAuth tokens from Secret Manager."""
    import json
    try:
        raw = get_byok_key(service, user_id)
        return json.loads(raw)
    except Exception:
        return None


def delete_tokens(service: str, user_id: str) -> None:
    """Delete stored OAuth tokens."""
    delete_byok_key(service, user_id)


async def get_valid_access_token(
    service: str,
    user_id: str,
) -> str | None:
    """Get a valid access token, refreshing if expired.

    Client credentials are read from env vars (GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET) — never from stored user tokens.
    """
    tokens = load_tokens(service, user_id)
    if not tokens:
        return None

    # Try refresh
    refresh_tok = tokens.get("refresh_token")
    if not refresh_tok:
        return tokens.get("access_token")

    try:
        new_tokens = await refresh_token(
            refresh_tok, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
        )
        new_tokens["refresh_token"] = refresh_tok  # preserve refresh token
        store_tokens(service, user_id, new_tokens)
        return new_tokens["access_token"]
    except Exception:
        return tokens.get("access_token")
