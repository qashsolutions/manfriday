-- manfriday: fidelity fixes against server.py's actual ledger lifecycle and
-- the yt-monitor state shape (found by code review, 2026-08-02).

-- update_recommendation sets status='resolved' when a verdict lands
-- (LEDGER_STATUSES, server.py:1792); the original check rejected it.
alter table public.recommendations drop constraint recommendations_status_check;
alter table public.recommendations add constraint recommendations_status_check
  check (status in ('open', 'applied', 'skipped', 'resolved'));

-- Fields the code writes that had nowhere to land.
alter table public.recommendations
  add column notes text,
  add column resolved_at timestamptz,
  add column baseline_error text,
  add column result_baseline_error text;

-- The code validates category against a closed tuple (LEDGER_CATEGORIES);
-- enforce the same set here.
alter table public.recommendations add constraint recommendations_category_check
  check (category in ('packaging', 'content', 'cadence', 'retention',
                      'monetization', 'general'));

-- Monitor remodel: the local state file keeps velocity snapshots in a
-- top-level `tracking` block keyed by video; in the DB that time series
-- belongs in video_snapshots (one row per observation, title/published live
-- on videos). monitor_state keeps only detection state.
alter table public.monitor_state drop column velocity_tracking;

comment on table public.monitor_state is
  'New-upload detection state per (user, channel): last check time + seen video IDs (cap ~200 per channel, enforced app-side like the local file). Velocity time series lives in video_snapshots.';
