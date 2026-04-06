# ManFriday — Claude Code Build Prompt

> **ALL PHASES COMPLETE** (2026-04-06). 80 Python + 45 TypeScript files, zero errors. Phase I (core KB), Phase II (connectors, billing), Phase III (pgvector, graph, LoRA, mobile) — all implemented.

## Context for Claude Code

You are building ManFriday (manfriday.app) — a personal LLM knowledge base and agent platform. Before writing a single line of code, read this entire prompt. Then confirm your understanding of the architecture before starting.

---

## What ManFriday is

ManFriday is NOT a RAG system. It is a persistent, compounding wiki maintained by LLM agents on behalf of the user.

The key insight (Andrej Karpathy): instead of retrieving from raw documents at query time, the LLM incrementally builds and maintains a structured, interlinked wiki of markdown files. Knowledge is compiled once and kept current — not re-derived on every query. The wiki gets richer with every source added and every question asked.

There are THREE layers:
- `raw/` — immutable source documents. LLM reads, never modifies.
- `wiki/` — LLM-generated markdown files. LLM writes and maintains exclusively.
- `CLAUDE.md` — agent schema/constitution. Tells the LLM how to operate.

---

## Reference documents

All architecture decisions are documented. Read these files before planning:

```
CLAUDE.md                          # Agent constitution — read this first
memory.md                          # Cross-session state template
skills_and_agents.md               # Four agents, six skills, build order
```

Key facts from the documents:

**Stack**: Python (FastAPI, Cloud Run, workers) + Expo (React Native Web + iOS/Android) + Next.js + GCS + Supabase Auth + GCP Secret Manager

**Free user model (BYOK)**: User brings their own API key — Anthropic, OpenAI, or Gemini. ManFriday's infra cost per free user: ~$0.10-0.20/month. Zero LLM cost to ManFriday.

**54 requirements** across BRD v2.2 (56 after addenda). Phase I is the core KB engine for BYOK free users.

---

## Mono-repo structure

```
manfriday/
├── api/                    # FastAPI gateway (Cloud Run Service)
├── workers/
│   ├── ingest/             # Fetch + quality score sources
│   ├── compile/            # LLM writes wiki pages
│   ├── lint/               # Nightly health checks
│   └── sandbox/            # E2B Python execution
├── web/                    # Expo web (Next.js)
├── mobile/                 # Expo iOS/Android
├── shared/
│   └── python/manfriday_core/   # Shared: gcs.py, secrets.py, llm.py
├── infra/terraform/        # All GCP resources as code
├── docs/adr/               # Architecture Decision Records
├── docker-compose.yml      # Local dev
└── Makefile
```

---

## GCS storage schema

```
gs://manfriday-kb/{user_id}/
  CLAUDE.md                 # Agent constitution (third layer)
  memory.md                 # Cross-session persistent state
  raw/
    manifest.json           # {slug, url, type, ingested_at, quality_score, suppressed}
    {slug}.md               # Clean markdown per source
    {slug}/images/          # Co-located images (relative paths in .md)
    uploads/{uuid}.pdf      # Uploaded PDF binaries
    outputs/{ts}_q.md       # Filed Q&A outputs (re-ingested by compile)
  wiki/
    index.md                # Catalog of ALL wiki pages (entities+concepts+articles+outputs)
    log.md                  # Append-only operations log
    backlinks.md            # Bidirectional [[wikilink]] adjacency
    lint_queue.md           # Article candidates from lint agent
    memory/
      episodes.jsonl        # Q&A session history
      playbooks/            # Learned user preferences
    entities/               # One page per entity (person, org, project, event)
    concepts/               # One page per concept or topic
    articles/               # Source-derived summaries
    outputs/                # Filed Q&A results
  outputs/
    {ts}.md                 # Q&A text/Marp outputs
    images/{ts}.png         # matplotlib outputs
  config/
    sources.json
    preferences.json        # llm_provider, llm_model, quality_threshold, etc.
```

---

## Phase I build — what to build

### Week 1: Ingest pipeline

