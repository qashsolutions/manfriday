"""Job → renderer routing: fetch brand assets, execute the plan, report cost."""
from __future__ import annotations

from pathlib import Path

import requests

import cvx
from .assets import BrandAssets
from .formats import render_avatar, render_hook, render_slideshow

# unit-economics.md: per-format final-render cost estimates (¢). Replaced by
# measured telemetry as it accumulates; previews are ~free.
FINAL_COST_CENTS = {"slideshow": 1, "hook_video": 6, "avatar": 55}


def _download_screenshots(ids: list[str], outdir: Path) -> list[Path]:
    paths = []
    for i, sid in enumerate(ids[:3]):
        url = cvx.query("pipeline:storageUrl", {"storageId": sid})
        if not url:
            continue
        p = outdir / f"shot_{i}.png"
        p.write_bytes(requests.get(url, timeout=60).content)
        paths.append(p)
    return paths


def render_job(job: dict, outdir: Path) -> dict:
    """Returns {video: Path|None, thumb: Path|None, costCents: int}."""
    template = job.get("template") or {}
    structure = template.get("structure") or {}
    fmt = template.get("format")
    concept = job["concept"]
    brand_info = job.get("brand") or {}
    preview = job["kind"] == "preview"

    brand = BrandAssets(
        name=brand_info.get("name", "Your product"),
        screenshots=_download_screenshots(brand_info.get("screenshotIds", []), outdir),
    )
    values = concept.get("slots") or {}
    language = concept.get("language", "en")

    if fmt == "slideshow":
        result = render_slideshow(structure, values, brand, outdir, preview)
    elif fmt == "hook_video":
        result = render_hook(structure, values, brand, language, outdir, preview)
    elif fmt == "avatar":
        result = render_avatar(structure, values, brand, language, outdir, preview)
    else:
        raise RuntimeError(f"unknown format {fmt!r} (dev-stub template?)")

    cost = 0 if preview else FINAL_COST_CENTS.get(fmt, 0)
    return {"video": result.get("video"), "thumb": result.get("thumb"), "costCents": cost}
