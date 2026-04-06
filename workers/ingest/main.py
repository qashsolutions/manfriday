"""Ingest worker — Cloud Run Job entrypoint.

Orchestrates: fetch → pre-filter → write raw/ → co-locate images → quality score → update manifest.

Usage:
    python -m workers.ingest.main --url https://example.com --user-id test-user
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from typing import Any

from shared.python.manfriday_core.gcs import write_text, read_json, exists, user_path
from workers.ingest.fetchers.base import FetchResult
from workers.ingest.fetchers.github import GitHubFetcher
from workers.ingest.fetchers.jina import JinaFetcher
from workers.ingest.fetchers.pdf import PDFFetcher
from workers.ingest.fetchers.rss import RSSFetcher
from workers.ingest.fetchers.dataset import DatasetFetcher
from workers.ingest.image_colocator import colocate_images
from workers.ingest.manifest import append_manifest, create_manifest_entry
from workers.ingest.quality.pre_filter import pre_filter
from workers.ingest.quality.scorer import score_content

logger = logging.getLogger(__name__)


def _detect_source_type(url: str, explicit_type: str | None = None) -> str:
    """Auto-detect source type from URL pattern."""
    if explicit_type:
        return explicit_type
    if GitHubFetcher.matches(url):
        return "github"
    if any(url.endswith(ext) for ext in [".rss", ".xml", "/feed", "/atom"]):
        return "rss"
    if url.endswith(".pdf"):
        return "pdf"
    if any(url.endswith(ext) for ext in [".csv", ".json"]):
        return "dataset"
    return "url"


def _get_fetcher(source_type: str):
    fetchers = {
        "url": JinaFetcher(),
        "github": GitHubFetcher(),
        "rss": RSSFetcher(),
        "pdf": PDFFetcher(),
        "dataset": DatasetFetcher(),
    }
    fetcher = fetchers.get(source_type)
    if not fetcher:
        raise ValueError(f"Unknown source type: {source_type}")
    return fetcher


async def ingest(
    url: str,
    user_id: str,
    source_type: str | None = None,
    provider: str = "anthropic",
    **kwargs: Any,
) -> dict[str, Any]:
    """Run the full ingest pipeline for a single source.

    Returns:
        Dict with slug, suppressed status, quality score, etc.
    """
    # 1. Detect source type
    resolved_type = _detect_source_type(url, source_type)
    logger.info(f"Ingesting {url} as {resolved_type} for user {user_id}")

    # 2. Fetch
    fetcher = _get_fetcher(resolved_type)
    result: FetchResult = await fetcher.fetch(url, user_id=user_id, **kwargs)
    logger.info(f"Fetched {result.slug}: {len(result.content_md)} chars, {len(result.images)} images")

    # 3. Pre-filter (deterministic, fast)
    filter_result = pre_filter(resolved_type, result.content_md, result.metadata)
    if filter_result.suppressed:
        logger.info(f"Suppressed {result.slug}: {filter_result.reason}")
        entry = create_manifest_entry(
            slug=result.slug,
            url=url,
            source_type=resolved_type,
            metadata=result.metadata,
            suppressed=True,
            suppression_reason=filter_result.reason,
        )
        append_manifest(user_id, entry)
        return {"slug": result.slug, "suppressed": True, "reason": filter_result.reason}

    # 4. Write raw/ markdown
    raw_path = user_path(user_id, "raw", f"{result.slug}.md")
    write_text(raw_path, result.content_md, "text/markdown")

    # 5. Co-locate images (rewrite paths in markdown)
    if result.images:
        updated_md = await colocate_images(result.content_md, result.slug, user_id, result.images)
        write_text(raw_path, updated_md, "text/markdown")

    # 6. Quality score (async — doesn't block return)
    quality = None
    try:
        quality = await score_content(result.content_md, provider, user_id)
        logger.info(f"Quality score for {result.slug}: {quality.overall}")
    except Exception as e:
        logger.warning(f"Quality scoring failed for {result.slug}: {e}")

    # 7. Update manifest
    entry = create_manifest_entry(
        slug=result.slug,
        url=url,
        source_type=resolved_type,
        metadata=result.metadata,
        quality_score=quality.overall if quality else None,
    )
    append_manifest(user_id, entry)

    return {
        "slug": result.slug,
        "suppressed": False,
        "quality_score": quality.overall if quality else None,
        "word_count": result.metadata.get("word_count", 0),
    }


def main():
    parser = argparse.ArgumentParser(description="ManFriday Ingest Worker")
    parser.add_argument("--url", required=True, help="URL to ingest")
    parser.add_argument("--user-id", required=True, help="User ID")
    parser.add_argument("--source-type", default=None, help="Source type override")
    parser.add_argument("--provider", default="anthropic", help="LLM provider for scoring")
    args = parser.parse_args()

    result = asyncio.run(ingest(args.url, args.user_id, args.source_type, args.provider))
    print(f"Ingest complete: {result}")


if __name__ == "__main__":
    main()
