"""World model graph builder — extracts entity relationships from wiki pages.

Reads all entity + concept pages, uses LLM to identify relationships,
and writes wiki/graph.json. Called by compile worker after full compile cycle.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date

from shared.python.manfriday_core.gcs import (
    read_text,
    write_text,
    exists,
    list_markdown_files,
    user_path,
)
from shared.python.manfriday_core.llm import LLMConfig, call
from workers.compile.write_guard import guarded_write_text
from workers.compile.graph_schema import (
    GraphEntity,
    GraphRelationship,
    WikiGraph,
    RELATIONSHIP_TYPES,
    ENTITY_TYPES,
)

logger = logging.getLogger(__name__)

# ── System prompt for relationship extraction ──────────────


EXTRACTION_SYSTEM_PROMPT = f"""\
You are a knowledge graph builder. Given a wiki page and a list of known entities,
extract relationships between them.

Valid relationship types: {", ".join(sorted(RELATIONSHIP_TYPES))}
Valid entity types: {", ".join(sorted(ENTITY_TYPES))}

Rules:
- Only extract relationships you are confident about (>= 0.7 confidence on a 0-1 scale).
- Each relationship needs: source entity id, target entity id, relationship type, confidence score.
- Entity ids are lowercase slugs (e.g., "openai", "transformer-architecture").
- If you discover new entities not in the provided list, include them with their type.
- Return ONLY valid JSON — no markdown fences, no commentary.

Output format (JSON array):
[
  {{
    "source": "entity-id",
    "target": "entity-id",
    "type": "relationship_type",
    "confidence": 0.85,
    "new_entities": [
      {{"id": "new-entity", "name": "New Entity", "type": "concept"}}
    ]
  }}
]

