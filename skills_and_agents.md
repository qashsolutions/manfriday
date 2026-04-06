# ManFriday — Skills and Agents Specification

## Overview

ManFriday operates as a multi-agent system. Each agent has a defined role, toolset, and trigger condition. Skills are reusable capability modules that agents call. This document defines both.

> See also: [CLAUDE.md](CLAUDE.md) (agent constitution), [build_prompt.md](build_prompt.md) (build plan + mono-repo spec + non-negotiables), [memory.md](memory.md) (cross-session state template)

---

## Agents

### Agent 1: Ingest Agent

**Role**: Process a new source from raw/ into the wiki.
**Trigger**: User adds a URL, RSS item, PDF, or GitHub repo.
**Style**: Conversational — discusses with user before writing.

**Tools**:
- `read_raw(slug)` — read raw/ source file
- `read_wiki(path)` — read any wiki page
- `write_wiki(path, content)` — write/update wiki page
- `update_index(entries)` — append/update index.md entries
- `append_log(entry)` — append to log.md
- `update_backlinks()` — regenerate backlinks.md

**Workflow**:
```
1. read_raw(slug) → understand source
2. DISCUSS with user: "Key takeaways from {source}: ..."
3. write_wiki(wiki/articles/{slug}.md) → summary page
4. For each entity mentioned: write_wiki(wiki/entities/{entity}.md)
5. For each concept mentioned: write_wiki(wiki/concepts/{concept}.md)
6. update_index({new and updated pages})
7. update_backlinks()
8. append_log("## [{date}] ingest | {title}\nPages updated: ...")
```

**Quality checks**:
- Flag contradictions: "⚠️ This contradicts [[existing-page]] which says..."
- Note gaps: "This mentions X but we have no entity page for X yet."
- Cite sources: every claim in a wiki page traces to a raw/ slug.

---

### Agent 2: Query Agent

**Role**: Answer user questions against the wiki.
**Trigger**: User asks a question.
**Style**: Reads wiki, synthesizes, offers to file answer.

**Tools**:
- `read_wiki(path)` — read wiki page
- `search_wiki(query, n)` — BM25 search returning top-N pages
- `read_index()` — read index.md
- `execute_python(code)` — run matplotlib/pandas for charts
- `write_wiki(path, content)` — file answer as wiki page
- `append_log(entry)` — log query

**Workflow**:
```
1. read_index() → identify relevant pages
2. search_wiki(query) → find additional relevant pages
3. read_wiki() for each relevant page
4. Synthesize answer with [[wikilink]] citations
5. Ask user: "Should I file this as a wiki page?"
6. If yes: write_wiki(wiki/outputs/{timestamp}.md)
            update_index(new output)
            append_log("## [{date}] query | {question}")
```

**Output formats** (user selects via OutputTypeSelector):
- `md` — markdown answer filed as wiki page
- `marp` — slide deck with marp:true frontmatter
- `chart` — matplotlib PNG via execute_python
- `table` — markdown comparison table

---

### Agent 3: Lint Agent

**Role**: Health-check the wiki, fix issues, suggest new articles.
**Trigger**: Nightly scheduled (Cloud Scheduler) OR user-requested.
**Style**: Systematic — scans all pages, produces structured report.

**Tools**:
- `read_wiki(path)` — read wiki page
- `read_index()` — read index.md
- `list_wiki_pages()` — list all files in wiki/
- `web_search(query)` — Brave Search API for gap-filling
- `write_wiki(path, content)` — update wiki pages with corrections
- `append_log(entry)` — log lint run
- `write_lint_queue(candidates)` — write new article suggestions

