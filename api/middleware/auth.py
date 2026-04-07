"""Supabase JWT authentication middleware."""

from __future__ import annotations

import os
from typing import Any

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import httpx
from jose import jwt, JWTError

SUPABASE_URL = os.getenv("SUPABASE_URL", os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""))
JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "super-secret-jwt-token-with-at-least-32-characters-long")

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict[str, Any]:
    """Validate Supabase JWT and return user claims."""
    token = credentials.credentials

    # Try HS256 with JWT secret (works with legacy Supabase keys)
    for audience in ["authenticated", None]:
        try:
            options = {"verify_aud": audience is not None}
            payload = jwt.decode(
                token,
                JWT_SECRET,
                algorithms=["HS256"],
                audience=audience,
                options=options,
            )
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid token: no sub claim")
            return {"user_id": user_id, "email": payload.get("email", ""), "claims": payload}
        except JWTError:
            continue

    # Fallback: verify token via Supabase API (works with new ECC keys)
    if SUPABASE_URL:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{SUPABASE_URL}/auth/v1/user",
                    headers={"Authorization": f"Bearer {token}", "apikey": os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")},
                )
                if resp.status_code == 200:
                    user_data = resp.json()
                    return {
                        "user_id": user_data.get("id", ""),
                        "email": user_data.get("email", ""),
                        "claims": user_data,
                    }
        except Exception:
            pass

    raise HTTPException(status_code=401, detail="Invalid or expired token")
