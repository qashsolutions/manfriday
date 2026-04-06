"""arXiv API connector for ManFriday.

Polls the arXiv Atom feed API for new papers in the user's chosen
categories.

arXiv API docs: https://info.arxiv.org/help/api/index.html
"""

from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

from shared.python.manfriday_core.secrets import (
    delete_byok_key,
    get_byok_key,
    store_byok_key,
)
from workers.ingest.connectors.base import ConnectorBase, ConnectorItem

logger = logging.getLogger(__name__)

ARXIV_API_BASE = "http://export.arxiv.org/api/query"

# Atom/OpenSearch namespaces used in the arXiv response
_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
    "opensearch": "http://a9.com/-/spec/opensearch/1.1/",
}


class ArxivConnector(ConnectorBase):
    """Connector that polls arXiv for papers in chosen categories."""

    CONNECTOR_TYPE = "arxiv"

    # ------------------------------------------------------------------ #
    #  connect
    # ------------------------------------------------------------------ #
    async def connect(self, user_id: str, credentials: dict[str, Any]) -> bool:
        """Store the user's arXiv category preferences.

        Args:
            user_id: ManFriday user id.
            credentials: ``{"categories": ["cs.AI", "cs.LG", ...]}``

        Returns:
            True if categories are valid.
        """
        categories: list[str] = credentials.get("categories", [])
        if not categories:
            raise ValueError(
                "credentials must contain 'categories' — a list of arXiv "
                "category codes, e.g. ['cs.AI', 'cs.LG']"
            )

        # Basic validation: arXiv categories match pattern like cs.AI, math.AG, etc.
        pattern = re.compile(r"^[a-z-]+(\.[A-Z]{2,})?$")
        invalid = [c for c in categories if not pattern.match(c)]
        if invalid:
            raise ValueError(f"Invalid arXiv category codes: {invalid}")

        store_byok_key("arxiv", user_id, json.dumps({"categories": categories}))
        logger.info(
            "arXiv preferences stored for user %s: %s",
            user_id,
            ", ".join(categories),
        )
        return True

    # ------------------------------------------------------------------ #
    #  poll
    # ------------------------------------------------------------------ #
    async def poll(
        self, user_id: str, since: str | None = None
    ) -> list[ConnectorItem]:
        """Query arXiv API for papers in the user's categories.

        Args:
            user_id: ManFriday user id.
            since: ISO-8601 timestamp.  Papers published before this date
                   are excluded.

        Returns:
            List of ``ConnectorItem`` objects, one per paper.
        """
        raw = get_byok_key("arxiv", user_id)
        prefs: dict[str, Any] = json.loads(raw)
        categories: list[str] = prefs.get("categories", [])

        if not categories:
            logger.warning("No arXiv categories configured for user %s", user_id)
            return []

        since_dt: datetime | None = None
        if since:
            since_dt = datetime.fromisoformat(since)
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=timezone.utc)

        # Build query: cat:cs.AI OR cat:cs.LG OR ...
        cat_query = "+OR+".join(f"cat:{quote(c)}" for c in categories)

        items: list[ConnectorItem] = []
        start = 0
        max_results_per_page = 100
        max_total = 500  # safety cap

        async with httpx.AsyncClient(timeout=30) as client:
            while start < max_total:
                params = {
                    "search_query": cat_query,
                    "start": start,
                    "max_results": max_results_per_page,
                    "sortBy": "submittedDate",
                    "sortOrder": "descending",
                }
                resp = await client.get(ARXIV_API_BASE, params=params)
                resp.raise_for_status()

                entries = self._parse_feed(resp.text, since_dt)
                if not entries:
                    break

                items.extend(entries)
                start += max_results_per_page

                # If we got fewer than requested, we've reached the end
                if len(entries) < max_results_per_page:
                    break

        logger.info(
            "arXiv poll for user %s returned %d papers", user_id, len(items)
        )
        return items

    # ------------------------------------------------------------------ #
    #  disconnect
    # ------------------------------------------------------------------ #
    async def disconnect(self, user_id: str) -> None:
        """Delete the user's arXiv preferences from Secret Manager."""
        delete_byok_key("arxiv", user_id)
        logger.info("arXiv connector disconnected for user %s", user_id)

    # ------------------------------------------------------------------ #
    #  helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _parse_feed(
        xml_text: str, since_dt: datetime | None
    ) -> list[ConnectorItem]:
        """Parse an arXiv Atom feed and return ConnectorItems."""
        root = ET.fromstring(xml_text)
        items: list[ConnectorItem] = []

        for entry in root.findall("atom:entry", _NS):
            # Extract fields
            arxiv_id_raw = entry.findtext("atom:id", "", _NS)
            # id looks like http://arxiv.org/abs/2401.12345v1
            arxiv_id = arxiv_id_raw.rsplit("/abs/", 1)[-1] if "/abs/" in arxiv_id_raw else arxiv_id_raw

            title = entry.findtext("atom:title", "", _NS).strip()
            # Normalise multi-line titles
            title = re.sub(r"\s+", " ", title)

            abstract = entry.findtext("atom:summary", "", _NS).strip()
            abstract = re.sub(r"\s+", " ", abstract)

            published_str = entry.findtext("atom:published", "", _NS)
            updated_str = entry.findtext("atom:updated", "", _NS)

            # Authors
            authors: list[str] = []
            for author_el in entry.findall("atom:author", _NS):
                name = author_el.findtext("atom:name", "", _NS).strip()
                if name:
                    authors.append(name)

            # Categories
            categories: list[str] = [
                cat_el.get("term", "")
                for cat_el in entry.findall("atom:category", _NS)
                if cat_el.get("term")
            ]

            # Parse published date for filtering
            published_dt: datetime | None = None
            if published_str:
                try:
                    published_dt = datetime.fromisoformat(
                        published_str.replace("Z", "+00:00")
                    )
                except ValueError:
                    pass

            if since_dt and published_dt and published_dt < since_dt:
                # Papers are sorted descending by date — once we hit one
                # that's too old, all remaining will be older.  Return
                # what we have so far and signal to stop pagination.
                break

            # Canonical URL (without version suffix)
            base_id = re.sub(r"v\d+$", "", arxiv_id)
            source_url = f"https://arxiv.org/abs/{base_id}"

            items.append(
                ConnectorItem(
                    source_url=source_url,
                    source_type="arxiv",
                    title=title,
                    raw_content=abstract,
                    metadata={
                        "arxiv_id": arxiv_id,
                        "title": title,
                        "authors": authors,
                        "categories": categories,
                        "abstract": abstract,
                        "published": published_str,
                        "updated": updated_str,
                    },
                )
            )

        return items
