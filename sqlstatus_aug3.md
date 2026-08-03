# manfriday — Supabase/SQL Status (2026-08-03)

Companion to `status_aug2.md`, covering only the Supabase storage layer for
manfriday.app (Phase 4). Everything below is taken from live calls executed
through the Supabase MCP server on Aug 2–3, 2026 — applied migrations, advisor
runs, and a full SQL test suite. No projections.

Deep reference (schema diagram, security model, OAuth-flow design, remaining
dashboard steps): `supabase/SETUP.md`. This file is the status + audit + test
log.

## 1. Summary

| Item | State |
|---|---|
| Project | `jxlhvxkaetuhtmwjvlym` → `https://jxlhvxkaetuhtmwjvlym.supabase.co` |
| Migrations applied | 12, mirrored 1:1 in `supabase/migrations/` |
| Tables | 14 in `public`, RLS enabled on every one |
| Storage | `thumbnails` bucket (public-read) created |
| Jobs | pg_cron installed via migration; `purge-api-cache` active (`*/30 * * * *`, confirmed in `cron.job`) |
| Security advisor | Clean — 1 real finding fixed (migration 6); remaining lints all intentional (§6) |
| Test suite | PASSED in full on 2026-08-03 (§7); DB left empty afterwards |
| Data | 0 rows everywhere — pristine, schema-only |
| Untested | One thing only: a real Google sign-in (provider not yet enabled in the dashboard) |
| Git | Repo pushed to github.com/qashsolutions/manfriday (root commit `721cf7a`). Doc updates made after that push (SETUP.md/status_aug2.md verification notes, this file) are uncommitted at time of writing. |

Publishable key (client-side, safe to ship):
`sb_publishable_mTxxdoBvQbh7fZ1yGeO-gg__DNI_Wki`. The service-role key is in
Dashboard → Settings → API and must live only in backend env.

## 2. Pre-flight verification (before any DDL)

Verified through the MCP server's own tools, not just the URL:
- `get_project_url` → ref `jxlhvxkaetuhtmwjvlym` (match).
- `public` schema: **0 tables**; `list_migrations`: **0**; `auth.users`: **0
  rows** — genuinely fresh, nothing had ever touched it.
- Extensions at baseline: `pgcrypto`, `uuid-ossp`, `pg_stat_statements`,
  `supabase_vault`, `plpgsql` installed; `moddatetime` and `pg_cron`
  available (both later enabled by migrations).

## 3. Migration ledger (applied in this order)

| # | Name | What it does |
|---|---|---|
| 1 | `core_profiles` | `moddatetime` extension; `profiles` 1:1 with `auth.users`; `handle_new_user` SECURITY DEFINER trigger auto-creates the profile on sign-up (maps `raw_user_meta_data` full_name/name → display_name, avatar_url) |
| 2 | `google_oauth_tokens` | Encrypted per-user YouTube refresh tokens; deny-all RLS + grants revoked (service-role only) |
| 3 | `channels_videos_snapshots` | `channels`, `videos` (dedup keys `(user_id, yt_*)` UNIQUE), append-only `channel_snapshots` + `video_snapshots` |
| 4 | `monitor_reports_recommendations` | `monitor_state`, `reports` (markdown = source of truth, `exports` jsonb logs one-way sends), `recommendations` (ledger) |
| 5 | `data_sovereignty_export` | `export_my_data()` RPC v1 |
| 6 | `harden_function_grants` | Advisor fix: revoked client EXECUTE on `handle_new_user()` (was callable via `/rest/v1/rpc/`) |
| 7 | `ledger_fidelity_and_monitor_fix` | Code-audit fixes (§5): status CHECK gains `resolved`; adds `notes`/`resolved_at`/`baseline_error`/`result_baseline_error`; category CHECK; drops `monitor_state.velocity_tracking` |
| 8 | `channel_profiles` | `.claude/yt-profile.md` port — structured columns per template section |
| 9 | `export_connections` | Per-user encrypted Notion/Drive credentials + `config` jsonb (per-user `NOTION_PARENT_PAGE_ID`/`NOTION_DATABASE_ID` equivalents); deny-all like tokens |
| 10 | `video_taxonomy_thumbnails` | `videos.category/topics/summary`; `thumbnails` bucket + shared cache table |
| 11 | `channel_baselines_api_cache` | Persisted `get_channel_baseline` runs (per-format rows); shared `api_cache`; pg_cron + purge job |
| 12 | `export_my_data_v2` | Export RPC covers the new tables; still excludes all ciphertext and shared caches |

`list_migrations` records server-assigned versions at apply time (Aug 3 UTC);
the mirror files carry matching `202608022300NN_` prefixes.

## 4. What the schema models

**Per-user (12 tables, all FK `auth.users` ON DELETE CASCADE *directly* —
isolation and purge never depend on joins):** `profiles`,
`google_oauth_tokens`, `export_connections`, `channel_profiles`, `channels`,
`videos`, `video_snapshots`, `channel_snapshots`, `channel_baselines`,
`monitor_state`, `reports`, `recommendations`.

