"""Memory router — episodes log and topic aggregation."""

from __future__ import annotations

import json
from collections import Counter

from fastapi import APIRouter, Depends
from api.middleware.auth import get_current_user
from shared.python.manfriday_core.gcs import read_text, exists, user_path

router = APIRouter()


@router.get("/episodes")
async def get_episodes(
    limit: int = 20,
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    """Paginated episode log from episodes.jsonl."""
    path = user_path(user["user_id"], "wiki", "memory", "episodes.jsonl")
    if not exists(path):
        return {"episodes": [], "total": 0}

    content = read_text(path)
    lines = [l for l in content.strip().split("\n") if l.strip()]
    episodes = [json.loads(l) for l in lines]
    episodes.reverse()

    return {"episodes": episodes[offset : offset + limit], "total": len(episodes)}


@router.get("/topics")
async def get_topics(user: dict = Depends(get_current_user)):
    """Aggregated active topic summary from last 30 episodes."""
    path = user_path(user["user_id"], "wiki", "memory", "episodes.jsonl")
    if not exists(path):
        return {"topics": []}

    content = read_text(path)
    lines = [l for l in content.strip().split("\n") if l.strip()]
    episodes = [json.loads(l) for l in lines]

    # Take last 30
    recent = episodes[-30:]
    topic_counter: Counter = Counter()
    for ep in recent:
        for topic in ep.get("topics_detected", []):
            topic_counter[topic] += 1

    topics = [
        {"topic": t, "count": c, "last_active": _last_active(episodes, t)}
        for t, c in topic_counter.most_common(20)
    ]

    return {"topics": topics}


def _last_active(episodes: list, topic: str) -> str:
    for ep in reversed(episodes):
        if topic in ep.get("topics_detected", []):
            return ep.get("date", "")
    return ""
