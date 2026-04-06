"""Lint queue processor — read wiki/lint_queue.md, generate pending articles."""

from __future__ import annotations

import re
from typing import Any

from shared.python.manfriday_core.gcs import read_text, exists, user_path
from workers.compile.write_guard import guarded_write_text


def read_lint_queue(user_id: str) -> list[dict[str, str]]:
    """Read pending article candidates from lint_queue.md.

    Returns:
        List of dicts with topic, rationale, status
    """
    path = user_path(user_id, "wiki", "lint_queue.md")
    if not exists(path):
        return []

    content = read_text(path)
    items = []

    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("- [ ] "):
            # Pending item: - [ ] **topic** — rationale
            match = re.match(r"- \[ \] \*\*(.+?)\*\* — (.+)", line)
            if match:
                items.append({
                    "topic": match.group(1),
                    "rationale": match.group(2),
                    "status": "pending",
                })

    return items


def write_lint_queue(user_id: str, items: list[dict[str, str]]) -> None:
    """Write article candidates to lint_queue.md."""
    lines = [
        "# Lint Queue",
        "",
        "Article candidates suggested by lint agent. Processed by compile worker.",
        "",
    ]

    for item in items:
        status = item.get("status", "pending")
        checkbox = "[ ]" if status == "pending" else "[x]"
        lines.append(f"- {checkbox} **{item['topic']}** — {item.get('rationale', '')}")

    content = "\n".join(lines) + "\n"
    path = user_path(user_id, "wiki", "lint_queue.md")
    guarded_write_text(user_id, path, content)
