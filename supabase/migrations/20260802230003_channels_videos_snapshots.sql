-- manfriday: tracked channels, cataloged videos, and time-series snapshots.
-- Every table carries user_id referencing auth.users ON DELETE CASCADE so the
-- purge chain never depends on intermediate deletes; RLS filters on user_id.
-- yt_* columns hold YouTube's own IDs; uuid PKs are internal.

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  yt_channel_id text not null,
  handle text,
  title text,
  is_owned boolean not null default false,
  thumbnail_url text,
  subscriber_count bigint,
  view_count bigint,
  video_count bigint,
  stats_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, yt_channel_id)
);

comment on column public.channels.is_owned is
  'true = user''s own OAuth-linked channel; false = tracked competitor/reference channel.';

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete cascade,
  yt_video_id text not null,
  title text,
  published_at timestamptz,
  duration_seconds integer,
  is_short boolean,
  thumbnail_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, yt_video_id)
);

-- Append-only time series (no update policies below). Kept separate from the
-- parent rows so velocity/delta math has real history to work with.
create table public.channel_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  captured_at timestamptz not null default now(),
  subscriber_count bigint,
  view_count bigint,
  video_count bigint,
  metrics jsonb not null default '{}'::jsonb
);

create table public.video_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  captured_at timestamptz not null default now(),
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  views_per_day numeric,
  source text not null default 'data_api'
    check (source in ('data_api', 'analytics_api', 'rss', 'scrape')),
  metrics jsonb not null default '{}'::jsonb
);

comment on column public.video_snapshots.metrics is
  'Free-form extras, e.g. OAuth retention/traffic metrics for owned videos.';

-- The unique (user_id, ...) constraints double as the RLS-filter indexes for
-- channels/videos; snapshots need explicit ones.
create index videos_channel_id_idx on public.videos (channel_id);
create index channel_snapshots_user_id_idx on public.channel_snapshots (user_id);
create index channel_snapshots_channel_captured_idx
  on public.channel_snapshots (channel_id, captured_at desc);
create index video_snapshots_user_id_idx on public.video_snapshots (user_id);
create index video_snapshots_video_captured_idx
  on public.video_snapshots (video_id, captured_at desc);

create trigger set_updated_at
  before update on public.channels
  for each row execute function extensions.moddatetime (updated_at);
create trigger set_updated_at
  before update on public.videos
  for each row execute function extensions.moddatetime (updated_at);

alter table public.channels enable row level security;
alter table public.videos enable row level security;
alter table public.channel_snapshots enable row level security;
alter table public.video_snapshots enable row level security;

create policy "select own channels" on public.channels
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own channels" on public.channels
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own channels" on public.channels
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "delete own channels" on public.channels
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "select own videos" on public.videos
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own videos" on public.videos
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own videos" on public.videos
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "delete own videos" on public.videos
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Snapshots are append-only for clients: select/insert/delete, no update.
create policy "select own channel snapshots" on public.channel_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own channel snapshots" on public.channel_snapshots
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "delete own channel snapshots" on public.channel_snapshots
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "select own video snapshots" on public.video_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own video snapshots" on public.video_snapshots
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "delete own video snapshots" on public.video_snapshots
  for delete to authenticated using ((select auth.uid()) = user_id);
