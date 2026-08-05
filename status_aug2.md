# manfriday — Project Status (2026-08-04)

Everything below is taken directly from the code and configuration on disk and
from live tests executed during the build sessions of Aug 1–4, 2026. No
projections.

## Contents

1. [What this project is](#1-what-this-project-is) — the four deliverables
2. [File inventory](#2-file-inventory) — every file and what it's for
3. [Access architecture](#3-access-architecture-as-implemented-in-serverpy) — APIs first, scraping last; hardening
4. [The 25 MCP tools](#4-the-25-mcp-tools-from-mcptool-definitions) — public / OAuth / Notion / ledger
5. [The 10 agents](#5-the-10-agents-claudeagents) — roles + 2026 algorithm heuristics
6. [Configuration state](#6-configuration-state-verified-on-disk--by-live-call) — keys, OAuth, Notion, per-item status
7. [Verification log](#7-verification-log-live-tests-actually-executed) — every live test, chronological
8. [Known limitations](#8-known-limitations-by-design-or-constraint) — scraping surfaces, quota, single-user OAuth
9. [Explicitly NOT built](#9-explicitly-not-built-decided-not-forgotten) — decided, not forgotten
10. [Next steps](#10-next-steps) — Phases 0–4 roadmap
11. [Aug 3 update — Supabase layer live](#11-aug-3-update--supabase-layer-live-applied-audited-tested-end-to-end) — applied, audited, tested end to end
12. [Web app design (Aug 3): mockups, evaluation, decisions](#12-web-app-design-aug-3-mockups-evaluation-decisions) — v1→v3 flow, multi-agent eval, hosting, the 3 post-build decision points
13. [Aug 3 update — the analyst layer is live](#13-aug-3-update--the-analyst-layer-is-live-llm-analysts-via-claude-api) — 4 Claude-powered analysts, routes, tables touched, `ANTHROPIC_API_KEY`
14. [Aug 4 update — Scorekeeper live + grounded confidence everywhere](#14-aug-4-update--scorekeeper-live--grounded-confidence-everywhere) — daily cron, arithmetic verdicts, migration 14
15. [Aug 4 update — guide stance shipped + Scout & Researcher live](#15-aug-4-update--guide-stance-shipped--scout--researcher-live) — team of six complete, migration 15, options everywhere; all six seats live-tested; comparison desk (own video vs any video); comments via `YOUTUBE_API_KEY`; weekly reports auto-write Mondays
16. [Aug 4 update — the cardinal rule + Desk content pass](#16-aug-4-update--the-cardinal-rule--desk-content-pass) — every line must tell the user how to get more views; ratio jargon killed; private-thumbnail discovery

## 1. What this project is

A YouTube analysis/marketing toolkit for Claude Code, built in three sessions
(Aug 1–3, 2026):

- A custom **MCP server** (`youtube-mcp/server.py`, 2,022 lines, Python 3.13,
  `mcp` 2.0) exposing **25 tools**, registered in `.mcp.json` as server name
  `youtube` (stdio transport, own venv at `youtube-mcp/.venv`).
- **10 Claude Code agents** (`.claude/agents/*.md`) built on those tools.
- A one-time OAuth helper (`youtube-mcp/authorize.py`, 52 lines).
- A 4-slide **pitch deck** (`deck/` — PPTX + PDF + editable SVG sources; see
  §7 "pitch deck" entry).
- The **Supabase storage layer for manfriday.app** (Phase 4 groundwork,
  applied Aug 2–3): 12 migrations live on project `jxlhvxkaetuhtmwjvlym`,
  mirrored in `supabase/migrations/`, documented in `supabase/SETUP.md`.
  Nothing in the local toolkit reads or writes it yet.

## 2. File inventory

```
.mcp.json                    registers the youtube MCP server (env passthrough)
.env / .env.example          secrets file (loaded by the server at startup)
.gitignore                   covers .env, client_secret*.json, .oauth-token.json,
                             .venv, reports/, monitor state, ledger state,
                             .DS_Store
README.md                    setup + usage documentation (updated Aug 2 evening:
                             25-tool table incl. ledger, 10-agent layout)
status_aug2.md               this file
sqlstatus_aug3.md            Supabase layer status: migration ledger, code
                             audit, full SQL test log, gotchas (Aug 3)
CLAUDE.md                    session guide: project map, doc pointers, rules
deck/findings.md             competitive research + product focus (Aug 3) —
                             LOCAL ONLY, deliberately gitignored; not in the
                             public repo
.claude/yt-profile.md        channel-profile template (currently unfilled)
.claude/yt-ledger.jsonl      recommendation-ledger state (gitignored; created on
                             first log_recommendation call — not yet present)
.claude/agents/              10 agent definitions (see §5)
deck/manfriday-deck.pptx     pitch deck, 16:9 full-bleed slides
deck/manfriday-deck.pdf      same 4 pages as PDF
deck/svg/slide1-4.svg        editable slide sources (1920x1080 SVG)
supabase/SETUP.md            Supabase layer reference: schema, security model,
                             sovereignty flows, remaining dashboard steps
supabase/migrations/         the 12 applied migrations, mirrored 1:1
supabase/test-signin.html    localhost sign-in test page (publishable key
                             only; used for the verified real sign-in, §11)
youtube-mcp/server.py        the MCP server (25 tools)
youtube-mcp/authorize.py     one-time OAuth browser flow
youtube-mcp/requirements.txt mcp, yt-dlp, youtube-transcript-api,
                             google-api-python-client, requests,
                             google-auth-oauthlib
youtube-mcp/client_secret.json      Desktop-app OAuth client (gitignored)
youtube-mcp/client_secret_web.json  Web OAuth client, kept for the future
                                    manfriday.app (gitignored)
youtube-mcp/.oauth-token.json       saved OAuth token (gitignored)
reports/thumbnails/          downloaded thumbnail images (1 test image present)
```

## 3. Access architecture (as implemented in server.py)

**Official APIs first; scraping is last-resort fallback.**

| Path | Used for | Condition |
|---|---|---|
| YouTube Data API v3 (key) | metadata, search, channel/playlist listings, channel stats, baselines, comments | `YOUTUBE_API_KEY` set (it is — see §6) |
| YouTube Analytics API v2 (OAuth) | the 7 `get_my_*` private-analytics tools | token at `youtube-mcp/.oauth-token.json` (present) |
| Official RSS feed | `get_channel_rss` (new-upload detection) | always, no key/quota |
| i.ytimg.com direct download | `get_thumbnail` | always |
| suggestqueries.google.com | `get_search_suggestions` | always |
| yt-dlp (scraping) | fallback for the API-key paths when no key or on API error; the ONLY path for `get_video_heatmap` | fallback |
| youtube-transcript-api (scraping) | `get_transcript` — no official API exists | always |

**Hardening implemented in code:**
- `.env` loader at server startup (project root, then `youtube-mcp/`); real
  shell env vars win; empty values treated as unset.
- In-memory TTL cache: 900 s, max 128 entries, LRU-ish eviction — shared
  across yt-dlp extractions and channel-ID resolutions (verified: a heatmap
  call after a metadata call for the same video costs ~0 s).
- Scraping retries: 3 attempts, exponential backoff (1.5·2ⁿ s), immediate
  fail-fast on bot-check/429/403 markers, with error messages that state the
  fix (set key / wait / `pip install -U yt-dlp`).
- Thumbnail downloads are cached on disk (`reports/thumbnails/<vid>_<quality>.jpg`).
- OAuth token auto-refreshes on load; failures return actionable setup text
  rather than stack traces.

## 4. The 25 MCP tools (from `@mcp.tool` definitions)

**Public — any YouTube URL:**
| Tool | Function |
|---|---|
| `get_video_info` | Metadata + derived performance (views/day, likes per 1k views, subscriber count, views÷subscriber ratio), chapters (from yt-dlp or description timestamps), Shorts heuristic, duration bucket |
| `get_transcript` | Full transcript; optional `[h:mm:ss]` timestamps; language fallback |
| `get_video_heatmap` | Public "most replayed" curve; top-N peaks + 25-point curve sample (no OAuth needed) |
| `get_thumbnail` | Downloads max-res thumbnail to disk so agents can view it via Read (multimodal critique) |
| `search_videos` | Search (API first, `ytsearch` fallback), 1–50 results |
| `get_search_suggestions` | YouTube autocomplete; optional a–z fanout (~27 requests) |
| `get_channel_videos` | Recent uploads (API path includes per-video views/duration/publish dates) |
| `get_channel_stats` | Subscribers, total views, video count |
| `get_channel_baseline` | Median/mean views over 5–50 recent uploads, **Shorts and long-form baselined separately**, outlier flags (≥2× / ≤0.5× median) |
| `get_channel_rss` | Latest ≤15 uploads via official RSS, incl. view counts |
| `get_playlist_videos` | Playlist expansion (API or fallback) |
| `get_comments` | Top-level comments, relevance/time order |

**Private — OAuth, user-owned channel only (read-only scopes
`youtube.readonly` + `yt-analytics.readonly`):**
| Tool | Function |
|---|---|
| `get_oauth_status` | Whether authorized + which channel |
| `get_my_channel_analytics` | Views, watch time, avg view duration/%, subs ±, likes/comments/shares; totals or daily series; default window 28 days |
| `get_my_video_analytics` | Same metrics scoped to one video |
| `get_my_video_retention` | Real retention curve (`audienceWatchRatio` by `elapsedVideoTimeRatio`) + `relativeRetentionPerformance` + computed steepest-drop points |
| `get_my_traffic_sources` | Views by traffic source type, channel- or video-scoped |
| `get_my_audience` | Age/gender %, top-10 countries, device types |
| `get_my_top_videos` | Top ≤200 videos by views with private metrics, titles resolved |

**Notion (fully live — all three tools tested against the real workspace
Aug 2, post-restart; see §6/§7):**
| Tool | Function |
|---|---|
| `setup_notion_database` | One-time creation of a 16-property video-catalog database |
| `add_video_to_notion` | Upsert (deduped on Video ID) with auto-fetched stats + agent-supplied category/topics/summary; sets the video thumbnail as the Notion page cover (`_thumbnail_url` helper, maxres→sd→hq fallback with placeholder detection) — cover code verified live after second restart (§7) |
| `save_report_to_notion` | Markdown report → Notion page; converts headings, lists, code fences, dividers, and pipe tables into real Notion blocks; >90 blocks appended in batches |

**Recommendation ledger — the learning loop (added Aug 2 evening; live and
MCP-verified after second restart, §7). State: `.claude/yt-ledger.jsonl`
(gitignored; override via `YT_LEDGER_PATH`):**
| Tool | Function |
|---|---|
| `log_recommendation` | Record one piece of advice (agent, category, target video/channel/idea) with an automatic baseline metrics snapshot (views, views/day, likes/1k) |
| `update_recommendation` | Mark applied/skipped, attach the resulting video (snapshotted), record a worked/failed/mixed/unclear verdict (auto-resolves) |
| `get_recommendation_ledger` | Read history newest-first with status/verdict counts; `refresh_metrics` recomputes current-vs-baseline deltas for target and result videos |

The five recommendation-producing agents (yt-optimize, yt-audit, yt-audience,
yt-compare, yt-studio) now carry a "Learning loop" section: read the ledger
before advising, log the 1–3 headline recommendations after, update entries
when outcomes become visible.

## 5. The 10 agents (`.claude/agents/`)

| Agent | Role (per its definition file) |
|---|---|
| `yt-summarizer` | Transcript-grounded summaries + performance snapshot + most-replayed moments |
| `yt-qa` | Q&A over video transcripts with timestamp citations |
| `yt-compare` | Multi-video performance diagnosis: normalized metrics, visual thumbnail face-off, heatmap-vs-transcript, comments; uses real OAuth retention when the video is the user's own |
| `yt-optimize` | Upload-package generation: 5 title variants, description w/ chapters, 15–20 tags, 3 hook rewrites, thumbnail critique/briefs, first-48h launch checklist |
| `yt-audit` | Channel health: A–F scorecard over 5 dimensions, per-format baselines, visual packaging review; upgrades to OAuth analytics for the user's own channel |
| `yt-audience` | Comment mining → ranked idea backlog cross-checked against autocomplete demand, complaints/praise themes |
| `yt-catalog` | Categorize videos (fixed 10-category taxonomy + topics + summary) → Notion database upserts |
| `yt-researcher` | Multi-video topic research → single cited synthesis |
| `yt-monitor` | New-upload detection via RSS (fallback listing), first-run backlog suppression, view-velocity snapshots for videos <14 days old; state in `.claude/yt-monitor-state.json` |
| `yt-studio` | Private analytics analyst (OAuth): retention drops cross-referenced with transcript content, traffic-source-aware recommendations |

Common to report-producing agents: read `.claude/yt-profile.md` when present;
write reports to `reports/`; export on request to Notion
(`save_report_to_notion`) or Google Drive (`mcp__claude_ai_Google_Drive__create_file`
via the claude.ai connector, loaded through ToolSearch).

2026-algorithm heuristics written into agent prompts (sourced from web research
on Aug 1): retention + satisfaction outweigh raw watch time (<~40% retention
deprioritizes), Shorts vs long-form ranked separately, first-24–48h velocity +
Hype feature (500–500k subs), thumbnails 3–5 words/high contrast/clear focal
point.

## 6. Configuration state (verified on disk / by live call)

| Item | State |
|---|---|
| `YOUTUBE_API_KEY` in `.env` | ✅ set; live Data API call succeeded; restriction removed (was referrer-blocked, fixed Aug 2); key restricted to YouTube Data API v3 per user |
| Data API v3 | ✅ enabled (verified by successful calls) |
| Analytics API | ✅ enabled (verified by successful calls, Aug 2) |
| OAuth client (Desktop) | ✅ `client_secret.json`, type `installed` |
| OAuth token | ✅ present; authorized as channel **"Venkata CVR"** (`UCOx1SBqgKRBVS99-2cbvq5w`, 1 subscriber), account ramanac@gmail.com |
| OAuth consent screen | Testing mode; 3 test users allowlisted (admin@myguide.health, ramanac@gmail.com, sandhyaramana@gmail.com) |
| `NOTION_API_KEY` in `.env` | ✅ set (Aug 2); token verified by direct REST call, then all three Notion tools live-tested through the server post-restart (§7) |
| Notion parent page | ✅ "manfriday-reports" (`3b01c637-9aa7-80bc-bbf4-e10db1ca5b05`) shared with the integration; `NOTION_PARENT_PAGE_ID` set in `.env` |
| `NOTION_DATABASE_ID` | ✅ `3b01c637-9aa7-8153-a93b-d3bc7ece28f7` — created by `setup_notion_database` (Aug 2) and written to `.env`. Note: a server started before that write won't see it; pass `database_id` explicitly or restart |
| Notion catalog views | ✅ 4 visual views created programmatically Aug 2 evening via Notion's Views API (`Notion-Version: 2025-09-03`; data source `3b01c637-9aa7-8140-9243-000b9f8f615d`): Gallery (card preview = page cover), "By Category" board, "Publish Calendar", "Views/Day by Category" column chart (average). Server code itself still pins `2022-06-28` — unaffected. Note: Notion Free plan allows 1 chart total |
| Google Drive export | ✅ verified from inside an agent (second-restart session): connector present, agent loaded `create_file` via ToolSearch and uploaded a real .md (no Google-Doc conversion). Connector is session-level — agents degrade to local files in sessions without it |
| `.claude/yt-profile.md` | Template only — not filled in |
| MCP server registration | ✅ `.mcp.json` present; server connects live in-session after restart (verified Aug 2 post-restart: all 22 then-existing tools registered, `get_oauth_status` + `get_video_info` succeed with `source: youtube_data_api`). All 25 tools live after the second restart — the 3 ledger tools and the thumbnail-cover change MCP-verified end-to-end (§7) |
| Supabase project | ✅ `jxlhvxkaetuhtmwjvlym` — 12 migrations, 14 RLS tables, bucket + pg_cron applied Aug 2–3; full test suite passed incl. a real Google sign-in (§11, `sqlstatus_aug3.md`) |
| Supabase Google provider | ✅ enabled Aug 3 with the **web** client (`client_secret_web.json`); Supabase callback registered on it; Site URL `http://localhost:3000` for dev — switch to manfriday.app at launch. The Desktop client's secret does NOT work here (different client) |

## 7. Verification log (live tests actually executed)

Aug 1: metadata (Rick Astley video — title/views/subs correct) · transcript
(61 segments, en, manual captions) · keyless search · channel listing
(@anthropic-ai) · full MCP stdio handshake · performance block (views/day
293k, likes/1k = 10.7, views÷subs = 397) · channel stats (@mkbhd, 21.1M subs)
· heatmap (real peaks returned) · thumbnail (maxres, 65 KB, visually verified
by reading the image) · autocomplete (live suggestions) · md→Notion block
conversion (offline: heading/paragraph/table/bullet/numbered) · baseline
(@anthropic-ai: median 409k, 2.08× outperformer flagged).

Aug 2: cache hit timing (1.1 s → 0.00 s) · RSS (MKBHD feed, 15 videos incl.
prior-day upload with view count) · keyless fallbacks intact · OAuth graceful
errors · Data API key working after restriction fix (`source:
youtube_data_api` on metadata/listings/baseline/search) · OAuth end-to-end:
`get_oauth_status` → channel identified; lifetime channel analytics returned
real data (183 views, 887 min watched, 20.1% avg view %, 5 likes); 28-day
window correctly returns zeros (no recent activity); top-videos / traffic /
audience queries succeed (empty rows for the inactive window) · final
handshake: **22 tools exposed**.

Aug 2, post-restart: server connected in-session (22 tools registered, 10
agents available) · `get_oauth_status` → authorized as "Venkata CVR" ·
`get_video_info` → full metadata via `source: youtube_data_api` · **agent
smoke tests passed**: yt-summarizer (transcript + metadata + heatmap, 3/3
tools) and yt-studio (OAuth end-to-end: lifetime analytics, top videos,
traffic sources, 5/5 calls; 28-day window correctly returns explicit zeros).

Aug 2, Notion setup: user created internal integration, key added to `.env` ·
token verified valid by direct REST call (`/v1/search`) — integration sees
exactly one shared page, "manfriday-reports" · `NOTION_PARENT_PAGE_ID` set in
`.env` · confirmed the server loads `.env` only at startup, so the new vars
need a restart · stray `npm install @notionhq/client` artifacts removed (JS
SDK; the Python server calls Notion REST directly).

Aug 2, Notion live tests (post-restart): `setup_notion_database` created the
video-catalog DB under "manfriday-reports"
(`3b01c637-9aa7-8153-a93b-d3bc7ece28f7`, ID written to `.env`) ·
`add_video_to_notion` (explicit `database_id`) created a real page for the
Rick Astley test video, and a second call for the same video returned
`action: "updated"` — upsert dedup on Video ID confirmed ·
`save_report_to_notion` (explicit `parent_page_id`) converted a markdown
report to a 12-block Notion page including a real table and code block.

Aug 2 evening, visual catalog: existing Rick Astley catalog page cover set to
its thumbnail via direct REST PATCH (API confirmed the external cover) · 4
views created on the catalog DB via the Views API with live API calls, each
confirmed by a returned view object: Gallery (then configured card preview =
page cover, medium), board "By Category" (select group-by), "Publish
Calendar" (Published date), column chart "Views/Day by Category" (average
aggregation). API shape learned by iterating on validation errors: `type`
required both top-level and inside `configuration`; select group_by/x_axis
require `{"type": "select", "property_id": ..., "sort": {"type": "manual"}}`;
chart types are column|bar|line|donut|number.

Aug 2 evening, pitch deck: 4 slides authored as 1920×1080 SVG, rendered to
2× PNG via headless Chrome, assembled to PPTX (python-pptx, 13.333×7.5 in
full-bleed) and PDF (img2pdf) in a scratch venv (no project deps added); all
4 PDF pages visually verified after each rebuild. Content grounded in three
web-research agents run the same evening (general solopreneur data,
creator-economy data, Notion capabilities); every cited source is 2025–26
(Billion Dollar Boy, Gusto/Simply Business, Influencer Marketing Hub,
eMarketer, Cookie Finance, Nature Scientific Reports, Epidemic Sound,
YouTube official). Iterations on user direction: slide 1 went from 3 to 4
stat tiles (added the 41% time-scarcity stat), slide 3 restructured around 3
numbered value props each mapped to the problem it answers ("answers: …"),
slide 3 strip updated to "25 tools · … · a learning ledger" after the ledger
was built.

Aug 2 evening, recommendation ledger: offline smoke test of all three tools
via direct module import (real network for snapshots) — video-target rec with
auto baseline (Rick Astley: views/day 293,861 captured), idea-level rec,
channel-target rec (@mkbhd subscriber baseline), applied + result-video
attach, verdict resolve, refresh deltas computed, status filters, invalid
category/id rejected with actionable errors. Unique-ID collision bug found by
the test and fixed (millisecond timestamp + sequence suffix). MCP-layer
registration of the 3 new tools happens at next server restart.

Aug 2 late (second restart, timestamps Aug 3 UTC): the 25-tool server
verified end-to-end through MCP. Ledger: `log_recommendation` captured a
real baseline snapshot (Rick Astley, views/day 293,861) →
`get_recommendation_ledger` with `refresh_metrics` returned the entry with
computed current-vs-baseline deltas → `update_recommendation` resolved it
with a verdict and update trail; test entry then removed (ledger file back
to not-yet-created state). Notion cover: `add_video_to_notion` with **no
explicit `database_id`** upserted the Rick Astley page (`action:
"updated"` — `.env` default works), and the automatic thumbnail cover was
proven conclusively: cover cleared via direct REST PATCH, re-add restored
`https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg` as the page cover.
Drive export from inside an agent: a subagent read `status_aug2.md`, loaded
`mcp__claude_ai_Google_Drive__create_file` via ToolSearch, and uploaded it
as `manfriday-status-aug2.md` (26 KB, `text/markdown`, conversion to
Google Doc disabled) — succeeded on the first call.

Aug 2 late–Aug 3, Supabase (via the Supabase MCP server, project-scoped):
fresh project `jxlhvxkaetuhtmwjvlym` verified before touching it (URL ref
match, 0 public tables, 0 migrations, 0 auth users) · 12 migrations applied,
each mirrored to `supabase/migrations/` first · resulting state confirmed by
live listing: 14 RLS-enabled tables, `thumbnails` storage bucket created,
pg_cron installed with the `purge-api-cache` job active (confirmed by querying
`cron.job`) · security advisor run after each batch — one real finding
(`handle_new_user` client-callable via REST RPC) fixed in migration 6; the
remaining lints are intentional designs (3 deny-all service-role tables, the
export RPC) · a code audit of the schema against `server.py` and the agent
definitions caught a real bug before any data existed: the `recommendations`
status CHECK rejected the ledger's `resolved` lifecycle (`update_recommendation`
sets it with every verdict) — fixed in migration 7 along with the missing
`notes`/`resolved_at`/`baseline_error`/`result_baseline_error` fields.

**Not live-tested**: the other 8 agents (their underlying tools are all
verified). On the Supabase side, a full SQL test suite passed Aug 3 (two
simulated users → seed all 14 tables → verify → purge → project left empty):
sign-up trigger, updated_at trigger, CHECK/unique rejections, the
resolved+verdict ledger state, RLS isolation from both users' perspectives
(cross-tenant insert 42501, append-only update = 0 rows, token table
permission-denied, anon sees nothing), `export_my_data()` complete and
ciphertext-free, cache purge, and the one-statement account-deletion cascade.
The final gap closed later on Aug 3: Google provider enabled (web client) and
a real sign-in verified end to end — auth.users + Google identity +
auto-created profile + `export_my_data()` over PostgREST with the real
session JWT (details in sqlstatus_aug3.md).

## 8. Known limitations (by design or constraint)

- **Transcripts and the most-replayed heatmap are scraping-only** — no
  official API exists for either. These can break if YouTube changes
  internals; fix is `youtube-mcp/.venv/bin/pip install -U yt-dlp`.
- **"Subscribers who watched" is not a public metric**; the public proxy is
  views÷subscribers. With OAuth, real per-viewer analytics exist only for the
  authorized channel. Impressions/CTR are not exposed by the Analytics API at
  all (YouTube Studio UI only).
- **OAuth is single-user, local-file token** — correct for a personal tool;
  a public manfriday.app requires per-user token storage plus Google app
  verification to leave Testing mode (100-user cap until then).
- `is_short` is a heuristic (duration + aspect ratio when available; ≤60 s on
  API path).
- Playlist API path returns no per-video durations (playlistItems doesn't
  carry them); the yt-dlp fallback does.
- Data API quota: 10,000 units/day (search = 100 units, most reads = 1).
- The OAuth token currently points at a 1-subscriber channel; re-run
  `authorize.py` to bind a different/brand channel.

## 9. Explicitly NOT built (decided, not forgotten)

- Write-back to YouTube (title/description/tag updates) — deferred; would need
  a write scope and per-video confirmation UX.
- Whisper/ASR fallback for caption-less videos — deferred until it bites.
- Paid keyword data (DataForSEO), WordPress companion posts, video
  production stack (Remotion/ElevenLabs/FFmpeg), vector DB of transcripts —
  ruled out as overbuild for now.
- Visual dashboards are produced on demand by the main assistant (artifacts),
  not generated by server code.

## 10. Next steps

Staged. "Decided" = already approved in the build sessions; "Proposed" = not
yet approved, listed so it isn't forgotten.

### Phase 0 — Activation ✅ DONE (Aug 2, post-restart)
Restart completed; server approved and connected (22 tools, 10 agents — §7).
Smoke tests passed at both layers: tools directly, then full agent runs
(yt-summarizer public path 3/3, yt-studio OAuth path 5/5 — §7).

If any tool errors later, first checks: `.env` still present, `/mcp` shows the
server connected, and the error text itself (server errors are written to be
actionable).

### Phase 1 — Remaining configuration (decided, user actions)
1. **Fill `.claude/yt-profile.md`** — channel, niche, products/links, tone,
   publish windows. Every generating agent (optimize, audit, studio, compare,
   audience) reads it; recommendations stay generic until it exists.
2. **Notion** — ✅ DONE (Aug 2): integration + token verified, parent page
   shared, database created (`3b01c637-9aa7-8153-a93b-d3bc7ece28f7` in
   `.env` as `NOTION_DATABASE_ID`), and all three tools live-tested against
   the real workspace incl. upsert dedup and markdown→blocks conversion
   (§7). Sessions whose server started before the `.env` write must pass
   `database_id` explicitly (parent page ID was already loaded, so reports
   work either way).
3. **Re-auth OAuth to the real content channel** when relevant: re-run
   `youtube-mcp/.venv/bin/python youtube-mcp/authorize.py` and pick the
   channel-owning account in the picker (Brand Accounts appear as a separate
   entry). Current token = "Venkata CVR", 1 subscriber, no recent activity —
   fine for plumbing tests, useless for real insight.
4. **Google Drive export** — ✅ DONE: no setup in this repo (by design);
   verified end-to-end from inside an agent (§7). Only requirement remains
   that the claude.ai Drive connector is connected in the session.

### Phase 2 — Routine operation (proposed workflows, no new code)
- **Monitoring cadence**: seed yt-monitor ("monitor @channel1 @channel2"),
  then automate with `/loop` (same session, e.g. hourly) or a scheduled cloud
  agent (`/schedule`) for daily digests. First run only records the backlog —
  by design.
- **Catalog cadence**: Notion is live — batch-catalog channels/playlists;
  re-runs are safe (upsert on Video ID), and entries get thumbnail covers
  after the next restart.
- **Velocity watch**: publish day → run yt-monitor a few times in the first
  48 h; the tracking block turns snapshots into measured views/hour.
- **Dashboards**: ask the main assistant to render any `reports/*.md` as a
  visual artifact — on demand, not stored code.

### Phase 3 — Deferred capabilities (each has a defined trigger)
| Item | Status | Trigger / requirement |
|---|---|---|
| Write-back to YouTube (update titles/descriptions/tags from yt-optimize output) | Proposed, not approved | Needs the `youtube.force-ssl` write scope added to OAuth + re-auth, plus per-video confirmation UX. Do only when the user asks to close the analyze→apply loop. |
| Whisper/ASR fallback for caption-less videos | Deferred (decided) | Add only if caption-less videos are actually blocking analyses in practice. |
| Paid keyword data (DataForSEO) | Deferred (decided) | Only if autocomplete demand signals prove insufficient. |
| Vector DB over transcripts | Ruled out for now | Revisit if the Notion catalog reaches hundreds of videos and cross-video search becomes a real need. |

### Phase 4 — manfriday.app productization (user-signaled, not yet scoped)
The user has referenced manfriday.app repeatedly; groundwork already in repo:
the **web OAuth client** (`client_secret_web.json`), a referrer-restricted
API key pattern (deliberately separate from the local server key), and the
**pitch deck** (`deck/`, Aug 2 evening) — problem → 2025-26 research → three
value props (analyst team / learns your channel / always-on research) →
outcomes. Capability check done the same evening: value props 1 and 3 are
supported by the live stack; value prop 2's learning loop is now backed by
the recommendation ledger (§4).

**Storage architecture (decided Aug 2 — APPLIED Aug 2–3):**
- **Supabase (Postgres) is the system of record** — users, per-user OAuth
  refresh tokens, channels, analytics/view-count snapshots, monitor state,
  reports. Chosen over Firebase: the data is relational (users → channels →
  videos → snapshots → reports), Supabase ships Google OAuth sign-in and
  row-level security out of the box, plain Postgres integrates cleanly with
  the existing Python tool logic, no vendor lock-in.
- **Notion / Google Drive / file download are one-way export destinations
  only** — never the primary store, never bidirectional sync. The existing
  MCP export tools (`save_report_to_notion`, Drive connector) carry over
  as-is.
- **User sovereignty guarantees**: full data download anytime; account
  deletion purges everything (tokens revoked, rows deleted); plain-language
  privacy policy stating so — required for Google app verification anyway.
- **Sequencing**: ✅ schema APPLIED ahead of the web app (Aug 2–3), designed
  from the working local stack rather than a speculative design: project
  `jxlhvxkaetuhtmwjvlym`, 12 migrations, 14 RLS-enabled tables. Per-user
  (all cascade from auth.users): profiles, google_oauth_tokens +
  export_connections (both app-layer-encrypted, deny-all RLS, service-role
  only), channel_profiles (yt-profile.md port), channels, videos
  (+ category/topics/summary catalog columns), channel/video_snapshots +
  channel_baselines (append-only), monitor_state, reports, recommendations
  (full field-level yt-ledger.jsonl port — a code audit caught and fixed a
  status-CHECK bug that would have rejected the `resolved` lifecycle).
  Shared caches (not user data): thumbnails (+ public storage bucket) and
  api_cache (pg_cron purge every 30 min). Sovereignty is implemented:
  `export_my_data()` RPC returns everything about the caller;
  account purge = revoke token at Google → `auth.admin.deleteUser()` → one
  cascade. Reference: `supabase/SETUP.md`. Nothing in the local tool reads
  or writes it — the local tool stays files + Notion until the web app
  exists. Remaining setup is dashboard-side (Google auth provider with the
  web client, redirect URIs, site URL — SETUP.md lists them).

To take this stack multi-user:
1. Web app implements "Sign in with Google" using the web client; store
   **per-user refresh tokens** in the Supabase DB (the current single-file
   token is single-user by design). The `google_oauth_tokens` table is ready
   for this — keep identity sign-in (basic scopes) separate from the
   "Connect your YouTube channel" incremental-consent flow (see SETUP.md).
2. Leave Testing mode: Google **app verification** — privacy policy + ToS
   live on manfriday.app, domain verification, sensitive-scope review
   (YouTube scopes; includes a demo video; days-to-weeks). Until then: 100
   test users max, manually allowlisted.
3. Mint a separate browser key restricted to manfriday.app referrers; keep the
   server key unrestricted-by-app + API-restricted as today.
4. The MCP server's tool logic is reusable server-side as-is; only credential
   plumbing (per-user tokens instead of `.env`/token file) changes.

## 11. Aug 3 update — Supabase layer live (applied, audited, tested end to end)

Everything here happened Aug 2 late–Aug 3 through the Supabase MCP server and
is recorded in full detail in `sqlstatus_aug3.md`; this is the summary of
record.

**Applied.** Fresh project `jxlhvxkaetuhtmwjvlym` (verified empty first: 0
tables / 0 migrations / 0 auth users) now carries **12 migrations → 14
RLS-enabled tables** — 12 per-user, every one cascading directly from
`auth.users`, plus 2 shared caches (`thumbnails` + `api_cache`) — the
`thumbnails` storage bucket, `moddatetime` + `pg_cron` extensions, and the
`purge-api-cache` job (every 30 min, confirmed active in `cron.job`).
Migrations mirrored 1:1 in `supabase/migrations/`; reference in
`supabase/SETUP.md`.

**Audited against the code.** The schema was diffed line-by-line against
`server.py` and the agent definitions rather than the design docs. One real
bug caught before any data existed: the `recommendations` status CHECK
rejected the ledger's `resolved` lifecycle (`update_recommendation` sets it
with every verdict) — fixed in migration 7 and later proven by test. Missing
ledger fields (`notes`, `resolved_at`, `baseline_error`,
`result_baseline_error`) added; one deliberate remodel (monitor velocity
tracking moved into `video_snapshots` rows); `videos.category` left
unconstrained on purpose (yt-catalog's taxonomy is canonical-10 but open).
Security advisors: one real finding fixed (`handle_new_user` was
client-callable via REST RPC — migration 6); every remaining lint is an
intentional deny-all design.

**Tested — 11 tests, all passed.**
- Tests 1–10 (SQL, two simulated users, DB returned to empty): sign-up
  trigger, `updated_at` trigger, CHECK/unique rejections, the
  resolved+verdict state, RLS isolation from both users' perspectives
  (cross-tenant insert fails 42501, append-only update touches 0 rows,
  token table permission-denied even for its owner, anon sees nothing),
  `export_my_data()` complete and ciphertext-free, cache purge, and the
  one-statement account-deletion cascade.
- Test 11 (real traffic): Google provider enabled with the **web** client
  (`client_secret_web.json`; the Desktop client's secret was pasted first
  and failed `invalid_client` — the auth logs pinpointed it at `/callback`
  in seconds). Real sign-in as ramanac@gmail.com via
  `supabase/test-signin.html` on localhost:3000: `auth.users` row + Google
  identity + auto-created profile ("Venkata CVR", avatar from Google
  metadata) + `export_my_data()` over PostgREST with the real session JWT;
  all other tables untouched. The first real user is now in the DB.

**Docs and repo.** New this session: `supabase/` (12 migration files,
SETUP.md, test-signin.html) and `sqlstatus_aug3.md` (migration ledger, code
audit, full test log, 13 SQL/OAuth gotchas). Git: repo initialized and
pushed to github.com/qashsolutions/manfriday — `721cf7a` (initial, 37
files), `a479979` (test suite + sqlstatus doc); the sign-in-verification
doc updates and this section are pending commit.

**Competitive research (Aug 3, local only).** Deck reviewed against a
two-track landscape sweep (software tools; education/communities/services)
plus a direct review of a $117/mo creator Skool community. Conclusion: the
deck's thesis is validated and the product's six core capabilities map onto
gaps no shipping tool fills. Full analysis, problem statements, and pricing
implications live in `deck/findings.md` — deliberately gitignored (strategy
work product, not for the public repo). Next: web app screen design.

**Still ahead (unchanged from §10):** fill `.claude/yt-profile.md`, re-auth
the local OAuth token to the real content channel, Google app verification
to leave Testing mode, production URLs at launch (Site URL →
manfriday.app), and the web app itself — the schema is ready and waiting
for it.

## 12. Web app design (Aug 3): mockups, evaluation, decisions

**Screen-flow mockups, v1 → v3** (private design artifact:
claude.ai/code/artifact/91ef2bfa-126b-417a-b67d-fe2fe6bacd9d). One scenario
carried through the entire product — landing → connect → first analysis →
first results → daily Desk → "Why videos win or die" → titles &
thumbnails → idea list → Ledger → weekly report (phone) → data settings.
11 screens after v3 (the sign-in interstitial was deleted so "two clicks to
first results" is literally true).

- **v1 → v2** (user review): the team became a named **team of six**
  (Retention Analyst, Packaging Analyst, Audience Analyst, the Scout, the
  Researcher, the Scorekeeper) introduced on the landing page; the profile
  form left the critical path; all technical language and name-drops
  removed from product copy.
- **v2 → v3** (7-agent evaluation + API audit): 4 creator personas + 2
  auditors + adversarial critic scored every screen on so-what / how /
  value from the user's chair (all 6 would sign up; conversion path
  S4/S6/S10 strongest; detailed scorecard in local-only
  `deck/mockup-eval.md`). Applied: apply-loop closed everywhere (Copy /
  Open in YouTube Studio / Mark applied), price+proof before the connect
  wall, "Today's one thing" Desk strip, day-1 empty-state specs, honesty
  fixes. **API-truth substitutions verified against Google's docs**:
  thumbnail impressions/CTR do NOT exist in the Analytics API (Studio-only)
  → replaced with Browse-reach collapse from traffic-source data;
  "audience overlap" → content-gap from public data; best-time-to-publish
  and search-trend claims deleted (no API source).

**Decisions locked:** light theme, premium-flagship bar · responsive web +
installable PWA, no native apps at launch · team-of-six as the interface
(bylines on every artifact) · **hosting on Vercel** (cost-driven choice
over AWS) · pricing parked for later evaluation · build order: app shell +
Desk → Why-it-died → Titles & thumbnails → Ledger → Weekly report →
onboarding.

**Open build items carried from v3:** the package detail view, the daily
brief cadence (product says "every day", heartbeat is weekly), a
"report a wrong claim" affordance on quoted transcript lines.

**Three post-build decision points (build all three eventually; SEQUENCE
to be decided after the web app ships):**
1. **Cross-platform integrations** — Instagram, TikTok, Facebook. Note
   from the Aug 3 feasibility analysis: those platforms' APIs don't expose
   retention-grade data, so parity of insight isn't achievable —
   realistic scope is the distribution/repurposing layer on top of
   YouTube-depth.
2. **Mobile-specific features** beyond the PWA (what, if anything, needs
   more than the installable web app + push + email digests).
3. **Direct video/reel analysis** — feed the actual video content to
   Claude for multimodal analysis via a third-party video API/MCP.
   Candidate named: Higgsfield MCP/API — verify fit when scoping
   (Higgsfield is primarily a video *generation* platform; direct
   *analysis* may need a video-understanding API instead). This option
   deepens the existing moat rather than broadening platforms.

**Build phase started (Aug 3, later).** Stack: Next.js (App Router,
TypeScript) in `webapp/`, Supabase JS + SSR clients, deploy target Vercel.
Scope additions from the user for v1 settings: **email-OTP login**
alongside Google sign-in, **MFA** (authenticator app), **dark/light mode
toggle** (supersedes the earlier light-only decision — both themes ship),
connections management (see what's connected, disconnect), **pause
account** (new `profiles.paused_at`, migration 13), delete account, and a
payment/billing surface (pricing still parked — surface ships as
placeholder).

## 13. Aug 3 update — the analyst layer is live (LLM analysts via Claude API)

The judgment layer shipped: four server-side analysts in `webapp/`, all
calling **Claude Opus 5** (`claude-opus-5`, Anthropic TS SDK, structured
JSON outputs, server-side refusal fallback to Opus 4.8). Shared helper:
`src/lib/server/claude.ts` — one entry point (`analystJson`), a common
`TEAM_RULES` system preamble enforcing plain English and the verified
API-truth limits (no thumbnail impressions/CTR, no audience overlap, no
publish-timing, no search volumes — "many people type this" only).

| Analyst | Route | Reads | Writes |
|---|---|---|---|
| Retention Analyst | `POST /api/analyst/retention` | real retention curve + drops, live title/description, baseline, optional pasted transcript | `reports` (rendered on `/why/[id]`) + 1–3 fixes to `recommendations` |
| Packaging Analyst | `POST /api/analyst/packaging` | draft title vs the creator's own winners/misses (`channel_baselines.videos`) + live autocomplete phrases | returns grade + 3 rewrites; picks logged to Ledger client-side |
| Audience Analyst | `POST /api/analyst/ideas` | up to ~200 channel comments (Data API, OAuth) | deduped ideas → `recommendations` (`target_type='idea'`) with verbatim receipts |
| The Team (weekly) | `POST /api/analyst/weekly` | stored snapshots/baselines/ledger/ideas only | 3-section report → `reports` (honest "tracking starts now" when no history) |

UI: `/why/[id]` shows the saved read (+ Ask/Ask-again, optional script
paste), `/packaging` grades live with per-rewrite "log it", `/ideas` has
"Read my comments", `/reports` has "Write this week's report". All routes
`maxDuration = 120`; thin-data honesty threads through every prompt.

**New env var: `ANTHROPIC_API_KEY`** (server-only; in `.env.example`).
Must be set in Vercel (and `.env.local`) — routes return 501 with a
friendly message until it is. Transcripts are user-pasted for now
(captions API needs the `youtube.force-ssl` scope we deliberately don't
request); comment mining uses the existing readonly scope.

**Public site added (Aug 3, later):** real landing page at `/` (deck's
story: "Creators run real businesses. Most run them blind." → stat band →
team of six → how-it-works → honesty/ledger → closing quote), sticky
header + footer, `/terms` + `/privacy` (plain-English, includes the
YouTube API Services / Google Limited Use disclosures and revocation
links), legal links + About card in Settings. Click-path change:
signed-in visits to `/` and successful logins now land on **/desk** (was
/settings). Style consolidation: public-site classes + shared `.t` table,
`.aside-note` (was referenced but never defined — now fixed), `.quiet`,
`.sub`, `.vcell` utilities all central in `globals.css`.

## 14. Aug 4 update — Scorekeeper live + grounded confidence everywhere

One release, two halves (user-confirmed outline):
**A. The trust loop closes.** Daily Vercel Cron (`webapp/vercel.json`,
`/api/cron/daily`, locked by new env `CRON_SECRET`) refreshes every active
channel (shared engine `lib/server/refresh.ts` — first-run now uses the
same code) and runs `lib/server/scorekeeper.ts`: pure-arithmetic verdicts
on applied tips (≥7 days; video tips = views/day before→after; channel/
idea tips = first upload ≥5 days old vs format normal; 1.5×/0.75×
thresholds; "unclear" said plainly). Ledger UI got the lifecycle:
"I applied this"/Skip → "checking — day N of 7" → before→after bars +
verdict pill (`components/Verdict.tsx`).
**B. No one-size-fits-all.** Migration 14 (`reports.data` jsonb;
`recommendations.confidence` 0-100 + `evidence` jsonb — applied via MCP,
advisors clean). Every analyst now reads `lib/server/grounding.ts`
(user-defined audience from channel_profiles + the Scorekeeper-verified
track record) and follows `OPTIONS_RULES` in `claude.ts`: packaging
returns three TYPED options (safe = own winners / reach = typed phrases +
audience / bold = untested, confidence-capped), all confidence scores are
DERIVED from citable evidence chips (ledger/library/search/audience/
caution) with hard caps on thin data. UI: confidence sliders + evidence
chips on packaging cards, retention fixes (rendered from `reports.data`),
idea list, and open Ledger tips.
**User action:** add `CRON_SECRET` (in `.env.local`) to Vercel env vars.

## 15. Aug 4 update — guide stance shipped + Scout & Researcher live

**Guide stance locked** (user decision, recorded in CLAUDE.md "Guide stance"):
options never orders · views-only comparisons with neutral observable
factors · no invented numbers · money guidance from the user's own data
only · no overselling. Live-verified that day: Packaging (B− + 3 options →
ledger) and Retention (real curve, artifact detection) on manfriday.app.

**Commit 2e40f3f — stance fixes across the team:**
- Migration 15 (`profile_preferences`, applied via MCP, advisors clean):
  `channel_profiles` + `language_culture`, `monetization`, `risk_appetite`,
  `effort_budget`, `constraints_notes`.
- `grounding.ts` reads the full profile (incl. `products_links`, `formats`)
  + the new preferences, with stance wiring in each line.
- Profile page: five new optional fields (risk pills safe/balanced/bold).
- Retention Analyst: fixes now OFFERED with `effort` tags (small tweak /
  medium edit / bigger change), rendered as pick cards on `/why/[id]`;
  picks logged client-side with a views baseline for the Scorekeeper.
  No more auto-logging.
- Drop cards: single "steepest loss" label, deltas capped at 100, >100%
  spike artifacts called "a counting blip", matching the analyst's prose.
- Weekly report: "Needs you (one decision)" framed with its choices.

**Commit 4aa6848 — the team of six is complete:**
- **The Scout** — `/scout` + `POST /api/analyst/scout`. Paste any public
  video → neutral factor table (them vs you: recency, channel size,
  ran-vs-THEIR-own-normal via uploads-playlist median, length, engagement
  per 1000, packaging, typed phrases) + "you can act on / out of your
  hands" + 3 typed takeaways (safe/reach/bold) pickable into the Ledger
  (`agent='The Scout'`, target_type='channel'). Rejects the user's own
  videos (points at /why). Report saved (`agent='The Scout'`).
- **The Researcher** — `/research` + `POST /api/analyst/research`. Topic →
  search sweep (15 results, stats + subs + views-to-subscribers "travel"
  signal + typed phrases) or video link → single-video read vs that
  channel's own normal. Plain-English report with an honest what-this-
  can't-know line; saved to `reports` (`agent='The Researcher'`), listed
  on `/reports` (page retitled "Reports").
- Shared `lib/server/publicYt.ts` (parseVideoId, public video/channel
  fetch, channel-normal median, typedPhrases — packaging imports it now).
- Nav: "Learn from any video" + "Research a topic"; all six seats "ready".

**Deploy verified live** on manfriday.app both commits (landing copy poll).
Session findings: 30-min idle sign-out in app layout is by design
(`mf-last-active`). Live tests still owed post-deploy: Audience Analyst
(/ideas), weekly report, retention pick-flow, Scout, Researcher.

**Live test round (Aug 4, later — all six seats verified on production):**
Retention: pick-flow live, logged state persists across reload, drop cards
show single "steepest" + "counting blip" artifact copy ✓ · Scout: full run
vs a real competitor video — factor table with their-own-median (1.64×),
honest out-of-your-hands column, pick logged to Ledger ✓ · Researcher:
topic sweep produced a two-kinds-of-channel read with views-to-subscribers
travel multipliers, angles-as-choices, and the closing honest-limits
paragraph ✓ · Weekly report: "Needs you (one decision)" framing rendered
verbatim ("…or skip it and tell us why") ✓ · Audience Analyst: found a real
bug — YouTube's channel-wide `commentThreads?allThreadsRelatedToChannelId`
now returns 400 processingFailure (reproduced with a direct call); rewrote
to a per-video sweep over the ~15 latest uploads (commit 1a66f18); verified
the honest 409 empty state (this channel truly has 0 comments; one video
has comments disabled and is skipped). Full idea-mining output still needs
a channel with real comments to exercise.

**Aug 4, later still — the comparison desk + every known open closed
(commits 1ed479a, 0ba9df5, 6dbbaf6):**
- **The comparison desk** (core flow, now in CLAUDE.md): /scout compares
  ONE OF THE CREATOR'S OWN videos (picker; or channel normal) with any
  outside video on four things — views (each vs its own channel's normal),
  viewer comments/asks (verbatim receipts), titles, account owner. Bylined
  sections from Scout/Packaging/Audience/Retention + 3 pickable takeaways.
  Live-tested on the user's example (JAC66sNSht0 vs their concert video):
  correctly called the 727× breakout unrepeatable and the gap "mostly
  channel size, catalogue, and one video catching fire — not a mistake you
  made".
- Thumbnail review shipped (packaging accepts a draft image; Claude vision
  judges it beside up to 3 of the creator's own recent thumbnails); page
  honestly "Titles & thumbnails" again.
- Researcher takeaways are typed/pickable/logged. Migration 16
  (`recommendations.option_type`): every pick records safe/reach/bold;
  grounding feeds the counts back as revealed preference.
- Quota: api_cache backs search (24h, shared) + competitor channel-normal.
- **Bug found: comment endpoints were NEVER readable via OAuth** — the
  youtube.readonly scope doesn't cover commentThreads (403, reproduced);
  public comments now read with `YOUTUBE_API_KEY` (new webapp env var —
  MUST be added in Vercel; documented in webapp/.env.example).
- Weekly reports now also write themselves Mondays via the daily cron
  (writeWeeklyReport lib shared with the route; 6-day dedupe).
- "Spot a wrong claim → tell us" affordance on every analyst read
  (mailto hello@manfriday.app — create that alias); ideas empty-state
  points to the comparison desk. Remaining opens: onboarding polish,
  pricing screens (pricing parked by user decision).

## 16. Aug 4 update — the cardinal rule + Desk content pass

**THE CARDINAL RULE (user-set, non-negotiable, now in CLAUDE.md):** every
single line of product copy MUST state its value to the user — how it helps
them increase views / improve content, and therefore revenue. A line either
tells the user how to get more views, or honestly explains why we can't tell
them yet. Anything else is faff and gets deleted. Metrics may appear
ONLY in simple English and with why they matter spelled out — the chain is
always: better content → viewers stay longer → YouTube shows it to more
people → more views → more subscribers → revenue. Every metric shown must
point at one link of that chain; no raw jargon (×-ratios, medians,
"baselines"), plain words that say what to DO.

**Page-by-page content review started with the user (the Desk done,
commits a8fd227 → 0c329af, all verified live):**
- "Updated from your YouTube numbers" → italic + real last-pull timestamp.
- Objective line under the headline: "Today's numbers, today's one thing
  to do."
- Team track record card shows the value: verdict tallies once they exist
  ("3/5 worked · …"), else "N waiting — every tip you apply gets checked
  against your real numbers", linking to the Ledger.
- **The ratio notation is dead.** After three review rounds it was still
  meaningless to the user — the fix was never phrasing, it was purpose.
  The column is a lesson-router and now says so: "did something right —
  study it" / "fell short — find out why" / "typical for you" (header:
  "What it tells you"). In early days it shows plain facts ("1 view vs
  your usual 12") plus one honest line — no fake judgment. Same treatment
  on the why-list page.
- Measuring stick card: full width, two sentences, the user's own number
  ("That's your bar. Beat it and you've genuinely done better").
- "Your team is on duty" → "What your team can do for you right now":
  five outcome-first links with analyst bylines.
- Every row always has an action (Open / Why? / What worked?).
- **Discovery: 11 of the test channel's 14 videos are PRIVATE** — private
  videos only get short-lived signed thumbnail URLs from the API (that's
  why images "disappeared overnight"). Thumb component now falls back to a
  clean grey block on load failure; daily cron re-fetches fresh URLs.
- Plain-English rewrites of both early-days notes (Desk + why list).

**Still to review page-by-page:** why detail, Titles & thumbnails, Idea
list, Compare with any video, Research a topic, Ledger, Reports, Settings,
Profile, landing page.
