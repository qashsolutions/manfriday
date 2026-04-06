"""Manifest manager — read/write raw/manifest.json.

manifest.json tracks all ingested sources:
  {slug, url, type, ingested_at, quality_score, suppressed, ...}
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from shared.python.manfriday_core.gcs import read_json, write_json, exists


def _manifest_path(user_id: str) -> str:
    return f"{user_id}/raw/manifest.json"


def read_manifest(user_id: str) -> list[dict[str, Any]]:
    """Read the full manifest. Returns empty list if not found."""
    path = _manifest_path(user_id)
    if not exists(path):
        return []
    return read_json(path)


def write_manifest(user_id: str, entries: list[dict[str, Any]]) -> None:
    """Write the full manifest."""
    write_json(_manifest_path(user_id), entries)


def append_manifest(user_id: str, entry: dict[str, Any]) -> None:
    """Append a single entry to the manifest."""
    entries = read_manifest(user_id)

    # Check for duplicate slug
    existing_slugs = {e["slug"] for e in entries}
    if entry["slug"] in existing_slugs:
        # Update existing entry
        entries = [e if e["slug"] != entry["slug"] else entry for e in entries]
    else:
        entries.append(entry)

    write_manifest(user_id, entries)


def create_manifest_entry(
    slug: str,
    url: str,
    source_type: str,
    metadata: dict[str, Any] | None = None,
    quality_score: float | None = None,
    suppressed: bool = False,
    suppression_reason: str | None = None,
) -> dict[str, Any]:
    """Create a manifest entry dict."""
    entry: dict[str, Any] = {
        "slug": slug,
        "url": url,
        "type": source_type,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        "quality_score": quality_score,
        "quality_suppressed": suppressed,
        "compiled": False,
    }
    if suppression_reason:
        entry["suppression_reason"] = suppression_reason
    if metadata:
        entry["metadata"] = metadata
    return entry


def get_uncompiled(user_id: str) -> list[dict[str, Any]]:
    """Get manifest entries that haven't been compiled yet."""
    entries = read_manifest(user_id)
    return [e for e in entries if not e.get("compiled") and not e.get("quality_suppressed")]


def mark_compiled(user_id: str, slug: str) -> None:
    """Mark a manifest entry as compiled."""
    entries = read_manifest(user_id)
    for entry in entries:
        if entry["slug"] == slug:
            entry["compiled"] = True
            entry["compiled_at"] = datetime.now(timezone.utc).isoformat()
            break
    write_manifest(user_id, entries)
