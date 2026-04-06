"""Index writer — maintains wiki/index.md as a catalog of ALL wiki pages."""

from __future__ import annotations

from datetime import date
from typing import Any

from shared.python.manfriday_core.gcs import read_text, exists, list_markdown_files, user_path
from workers.compile.write_guard import guarded_write_text


def rebuild_index(user_id: str) -> str:
    """Rebuild wiki/index.md from all wiki pages.

    Scans wiki/entities/, wiki/concepts/, wiki/articles/, wiki/outputs/
    and builds the full index.
    """
    today = date.today().isoformat()
    wiki_prefix = user_path(user_id, "wiki")

    # Collect pages by category
    entities = _scan_pages(user_id, "entities")
    concepts = _scan_pages(user_id, "concepts")
    articles = _scan_pages(user_id, "articles")
    outputs = _scan_pages(user_id, "outputs")

    total = len(entities) + len(concepts) + len(articles) + len(outputs)

    lines = [
        "# Wiki Index",
        f"Last updated: {today} | Pages: {total} | Sources: {len(articles)}",
        "",
        "## Entities",
    ]
    for e in entities:
        lines.append(f"- [[{e['name']}]] — {e['summary']}")

    lines.extend(["", "## Concepts"])
    for c in concepts:
        lines.append(f"- [[{c['name']}]] — {c['summary']}")

    lines.extend(["", "## Articles (source summaries)"])
    for a in articles:
        lines.append(f"- [[{a['name']}]] — {a['summary']}")

    lines.extend(["", "## Outputs (filed Q&A results)"])
    for o in outputs:
        lines.append(f"- [[{o['name']}]] — {o['summary']}")

    content = "\n".join(lines) + "\n"

    index_path = user_path(user_id, "wiki", "index.md")
    guarded_write_text(user_id, index_path, content)
    return content


def _scan_pages(user_id: str, category: str) -> list[dict[str, str]]:
    """Scan a wiki category directory and extract page names + summaries."""
    prefix = user_path(user_id, "wiki", category) + "/"
    files = list_markdown_files(prefix)

    pages = []
    for path in files:
        filename = path.split("/")[-1]
        name = filename.replace(".md", "")

        # Try to extract title from frontmatter or first heading
        summary = ""
        try:
            content = read_text(path)
            for line in content.split("\n"):
                line = line.strip()
                if line.startswith("title:"):
                    summary = line.split(":", 1)[1].strip().strip('"').strip("'")
                    break
                if line.startswith("# ") and not summary:
                    summary = line[2:].strip()
                    break
        except Exception:
            pass

        pages.append({"name": name, "summary": summary or name})

    return pages
