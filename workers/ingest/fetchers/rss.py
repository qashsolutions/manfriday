"""RSS feed fetcher — parse feed, enqueue individual items as URL fetches."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import feedparser

from workers.ingest.fetchers.base import FetcherBase, FetchResult


@dataclass
class RSSItem:
    url: str
    title: str
    published: str
    summary: str


class RSSFetcher(FetcherBase):
    SOURCE_TYPE = "rss"

    async def fetch(self, source: str, **kwargs: Any) -> FetchResult:
        """Parse RSS feed and return summary markdown with item list.

        Individual items should be enqueued as separate URL ingest jobs.
        The returned content is a summary of the feed itself.
        """
        feed = feedparser.parse(source)
        items = self._parse_items(feed)

        # Build markdown summary of the feed
        lines = [
            f"# {feed.feed.get('title', 'RSS Feed')}",
            "",
            f"Feed URL: {source}",
            f"Items found: {len(items)}",
            "",
            "## Items",
            "",
        ]
        for item in items:
            lines.append(f"- [{item.title}]({item.url}) — {item.published}")
            if item.summary:
                lines.append(f"  > {item.summary[:200]}")
            lines.append("")

        content_md = "\n".join(lines)
        slug = self.slugify(feed.feed.get("title", "rss-feed"))

        return FetchResult(
            slug=slug,
            content_md=content_md,
            metadata={
                "source_url": source,
                "source_type": "rss",
                "title": feed.feed.get("title", "RSS Feed"),
                "item_count": len(items),
                "items": [{"url": i.url, "title": i.title, "published": i.published} for i in items],
            },
        )

    def _parse_items(self, feed: Any) -> list[RSSItem]:
        items = []
        for entry in feed.entries:
            url = entry.get("link", "")
            if not url:
                continue
            items.append(
                RSSItem(
                    url=url,
                    title=entry.get("title", "Untitled"),
                    published=entry.get("published", ""),
                    summary=entry.get("summary", ""),
                )
            )
        return items
