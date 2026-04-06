"""Brave Search API wrapper for data-gap imputation.

Uses env var BRAVE_SEARCH_API_KEY. Returns structured results
suitable for enriching wiki pages with missing citations.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx

BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str


def _api_key() -> str:
    key = os.getenv("BRAVE_SEARCH_API_KEY", "")
    if not key:
        raise RuntimeError(
            "BRAVE_SEARCH_API_KEY not set. "
            "Export it or add to .env before running data-gap checks."
        )
    return key


async def brave_search(
    query: str,
    count: int = 5,
    freshness: str | None = None,
) -> list[SearchResult]:
    """Search Brave and return structured results.

    Args:
        query: Search query string.
        count: Number of results (1-20, default 5).
        freshness: Optional freshness filter ('pd' = past day,
                   'pw' = past week, 'pm' = past month, 'py' = past year).

    Returns:
        List of SearchResult with title, url, snippet.
    """
    params: dict[str, Any] = {"q": query, "count": min(count, 20)}
    if freshness:
        params["freshness"] = freshness

    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": _api_key(),
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(BRAVE_SEARCH_ENDPOINT, params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    results: list[SearchResult] = []
    for item in data.get("web", {}).get("results", []):
        results.append(
            SearchResult(
                title=item.get("title", ""),
                url=item.get("url", ""),
                snippet=item.get("description", ""),
            )
        )

    return results


def results_to_dicts(results: list[SearchResult]) -> list[dict[str, str]]:
    """Convert SearchResult list to plain dicts (for JSON serialisation)."""
    return [{"title": r.title, "url": r.url, "snippet": r.snippet} for r in results]