**workers/ingest/**

```python
# Fetchers (each returns clean markdown string):
fetchers/jina.py         # URL → Jina Reader API → .md
fetchers/rss.py          # RSS feed → parse items → enqueue each as URL
fetchers/github.py       # GitHub repo → README + file tree + key files → .md
                         # Also capture: repo_name, language, stars, description
fetchers/pdf.py          # PDF binary (from GCS uploads/) → PyMuPDF → .md
fetchers/dataset.py      # CSV/JSON → pandas profiling summary → .md
fetchers/base.py         # FetcherBase abstract class

# Connectors (Phase II stubs — implement interface only):
connectors/base.py       # ConnectorBase abstract class
connectors/gmail.py      # STUB
connectors/gdrive.py     # STUB
connectors/telegram.py   # STUB
connectors/whatsapp.py   # STUB
connectors/arxiv.py      # STUB (paid tier)

# Quality scoring:
quality/pre_filter.py    # Deterministic rules per source type:
                         # Gmail: suppress if List-Unsubscribe + no star/label
                         # RSS: suppress if <200 words or >30 days old
                         # Telegram: suppress if <20 words and no URL
                         # URLs: suppress if Jina returns <300 words
quality/scorer.py        # LLM call (user BYOK, haiku model) → score 1-10
                         # Four dimensions: signal density, relevance, novelty, credibility

# Support:
image_colocator.py       # Download images → {slug}/images/ → rewrite .md paths
manifest.py              # Append to raw/manifest.json
generate_schema.py       # Generate personalized CLAUDE.md for new user
                         # Takes: wiki_name, domain, ingest_style, provider
                         # Returns: full CLAUDE.md content tailored to domain
```

**API endpoint**: `POST /ingest`
- Accepts JSON `{url, source_type}` OR multipart/form-data for PDF upload
- Validates auth (Supabase JWT)
- Enqueues Cloud Tasks job
- For PDF: write binary to GCS `uploads/{uuid}.pdf` first

**Key behaviours**:
- Every fetcher returns `{slug, content_md, metadata}`
- Images co-located: `raw/{user_id}/{slug}/images/` with relative paths in .md
- Quality pre-filter runs BEFORE LLM scorer (saves tokens)
- Suppressed items get `quality_suppressed: true` in manifest — never deleted
- GitHub detection: if URL matches `^https?://github\.com/[\w.-]+/[\w.-]+`, use github.py fetcher

---

### Week 2: Compile worker

**workers/compile/**

```python
main.py              # Cloud Run Job entrypoint
                     # 1. Read manifest.json — find new/changed items
                     # 2. Read CLAUDE.md + wiki/index.md for context
                     # 3. For each new item: run compile pipeline
                     # 4. Process lint_queue.md
                     # 5. Re-ingest raw/outputs/ items

index_writer.py      # For each new raw/ item:
                     # LLM generates 1-paragraph summary
                     # Appends to wiki/index.md under correct category
                     # index.md covers: entities + concepts + articles + outputs

article_writer.py    # LLM reads raw/{slug}.md → writes wiki/articles/{slug}.md
                     # YAML frontmatter: type, title, created, updated, sources, tags, source_count
                     # Uses [[wikilinks]] throughout
                     # Cites raw/ source for every claim

entity_writer.py     # NEW — extract entities from new source
                     # For each entity mentioned (person/org/project/event):
                     #   If wiki/entities/{entity}.md exists: UPDATE it
                     #   Else: CREATE wiki/entities/{entity}.md
                     # Entity page includes: description, first_seen, sources[], appearances[]
                     # Frontmatter: type: entity

concept_writer.py    # Same pattern as entity_writer but for wiki/concepts/
                     # Concept page: definition, related_concepts[], sources[], examples[]

log_writer.py        # NEW — append to wiki/log.md after each ingest:
                     # ## [{date}] ingest | {source title}
                     # Pages updated: [[...]]
                     # New pages created: [[...]]
                     # Key takeaways: one sentence

backlinks.py         # Scan all wiki/**/*.md for [[wikilinks]]
                     # Build bidirectional adjacency map
                     # Regenerate wiki/backlinks.md in full

write_guard.py       # Validate all writes target wiki/ prefix only
                     # Raise exception if anything attempts to write to raw/

lint_queue.py        # Read wiki/lint_queue.md
                     # For each pending candidate: generate article
                     # Clear processed entries

output_ingester.py   # Read raw/outputs/ tagged files
                     # Re-ingest as first-class compile inputs
                     # Creates/enriches wiki/ articles from Q&A history

schema_writer.py     # NEW — update memory.md after each compile:
                     # wiki_state counts (total pages, entities, concepts, etc.)
                     # last_compile timestamp
