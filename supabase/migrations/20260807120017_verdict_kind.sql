-- manfriday migration 17: what kind of claim a verdict is allowed to make.
-- A views-only move on a channel whose videos naturally land anywhere between
-- 40 and 4,000 views is an observation, not a result. The kind travels with
-- the verdict so no surface can render a claim stronger than its evidence.

alter table public.recommendations
  add column verdict_kind text
    check (verdict_kind in ('viewers_stayed', 'head_to_head', 'what_happened', 'too_early'));

comment on column public.recommendations.verdict_kind is
  'viewers_stayed = measured on the retention curve (before-window vs after-window on the same video); head_to_head = YouTube Test & Compare picked a winner (creator-reported only — no API exposes those results, checked 2026-08-07); what_happened = views vs the channel''s normal, reported as observation and never as cause; too_early = not enough time or numbers yet. Null only on rows written before this column existed and on rows with no verdict.';

-- Every verdict written before today was computed from view counts alone, or
-- from numbers that never arrived. Label them for what they actually are.
update public.recommendations
   set verdict_kind = case when verdict = 'unclear' then 'too_early' else 'what_happened' end
 where verdict is not null and verdict_kind is null;

-- The invariant: nothing goes on the record without the kind of claim it makes.
alter table public.recommendations
  add constraint recommendations_verdict_kind_required
    check (verdict is null or verdict_kind is not null);
