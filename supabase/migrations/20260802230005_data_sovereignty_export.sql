-- manfriday: data-sovereignty export. One call returns everything the app
-- stores about the caller, as JSON, for the "full data download anytime"
-- guarantee (and the Google-verification privacy policy that promises it).
--
-- security definer so it can include YouTube-connection *metadata* even though
-- client grants on google_oauth_tokens are revoked; the refresh-token
-- ciphertext itself is deliberately never included.

create function public.export_my_data()
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
    'channels', coalesce((select jsonb_agg(to_jsonb(c))
      from public.channels c where c.user_id = auth.uid()), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(to_jsonb(v))
      from public.videos v where v.user_id = auth.uid()), '[]'::jsonb),
    'channel_snapshots', coalesce((select jsonb_agg(to_jsonb(s))
      from public.channel_snapshots s where s.user_id = auth.uid()), '[]'::jsonb),
    'video_snapshots', coalesce((select jsonb_agg(to_jsonb(s))
      from public.video_snapshots s where s.user_id = auth.uid()), '[]'::jsonb),
    'monitor_state', coalesce((select jsonb_agg(to_jsonb(m))
      from public.monitor_state m where m.user_id = auth.uid()), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r))
      from public.reports r where r.user_id = auth.uid()), '[]'::jsonb),
    'recommendations', coalesce((select jsonb_agg(to_jsonb(x))
      from public.recommendations x where x.user_id = auth.uid()), '[]'::jsonb)
  );
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
