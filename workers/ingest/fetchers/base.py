"""Base class for all fetchers."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class FetchResult:
    slug: str
    content_md: str
    metadata: dict[str, Any] = field(default_factory=dict)
    images: list[str] = field(default_factory=list)  # URLs of images found in content


class FetcherBase(ABC):
    """Abstract base for source fetchers.

    Every fetcher must implement `fetch()` and return a FetchResult.
    """

    SOURCE_TYPE: str = "unknown"

    @abstractmethod
    async def fetch(self, source: str, **kwargs: Any) -> FetchResult:
        """Fetch source and return clean markdown + metadata.

        Args:
            source: URL, file path, or identifier to fetch
            **kwargs: Fetcher-specific options

        Returns:
            FetchResult with slug, content_md, metadata, and images
        """
        ...

    @staticmethod
    def slugify(text: str) -> str:
        """Convert text to URL-safe slug."""
        text = text.lower().strip()
        text = re.sub(r"[^\w\s-]", "", text)
        text = re.sub(r"[-\s]+", "-", text)
        return text[:80].strip("-")

    @staticmethod
    def extract_image_urls(markdown: str) -> list[str]:
        """Extract all image URLs from markdown content."""
        pattern = r"!\[.*?\]\((https?://[^)]+)\)"
        return re.findall(pattern, markdown)
