-- Preserve news timing and freeze evidence snapshots. Analyst reports remain
-- observations; no Trader, command or execution function is changed.
begin;

alter table public.news_items alter column event_at drop not null;
alter table public.news_items
  add column published_at timestamptz,
  add column observed_at timestamptz,
  add column fetched_at timestamptz,
  add column feed_id text,
  add column timestamp_raw text,
  add column timestamp_quality text not null default 'legacy_unverified',
  add column freshness text not null default 'unknown',
  add column topics jsonb not null default '[]'::jsonb check (jsonb_typeof(topics) = 'array'),
  add column relevance_reason text,
  add column story_key text;
-- Historical event_at values are retained, without certifying the old UTC assumption.

create table public.analyst_reports (
  robot_id uuid not null references public.robots(id) on delete cascade,
  report_id uuid not null,
  generated_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  version text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 80000),
  primary key (robot_id, report_id)
);
create index analyst_reports_recent_idx on public.analyst_reports(robot_id, generated_at desc);
create index analyst_reports_retention_idx on public.analyst_reports(recorded_at);
alter table public.analyst_reports enable row level security;
create policy "members read analyst reports" on public.analyst_reports
  for select to authenticated using ((select public.is_member()));
revoke all on public.analyst_reports from anon, authenticated;
grant select on public.analyst_reports to authenticated;


commit;
