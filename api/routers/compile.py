"""Compile router — internal trigger for compile worker."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from api.middleware.auth import get_current_user
from workers.compile.main import compile_user

router = APIRouter()


@router.post("")
async def trigger_compile(user: dict = Depends(get_current_user)):
    """Trigger compile for current user."""
    result = await compile_user(user["user_id"])
    return result
