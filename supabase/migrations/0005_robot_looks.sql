-- Trading Office: each robot's look in the 3D office, a colour and one piece
-- of gear. Run after 0004. Only a robot's owner can change its look; the
-- office page calls set_robot_look() from the robot's card.

begin;

alter table public.robots add column look jsonb not null default '{}'::jsonb;

create function public.set_robot_look(p_robot uuid, p_look jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_color text := p_look ->> 'color';
  v_gear text := p_look ->> 'gear';
begin
  if not exists (select 1 from public.robots where id = p_robot and owner_id = auth.uid()) then
    raise exception 'Only the robot''s owner can change its look' using errcode = '42501';
  end if;
  if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'The colour must look like #RRGGBB';
  end if;
  if v_gear is not null and v_gear not in ('headset', 'cap', 'tie', 'visor', 'antennas', 'none') then
    raise exception 'Unknown gear: %', v_gear;
  end if;
  update public.robots
  set look = jsonb_strip_nulls(jsonb_build_object('color', v_color, 'gear', v_gear))
  where id = p_robot;
end;
$$;

revoke all on function public.set_robot_look(uuid, jsonb) from public, anon;
grant execute on function public.set_robot_look(uuid, jsonb) to authenticated;

commit;