If no relationships are found, return an empty array: []
"""


# ── Core functions ─────────────────────────────────────────


async def build_graph(user_id: str, provider: str) -> WikiGraph:
    """Read all wiki entity + concept pages and build the world model graph.

    1. Load existing graph.json if present (incremental build).
    2. Collect all entity + concept pages.
    3. Extract relationships via LLM for each page.
    4. Merge into graph, filter by confidence > 0.7.
    5. Write wiki/graph.json.

    Returns:
        The built WikiGraph.
    """
    graph_path = user_path(user_id, "wiki", "graph.json")

    # Load existing graph for incremental builds
    graph = WikiGraph()
    if exists(graph_path):
        try:
            raw = read_text(graph_path)
            graph = WikiGraph.from_json(raw)
            logger.info(
                f"Loaded existing graph: {len(graph.entities)} entities, "
                f"{len(graph.relationships)} relationships"
            )
        except Exception as e:
            logger.warning(f"Failed to load existing graph, starting fresh: {e}")
            graph = WikiGraph()

    # Collect entity and concept pages
    entity_files = list_markdown_files(user_path(user_id, "wiki", "entities"))
    concept_files = list_markdown_files(user_path(user_id, "wiki", "concepts"))
    all_files = entity_files + concept_files

    if not all_files:
        logger.info("No entity or concept pages found — skipping graph build")
        return graph

    logger.info(f"Building graph from {len(all_files)} pages ({len(entity_files)} entities, {len(concept_files)} concepts)")

    # Build entity registry from filenames for the LLM prompt
    known_entities: list[str] = []
    for f in all_files:
        # Extract slug from path like "{user_id}/wiki/entities/{slug}.md"
        slug = f.rsplit("/", 1)[-1].replace(".md", "")
        known_entities.append(slug)

        # Register as graph entity if not already present
        if slug not in graph.entities:
            entity_type = "concept" if "/concepts/" in f else _infer_entity_type(f, slug)
            graph.add_entity(
                GraphEntity(
                    id=slug,
                    name=_slug_to_name(slug),
                    type=entity_type,
                    confidence=1.0,
                    first_mention=str(date.today()),
                    appearances=1,
                )
            )

    # Process each page for relationships
    for filepath in all_files:
        try:
            content = read_text(filepath)
            slug = filepath.rsplit("/", 1)[-1].replace(".md", "")

            relationships = await extract_relationships(
                content=content,
                entities=known_entities,
                provider=provider,
                user_id=user_id,
            )

            for rel_data in relationships:
                # Handle newly discovered entities
                for new_ent in rel_data.get("new_entities", []):
                    ent_type = new_ent.get("type", "concept")
                    if ent_type not in ENTITY_TYPES:
                        ent_type = "concept"
                    graph.add_entity(
                        GraphEntity(
                            id=new_ent["id"],
                            name=new_ent.get("name", _slug_to_name(new_ent["id"])),
                            type=ent_type,
                            confidence=0.8,
                            first_mention=str(date.today()),
                            appearances=1,
                        )
                    )
                    if new_ent["id"] not in known_entities:
                        known_entities.append(new_ent["id"])

                # Add relationship if confidence threshold met
                confidence = rel_data.get("confidence", 0.0)
                rel_type = rel_data.get("type", "")
                if confidence <= 0.7:
                    continue
                if rel_type not in RELATIONSHIP_TYPES:
                    logger.warning(f"Skipping invalid relationship type: {rel_type}")
                    continue

                source_id = rel_data.get("source", "")
                target_id = rel_data.get("target", "")
                if not source_id or not target_id:
                    continue

                graph.add_relationship(
                    GraphRelationship(
                        source=source_id,
                        target=target_id,
                        type=rel_type,
                        confidence=confidence,
                        source_page=slug,
                    )
                )

        except Exception as e:
            logger.error(f"Failed to process {filepath}: {e}")
            continue

    # Filter relationships below threshold (in case old data crept in)
    graph.relationships = [r for r in graph.relationships if r.confidence > 0.7]

    # Write graph.json via write guard
    graph_json = graph.to_json()
    write_text(graph_path, graph_json, "application/json")
    logger.info(
        f"Graph written: {len(graph.entities)} entities, "
        f"{len(graph.relationships)} relationships"
    )

    return graph


async def extract_relationships(
    content: str,
    entities: list[str],
    provider: str,
    user_id: str,
) -> list[dict]:
    """Use LLM to extract relationships from a wiki page.

    Args:
        content: The full text of a wiki page.
        entities: List of known entity slugs for context.
        provider: LLM provider (anthropic, openai, gemini).
        user_id: For BYOK key lookup.

    Returns:
        List of relationship dicts with source, target, type, confidence, new_entities.
    """
    # Truncate very long pages to stay within token limits
    page_content = content[:8000]

    entity_list = ", ".join(entities[:200])  # cap to avoid huge prompts

    config = LLMConfig(
        provider=provider,
        temperature=0.2,
        max_tokens=2048,
        system_prompt=EXTRACTION_SYSTEM_PROMPT,
    )

    prompt = (
        f"Known entities: [{entity_list}]\n\n"
        f"Wiki page content:\n---\n{page_content}\n---\n\n"
        "Extract all relationships. Return JSON array only."
    )

    try:
        response = await call(
            messages=[{"role": "user", "content": prompt}],
            config=config,
            user_id=user_id,
        )

        # Parse JSON from response — handle potential markdown fences
        text = response.content.strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

        result = json.loads(text)
        if not isinstance(result, list):
            logger.warning(f"LLM returned non-list: {type(result)}")
            return []

        return result

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse LLM relationship extraction output: {e}")
        return []
    except Exception as e:
        logger.error(f"LLM relationship extraction failed: {e}")
        return []


# ── Helpers ────────────────────────────────────────────────


def _slug_to_name(slug: str) -> str:
    """Convert a slug to a human-readable name: 'openai-gpt' -> 'Openai Gpt'."""
    return slug.replace("-", " ").replace("_", " ").title()


def _infer_entity_type(filepath: str, slug: str) -> str:
    """Infer entity type from file path and slug heuristics."""
    if "/entities/" in filepath:
        # Could be person, org, or project — default to org, refine via content later
        return "org"
    if "/concepts/" in filepath:
        return "concept"
    return "concept"
