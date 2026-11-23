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


# --- phone-width page captures (review of 23 Nov 2026) ----------------------
# The share image (og:image) is a landscape card; shrunk into a 9:16 frame it
# filled a quarter of the screen and nobody could read it. A phone-width capture
# of the real site, cut into screen-sized sections, fills the frame instead.

SHOT_W, SHOT_H = 1080, 1920
PHONE_VIEWPORT = {"width": 390, "height": 693}  # 390 × 693 CSS px × (1080/390) = 1080 × 1920
MAX_SECTIONS = 4


def slice_page(img, max_sections: int = MAX_SECTIONS) -> list:
    """Cut a full-page phone capture (any height, 1080 wide after scaling) into
    1080×1920 sections, top first, skipping sections that are nearly blank."""
    from PIL import Image, ImageStat

    if img.width != SHOT_W:
        img = img.resize((SHOT_W, max(1, round(img.height * SHOT_W / img.width))))
    out = []
    top = 0
    while top < img.height and len(out) < max_sections:
        section = img.crop((0, top, SHOT_W, top + SHOT_H))
        if top + SHOT_H > img.height:
            # Last, short section: pad with the page's own bottom colour.
            canvas = Image.new("RGB", (SHOT_W, SHOT_H), img.convert("RGB").getpixel((SHOT_W // 2, img.height - 1)))
            canvas.paste(img.crop((0, top, SHOT_W, img.height)), (0, 0))
            section = canvas
            if img.height - top < SHOT_H // 3:
                break  # a sliver of footer isn't worth a screen
        if max(ImageStat.Stat(section.convert("L")).stddev) > 8:  # not a blank band
            out.append(section.convert("RGB"))
        top += SHOT_H
    return out


def capture_page_shots(url: str, outdir: Path) -> list[Path]:
    """Phone-width screenshots of the site, as 1080×1920 PNG sections. Optional:
    without a browser available this returns [] and renders use the share image."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return []
    from PIL import Image

    full = outdir / "page_full.png"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--disable-dev-shm-usage"])
            try:
                page = browser.new_page(
                    viewport=PHONE_VIEWPORT,
                    device_scale_factor=SHOT_W / PHONE_VIEWPORT["width"],
                    is_mobile=True,
                    has_touch=True,
                    user_agent=(
                        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
                        "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 ManFridayBot/0.1"
                    ),
                )
                page.goto(url, wait_until="load", timeout=30_000)
                page.wait_for_timeout(1500)  # late fonts, hero animations
                # Cap the height before capturing: some pages are endless.
                page.set_viewport_size({"width": PHONE_VIEWPORT["width"], "height": PHONE_VIEWPORT["height"]})
                page.screenshot(
                    path=str(full),
                    full_page=True,
                    clip={"x": 0, "y": 0, "width": PHONE_VIEWPORT["width"], "height": PHONE_VIEWPORT["height"] * MAX_SECTIONS},
                )
            finally:
                browser.close()
    except Exception as exc:  # a site that blocks bots or times out: fall back quietly
        print(f"page capture skipped for {url}: {exc}")
        return []
    paths = []
    for i, section in enumerate(slice_page(Image.open(full))):
        p = outdir / f"page_{i}.png"
        section.save(p)
        paths.append(p)
    return paths
