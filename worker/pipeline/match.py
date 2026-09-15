"""Trend matching — rule-based tag scoring. No embeddings (determinism-first)."""
from __future__ import annotations


def score(template: dict, niche: str) -> float:
    overlap = 1.0 if niche in template.get("niches", []) else 0.0
    return template.get("engagementScore", 0) * (1.0 + overlap)


def plan_batch(templates: list[dict], niche: str, count: int, allow_avatar: bool = True) -> list[tuple[dict, int]]:
    """Pick (template, variant_index) pairs, guaranteeing all three formats
    appear, weighted toward slideshows (cheap) per the format mix.
    allow_avatar=False (no presenter photo on the brand, D2 amended 14 Sep 2026)
    hands the avatar share to hook videos."""
    by_format: dict[str, list[dict]] = {"slideshow": [], "hook_video": [], "avatar": []}
    for t in sorted(templates, key=lambda t: -score(t, niche)):
        if isinstance(t.get("structure"), dict) and t["structure"].get("slots"):
            by_format.setdefault(t["format"], []).append(t)

    mix = {"slideshow": 0.4, "hook_video": 0.3, "avatar": 0.3} if allow_avatar else {"slideshow": 0.5, "hook_video": 0.5, "avatar": 0.0}
    quota = {f: (max(1, round(count * w)) if w > 0 else 0) for f, w in mix.items()}
    while sum(quota.values()) > count:
        quota["slideshow"] -= 1

    picked: list[tuple[dict, int]] = []
    for fmt, n in quota.items():
        pool = by_format.get(fmt, [])
        if not pool:
            continue
        for i in range(n):
            template = pool[i % len(pool)]
            variant = i // len(pool)
            picked.append((template, variant))
    return picked[:count]
