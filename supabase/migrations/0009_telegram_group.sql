-- Send each office alert to the existing private chat and an optional group.
-- Configure the group ID in office_settings for this specific project after
-- applying the migration; it is not hardcoded in reusable source.
begin;

alter table public.office_settings
  add column telegram_group_chat_id text;

create or replace function public.telegram(p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.office_settings;
begin
  select * into s from public.office_settings where id;
  if s.telegram_bot_token is null then
    return;
  end if;

  if nullif(s.telegram_chat_id, '') is not null then
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || s.telegram_bot_token || '/sendMessage',
      body := jsonb_build_object('chat_id', s.telegram_chat_id,
                                 'text', p_text, 'disable_web_page_preview', true)
    );
  end if;

  if nullif(s.telegram_group_chat_id, '') is not null
     and s.telegram_group_chat_id is distinct from s.telegram_chat_id then
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || s.telegram_bot_token || '/sendMessage',
      body := jsonb_build_object('chat_id', s.telegram_group_chat_id,
                                 'text', p_text, 'disable_web_page_preview', true)
    );
  end if;
end;
$$;

revoke all on function public.telegram(text) from public, anon, authenticated;

commit;
