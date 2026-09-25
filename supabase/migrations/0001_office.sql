-- Trading Office: robots, the four buttons, trades and robot events.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
--
-- Who can do what:
--   - Office members (both of us) can see every robot, its trades and events.
--   - Only a robot's owner can press its buttons (FTMO: nobody else may use your account).
--   - Robots talk to the office through robot_sync(), authenticated by their own token.
--     The browser can never read robot tokens.

begin;

create extension if not exists pgcrypto with schema extensions;

-- People who can open the office.
create table public.office_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.robots (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  owner_id uuid not null references auth.users (id),
  -- The state the robot last confirmed. Only the robot changes it.
  state text not null default 'paused' check (state in ('active', 'paused', 'done_today')),
  account_login bigint,
  symbol text,
  magic bigint,
  status jsonb not null default '{}'::jsonb,
  last_report_at timestamptz,
  created_at timestamptz not null default now()
);

-- Kept apart from robots so no browser query can ever reach a token.
create table public.robot_secrets (
  robot_id uuid primary key references public.robots (id) on delete cascade,
  token_hash text not null unique
);

-- One row per button press.
create table public.commands (
  id bigint generated always as identity primary key,
  robot_id uuid not null references public.robots (id) on delete cascade,
  type text not null check (type in ('start', 'pause', 'done_today', 'close_all')),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 seconds',
  status text not null default 'pending' check (status in ('pending', 'done', 'refused', 'expired')),
  result text,
  acked_at timestamptz
);
create index commands_pending_idx on public.commands (robot_id) where status = 'pending';

-- Every fill the robot made, reported by the robot itself.
create table public.deals (
  robot_id uuid not null references public.robots (id) on delete cascade,
  ticket bigint not null,
  position_id bigint,
  deal_time timestamptz not null,
  symbol text,
  side text,
  entry text,
  volume numeric,
  price numeric,
  profit numeric,
  commission numeric,
  swap numeric,
  reason text,
  comment text,
  primary key (robot_id, ticket)
);

-- What the robot did and why: started, trades, commands, limit stops, errors.
create table public.robot_events (
  id bigint generated always as identity primary key,
  robot_id uuid not null references public.robots (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  message text not null
);
create index robot_events_robot_idx on public.robot_events (robot_id, id desc);

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.office_members enable row level security;
alter table public.robots enable row level security;
alter table public.robot_secrets enable row level security;
alter table public.commands enable row level security;
alter table public.deals enable row level security;
alter table public.robot_events enable row level security;

create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.office_members m where m.user_id = auth.uid());
$$;

create policy "members see members" on public.office_members
  for select to authenticated using (public.is_member());
create policy "members see robots" on public.robots
  for select to authenticated using (public.is_member());
create policy "members see commands" on public.commands
  for select to authenticated using (public.is_member());
create policy "members see deals" on public.deals
  for select to authenticated using (public.is_member());
create policy "members see events" on public.robot_events
  for select to authenticated using (public.is_member());

-- Only the robot's owner may press its buttons.
create policy "owners press buttons" on public.commands
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.robots r where r.id = robot_id and r.owner_id = auth.uid())
  );

-- Browsers read; the only thing they may write is a button press (robot + type).
revoke all on public.office_members, public.robots, public.robot_secrets,
  public.commands, public.deals, public.robot_events from anon;
revoke insert, update, delete, truncate on public.office_members, public.robots, public.robot_secrets,
  public.commands, public.deals, public.robot_events from authenticated;
revoke select on public.robot_secrets from authenticated;
grant insert (robot_id, type) on public.commands to authenticated;

-- Live updates for the office page.
alter publication supabase_realtime add table public.robots, public.commands, public.robot_events;

-- ---------------------------------------------------------------------------
-- The robot's one door into the office
-- ---------------------------------------------------------------------------
-- Called every few seconds by each robot. With a report it records the robot's
-- state, trades, events and command confirmations. It always returns the
-- robot's pending commands as "id:type;id:type" (empty when there are none).

create function public.robot_sync(p_token text, p_report jsonb default null)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_robot uuid;
  v_item jsonb;
  v_pending text;
