"""Schema router — read/update CLAUDE.md."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from api.middleware.auth import get_current_user
from api.models.requests import SchemaUpdateRequest
from shared.python.manfriday_core.gcs import read_text, write_text, exists, user_path

router = APIRouter()


@router.get("")
async def get_schema(user: dict = Depends(get_current_user)):
    """Read the user's CLAUDE.md."""
    path = user_path(user["user_id"], "CLAUDE.md")
    if not exists(path):
        raise HTTPException(status_code=404, detail="CLAUDE.md not found")
    content = read_text(path)
    return {"content": content}


@router.put("")
async def update_schema(req: SchemaUpdateRequest, user: dict = Depends(get_current_user)):
    """Update the user's CLAUDE.md."""
    path = user_path(user["user_id"], "CLAUDE.md")
    write_text(path, req.content, "text/markdown")
    return {"updated": True}
