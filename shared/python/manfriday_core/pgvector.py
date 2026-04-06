"""pgvector client for ManFriday — embedding storage and similarity search.

Uses asyncpg for connection pooling. Stores per-user embeddings with
content hashes for cache invalidation.

Table schema (created via migration or on first connect):

    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS embeddings (
        id          BIGSERIAL PRIMARY KEY,
        user_id     TEXT NOT NULL,
        page_path   TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding   vector(1536),
        created_at  TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, page_path)
    );
    CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    CREATE INDEX ON embeddings (user_id);
"""

from __future__ import annotations

import os
from typing import Any

import asyncpg

PGVECTOR_URL = os.getenv("PGVECTOR_URL") or os.getenv("DATABASE_URL", "")

_pool: asyncpg.Pool | None = None

# Embedding dimensions per provider model
EMBEDDING_DIMS = {
    "openai": 1536,       # text-embedding-3-small
    "gemini": 768,        # embedding-001
    "anthropic": 1024,    # voyage-3-lite (Anthropic recommends Voyage)
}


async def _get_pool() -> asyncpg.Pool:
    """Get or create the connection pool, ensuring the table exists."""
    global _pool
    if _pool is None:
        if not PGVECTOR_URL:
            raise RuntimeError(
                "PGVECTOR_URL or DATABASE_URL must be set for semantic search"
            )
        _pool = await asyncpg.create_pool(
            PGVECTOR_URL,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        await _ensure_schema(_pool)
    return _pool


async def _ensure_schema(pool: asyncpg.Pool) -> None:
    """Create the pgvector extension and embeddings table if they don't exist."""
    async with pool.acquire() as conn:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS embeddings (
                id           BIGSERIAL PRIMARY KEY,
                user_id      TEXT NOT NULL,
                page_path    TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                embedding    vector(1536),
                created_at   TIMESTAMPTZ DEFAULT now(),
                UNIQUE(user_id, page_path)
            );
        """)
        # Index for cosine similarity — safe to run multiple times
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS embeddings_user_idx
            ON embeddings (user_id);
        """)
        # ivfflat index requires rows to exist; create if table is non-empty
        row = await conn.fetchval("SELECT count(*) FROM embeddings;")
        if row and row > 100:
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS embeddings_cosine_idx
                ON embeddings USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 100);
            """)


async def store_embedding(
    user_id: str,
    path: str,
    embedding: list[float],
    content_hash: str,
) -> None:
    """Insert or update an embedding for a wiki page.

    Uses ON CONFLICT to upsert — if the page already has an embedding,
    it is replaced only if the content_hash has changed.
    """
    pool = await _get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO embeddings (user_id, page_path, content_hash, embedding, created_at)
            VALUES ($1, $2, $3, $4::vector, now())
            ON CONFLICT (user_id, page_path) DO UPDATE
            SET content_hash = EXCLUDED.content_hash,
                embedding    = EXCLUDED.embedding,
                created_at   = now()
            WHERE embeddings.content_hash != EXCLUDED.content_hash;
            """,
            user_id,
            path,
            content_hash,
            str(embedding),  # asyncpg + pgvector: pass as text, cast to vector
        )


async def search_similar(
    user_id: str,
    query_embedding: list[float],
    top_n: int = 5,
) -> list[dict[str, Any]]:
    """Cosine similarity search over a user's embeddings.

    Returns list of {path, score} sorted by descending similarity.
    Score is 1 - cosine_distance (so higher = more similar).
    """
    pool = await _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT page_path,
                   1 - (embedding <=> $1::vector) AS score
            FROM embeddings
            WHERE user_id = $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3;
            """,
            str(query_embedding),
            user_id,
            top_n,
        )
    return [{"path": row["page_path"], "score": round(float(row["score"]), 4)} for row in rows]


async def delete_embedding(user_id: str, path: str) -> None:
    """Remove the embedding for a deleted wiki page."""
    pool = await _get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM embeddings WHERE user_id = $1 AND page_path = $2;",
            user_id,
            path,
        )


async def get_content_hash(user_id: str, path: str) -> str | None:
    """Return the stored content_hash for a page, or None if not embedded."""
    pool = await _get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT content_hash FROM embeddings WHERE user_id = $1 AND page_path = $2;",
            user_id,
            path,
        )


async def close_pool() -> None:
    """Gracefully close the connection pool (call on shutdown)."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
