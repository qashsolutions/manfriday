-- manfriday: security-advisor fix. handle_new_user() is a trigger function
-- (fires as postgres on auth.users insert); it must never be callable through
-- the REST /rpc endpoint by clients.

revoke all on function public.handle_new_user() from public, anon, authenticated;
