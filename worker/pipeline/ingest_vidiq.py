"""Trend-library intake: parse vidIQ outlier-search dumps into candidates.

The curation workflow (CLAUDE.md pre-build checklist: 300–500 hand-tagged
templates) starts from real reference posts. vidIQ's Instagram/TikTok outlier
search returns, per post, a structured breakdown (concept, first-3-seconds
hook, format style, pacing, audio). This script turns those markdown dumps
into one JSONL of candidates, auto-tags each one with a rule-based first pass
(format, hook pattern, fit), and leaves the final say to a human editing the
JSONL — determinism-first: no model in this loop.

  python pipeline/ingest_vidiq.py dump1.json dump2.json ... --niche build-in-public \
      >> templates/candidates.jsonl

References are links + metadata only — never rehosted.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ENTRY = re.compile(r"^\*\*@(?P<handle>[^*]+?)\*\* — \"(?P<caption>.*?)\"\s*$", re.M)


def _load_text(path: Path) -> str:
    raw = path.read_text()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if isinstance(data, list):
        return "\n".join(b.get("text", "") for b in data if isinstance(b, dict))
    if isinstance(data, dict):
        return data.get("text", raw)
    return raw


def _field(block: str, key: str) -> str | None:
    m = re.search(rf"^\s*(?:\*\*)?{re.escape(key)}(?:\*\*)?:\s*(.+?)\s*$", block, re.M)
    return m.group(1).strip() if m else None


def _num(s: str | None) -> int | None:
    if not s:
        return None
    m = re.search(r"([\d.]+)\s*([KkMm]?)", s)
    if not m:
        return None
    v = float(m.group(1))
    return int(v * {"": 1, "k": 1_000, "m": 1_000_000}[m.group(2).lower()])


def parse_dump(text: str) -> list[dict]:
    out: list[dict] = []
    platform = "instagram"
    sections = re.split(r"^## (Instagram|TikTok)\s*$", text, flags=re.M)
    # sections: [pre, name, body, name, body, ...]
    for i in range(1, len(sections), 2):
        platform = sections[i].strip().lower()
        body = sections[i + 1]
        starts = [m for m in ENTRY.finditer(body)]
        for j, m in enumerate(starts):
            block = body[m.start(): starts[j + 1].start() if j + 1 < len(starts) else len(body)]
            stats = re.search(r"([\d.]+[KkMm]?) views \(([\d.]+)x their median of ([\d.]+[KkMm]?)\)\s*·\s*([\d.]+[KkMm]?) followers(?:\s*·\s*(\d+)s)?", block)
            url = re.search(r"https?://\S+", block)
            reel = re.search(r"reel:(\S+)", block)
            ref = url.group(0) if url else (f"https://www.instagram.com/reel/{reel.group(1)}/" if reel else None)
            concept = _field(block, "tiktok_concept") or _field(block, "reel_concept")
            hook_text = _field(block, "text")
            out.append({
                "platform": "tiktok" if platform == "tiktok" else "instagram",
                "handle": m.group("handle").strip(),
                "caption": m.group("caption").strip(),
                "refUrl": ref,
                "views": _num(stats.group(1)) if stats else None,
                "outlierX": float(stats.group(2)) if stats else None,
                "followers": _num(stats.group(4)) if stats else None,
                "durationSec": int(stats.group(5)) if stats and stats.group(5) else None,
                "concept": concept,
                "vidiqNiche": _field(block, "niche"),
                "hookText": hook_text,
                "hookVisual": _field(block, "visual"),
                "hookAudio": _field(block, "audio"),
                "formatStyle": _field(block, "style"),
                "formatTemplate": _field(block, "template"),
                "pacing": _field(block, "pacing"),
                "textOverlays": _field(block, "text_overlays"),
                "audioMix": _field(block, "audio_mix"),
            })
    return out


# ---- rule-based first-pass tagging (a human edits the JSONL afterwards) ----

FIT_POS = re.compile(r"\b(app|saas|startup|founder|indie|build(ing)? in public|side ?hustle|users?|signups?|mrr|revenue|launch|ship|vibe ?cod|ai tool|automat|workflow|productivity|to-?do|notes?|developer|coding|no-?code|product)\b", re.I)
FIT_NEG = re.compile(r"\b(roblox|fortnite|minecraft|dropship|forex|crypto|trading|real estate|makeup|skincare|recipe|supermarket|momo|clothing|fashion|gym|celebrit|billionaire|zuckerberg|musk|ambani)\b", re.I)

PATTERNS: list[tuple[str, re.Pattern]] = [
    ("pov", re.compile(r"\bpov\b", re.I)),
    ("day-n-buildlog", re.compile(r"\bday \d+\b|\bweek \d+\b|\bbuilding (from|in|my)\b", re.I)),
    ("confession-turn", re.compile(r"\b(i (was|had|made \$?0|failed|quit|thought)|then (one|i) (thing|changed)|until i|nobody (told|needs)|i (stopped|almost))\b", re.I)),
    ("bold-claim-receipts", re.compile(r"\$[\d,.]+[kKmM]?|\b\d+[kK]? (users|downloads|signups|customers)|\b(made|makes|hit) \$", re.I)),
    ("listicle", re.compile(r"\b(\d+|three|four|five|seven) (tools|things|apps|habits|lessons|mistakes|tips|reasons|ways)\b", re.I)),
    ("unpopular-opinion", re.compile(r"\b(hot take|unpopular|nobody (says|talks)|stop (doing|posting)|is (dead|a scam|overrated)|you don't need)\b", re.I)),
    ("wish-i-knew", re.compile(r"\b(wish i knew|i wish someone|before you|things i learned|lessons)\b", re.I)),
    ("curiosity-gap-reveal", re.compile(r"\b(the (secret|trick|reason)|this (one|is why)|nobody knows|hidden|what (happened|they don't))\b|\?$", re.I)),
    ("before-after", re.compile(r"\b(before|after|used to|now i|from .* to)\b", re.I)),
    ("tool-demo", re.compile(r"\b(how (i|to)|demo|watch (me|this)|here's how|tutorial|step)\b", re.I)),
]


def guess_format(c: dict) -> str:
    s = " ".join(filter(None, [c.get("formatStyle"), c.get("formatTemplate"), c.get("hookVisual"), c.get("textOverlays")])).lower()
    if re.search(r"slideshow|carousel|photo|static image|image sequence|swipe", s):
        return "slideshow"
    if re.search(r"talking head|face to camera|talks (directly )?to (the )?camera|creator speaks|selfie", s) and not re.search(r"screen recording|b-roll", s):
        return "avatar"
    if re.search(r"screen recording|b-roll|text overlay|montage|screen capture|no face|faceless", s):
        return "hook_video"
    return "hook_video"


def guess_pattern(c: dict) -> str:
    text = " ".join(filter(None, [c.get("hookText"), c.get("caption"), c.get("concept")]))
    for name, rx in PATTERNS:
        if rx.search(text):
            return name
    return "curiosity-gap-reveal"


def fit_score(c: dict) -> int:
    text = " ".join(filter(None, [c.get("caption"), c.get("concept"), c.get("hookText"), c.get("vidiqNiche")]))
    pos = len(FIT_POS.findall(text))
    neg = len(FIT_NEG.findall(text))
    return max(0, min(5, pos - 2 * neg))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dumps", nargs="+")
    ap.add_argument("--niche", required=True, help="library niche tag for this batch")
    ap.add_argument("--min-fit", type=int, default=1)
    args = ap.parse_args()
    seen: set[str] = set()
    n = 0
    for d in args.dumps:
        for c in parse_dump(_load_text(Path(d))):
            if not c["refUrl"] or c["refUrl"] in seen:
                continue
            seen.add(c["refUrl"])
            c["niche"] = args.niche
            c["fit"] = fit_score(c)
            c["format"] = guess_format(c)
            c["hookPattern"] = guess_pattern(c)
            c["approved"] = False  # flipped by hand after review
            if c["fit"] < args.min_fit:
                continue
            sys.stdout.write(json.dumps(c, ensure_ascii=False) + "\n")
            n += 1
    print(f"{n} candidates", file=sys.stderr)


if __name__ == "__main__":
    main()
