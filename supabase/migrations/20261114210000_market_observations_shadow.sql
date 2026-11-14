-- Store auditable GDELT/Web NGrams measurements without changing game prices.
-- Raw observations remain in shadow mode until candidate relevance and a price formula are approved.
create table if not exists public.market_observations (
  candidate_id text not null,
  label text not null,
  category text not null,
  locale text not null default 'global',
  observation_date date not null,
  matched_records integer not null default 0 check (matched_records >= 0),
  unique_articles integer not null default 0 check (unique_articles >= 0),
  match_quality text not null,
  review_status text not null default 'manual_review_required',
  evidence_count integer not null default 0 check (evidence_count >= 0),
  quality_flags jsonb not null default '[]'::jsonb,
  source text not null default 'GDELT Web News NGrams 3.0',
  coverage_start_utc text,
  coverage_end_utc text,
  imported_at timestamptz not null default now(),
  primary key (candidate_id, observation_date)
);

alter table public.market_observations enable row level security;
revoke all on public.market_observations from anon, authenticated;
comment on table public.market_observations is
  'Raw GDELT Web NGrams daily observations for audit only. Not a validated popularity index and not used for instrument prices.';
