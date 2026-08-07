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

**THE CARDINAL RULE (Aug 4, user-set, non-negotiable, overrides everything
below when in tension):** every single line of product copy MUST be about
the value it provides to the user — how it helps them **increase views /
improve their content, and therefore revenue**. That is the ONLY focus.
A line either tells the user how to get more views, or honestly explains
why we can't tell them yet. Anything else is faff — delete it. Corollaries:
- **Metrics must earn their place.** A metric may appear ONLY in simple
  English AND with why it matters spelled out — the chain is always:
  better content → viewers stay longer (retention/watch time) → YouTube
  shows it to more people → more views → more subscribers → revenue.
  Every metric shown must point at one link of that chain ("where viewers
  stop watching" → keep them longer; "views vs your usual" → which videos
  to copy or fix; "what people type" → titles that get found).
- No raw jargon: not "×-ratio"/"median"/"baseline" but "your usual video
  gets about 12 views". Numbers never stand alone — a number without the
  action it points to is meaningless.
- UI elements exist to route the user to their next views-improving action
  (e.g. the video list's comparison column is a lesson-router: "did
  something right — study it" / "fell short — find out why"), not to
  display metrics.

**Lessons on advice quality (Aug 5, from user challenge — apply to analyst
prompts AND to session reports to the user):**
- **The insight is what the data reveals that the user couldn't see** (e.g.
  "zero of your 15 views came from search — every one was a link you
  shared"); the tip that follows is usually generic ("use searchable
  titles" is YouTube 101). Lead every action with its revelation, in the
  same sentence — the evidence is what separates us from a listicle.
- **Prefer the cheapest testable action**, including edits to the EXISTING
  video (YouTube allows retitling) over "on your next upload" — cheaper,
  faster, and directly verifiable by the Scorekeeper.
- **Never grade our own output.** "Aha" is an empirical claim settled by
  the Scorekeeper's verdict after a user acts, never asserted at ship
  time. Builder's pride is a real bias — in product copy and in session
  summaries alike. Describe outputs as what they are ("new information
  the user couldn't see" / "generic advice with evidence attached") and
  let outcomes decide.

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
Packaging Analyst incl. thumbnail vision review), idea mining (Audience
Analyst), the comparison desk (/scout — the Scout coordinating the whole
team), topic research (/research), weekly reports (on demand + Monday
cron), Ledger, settings — see status_aug2.md §13–§15. The analyst layer
calls Claude Opus 5 via `webapp/src/lib/server/claude.ts` and needs
`ANTHROPIC_API_KEY` + `YOUTUBE_API_KEY` (both server-only, in Vercel +
`webapp/.env.local` — the YT key reads public comments; the readonly OAuth
scope can't). Still open: onboarding polish, pricing screens (pricing
itself parked by user decision). API limits to respect in ALL product
work: thumbnail impressions/CTR ARE available (since Jan 15, 2026) via
YouTube Reporting API reach jobs — `channel_reach_basic_a1` /
`channel_reach_combined_a1` with `video_thumbnail_impressions` and
`video_thumbnail_impressions_ctr`
(developers.google.com/youtube/reporting/revision_history) — but data
accrues only from job creation, so create reach jobs at channel connect
(see the status_aug2.md roadmap). Still genuinely absent: audience overlap,
best-time-to-publish, search-volume trends — status_aug2.md §12 lists the
verified substitutions.

Client-side idle logout is deliberately absent (removed 2026-08-05);
real session timeboxing, if ever needed, belongs in Supabase's
server-side auth settings.

## Session discipline (2026-08-05 — every session, every task)

1. **Plan-gate.** Before any edit: list the files you will touch and what
   changes in each, then wait for an explicit "GO". No edits before GO.
2. **Scope is a contract.** Touch only files in the task's allowlist. If
   anything outside it seems necessary, STOP, record it in your report
   under "blocked on", and ask. Never "improve" adjacent code, rename,
   reformat, or refactor beyond the task.
3. **No git writes, no deploys.** Never run git add/commit/push, vercel,
   or supabase db push. The user reviews diffs and commits.
4. **Frozen unless a task explicitly grants it:** package.json
   dependencies; supabase/migrations (mirror rule applies when granted);
   youtube-mcp/server.py; model strings in webapp/src/lib/server/claude.ts;
   .env*; everything on the never-commit list above. Never copy content
   from deck/findings.md or deck/two-steps.md into committed files —
   product copy must stand alone.
5. **Done = the task's acceptance criteria verified, not "it compiles."**
   Always run the repo's build. For UI work: run the app, screenshot every
   changed screen at 1440px and 390px, open and LOOK at the screenshots,
   critique them against webapp/DESIGN.md (especially the anti-checklist),
   iterate at least twice, keep the final screenshots and cite their paths.
6. **Copy checklist — every user-visible string:**
   - States what the user gains, via the chain: better content → viewers
     stay → YouTube shows it more → more views → revenue. A line that
     can't point at one link of that chain gets deleted.
   - Every number is welded to the action it points to. No naked numbers.
   - Banned in UI: median, baseline, ratio, quartile, delta, metric, KPI,
     dashboard, optimize, insight(s), leverage, AI-powered. Translate:
     baseline → "your normal"; retention → "how long viewers stay";
     CTR → "how often people click when YouTube shows it"; traffic
     source → "how viewers found it".
   - Decisions ship as 2–3 typed options with effort tags — choices,
     never orders.
   - No invented numbers. Ranges with a named source only. Demo or
     illustrative data always carries a visible "sample" label.
   - Never self-grade output ("powerful", "aha", "game-changing").
     Verdicts belong to the Scorekeeper, afterward.
7. **Report at session end:** (a) files changed, one line each; (b) what
   was explicitly NOT done; (c) deviations from the approved plan —
   target zero, each one explained; (d) screenshot paths; (e) blocked-on
   items and open questions. Describe outputs plainly; no self-praise.
8. **Uncertain → stop and ask.** A question costs a minute; a wrong
   guess costs a session.
9. **Hotfix lane:** a confirmed bug that burns money, loses data, or
   breaks correctness gets fixed immediately in the narrowest scope —
   report after; plan-gates are for scope questions, not for bleeding.
10. **Trivial-fix lane:** an obviously-correct fix of a few characters or
   lines with zero design ambiguity — typos, missing spaces, dead
   references — is made on sight in the same session and disclosed in the
   report; no grant needed. If it needs a decision, it is not trivial.
