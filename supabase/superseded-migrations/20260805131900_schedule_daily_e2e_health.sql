-- Daily E2E health check at 06:00 UTC. The endpoint is public (GET) and
-- alerts support via Resend on failure; results land in e2e_health_log
-- with triggered_by='cron'.
-- (Applied to project xbnrjwzryuonuinzuomk on 2026-08-05.)
do $$
begin
  perform cron.unschedule('satus-e2e-health-daily');
exception when others then null;
end$$;

select cron.schedule(
  'satus-e2e-health-daily',
  '0 6 * * *',
  $cron$select net.http_get(url := 'https://satus.sh/api/public/hooks/e2e-health?by=cron', timeout_milliseconds := 30000);$cron$
);