**Checklist** (run in order):
```
1. CONTRADICTIONS
   For each pair of related pages: flag claims that conflict.
   Write contradiction note to affected pages.

2. STALE CLAIMS
   For each page: check if newer raw/ sources supersede claims.
   Update pages with newer information; mark old claims as superseded.

3. ORPHAN PAGES
   Find pages with zero inbound [[wikilinks]].
   Update other relevant pages to link to orphans.

4. MISSING ENTITY PAGES
   Scan all pages for entities mentioned 3+ times without own page.
   Add to lint_queue.md as article candidates.

5. MISSING CONCEPT PAGES
   Same as above for concepts.

6. DATA GAPS
   Find claims with no source citation.
   Call web_search() to find and impute missing data.
   Tag imputed content: lint_imputed: true in frontmatter.

7. CROSS-REFERENCE GAPS
   Find obvious links that should exist but don't.
   Add [[wikilinks]] to relevant pages.

8. GENERATE SUGGESTIONS
   Based on gaps found: suggest 3-5 new article candidates.
   Write to lint_queue.md.

9. LOG
   append_log("## [{date}] lint | health check\n
               Contradictions: N | Stale: N | Orphans: N | 
               Gaps filled: N | Queued: N")
```

---

### Agent 4: Memory Agent

**Role**: Maintain memory.md and episodes.jsonl from session history.
**Trigger**: After every Q&A session completion AND after every compile cycle.
**Style**: Background — no user interaction.

**Tools**:
- `read_episodes()` — read episodes.jsonl
- `write_memory(content)` — update memory.md
- `append_episode(record)` — append to episodes.jsonl

**Workflow (post-Q&A)**:
```
1. append_episode({
     date, query, topics_detected,
     articles_read, output_type,
     output_path, filed
   })
2. Recompute active_threads from last 30 episodes
3. Update memory.md: active_threads + recent_episodes
```

**Workflow (post-compile)**:
```
1. Update memory.md: wiki_state counts
2. Detect new patterns in episodes → update playbook
3. Check lint_queue.md → update memory.md lint_queue section
```

---

## Skills (Reusable Modules)

### Skill: ingest_source

Called by: Ingest Agent
Purpose: Fetch + clean a source into raw/

```python
def ingest_source(url: str, source_type: str, user_id: str) -> IngestResult:
    """
    Fetch source → clean markdown → quality score → write to raw/
    Returns: {slug, quality_score, suppressed, page_count (if pdf)}
    """
    # 1. Fetch: jina.py | rss.py | github.py | pdf.py | dataset.py
    # 2. Image co-location: image_colocator.py
    # 3. Quality pre-filter: pre_filter.py (deterministic rules)
    # 4. Quality score: scorer.py (LLM call, 1-10)
    # 5. Write: raw/{user_id}/{slug}.md
    # 6. Update: manifest.json
```

---

### Skill: compile_wiki

Called by: Ingest Agent (conversational) and compile worker (batch)
Purpose: Read raw/ item → write/update wiki pages

```python
def compile_wiki(slug: str, user_id: str, interactive: bool) -> CompileResult:
    """
    Read raw/{slug}.md → extract entities/concepts → write wiki pages
    interactive=True: discuss with user before writing
    interactive=False: batch compile, no discussion
    Returns: {pages_created, pages_updated, entities_found, concepts_found}
    """
    # 1. Read raw/{slug}.md
    # 2. If interactive: present key takeaways to user
    # 3. write_wiki(wiki/articles/{slug}.md)
    # 4. For each entity: write_wiki(wiki/entities/{entity}.md)
    # 5. For each concept: write_wiki(wiki/concepts/{concept}.md)
    # 6. update_index()
    # 7. update_backlinks()
    # 8. append_log()
```

---

### Skill: search_wiki

Called by: Query Agent, Lint Agent
Purpose: BM25 search over wiki pages

```python
def search_wiki(query: str, top_n: int = 5) -> list[SearchResult]:
    """
    BM25 search over all wiki/*.md files
    Returns: [{path, title, summary, score}]
    Registered as tool in Q&A agent tool-use loop (REQ-049)
    """
```

---

### Skill: execute_python

Called by: Query Agent
Purpose: Run matplotlib/pandas in sandbox, return PNG

```python
def execute_python(code: str) -> ExecutionResult:
    """
    Run in E2B sandbox (no network, 256MB, 30s timeout)
    Returns: {image_path: GCS path to PNG, stdout, error}
    """
```

---

### Skill: web_search

Called by: Lint Agent (for gap-filling)
Purpose: Brave Search API for external information

```python
def web_search(query: str, n: int = 5) -> list[WebResult]:
    """
    Calls Brave Search API (ManFriday-managed key)
    Returns: [{title, url, snippet}]
    Used only by lint worker for imputing missing data
    """
```

---

