# ManFriday — Persistent Memory File

> This file is read by ManFriday at the start of every session.
> It captures durable facts about this user's wiki, preferences, and history
> that the agent needs to operate intelligently across sessions.
>
> See also: [CLAUDE.md](CLAUDE.md) (agent constitution), [build_prompt.md](build_prompt.md) (build plan + mono-repo spec), [skills_and_agents.md](skills_and_agents.md) (agent/skill definitions)

---

## Identity

```yaml
user_id: {user_id}
wiki_created: YYYY-MM-DD
provider: anthropic | openai | gemini
model: claude-sonnet-4-20250514
wiki_name: "{user's name for their wiki}"
```

---

## Build state (updated 2026-04-06)

```yaml
phase: I
phase_status: code-complete
last_build_session: 2026-04-06
total_python_files: 67
total_typescript_files: 22
compile_status: clean (zero errors)
branch: claude/review-codebase-uxz9o

completed_layers:
  - shared/python/manfriday_core  # gcs.py, secrets.py, llm.py
  - workers/ingest                # 5 fetchers, quality scoring, manifest, schema gen
  - workers/compile               # article/entity/concept/index/log/backlinks writers
  - workers/lint                  # 8-check health, web search, imputer, episodes
  - api                           # FastAPI, 20 endpoints, JWT auth, BM25 search, SSE Q&A
  - web                           # Next.js 14, 15 pages, 15 components
  - infra/terraform               # GCS, SAs, IAM, Cloud Run, Scheduler

pending_layers:
  - connectors (gmail, gdrive, telegram, whatsapp, arxiv)  # Phase II
  - pgvector semantic search                                 # Phase II
  - mobile app (Expo)                                        # Phase II
  - Stripe billing logic                                     # Phase II
  - world model graph                                        # Phase III
  - LoRA fine-tune pipeline                                  # Phase III
```

---

## Wiki state (updated by compile worker after each cycle)

```yaml
last_compile: YYYY-MM-DD HH:MM UTC
last_lint: YYYY-MM-DD
last_ingest: YYYY-MM-DD
total_raw_items: 0
total_wiki_pages: 0
total_entities: 0
total_concepts: 0
total_articles: 0
total_outputs_filed: 0
total_qa_sessions: 0
```

---

## Active research threads

Topics the user has been exploring recently, derived from episodes.jsonl.
Updated by lint worker after each cycle.

```yaml
active_threads: []
```

---

## User playbook (learned preferences)

Discovered from episode patterns. Updated by lint worker.

```yaml
playbook:
  answer_format: "bullet points with citations"   # how user prefers answers
  citation_style: "[[wikilink]] inline"           # how user wants citations
  ingest_style: "conversational"                  # conversational vs batch
  detail_level: "deep"                            # shallow | medium | deep
  output_types: ["md", "marp"]                    # preferred output formats
  filing_preference: "always"                     # always | ask | never
```

---

## Session continuity (from episodes.jsonl)

Last 3 Q&A sessions — for context at session start:

```yaml
recent_episodes: []
```

---

## Lint queue status

Article candidates suggested by lint worker, pending compile:

```yaml
lint_queue: []
```

---

## Connected sources

```yaml
connected_sources:
  rss:
    - url: "https://simonwillison.net/atom/everything"
      last_polled: YYYY-MM-DD
      items_compiled: 0
  gmail:
    connected: false
    scope: "read-only"
  google_drive:
    connected: false
  telegram:
    connected: false
  whatsapp:
    connected: false
```

---

## Quality settings

```yaml
quality_threshold: 4        # suppress sources below this score
lint_enabled: true
episode_logging: true
nightly_lint: true
```

---

## Notes from user

Free-form notes the user wants the agent to remember across sessions.
Updated by user directly in Settings.

```
{user notes}
```

---

*This file is maintained by ManFriday workers. Last updated: 2026-04-06 by build session.*
*Do not edit manually — changes will be overwritten on next compile cycle.*
