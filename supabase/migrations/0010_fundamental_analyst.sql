-- A read-only news watcher for the shared office. No trade commands or MT5
-- account access are granted to Analyst assignments.
begin;

create table public.news_items (
  robot_id uuid not null references public.robots(id) on delete cascade,
  item_key text not null check (item_key ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('Forex Factory', 'Investing.com', 'Bloomberg', 'WSJ')),
  kind text not null check (kind in ('calendar', 'headline')),
  title text not null,
  url text not null,
  event_at timestamptz not null,
  importance text,
  currency text,
  relevance smallint not null default 0 check (relevance between 0 and 2),
  seen_at timestamptz not null default now(),
  alerted_at timestamptz,
  primary key (robot_id, item_key)
);
create index news_items_recent_idx on public.news_items (robot_id, event_at desc);
alter table public.news_items enable row level security;
create policy "members see news" on public.news_items for select to authenticated
  using (public.is_member());
revoke all on public.news_items from anon;
revoke insert, update, delete, truncate on public.news_items from authenticated;
grant select on public.news_items to authenticated;

-- The old trigger keeps non-Trader slots from accepting MT5 reports. Only the
-- dedicated analyst_sync RPC sets this transaction-local marker.
create or replace function public.reject_nontrader_report()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.last_report_at is distinct from old.last_report_at
     and new.assignment <> 'trader'
     and not (new.assignment = 'analyst'
       and current_setting('app.analyst_sync', true) = 'on') then
    raise exception 'This assignment has no permitted reporting runtime' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Owner-created Analysts receive a one-time token, like Traders, but the
