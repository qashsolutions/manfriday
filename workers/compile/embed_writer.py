"""Embedding pipeline — generates and stores vector embeddings for wiki pages.

Called by the compile worker after each wiki page write, and provides
a batch migration job for embedding all existing pages.

Provider support:
- OpenAI: text-embedding-3-small (1536 dims, cheapest)
- Google: embedding-001 (768 dims)
- Anthropic: via Voyage AI voyage-3-lite (1024 dims)
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

from shared.python.manfriday_core.gcs import read_text, list_markdown_files, user_path
from shared.python.manfriday_core.secrets import get_byok_key
from shared.python.manfriday_core.pgvector import (
    store_embedding,
    get_content_hash,
    EMBEDDING_DIMS,
)

logger = logging.getLogger(__name__)

# Max tokens to send for embedding (approx chars — conservative at 4 chars/token)
MAX_EMBED_CHARS = 512 * 4  # ~512 tokens

# Cheapest embedding model per provider
EMBEDDING_MODELS: dict[str, str] = {
    "openai": "text-embedding-3-small",
    "gemini": "text-embedding-004",
    "anthropic": "voyage-3-lite",  # via Voyage AI (Anthropic's recommended partner)
}


def _content_hash(content: str) -> str:
    """SHA-256 hex digest of content (for cache invalidation)."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def _truncate_for_embedding(content: str) -> str:
    """Truncate content to ~512 tokens for embedding.

    Strips YAML frontmatter first, then takes first MAX_EMBED_CHARS characters.
    """
    text = content
    # Strip YAML frontmatter
    if text.startswith("---"):
        end = text.find("---", 3)
        if end > 0:
            text = text[end + 3:]
    text = text.strip()
    return text[:MAX_EMBED_CHARS]


async def _embed_openai(text: str, api_key: str) -> list[float]:
    """Generate embedding using OpenAI text-embedding-3-small."""
    import openai

    client = openai.AsyncOpenAI(api_key=api_key)
    response = await client.embeddings.create(
        model=EMBEDDING_MODELS["openai"],
        input=text,
    )
    return response.data[0].embedding


async def _embed_gemini(text: str, api_key: str) -> list[float]:
    """Generate embedding using Google embedding-001."""
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    result = await genai.embed_content_async(
        model=f"models/{EMBEDDING_MODELS['gemini']}",
        content=text,
        task_type="retrieval_document",
    )
    return result["embedding"]


async def _embed_voyage(text: str, api_key: str) -> list[float]:
    """Generate embedding using Voyage AI (Anthropic-recommended).

    Uses the voyageai SDK if available, otherwise falls back to HTTP.
    """
    try:
        import voyageai

        client = voyageai.AsyncClient(api_key=api_key)
        result = await client.embed([text], model=EMBEDDING_MODELS["anthropic"])
        return result.embeddings[0]
    except ImportError:
        import httpx

        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://api.voyageai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": EMBEDDING_MODELS["anthropic"],
                    "input": [text],
                },
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()["data"][0]["embedding"]


async def generate_embedding(text: str, provider: str, api_key: str) -> list[float]:
    """Generate an embedding vector using the configured provider."""
    if provider == "openai":
        return await _embed_openai(text, api_key)
    elif provider == "gemini":
        return await _embed_gemini(text, api_key)
    elif provider == "anthropic":
        return await _embed_voyage(text, api_key)
    else:
        raise ValueError(f"Unsupported embedding provider: {provider}")


async def embed_page(
    path: str,
    content: str,
    user_id: str,
    provider: str = "openai",
) -> None:
    """Generate an embedding for a single wiki page and store it in pgvector.

    Skips re-embedding if content_hash hasn't changed (cache hit).
    Called by the compile worker after each wiki page write.
    """
    # Compute hash of the content to avoid redundant embeddings
    ch = _content_hash(content)

    # Check if we already have this exact content embedded
    existing_hash = await get_content_hash(user_id, path)
    if existing_hash == ch:
        logger.debug("Skipping embed for %s — content unchanged", path)
        return

    # Prepare text for embedding
    text = _truncate_for_embedding(content)
    if not text.strip():
        logger.warning("Skipping embed for %s — empty content after truncation", path)
        return

    # Get API key and generate embedding
    try:
        # For Anthropic/Voyage, the key env var is BYOK_ANTHROPIC
        api_key = get_byok_key(provider, user_id)
        embedding = await generate_embedding(text, provider, api_key)
    except Exception:
        logger.exception("Failed to generate embedding for %s via %s", path, provider)
        return

    # Store in pgvector
    await store_embedding(user_id, path, embedding, ch)
    logger.info("Embedded %s (%d dims) via %s", path, len(embedding), provider)


async def embed_query(
    query: str,
    user_id: str,
    provider: str = "openai",
) -> list[float]:
    """Generate an embedding for a search query.

    Uses the same provider as page embeddings but with task_type=query
    where applicable.
    """
    api_key = get_byok_key(provider, user_id)

    if provider == "openai":
        return await _embed_openai(query, api_key)
    elif provider == "gemini":
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        result = await genai.embed_content_async(
            model=f"models/{EMBEDDING_MODELS['gemini']}",
            content=query,
            task_type="retrieval_query",
        )
        return result["embedding"]
    elif provider == "anthropic":
        return await _embed_voyage(query, api_key)
    else:
        raise ValueError(f"Unsupported embedding provider: {provider}")


async def batch_embed(
    user_id: str,
    provider: str = "openai",
) -> dict[str, Any]:
    """Embed all wiki pages for a user (migration/backfill job).

    Returns stats: {total, embedded, skipped, errors}.
    """
    wiki_prefix = user_path(user_id, "wiki")
    all_files = list_markdown_files(wiki_prefix + "/")

    # Skip structural files that don't need semantic search
    skip_names = {"index.md", "log.md", "backlinks.md", "lint_queue.md"}
    files = [f for f in all_files if f.split("/")[-1] not in skip_names]

    stats = {"total": len(files), "embedded": 0, "skipped": 0, "errors": 0}

    for path in files:
        try:
            content = read_text(path)
            ch = _content_hash(content)

            # Skip if already embedded with same hash
            existing_hash = await get_content_hash(user_id, path)
            if existing_hash == ch:
                stats["skipped"] += 1
                continue

            text = _truncate_for_embedding(content)
            if not text.strip():
                stats["skipped"] += 1
                continue

            api_key = get_byok_key(provider, user_id)
            embedding = await generate_embedding(text, provider, api_key)
            await store_embedding(user_id, path, embedding, ch)
            stats["embedded"] += 1
            logger.info("Batch embedded: %s", path)

        except Exception:
            logger.exception("Batch embed failed for %s", path)
            stats["errors"] += 1

    logger.info(
        "Batch embed complete for user %s: %d embedded, %d skipped, %d errors",
        user_id,
        stats["embedded"],
        stats["skipped"],
        stats["errors"],
    )
    return stats
