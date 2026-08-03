# manfriday — Supabase setup (Phase 4 storage layer)

Applied live on 2026-08-02/03 through the Supabase MCP server. This document
is the reference for what exists in the project, why it is shaped that way,
and what remains to be done outside the database.

## Project

| Item | Value |
|---|---|
| Project ref | `jxlhvxkaetuhtmwjvlym` |
| API URL | `https://jxlhvxkaetuhtmwjvlym.supabase.co` |
| Publishable key (client-side, safe to ship) | `sb_publishable_mTxxdoBvQbh7fZ1yGeO-gg__DNI_Wki` |
| Secret/service-role key | **Not stored here.** Dashboard → Settings → API. Backend env only. |

Twelve migrations are applied and mirrored 1:1 in `supabase/migrations/`:

1. `core_profiles` — `profiles` + auto-create trigger on sign-up
2. `google_oauth_tokens` — encrypted per-user YouTube refresh tokens
3. `channels_videos_snapshots` — tracked channels, videos, time-series
4. `monitor_reports_recommendations` — monitor state, reports, ledger
5. `data_sovereignty_export` — `export_my_data()` RPC (v1)
6. `harden_function_grants` — advisor fix (trigger fn not client-callable)
7. `ledger_fidelity_and_monitor_fix` — code-review fixes (see below)
8. `channel_profiles` — yt-profile.md port
9. `export_connections` — per-user Notion/Drive credentials
10. `video_taxonomy_thumbnails` — catalog columns + shared thumbnail cache/bucket
11. `channel_baselines_api_cache` — persisted baselines + shared TTL cache + pg_cron purge
12. `export_my_data_v2` — export RPC covers the new tables

To evolve the schema: write the next `supabase/migrations/<timestamp>_<name>.sql`
file, then apply the same SQL via the MCP `apply_migration` tool (or
`supabase db push` once the CLI is linked). Keep the mirror exact.

## Schema

Per-user data (everything cascades from `auth.users` directly):

```
auth.users  (Supabase Auth — Google sign-in)
  │ 1:1  ON DELETE CASCADE
  ├── profiles                (display name, avatar; auto-created by trigger)
  │
  │ 1:N  ON DELETE CASCADE — every table below also FKs auth.users directly
  ├── google_oauth_tokens     (encrypted YouTube refresh tokens; service-role only)
  ├── export_connections      (encrypted Notion/Drive creds + per-user config
  │                            {parent_page_id, database_id}; service-role only)
  ├── channel_profiles ─────┐ (yt-profile.md port: niche, audience, goals,
  │                         │  products/links, tone, conventions, cadence,
  │                         │  competitors; channel link optional)
  ├── channels ─────────────┤ (own channel + tracked competitors)
  │     ├── videos ─────────┤ (cataloged videos + category/topics/summary)
  │     │     └── video_snapshots      (append-only view/like/comment series —
  │     │                               also THE home of velocity tracking)
  │     ├── channel_snapshots          (append-only subscriber/view series)
  │     ├── channel_baselines          (persisted get_channel_baseline runs,
  │     │                               one row per compute per format)
  │     └── monitor_state              (seen-IDs + last check per channel)
  ├── reports               (agent output, markdown = source of truth;
  │                          channel/video links are SET NULL, report survives)
  └── recommendations       (the learning ledger — full yt-ledger.jsonl port)
```

Shared infrastructure (NOT user data — no user_id, no purge tie, excluded
from `export_my_data()`):

```
thumbnails   metadata for cached YouTube thumbnail images (public content,
             deduped across users) stored in the public-read `thumbnails`
             storage bucket as <yt_video_id>_<quality>.jpg; backend writes,
             authenticated read
api_cache    Postgres successor to server.py's in-memory TTL cache
             (CACHE_TTL=900s): shared across users/processes to dedupe
             YouTube API + yt-dlp fetches (saves quota, not just latency);
             service-role only; pg_cron job `purge-api-cache` deletes
             expired rows every 30 min
```

