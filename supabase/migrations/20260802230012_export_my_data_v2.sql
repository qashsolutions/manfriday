-- manfriday: export_my_data() v2 — includes the tables added since v1
-- (channel_profiles, channel_baselines, export-connection metadata) so the
-- "full data download" guarantee stays complete. Deliberately excluded:
-- token/credential ciphertext (both connection tables expose metadata only)
-- and the shared caches (thumbnails, api_cache) — public YouTube content,
-- not user data.

create or replace function public.export_my_data()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p
                where p.id = auth.uid()),
    'youtube_connections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'google_sub', t.google_sub,
        'scopes', t.scopes,
        'authorized_channel_id', t.authorized_channel_id,
        'authorized_channel_title', t.authorized_channel_title,
        'created_at', t.created_at,
        'revoked_at', t.revoked_at))
      from public.google_oauth_tokens t
      where t.user_id = auth.uid()), '[]'::jsonb),
    'export_connections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', e.provider,
        'config', e.config,
        'created_at', e.created_at,
        'revoked_at', e.revoked_at))
      from public.export_connections e
      where e.user_id = auth.uid()), '[]'::jsonb),
    'channel_profiles', coalesce((select jsonb_agg(to_jsonb(cp))
      from public.channel_profiles cp where cp.user_id = auth.uid()), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(to_jsonb(c))
      from public.channels c where c.user_id = auth.uid()), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(to_jsonb(v))
      from public.videos v where v.user_id = auth.uid()), '[]'::jsonb),
    'channel_snapshots', coalesce((select jsonb_agg(to_jsonb(s))
      from public.channel_snapshots s where s.user_id = auth.uid()), '[]'::jsonb),
    'video_snapshots', coalesce((select jsonb_agg(to_jsonb(s))
      from public.video_snapshots s where s.user_id = auth.uid()), '[]'::jsonb),
    'channel_baselines', coalesce((select jsonb_agg(to_jsonb(b))
      from public.channel_baselines b where b.user_id = auth.uid()), '[]'::jsonb),
    'monitor_state', coalesce((select jsonb_agg(to_jsonb(m))
      from public.monitor_state m where m.user_id = auth.uid()), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r))
      from public.reports r where r.user_id = auth.uid()), '[]'::jsonb),
    'recommendations', coalesce((select jsonb_agg(to_jsonb(x))
      from public.recommendations x where x.user_id = auth.uid()), '[]'::jsonb)
  );
$$;

-- create or replace preserves existing grants; restated for self-containedness.
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
