-- The news reader now runs on Supabase, independently of anyone's PC.
-- Store the Analyst token once in Vault under trading_analyst_token before
-- enabling this job. The token never appears in cron.job or source control.
begin;

select cron.schedule(
  'office-fundamental-analyst',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://tpmrowyqsayyypkxkvfz.supabase.co/functions/v1/fundamental-analyst',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_wsTQsr8pwa9lJP8I2QEv9g_gbmj_gvM',
        'x-analyst-token', (select decrypted_secret from vault.decrypted_secrets
                             where name = 'trading_analyst_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 45000
    );
  $$
);

commit;
