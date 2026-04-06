"""Article writer — LLM reads raw/{slug}.md and writes wiki/articles/{slug}.md.

Creates YAML frontmatter, uses [[wikilinks]], and cites raw/ source for every claim.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from shared.python.manfriday_core.gcs import read_text, exists, user_path
from shared.python.manfriday_core.llm import LLMConfig, call
from workers.compile.write_guard import guarded_write_text

ARTICLE_PROMPT = """You are a wiki article writer. Read the source below and write a wiki article.

Requirements:
- Start with YAML frontmatter (type: article, title, created, updated, sources, tags, source_count)
- Write a clear, structured summary of the source
- Use [[wikilinks]] when mentioning entities (people, orgs, projects) or concepts
- Cite the source slug for every major claim
- Be concise but comprehensive — capture all key information

Source slug: {slug}
Source content:
{content}

Write the wiki article now:"""


async def write_article(
    slug: str,
    user_id: str,
    provider: str = "anthropic",
    model: str | None = None,
) -> dict[str, Any]:
    """Read raw source and generate wiki article.

    Returns:
        Dict with article path and extracted entities/concepts
    """
    # Read raw source
    raw_path = user_path(user_id, "raw", f"{slug}.md")
    content = read_text(raw_path)

    config = LLMConfig(
        provider=provider,
        model=model,
        temperature=0.3,
        max_tokens=4096,
        system_prompt="You are a wiki article writer. Output only the wiki article in markdown.",
    )

    response = await call(
        messages=[{
            "role": "user",
            "content": ARTICLE_PROMPT.format(slug=slug, content=content[:8000]),
        }],
        config=config,
        user_id=user_id,
    )

    article_content = response.content

    # Ensure frontmatter exists — add if LLM didn't include it
    if not article_content.startswith("---"):
        today = date.today().isoformat()
        frontmatter = f"""---
type: article
title: "{slug}"
created: {today}
updated: {today}
sources: [{slug}]
tags: []
source_count: 1
---

"""
        article_content = frontmatter + article_content

    # Write to wiki/articles/
    article_path = user_path(user_id, "wiki", "articles", f"{slug}.md")
    guarded_write_text(user_id, article_path, article_content)

    return {
        "path": article_path,
        "slug": slug,
        "content": article_content,
    }
