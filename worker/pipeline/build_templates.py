"""Trend-library builder: approved candidates → template JSON + library.json.

Each approved candidate (templates/curation/candidates.jsonl, `approved: true`)
becomes one template: a base structure for its (format, hookPattern) with the
reference's own hook and concept folded into the slot guidance, so the
slot-fill call writes in the *shape* of a post that already won. References
stay links + metadata (refUrl, views, engagementScore) — never rehosted.

  python pipeline/build_templates.py            # writes templates/lib/*.json + library.json entries
  python pipeline/build_templates.py --dry-run  # counts only

Determinism-first: no model here. Lint with validation/template-spec/lint.py,
seed with seed_library.py.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

TDIR = Path(__file__).resolve().parent.parent / "templates"
CAND = TDIR / "curation" / "candidates.jsonl"
OUT = TDIR / "lib"
LIB = TDIR / "library.json"

# ---- base structures -------------------------------------------------------
# Hook-pattern guidance is the creative constraint; format decides the render plan.

PATTERN_GUIDE = {
    "confession-turn": "an honest admission of a slow start or a mistake, then the one change that turned it — specific numbers, no hype",
    "bold-claim-receipts": "a bold, numeric claim up front (revenue, users, days) that the body backs with receipts",
    "pov": "POV: opener that puts the viewer inside the after-state of using the product",
    "listicle": "a numbered list (3–5 items) of tools/habits/mistakes; item three carries the product",
    "unpopular-opinion": "a hot take that contradicts common advice in the niche, then the reasoning",
    "wish-i-knew": "'what I wish I knew before X' — lessons, framed to the viewer's near future",
    "curiosity-gap-reveal": "a curiosity gap opened in the first line and paid off near the end",
    "before-after": "a before/after contrast — the old way vs the way it works now",
    "day-n-buildlog": "a build-log beat: 'Day N' or 'Week N', one concrete thing shipped, one number",
    "tool-demo": "show, don't tell — the product doing the thing, narrated in plain steps",
}

# The ten launch hook patterns map onto three render plans (Friday Internals, templateSpec v1.1).

def slideshow_structure(slug: str, pattern: str, niches: list[str], ref: dict) -> dict:
    guide = PATTERN_GUIDE[pattern]
    return {
        "specVersion": 1,
        "slug": slug,
        "format": "slideshow",
        "hookPattern": pattern,
        "niches": niches,
        "platforms": ["tiktok"],
        "reference": {"hook": ref.get("hookText"), "concept": ref.get("concept")},
        "slots": [
            {"id": "hook", "type": "text", "maxChars": 90, "guidance": f"slide 1 — {guide}. Reference hook shape: \"{(ref.get('hookText') or '').strip()[:80]}\""},
            {"id": "slide_2", "type": "text", "maxChars": 110, "guidance": "the setup: the situation before, one concrete detail"},
            {"id": "slide_3", "type": "text", "maxChars": 110, "guidance": "the turn or the first item: what changed / the first point"},
            {"id": "slide_4", "type": "text", "maxChars": 110, "guidance": "the proof: a number, a moment, a screenshot-worthy fact"},
            {"id": "slide_5", "type": "text", "maxChars": 110, "guidance": "the lesson in one line — quotable"},
            {"id": "cta", "type": "text", "maxChars": 60, "guidance": "closing slide naming the product, soft ask"},
            {"id": "caption", "type": "text", "maxChars": 150, "use": "publish", "guidance": "restate the hook, add exactly 2 niche hashtags"},
        ],
        "renderPlan": {
            "kind": "slideshow",
            "slides": [
                {"bg": {"kind": "gradient", "styleToken": "brand-dark-1"}, "text": {"slotRef": "hook", "styleToken": "hook-xl", "position": "center"}},
                {"bg": {"kind": "brand_screenshot", "pick": "product"}, "text": {"slotRef": "slide_2", "styleToken": "body-lg", "position": "center"}},
                {"bg": {"kind": "gradient", "styleToken": "brand-dark-2"}, "text": {"slotRef": "slide_3", "styleToken": "body-lg", "position": "center"}},
                {"bg": {"kind": "brand_screenshot", "pick": "hero"}, "text": {"slotRef": "slide_4", "styleToken": "body-lg", "position": "center"}},
                {"bg": {"kind": "gradient", "styleToken": "brand-dark-1"}, "text": {"slotRef": "slide_5", "styleToken": "hook-lg", "position": "center"}},
                {"bg": {"kind": "gradient", "styleToken": "brand-dark-2"}, "text": {"slotRef": "cta", "styleToken": "cta-md", "position": "center"}},
            ],
            "music": {"mood": "lofi-calm", "source": "licensed_library"},
        },
    }


def hook_video_structure(slug: str, pattern: str, niches: list[str], ref: dict) -> dict:
    guide = PATTERN_GUIDE[pattern]
    return {
        "specVersion": 1,
        "slug": slug,
        "format": "hook_video",
        "hookPattern": pattern,
        "niches": niches,
        "platforms": ["tiktok", "youtube"],
        "reference": {"hook": ref.get("hookText"), "concept": ref.get("concept")},
        "slots": [
            {"id": "hook_text", "type": "text", "maxChars": 80, "guidance": f"on-screen opener — {guide}. Reference hook shape: \"{(ref.get('hookText') or '').strip()[:80]}\""},
            {"id": "vo_script", "type": "script", "targetSeconds": 20, "guidance": "voiceover in the creator's own words: the story or the steps, one concrete number, product mentioned once near the end; present tense, no ad-speak"},
            {"id": "cta", "type": "text", "maxChars": 40, "guidance": "closing card naming the product"},
            {"id": "caption", "type": "text", "maxChars": 150, "use": "publish", "guidance": "the hook restated, exactly 2 niche hashtags"},
        ],
        "renderPlan": {
            "kind": "hook_video",
            "durationCapSeconds": 30,
            "music": {"mood": "lofi-build", "source": "licensed_library"},
            "voice": {"slotRef": "vo_script", "tts": "brand_default"},
            "captions": {"from": "vo_script", "styleToken": "caption-md", "position": "center-low"},
            "shots": [
                {"holdSeconds": 2.5, "bg": {"kind": "gradient", "styleToken": "brand-dark-2"}, "text": {"slotRef": "hook_text", "styleToken": "hook-xl", "position": "center"}},
                {"flex": True, "bg": {"kind": "brand_screenshot", "pick": "product"}},
                {"holdSeconds": 2.5, "bg": {"kind": "gradient", "styleToken": "brand-dark-1"}, "text": {"slotRef": "cta", "styleToken": "cta-md", "position": "center"}},
            ],
        },
    }


def avatar_structure(slug: str, pattern: str, niches: list[str], ref: dict) -> dict:
    guide = PATTERN_GUIDE[pattern]
    return {
        "specVersion": 1,
        "slug": slug,
        "format": "avatar",
        "hookPattern": pattern,
        "niches": niches,
        "platforms": ["tiktok", "youtube"],
        "reference": {"hook": ref.get("hookText"), "concept": ref.get("concept")},
        "slots": [
            {"id": "hook_overlay", "type": "text", "maxChars": 70, "guidance": f"overlay for the first 3 seconds — {guide}. Reference hook shape: \"{(ref.get('hookText') or '').strip()[:80]}\""},
            {"id": "vo_script", "type": "script", "targetSeconds": 24, "guidance": "spoken to camera, first person, conversational; make the point, give one example with a number, land the product once"},
            {"id": "cta", "type": "text", "maxChars": 40, "guidance": "end card naming the product"},
            {"id": "caption", "type": "text", "maxChars": 150, "use": "publish", "guidance": "the hook restated, exactly 2 niche hashtags"},
        ],
        "renderPlan": {
            "kind": "avatar",
            "durationCapSeconds": 35,
            "character": {"pick": "brand_default"},
            "speech": {"slotRef": "vo_script", "tts": "brand_default", "lipsync": "lazy_on_right_swipe"},
            "captions": {"from": "vo_script", "styleToken": "caption-md", "position": "center-low"},
            "overlay": {"slotRef": "hook_overlay", "styleToken": "label-sm", "position": "upper-third", "showSeconds": 3.5},
            "endCard": {"holdSeconds": 2.5, "bg": {"kind": "gradient", "styleToken": "brand-dark-2"}, "text": {"slotRef": "cta", "styleToken": "cta-md", "position": "center"}},
        },
    }


BUILDERS = {"slideshow": slideshow_structure, "hook_video": hook_video_structure, "avatar": avatar_structure}


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48]


def engagement_score(c: dict) -> int:
    """0–100 from views and outlier ratio — the matcher's ranking signal."""
    import math
    v = math.log10(max(c.get("views") or 1, 1))  # 5 → 100K, 6 → 1M
    x = math.log10(max(c.get("outlierX") or 1, 1))  # 1 → 10x
    raw = 40 + (v - 5) * 20 + min(x, 2) * 10
    return int(max(30, min(98, raw)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    cands = [json.loads(l) for l in CAND.read_text().splitlines() if l.strip()]
    approved = [c for c in cands if c.get("approved")]
    lib = json.loads(LIB.read_text()) if LIB.exists() else {}
    OUT.mkdir(exist_ok=True)
    made = 0
    used: set[str] = set()
    for c in approved:
        fmt, pattern = c["format"], c["hookPattern"]
        if fmt not in BUILDERS or pattern not in PATTERN_GUIDE:
            continue
        base = f"{pattern}-{fmt.replace('_', '-')}-{slugify(c['handle'])}"
        slug, n = base, 2
        while slug in used:
            slug, n = f"{base}-{n}", n + 1
        used.add(slug)
        niches = c.get("niches") or [c.get("niche", "build-in-public")]
        structure = BUILDERS[fmt](slug, pattern, niches, c)
        lib[slug] = {
            "refUrl": c["refUrl"],
            "platform": c["platform"] if c["platform"] in ("tiktok", "youtube") else "tiktok",
            "views": c.get("views") or 0,
            "engagementScore": engagement_score(c),
            "refHandle": c["handle"],
            "refCapturedAt": "2026-09-11",
        }
        if not args.dry_run:
            (OUT / f"{slug}.json").write_text(json.dumps(structure, ensure_ascii=False, indent=2) + "\n")
        made += 1
    if not args.dry_run:
        LIB.write_text(json.dumps(lib, ensure_ascii=False, indent=2) + "\n")
    print(f"{made} templates from {len(approved)} approved candidates ({len(cands)} total)")


if __name__ == "__main__":
    main()
