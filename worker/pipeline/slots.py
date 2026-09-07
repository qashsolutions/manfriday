"""Claude call site 2 — creative slot-fill.

One batched Claude Opus call fills every concept in the batch (user directive:
Opus, never Haiku). Structured outputs; maxChars enforced with one retry per
failing concept, then the concept is dropped (never silently truncated) —
templateSpec v1.1 generation-time rules.
"""
from __future__ import annotations

import json
from typing import Dict, List

import anthropic
from pydantic import BaseModel, Field

MODEL = "claude-opus-5"

LANGUAGE_NAMES = {
    "en": "English", "es": "Spanish", "pt-BR": "Brazilian Portuguese", "id": "Indonesian",
    "hi": "Hindi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu", "mr": "Marathi",
    "kn": "Kannada", "ml": "Malayalam", "gu": "Gujarati", "pa": "Punjabi", "or": "Odia",
}


class ConceptFill(BaseModel):
    concept_index: int = Field(description="index of the concept being filled, from the request")
    slots: Dict[str, str] = Field(description="slot id -> text, every listed slot filled")


class BatchFill(BaseModel):
    concepts: List[ConceptFill]


def _slot_spec_lines(structure: dict) -> str:
    lines = []
    for s in structure.get("slots", []):
        limit = f"max {s['maxChars']} characters" if "maxChars" in s else f"spoken script, about {s.get('targetSeconds', 20)} seconds (~{int(s.get('targetSeconds', 20) * 2.6)} words)"
        lines.append(f"  - {s['id']} ({limit}): {s.get('guidance', '')}")
    return "\n".join(lines)


def _prompt(brief: dict, language: str, batch: list[tuple[dict, int]]) -> str:
    lang = LANGUAGE_NAMES.get(language, "English")
    parts = [
        f"Brand brief:\n{json.dumps(brief, indent=2)}\n",
        f"Write ALL slot text in {lang}. Hashtags may stay in English where that is the platform norm.",
        "Fill the creative slots for each concept below. Every concept must feel like a distinct post — different angle, different specifics — never a rephrase of another. Follow each slot's guidance and character limits exactly. Concrete beats generic; write like a real creator in this niche, not like an ad.",
        "",
    ]
    for i, (template, variant) in enumerate(batch):
        st = template["structure"]
        parts.append(
            f"Concept {i} — template '{template['slug']}' ({template['format']}, hook pattern: {template['hookPattern']})"
            + (f", creative angle #{variant + 2} (must differ clearly from earlier concepts using this template)" if variant else "")
        )
        parts.append(_slot_spec_lines(st))
        parts.append("")
    return "\n".join(parts)


def _violations(fill: ConceptFill, structure: dict) -> list[str]:
    problems = []
    slots = {s["id"]: s for s in structure.get("slots", [])}
    for sid, spec in slots.items():
        val = fill.slots.get(sid)
        if not val:
            problems.append(f"missing slot '{sid}'")
        elif "maxChars" in spec and len(val) > spec["maxChars"]:
            problems.append(f"slot '{sid}' is {len(val)} chars (max {spec['maxChars']})")
    return problems


def fill_batch(brief: dict, language: str, batch: list[tuple[dict, int]]) -> tuple[list[dict | None], int]:
    """Returns (slot dicts aligned with batch — None = dropped, cost_cents)."""
    client = anthropic.Anthropic()
    system = (
        "You are Friday, a short-form content engine's creative writer. You fill "
        "text slots inside fixed video templates. You write scroll-stopping, "
        "specific, honest copy grounded in the brand brief. You respect every "
        "character limit exactly."
    )

    def call(prompt: str) -> tuple[BatchFill, int]:
        response = client.messages.parse(
            model=MODEL,
            max_tokens=8000,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": prompt}],
            output_format=BatchFill,
        )
        u = response.usage
        cents = int(round((u.input_tokens * 5 + u.output_tokens * 25) / 1_000_000 * 100))
        return response.parsed_output, cents

    result, cost = call(_prompt(brief, language, batch))
    by_index = {f.concept_index: f for f in result.concepts}

    out: list[dict | None] = []
    retry: list[int] = []
    for i, (template, _v) in enumerate(batch):
        fill = by_index.get(i)
        problems = _violations(fill, template["structure"]) if fill else ["no fill returned"]
        if problems:
            retry.append(i)
            out.append(None)
        else:
            out.append(fill.slots)

    if retry:
        retry_batch = [batch[i] for i in retry]
        prompt = (
            "Your previous fills violated limits; rewrite ONLY these concepts, shorter and within every limit:\n\n"
            + _prompt(brief, language, retry_batch)
        )
        result2, cost2 = call(prompt)
        cost += cost2
        by_index2 = {f.concept_index: f for f in result2.concepts}
        for pos, orig_i in enumerate(retry):
            fill = by_index2.get(pos)
            if fill and not _violations(fill, batch[orig_i][0]["structure"]):
                out[orig_i] = fill.slots
            # still failing -> stays None: dropped from the batch, never truncated

    return out, max(cost, 1)
