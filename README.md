# manfriday — YouTube MCP + Agents

A YouTube toolkit for Claude Code: a custom MCP server (works on **any public
YouTube URL**, no account needed) plus ten agents built on top of it.

## Layout

```
youtube-mcp/          Python MCP server (FastMCP, stdio)
  server.py           25 tools: transcripts, metadata+performance, search,
                      channel/playlist listing, comments, channel stats,
                      private analytics (OAuth), Notion catalog + reports,
                      recommendation ledger (the learning loop)
  .venv/              its own virtualenv
.mcp.json             registers the "youtube" MCP server with Claude Code
.claude/agents/       yt-summarizer, yt-qa, yt-compare, yt-optimize, yt-audit,
                      yt-audience, yt-catalog, yt-researcher, yt-monitor,
                      yt-studio
supabase/             manfriday.app storage layer (Phase 4 groundwork):
                      12 applied migrations + SETUP.md reference (see below)
```

## MCP tools (`mcp__youtube__*`)

| Tool | What it does | Needs key? |
|---|---|---|
| `get_video_info` | Metadata + performance stats: views/day, likes per 1k views, subscribers, views-to-subscriber ratio, chapters, Shorts detection | no (better with) |
| `get_transcript` | Full transcript, optional timestamps, language fallback | no |
| `get_video_heatmap` | Public "most replayed" curve — retention proxy without OAuth | no |
| `get_thumbnail` | Downloads the thumbnail image so agents can critique it **visually** | no |
| `search_videos` | Search YouTube | no (better with) |
| `get_search_suggestions` | YouTube autocomplete — real search demand, with a–z fanout | no |
| `get_channel_videos` | Latest uploads of a channel | no |
| `get_channel_stats` | Subscribers, total views, video count | no (better with) |
| `get_channel_baseline` | Per-format (Shorts vs long) view baselines + outlier flags | no (better with) |
| `get_playlist_videos` | Expand a playlist | no |
| `get_comments` | Top-level comments (audience reaction) | no (better with) |
| `get_channel_rss` | Latest uploads via YouTube's **official RSS feed** — no key, no quota, no scraping | no |
| `get_oauth_status` | Check whether private-analytics OAuth is configured | OAuth |
| `get_my_channel_analytics` | Your channel: views, watch time, subs gained/lost, daily trend | OAuth |
| `get_my_video_analytics` | Your video: lifetime/period private metrics | OAuth |
| `get_my_video_retention` | Your video's **real retention curve** + steepest drop-offs | OAuth |
| `get_my_traffic_sources` | Search vs Suggested vs Browse vs External breakdown | OAuth |
| `get_my_audience` | Age/gender, top countries, devices | OAuth |
| `get_my_top_videos` | Top videos with private metrics for a period | OAuth |
| `setup_notion_database` | One-time: create the Notion video-catalog DB | Notion key |
| `add_video_to_notion` | Upsert a categorized video into the catalog | Notion key |
| `save_report_to_notion` | Save any agent report as a Notion page (real tables) | Notion key |
| `log_recommendation` | Learning loop: record advice given, with an automatic baseline metrics snapshot | no |
| `update_recommendation` | Mark a past recommendation applied/skipped and record how it turned out | no |
| `get_recommendation_ledger` | Read past advice + outcomes (with current-vs-baseline deltas) — agents check this before advising | no |

**Access policy: official APIs first, scraping last-resort.** With
`YOUTUBE_API_KEY` set, metadata, search, channel/playlist listings, baselines,
and comments all run on the official Data API; monitoring runs on official RSS;
private analytics run on the official Analytics API (OAuth). Scraping (yt-dlp)
remains only as a keyless fallback plus two things that have no official API:
transcripts and the public most-replayed heatmap. Scraping paths are hardened
with a 15-min cache, retries with backoff, and actionable error messages.

> **Known limitation:** "how many subscribers watched this video" is owner-only
> YouTube Studio data. The public proxy is `views_to_subscriber_ratio`. If you
> own the channel, the YouTube Analytics API (OAuth) can be added later for the
> real number, plus retention curves and CTR.

## Agents

| Agent | Job |
|---|---|
| `yt-summarizer` | Structured summary + performance snapshot + most-replayed moments for any video URL(s) |
| `yt-qa` | Answer questions grounded in video transcripts, with timestamps |
| `yt-compare` | Compare videos on the same topic — normalized metrics, **visual thumbnail face-off**, heatmap-vs-transcript analysis, what works / what doesn't, recommendations |
| `yt-optimize` | Generate the upload package: 5 title variants, description with chapters, tags, hook rewrites, thumbnail critique + briefs, first-48h launch checklist |
| `yt-audit` | Channel health audit: per-format baselines, outliers, cadence, packaging consistency (visual), graded scorecard + prioritized fixes |
| `yt-audience` | Mine comments for content requests, questions, complaints — ranked idea backlog cross-checked against search demand |
| `yt-catalog` | Categorize videos (topic, content type, duration) and auto-populate the Notion database |
| `yt-researcher` | Research a topic across many videos, synthesize one cited report |
| `yt-monitor` | Detect new uploads (via official RSS) + track view velocity over time (state file; pair with `/loop` or a scheduled agent) |
| `yt-studio` | **Your own channel's private analytics** (OAuth): real retention curves cross-referenced with transcripts, traffic sources, demographics, top videos |

