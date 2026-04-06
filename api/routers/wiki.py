"""Wiki router — read wiki pages."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from api.middleware.auth import get_current_user
from shared.python.manfriday_core.gcs import read_text, exists, user_path

router = APIRouter()


@router.get("/{path:path}")
async def read_wiki_page(path: str, user: dict = Depends(get_current_user)):
    """Read a wiki page by path."""
    full_path = user_path(user["user_id"], "wiki", path)

    if not full_path.endswith(".md"):
        full_path += ".md"

    if not exists(full_path):
        raise HTTPException(status_code=404, detail=f"Wiki page not found: {path}")

    content = read_text(full_path)
    return {"path": path, "content": content}
