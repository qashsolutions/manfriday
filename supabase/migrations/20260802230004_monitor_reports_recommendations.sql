-- manfriday: monitor state (per-user replacement for .claude/yt-monitor-state.json),
-- agent reports (system of record; Notion/Drive stay one-way exports), and the
-- recommendation ledger (per-user replacement for .claude/yt-ledger.jsonl).

create table public.monitor_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  last_checked_at timestamptz,
  seen_video_ids jsonb not null default '[]'::jsonb,
  velocity_tracking jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel_id)
);

comment on column public.monitor_state.velocity_tracking is
  'Videos <14 days old being velocity-watched: [{yt_video_id, snapshots: [...]}, ...] — same shape as the local monitor state file.';

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  agent text not null,
  title text not null,
  body_md text not null,
  channel_id uuid references public.channels (id) on delete set null,
  video_id uuid references public.videos (id) on delete set null,
  exports jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on column public.reports.exports is
  'Where this report was exported, e.g. {"notion_page_id": ..., "drive_file_id": ...}. Export destinations are one-way; the markdown here is the source of truth.';

-- Ledger entry fields mirror the local yt-ledger.jsonl schema so server.py's
-- ledger logic ports over with only the storage layer swapped.
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  agent text not null,
  category text not null,
  recommendation text not null,
  target_type text not null check (target_type in ('video', 'channel', 'idea')),
  target_yt_id text,
  baseline jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'applied', 'skipped')),
  verdict text check (verdict in ('worked', 'failed', 'mixed', 'unclear')),
  result_yt_video_id text,
  result_snapshot jsonb,
  updates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index monitor_state_channel_id_idx on public.monitor_state (channel_id);
create index reports_user_created_idx on public.reports (user_id, created_at desc);
create index reports_channel_id_idx on public.reports (channel_id);
create index reports_video_id_idx on public.reports (video_id);
create index recommendations_user_created_idx
  on public.recommendations (user_id, created_at desc);

create trigger set_updated_at
  before update on public.monitor_state
  for each row execute function extensions.moddatetime (updated_at);
create trigger set_updated_at
  before update on public.recommendations
  for each row execute function extensions.moddatetime (updated_at);

alter table public.monitor_state enable row level security;
alter table public.reports enable row level security;
alter table public.recommendations enable row level security;

create policy "select own monitor state" on public.monitor_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own monitor state" on public.monitor_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own monitor state" on public.monitor_state
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "delete own monitor state" on public.monitor_state
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "select own reports" on public.reports
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own reports" on public.reports
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own reports" on public.reports
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "delete own reports" on public.reports
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "select own recommendations" on public.recommendations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own recommendations" on public.recommendations
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own recommendations" on public.recommendations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "delete own recommendations" on public.recommendations
  for delete to authenticated using ((select auth.uid()) = user_id);