```

**Critical**: compile worker is the ONLY service account with write access to `wiki/` GCS prefix. Enforced via IAM Conditions.

**LLM routing**: all LLM calls go through `shared/python/manfriday_core/llm.py` which reads `config/preferences.json` for provider + model and routes to correct SDK.

**Supported providers**:
```python
# shared/python/manfriday_core/llm.py
PROVIDERS = {
    "anthropic": {"sdk": "anthropic", "default_model": "claude-sonnet-4-20250514"},
    "openai":    {"sdk": "openai",    "default_model": "gpt-4o"},
    "gemini":    {"sdk": "google.generativeai", "default_model": "gemini-1.5-pro"},
}
```

---

### Week 3: FastAPI gateway

**api/**

All endpoints require Supabase JWT unless marked public.

```
POST /ingest                    # Enqueue ingest job
POST /compile                   # Trigger compile job (internal)
POST /qa                        # Stream Q&A via SSE
GET  /qa/history                # Recent Q&A from episodes.jsonl
GET  /search?q=&n=              # BM25 search over wiki/
GET  /wiki/{path}               # Read wiki/ .md file
GET  /outputs                   # List outputs/ gallery
POST /file-back                 # Tag + copy output to raw/outputs/
GET  /sources                   # List sources
POST /sources                   # Add source
DELETE /sources/{id}            # Remove source
GET  /suppressed                # List quality-suppressed items
POST /suppressed/{id}/restore   # Restore suppressed to compile queue
POST /validate-key              # Validate Anthropic/OpenAI/Gemini key
GET  /memory/episodes           # Paginated episode log
GET  /memory/topics             # Aggregated active topic summary
GET  /schema                    # Read CLAUDE.md
PUT  /schema                    # Update CLAUDE.md
GET  /health                    # Cloud Run health check (public)
POST /webhook/stripe            # Stripe subscription events
```

**Tool registry** (for Q&A agent tool-use loop):
```python
# api/tools/registry.py — register all tools
TOOLS = [
    search_wiki_tool,    # BM25 search, returns [{path, title, summary, score}]
    read_article_tool,   # Read full wiki page content
    execute_python_tool, # E2B sandbox — matplotlib/pandas
    file_output_tool,    # Tag + file output back to wiki
]
```

**Q&A agent streaming** (`POST /qa`):
- SSE (Server-Sent Events) — first token within 200ms
- Tool-use loop: max 10 turns
- Each tool call streamed as a ToolTrace event to client
- After completion: output_filing_worker.py runs automatically

---

### Week 4: Web UI

**web/** — Next.js App Router + Expo React Native Web

**Auth routes** (no sidebar):
```
app/(auth)/signup/page.tsx       # Email + Google OAuth
app/(auth)/callback/page.tsx     # OAuth exchange → JWT → redirect
app/(auth)/setup/key/page.tsx    # BYOK: provider select + key + validate
app/(auth)/setup/sources/page.tsx # Seed sources (3-5 URLs/RSS)
app/(auth)/setup/schema/page.tsx # Generate CLAUDE.md (domain + wiki name)
```

**Wiki routes** (with AppShell + Sidebar):
```
app/wiki/page.tsx                # Wiki home: StatCards + ConceptCards + recent articles
app/wiki/[slug]/page.tsx         # Article: WikiRenderer + BacklinkPanel + Breadcrumb
app/wiki/graph/page.tsx          # Concept graph: D3.js force-directed
app/qa/page.tsx                  # Q&A: ToolTrace + SSE stream + OutputTypeSelector
app/outputs/page.tsx             # Outputs gallery: md/marp/chart cards
app/sources/page.tsx             # Sources: URL/PDF/GitHub add + ConnectedAccounts
app/sources/suppressed/page.tsx  # Suppressed review: score pills + restore
app/memory/page.tsx              # Memory inspector: episodes + topics + lint queue
app/settings/page.tsx            # BYOK key + provider + connected accounts + billing
app/settings/schema/page.tsx     # CLAUDE.md editor
```

**Key components**:
```
AppShell.tsx           # Root layout: Sidebar + main content
Sidebar.tsx            # Nav: wiki home, graph, Q&A, outputs, memory + concept list
WikiRenderer.tsx       # react-markdown + remark-gfm + [[wikilinks]] as next/link
ConceptGraph.tsx       # D3.js force-directed from backlinks.md
BacklinkPanel.tsx      # Right sidebar: articles linking to current page
Breadcrumb.tsx         # concept → article → raw source trail
ToolTrace.tsx          # Tool call display (collapsed default, expandable)
OutputTypeSelector.tsx # md | marp | chart buttons on Q&A input
SourceQualityBadge.tsx # Score pill 1-10 with colour coding
RepoSourceCard.tsx     # GitHub repo: org/repo + language + stars + file accordion
ProviderSelector.tsx   # Anthropic | OpenAI | Gemini tabs
MarpViewer.tsx         # @marp-team/marp-core renders slides in browser
ImageViewer.tsx        # Full-screen matplotlib PNG viewer
MemoryInspector.tsx    # Active topics + episode count
EpisodeLog.tsx         # Paginated episodes.jsonl display
```

---

### Week 5: Lint worker + Memory system

**workers/lint/**
```python
main.py            # Cloud Run Job — nightly via Cloud Scheduler
health_check.py    # Reads CLAUDE.md + index.md + wiki/ sample → identify issues
web_search.py      # Brave Search API wrapper
imputer.py         # Call web_search for gaps → append with lint_imputed:true frontmatter flag
queue_writer.py    # Write article candidates to wiki/lint_queue.md
```

**Full lint checklist** (implement all 8):
1. Contradictions between pages
2. Stale claims superseded by newer sources
3. Orphan pages (zero inbound [[wikilinks]])
4. Missing entity pages (entity mentioned 3+ times, no dedicated page)
5. Missing concept pages (same pattern)
6. Data gaps (claims with no source citation → web_search to impute)
7. Cross-reference gaps (obvious links missing)
8. Generate 3-5 new article suggestions → lint_queue.md

**Memory system**:
- `output_filing_worker.py` appends to `episodes.jsonl` after every Q&A
- `schema_writer.py` updates `memory.md` counts after every compile
- `GET /memory/episodes` reads and paginates episodes.jsonl
- `GET /memory/topics` aggregates by topic frequency from last 30 episodes

---

### Week 5 also: CLAUDE.md generation

**workers/ingest/generate_schema.py**

This is called at the end of onboarding (after sources step). It generates a personalized `CLAUDE.md` for the user based on their domain. The generated file goes to `GCS gs://manfriday-kb/{user_id}/CLAUDE.md`.

