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

## Spec audit (2026-04-06)

```yaml
audit_date: 2026-04-06
audited_against: build_prompt.md + skills_and_agents.md
gaps_found: 7
gaps_fixed: 7
phase_I_status: COMPLETE — fully spec-aligned
details:
  - gap: interactive ingest mode (Agent 1 step 2)
    status: fixed — added interactive flag to compile_wiki
  - gap: tool name wrappers (read_raw, read_wiki, write_wiki)
    status: fixed — wrapper functions in api/tools/registry.py
  - gap: playbook learning (Agent 4 post-compile)
    status: fixed — playbook_writer.py analyzes episode patterns
  - gap: active_threads recomputation (Agent 4 post-Q&A)
    status: fixed — auto-recompute after Q&A, updates memory.md
```

---

## Build state (updated 2026-04-06)

```yaml
phase: I
phase_status: COMPLETE (spec-aligned, deployed, all audits pass)
last_build_session: 2026-04-06
total_python_files: 72
total_typescript_files: 37
compile_status: clean (zero errors, both Python and TypeScript)
branch: claude/review-codebase-uxz9o (merged to main)
demo_url: https://qashsolutions.github.io/manfriday/

e2e_verification:
  python_compile: pass (67 files)
  typescript_compile: pass (35 files)
  nextjs_static_export: pass (23 routes, 21 HTML pages)
  github_pages_deploy: pass (live)
  wiki_home: pass (stat cards + articles render)
  article_view: pass (wikilinks + backlinks + tags)
  qa_chat: pass (SSE input + ToolTrace + OutputTypeSelector)
  sources_page: pass (add form + quality badges)
  settings_page: pass (BYOK + ProviderSelector)
  auth_flow: pass (signup, callback, setup pages render)
  non_negotiables: pass (all 10 enforced in code)

completed_layers:
  - shared/python/manfriday_core  # gcs.py, secrets.py, llm.py
  - workers/ingest                # 5 fetchers, quality scoring, manifest, schema gen
  - workers/compile               # article/entity/concept/index/log/backlinks writers
  - workers/lint                  # 8-check health, web search, imputer, episodes
  - api                           # FastAPI, 20 endpoints, JWT auth, BM25 search, SSE Q&A
  - web                           # Next.js 14, 15 pages, 15 components
  - infra/terraform               # GCS, SAs, IAM, Cloud Run, Scheduler
  - github_pages                  # static demo with mock data, GitHub Actions CI

completed_phase_ii:
  - connectors/gmail.py     # OAuth + Gmail API polling + text extraction
  - connectors/gdrive.py    # OAuth + Drive API (Docs/PDF/Sheets)
  - connectors/telegram.py  # Bot API + getUpdates polling
  - connectors/whatsapp.py  # Business Cloud API
  - connectors/arxiv.py     # API query by categories (paid tier)
  - connectors/oauth.py     # Shared Google OAuth helper
  - api/routers/connectors  # connect, disconnect, connected-accounts, poll
  - api/routers/billing     # Stripe checkout, portal, subscription
  - api/routers/stripe      # Full webhook handlers
  - api/middleware/entitlement  # Paid tier gating
  - web: ConnectedAccountCard, SearchModeSelector, billing page, connected page

pending_layers:
  - pgvector semantic search     # Phase III (trigger: 200+ articles)
  - mobile app (Expo)            # Phase III
  - world model graph            # Phase III
  - LoRA fine-tune pipeline      # Phase III (trigger: 500+ articles)
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
