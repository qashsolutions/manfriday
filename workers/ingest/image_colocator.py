"""Image co-locator — download images and rewrite markdown paths.

Downloads images found in content to GCS raw/{user_id}/{slug}/images/
and rewrites the markdown to use relative paths.
"""

from __future__ import annotations

import hashlib
import re
from urllib.parse import urlparse

import httpx

from shared.python.manfriday_core.gcs import write_bytes


async def colocate_images(
    content_md: str,
    slug: str,
    user_id: str,
    image_urls: list[str],
) -> str:
    """Download images and rewrite markdown to use GCS paths.

    Args:
        content_md: Original markdown with absolute image URLs
        slug: Source slug for path construction
        user_id: User ID for GCS path
        image_urls: List of image URLs to download

    Returns:
        Updated markdown with rewritten image paths
    """
    if not image_urls:
        return content_md

    updated_md = content_md

    async with httpx.AsyncClient(timeout=15.0) as client:
        for url in image_urls:
            try:
                resp = await client.get(url)
                if resp.status_code != 200:
                    continue

                # Determine extension from URL or content-type
                ext = _get_extension(url, resp.headers.get("content-type", ""))
                # Use hash of URL for stable filenames
                filename = hashlib.md5(url.encode()).hexdigest()[:12] + ext

                # Upload to GCS
                gcs_path = f"{user_id}/raw/{slug}/images/{filename}"
                write_bytes(gcs_path, resp.content, resp.headers.get("content-type", "image/png"))

                # Rewrite in markdown — use relative path
                relative_path = f"{slug}/images/{filename}"
                updated_md = updated_md.replace(url, relative_path)

            except (httpx.HTTPError, Exception):
                # Skip failed images — don't block ingest
                continue

    return updated_md


def _get_extension(url: str, content_type: str) -> str:
    """Determine file extension from URL path or content-type."""
    # Try URL path first
    path = urlparse(url).path
    if "." in path.split("/")[-1]:
        ext = "." + path.split(".")[-1].lower()
        if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"):
            return ext

    # Fallback to content-type
    ct_map = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
    }
    return ct_map.get(content_type, ".png")
