#!/usr/bin/env python3
"""Template lint — authoring-time rules from Friday Internals, templateSpec v1.

Rules (verbatim from the spec):
  1. every slotRef resolves to a declared slot
  2. declared slots are all referenced
  3. slideshow slide count 4-8
  4. video plans total <= 60s
  5. platforms consistent with format (a slideshow declaring youtube is a lint error)

Plus structural checks the spec implies:
  - specVersion known to this worker (only 1)
  - text slots carry maxChars, script slots carry targetSeconds
  - renderPlan.kind matches format
  - backgrounds only brand_screenshot | gradient | stock(query)

Concept lint (generation-time analogue, run by hand here since slot values
were hand-filled, not model-filled):
  - every declared slot has a value; maxChars enforced; no extra values
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent
KNOWN_SPEC_VERSIONS = {1}
KNOWN_BG_KINDS = {"brand_screenshot", "gradient", "stock"}
VIDEO_FORMATS = {"hook_video", "avatar"}


def collect_slot_refs(node, refs):
    """Walk the renderPlan tree collecting every slot reference."""
    if isinstance(node, dict):
        if "slotRef" in node:
            refs.append(node["slotRef"])
        if "from" in node:  # captions: { from: <script slot> }
            refs.append(node["from"])
        for v in node.values():
            collect_slot_refs(v, refs)
    elif isinstance(node, list):
        for v in node:
            collect_slot_refs(v, refs)


def collect_bgs(node, bgs):
    if isinstance(node, dict):
        if "bg" in node and isinstance(node["bg"], dict):
            bgs.append(node["bg"])
        for v in node.values():
            collect_bgs(v, bgs)
    elif isinstance(node, list):
        for v in node:
            collect_bgs(v, bgs)


def planned_duration(tpl):
    """Deterministic upper bound for a video plan's duration.

    Timing model (proposed for spec v1.1 — v1 leaves it undefined):
    fixed holds (holdSeconds) + the voice track (bounded by the script
    slot's targetSeconds) absorbed by the single flex shot, capped by
    renderPlan.durationCapSeconds.
    """
    plan = tpl["renderPlan"]
    script_secs = sum(s.get("targetSeconds", 0) for s in tpl["slots"] if s["type"] == "script")
    fixed = 0.0
    if plan["kind"] == "hook_video":
        fixed = sum(s.get("holdSeconds", 0) for s in plan.get("shots", []))
    elif plan["kind"] == "avatar":
        fixed = plan.get("endCard", {}).get("holdSeconds", 0)
    return fixed + script_secs


def lint_template(path):
    errors, warnings = [], []
    tpl = json.loads(path.read_text())
    name = tpl.get("slug", path.name)

    if tpl.get("specVersion") not in KNOWN_SPEC_VERSIONS:
        errors.append(f"specVersion {tpl.get('specVersion')} unknown to this worker")

    fmt = tpl.get("format")
    plan = tpl.get("renderPlan", {})
    slots = {s["id"]: s for s in tpl.get("slots", [])}

    # slot field rules
    for sid, s in slots.items():
        if s["type"] == "text" and "maxChars" not in s:
            errors.append(f"text slot '{sid}' missing maxChars")
        if s["type"] == "script" and "targetSeconds" not in s:
            errors.append(f"script slot '{sid}' missing targetSeconds")
        if not s.get("guidance"):
            errors.append(f"slot '{sid}' missing guidance")

    # rule 1 + 2: slotRef resolution both ways.
    # v1.1 amendment (found by validation): slots carry use: render|publish
    # (default render). Rule 2 applies to render slots only — publish slots
    # (caption) are consumed by the publish layer and must NOT appear in the
    # renderPlan. Spec v1 as written failed its own worked example here.
    refs = []
    collect_slot_refs(plan, refs)
    for r in refs:
        if r not in slots:
            errors.append(f"slotRef '{r}' does not resolve to a declared slot")
    for sid, s in slots.items():
        use = s.get("use", "render")
        if use == "render" and sid not in refs:
            errors.append(f"declared render slot '{sid}' is never referenced by the renderPlan")
        if use == "publish" and sid in refs:
            errors.append(f"publish slot '{sid}' must not be referenced by the renderPlan")

    # rule 3: slideshow slide count
    if fmt == "slideshow":
        n = len(plan.get("slides", []))
        if not 4 <= n <= 8:
            errors.append(f"slideshow has {n} slides; lint requires 4-8")

    # rule 4: video duration
    if fmt in VIDEO_FORMATS:
        dur = planned_duration(tpl)
        if dur > 60:
            errors.append(f"video plan totals {dur:.1f}s; lint caps at 60s")
        cap = plan.get("durationCapSeconds")
        if cap and dur > cap:
            warnings.append(f"planned {dur:.1f}s exceeds own durationCapSeconds {cap}")
        flex = [s for s in plan.get("shots", []) if s.get("flex")]
        if plan["kind"] == "hook_video" and len(flex) != 1:
            errors.append(f"hook_video needs exactly 1 flex shot, found {len(flex)}")

    # rule 5: platform-format consistency
    platforms = tpl.get("platforms", [])
    if fmt == "slideshow" and platforms != ["tiktok"]:
        errors.append(f"slideshow platforms must be ['tiktok'], got {platforms}")
    if fmt in VIDEO_FORMATS and "tiktok" not in platforms:
        errors.append(f"{fmt} must include tiktok, got {platforms}")

    # structural: kind matches format, bg kinds legal
    if plan.get("kind") != fmt:
        errors.append(f"renderPlan.kind '{plan.get('kind')}' != format '{fmt}'")
    bgs = []
    collect_bgs(plan, bgs)
    for bg in bgs:
        if bg.get("kind") not in KNOWN_BG_KINDS:
            errors.append(f"illegal bg kind '{bg.get('kind')}'")
        if bg.get("kind") == "stock" and not bg.get("query"):
            errors.append("stock bg missing query")

    return name, errors, warnings


def lint_concept(path, templates):
    errors = []
    c = json.loads(path.read_text())
    tpl = templates.get(c["template"])
    if tpl is None:
        return path.name, [f"unknown template '{c['template']}'"]
    slots = {s["id"]: s for s in tpl["slots"]}
    values = c["slotValues"]
    for sid, s in slots.items():
        if sid not in values:
            errors.append(f"slot '{sid}' has no value")
        elif s["type"] == "text" and len(values[sid]) > s["maxChars"]:
            errors.append(f"slot '{sid}' is {len(values[sid])} chars, maxChars {s['maxChars']}")
    for sid in values:
        if sid not in slots:
            errors.append(f"value for undeclared slot '{sid}'")
    return path.name, errors


def main():
    templates = {}
    failed = False
    print("== template lint ==")
    for p in sorted((ROOT / "templates").glob("*.json")):
        name, errors, warnings = lint_template(p)
        tpl = json.loads(p.read_text())
        templates[tpl["slug"]] = tpl
        status = "FAIL" if errors else "ok"
        failed |= bool(errors)
        print(f"[{status}] {name}")
        for e in errors:
            print(f"       error: {e}")
        for w in warnings:
            print(f"       warn:  {w}")

    print("== concept lint ==")
    for p in sorted((ROOT / "concepts").glob("*.json")):
        name, errors = lint_concept(p, templates)
        status = "FAIL" if errors else "ok"
        failed |= bool(errors)
        print(f"[{status}] {name}")
        for e in errors:
            print(f"       error: {e}")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
