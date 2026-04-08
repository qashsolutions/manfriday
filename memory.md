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

## Build state (updated 2026-04-07)

```yaml
phase: I + II + III
phase_status: ALL PHASES COMPLETE
phase_ii_completed: 2026-04-06
phase_iii_completed: 2026-04-06
last_build_session: 2026-04-06
total_python_files: 80
total_typescript_files_web: 39
total_typescript_files_mobile: 6
compile_status: clean (zero errors, both Python and TypeScript)
branches:
  dev: claude/review-codebase-uxz9o
  staging: staging
  prod: main
domains:
  prod: https://manfriday.app
  staging: https://staging.manfriday.app
  dev: https://dev.manfriday.app
  demo: https://qashsolutions.github.io/manfriday/
hosting: Vercel (Next.js, auto-deploy on push)
api: GCP Cloud Run (manfriday-api-142863638278.us-east1.run.app)
storage: GCS bucket manfriday-kb (us-east1)
auth: Supabase (Qash Solutions Inc, us-east1)
secrets: GCP Secret Manager (enabled)
dns: Hostinger → Vercel (A record + CNAMEs)
www_redirect: 308 permanent → manfriday.app
gcp_project_id: manfriday
gcp_project_number: 142863638278

deployment_status:
  web_ui: live (manfriday.app via Vercel)
  api: live (Cloud Run manfriday-api-142863638278.us-east1.run.app)
  supabase_auth: configured (email + Google OAuth)
  google_oauth: configured (client ID/secret in Supabase + GCP)
  gmail_drive_scopes: configured (gmail.readonly + drive.readonly)
  gmail_oauth: working (same-window redirect, PKCE S256, 5-min state tokens, Secret Manager storage)
  gmail_status: connected and tested (green dot, disconnect, poll now)
  cloud_run_sa_permissions: secretmanager.admin granted to default compute SA
  gcs_storage: provisioned (manfriday-kb, us-east1)
  cloud_run_env_vars: GCS_BUCKET, ENV, GCP_PROJECT, SUPABASE_JWT_SECRET, GOOGLE_OAUTH_*
  vercel_env_vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL
  password_policy: 8+ chars, lowercase + uppercase + digit + symbol (matches Supabase)
  landing_page: live (hero, BYOK, features, connectors, RAG comparison)
  dark_light_mode: live (toggle in user dropdown, localStorage persisted)
  api_key_security:
    encrypted_transit: HTTPS/TLS (Vercel + Cloud Run)
    encrypted_rest: GCP Secret Manager (AES-256)
    never_displayed: mask_key() first 8 + **** + last 4
    never_returned: API returns masked_key only
    never_logged: KeyRedactingFilter strips patterns
    rate_limited: 5 validate-key/min/user (429)
    csp_headers: X-Frame-Options DENY, nosniff, CSP
    browser_cleared: React state cleared after save
    user_informed: security notice panel on Settings page
  nav_structure: Wiki | Q&A (Chat, Outputs, Memory) | Sources (All Sources, Knowledge Graph)
  settings_page: merged — API key (auto-detect provider) + Gmail/Drive/Telegram + arXiv topics
  whatsapp: code built but hidden from free users (requires Meta Business App, paid tier only)
  api_key_auto_detect: sk-ant- → Anthropic, sk- → OpenAI, AIza → Gemini
  graph: child of Sources, force-directed SVG, measures container width, animated edge dots

known_issues:
  - google_oauth_consent_shows_supabase_domain (need direct OAuth on backend to fix)
  - stripe_keys_not_configured (billing code-complete but not wired)
  - brave_search_key_not_configured (lint worker gap-filling)
  - e2e_tests_with_real_byok_keys_pending

e2e_verification:
  python_compile: pass (80 files)
  typescript_compile: pass (39 web + 6 mobile)
  vercel_deploy: pass (manfriday.app live)
  cloud_run_deploy: pass (API live, revision 5)
  supabase_auth: pass (email signup works)
  google_oauth: pass (flow works, consent shows supabase domain)
  landing_page: pass (renders in dark + light mode)
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

completed_phase_iii:
  - pgvector semantic search       # embed_writer + hybrid search + Cloud SQL terraform
  - world model graph              # graph_builder + graph_schema + graph API
  - LoRA fine-tune pipeline        # trigger + training data + job submission + model registry
  - mobile app (Expo)              # tabs, share sheet, push notifications, offline sync

pending_layers: []  # All phases complete
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