Design rules carried from `status_aug2.md` §Phase 4:

- **Supabase is the system of record.** Notion / Drive / file download remain
  one-way export destinations; `reports.exports` records where a report was
  sent, never syncs back.
- **YouTube's IDs live in `yt_*` text columns**; internal PKs are UUIDs.
  Dedup keys mirror the local tools: `(user_id, yt_video_id)` and
  `(user_id, yt_channel_id)` are UNIQUE — upsert semantics identical to
  `add_video_to_notion`.
- **Snapshots and baselines are append-only**: clients have
  select/insert/delete policies but no update. History stays trustworthy.

## Fidelity to the local code (audited 2026-08-02, fixed in migrations 7–11)

- `recommendations` is a full-field port of the yt-ledger.jsonl entries:
  status check includes `resolved` (the code sets it when a verdict lands),
  `notes`, `resolved_at`, `baseline_error`, `result_baseline_error` columns
  exist, and `category` enforces the code's closed LEDGER_CATEGORIES set.
- `videos.category` is deliberately **unconstrained** text: yt-catalog's
  ten-category taxonomy is canonical but explicitly open ("add a new
  category only when nothing fits").
- `monitor_state` intentionally does NOT mirror the local file's top-level
  `tracking` block — velocity snapshots belong in `video_snapshots` rows in
  a relational store. This is the one deliberate remodel.
- Still not in the DB, on purpose: transcripts/heatmaps/comments/suggestions
  (fetched on demand; vector DB ruled out in status_aug2.md §9), agent
  prompt definitions (code), `.env`/OAuth client secrets (backend env).

## Security model

- **RLS on every table.** Per-user tables use `(select auth.uid()) = user_id`
  (the subselect form so Postgres caches it per-statement). Every per-user
  table FKs `auth.users` *directly* so isolation and purge never depend on
  joins or intermediate deletes.
- **Three service-role-only tables** — `google_oauth_tokens`,
  `export_connections`, `api_cache`: RLS enabled with zero policies *and*
  grants revoked from `anon`/`authenticated`. The advisor's INFO "RLS
  enabled, no policy" on these three is this design, not an omission.
- **Credentials are ciphertext in the DB.** `*_ciphertext` columns (bytea)
  hold app-layer AES-256-GCM output; the key lives only in the backend
  environment (e.g. `TOKEN_ENCRYPTION_KEY`, 32 random bytes). A DB leak
  alone yields no usable tokens. Access tokens are never persisted.
- **`export_my_data()`** is SECURITY DEFINER and callable by `authenticated`
  (advisor WARN — intentional: it filters everything by `auth.uid()` and
  returns connection *metadata* only, never ciphertext).
  `handle_new_user()` had its client EXECUTE revoked (migration 6).

## User sovereignty (the guarantees from the deck / privacy policy)

**Full data download** — one call from the signed-in client:

```js
const { data } = await supabase.rpc('export_my_data')
// → one JSON object: profile, youtube_connections + export_connections
//   (metadata/config only, no ciphertext), channel_profiles, channels,
//   videos, both snapshot series, channel_baselines, monitor_state,
//   reports, recommendations. Serve it to the user as a .json download.
```

**Account deletion purges everything** — backend-only, strict order:

1. Decrypt the user's Google refresh token(s); POST each to
   `https://oauth2.googleapis.com/revoke` (kills YouTube access at Google —
   must happen while the token row still exists). Notion tokens: delete the
   row (user revokes the integration on the Notion side).
2. `await supabase.auth.admin.deleteUser(userId)` (service role).
3. Done — the `auth.users` delete cascades through all 12 per-user tables in
   one transaction. No cleanup jobs, no orphans possible by construction.
   (The shared `thumbnails`/`api_cache` rows hold no user data.)

"Disconnect YouTube" without account deletion: revoke at Google, then set
`revoked_at` (keep the row as an audit record) or hard-delete the token row.

## Two OAuth flows — keep them separate

1. **Identity: Supabase Auth "Sign in with Google"** — basic profile scopes
   only. Creates `auth.users` → trigger creates `profiles`.
2. **Authorization: "Connect your YouTube channel"** — a separate incremental
   consent flow run by the backend using `youtube-mcp/client_secret_web.json`
   with `access_type=offline&prompt=consent` and the two read-only scopes
   (`youtube.readonly`, `yt-analytics.readonly`). Encrypt and store the
   refresh token in `google_oauth_tokens`, then resolve and record the
   authorized channel (`authorized_channel_id`) and upsert it into
   `channels` with `is_owned = true`.

Don't request YouTube scopes at sign-in: users who just want to look around
never see a scary consent screen, and Google's sensitive-scope review favors
scopes requested in context.

## Remaining setup outside the DB (dashboard / Google Cloud)

1. ✅ DONE 2026-08-03 — Google provider enabled (web client ID + secret;
   the secret must come from `client_secret_web.json`, NOT the Desktop
   client's `client_secret.json` — they are different clients with
   different secrets).
2. ✅ DONE 2026-08-03 — Supabase callback
   (`https://jxlhvxkaetuhtmwjvlym.supabase.co/auth/v1/callback`) registered
   on the web client. Still to add later: the app's own callback URL for
   the YouTube-connect flow when it exists.
3. ✅ DONE for dev — Site URL is `http://localhost:3000`; switch to
   `https://manfriday.app` (and prune/keep localhost as a dev redirect) at
   launch.
4. Unchanged from `status_aug2.md` Phase 4: Google app verification to leave
   Testing mode (privacy policy + ToS on manfriday.app, domain verification,
   sensitive-scope review; 100 allowlisted test users until then), and a
   separate browser API key restricted to manfriday.app referrers.

## Verification status

- Applied and confirmed live 2026-08-02/03: 14 tables in `public`, RLS on
  all; `thumbnails` storage bucket created; pg_cron installed with the
  `purge-api-cache` job active (every 30 min, confirmed in `cron.job`);
  12 migrations recorded; security advisor clean except the intentional
  items explained above.
- Full SQL test suite passed 2026-08-03 (two simulated users, seeded all 14
  tables, cleaned up to empty afterwards): `handle_new_user` auto-created
  profiles from Google-style metadata · `moddatetime` fires · category CHECK
  and the `(user_id, yt_video_id)` dedup key reject bad rows · the
  `resolved`+verdict ledger state inserts cleanly (the migration-7 fix) ·
  RLS verified from both sides via `set_config('request.jwt.claims', ...)`:
  each user sees only their rows, cross-tenant insert fails 42501,
  append-only snapshot update touches 0 rows, `google_oauth_tokens` SELECT
  is permission-denied even for the owner, anon sees nothing ·
  `export_my_data()` returns the caller's full dataset incl. token metadata
  with no ciphertext · the purge job's DELETE removes only expired cache
  rows · deleting an auth user cascaded every one of their rows across all
  12 per-user tables in one statement while the other user and the shared
  caches survived.
- Real Google sign-in VERIFIED 2026-08-03: provider enabled with the web
  client; sign-in as ramanac@gmail.com via `supabase/test-signin.html` on
  localhost:3000 created the `auth.users` row (provider google, email
  verified, google_sub in `auth.identities`), `handle_new_user` auto-created
  the profile (display_name + avatar from Google metadata), and
  `export_my_data()` returned the caller's dataset over PostgREST with the
  real session JWT. All other tables untouched. Debugging note: the first
  attempts failed with `invalid_client: The provided client secret is
  invalid` (Desktop client's secret pasted next to the web client's ID) —
  the auth logs (`get_logs`, service `auth`) pinpointed it at `/callback`
  in seconds.
