# ManFriday Wiki — Agent Schema (CLAUDE.md)

## What you are

You are the wiki maintainer for this personal knowledge base. Your job is to read, synthesize, and maintain a structured, interlinked wiki of markdown files on behalf of the user. You do the bookkeeping. The user does the thinking.

This file is your constitution. Read it at the start of every session before doing anything else.

## The three layers

```
raw/          ← source documents. IMMUTABLE. Never modify.
wiki/         ← your output. You own this entirely. The user reads; you write.
CLAUDE.md     ← this file. Your operating instructions. Co-evolved with the user.
```

## Wiki structure

```
wiki/
  index.md          ← content catalog: ALL wiki pages with one-line summary + link
  log.md            ← chronological operations log (append-only)
  backlinks.md      ← bidirectional [[wikilink]] adjacency map
  lint_queue.md     ← article candidates you've suggested
  memory/
    episodes.jsonl  ← Q&A session history
    playbooks/      ← learned user preferences
  entities/         ← one page per entity (person, org, project, event)
    {entity}.md
  concepts/         ← one page per concept or topic
    {concept}.md
  articles/         ← source-derived summaries and analyses
    {slug}.md
  outputs/          ← filed Q&A outputs (filed back as wiki pages)
    {timestamp}.md
```

## Page frontmatter

Every wiki page you create MUST have YAML frontmatter:

```yaml
---
type: entity | concept | article | output | index | log
title: Human-readable title
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: [slug1, slug2]        # raw/ items this page draws from
tags: [tag1, tag2]
source_count: 3                # how many raw/ items this page incorporates
---
```

## index.md structure

index.md is a content catalog of ALL wiki pages — not just raw/ items. Update it on every ingest and every time you create or significantly update a page.

```markdown
# Wiki Index
Last updated: YYYY-MM-DD | Pages: N | Sources: N

## Entities
- [[entity-name]] — one-line description

## Concepts  
- [[concept-name]] — one-line description

## Articles (source summaries)
- [[article-slug]] — one-line description | source: {url}

## Outputs (filed Q&A results)
- [[output-slug]] — one-line description | query date: YYYY-MM-DD
```

## log.md format

log.md is chronological and append-only. Never edit past entries.

```markdown
## [YYYY-MM-DD] ingest | {source title}
Pages updated: [[page1]], [[page2]], [[page3]]
New pages created: [[new-page]]
Key takeaways: one sentence

## [YYYY-MM-DD] query | {question summary}
Output: [[output-slug]] | Filed: yes/no

## [YYYY-MM-DD] lint | health check
Issues found: N | Fixed: N | Queued: N new articles
```

## Ingest workflow

When the user adds a new source:

1. Read the source document fully
2. Discuss key takeaways with user (1-3 exchanges)
3. Create or update the article summary page in wiki/articles/
4. Update or create relevant entity pages in wiki/entities/
5. Update or create relevant concept pages in wiki/concepts/
6. Update index.md with any new pages
7. Update backlinks.md
8. Append entry to log.md
9. Note contradictions with existing wiki content explicitly

A single ingest typically touches 5-15 wiki pages. This is correct and expected.

## Query workflow

When the user asks a question:

1. Read index.md to identify relevant pages
2. Read those pages in full
3. Check log.md for recent context on this topic
4. Synthesize answer with [[wikilink]] citations
5. Ask: "Should I file this as a wiki page?" — if yes, create in wiki/outputs/ and update index.md + log.md

## Lint workflow

When asked to lint the wiki:

Check for and fix:
- **Contradictions**: claims in one page that conflict with another
- **Stale claims**: claims superseded by newer ingested sources
- **Orphan pages**: pages with no inbound [[wikilinks]] from other pages
- **Missing entity pages**: entities mentioned across multiple pages but lacking their own page
- **Missing concept pages**: concepts mentioned repeatedly but not given a dedicated page
- **Missing cross-references**: obvious links that should exist but don't
- **Data gaps**: claims that could be verified or enriched via web search

