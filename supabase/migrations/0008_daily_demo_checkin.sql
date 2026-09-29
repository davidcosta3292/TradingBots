-- One generic daily Telegram check-in after the Trader entry window ends at
-- 20:00 Prague. Financial details stay in the signed-in office.
begin;

alter table public.office_settings add column last_daily_report_date date;

create function public.office_daily_report()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prague timestamp := now() at time zone 'Europe/Prague';
  v_day date := v_prague::date;
begin
  -- pg_cron uses a fixed schedule; check Prague time here for DST.
  if extract(hour from v_prague) <> 20 or extract(minute from v_prague) >= 10 then
    return;
  end if;
  if not exists (
    select 1 from public.robots r
    where r.assignment = 'trader'
      and (r.last_report_at at time zone 'Europe/Prague')::date = v_day
  ) then
    return;
  end if;

  -- The settings row serializes concurrent runs and prevents duplicate days.
  update public.office_settings
  set last_daily_report_date = v_day
  where id
    and telegram_bot_token is not null
    and telegram_chat_id is not null
    and last_daily_report_date is distinct from v_day;
  if not found then
    return;
  end if;

  perform public.telegram('Trading Office: today''s demo status is ready. '
    || 'Sign in to the private office for trades, results and risk limits: '
    || 'https://trading-office-puce.vercel.app/');
end;
$$;

revoke all on function public.office_daily_report() from public, anon, authenticated;
select cron.schedule('office-daily-report', '*/5 * * * *',
  'select public.office_daily_report()');

commit;
