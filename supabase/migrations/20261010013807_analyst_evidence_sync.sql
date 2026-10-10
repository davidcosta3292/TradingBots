begin;
create or replace function public.analyst_sync(p_token text, p_status jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_robot uuid;
  v_item jsonb;
  v_old_status jsonb;
  v_report jsonb := p_status -> 'report';
  v_report_id uuid;
  v_event timestamptz;
  v_published timestamptz;
  v_fetched timestamptz;
  v_alert text;
  v_saved integer := 0;
begin
  select s.robot_id into v_robot from public.robot_secrets s
  join public.robots r on r.id = s.robot_id and r.assignment = 'analyst'
  where s.token_hash = encode(digest(p_token, 'sha256'), 'hex') for update of r;
  if v_robot is null then
    raise exception 'unknown Analyst token' using errcode = '28000';
  end if;
  if jsonb_typeof(p_status) is distinct from 'object' or octet_length(p_status::text) > 80000
     or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 80
     or octet_length(p_items::text) > 160000 then
    raise exception 'Invalid Analyst report';
  end if;
  select status into v_old_status from public.robots where id = v_robot;

  if v_report is not null then
    if jsonb_typeof(v_report) is distinct from 'object'
       or v_report ->> 'direction' is distinct from 'unknown'
       or coalesce(v_report ->> 'report_id', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(p_status ->> 'version', '') <> '1.2-server' then
      raise exception 'Invalid evidence snapshot';
    end if;
    v_report_id := (v_report ->> 'report_id')::uuid;
    if (v_report ->> 'generated_at')::timestamptz is null
       or (v_report ->> 'generated_at')::timestamptz not between now() - interval '1 day' and now() + interval '5 minutes'
       or (v_report ->> 'expires_at')::timestamptz is null
       or (v_report ->> 'expires_at')::timestamptz <= (v_report ->> 'generated_at')::timestamptz then
      raise exception 'Invalid evidence timing';
    end if;
    -- A retried report cannot replace evidence or create another alert.
    if exists (select 1 from public.analyst_reports where robot_id = v_robot and report_id = v_report_id) then
      return jsonb_build_object('items_received', 0, 'alert_queued', false, 'duplicate', true);
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_event := nullif(v_item ->> 'event_at', '')::timestamptz;
    v_published := nullif(v_item ->> 'published_at', '')::timestamptz;
    v_fetched := nullif(v_item ->> 'fetched_at', '')::timestamptz;
    if coalesce(v_item ->> 'source', '') not in ('Forex Factory', 'Investing.com', 'Bloomberg', 'WSJ')
       or coalesce(v_item ->> 'kind', '') not in ('calendar', 'headline')
       or coalesce(v_item ->> 'item_key', '') !~ '^[0-9a-f]{64}$'
       or char_length(coalesce(v_item ->> 'title', '')) not between 1 and 240
       or coalesce(v_item ->> 'url', '') !~ '^https://([a-zA-Z0-9-]+\.)*(forexfactory\.com|investing\.com|bloomberg\.com|wsj\.com)/'
       or (v_item ->> 'kind' = 'calendar' and v_event is null)
       or (v_event is not null and v_event not between now() - interval '7 days' and now() + interval '14 days')
       or (v_published is not null and (v_published not between now() - interval '7 days' and now() + interval '5 minutes'
         or v_item ->> 'timestamp_quality' is distinct from 'explicit_timezone'))
       or (v_report is not null and (v_fetched is null or v_fetched not between now() - interval '1 day' and now() + interval '5 minutes'))
       or jsonb_typeof(coalesce(v_item -> 'topics', '[]'::jsonb)) is distinct from 'array' then
      raise exception 'Invalid news evidence';
    end if;
    insert into public.news_items (robot_id, item_key, source, kind, title, url,
      event_at, importance, currency, relevance, published_at, observed_at, fetched_at,
      feed_id, timestamp_raw, timestamp_quality, freshness, topics, relevance_reason, story_key)
    values (v_robot, v_item ->> 'item_key', v_item ->> 'source', v_item ->> 'kind',
      v_item ->> 'title', left(v_item ->> 'url', 500), v_event,
      left(v_item ->> 'importance', 20), left(v_item ->> 'currency', 8),
      least(2, greatest(0, coalesce((v_item ->> 'relevance')::integer, 0))),
      v_published, nullif(v_item ->> 'observed_at', '')::timestamptz, v_fetched,
      left(v_item ->> 'feed_id', 80), left(v_item ->> 'timestamp_raw', 100),
      left(coalesce(v_item ->> 'timestamp_quality', 'legacy_unverified'), 40),
      left(coalesce(v_item ->> 'freshness', 'unknown'), 40), coalesce(v_item -> 'topics', '[]'::jsonb),
      left(v_item ->> 'relevance_reason', 600), left(v_item ->> 'story_key', 64))
    on conflict (robot_id, item_key) do update set
      title = excluded.title, event_at = excluded.event_at, importance = excluded.importance,
      relevance = excluded.relevance, published_at = excluded.published_at,
      observed_at = excluded.observed_at, fetched_at = excluded.fetched_at,
      feed_id = excluded.feed_id, timestamp_raw = excluded.timestamp_raw,
      timestamp_quality = excluded.timestamp_quality, freshness = excluded.freshness,
      topics = excluded.topics, relevance_reason = excluded.relevance_reason, story_key = excluded.story_key;
    v_saved := v_saved + 1;
  end loop;

  if v_report_id is not null then
    insert into public.analyst_reports(robot_id, report_id, generated_at, version, payload)
    values (v_robot, v_report_id, (v_report ->> 'generated_at')::timestamptz,
      left(p_status ->> 'version', 32), p_status - 'last_alert_at');
  end if;
  perform set_config('app.analyst_sync', 'on', true);
  update public.robots set state = 'active',
    status = (p_status - 'last_alert_at') || jsonb_build_object('last_alert_at', v_old_status -> 'last_alert_at'),
    last_report_at = now()
  where id = v_robot;

  -- Queued information only. Missing publication zones never become fresh alerts.
  -- Require the item to be observed in this scan, rather than a cached old schedule.
  if coalesce((v_old_status ->> 'last_alert_at')::timestamptz,
              '-infinity'::timestamptz) < now() - interval '30 minutes' then
    with chosen as (
      select distinct on (coalesce(story_key, item_key)) item_key, source, title, url, kind, event_at, published_at
      from public.news_items
      where robot_id = v_robot and alerted_at is null
        and fetched_at >= now() - interval '10 minutes'
        and item_key in (select i ->> 'item_key' from jsonb_array_elements(p_items) i)
        and ((kind = 'headline' and relevance = 2 and timestamp_quality = 'explicit_timezone'
              and published_at between now() - interval '60 minutes' and now())
          or (kind = 'calendar' and importance = 'High' and currency = 'USD'
              and event_at between now() and now() + interval '90 minutes'))
        and not exists (select 1 from public.news_items prior
          where prior.robot_id = v_robot and prior.alerted_at is not null
            and (prior.item_key = news_items.item_key or (prior.story_key is not null and prior.story_key = news_items.story_key)))
      order by coalesce(story_key, item_key), event_at desc
    ), limited as (
      select * from chosen order by case when kind = 'calendar' then 0 else 1 end, event_at desc limit 2
    ), marked as (
      update public.news_items n set alerted_at = now()
      from limited c where n.robot_id = v_robot and n.item_key = c.item_key
      returning c.source, c.title, c.url, c.kind, c.event_at, c.published_at
    )
    select string_agg(
      case when kind = 'calendar' then 'USD release · ' || to_char(event_at at time zone 'America/New_York', 'Dy HH24:MI') || ' NY'
           else source || ' · published ' || to_char(published_at at time zone 'America/New_York', 'Dy HH24:MI') || ' NY' end
      || E'\n' || left(title, 180) || E'\n' || url, E'\n\n') into v_alert from marked;
    if v_alert is not null then
      insert into public.robot_events(robot_id, kind, message)
      values (v_robot, 'info', left('Gold evidence watch · direction unknown.' || E'\n'
        || 'Calendar / titles only; verify results and price reaction.' || E'\n\n' || v_alert
        || E'\n\nReport: https://trading-office-puce.vercel.app/', 1000));
      update public.robots set status = jsonb_set(status, '{last_alert_at}', to_jsonb(now())) where id = v_robot;
    end if;
  end if;
  return jsonb_build_object('items_received', v_saved, 'alert_queued', v_alert is not null, 'report_id', v_report_id);
end;
$$;
revoke all on function public.analyst_sync(text, jsonb, jsonb) from public, authenticated;
grant execute on function public.analyst_sync(text, jsonb, jsonb) to anon;

commit;