After linting: append entry to log.md and add article candidates to lint_queue.md.

## Linking conventions

- Use [[wikilink]] syntax for all internal links
- Link to entity pages when mentioning a person, organization, or project
- Link to concept pages when introducing a key term
- Every page should have at least 2 inbound links (if orphaned, update other pages to link to it)

## Quality rules

- Never modify raw/ — it is immutable source of truth
- Always cite which raw/ source a claim comes from using [[article-slug]]
- When new source contradicts existing wiki content, flag explicitly: > **Contradiction**: ...
- Keep page titles consistent across all references (use the same [[wikilink]] spelling everywhere)
- index.md and log.md must be updated on every ingest, query-with-filing, and lint pass

## Session start checklist

At the start of every session:
1. Read CLAUDE.md (this file)
2. Read wiki/index.md
3. Read last 5 entries of wiki/log.md
4. You are now oriented. Confirm to user: "Wiki has N pages, N sources. Last activity: [date + action]."

## Build status

Phase I + Phase II + Phase III are **COMPLETE** as of 2026-04-06. 80 Python + 39 Web TS + 6 Mobile TS files, zero compile errors, fully spec-aligned.

### Spec audit findings (2026-04-06)

Final exhaustive audit against `build_prompt.md` + `skills_and_agents.md` — 7 gaps found and fixed:

| Gap | Spec Requirement | Resolution |
|-----|-----------------|------------|
| Interactive ingest | Agent 1 step 2: "DISCUSS with user before writing" | Added `interactive` flag to `compile_wiki` — when True, returns takeaways for user approval before writing |
| Tool name wrappers | Spec defines `read_raw()`, `read_wiki()`, `write_wiki()` as named tools | Added wrapper functions in `api/tools/registry.py` matching spec names |
| Playbook learning | Agent 4: "Detect patterns → update playbook" | Added `playbook_writer.py` — analyzes last 30 episodes for answer_format, detail_level, topics patterns → writes `playbooks/*.md` |
| Active threads | Agent 4: "Recompute active_threads from last 30 episodes" post-Q&A | Added auto-recomputation in Q&A completion path, updates memory.md |
| Async quality scoring | Non-negotiable #7: "never blocks ingest completion" | Changed to `asyncio.create_task()` fire-and-forget; manifest updated in background |
| API endpoint paths | Spec: `/suppressed`, `/validate-key` at root | Hoisted 3 endpoints from `/sources/*` to root via `api/main.py` |
| Supabase auth emulator | docker-compose: "Supabase (auth emulator)" | Replaced bare Postgres with GoTrue auth service (issues JWTs for local dev) |

### E2E verification (2026-04-06)

| Check | Result |
|-------|--------|
| Python compile (80 files) | All clean, zero errors |
| TypeScript compile (39 Web + 6 Mobile TS) | All clean, zero errors |
| Next.js static export (23 routes → 21 HTML pages) | Build successful |
| GitHub Pages deployment | Live at `qashsolutions.github.io/manfriday` |
| Vercel deployment | Live at `manfriday.app` |
| Wiki home (stat cards, articles) | Renders with mock data |
| Article view (wikilinks, backlinks, tags) | Renders correctly |
| Q&A chat (SSE input, ToolTrace, OutputTypeSelector) | UI functional |
| Sources (add form, quality badges) | UI functional |
| Settings (BYOK, ProviderSelector) | UI functional |
| Auth flow (signup, callback, setup) | Pages render |
| All 10 non-negotiables enforced in code | Verified |

### Deployment

| Environment | Branch | Domain | Status |
|-------------|--------|--------|--------|
| Production | `main` | `manfriday.app` | Live (Vercel) |
| Staging | `staging` | `staging.manfriday.app` | Live (Vercel) |
| Dev | `claude/review-codebase-uxz9o` | `dev.manfriday.app` | Live (Vercel) |
| Demo | `main` | `qashsolutions.github.io/manfriday` | Live (GitHub Pages) |