Domain → entity types mapping:
- `ai_ml` → Researchers, Models, Organizations, Datasets, Papers
- `health` → Conditions, Treatments, Researchers, Institutions, Drugs
- `business` → Companies, Executives, Products, Markets, Investors
- `personal` → People, Places, Projects, Goals, Habits
- `general` → People, Organizations, Locations, Events, Topics

The generated CLAUDE.md must include all sections from the CLAUDE.md template (read the template in `CLAUDE.md` in this repo).

---

### Week 6: Integration + testing

- E2E test: sign up → BYOK key → add 3 sources → wiki builds → Q&A → output filed
- Verify log.md is appended on every ingest
- Verify index.md covers entities + concepts + articles + outputs
- Verify CLAUDE.md is read at session start (Q&A agent)
- Verify write_guard.py blocks any write to raw/
- Load test: 10 concurrent free users compiling simultaneously

---

## Local dev

```bash
# Start full stack
make dev

# Test individual workers
make ingest URL=https://simonwillison.net/2024/May/23/monosemanticity/
make compile USER_ID=test-user
make lint USER_ID=test-user
make validate-key PROVIDER=anthropic KEY=sk-ant-...

# Run tests
make test

# Deploy to staging
make deploy-staging
```

**docker-compose.yml** must include:
- API service (FastAPI)
- fake-gcs-server (GCS emulator)
- Supabase (auth emulator)
- Web dev server (Next.js)

Workers run as one-shot commands via `make` targets, not as long-running containers in docker-compose.

---

## Non-negotiables

1. **wiki/ is write-protected** — only compile worker SA has write access (enforced by GCS IAM AND `write_guard.py`)
2. **CLAUDE.md is read at every session start** — Q&A agent reads CLAUDE.md + index.md + last 5 log.md entries before answering
3. **log.md is append-only** — never edit past entries; prefix `## [YYYY-MM-DD]` enables grep
4. **index.md covers ALL wiki pages** — not just raw/ items; entities + concepts + articles + outputs
5. **Entity pages are first-class** — `wiki/entities/` is a real directory; entity_writer.py is a real module
6. **Every LLM call goes through llm.py** — no provider-specific code outside of `shared/python/manfriday_core/llm.py`
7. **Quality scoring is async** — runs after .md write; never blocks ingest completion signal
8. **File-back is automatic** — output_filing_worker.py triggers on every Q&A completion without user action
9. **BYOK key is per-provider** — Secret Manager secret: `byok-{provider}-{user_id}` (separate secrets per provider)
10. **Gemini is a first-class provider** — not an afterthought; ProviderSelector.tsx shows all three equally

---

## Your first task

**Plan before you code.**

1. Read `CLAUDE.md`, `memory.md`, `skills_and_agents.md` from this repo
2. Create the mono-repo scaffold: all directories, empty `__init__.py` and `index.ts` files, `Makefile`, `docker-compose.yml`
3. Set up `shared/python/manfriday_core/` — `gcs.py`, `secrets.py`, `llm.py` (with all three providers)
4. Present your plan for Week 1 (ingest pipeline) before writing any worker code
5. Start with `workers/ingest/fetchers/jina.py` — the simplest fetcher — and confirm the output format before building the rest

Ask clarifying questions if the architecture is unclear before building. **Wrong architecture is harder to fix than wrong code.**
