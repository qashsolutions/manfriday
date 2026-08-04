-- manfriday migration 15: guide-stance preferences (Aug 4).
-- The user-declared context the APIs can't know — read by every analyst via
-- grounding. All optional; actual viewer demographics stay API-derived and are
-- deliberately NOT asked for here.

alter table public.channel_profiles
  add column language_culture text,
  add column monetization text,
  add column risk_appetite text,
  add column effort_budget text,
  add column constraints_notes text;

comment on column public.channel_profiles.language_culture is
  'Language(s) and cultural context of the content, in the creator''s words (e.g. "Tamil; Carnatic classical music, diaspora audience").';
comment on column public.channel_profiles.monetization is
  'How they earn or plan to earn — stage + income mix (e.g. "not monetized yet; aiming for classes + event promotion").';
comment on column public.channel_profiles.risk_appetite is
  'Which kind of advice they want emphasized: safe / balanced / bold.';
comment on column public.channel_profiles.effort_budget is
  'Time/effort they can realistically put in per video, in their words.';
comment on column public.channel_profiles.constraints_notes is
  'Hard constraints the analysts must respect (e.g. "no face on camera; no clickbait; some uploads are family archives").';
