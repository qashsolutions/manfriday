"""Search router — BM25 search over wiki/."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from api.middleware.auth import get_current_user
from api.tools.registry import search_wiki

router = APIRouter()


@router.get("")
async def search(
    q: str = Query(..., description="Search query"),
    n: int = Query(5, description="Number of results"),
    user: dict = Depends(get_current_user),
):
    """BM25 search over wiki pages."""
    results = await search_wiki(q, user["user_id"], top_n=n)
    return {"query": q, "results": results}
