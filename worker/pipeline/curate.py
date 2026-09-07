"""Trend-reference ingestion — the curation workflow's intake tool.

Source chain (user decision, 7 Sep 2026): page-fetch is the baseline and always
works; vidIQ becomes an optional enrichment provider at launch (stats history,
transcripts) when credits/licensing are in place. References are links +
metadata only — never rehosted.

  python pipeline/curate.py <url> [--slug existing-template-slug] [--views N]

With --slug: attaches the reference to that template in library.json.
Without:    records it under "_unassigned" for template authoring later.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

LIB = Path(__file__).resolve().parent.parent / "templates" / "library.json"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}


def fetch_meta(url: str) -> dict:
    platform = "youtube" if ("youtube.com" in url or "youtu.be" in url) else "tiktok" if "tiktok.com" in url else "unknown"
    meta = {"url": url, "platform": platform, "title": None, "views": None}
    try:
        html = requests.get(url, headers=UA, timeout=30).text
    except Exception as exc:
        print(f"  fetch failed ({exc}); record views manually with --views")
        return meta

    m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html)
    if m:
        meta["title"] = m.group(1)

    # views: platform page-embedded JSON (best effort — layouts drift)
    patterns = [
        r'"viewCount"\s*:\s*"(\d+)"',                        # YouTube ytInitialData
        r'"viewCount":\{"simpleText":"([\d,.]+)',            # YouTube variant
        r'itemprop="interactionCount"\s+content="(\d+)"',    # YouTube watch meta
        r'"playCount"\s*:\s*(\d+)',                          # TikTok SIGI state
    ]
    for pat in patterns:
        m = re.search(pat, html)
        if m:
            meta["views"] = int(re.sub(r"[^\d]", "", m.group(1)))
            break
    return meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--slug", help="attach to this existing template slug")
    ap.add_argument("--views", type=int, help="manual view count override")
    ap.add_argument("--score", type=int, default=85, help="engagement score 0-100")
    args = ap.parse_args()

    meta = fetch_meta(args.url)
    if args.views:
        meta["views"] = args.views
    print(f"  platform={meta['platform']} views={meta['views']} title={meta['title']!r}")
    if meta["views"] is None:
        raise SystemExit("  could not extract views — re-run with --views N")

    lib = json.loads(LIB.read_text())
    entry = {
        "refUrl": meta["url"],
        "platform": meta["platform"],
        "views": meta["views"],
        "engagementScore": args.score,
    }
    if args.slug:
        if args.slug not in lib:
            raise SystemExit(f"  unknown slug {args.slug!r}")
        lib[args.slug].update(entry)
        print(f"✔ attached to template '{args.slug}'")
    else:
        lib.setdefault("_unassigned", []).append({**entry, "title": meta["title"]})
        print("✔ recorded under _unassigned — author a template from it next")
    LIB.write_text(json.dumps(lib, indent=2) + "\n")
    print("  reseed with: python seed_library.py")


if __name__ == "__main__":
    main()
