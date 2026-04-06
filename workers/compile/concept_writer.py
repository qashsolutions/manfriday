"""Concept writer — extract concepts from source, create/update concept pages.

Same pattern as entity_writer but for wiki/concepts/.
Concept page: definition, related_concepts[], sources[], examples[]
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from shared.python.manfriday_core.gcs import read_text, exists, user_path
from shared.python.manfriday_core.llm import LLMConfig, call
from workers.compile.write_guard import guarded_write_text

EXTRACT_PROMPT = """Extract key concepts and technical terms from this text. Return JSON array:
[{{"name": "concept name", "definition": "one-sentence definition", "related": ["related concept 1", "related concept 2"]}}]

Only include substantive concepts worth a dedicated wiki page. Return ONLY valid JSON.

Text:
{content}"""

CONCEPT_PAGE_TEMPLATE = """---
type: concept
title: "{name}"
created: {today}
updated: {today}
sources: [{source_slug}]
tags: []
source_count: 1
---

# {name}

{definition}

## Related Concepts

{related_links}

## Sources

- [[{source_slug}]]
"""

UPDATE_PROMPT = """Update this wiki concept page with new information from the source below.
Preserve existing content, add new details and examples. Update 'updated' date, add new source, increment source_count.

Existing page:
{existing}

New source ({slug}):
{new_content}

Write the updated concept page:"""


async def extract_and_write_concepts(
    slug: str,
    source_content: str,
    user_id: str,
    provider: str = "anthropic",
    model: str | None = None,
) -> list[dict[str, Any]]:
    """Extract concepts from source and create/update concept pages.

    Returns:
        List of dicts with concept name, path, and whether created or updated
    """
    config = LLMConfig(
        provider=provider,
        model=model,
        temperature=0.1,
        max_tokens=2000,
    )

    response = await call(
        messages=[{
            "role": "user",
            "content": EXTRACT_PROMPT.format(content=source_content[:6000]),
        }],
        config=config,
        user_id=user_id,
    )

    try:
        concepts = json.loads(response.content)
    except json.JSONDecodeError:
        return []

    results = []
    today = date.today().isoformat()

    for concept in concepts:
        name = concept.get("name", "").strip()
        if not name:
            continue

        concept_slug = name.lower().replace(" ", "-").replace(".", "")
        concept_path = user_path(user_id, "wiki", "concepts", f"{concept_slug}.md")

        if exists(concept_path):
            existing_content = read_text(concept_path)
            update_response = await call(
                messages=[{
                    "role": "user",
                    "content": UPDATE_PROMPT.format(
                        existing=existing_content,
                        slug=slug,
                        new_content=source_content[:3000],
                    ),
                }],
                config=config,
                user_id=user_id,
            )
            guarded_write_text(user_id, concept_path, update_response.content)
            results.append({"name": name, "path": concept_path, "action": "updated"})
        else:
            related = concept.get("related", [])
            related_links = "\n".join(f"- [[{r}]]" for r in related) if related else "- *(none yet)*"

            page_content = CONCEPT_PAGE_TEMPLATE.format(
                name=name,
                today=today,
                source_slug=slug,
                definition=concept.get("definition", ""),
                related_links=related_links,
            )
            guarded_write_text(user_id, concept_path, page_content)
            results.append({"name": name, "path": concept_path, "action": "created"})

    return results
