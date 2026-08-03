-- manfriday: port of .claude/yt-profile.md — the personalization document
-- every advising agent (optimize/audit/studio/compare/audience) reads before
-- recommending. Columns mirror the template's sections one-to-one.

create table public.channel_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete set null,
  niche text,
  audience text,
  subscriber_range text,
  goals text[] not null default '{}',
  products_links jsonb not null default '[]'::jsonb,
  tone text,
  title_conventions text,
  thumbnail_style text,
  publish_cadence text,
  formats text,
  competitors text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel_id)
);

comment on table public.channel_profiles is
  'Per-channel personalization (yt-profile.md port). channel_id nullable: a profile can exist before a channel is linked.';
comment on column public.channel_profiles.products_links is
  '[{"label": ..., "url": ...}] — agents put these in generated descriptions.';
comment on column public.channel_profiles.competitors is
  'Channel @handles/URLs to benchmark against.';

create index channel_profiles_channel_id_idx on public.channel_profiles (channel_id);

create trigger set_updated_at
  before update on public.channel_profiles
  for each row execute function extensions.moddatetime (updated_at);

alter table public.channel_profiles enable row level security;

create policy "select own channel profiles" on public.channel_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own channel profiles" on public.channel_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own channel profiles" on public.channel_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "delete own channel profiles" on public.channel_profiles
  for delete to authenticated using ((select auth.uid()) = user_id);
