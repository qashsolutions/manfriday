-- manfriday: core user profiles.
-- One row per app user, keyed 1:1 to auth.users (Supabase Auth, Google sign-in).
-- The FK cascade from auth.users is the root of the purge-on-delete chain:
-- deleting the auth user wipes the profile, and every other table cascades
-- from auth.users directly, so one admin deleteUser() call purges everything.

create extension if not exists moddatetime with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per app user, keyed to auth.users; cascades away on account deletion.';

alter table public.profiles enable row level security;

create policy "select own profile" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "update own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create trigger set_updated_at
  before update on public.profiles
  for each row execute function extensions.moddatetime (updated_at);

-- Auto-create the profile row when Supabase Auth inserts a new user
-- (fires on first Google sign-in). No client insert policy needed.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
