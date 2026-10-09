-- Persist structured diagnostic payloads; robot_sync's 1000-character
-- event-message limit is intentionally not used for these records.
begin;
create table public.strategy_checks (
  robot_id uuid not null references public.robots(id) on delete cascade,
  bar_at timestamptz not null,
  version text not null,
  recorded_at timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (robot_id, bar_at, version)
);
create index strategy_checks_recent_idx on public.strategy_checks (bar_at desc);
alter table public.strategy_checks enable row level security;
create policy "members see strategy checks" on public.strategy_checks
  for select to authenticated using (public.is_member());
revoke all on public.strategy_checks from anon, authenticated;
grant select on public.strategy_checks to authenticated;

create function public.capture_strategy_check() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_payload jsonb := new.status -> 'strategy_check';
  v_epoch double precision;
  v_version text;
begin
  if v_payload is null or jsonb_typeof(v_payload) <> 'object'
     or jsonb_typeof(v_payload -> 'at') is distinct from 'number'
     or octet_length(v_payload::text) > 32768 then return new; end if;
  v_epoch := (v_payload ->> 'at')::double precision;
  if v_epoch < 1262304000 or v_epoch > 4102444800 then return new; end if;
  v_version := left(coalesce(v_payload ->> 'version', 'unknown'), 32);
  insert into public.strategy_checks(robot_id, bar_at, version, payload)
  values (new.id, to_timestamp(v_epoch), v_version, v_payload)
  on conflict (robot_id, bar_at, version) do nothing;
  return new;
end;
$$;
revoke all on function public.capture_strategy_check() from public, anon, authenticated;
create trigger record_robot_strategy_check after update of status on public.robots
  for each row when (old.status -> 'strategy_check' is distinct from new.status -> 'strategy_check')
  execute function public.capture_strategy_check();
alter publication supabase_realtime add table public.strategy_checks;
select cron.schedule('strategy-check-retention', '17 3 * * *',
  $$delete from public.strategy_checks where bar_at < now() - interval '30 days'$$);
commit;
