-- Retain only the new Analyst snapshots for 30 days. Existing news stays.
select cron.schedule('analyst-evidence-retention', '29 3 * * *', $$delete from public.analyst_reports where recorded_at < now() - interval '30 days';$$);
