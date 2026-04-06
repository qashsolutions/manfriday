"""Q&A router — POST /qa streams via SSE, GET /qa/history returns episodes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sse_starlette.sse import EventSourceResponse

from api.middleware.auth import get_current_user
from api.models.requests import QARequest
from api.tools.registry import run_qa_agent
from shared.python.manfriday_core.gcs import read_text, exists, user_path

router = APIRouter()


@router.post("")
async def qa_stream(req: QARequest, user: dict = Depends(get_current_user)):
    """Stream Q&A response via SSE with tool-use loop."""

    async def event_generator():
        async for event in run_qa_agent(
            question=req.question,
            user_id=user["user_id"],
            output_type=req.output_type,
        ):
            yield {"event": event["type"], "data": event["data"]}

    return EventSourceResponse(event_generator())


@router.get("/history")
async def qa_history(
    limit: int = 20,
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    """Get recent Q&A history from episodes.jsonl."""
    import json

    episodes_path = user_path(user["user_id"], "wiki", "memory", "episodes.jsonl")
    if not exists(episodes_path):
        return {"episodes": [], "total": 0}

    content = read_text(episodes_path)
    lines = [l for l in content.strip().split("\n") if l.strip()]
    episodes = [json.loads(l) for l in lines]

    # Reverse for newest first
    episodes.reverse()
    total = len(episodes)
    page = episodes[offset : offset + limit]

    return {"episodes": page, "total": total}
