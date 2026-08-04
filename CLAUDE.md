# manfriday — session guide

A YouTube analysis/marketing toolkit (25-tool MCP server + 10 agents) being
productized into **manfriday.app** — "an AI analyst team for the business of
one."

## Read these before substantial work

| Doc | What it is |
|---|---|
| `status_aug2.md` | Authoritative project status: tools, agents, config, verification log, roadmap (§10), Aug 3 Supabase changelog (§11). Has a TOC. |
| `sqlstatus_aug3.md` | Supabase layer: migration ledger, code audit, full test log, SQL/OAuth gotchas |
| `supabase/SETUP.md` | DB schema reference, security model, sovereignty flows |
| `deck/findings.md` | **LOCAL ONLY — gitignored, never commit or quote in committed files.** Competitive research, gap analysis, the five problem statements, pricing strategy. This is the product's secret sauce; read it before any product/design/positioning work. |

## Hard rules

- **Never commit**: `.env`, `client_secret*.json`, `.oauth-token.json`,
  `deck/findings.md`, `reports/`, `.claude/yt-*.{json,jsonl}` — all
  gitignored; keep it that way.
- **Two Google OAuth clients, not interchangeable**:
  `youtube-mcp/client_secret.json` (Desktop) = local MCP server only;
  `youtube-mcp/client_secret_web.json` (web) = Supabase Auth / manfriday.app.
  Their secrets differ.
- **Supabase** (project `jxlhvxkaetuhtmwjvlym`): schema changes go through
  migrations — write the file in `supabase/migrations/` AND apply the same
  SQL via the MCP `apply_migration`; keep the mirror exact. Run the security
  advisors after DDL.
- **Supabase is the system of record** for manfriday.app; Notion/Drive/file
  downloads are one-way exports only.
- The MCP server (`youtube-mcp/server.py`) loads `.env` only at startup —
  env var changes need a session restart.

## Product direction (from deck + findings)

Positioning: the $15K/month human strategist function, delivered as an
always-on AI analyst team at creator prices. Differentiators no competitor
ships: retention-curve × transcript analysis, the recommendation ledger
(closed learning loop), genuinely agentic operation, private+public data in
one reasoning chain. Web app design bar: premium flagship quality, modern,
light background. Users meet a "team of six" analysts — never tech jargon.

## Guide stance (Aug 4 — applies to every analyst and all product copy)

manfriday is a **guide, not an oracle**. Locked principles:

- **Options, never one tip.** Every analyst offers 2–3 typed choices (the
  packaging safe/reach/bold pattern is the template) and the user makes the
  call. Retention fixes should become pickable option cards too, with
  effort tags (minimal edit / re-cut / format change), not auto-logged.
- **Preferences the user declares** (in `channel_profiles`, always off the
  critical path): target audience, language/cultural context, monetization
  stage + income mix, risk appetite, effort budget, constraints — never ask
  for what the API already knows (actual viewer demographics come from
  Analytics). Ledger picks + Scorekeeper verdicts are revealed preference;
  they outrank any form field.
- **Comparing other creators' videos: views only, never revenue.** The core
  flow (user-defined): the user picks ONE OF THEIR OWN videos and a similar
  outside video, and the team reads them side by side on four things —
  **# of views** (each vs its own channel's normal), **comments/asks from
  viewers** (verbatim receipts from both videos' public comments), **title**
  (packaging comparison + typed phrases), and **account owner** (channel
  size/age/catalogue — the honest out-of-your-hands factors). Explain view
  gaps with observable, neutral factors only, so the user can make a better
  call. Never speculate about anyone's earnings; never invent numbers.
- **Monetization = guidance, not projections.** Ground money talk in the
  user's own Analytics revenue/RPM (if monetized) and income-mix options;
  no fabricated dollar figures anywhere.
- **Honest, grounded, neutral, practical.** Don't oversell what the agents
  can do; say thin data plainly (existing honesty threads + confidence
  caps). Design around what the APIs DO surface — public: stats, baselines,
  search suggestions, comments, transcripts, heatmaps; private: retention,
  traffic sources, demographics, own revenue — and don't build or write
  copy around what they can't.
- Terms already carry the YouTube API Services / Google Limited Use
  disclosures (status_aug2.md §13); keep them current as features grow.

Approved v3 screen mockups: artifact
claude.ai/code/artifact/91ef2bfa-126b-417a-b67d-fe2fe6bacd9d (source:
session scratchpad `manfriday-flow-mockups.html`; eval scorecard in
local-only `deck/mockup-eval.md`). Hosting: **Vercel**. Shipped: app shell,
Desk, Why-it-died (+ live Retention Analyst), Titles & thumbnails (live
Packaging Analyst), idea mining (Audience Analyst), weekly reports, Ledger,
settings — see status_aug2.md §13. The analyst layer calls Claude Opus 5
via `webapp/src/lib/server/claude.ts` and needs `ANTHROPIC_API_KEY`
(server-only, in Vercel + `.env.local`). Still open: onboarding polish,
scheduled runs, pricing screens. API hard limits to respect in ALL product
work: no thumbnail impressions/CTR, no audience overlap, no
best-time-to-publish, no search-volume trends — status_aug2.md §12 lists
the verified substitutions.