**Shared infrastructure (2 tables — public YouTube content, identical for
every user; no user_id, no purge tie, excluded from export):** `thumbnails`
(+ the storage bucket, files as `<yt_video_id>_<quality>.jpg`), `api_cache`
(Postgres successor to server.py's in-memory 900 s TTL cache; shared across
users/processes so concurrent sessions dedupe YouTube API + yt-dlp fetches —
that is quota, not just latency).

Append-only tables (clients get select/insert/delete, **no update policy**):
both snapshot tables and `channel_baselines` — history stays trustworthy for
velocity/delta math.

## 5. Code audit — schema vs `server.py` + agents (the "100% mapping" check)

Performed by reading the actual code, not the status doc. Findings and
resolutions:

**Real bug caught before any data existed:** the original
`recommendations.status` CHECK allowed only `open/applied/skipped`, but
`update_recommendation` sets `status = 'resolved'` with every verdict
(`LEDGER_STATUSES`, server.py:1792). First resolved entry would have failed.
Fixed in migration 7 and later **proven by test** (§7: a `resolved`+`worked`
row inserts cleanly).

**Missing fields added** (migration 7): `notes`, `resolved_at`,
`baseline_error`, `result_baseline_error` — all written by the code, none had
columns. `category` CHECK added matching the code's closed
`LEDGER_CATEGORIES` (`packaging/content/cadence/retention/monetization/general`).

