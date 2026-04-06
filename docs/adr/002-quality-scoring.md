---
status: accepted
date: 2026-04-06
source: manfriday_adr_002.docx
---

# ADR-002: Source Quality Scoring

## Context

Without quality filtering, low-quality sources (spam emails, short RSS items, empty pages) would pollute the wiki. "Garbage in, garbage out."

## Decision

- **Two-stage filtering**: deterministic pre-filter THEN LLM-based scorer
- **Pre-filter**: fast, zero-cost rules per source type (word count minimums, age limits, header checks)
- **LLM scorer**: uses cheapest model per provider (Haiku/GPT-4o-mini/Flash), scores 1-10 on four dimensions
- **Dimensions**: signal density, relevance, novelty, credibility
- **Suppression**: items below quality threshold are flagged, never deleted — user can restore via UI

## Rationale

Pre-filter saves tokens by catching obvious junk before LLM call. Four-dimension scoring gives nuanced quality assessment. Never deleting ensures user can override false positives.

## Consequences

- Minimal token cost per source (haiku-class model, ~200 output tokens)
- User-configurable quality threshold (default: 4)
- Suppressed items visible in dedicated UI screen