### Skill: generate_schema

Called by: Onboarding (setup/sources step)
Purpose: Generate initial CLAUDE.md for new user

```python
def generate_schema(user_id: str, wiki_name: str, domain: str) -> str:
    """
    Generate personalized CLAUDE.md based on:
    - wiki_name: what the user calls their wiki
    - domain: primary research domain (AI, health, business, etc.)
    Returns: CLAUDE.md content tailored to user's domain
    """
    # Fills in domain-specific conventions:
    # - Entity types relevant to domain (people/orgs for business, genes/drugs for health)
    # - Common concept types for domain
    # - Suggested initial index structure
    # - Domain-appropriate lint rules
```

---

## GCS paths — updated for schema layer

```
gs://manfriday-kb/{user_id}/
  CLAUDE.md           ← agent schema (NEW — third layer)
  memory.md           ← persistent cross-session memory (NEW)
  raw/
    manifest.json
    {slug}.md
    {slug}/images/
    uploads/{uuid}.pdf
    outputs/{timestamp}_q.md
  wiki/
    index.md          ← ALL wiki pages (entities + concepts + articles + outputs)
    log.md            ← append-only operations log (NEW)
    backlinks.md
    lint_queue.md
    memory/
      episodes.jsonl
      playbooks/
    entities/         ← entity pages (NEW directory)
      {entity}.md
    concepts/
      {concept}.md
    articles/
      {slug}.md
    outputs/
      {timestamp}.md
  outputs/
    {timestamp}.md
    images/{timestamp}.png
  config/
    sources.json
    preferences.json
```

---

## Build order

This is the sequence to build ManFriday, now that docs are complete:

```
Phase I — Core KB engine ✅ COMPLETE (2026-04-06):

Week 1:  workers/ingest/ — jina, rss, github, pdf, quality scorer          ✓ DONE
Week 2:  workers/compile/ — index_writer, article_writer, backlinks,        ✓ DONE
                            entity_writer, log_writer, schema_writer
Week 3:  api/ — FastAPI gateway, all 20 endpoints, tool registry            ✓ DONE
Week 4:  web/ — wiki browser, Q&A interface, sources, auth, settings        ✓ DONE
Week 5:  workers/lint/ — full 8-check checklist, web search, lint_queue     ✓ DONE
         memory system — episodes.jsonl, memory.md, output filing
Week 6:  CLAUDE.md generator — onboarding step 3.5 (after sources)          ✓ DONE
         Spec audit: 7 gaps found, 7 fixed                                  ✓ DONE
         E2E verification: all checks pass                                   ✓ DONE
         GitHub Pages demo deployed                                          ✓ DONE

Phase II — Personal agent layer ✅ COMPLETE (2026-04-06):
Week 7:  Gmail connector — OAuth, poll, text extraction                     ✓ DONE
         Google Drive connector — OAuth, Docs/PDF/Sheets                    ✓ DONE
         Telegram connector — Bot API, message polling                      ✓ DONE
         WhatsApp connector — Business Cloud API                            ✓ DONE
         arXiv connector — API query by categories (paid tier)              ✓ DONE
         Connector infrastructure — OAuth helper, API routes, polling       ✓ DONE
Week 8:  Stripe billing — checkout, portal, webhook logic, entitlement      ✓ DONE
         Billing UI — plan display, upgrade, manage subscription            ✓ DONE
         Connected accounts UI — status, connect/disconnect, poll           ✓ DONE
         Entitlement middleware — paid tier gating for features              ✓ DONE

Phase III — Power features:
         pgvector semantic search (BM25 in Phase I)
         World model graph
         LoRA fine-tune pipeline
```

---

## What makes this different from RAG

| RAG | ManFriday |
|---|---|
| Retrieves chunks at query time | Wiki already synthesized |
| Re-derives knowledge every query | Knowledge compounds over time |
| No memory between sessions | CLAUDE.md + memory.md persist |
| No entity/concept tracking | Dedicated entity + concept pages |
| No contradiction detection | Lint agent flags conflicts |
| No timeline of knowledge evolution | log.md records all operations |
| LLM = retriever | LLM = wiki maintainer |

The wiki is not an index. It is a compiled, maintained, living knowledge artifact.
