-- Trading Office: a Telegram message the moment something happens.
-- Run after 0003. From now on Telegram also tells you when:
--   - a robot confirms or refuses a button press, and who pressed it;
--   - a robot opens or closes a trade, or skips a signal;
--   - a robot starts a new FTMO day after Done for today.
-- Starts, stops, limit stops and errors now arrive right away instead of
-- within the minute. The one-minute watchdog keeps the alerts that need time
-- to pass: offline, back online, and button presses nobody confirmed.
--
-- Also puts trades (the deals table) on the live feed, for the office's
-- trade history.

begin;

-- The wording of each message. Kept apart so it can be tried with a plain select.
create function public.command_message(p_command public.commands)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when p_command.status = 'refused' then '⛔ '
              else case p_command.type when 'start' then '▶️ ' when 'pause' then '⏸️ '
                                       when 'done_today' then '🌙 ' else '❌ ' end
         end
      || r.name || ': ' || coalesce(m.display_name, 'someone') || ' pressed '
      || case p_command.type when 'start' then 'Start' when 'pause' then 'Pause'
                             when 'done_today' then 'Done for today' else 'Close everything' end
      || '. ' || case when p_command.status = 'refused' then 'Refused' else 'Confirmed' end
      || coalesce(': ' || nullif(p_command.result, ''), '') || '.'
  from public.robots r
  left join public.office_members m on m.user_id = p_command.created_by
  where r.id = p_command.robot_id;
$$;

create function public.event_message(p_robot text, p_kind text, p_message text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when p_kind = 'guard' then '🛑 '
           when p_kind = 'error' then '⚠️ '
           when p_kind = 'trade' and p_message like 'Opened BUY%' then '📈 '
           when p_kind = 'trade' and p_message like 'Opened SELL%' then '📉 '
           when p_kind = 'trade' and p_message like 'Closed%: -%' then '🔻 '
           when p_kind = 'trade' and p_message like 'Closed%' then '💰 '
           when p_kind = 'trade' and p_message like 'Skipped%' then '⏭️ '
           when p_kind = 'trade' then '🔁 '
           else 'ℹ️ '
         end || p_robot || ': ' || p_message;
$$;

-- A button press the robot just answered. A Telegram hiccup must never break
-- the robot's report, so errors here only leave a warning in the database log.
create function public.notify_command()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.telegram(public.command_message(new));
  exception when others then
    raise warning 'Telegram message for command % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger commands_notify
after update of status on public.commands
for each row
when (old.status = 'pending' and new.status in ('done', 'refused'))
execute function public.notify_command();

-- Robot events worth a message. The robot's own "command" events are left out:
-- the message above already says what happened, and who pressed the button.
create function public.notify_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind in ('started', 'stopped', 'guard', 'error', 'trade', 'info') then
    begin
      perform public.telegram(public.event_message(
        (select name from public.robots where id = new.robot_id), new.kind, new.message));
    exception when others then
      raise warning 'Telegram message for a robot event failed: %', sqlerrm;
    end;
  end if;
  new.notified := true;
  return new;
end;
$$;

create trigger robot_events_notify
before insert on public.robot_events
for each row
execute function public.notify_event();

-- The watchdog, now without the robot events (the trigger above sends those).
create or replace function public.office_watchdog()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.office_settings;
  r record;
begin
  select * into s from public.office_settings where id;

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
end;
$$;

revoke all on function public.command_message(public.commands) from public, anon, authenticated;
revoke all on function public.event_message(text, text, text) from public, anon, authenticated;
revoke all on function public.notify_command() from public, anon, authenticated;
revoke all on function public.notify_event() from public, anon, authenticated;
revoke all on function public.office_watchdog() from public, anon, authenticated;

-- Trades on the live feed, so the office's trade history updates by itself.
alter publication supabase_realtime add table public.deals;

commit;
