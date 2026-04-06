"""Index writer — maintains wiki/index.md as a catalog of ALL wiki pages.

Uses LLM to generate 1-paragraph summaries for pages that lack them.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from shared.python.manfriday_core.gcs import read_text, exists, list_markdown_files, user_path
from shared.python.manfriday_core.llm import LLMConfig, call
from workers.compile.write_guard import guarded_write_text

SUMMARY_PROMPT = """Read this wiki page and write a single concise sentence (under 20 words) summarizing it.
Return ONLY the summary sentence, nothing else.

Page content:
{content}"""


async def rebuild_index(user_id: str, provider: str = "anthropic") -> str:
    """Rebuild wiki/index.md from all wiki pages.

    Scans wiki/entities/, wiki/concepts/, wiki/articles/, wiki/outputs/
    and builds the full index with LLM-generated summaries.
    """
    today = date.today().isoformat()

    # Collect pages by category
    entities = await _scan_pages(user_id, "entities", provider)
    concepts = await _scan_pages(user_id, "concepts", provider)
    articles = await _scan_pages(user_id, "articles", provider)
    outputs = await _scan_pages(user_id, "outputs", provider)

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


async def _scan_pages(
    user_id: str,
    category: str,
    provider: str = "anthropic",
) -> list[dict[str, str]]:
    """Scan a wiki category directory and extract page names + summaries.

    Uses LLM to generate summaries when title extraction falls back to slug name.
    """
    prefix = user_path(user_id, "wiki", category) + "/"
    files = list_markdown_files(prefix)

    pages = []
    for path in files:
        filename = path.split("/")[-1]
        name = filename.replace(".md", "")

        summary = ""
        content = ""
        try:
            content = read_text(path)
            # Try to extract title from frontmatter
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

        # If no good summary found, use LLM to generate one
        if (not summary or summary == name) and content:
            try:
                config = LLMConfig(
                    provider=provider,
                    temperature=0.1,
                    max_tokens=50,
                )
                response = await call(
                    messages=[{
                        "role": "user",
                        "content": SUMMARY_PROMPT.format(content=content[:2000]),
                    }],
                    config=config,
                    user_id=user_id,
                )
                summary = response.content.strip()
            except Exception:
                summary = name

        pages.append({"name": name, "summary": summary or name})

    return pages