-- token is accepted only by analyst_sync. Other role names remain labels.
create or replace function public.create_my_robot(p_name text, p_assignment text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_name text := btrim(p_name);
  v_robot uuid;
  v_token text;
begin
  if v_owner is null or not exists (select 1 from public.office_members where user_id = v_owner) then
    raise exception 'Only office members can create a robot' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'Robot name must be 1 to 40 characters';
  end if;
  if p_assignment not in ('trader', 'risk_manager', 'coordinator', 'analyst') or p_assignment is null then
    raise exception 'Unknown assignment';
  end if;
  perform 1 from public.office_members where user_id = v_owner for update;
  if (select count(*) from public.robots where owner_id = v_owner) >= 6 then
    raise exception 'Six robots per member is the current office limit';
  end if;
  insert into public.robots (name, owner_id, assignment)
  values (v_name, v_owner, p_assignment) returning id into v_robot;
  if p_assignment in ('trader', 'analyst') then
    v_token := encode(gen_random_bytes(24), 'hex');
    insert into public.robot_secrets (robot_id, token_hash)
    values (v_robot, encode(digest(v_token, 'sha256'), 'hex'));
  end if;
  return jsonb_build_object('id', v_robot, 'name', v_name,
    'assignment', p_assignment, 'token', v_token);
end;
$$;
revoke all on function public.create_my_robot(text, text) from public, anon;
grant execute on function public.create_my_robot(text, text) to authenticated;

create or replace function public.set_robot_assignment(p_robot uuid, p_assignment text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_old text;
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_assignment not in ('trader', 'risk_manager', 'coordinator', 'analyst') or p_assignment is null then
    raise exception 'Unknown assignment';
  end if;
  select assignment into v_old from public.robots
  where id = p_robot and owner_id = auth.uid() and last_report_at is null for update;
  if v_old is null then
    raise exception 'Only the owner can change an unconnected assignment' using errcode = '42501';
  end if;
  if v_old <> p_assignment then
    update public.robots set assignment = p_assignment where id = p_robot;
    if p_assignment in ('trader', 'analyst') then
      v_token := encode(gen_random_bytes(24), 'hex');
      insert into public.robot_secrets (robot_id, token_hash)
      values (p_robot, encode(digest(v_token, 'sha256'), 'hex'))
      on conflict (robot_id) do update set token_hash = excluded.token_hash;
    else
      delete from public.robot_secrets where robot_id = p_robot;
    end if;
  end if;
  return jsonb_build_object('assignment', p_assignment, 'token', v_token);
end;
$$;
revoke all on function public.set_robot_assignment(uuid, text) from public, anon;
grant execute on function public.set_robot_assignment(uuid, text) to authenticated;

-- Harden the existing Trader RPC so an Analyst token cannot use the Trader
-- door, even with an empty report.
create or replace function public.robot_sync(p_token text, p_report jsonb default null)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_robot uuid;
  v_item jsonb;
  v_pending text;
begin
  select s.robot_id into v_robot from public.robot_secrets s
  join public.robots r on r.id = s.robot_id and r.assignment = 'trader'
  where s.token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if v_robot is null then
    raise exception 'unknown Trader token' using errcode = '28000';
  end if;
  if p_report is not null then
    update public.robots set
      state = coalesce(p_report ->> 'state', state),
      account_login = coalesce((p_report ->> 'account_login')::bigint, account_login),
      symbol = coalesce(p_report ->> 'symbol', symbol),
      magic = coalesce((p_report ->> 'magic')::bigint, magic),
      status = coalesce(p_report -> 'status', status),
      last_report_at = now()
    where id = v_robot;
    for v_item in select * from jsonb_array_elements(coalesce(p_report -> 'acks', '[]'::jsonb)) loop
      update public.commands set
        status = case when v_item ->> 'status' = 'done' then 'done' else 'refused' end,
        result = left(v_item ->> 'result', 500), acked_at = now()
      where id = (v_item ->> 'id')::bigint and robot_id = v_robot and status = 'pending';
    end loop;
    for v_item in select * from jsonb_array_elements(coalesce(p_report -> 'deals', '[]'::jsonb)) loop
      insert into public.deals (robot_id, ticket, position_id, deal_time, symbol, side, entry,
                                volume, price, profit, commission, swap, reason, comment)
      values (v_robot, (v_item ->> 'ticket')::bigint, (v_item ->> 'position')::bigint,
              to_timestamp((v_item ->> 'time')::bigint), v_item ->> 'symbol',
              v_item ->> 'side', v_item ->> 'entry', (v_item ->> 'volume')::numeric,
              (v_item ->> 'price')::numeric, (v_item ->> 'profit')::numeric,
              (v_item ->> 'commission')::numeric, (v_item ->> 'swap')::numeric,
              v_item ->> 'reason', left(v_item ->> 'comment', 200))
      on conflict (robot_id, ticket) do nothing;
    end loop;
    for v_item in select * from jsonb_array_elements(coalesce(p_report -> 'events', '[]'::jsonb)) loop
      insert into public.robot_events (robot_id, kind, message)
      values (v_robot, left(coalesce(v_item ->> 'kind', 'info'), 40),
              left(coalesce(v_item ->> 'message', ''), 1000));
    end loop;
  end if;
  update public.commands set status = 'expired'
    where robot_id = v_robot and status = 'pending' and expires_at < now();
  select coalesce(string_agg(c.id::text || ':' || c.type, ';' order by c.id), '')
    into v_pending from public.commands c where c.robot_id = v_robot and c.status = 'pending';
  return v_pending;
end;
$$;
revoke all on function public.robot_sync(text, jsonb) from public, authenticated;
grant execute on function public.robot_sync(text, jsonb) to anon;

create function public.analyst_sync(p_token text, p_status jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_robot uuid;
  v_item jsonb;
  v_old_status jsonb;
  v_alert text;
  v_alert_ids text[];
  v_saved integer := 0;
begin
  select s.robot_id into v_robot from public.robot_secrets s
  join public.robots r on r.id = s.robot_id and r.assignment = 'analyst'
  where s.token_hash = encode(digest(p_token, 'sha256'), 'hex') for update of r;
  if v_robot is null then
    raise exception 'unknown Analyst token' using errcode = '28000';
  end if;
  if jsonb_typeof(p_status) <> 'object' or pg_column_size(p_status) > 20000
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 80 then
    raise exception 'Invalid Analyst report';
  end if;
  select status into v_old_status from public.robots where id = v_robot;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if v_item ->> 'source' not in ('Forex Factory', 'Investing.com', 'Bloomberg', 'WSJ')
       or v_item ->> 'kind' not in ('calendar', 'headline')
       or coalesce(v_item ->> 'item_key', '') !~ '^[0-9a-f]{64}$'
       or left(coalesce(v_item ->> 'url', ''), 8) <> 'https://'
       or (v_item ->> 'event_at')::timestamptz not between now() - interval '7 days' and now() + interval '14 days' then
      raise exception 'Invalid news item';
    end if;
    insert into public.news_items (robot_id, item_key, source, kind, title, url,
                                   event_at, importance, currency, relevance)
    values (v_robot, v_item ->> 'item_key', v_item ->> 'source', v_item ->> 'kind',
            left(v_item ->> 'title', 240), left(v_item ->> 'url', 500),
            (v_item ->> 'event_at')::timestamptz,
            left(v_item ->> 'importance', 20), left(v_item ->> 'currency', 8),
            least(2, greatest(0, coalesce((v_item ->> 'relevance')::integer, 0))))
    on conflict (robot_id, item_key) do update set
      event_at = excluded.event_at,
      importance = excluded.importance,
      relevance = excluded.relevance;
    v_saved := v_saved + 1;
  end loop;
  perform set_config('app.analyst_sync', 'on', true);
  update public.robots set state = 'active',
    status = (p_status - 'last_alert_at') || jsonb_build_object('last_alert_at', v_old_status -> 'last_alert_at'),
    last_report_at = now()
  where id = v_robot;

  -- One compact Telegram update at most every 30 minutes. Old headlines do
  -- not become alerts after a restart. Upcoming high-impact USD events do.
  if coalesce((v_old_status ->> 'last_alert_at')::timestamptz,
              '-infinity'::timestamptz) < now() - interval '30 minutes' then
    with chosen as (
      select item_key, source, title, url, kind, event_at
      from public.news_items
      where robot_id = v_robot and alerted_at is null
        and ((kind = 'headline' and relevance = 2
              and event_at between now() - interval '60 minutes' and now())
          or (kind = 'calendar' and importance = 'High' and currency = 'USD'
              and event_at between now() and now() + interval '90 minutes'))
      order by case when kind = 'calendar' then 0 else 1 end, event_at desc
      limit 3
    ), marked as (
      update public.news_items n set alerted_at = now()
      from chosen c where n.robot_id = v_robot and n.item_key = c.item_key
      returning c.item_key, c.source, c.title, c.url, c.kind, c.event_at
    )
    select string_agg(
      case when kind = 'calendar' then 'USD event ' || to_char(event_at at time zone 'Europe/Prague', 'HH24:MI') || ' Prague'
           else source end || ': ' || title || E'\n' || url,
      E'\n\n') into v_alert from marked;
    if v_alert is not null then
      insert into public.robot_events(robot_id, kind, message)
      values (v_robot, 'info', left('Gold news watch (information only):' || E'\n' || v_alert, 1000));
      update public.robots set status = jsonb_set(status, '{last_alert_at}', to_jsonb(now()))
      where id = v_robot;
    end if;
  end if;
  return jsonb_build_object('items_received', v_saved, 'alert_sent', v_alert is not null);
end;
$$;
revoke all on function public.analyst_sync(text, jsonb, jsonb) from public, authenticated;
grant execute on function public.analyst_sync(text, jsonb, jsonb) to anon;

-- The Analyst polls every five minutes. The Trader's shorter watchdog stays.
create or replace function public.office_watchdog()
returns void language plpgsql security definer set search_path = public
as $$
declare
  s public.office_settings;
  r record;
begin
  select * into s from public.office_settings where id;
  for r in
    select id, name, last_report_at from public.robots
    where not offline_alerted and last_report_at is not null
      and last_report_at < now() - case when assignment = 'analyst'
        then interval '12 minutes' else s.offline_after end
  loop
    perform public.telegram('🔴 ' || r.name || ' is offline. Last report at '
      || to_char(r.last_report_at at time zone 'Europe/Prague', 'HH24:MI') || ' Prague time.');
    update public.robots set offline_alerted = true where id = r.id;
  end loop;
  for r in
    select id, name from public.robots
    where offline_alerted and last_report_at >= now() - case
      when assignment = 'analyst' then interval '12 minutes' else s.offline_after end
  loop
    perform public.telegram('🟢 ' || r.name || ' is back online.');
    update public.robots set offline_alerted = false where id = r.id;
  end loop;
  for r in
    select c.id, c.type, rb.name from public.commands c
    join public.robots rb on rb.id = c.robot_id
    where not c.alerted and c.status in ('pending', 'expired')
      and c.created_at < now() - interval '10 seconds'
  loop
    perform public.telegram('⚠️ ' || r.name || ' did not confirm "'
      || case r.type when 'start' then 'Start' when 'pause' then 'Pause'
                     when 'done_today' then 'Done for today' else 'Close everything' end
      || '". Check that it is running.');
    update public.commands set alerted = true where id = r.id;
  end loop;
end;
$$;
revoke all on function public.office_watchdog() from public, anon, authenticated;

commit;
