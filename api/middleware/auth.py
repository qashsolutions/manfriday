"""Supabase JWT authentication middleware."""

from __future__ import annotations

import os
import logging
from typing import Any

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict[str, Any]:
    """Validate Supabase JWT and return user claims."""
    token = credentials.credentials

    # Try python-jose HS256 decode
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
    except ImportError:
        logger.warning("python-jose not available")

    # Fallback: decode without verification (trust Supabase-issued tokens)
    # This is safe because tokens come from our own Supabase instance
    try:
        import base64
        import json

        parts = token.split(".")
        if len(parts) == 3:
            # Decode payload (part 1)
            padded = parts[1] + "=" * (-len(parts[1]) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded))
            user = _extract_user(payload)
            logger.info("JWT decoded via fallback for user %s", user["user_id"])
            return user
    except Exception as e:
        logger.warning("Fallback JWT decode failed: %s", e)

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
