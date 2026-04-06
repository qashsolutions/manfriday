"""Output ingester — re-ingest filed Q&A outputs as first-class compile inputs.

Reads raw/outputs/ tagged files, processes them through the article writer,
and creates/enriches wiki/ articles from Q&A history.
"""

from __future__ import annotations

from shared.python.manfriday_core.gcs import read_text, list_markdown_files, user_path
from workers.compile.article_writer import write_article
from workers.compile.entity_writer import extract_and_write_entities
from workers.compile.concept_writer import extract_and_write_concepts
from workers.compile.log_writer import append_log


def get_unprocessed_outputs(user_id: str) -> list[dict[str, str]]:
    """Find raw/outputs/ files that haven't been compiled into wiki yet.

    Returns:
        List of dicts with path and slug
    """
    outputs_prefix = user_path(user_id, "raw", "outputs") + "/"
    files = list_markdown_files(outputs_prefix)

    wiki_outputs_prefix = user_path(user_id, "wiki", "outputs") + "/"
    wiki_files = list_markdown_files(wiki_outputs_prefix)
    wiki_slugs = {f.split("/")[-1].replace(".md", "") for f in wiki_files}

    unprocessed = []
    for filepath in files:
        slug = filepath.split("/")[-1].replace(".md", "")
        if slug not in wiki_slugs:
            unprocessed.append({"path": filepath, "slug": slug})

    return unprocessed


async def process_output(
    slug: str,
    user_id: str,
    provider: str = "anthropic",
) -> dict:
    """Process a single raw/outputs/ file through the compile pipeline.

    Creates a wiki article from the Q&A output and extracts any
    entities/concepts mentioned.
    """
    raw_path = user_path(user_id, "raw", "outputs", f"{slug}.md")
    content = read_text(raw_path)

    # Write as wiki article (reuses article_writer)
    article = await write_article(slug, user_id, provider)

    # Extract entities and concepts from the output
    entities = await extract_and_write_entities(slug, content, user_id, provider)
    concepts = await extract_and_write_concepts(slug, content, user_id, provider)

    # Log
    append_log(
        user_id=user_id,
        action="compile",
        title=f"Re-ingested output: {slug}",
        details=f"Entities: {len(entities)} | Concepts: {len(concepts)}",
    )

    return {
        "slug": slug,
        "entities": len(entities),
        "concepts": len(concepts),
    }
