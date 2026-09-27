-- Expand the shared office to six slots per member. Assignment labels do not
-- grant trading ability: only Trader slots accept the MT5 EA and commands.
begin;

drop index public.robots_one_per_owner;

alter table public.robots add column assignment text not null default 'trader'
  check (assignment in ('trader', 'risk_manager', 'coordinator', 'analyst'));

drop policy "owners press buttons" on public.commands;
create policy "owners press buttons" on public.commands
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.robots r
      where r.id = robot_id and r.owner_id = auth.uid() and r.assignment = 'trader')
  );

-- robot_sync always changes last_report_at when an EA sends a report.
create function public.reject_nontrader_report()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.assignment <> 'trader' and new.last_report_at is distinct from old.last_report_at then
    raise exception 'This assignment has no MetaTrader runtime' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger reject_nontrader_report before update of last_report_at on public.robots
  for each row execute function public.reject_nontrader_report();
revoke all on function public.reject_nontrader_report() from public, anon, authenticated;

drop function public.create_my_robot(text);
create function public.create_my_robot(p_name text, p_assignment text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
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
  -- Serialise creation for one owner so concurrent clicks cannot exceed the cap.
  perform 1 from public.office_members where user_id = v_owner for update;
  if (select count(*) from public.robots where owner_id = v_owner) >= 6 then
    raise exception 'Six robots per member is the current office limit';
  end if;

  insert into public.robots (name, owner_id, assignment)
  values (v_name, v_owner, p_assignment) returning id into v_robot;
  if p_assignment = 'trader' then
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

-- Assignment can be corrected before a runtime has ever connected. Switching
-- to Trader creates a fresh token, shown once in the response.
create function public.set_robot_assignment(p_robot uuid, p_assignment text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
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
  where id = p_robot and owner_id = auth.uid() and last_report_at is null
  for update;
  if v_old is null then
    raise exception 'Only the owner can change an unconnected assignment' using errcode = '42501';
  end if;
  if v_old <> p_assignment then
    update public.robots set assignment = p_assignment where id = p_robot;
    if p_assignment = 'trader' then
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

-- Eyes are a separate customization from body colour and gear.
create or replace function public.set_robot_look(p_robot uuid, p_look jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_color text := p_look ->> 'color';
  v_gear text := p_look ->> 'gear';
  v_eyes text := p_look ->> 'eyes';
begin
  if not exists (select 1 from public.robots where id = p_robot and owner_id = auth.uid()) then
    raise exception 'Only the robot''s owner can change its look' using errcode = '42501';
  end if;
  if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'The colour must look like #RRGGBB';
  end if;
  if v_eyes is not null and v_eyes !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'The eye colour must look like #RRGGBB';
  end if;
  if v_gear is not null and v_gear not in
    ('headset', 'cap', 'tie', 'visor', 'antennas', 'glasses', 'crown', 'badge', 'none') then
    raise exception 'Unknown gear: %', v_gear;
  end if;
  update public.robots
  set look = jsonb_strip_nulls(jsonb_build_object('color', v_color, 'gear', v_gear, 'eyes', v_eyes))
  where id = p_robot;
end;
$$;

commit;
