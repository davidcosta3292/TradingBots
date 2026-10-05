-- Owners can remove unused robots from the office. A connected Trader must
-- first be paused, flat and detached from MetaTrader; deleting an Analyst
-- also removes its matching server schedule and Vault credential.
begin;

create function public.delete_my_robot(p_robot uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_robot public.robots%rowtype;
  v_vault_secret uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select * into v_robot from public.robots
  where id = p_robot and owner_id = auth.uid() for update;
  if not found then
    raise exception 'Only the robot owner can delete it' using errcode = '42501';
  end if;

  if v_robot.assignment = 'trader' and v_robot.last_report_at is not null then
    if v_robot.state <> 'paused' then
      raise exception 'Pause this Trader and wait for its confirmation before deleting it';
    end if;
    if jsonb_typeof(v_robot.status -> 'positions') is distinct from 'array' then
      raise exception 'Wait for a complete position report before deleting this Trader';
    end if;
    if jsonb_array_length(v_robot.status -> 'positions') > 0 then
      raise exception 'Close its open positions before deleting this Trader';
    end if;
    if v_robot.last_report_at > now() - interval '2 minutes' then
      raise exception 'Remove the EA from MetaTrader and wait two minutes before deleting it';
    end if;
  end if;

  if v_robot.assignment = 'analyst' then
    -- Only the Analyst whose token is in our shared five-minute job may
    -- stop that job. Other unscheduled Analyst slots are independent.
    select v.id into v_vault_secret
    from vault.decrypted_secrets v
    join public.robot_secrets s on s.robot_id = p_robot
    where v.name = 'trading_analyst_token'
      and s.token_hash = encode(extensions.digest(v.decrypted_secret, 'sha256'), 'hex');

    if v_vault_secret is not null then
      if exists (select 1 from cron.job where jobname = 'office-fundamental-analyst') then
        if not cron.unschedule('office-fundamental-analyst') then
          raise exception 'Could not stop the Analyst schedule';
        end if;
      end if;
      delete from vault.secrets where id = v_vault_secret;
    end if;
  end if;

  -- Existing foreign keys cascade to this robot's token, commands, deals,
  -- events and news items. The office asks the owner to confirm that loss.
  delete from public.robots where id = p_robot;
end;
$$;

revoke all on function public.delete_my_robot(uuid) from public, anon;
grant execute on function public.delete_my_robot(uuid) to authenticated;

commit;
