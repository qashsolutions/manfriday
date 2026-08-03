-- manfriday: pause account. Paused = the analyst team stops all scheduled
-- work and (later) billing pauses; data stays intact. Cleared by resuming.
-- Users update their own profile row (existing RLS update policy covers it).

alter table public.profiles add column paused_at timestamptz;

comment on column public.profiles.paused_at is
  'When set, the account is paused: no scheduled analysis runs, no reports, no notifications. Null = active.';
