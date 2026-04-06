"""Schema writer — update memory.md after each compile cycle.

Updates wiki_state counts (total pages, entities, concepts, etc.)
and last_compile timestamp.
"""

from __future__ import annotations

from datetime import datetime, timezone

from shared.python.manfriday_core.gcs import read_text, exists, list_markdown_files, user_path
from workers.compile.write_guard import guarded_write_text


def update_memory(user_id: str) -> dict[str, int]:
    """Update memory.md with current wiki state counts.

    Returns:
        Dict of current wiki stats
    """
    wiki_prefix = user_path(user_id, "wiki")

    # Count pages by category
    entities = len(list_markdown_files(user_path(user_id, "wiki", "entities") + "/"))
    concepts = len(list_markdown_files(user_path(user_id, "wiki", "concepts") + "/"))
    articles = len(list_markdown_files(user_path(user_id, "wiki", "articles") + "/"))
    outputs = len(list_markdown_files(user_path(user_id, "wiki", "outputs") + "/"))
    total = entities + concepts + articles + outputs

    # Count raw items
    raw_files = list_markdown_files(user_path(user_id, "raw") + "/")
    # Exclude manifest and subdirectories
    raw_count = len([f for f in raw_files if "/" not in f.split("raw/", 1)[-1].rstrip(".md")])

    stats = {
        "total_wiki_pages": total,
        "total_entities": entities,
        "total_concepts": concepts,
        "total_articles": articles,
        "total_outputs_filed": outputs,
        "total_raw_items": raw_count,
    }

    # Read existing memory.md and update the wiki state section
    memory_path = user_path(user_id, "memory.md")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    if exists(memory_path):
        content = read_text(memory_path)
        # Update the yaml block with new counts
        content = _update_yaml_field(content, "last_compile", now)
        content = _update_yaml_field(content, "total_wiki_pages", str(total))
        content = _update_yaml_field(content, "total_entities", str(entities))
        content = _update_yaml_field(content, "total_concepts", str(concepts))
        content = _update_yaml_field(content, "total_articles", str(articles))
        content = _update_yaml_field(content, "total_outputs_filed", str(outputs))
        content = _update_yaml_field(content, "total_raw_items", str(raw_count))
    else:
        content = f"# Memory\n\nlast_compile: {now}\ntotal_wiki_pages: {total}\n"

    guarded_write_text(user_id, memory_path, content)
    return stats


def _update_yaml_field(content: str, field: str, value: str) -> str:
    """Update a YAML-like field in content, or append if not found."""
    import re

    pattern = rf"({field}:\s*)(.+)"
    if re.search(pattern, content):
        return re.sub(pattern, rf"\g<1>{value}", content)
    return content