**Deliberate divergences (documented, intentional):**
- `videos.category` has **no CHECK**: yt-catalog's ten-category taxonomy is
  canonical but explicitly open ("add a new category only when nothing
  fits"). The canonical ten live in a column comment.
- `monitor_state` does **not** mirror the local file's top-level `tracking`
  block — the one remodel. Velocity snapshots belong in `video_snapshots`
  rows; `monitor_state` keeps only detection state (seen IDs + last check,
  ~200-ID cap enforced app-side like the file).
- Ledger `id` format differs (uuid PK vs the file's `rec-<ms>-<seq>` string) —
  a port detail, not a fidelity gap.

**Deliberately not in the DB:** transcripts, heatmaps, comments, search
suggestions, audience demographics (fetched on demand; vector DB explicitly
ruled out in status_aug2.md §9), agent prompt definitions (code), `.env` and
OAuth client secrets (backend env), the OAuth *access* tokens (never
persisted anywhere — minted from refresh tokens per session).

## 6. Security model + advisor history

- Every per-user policy is `(select auth.uid()) = user_id` — the subselect
  form so Postgres evaluates it once per statement (initplan), not per row.
- **Three deny-all tables** (`google_oauth_tokens`, `export_connections`,
  `api_cache`): RLS enabled with zero policies AND grants revoked from
  `anon`/`authenticated`. Advisor flags these as INFO "RLS enabled, no
  policy" — that is the design signal, not an omission.
- Credentials are **app-layer AES-256-GCM ciphertext** (bytea); the key
  (e.g. `TOKEN_ENCRYPTION_KEY`, 32 random bytes) lives only in backend env.
  A DB leak alone yields no usable tokens.
- Advisor timeline: after migrations 1–5 it found one real issue —
  `handle_new_user()` (SECURITY DEFINER) callable by clients via REST RPC —
  fixed in migration 6 and re-verified gone. Remaining lints, all
  intentional: the three deny-all INFOs and one WARN on `export_my_data()`
  being callable by `authenticated` (that is its purpose; it scopes
  everything to `auth.uid()` and never returns ciphertext). Performance
  advisor shows only "unused index" INFOs — the DB had never been queried.

## 7. Test suite (executed 2026-08-03, all via `execute_sql`)

Method notes: test users were created by direct `insert into auth.users` (the
same row Supabase Auth writes); role simulation used
`set_config('role', 'authenticated', true)` +
`set_config('request.jwt.claims', '{"sub": "<uuid>", ...}', true)` — the
exact mechanism PostgREST uses, transaction-local so nothing leaks between
calls. Expected-failure tests were run as standalone statements; the error
text is the assertion. Two throwaway users: A (full dataset) and B (one
channel).

| # | Test | Result |
|---|---|---|
| 1 | `handle_new_user` trigger: insert 2 users into `auth.users` with Google-style `raw_user_meta_data` | ✅ Both profiles auto-created; `full_name`→`display_name`, avatar mapped, absent avatar → null |
| 2 | Seed all 14 tables for A (+1 channel for B), including a `resolved`+`worked` recommendation | ✅ All inserts accepted — live proof of the migration-7 fix |
| 3a | `moddatetime`: update a channel in its own transaction | ✅ `updated_at > created_at` |
| 3b | Insert recommendation with `category='bogus-category'` | ✅ Rejected — `recommendations_category_check` (23514) |
| 3c | Insert duplicate `(user_id, yt_video_id)` | ✅ Rejected — `videos_user_id_yt_video_id_key` (23505) |
| 4 | RLS as A: row visibility + `export_my_data()` | ✅ Sees own 2 channels/2 videos/2 recs/1 profile, 0 of B's rows; export returns A's full dataset incl. 1 YouTube connection (metadata) — `deadbeef` ciphertext string **absent** from the entire export |
| 5a | As A: `UPDATE` on `video_snapshots` (append-only) | ✅ 0 rows affected — no update policy |
| 5b | As A: insert a channel with `user_id = B` (cross-tenant write) | ✅ Rejected — RLS violation 42501 |
| 6 | As A: `SELECT * FROM google_oauth_tokens` (own token!) | ✅ `permission denied for table google_oauth_tokens` — grants revoked, deny-all holds even for the row's owner |
| 7 | As B and as `anon` | ✅ B sees exactly 1 channel and nothing of A's; B's export scoped to B; anon sees 0 rows in every table incl. `thumbnails` (read policy is `to authenticated`) |
| 8 | Cache purge: run the cron job's exact DELETE | ✅ Expired entry removed, live entry kept |
| 9 | **Purge-on-delete**: `delete from auth.users where id = A` | ✅ One statement cascaded ALL of A's rows across all 12 per-user tables to 0; B's profile/channel and both shared caches survived |
| 10 | Cleanup: delete B, clear shared cache test rows | ✅ Every table (incl. `auth.users`) back to 0 rows — project pristine, schema/bucket/cron intact |

Not testable from SQL: a real Google sign-in through the dashboard-configured
provider (not yet enabled). Everything downstream of sign-in is proven.

## 8. Specific notes & gotchas (learned the hard way, kept for next time)

1. **`execute_sql` batches run in ONE transaction and return only the last
   statement's rows.** Two consequences: (a) structure batches so the final
   statement is the verification SELECT; (b) `now()` is frozen per
   transaction — the first `updated_at > created_at` check false-negatived
   because insert and update shared a timestamp. Re-test time-based
   assertions in a separate call.
2. **Role simulation is transaction-local.** `set_config(..., is_local =>
   true)` reverts at transaction end, so switching to
   `authenticated`/`anon` inside one call can never leak into later MCP
   calls. The MCP's own role is table owner → bypasses RLS; every RLS test
   MUST switch role explicitly or it proves nothing.
3. **pg_cron works entirely from a migration** — `create extension pg_cron;
   select cron.schedule(...)` through the MCP; no dashboard needed. Verify
   with `select * from cron.job`.
4. **Storage buckets can be created in SQL**: `insert into storage.buckets
   (id, name, public) ... on conflict (id) do nothing`. A public-read bucket
   that only the service role writes needs **no** `storage.objects`
   policies at all.
5. **Postgres auto-names inline CHECKs** `<table>_<column>_check` —
   migration 7's drop/re-add of `recommendations_status_check` relies on
   that convention.
6. **`moddatetime` installs into the `extensions` schema** — triggers must
   say `execute function extensions.moddatetime (updated_at)` (column name
   as trigger argument).
7. **SECURITY DEFINER + `set search_path = ''`** requires schema-qualifying
   every reference; `auth.uid()` still resolves the *caller's* JWT inside a
   definer function — which is exactly what makes `export_my_data()` safe.
8. **`create or replace function` preserves existing grants** (migration 12
   restates them anyway for self-containedness).
9. **Advisor lint literacy**: "RLS enabled, no policy" INFO = our deny-all
   design when paired with revoked grants; "unused index" INFO on a
   never-queried DB is noise; the SECURITY DEFINER WARNs are real signals —
   one was a genuine fix (migration 6), one is intentional and documented.
10. **Hand-inserting `auth.users` rows for tests**: set `instance_id` to the
    all-zeros uuid, `aud`/`role` to `authenticated`, and
    `confirmation_token`/`recovery_token` to `''` (GoTrue has known issues
    scanning NULL token columns). Fine for throwaway test users; production
    users must come from real sign-in, and production deletion goes through
    `auth.admin.deleteUser()` — after revoking Google tokens, in that order.
11. **`unique (user_id, X)` doubles as the RLS-filter index** (leading
    column), so those tables need no separate `user_id` index; only
    FK columns not leading a unique constraint got explicit indexes.
12. **Constraint checks beat code review**: the `resolved` bug was invisible
    until the schema was diffed line-by-line against `LEDGER_STATUSES` in
    the code — and it would have surfaced only in production, on the first
    verdict. Audit schemas against the code that writes to them, not
    against design docs.

## 9. What remains (all outside the DB)

1. Dashboard: enable the Google provider (web client ID/secret from
   `client_secret_web.json`); add
   `https://jxlhvxkaetuhtmwjvlym.supabase.co/auth/v1/callback` to the web
   client's redirect URIs in Google Cloud; set Site URL + dev redirects.
   Then smoke-test one real sign-in (the only untested path).
2. Backend contracts when the web app starts: `TOKEN_ENCRYPTION_KEY`
   (AES-256-GCM) in env; deletion order (revoke at Google → `deleteUser` →
   cascade); cache-key serialization for `api_cache`; port server.py's
   storage layer (ledger/monitor/catalog/baselines) from files to these
   tables — the columns are field-level matches, so it is a storage-layer
   swap, not a redesign.
3. Google app verification to leave Testing mode (privacy policy + ToS on
   manfriday.app — `export_my_data()` and the deletion cascade are the
   implementation of what that policy will promise).
