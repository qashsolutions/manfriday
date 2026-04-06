"""Search router — hybrid BM25 + pgvector semantic search over wiki/.

Supports three search methods:
- bm25: keyword-based BM25 ranking (original implementation)
- semantic: embed query → pgvector cosine similarity
- hybrid (default): BM25 first; if fewer than 3 results, supplement with semantic
"""

from __future__ import annotations

import json
import logging
from enum import Enum
from typing import Any

from fastapi import APIRouter, Depends, Query

from api.middleware.auth import get_current_user
from api.tools.registry import search_wiki
from shared.python.manfriday_core.gcs import read_text, user_path

logger = logging.getLogger(__name__)

router = APIRouter()


class SearchMethod(str, Enum):
    bm25 = "bm25"
    semantic = "semantic"
    hybrid = "hybrid"


def _get_user_provider(user_id: str) -> str:
    """Read user's preferred LLM/embedding provider from config."""
    try:
        prefs = json.loads(read_text(user_path(user_id, "config", "preferences.json")))
        return prefs.get("embedding_provider", prefs.get("llm_provider", "openai"))
    except Exception:
        return "openai"


async def _semantic_search(
    query: str,
    user_id: str,
    top_n: int,
    provider: str,
) -> list[dict[str, Any]]:
    """Embed query and search pgvector for similar wiki pages.

    Returns results in the same format as BM25: [{path, title, summary, score}].
    """
    from workers.compile.embed_writer import embed_query
    from shared.python.manfriday_core.pgvector import search_similar

    query_embedding = await embed_query(query, user_id, provider)
    raw_results = await search_similar(user_id, query_embedding, top_n)

    # Enrich results with title and summary from the actual wiki pages
    enriched = []
    for result in raw_results:
        path = result["path"]
        try:
            content = read_text(path)
            title = path.split("/")[-1].replace(".md", "")
            for line in content.split("\n"):
                if line.startswith("# "):
                    title = line[2:].strip()
                    break

            # Extract summary — first 150 chars after frontmatter
            text = content
            if text.startswith("---"):
                end = text.find("---", 3)
                if end > 0:
                    text = text[end + 3:]
            summary = text.strip()[:150].replace("\n", " ")

            enriched.append({
                "path": path,
                "title": title,
                "summary": summary,
                "score": result["score"],
            })
        except Exception:
            # Page may have been deleted; skip
            enriched.append({
                "path": path,
                "title": path.split("/")[-1].replace(".md", ""),
                "summary": "",
                "score": result["score"],
            })

    return enriched


def _merge_results(
    bm25_results: list[dict[str, Any]],
    semantic_results: list[dict[str, Any]],
    top_n: int,
) -> list[dict[str, Any]]:
    """Merge BM25 and semantic results, deduplicating by path.

    BM25 results take priority (appear first). Semantic results fill
    remaining slots if BM25 returned fewer than top_n.
    """
    seen_paths: set[str] = set()
    merged: list[dict[str, Any]] = []

    for r in bm25_results:
        if r["path"] not in seen_paths:
            r["method"] = "bm25"
            merged.append(r)
            seen_paths.add(r["path"])

    for r in semantic_results:
        if r["path"] not in seen_paths:
            r["method"] = "semantic"
            merged.append(r)
            seen_paths.add(r["path"])

    return merged[:top_n]


@router.get("")
async def search(
    q: str = Query(..., description="Search query"),
    n: int = Query(5, description="Number of results"),
    method: SearchMethod = Query(
        SearchMethod.hybrid,
        description="Search method: bm25, semantic, or hybrid (default)",
    ),
    user: dict = Depends(get_current_user),
):
    """Search wiki pages using BM25, semantic similarity, or hybrid."""
    user_id = user["user_id"]

    if method == SearchMethod.bm25:
        results = await search_wiki(q, user_id, top_n=n)
        return {"query": q, "method": "bm25", "results": results}

    if method == SearchMethod.semantic:
        provider = _get_user_provider(user_id)
        try:
            results = await _semantic_search(q, user_id, n, provider)
            return {"query": q, "method": "semantic", "results": results}
        except Exception:
            logger.exception("Semantic search failed, falling back to BM25")
            results = await search_wiki(q, user_id, top_n=n)
            return {
                "query": q,
                "method": "bm25",
                "results": results,
                "note": "Semantic search unavailable; fell back to BM25",
            }

    # Hybrid: BM25 first, supplement with semantic if < 3 results
    bm25_results = await search_wiki(q, user_id, top_n=n)

    if len(bm25_results) >= 3:
        return {"query": q, "method": "hybrid", "results": bm25_results}

    # Supplement with semantic search
    provider = _get_user_provider(user_id)
    try:
        semantic_results = await _semantic_search(q, user_id, n, provider)
        merged = _merge_results(bm25_results, semantic_results, n)
        return {"query": q, "method": "hybrid", "results": merged}
    except Exception:
        logger.exception("Semantic supplement failed in hybrid search")
        return {
            "query": q,
            "method": "hybrid",
            "results": bm25_results,
            "note": "Semantic supplement unavailable; BM25 results only",
        }
