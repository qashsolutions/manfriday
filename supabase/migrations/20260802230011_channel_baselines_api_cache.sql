-- manfriday: persisted channel baselines + Postgres-backed API cache.

-- get_channel_baseline output, one row per compute run per format (the code
-- baselines Shorts and long-form separately). Previously recomputed and
-- discarded every call; persisting makes the channel's own norm
-- trend-queryable ("is my longform median rising?").
create table public.channel_baselines (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  computed_at timestamptz not null default now(),
  format text not null check (format in ('longform', 'shorts')),
  sample_requested integer,
  sample_size integer not null,
  median_views bigint not null,
  mean_views bigint not null,
  subscribers bigint,
  videos jsonb not null default '[]'::jsonb
);

comment on column public.channel_baselines.videos is
  'Per-video detail from classify(): {video_id, title, view_count, views_per_day, ratio_to_median, flag} where flag is outperformer (>=2x median of its format) | typical | underperformer (<=0.5x).';

create index channel_baselines_user_id_idx on public.channel_baselines (user_id);
create index channel_baselines_channel_computed_idx
  on public.channel_baselines (channel_id, computed_at desc);

alter table public.channel_baselines enable row level security;

-- Append-only like the snapshot tables: select/insert/delete, no update.
create policy "select own channel baselines" on public.channel_baselines
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own channel baselines" on public.channel_baselines
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "delete own channel baselines" on public.channel_baselines
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Successor to server.py's in-memory TTL cache (CACHE_TTL=900s, 128 entries,
-- tuple keys): shared across users and server processes so concurrent
-- sessions dedupe YouTube API / yt-dlp fetches — that is quota, not just
-- latency. Keys are the tuple serialized to text (e.g. 'video_info:dQw4...').
-- Cross-user shared data -> service-role only, like google_oauth_tokens.
create table public.api_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.api_cache enable row level security;
revoke all on table public.api_cache from anon, authenticated;

create index api_cache_expires_idx on public.api_cache (expires_at);

-- Replaces the in-memory eviction pass: purge expired entries on a schedule.
create extension if not exists pg_cron;
select cron.schedule(
  'purge-api-cache',
  '*/30 * * * *',
  $$delete from public.api_cache where expires_at < now()$$
);
