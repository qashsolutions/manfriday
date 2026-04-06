"""Entity writer — extract entities from source, create/update entity pages.

For each entity (person, org, project, event) mentioned in a source:
- If wiki/entities/{entity}.md exists: UPDATE it with new info
- Else: CREATE wiki/entities/{entity}.md
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from shared.python.manfriday_core.gcs import read_text, exists, user_path
from shared.python.manfriday_core.llm import LLMConfig, call
from workers.compile.write_guard import guarded_write_text

EXTRACT_PROMPT = """Extract all named entities from this text. Return JSON array:
[{{"name": "entity name", "type": "person|org|project|event", "description": "one sentence"}}]

Only include clearly identifiable entities. Return ONLY valid JSON, no other text.

Text:
{content}"""

ENTITY_PAGE_TEMPLATE = """---
type: entity
title: "{name}"
entity_type: {entity_type}
created: {today}
updated: {today}
sources: [{source_slug}]
tags: []
source_count: 1
---

# {name}

**Type**: {entity_type}

{description}

## Sources

- [[{source_slug}]] — first appearance
"""

UPDATE_PROMPT = """Update this wiki entity page with new information from the source below.
Preserve existing content and add new details. Update the 'updated' date, add the new source to the sources list, and increment source_count.

Existing page:
{existing}

New source ({slug}):
{new_content}

Write the updated entity page:"""


async def extract_and_write_entities(
    slug: str,
    source_content: str,
    user_id: str,
    provider: str = "anthropic",
    model: str | None = None,
) -> list[dict[str, Any]]:
    """Extract entities from source and create/update entity pages.

    Returns:
        List of dicts with entity name, path, and whether created or updated
    """
    config = LLMConfig(
        provider=provider,
        model=model,
        temperature=0.1,
        max_tokens=2000,
    )

    # Extract entities via LLM
    response = await call(
        messages=[{
            "role": "user",
            "content": EXTRACT_PROMPT.format(content=source_content[:6000]),
        }],
        config=config,
        user_id=user_id,
    )

    try:
        entities = json.loads(response.content)
    except json.JSONDecodeError:
        return []

    results = []
    today = date.today().isoformat()

    for entity in entities:
        name = entity.get("name", "").strip()
        if not name:
            continue

        entity_slug = name.lower().replace(" ", "-").replace(".", "")
        entity_path = user_path(user_id, "wiki", "entities", f"{entity_slug}.md")

        if exists(entity_path):
            # Update existing entity page
            existing_content = read_text(entity_path)
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
            guarded_write_text(user_id, entity_path, update_response.content)
            results.append({"name": name, "path": entity_path, "action": "updated"})
        else:
            # Create new entity page
            page_content = ENTITY_PAGE_TEMPLATE.format(
                name=name,
                entity_type=entity.get("type", "unknown"),
                today=today,
                source_slug=slug,
                description=entity.get("description", ""),
            )
            guarded_write_text(user_id, entity_path, page_content)
            results.append({"name": name, "path": entity_path, "action": "created"})

    return results
