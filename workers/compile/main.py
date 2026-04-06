"""Compile worker — Cloud Run Job entrypoint.

Reads manifest.json, finds uncompiled items, runs the full compile pipeline:
  1. Article writer (raw/ → wiki/articles/)
  2. Entity writer (extract + create/update wiki/entities/)
  3. Concept writer (extract + create/update wiki/concepts/)
  4. Index writer (rebuild wiki/index.md)
  5. Backlinks (rebuild wiki/backlinks.md)
  6. Log writer (append to wiki/log.md)
  7. Schema writer (update memory.md)
  8. Process lint_queue.md
  9. Re-ingest raw/outputs/

Usage:
    python -m workers.compile.main --user-id test-user
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from shared.python.manfriday_core.gcs import read_text, read_json, exists, user_path
from workers.ingest.manifest import get_uncompiled, mark_compiled, read_manifest
from workers.compile.article_writer import write_article
from workers.compile.entity_writer import extract_and_write_entities
from workers.compile.concept_writer import extract_and_write_concepts
from workers.compile.index_writer import rebuild_index
from workers.compile.backlinks import rebuild_backlinks
from workers.compile.log_writer import append_ingest_log
from workers.compile.schema_writer import update_memory
from workers.compile.lint_queue import read_lint_queue, write_lint_queue
from workers.compile.output_ingester import get_unprocessed_outputs, process_output
from workers.compile.playbook_writer import update_playbook, update_active_threads

logger = logging.getLogger(__name__)


async def compile_wiki_interactive(
    slug: str,
    user_id: str,
    provider: str = "anthropic",
) -> dict:
    """Interactive compile — returns takeaways for user approval before writing.

    Called by Ingest Agent in conversational mode (skills_and_agents.md, Agent 1 step 2).
    Returns takeaways dict; caller decides whether to proceed with full compile.
    """
    raw_path = user_path(user_id, "raw", f"{slug}.md")
    raw_content = read_text(raw_path)

    # Generate takeaways via LLM
    from shared.python.manfriday_core.llm import LLMConfig, call

    config = LLMConfig(
        provider=provider,
        temperature=0.3,
        max_tokens=500,
        system_prompt="You are a wiki assistant. Summarize key takeaways from this source in 3-5 bullet points. Mention entities and concepts you'd create pages for.",
    )
    response = await call(
        messages=[{"role": "user", "content": f"Source ({slug}):\n{raw_content[:6000]}"}],
        config=config,
        user_id=user_id,
    )

    return {
        "slug": slug,
        "takeaways": response.content,
        "status": "awaiting_approval",
    }


async def compile_wiki_approved(slug: str, user_id: str, provider: str = "anthropic") -> dict:
    """Execute compile for a single slug after user approves takeaways."""
    raw_path = user_path(user_id, "raw", f"{slug}.md")
    raw_content = read_text(raw_path)

    article = await write_article(slug, user_id, provider)
    entities = await extract_and_write_entities(slug, raw_content, user_id, provider)
    concepts = await extract_and_write_concepts(slug, raw_content, user_id, provider)

    pages_created = [e["name"] for e in entities if e["action"] == "created"]
    pages_created += [c["name"] for c in concepts if c["action"] == "created"]
    pages_updated = [e["name"] for e in entities if e["action"] == "updated"]
    pages_updated += [c["name"] for c in concepts if c["action"] == "updated"]

    append_ingest_log(
        user_id=user_id,
        source_title=slug,
        pages_updated=pages_updated,
        pages_created=[slug] + pages_created,
        takeaway=f"Compiled {slug}: {len(entities)} entities, {len(concepts)} concepts",
    )
    mark_compiled(user_id, slug)

    await rebuild_index(user_id, provider)
    rebuild_backlinks(user_id)

    return {
        "slug": slug,
        "entities": len(entities),
        "concepts": len(concepts),
        "pages_created": pages_created,
    }


async def compile_user(user_id: str, provider: str | None = None) -> dict:
    """Run full compile pipeline for a user (batch mode).

    Returns:
        Summary of compile results
    """
    # Read provider from preferences.json if not explicitly passed
    if provider is None:
        try:
            prefs = read_json(user_path(user_id, "config", "preferences.json"))
            provider = prefs.get("llm_provider", "anthropic")
        except Exception:
            provider = "anthropic"

    # Read CLAUDE.md for context (non-negotiable #2)
    try:
        claude_md = read_text(user_path(user_id, "CLAUDE.md"))
        logger.info(f"Read CLAUDE.md for {user_id} ({len(claude_md)} chars)")
    except Exception:
        logger.warning(f"No CLAUDE.md found for {user_id}")

    # Find uncompiled items
    uncompiled = get_uncompiled(user_id)
    if not uncompiled:
        logger.info(f"No uncompiled items for {user_id}")
        return {"items_compiled": 0}

    logger.info(f"Found {len(uncompiled)} uncompiled items for {user_id}")

    total_entities = []
    total_concepts = []
    total_articles = []

    for entry in uncompiled:
        slug = entry["slug"]
        logger.info(f"Compiling {slug}...")

        try:
            # Read raw source
            raw_path = user_path(user_id, "raw", f"{slug}.md")
            raw_content = read_text(raw_path)

            # 1. Write article
            article = await write_article(slug, user_id, provider)
            total_articles.append(slug)

            # 2. Extract and write entities
            entities = await extract_and_write_entities(slug, raw_content, user_id, provider)
            total_entities.extend(entities)

            # 3. Extract and write concepts
            concepts = await extract_and_write_concepts(slug, raw_content, user_id, provider)
            total_concepts.extend(concepts)

            # 4. Log the ingest
            pages_created = [e["name"] for e in entities if e["action"] == "created"]
            pages_created += [c["name"] for c in concepts if c["action"] == "created"]
            pages_updated = [e["name"] for e in entities if e["action"] == "updated"]
            pages_updated += [c["name"] for c in concepts if c["action"] == "updated"]

            append_ingest_log(
                user_id=user_id,
                source_title=entry.get("metadata", {}).get("title", slug),
                pages_updated=pages_updated,
                pages_created=[slug] + pages_created,
                takeaway=f"Compiled {slug}: {len(entities)} entities, {len(concepts)} concepts",
            )

            # 5. Mark as compiled
            mark_compiled(user_id, slug)

        except Exception as e:
            logger.error(f"Failed to compile {slug}: {e}")
            continue

    # 6. Rebuild index (async — uses LLM for summaries)
    await rebuild_index(user_id, provider)

    # 7. Rebuild backlinks
    rebuild_backlinks(user_id)

    # 8. Update memory.md
    stats = update_memory(user_id)

    # 8b. Post-compile: update playbook + active threads (Agent 4 spec)
    try:
        update_playbook(user_id)
        update_active_threads(user_id)
    except Exception as e:
        logger.warning(f"Playbook/threads update failed: {e}")

    # 9. Process lint_queue.md — generate articles for pending candidates
    lint_processed = 0
    try:
        queue_items = read_lint_queue(user_id)
        pending = [i for i in queue_items if i.get("status") == "pending"]
        for item in pending:
            try:
                article = await write_article(
                    slug=item["topic"].lower().replace(" ", "-"),
                    user_id=user_id,
                    provider=provider,
                )
                item["status"] = "done"
                lint_processed += 1
            except Exception as e:
                logger.warning(f"Failed to process lint candidate {item['topic']}: {e}")
        if pending:
            write_lint_queue(user_id, queue_items)
    except Exception as e:
        logger.warning(f"Lint queue processing failed: {e}")

    # 10. Re-ingest raw/outputs/ as first-class compile inputs
    outputs_processed = 0
    try:
        unprocessed_outputs = get_unprocessed_outputs(user_id)
        for output in unprocessed_outputs:
            try:
                await process_output(output["slug"], user_id, provider)
                outputs_processed += 1
            except Exception as e:
                logger.warning(f"Failed to process output {output['slug']}: {e}")
    except Exception as e:
        logger.warning(f"Output re-ingestion failed: {e}")

    result = {
        "items_compiled": len(total_articles),
        "entities_processed": len(total_entities),
        "concepts_processed": len(total_concepts),
        "wiki_stats": stats,
        "lint_queue_processed": lint_processed,
        "outputs_reingested": outputs_processed,
    }
    logger.info(f"Compile complete for {user_id}: {result}")
    return result


def main():
    parser = argparse.ArgumentParser(description="ManFriday Compile Worker")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--provider", default="anthropic")
    args = parser.parse_args()

    result = asyncio.run(compile_user(args.user_id, args.provider))
    print(f"Compile complete: {result}")


if __name__ == "__main__":
    main()
