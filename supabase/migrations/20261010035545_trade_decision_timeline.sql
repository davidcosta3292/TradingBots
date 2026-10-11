-- Observational execution evidence; no order or command authorization.
begin;
create table public.decision_events (
  robot_id uuid not null references public.robots(id) on delete cascade,
  event_id text not null check (length(event_id) between 1 and 160),
  check_id text check (length(check_id) between 1 and 96),
  attempt_id text check (length(attempt_id) between 1 and 128),
  bar_at timestamptz,
  version text not null check (length(version) between 1 and 32),
  kind text not null check (kind in ('decision','submission','response','fill','order_state','exit','telemetry')),
  stage text not null check (stage in ('waiting','blocked','ready','submitted','accepted','rejected','unknown','filled','order_filled','canceled','expired','closed','reversed','invalid')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  entry_point text not null check (entry_point in ('OnNewBar','CTrade','OnTradeTransaction','HistoryRecovery','ReportIngestion')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768),
  primary key (robot_id,event_id)
);
create index decision_events_robot_recent_idx on public.decision_events(robot_id,occurred_at desc);
create index decision_events_check_idx on public.decision_events(robot_id,check_id,occurred_at);
create index decision_events_retention_idx on public.decision_events(recorded_at);
alter table public.decision_events enable row level security;
create policy "members inspect decision events" on public.decision_events
  for select to authenticated using ((select public.is_member()));
revoke all on public.decision_events from public,anon,authenticated;
grant select on public.decision_events to authenticated;

create function public.capture_decision_events() returns trigger
language plpgsql security invoker set search_path = public,pg_temp as $$
declare
  v_batch jsonb := new.status->'timeline_batch';
  v_event jsonb;
  v_check jsonb;
  v_id text;
  v_check_id text;
  v_attempt text;
  v_version text;
  v_kind text;
  v_stage text;
  v_entry text;
  v_epoch double precision;
  v_bar double precision;
begin
  if new.assignment <> 'trader' or v_batch is null or v_batch = 'null'::jsonb then return new; end if;
  -- Bad telemetry must not block a heartbeat or an operator acknowledgement.
  if jsonb_typeof(v_batch) <> 'array' or octet_length(v_batch::text) > 250000 then
    insert into public.decision_events(robot_id,event_id,version,kind,stage,occurred_at,entry_point,payload)
      values(new.id,'invalid-batch:'||md5(v_batch::text),'unknown','telemetry','invalid',now(),'ReportIngestion',
        '{"message":"Invalid telemetry batch discarded; robot report still accepted"}'::jsonb)
      on conflict do nothing;
    return new;
  end if;
  if jsonb_array_length(v_batch) > 20 then
    insert into public.decision_events(robot_id,event_id,version,kind,stage,occurred_at,entry_point,payload)
      values(new.id,'invalid-batch:'||md5(v_batch::text),'unknown','telemetry','invalid',now(),'ReportIngestion',
        '{"message":"Telemetry batch exceeds 20 records; robot report still accepted"}'::jsonb)
      on conflict do nothing;
    return new;
  end if;
  for v_event in select value from jsonb_array_elements(v_batch) loop
    begin
      v_id:=v_event->>'event_id'; v_check_id:=v_event->>'check_id'; v_attempt:=v_event->>'attempt_id';
      v_version:=v_event->>'version'; v_kind:=v_event->>'kind'; v_stage:=v_event->>'stage'; v_entry:=v_event->>'entry_point';
      if jsonb_typeof(v_event) <> 'object' or v_id is null or length(v_id) not between 1 and 160
        or v_version is null or length(v_version) not between 1 and 32
        or v_kind is null or v_kind not in ('decision','submission','response','fill','order_state','exit')
        or v_stage is null or v_stage not in ('waiting','blocked','ready','submitted','accepted','rejected','unknown','filled','order_filled','canceled','expired','closed','reversed')
        or v_entry is null or v_entry not in ('OnNewBar','CTrade','OnTradeTransaction','HistoryRecovery')
        or jsonb_typeof(v_event->'at') is distinct from 'number'
        or jsonb_typeof(v_event->'payload') is distinct from 'object'
        or octet_length((v_event->'payload')::text)>32768 then raise exception 'Invalid event'; end if;
      v_epoch:=(v_event->>'at')::double precision;
      if v_epoch<1262304000 or v_epoch>4102444800 or v_epoch<>floor(v_epoch) then raise exception 'Invalid event time'; end if;
      v_bar:=null;
      if v_check_id is not null then
        if jsonb_typeof(v_event->'bar_at') is distinct from 'number' or length(v_check_id) not between 1 and 96 then
          raise exception 'Invalid correlation'; end if;
        v_bar:=(v_event->>'bar_at')::double precision;
        if v_bar<1262304000 or v_bar>4102444800 or v_bar<>floor(v_bar)
          or v_check_id <> v_version||'/'||(v_bar::bigint)::text then raise exception 'Invalid correlation'; end if;
        if v_attempt is not null and (length(v_attempt)>128 or left(v_attempt,length(v_check_id)+1)<>v_check_id||'/') then
          raise exception 'Invalid attempt'; end if;
      elsif v_attempt is not null or (v_event->'bar_at' is not null and v_event->'bar_at'<>'null'::jsonb) then
        raise exception 'Unlinked event contains correlation';
      end if;
      if v_kind='decision' then
        v_check:=v_event->'payload'->'check';
        if v_check_id is null or v_attempt is not null or jsonb_typeof(v_check) is distinct from 'object'
          or v_check->>'version' is distinct from v_version or v_check->>'check_id' is distinct from v_check_id
          or jsonb_typeof(v_check->'at') is distinct from 'number' then raise exception 'Invalid check'; end if;
        if (v_check->>'at')::double precision <> v_bar then raise exception 'Check time mismatch'; end if;
        insert into public.strategy_checks(robot_id,bar_at,version,payload)
          values(new.id,to_timestamp(v_bar),v_version,v_check) on conflict do nothing;
      end if;
      insert into public.decision_events(robot_id,event_id,check_id,attempt_id,bar_at,version,kind,stage,occurred_at,entry_point,payload)
        values(new.id,v_id,v_check_id,v_attempt,to_timestamp(v_bar),v_version,v_kind,v_stage,to_timestamp(v_epoch),v_entry,v_event->'payload')
        on conflict (robot_id,event_id) do nothing;
    exception when others then
      -- Do not echo the rejected object, which might contain arbitrary data.
      insert into public.decision_events(robot_id,event_id,version,kind,stage,occurred_at,entry_point,payload)
        values(new.id,'invalid-event:'||md5(v_event::text),'unknown','telemetry','invalid',now(),'ReportIngestion',
          jsonb_build_object('message','Invalid telemetry record discarded; robot report still accepted','sqlstate',sqlstate))
        on conflict do nothing;
    end;
  end loop;
  return new;
end;
$$;
revoke all on function public.capture_decision_events() from public,anon,authenticated;
create trigger record_robot_timeline after update of status on public.robots
  for each row when (old.status->'timeline_batch' is distinct from new.status->'timeline_batch')
  execute function public.capture_decision_events();
alter publication supabase_realtime add table public.decision_events;
select cron.schedule('decision-event-retention','27 3 * * *',
  $$delete from public.decision_events where recorded_at < now() - interval '30 days'$$);
commit;
