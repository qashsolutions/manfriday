-- manfriday: first-class catalog taxonomy on videos (was reachable only via
-- metadata jsonb, leaving Notion the only structured catalog), plus the
-- thumbnail cache promoted from reports/thumbnails/<vid>_<quality>.jpg.

-- Category is TEXT on purpose, no CHECK: yt-catalog's taxonomy is a canonical
-- ten but explicitly open ("add a new category only when nothing fits").
alter table public.videos
  add column category text,
  add column topics text[] not null default '{}',
  add column summary text;

comment on column public.videos.category is
  'Canonical taxonomy (open set by design): Tutorial, Review, Podcast / Interview, News / Update, Explainer, Entertainment, Vlog, Documentary, Talk / Presentation, Shorts / Clip.';
comment on column public.videos.topics is
  '2-5 specific subject tags; reuse existing names rather than near-duplicates.';

-- Thumbnails are YouTube's own public images and identical for every user, so
-- this is a SHARED cache, not user data: no user_id, no purge-on-delete tie,
-- excluded from export_my_data(). Backend (service role) writes; the bucket
-- is public-read so the web app can use storage URLs directly in <img>.
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

create table public.thumbnails (
  id uuid primary key default gen_random_uuid(),
  yt_video_id text not null,
  quality text not null
    check (quality in ('maxresdefault', 'sddefault', 'hqdefault', 'mqdefault')),
  storage_path text not null,
  content_type text not null default 'image/jpeg',
  byte_size integer,
  downloaded_at timestamptz not null default now(),
  unique (yt_video_id, quality)
);

comment on table public.thumbnails is
  'Shared cache of downloaded YouTube thumbnails in the thumbnails storage bucket (public images, deduped across users). Quality fallback order mirrors server.py: maxres -> sd -> hq -> mq.';

alter table public.thumbnails enable row level security;

-- Anyone signed in may look up cache entries; only the backend writes them.
create policy "authenticated read thumbnails" on public.thumbnails
  for select to authenticated using (true);
