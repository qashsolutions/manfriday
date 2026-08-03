-- manfriday: per-user credentials for the one-way export destinations.
-- The local stack uses a single .env NOTION_API_KEY and the session-level
-- Drive connector; a multi-user app needs these per user. Same hard rules as
-- google_oauth_tokens: app-layer ciphertext only, RLS deny-all + grants
-- revoked — service-role backend only.

create table public.export_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('notion', 'google_drive')),
  token_ciphertext bytea not null,
  config jsonb not null default '{}'::jsonb,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

comment on table public.export_connections is
  'Encrypted per-user export credentials (Notion / Drive). Service-role only; no client access.';
comment on column public.export_connections.config is
  'Provider settings, e.g. notion: {"parent_page_id": ..., "database_id": ...} (the per-user equivalents of NOTION_PARENT_PAGE_ID / NOTION_DATABASE_ID).';

alter table public.export_connections enable row level security;
revoke all on table public.export_connections from anon, authenticated;

create trigger set_updated_at
  before update on public.export_connections
  for each row execute function extensions.moddatetime (updated_at);