Domain config:
- `manfriday.app` → Production (apex, primary)
- `www.manfriday.app` → 308 permanent redirect to `manfriday.app`
- DNS hosted on Hostinger, pointing to Vercel
- SSL auto-provisioned by Vercel

### Production infrastructure

| Service | Provider | Status |
|---------|----------|--------|
| Web UI | Vercel (Next.js) | Live at `manfriday.app` |
| API | GCP Cloud Run | Live at `manfriday-api-142863638278.us-east1.run.app` |
| Storage | GCS bucket `manfriday-kb` | Provisioned (us-east1) |
| Auth | Supabase (Qash Solutions Inc org) | Provisioned (us-east1) |
| Secrets | GCP Secret Manager | Enabled |
| DNS | Hostinger → Vercel | Configured |

### What's built

| Layer | Status | Files |
|-------|--------|-------|
| `shared/python/manfriday_core/` | Done | `gcs.py`, `secrets.py`, `llm.py` (Anthropic + OpenAI + Gemini) |
| `workers/ingest/` | Done | 5 fetchers, 5 connector stubs, quality scoring, image co-locator, manifest, schema generator |
| `workers/compile/` | Done | article/entity/concept writers, index/log/backlinks/schema writers, write guard, lint queue, output ingester |
| `workers/lint/` | Done | 8-check health system, Brave Search, imputer, output filing worker |
| `api/` | Done | FastAPI gateway, 20 endpoints, JWT auth, BM25 search, Q&A tool-use loop with SSE |
| `web/` | Done | Next.js 14 + Tailwind, 15 components, 15 pages (5 auth + 10 app) |
| `infra/terraform/` | Done | GCS, 4 service accounts, IAM conditions, Cloud Run, Cloud Scheduler |
| GitHub Pages demo | Done | Static export with mock data, GitHub Actions workflow |

### Phase II — built 2026-04-06

| Layer | Status | Files |
|-------|--------|-------|
| `workers/ingest/connectors/` | Done | Gmail, Drive, Telegram, WhatsApp, arXiv (full implementations), OAuth helper |
| `api/routers/connectors.py` | Done | connect, disconnect, connected-accounts, poll endpoints |
| `api/routers/billing.py` | Done | Stripe checkout, portal, subscription status |
| `api/routers/stripe.py` | Done | Full webhook handlers (subscription lifecycle + payment) |
| `api/middleware/entitlement.py` | Done | Paid tier gating (arxiv, pgvector, priority_support) |
| `web/` (Phase II) | Done | ConnectedAccountCard, SearchModeSelector, billing page, connected accounts page |

### Phase III — built 2026-04-06

| Layer | Status | Files |
|-------|--------|-------|
| `workers/compile/embed_writer.py` | Done | Embedding pipeline (OpenAI/Google/Anthropic), batch migration |
| `shared/python/manfriday_core/pgvector.py` | Done | pgvector client (asyncpg), store/search/delete embeddings |
| `api/routers/search.py` | Done | Hybrid search: BM25 + semantic + hybrid mode selector |
| `infra/terraform/pgvector.tf` | Done | Cloud SQL with pgvector, VPC connector, IAM |
| `workers/compile/graph_builder.py` | Done | LLM-based entity relationship extraction |
| `workers/compile/graph_schema.py` | Done | GraphEntity, GraphRelationship, WikiGraph dataclasses |
| `api/routers/graph.py` | Done | GET /graph, /graph/entity/{name}, /graph/neighbors/{name} |
| `workers/finetune/` | Done | LoRA trigger (500+ articles), training data prep, job submission, model registry |
| `mobile/` | Done | Expo app: tabs (home, Q&A), share sheet, push notifications, offline sync, API client |

### Current deployment status (2026-04-07)

