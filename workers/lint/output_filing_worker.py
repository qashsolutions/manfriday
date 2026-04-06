"""Output filing worker -- appends to episodes.jsonl after every Q&A session.

Entry format:
    {date, query, topics_detected, articles_read, output_type, output_path, filed}

episodes.jsonl lives at {user_id}/wiki/memory/episodes.jsonl and is the
episodic memory layer that lets the system recall what was asked and answered.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import date

from shared.python.manfriday_core.gcs import read_text, exists, user_path
from workers.compile.write_guard import guarded_write_text


@dataclass
class Episode:
    date: str
    query: str
    topics_detected: list[str]
    articles_read: list[str]
    output_type: str           # "answer" | "filed_output" | "ingest_discussion"
    output_path: str | None    # path in wiki/outputs/ if filed, else None
    filed: bool

    def to_json_line(self) -> str:
        return json.dumps(asdict(self), default=str)

    @classmethod
    def from_json_line(cls, line: str) -> "Episode":
        data = json.loads(line)
        return cls(**data)


def read_episodes(user_id: str) -> list[Episode]:
    """Read all episodes from episodes.jsonl.

    Returns:
        List of Episode objects, oldest first.
    """
    path = user_path(user_id, "wiki", "memory", "episodes.jsonl")
    if not exists(path):
        return []

    content = read_text(path)
    episodes = []
    for line in content.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            episodes.append(Episode.from_json_line(line))
        except (json.JSONDecodeError, TypeError, KeyError):
            continue
    return episodes


def append_episode(user_id: str, episode: Episode) -> None:
    """Append a single episode to episodes.jsonl.

    This is an append operation -- existing entries are preserved.
    """
    path = user_path(user_id, "wiki", "memory", "episodes.jsonl")

    new_line = episode.to_json_line() + "\n"

    if exists(path):
        existing = read_text(path)
        # Ensure existing content ends with newline
        if existing and not existing.endswith("\n"):
            existing += "\n"
        content = existing + new_line
    else:
        content = new_line

    guarded_write_text(user_id, path, content)


def record_qa_session(
    user_id: str,
    query: str,
    topics_detected: list[str],
    articles_read: list[str],
    output_type: str = "answer",
    output_path: str | None = None,
    filed: bool = False,
) -> Episode:
    """Convenience function to record a Q&A session as an episode.

    Args:
        user_id: User ID.
        query: The user's question.
        topics_detected: Wiki topics/entities relevant to the query.
        articles_read: Article slugs consulted to answer.
        output_type: Type of output produced.
        output_path: GCS path if output was filed to wiki/outputs/.
        filed: Whether the answer was filed as a wiki page.

    Returns:
        The Episode that was recorded.
    """
    episode = Episode(
        date=date.today().isoformat(),
        query=query,
        topics_detected=topics_detected,
        articles_read=articles_read,
        output_type=output_type,
        output_path=output_path,
        filed=filed,
    )
    append_episode(user_id, episode)
    return episode


def get_recent_topics(user_id: str, n: int = 20) -> list[str]:
    """Get the most recently discussed topics across the last N episodes.

    Useful for contextualising new queries -- "what have we been talking about?"
    """
    episodes = read_episodes(user_id)
    recent = episodes[-n:] if len(episodes) > n else episodes

    # Flatten and count topics, preserving recency order
    seen: dict[str, int] = {}
    for ep in reversed(recent):
        for topic in ep.topics_detected:
            if topic not in seen:
                seen[topic] = 0
            seen[topic] += 1

    # Sort by frequency, break ties by recency (already ordered)
    return sorted(seen.keys(), key=lambda t: seen[t], reverse=True)


def get_session_history(user_id: str, n: int = 10) -> list[dict]:
    """Return last N sessions as dicts for display or LLM context."""
    episodes = read_episodes(user_id)
    recent = episodes[-n:] if len(episodes) > n else episodes
    return [asdict(ep) for ep in recent]
