-- manfriday: per-user Google OAuth refresh tokens (YouTube read-only scopes).
--
-- Security model:
--   * refresh_token_ciphertext holds app-layer AES-GCM ciphertext; the
--     encryption key lives only in the backend environment, never in the DB.
--     A DB leak alone yields no usable tokens.
--   * RLS is enabled with NO policies, and grants for anon/authenticated are
--     revoked outright — browser clients can never read or write this table.
--     Only the service-role backend (which bypasses RLS) touches it.
--   * revoked_at is set when the user disconnects YouTube without deleting
--     their account; account deletion cascades the row away entirely (after
--     the backend revokes the token at Google first — see SETUP.md).

create table public.google_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  google_sub text not null,
  refresh_token_ciphertext bytea not null,
  scopes text[] not null default '{}',
  authorized_channel_id text,
  authorized_channel_title text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_sub)
);

comment on table public.google_oauth_tokens is
  'Encrypted per-user Google refresh tokens for YouTube scopes. Service-role only; no client access.';

alter table public.google_oauth_tokens enable row level security;
revoke all on table public.google_oauth_tokens from anon, authenticated;

create trigger set_updated_at
  before update on public.google_oauth_tokens
  for each row execute function extensions.moddatetime (updated_at);
