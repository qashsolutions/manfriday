"""Deterministic site ingestion — trafilatura + OG metadata. No LLM here."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import requests
import trafilatura

UA = {"User-Agent": "Mozilla/5.0 (compatible; ManFridayBot/0.1; +https://manfriday.app)"}


@dataclass
class ScrapeResult:
    url: str
    title: str
    description: str
    text: str
    image_paths: list[Path] = field(default_factory=list)


def _meta(html: str, prop: str) -> str | None:
    m = re.search(
        rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']+)["\']',
        html,
        re.I,
    ) or re.search(
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']',
        html,
        re.I,
    )
    return m.group(1) if m else None


def scrape(url: str, outdir: Path) -> ScrapeResult:
    resp = requests.get(url, headers=UA, timeout=30)
    resp.raise_for_status()
    html = resp.text

    text = trafilatura.extract(html, url=url, include_comments=False) or ""
    title = _meta(html, "og:title") or (re.search(r"<title>([^<]+)</title>", html, re.I) or [None, ""])[1]
    description = _meta(html, "og:description") or _meta(html, "description") or ""

    image_paths: list[Path] = []
    og_image = _meta(html, "og:image")
    if og_image:
        try:
            img_url = requests.compat.urljoin(url, og_image)
            r = requests.get(img_url, headers=UA, timeout=30)
            r.raise_for_status()
            p = outdir / "og_image.png"
            p.write_bytes(r.content)
            image_paths.append(p)
        except Exception:
            pass  # screenshots are optional; gradient fallback covers renders

    return ScrapeResult(url=url, title=title or url, description=description, text=text[:12000], image_paths=image_paths)
