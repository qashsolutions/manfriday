"""LLM-based quality scorer — scores content 1-10 on four dimensions.

Uses the user's BYOK key (haiku/mini model for cost efficiency).
Runs AFTER pre-filter, ASYNC (never blocks ingest completion).

Dimensions:
  1. Signal density — information per word
  2. Relevance — to user's wiki domain
  3. Novelty — new info vs. what wiki already covers
  4. Credibility — source authority and citation quality
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from shared.python.manfriday_core.llm import LLMConfig, call


@dataclass
class QualityScore:
    overall: float
    signal_density: float
    relevance: float
    novelty: float
    credibility: float
    rationale: str


SCORING_PROMPT = """Score this content on four dimensions (1-10 each).
Return ONLY valid JSON with no additional text:

{
  "signal_density": <1-10>,
  "relevance": <1-10>,
  "novelty": <1-10>,
  "credibility": <1-10>,
  "rationale": "<one sentence>"
}

Definitions:
- signal_density: Information per word. Dense technical content scores high; filler-heavy content scores low.
- relevance: How relevant to the user's knowledge domain. On-topic scores high.
- novelty: Does this add new information vs what a well-read person already knows? Surprising findings score high.
- credibility: Source authority, citations, and factual accuracy indicators. Academic/primary sources score high.

Content to score:
"""

# Use cheapest model per provider for scoring
SCORER_MODELS = {
    "anthropic": "claude-haiku-4-5-20251001",
    "openai": "gpt-4o-mini",
    "gemini": "gemini-1.5-flash",
}


async def score_content(
    content_md: str,
    provider: str,
    user_id: str,
    max_content_chars: int = 3000,
) -> QualityScore:
    """Score content quality using LLM (cheapest model).

    Args:
        content_md: The markdown content to score
        provider: LLM provider (anthropic/openai/gemini)
        user_id: User ID for BYOK key lookup
        max_content_chars: Truncate content to save tokens
    """
    truncated = content_md[:max_content_chars]
    if len(content_md) > max_content_chars:
        truncated += "\n\n[... truncated for scoring]"

    config = LLMConfig(
        provider=provider,
        model=SCORER_MODELS.get(provider),
        temperature=0.1,
        max_tokens=200,
    )

    response = await call(
        messages=[{"role": "user", "content": SCORING_PROMPT + truncated}],
        config=config,
        user_id=user_id,
    )

    try:
        scores = json.loads(response.content)
    except json.JSONDecodeError:
        # Fallback: if LLM doesn't return valid JSON, give neutral score
        return QualityScore(
            overall=5.0,
            signal_density=5.0,
            relevance=5.0,
            novelty=5.0,
            credibility=5.0,
            rationale="Failed to parse LLM scoring response",
        )

    sd = float(scores.get("signal_density", 5))
    rel = float(scores.get("relevance", 5))
    nov = float(scores.get("novelty", 5))
    cred = float(scores.get("credibility", 5))
    overall = round((sd + rel + nov + cred) / 4, 1)

    return QualityScore(
        overall=overall,
        signal_density=sd,
        relevance=rel,
        novelty=nov,
        credibility=cred,
        rationale=scores.get("rationale", ""),
    )