**Channel profile:** fill in `.claude/yt-profile.md` (channel, products, tone,
publish windows) — agents read it to personalize everything they generate.

**Reports & export:** analysis agents tabulate results as Markdown tables and
save a copy under `reports/`. Ask to export any report to **Notion**
(`save_report_to_notion` → real Notion tables) or **Google Drive** (via the
claude.ai Google Drive connector, when connected). Ask the main assistant for
a visual dashboard artifact if you want charts.

Just ask naturally — "summarize this video <url>", "compare my video <url> with
<url>", "catalog @somechannel's last 20 videos into Notion" — and Claude Code
delegates to the right agent.

## Setup

### 1. Enable the MCP server
Restart Claude Code in this directory and approve the project-scoped `youtube`
MCP server when prompted. Verify with `/mcp`.

### 2. Secrets: `.env` file (gitignored)
Copy `.env.example` to `.env` in the project root and fill in values — the MCP
server loads it at startup (real shell env vars take precedence). All secret
files are covered by `.gitignore`:

| Secret | Where it goes |
|---|---|
| YouTube Data API key | `.env` → `YOUTUBE_API_KEY=` |
| Notion token / IDs | `.env` → `NOTION_API_KEY=` etc. |
| OAuth client JSON (downloaded from Google) | save the **file** as `youtube-mcp/client_secret.json` |
| OAuth token | auto-created at `youtube-mcp/.oauth-token.json` by `authorize.py` |

**Getting the Data API key** (recommended — enables official-API paths):
[Google Cloud Console](https://console.cloud.google.com/) → your project →
**Credentials → Create credentials → API key**. Free quota: 10,000 units/day
(a search costs 100 units; metadata/comments cost 1). This is a separate
credential from the OAuth client JSON.

### 3. Optional: OAuth for your own channel's analytics (yt-studio)
Only needed for the `get_my_*` tools — real retention, traffic sources,
demographics. Works ONLY for channels your Google account owns.
1. In the same Google Cloud project, enable **YouTube Analytics API** (in
   addition to YouTube Data API v3)
2. **Credentials → Create credentials → OAuth client ID → Desktop app** →
   download the JSON → save as `youtube-mcp/client_secret.json`
3. Run once: `youtube-mcp/.venv/bin/python youtube-mcp/authorize.py`
   (opens a browser for Google sign-in; token saved locally with auto-refresh)

### 4. Optional: Notion (for yt-catalog and report export)
1. [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration** (internal) → copy the token
2. In Notion, open the page where the catalog should live → **⋯ → Connections → add your integration**
3. `export NOTION_API_KEY="ntn_..."` and add it to `.mcp.json` env
4. Ask Claude: *"set up my Notion video database under page <page-id>"* — then put
   the returned `database_id` in `.mcp.json` as `NOTION_DATABASE_ID`

`.mcp.json` env block once everything is configured:

```json
"env": {
  "YOUTUBE_API_KEY": "${YOUTUBE_API_KEY:-}",
  "NOTION_API_KEY": "${NOTION_API_KEY:-}",
  "NOTION_DATABASE_ID": "<your database id>"
}
```

## manfriday.app storage layer (Supabase — Phase 4 groundwork)

The multi-user schema for the future manfriday.app is designed and **already
applied** to Supabase project `jxlhvxkaetuhtmwjvlym` — 12 migrations,
mirrored 1:1 in `supabase/migrations/`. The local toolkit does **not** read
or write it; it stays files + Notion until the web app exists.

What it models (14 tables, row-level security on everything):

- **Per-user** (all cascade from `auth.users`): profiles, encrypted YouTube
  OAuth refresh tokens, encrypted Notion/Drive export credentials, channel
  profiles (the `yt-profile.md` equivalent), channels, videos (+ catalog
  category/topics/summary), snapshot time series, persisted channel
  baselines, monitor state, reports, and the recommendation ledger — audited
  field-level ports of the local stores in `server.py` and the agent
  definitions.
- **Shared caches** (not user data): thumbnails (public storage bucket,
  deduped across users) and a Postgres API cache replacing the in-memory
  15-min TTL cache, purged by a pg_cron job.

Sovereignty is built in: the `export_my_data()` RPC returns everything the
app stores about the caller as one JSON download, and deleting the auth user
cascades every row away (after revoking the Google token).

Full reference — schema diagram, security model, OAuth-flow design, and the
remaining dashboard steps (Google auth provider, redirect URIs) — in
`supabase/SETUP.md`.

## Maintenance

- yt-dlp breaks occasionally when YouTube changes internals — fix with
  `youtube-mcp/.venv/bin/pip install -U yt-dlp`.
- Server deps: `youtube-mcp/requirements.txt`.
