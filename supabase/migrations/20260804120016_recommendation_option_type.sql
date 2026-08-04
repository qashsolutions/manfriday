-- manfriday migration 16: revealed preference on picked options.
-- When a tip enters the Ledger because the creator picked one of the typed
-- options (safe/reach/bold), record which type — grounding aggregates the
-- counts so analysts can lead with what this creator actually picks.

alter table public.recommendations
  add column option_type text check (option_type in ('safe', 'reach', 'bold'));

comment on column public.recommendations.option_type is
  'safe|reach|bold when this tip was a typed option the creator picked; null for analyst-initiated tips (e.g. retention fixes).';
