-- Deliver queued member and configured-admin SMS alerts automatically.
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('notification-sms-sweeper')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'notification-sms-sweeper'
);

SELECT cron.schedule(
  'notification-sms-sweeper',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://hfojxbfcjozguobwtcgt.supabase.co/functions/v1/send-notification-sms',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);
