-- manfriday: structured analyst output + grounded confidence on tips.
-- reports.data carries the analysts' structured JSON (options, confidence,
-- evidence chips) so the UI can render visuals on reload; body_md remains the
-- readable/exportable render. recommendations gain the confidence score and
-- its receipts so the Ledger and idea list can show WHY a tip is trusted.

alter table public.reports
  add column data jsonb;

comment on column public.reports.data is
  'Structured analyst output (options, confidence, evidence) — body_md stays the human-readable render of the same analysis.';

alter table public.recommendations
  add column confidence smallint
    constraint recommendations_confidence_range check (confidence between 0 and 100),
  add column evidence jsonb not null default '[]'::jsonb;

comment on column public.recommendations.confidence is
  'Grounded 0-100 score — computed from the evidence receipts, capped on thin data. Null for tips created before confidence existed.';
comment on column public.recommendations.evidence is
  '[{"kind": "ledger"|"library"|"search"|"audience"|"caution", "label": text}] — the receipts the confidence score is built from.';
