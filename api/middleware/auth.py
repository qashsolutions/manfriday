"""Supabase JWT authentication middleware."""

from __future__ import annotations

import os
from typing import Any

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import httpx
from jose import jwt, JWTError

SUPABASE_URL = os.getenv("SUPABASE_URL", "http://localhost:54321")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "dev-anon-key")
JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "super-secret-jwt-token-with-at-least-32-characters-long")

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict[str, Any]:
    """Validate Supabase JWT and return user claims."""
    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: no sub claim")
        return {"user_id": user_id, "email": payload.get("email", ""), "claims": payload}
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
