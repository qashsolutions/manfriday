"""Jina Reader API fetcher — URL to clean markdown.

The simplest fetcher. Sends URL to Jina Reader which returns
clean markdown with images preserved.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import httpx

from workers.ingest.fetchers.base import FetcherBase, FetchResult

JINA_READER_URL = "https://r.jina.ai/"


class JinaFetcher(FetcherBase):
    SOURCE_TYPE = "url"

    async def fetch(self, source: str, **kwargs: Any) -> FetchResult:
        """Fetch URL via Jina Reader API → clean markdown.

        Args:
            source: The URL to fetch

        Returns:
            FetchResult with markdown content and metadata
        """
        url = source.strip()
        reader_url = f"{JINA_READER_URL}{url}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                reader_url,
                headers={
                    "Accept": "text/markdown",
                    "X-No-Cache": "true",
                },
            )
            response.raise_for_status()

        content_md = response.text

        # Derive slug from URL
        parsed = urlparse(url)
        path_part = parsed.path.strip("/").replace("/", "-") or parsed.hostname or "page"
        slug = self.slugify(f"{parsed.hostname}-{path_part}")

        # Extract title from first markdown heading if present
        title = ""
        for line in content_md.split("\n"):
            line = line.strip()
            if line.startswith("# "):
                title = line[2:].strip()
                break

        images = self.extract_image_urls(content_md)

        return FetchResult(
            slug=slug,
            content_md=content_md,
            metadata={
                "source_url": url,
                "source_type": "url",
                "title": title or slug,
                "domain": parsed.hostname,
                "word_count": len(content_md.split()),
                "image_count": len(images),
            },
            images=images,
        )