begin
  select s.robot_id into v_robot
  from public.robot_secrets s
  where s.token_hash = encode(digest(p_token, 'sha256'), 'hex');

  if v_robot is null then
    raise exception 'unknown robot token' using errcode = '28000';
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
        result = left(v_item ->> 'result', 500),
        acked_at = now()
      where id = (v_item ->> 'id')::bigint
        and robot_id = v_robot
        and status = 'pending';
    end loop;

    for v_item in select * from jsonb_array_elements(coalesce(p_report -> 'deals', '[]'::jsonb)) loop
      insert into public.deals (robot_id, ticket, position_id, deal_time, symbol, side, entry,
                                volume, price, profit, commission, swap, reason, comment)
      values (v_robot,
              (v_item ->> 'ticket')::bigint,
              (v_item ->> 'position')::bigint,
              to_timestamp((v_item ->> 'time')::bigint),
              v_item ->> 'symbol',
              v_item ->> 'side',
              v_item ->> 'entry',
              (v_item ->> 'volume')::numeric,
              (v_item ->> 'price')::numeric,
              (v_item ->> 'profit')::numeric,
              (v_item ->> 'commission')::numeric,
              (v_item ->> 'swap')::numeric,
              v_item ->> 'reason',
              left(v_item ->> 'comment', 200))
      on conflict (robot_id, ticket) do nothing;
    end loop;

    for v_item in select * from jsonb_array_elements(coalesce(p_report -> 'events', '[]'::jsonb)) loop
      insert into public.robot_events (robot_id, kind, message)
      values (v_robot,
              left(coalesce(v_item ->> 'kind', 'info'), 40),
              left(coalesce(v_item ->> 'message', ''), 1000));
    end loop;
  end if;

  -- A command nobody picked up within its minute is dropped, so it can't fire later.
  update public.commands set status = 'expired'
  where robot_id = v_robot and status = 'pending' and expires_at < now();

  select coalesce(string_agg(c.id::text || ':' || c.type, ';' order by c.id), '')
  into v_pending
  from public.commands c
  where c.robot_id = v_robot and c.status = 'pending';

  return v_pending;
end;
$$;

revoke all on function public.robot_sync(text, jsonb) from public, authenticated;
grant execute on function public.robot_sync(text, jsonb) to anon;

-- ---------------------------------------------------------------------------
-- Admin helpers: run these yourself in the SQL editor, never from a browser
-- ---------------------------------------------------------------------------

-- Lets a user (created under Authentication → Users) into the office.
create function public.add_member(p_email text, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'No user with email %: create it under Authentication → Users first', p_email;
  end if;
  insert into public.office_members (user_id, display_name) values (v_user, p_name)
  on conflict (user_id) do update set display_name = excluded.display_name;
end;
$$;

-- Creates a robot owned by that user and returns its token. The token is shown
-- only this once: paste it into the robot's settings in MetaTrader.
create function public.create_robot(p_name text, p_owner_email text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid;
  v_robot uuid;
  v_token text := encode(gen_random_bytes(24), 'hex');
begin
  select id into v_owner from auth.users where lower(email) = lower(p_owner_email);
  if v_owner is null then
    raise exception 'No user with email %', p_owner_email;
  end if;
  insert into public.robots (name, owner_id) values (p_name, v_owner) returning id into v_robot;
  insert into public.robot_secrets (robot_id, token_hash)
  values (v_robot, encode(digest(v_token, 'sha256'), 'hex'));
  return v_token;
end;
$$;

-- Issues a new token for a robot (the old one stops working immediately).
create function public.reset_robot_token(p_name text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_robot uuid;
  v_token text := encode(gen_random_bytes(24), 'hex');
begin
  select id into v_robot from public.robots where name = p_name;
  if v_robot is null then
    raise exception 'No robot named %', p_name;
  end if;
  update public.robot_secrets set token_hash = encode(digest(v_token, 'sha256'), 'hex')
  where robot_id = v_robot;
  return v_token;
end;
$$;

revoke all on function public.add_member(text, text) from public, anon, authenticated;
revoke all on function public.create_robot(text, text) from public, anon, authenticated;
revoke all on function public.reset_robot_token(text) from public, anon, authenticated;

commit;
