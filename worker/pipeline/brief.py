"""Claude call site 1 — brand brief synthesis.

One Claude Opus call per URL, cached forever (briefVersion pins it); the user
edits the result in onboarding (M2). Everything upstream/downstream is
deterministic.
"""
from __future__ import annotations

from typing import List

import anthropic
from pydantic import BaseModel, Field

from .scrape import ScrapeResult

MODEL = "claude-opus-5"

LANGUAGE_CODES = ["en", "es", "pt-BR", "id", "hi", "bn", "ta", "te", "mr", "kn", "ml", "gu", "pa", "or"]


class Brief(BaseModel):
    name: str = Field(description="Product name, short")
    one_liner: str = Field(description="What it does, one plain sentence, no hype")
    audience: List[str] = Field(description="2-4 audience segments, short phrases")
    tone: List[str] = Field(description="2-3 tone words for the brand voice")
    niche: str = Field(description="one short-form content niche slug, kebab-case, e.g. build-in-public, productivity-tools, fitness, ecommerce")
    language: str = Field(description=f"primary content language code, one of {LANGUAGE_CODES}")


def synthesize_brief(scraped: ScrapeResult) -> tuple[Brief, int]:
    """Returns (brief, cost_cents_estimate)."""
    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=MODEL,
        max_tokens=2000,
        system=(
            "You write brand briefs for a short-form video engine. Read the site "
            "content and produce a precise, unhyped brief. The niche must be a "
            "short-form content niche where this product's buyers actually scroll. "
            "Choose the language the product's PRIMARY audience consumes content in."
        ),
        messages=[
            {
                "role": "user",
                "content": (
                    f"URL: {scraped.url}\nTitle: {scraped.title}\n"
                    f"Description: {scraped.description}\n\nSite text:\n{scraped.text}"
                ),
            }
        ],
        output_format=Brief,
    )
    brief = response.parsed_output
    usage = response.usage
    cost_cents = int(round((usage.input_tokens * 5 + usage.output_tokens * 25) / 1_000_000 * 100))
    if brief.language not in LANGUAGE_CODES:
        brief.language = "en"
    return brief, max(cost_cents, 1)