| Component | Status |
|-----------|--------|
| Web UI (Vercel) | Live at `manfriday.app` — landing page, dark/light mode, auth |
| API (Cloud Run) | Live at `manfriday-api-142863638278.us-east1.run.app` |
| Supabase Auth | Configured — email signup (8+ chars, upper/lower/digit/symbol), Google OAuth |
| Google OAuth | Configured — Client ID + Secret in Supabase + GCP, redirect URIs set |
| Gmail/Drive scopes | Configured — gmail.readonly + drive.readonly in GCP Data Access |
| GCS Storage | Bucket `manfriday-kb` provisioned (us-east1) |
| DNS/Domains | manfriday.app (prod), staging.manfriday.app, dev.manfriday.app, www→308 redirect |
| Env vars (Vercel) | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL |
| Env vars (Cloud Run) | GCS_BUCKET, ENV, GCP_PROJECT, SUPABASE_JWT_SECRET, GOOGLE_OAUTH_CLIENT_ID/SECRET |

### Free (BYOK) user flow

1. Sign up (email or Google OAuth)
2. Add their own API key (Anthropic/OpenAI/Gemini) in Settings — masked, secured, never visible again
3. Start using: add URLs, PDFs, RSS → wiki builds → Q&A works
4. Optionally connect Gmail/Drive (click Connect → Google OAuth → read-only access)
5. Optionally connect Telegram (create bot via @BotFather → paste token)
6. ManFriday reads all connected sources and builds the wiki automatically

### API key security (implemented 2026-04-07)

| Layer | Implementation |
|-------|---------------|
| Encrypted in transit | HTTPS/TLS enforced on Vercel + Cloud Run |
| Encrypted at rest | GCP Secret Manager (AES-256) |
| Never displayed | `mask_key()` — first 8 + **** + last 4 chars |
| Never returned by API | GET endpoints return `masked_key` only |
| Never logged | `KeyRedactingFilter` strips key patterns from all logs |
| Rate limited | 5 validate-key calls/min/user (HTTP 429) |
| CSP headers | Prevents XSS key theft (`X-Frame-Options: DENY`) |
| Cleared from browser | React state cleared immediately after save |
| User informed | Security notice panel on Settings page |

### Known issues / TODO

- Google OAuth consent shows "continue to supabase.co" instead of manfriday.app (Supabase handles OAuth flow — need to move to direct OAuth on backend to fix)
- E2E integration tests with real BYOK API keys
- Stripe keys not yet configured (billing is code-complete but not wired)
- Brave Search API key not yet configured (lint worker gap-filling)
- Load testing (10+ concurrent users)
- App Store submission (iOS/Android)

## Related documents

This file is the agent constitution — one of several specification documents in this repo:

- **build_prompt.md** — Claude Code build prompt: mono-repo structure, Phase I weekly build plan, non-negotiables, local dev setup, and full API/worker/web specifications
- **memory.md** — Cross-session persistent state template (wiki stats, active threads, playbook, episode history)
- **skills_and_agents.md** — Four agents (Ingest, Query, Lint, Memory), six skills, GCS paths, and build order

The `.docx` files contain the formal specifications:
- `manfriday_brd_rtm_v2.docx` — Master BRD (52 requirements)
- `manfriday_brd_addendum_v2_1.docx` / `v2_2.docx` — Addenda (REQ-053 through REQ-056)
- `manfriday_tech_arch_v1_2.docx` / `_addendum_v1_2_1.docx` — Technical architecture
- `manfriday_file_structure_v1_2.docx` / `_addendum_v1_2_1.docx` — File structure
- `manfriday_claude_md_spec.docx` — CLAUDE.md specification
- `manfriday_skills_agents.docx` — Skills and agents spec
- `manfriday_adr_001.docx` — ADR: Five-layer memory + BM25 search
- `manfriday_adr_002.docx` — ADR: Source quality scoring
- `manfriday_wireframes.html` — Interactive UI wireframes

## How this file evolves

When you and the user discover a better workflow, update this file. This is a living document. Treat it as the source of truth for how this wiki operates.
