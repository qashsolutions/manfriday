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
light background.
