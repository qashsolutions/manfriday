"""Playbook writer — detect patterns from episodes, update playbooks and active threads.

Implements Agent 4 (Memory Agent) requirements from skills_and_agents.md:
- Post-Q&A: recompute active_threads from last 30 episodes
- Post-compile: detect new patterns → update playbook
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date

from shared.python.manfriday_core.gcs import read_text, exists, user_path
from workers.compile.write_guard import guarded_write_text


def update_active_threads(user_id: str) -> list[dict]:
    """Recompute active_threads from last 30 episodes and update memory.md.

    Called after every Q&A session (Agent 4, post-Q&A step 2-3).
    """
    episodes_path = user_path(user_id, "wiki", "memory", "episodes.jsonl")
    if not exists(episodes_path):
        return []

    content = read_text(episodes_path)
    lines = [l for l in content.strip().split("\n") if l.strip()]
    episodes = [json.loads(l) for l in lines]

    # Take last 30
    recent = episodes[-30:]

    # Count topics
    topic_counter: Counter = Counter()
    topic_last_active: dict[str, str] = {}
    for ep in recent:
        for topic in ep.get("topics_detected", []):
            topic_counter[topic] += 1
            topic_last_active[topic] = ep.get("date", "")

    active_threads = [
        {
            "topic": topic,
            "sessions": count,
            "last_active": topic_last_active.get(topic, ""),
        }
        for topic, count in topic_counter.most_common(10)
    ]

    # Update memory.md with active threads
    memory_path = user_path(user_id, "memory.md")
    if exists(memory_path):
        memory_content = read_text(memory_path)
        memory_content = _update_active_threads_section(memory_content, active_threads)
        memory_content = _update_recent_episodes_section(memory_content, recent[-3:])
        guarded_write_text(user_id, memory_path, memory_content)

    return active_threads


def update_playbook(user_id: str) -> dict:
    """Analyze episode patterns and update playbook preferences.

    Called after every compile cycle (Agent 4, post-compile step 2).
    Detects: answer_format, detail_level, output_types, filing_preference.
    """
    episodes_path = user_path(user_id, "wiki", "memory", "episodes.jsonl")
    if not exists(episodes_path):
        return {}

    content = read_text(episodes_path)
    lines = [l for l in content.strip().split("\n") if l.strip()]
    episodes = [json.loads(l) for l in lines]

    if len(episodes) < 3:
        return {}  # Not enough data

    # Detect output type preference
    output_types = Counter(ep.get("output_type", "md") for ep in episodes)
    preferred_outputs = [t for t, _ in output_types.most_common(3)]

    # Detect filing preference
    filed_count = sum(1 for ep in episodes if ep.get("filed"))
    total = len(episodes)
    if filed_count / total > 0.8:
        filing_pref = "always"
    elif filed_count / total < 0.2:
        filing_pref = "never"
    else:
        filing_pref = "ask"

    # Detect detail level from query length patterns
    avg_query_len = sum(len(ep.get("query", "")) for ep in episodes) / total
    if avg_query_len > 100:
        detail_level = "deep"
    elif avg_query_len > 40:
        detail_level = "medium"
    else:
        detail_level = "shallow"

    playbook = {
        "output_types": preferred_outputs,
        "filing_preference": filing_pref,
        "detail_level": detail_level,
        "total_sessions_analyzed": total,
        "updated": date.today().isoformat(),
    }

    # Write playbook file
    playbook_path = user_path(user_id, "wiki", "memory", "playbooks", "preferences.md")
    playbook_md = f"""---
type: playbook
title: User Preferences
updated: {date.today().isoformat()}
sessions_analyzed: {total}
---

# User Preferences Playbook

Detected from {total} Q&A sessions.

## Output Preferences
- **Preferred formats**: {', '.join(preferred_outputs)}
- **Filing preference**: {filing_pref}

## Interaction Style
- **Detail level**: {detail_level}
- **Average query length**: {avg_query_len:.0f} chars
"""
    guarded_write_text(user_id, playbook_path, playbook_md)

    # Update memory.md playbook section
    memory_path = user_path(user_id, "memory.md")
    if exists(memory_path):
        memory_content = read_text(memory_path)
        memory_content = _update_playbook_section(memory_content, playbook)
        guarded_write_text(user_id, memory_path, memory_content)

    return playbook


def _update_active_threads_section(content: str, threads: list[dict]) -> str:
    """Update the active_threads yaml block in memory.md."""
    threads_yaml = "active_threads:\n"
    for t in threads:
        threads_yaml += f'  - topic: "{t["topic"]}"\n'
        threads_yaml += f'    sessions: {t["sessions"]}\n'
        threads_yaml += f'    last_active: {t["last_active"]}\n'

    # Replace existing block
    pattern = r"active_threads:.*?(?=\n```|\n---|\Z)"
    if re.search(pattern, content, re.DOTALL):
        return re.sub(pattern, threads_yaml.rstrip(), content, flags=re.DOTALL)
    return content


def _update_recent_episodes_section(content: str, episodes: list[dict]) -> str:
    """Update recent_episodes in memory.md."""
    eps_yaml = "recent_episodes:\n"
    for ep in reversed(episodes):
        eps_yaml += f'  - date: {ep.get("date", "")}\n'
        eps_yaml += f'    query: "{ep.get("query", "")[:80]}"\n'
        topics = ep.get("topics_detected", [])
        eps_yaml += f'    topics: {json.dumps(topics)}\n'

    pattern = r"recent_episodes:.*?(?=\n```|\n---|\Z)"
    if re.search(pattern, content, re.DOTALL):
        return re.sub(pattern, eps_yaml.rstrip(), content, flags=re.DOTALL)
    return content


def _update_playbook_section(content: str, playbook: dict) -> str:
    """Update playbook section in memory.md."""
    playbook_yaml = "playbook:\n"
    playbook_yaml += f'  detail_level: "{playbook.get("detail_level", "deep")}"\n'
    playbook_yaml += f'  output_types: {json.dumps(playbook.get("output_types", ["md"]))}\n'
    playbook_yaml += f'  filing_preference: "{playbook.get("filing_preference", "ask")}"\n'

    pattern = r"playbook:.*?(?=\n```|\n---|\Z)"
    if re.search(pattern, content, re.DOTALL):
        return re.sub(pattern, playbook_yaml.rstrip(), content, flags=re.DOTALL)
    return content
