-- One office robot per member. A signed-in member may create only their own
-- robot and receives its token once in the RPC response.
begin;

create unique index robots_one_per_owner on public.robots (owner_id);

create function public.create_my_robot(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_name text := btrim(p_name);
  v_robot uuid;
  v_token text;
begin
  if v_owner is null or not exists (
    select 1 from public.office_members where user_id = v_owner
  ) then
    raise exception 'Only office members can create a robot' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'Robot name must be 1 to 40 characters';
  end if;
  if exists (select 1 from public.robots where owner_id = v_owner) then
    raise exception 'You already have a robot';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  insert into public.robots (name, owner_id)
  values (v_name, v_owner)
  returning id into v_robot;
  insert into public.robot_secrets (robot_id, token_hash)
  values (v_robot, encode(digest(v_token, 'sha256'), 'hex'));

  return jsonb_build_object('id', v_robot, 'name', v_name, 'token', v_token);
end;
$$;

revoke all on function public.create_my_robot(text) from public, anon;
grant execute on function public.create_my_robot(text) to authenticated;

commit;
