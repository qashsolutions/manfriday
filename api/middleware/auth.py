"""Supabase JWT authentication middleware."""

from __future__ import annotations

import os
import logging
from typing import Any

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
ENV = os.getenv("ENV", "development")

# Fail-fast: in production, a missing JWT secret is a critical misconfiguration.
if ENV == "production" and not JWT_SECRET:
    logger.critical(
        "SUPABASE_JWT_SECRET is empty in production! "
        "All authenticated requests will be rejected."
    )

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict[str, Any]:
    """Validate Supabase JWT and return user claims.

    If HS256 verification fails, returns 401 — never falls through
    to an unverified decode.
    """
    token = credentials.credentials

    if not JWT_SECRET:
        logger.error("JWT_SECRET is not configured — rejecting request")
        raise HTTPException(status_code=401, detail="Authentication not configured")

    # Verify JWT with python-jose HS256
    try:
        from jose import jwt, JWTError

        # Try with audience
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience="authenticated")
            return _extract_user(payload)
        except JWTError:
            pass

        # Try without audience check
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], options={"verify_aud": False})
            return _extract_user(payload)
        except JWTError as e:
            logger.warning("HS256 decode failed: %s", e)
            raise HTTPException(status_code=401, detail="Invalid or expired token")
    except ImportError:
        logger.error("python-jose not available — cannot verify JWTs")
        raise HTTPException(status_code=401, detail="Authentication not configured")

    raise HTTPException(status_code=401, detail="Invalid or expired token")


def _extract_user(payload: dict[str, Any]) -> dict[str, Any]:
    """Extract user info from JWT payload."""
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token: no sub claim")
    return {
        "user_id": user_id,
        "email": payload.get("email", ""),
        "claims": payload,
    }
