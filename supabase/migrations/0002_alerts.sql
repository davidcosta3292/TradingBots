-- Trading Office: phone alerts on Telegram.
-- Run after 0001_office.sql. Then set your bot with:
--   select public.set_telegram('<bot token from @BotFather>', '<chat id>');
--   select public.telegram('Trading Office connected');
--
-- Once a minute a watchdog sends a message when:
--   - a robot goes quiet (no report for 2 minutes), and again when it's back;
--   - a button press was not confirmed by the robot;
--   - a robot starts, stops, hits a limit stop, or reports an error.

begin;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Single-row settings table. No policies, so browsers can't see the bot token.
create table public.office_settings (
  id boolean primary key default true check (id),
  telegram_bot_token text,
  telegram_chat_id text,
  offline_after interval not null default interval '2 minutes'
);
alter table public.office_settings enable row level security;
revoke all on public.office_settings from anon, authenticated;
insert into public.office_settings default values;

alter table public.robots add column offline_alerted boolean not null default false;
alter table public.commands add column alerted boolean not null default false;
alter table public.robot_events add column notified boolean not null default false;

create function public.set_telegram(p_bot_token text, p_chat_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.office_settings set telegram_bot_token = p_bot_token, telegram_chat_id = p_chat_id where id;
$$;

create function public.telegram(p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.office_settings;
begin
  select * into s from public.office_settings where id;
  if s.telegram_bot_token is null or s.telegram_chat_id is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || s.telegram_bot_token || '/sendMessage',
    body := jsonb_build_object('chat_id', s.telegram_chat_id, 'text', p_text, 'disable_web_page_preview', true)
  );
end;
$$;

create function public.office_watchdog()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.office_settings;
  r record;
  v_last_event bigint;
begin
  select * into s from public.office_settings where id;
  select coalesce(max(id), 0) into v_last_event from public.robot_events;

  -- Robots that went quiet.
  for r in
    select id, name, last_report_at from public.robots
    where not offline_alerted
      and last_report_at is not null
      and last_report_at < now() - s.offline_after
  loop
    perform public.telegram('🔴 ' || r.name || ' is offline. Last report at '
      || to_char(r.last_report_at at time zone 'Europe/Prague', 'HH24:MI') || ' Prague time.');
    update public.robots set offline_alerted = true where id = r.id;
  end loop;

  -- ...and came back.
  for r in
    select id, name from public.robots
    where offline_alerted and last_report_at >= now() - s.offline_after
  loop
    perform public.telegram('🟢 ' || r.name || ' is back online.');
    update public.robots set offline_alerted = false where id = r.id;
  end loop;

  -- Button presses the robot never confirmed.
  for r in
    select c.id, c.type, rb.name
    from public.commands c
    join public.robots rb on rb.id = c.robot_id
    where not c.alerted
      and c.status in ('pending', 'expired')
      and c.created_at < now() - interval '10 seconds'
  loop
    perform public.telegram('⚠️ ' || r.name || ' did not confirm "'
      || case r.type
           when 'start' then 'Start'
           when 'pause' then 'Pause'
           when 'done_today' then 'Done for today'
           else 'Close everything'
         end || '". Check that it is running.');
    update public.commands set alerted = true where id = r.id;
  end loop;

  -- Robot events worth a message.
  for r in
    select e.id, e.kind, e.message, rb.name
    from public.robot_events e
    join public.robots rb on rb.id = e.robot_id
    where not e.notified
      and e.id <= v_last_event
      and e.kind in ('started', 'stopped', 'guard', 'error')
    order by e.id
  loop
    perform public.telegram(
      case r.kind when 'guard' then '🛑 ' when 'error' then '⚠️ ' else 'ℹ️ ' end
      || r.name || ': ' || r.message);
  end loop;
  update public.robot_events set notified = true where not notified and id <= v_last_event;
end;
$$;

revoke all on function public.set_telegram(text, text) from public, anon, authenticated;
revoke all on function public.telegram(text) from public, anon, authenticated;
revoke all on function public.office_watchdog() from public, anon, authenticated;

select cron.schedule('office-watchdog', '* * * * *', 'select public.office_watchdog()');

commit;
