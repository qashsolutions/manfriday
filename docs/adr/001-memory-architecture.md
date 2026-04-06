---
status: accepted
date: 2026-04-06
source: manfriday_adr_001.docx
---

# ADR-001: Five-Layer Memory Architecture + BM25 Search

## Context

ManFriday needs a memory system for agents to retain context across sessions, and a search mechanism for the Q&A agent to find relevant wiki pages.

## Decision

- **Phase I**: Use BM25 search (rank-bm25 library) over wiki markdown files
- **Phase II**: Upgrade to pgvector when users exceed 200 articles
- **Memory**: Five layers — CLAUDE.md (constitution), memory.md (cross-session state), episodes.jsonl (Q&A history), playbooks/ (learned preferences), wiki/ (compiled knowledge)
- **Episode logging**: Primary Phase I addition (~50 lines of code impact)

## Rationale

Avoid premature optimization. BM25 is sufficient for small-to-medium wikis and requires zero infrastructure beyond GCS. pgvector adds operational complexity (managed Postgres, embedding pipeline) that isn't justified until wikis grow large.

## Consequences

- Simple deployment in Phase I (GCS only)
- Memory.md enables cross-session continuity without a database
- Migration path to pgvector is clean (add embedding column, swap search implementation)
