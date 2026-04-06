"""Deterministic quality pre-filter — runs BEFORE LLM scorer to save tokens.

Each source type has specific rules for suppression.
Suppressed items are never deleted, just flagged in manifest.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class PreFilterResult:
    suppressed: bool
    reason: str | None = None


def pre_filter(source_type: str, content_md: str, metadata: dict[str, Any]) -> PreFilterResult:
    """Apply deterministic pre-filter rules based on source type.

    Returns:
        PreFilterResult with suppressed=True if item should be skipped.
    """
    word_count = len(content_md.split())

    if source_type == "url":
        if word_count < 300:
            return PreFilterResult(suppressed=True, reason=f"URL content too short ({word_count} words, min 300)")

    elif source_type == "rss":
        if word_count < 200:
            return PreFilterResult(suppressed=True, reason=f"RSS item too short ({word_count} words, min 200)")
        # Check age — if published date > 30 days old
        published = metadata.get("published", "")
        if published and _is_older_than_days(published, 30):
            return PreFilterResult(suppressed=True, reason="RSS item older than 30 days")

    elif source_type == "gmail":
        # Suppress if List-Unsubscribe header present and no star/label
        has_unsubscribe = metadata.get("has_list_unsubscribe", False)
        has_star = metadata.get("starred", False)
        has_label = bool(metadata.get("user_labels", []))
        if has_unsubscribe and not has_star and not has_label:
            return PreFilterResult(suppressed=True, reason="Bulk email (List-Unsubscribe, no star/label)")

    elif source_type == "telegram":
        if word_count < 20 and not metadata.get("urls"):
            return PreFilterResult(suppressed=True, reason=f"Telegram message too short ({word_count} words, no URL)")

    elif source_type == "pdf":
        if word_count < 50:
            return PreFilterResult(suppressed=True, reason=f"PDF too short ({word_count} words)")

    return PreFilterResult(suppressed=False)


def _is_older_than_days(date_str: str, days: int) -> bool:
    """Check if a date string is older than N days."""
    from datetime import datetime, timedelta, timezone

    try:
        # Try common date formats
        for fmt in ["%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d"]:
            try:
                dt = datetime.strptime(date_str, fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt < datetime.now(timezone.utc) - timedelta(days=days)
            except ValueError:
                continue
    except Exception:
        pass
    return False
