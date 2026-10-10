-- Retire the bare pg_cron caller of /api/public/hooks/e2e-health.
-- Since PR #40 the route requires the x-e2e-health-secret header, which a
-- plain net.http_get cannot send; the daily run is .github/workflows/e2e-health.yml.
-- Applied to project xbnrjwzryuonuinzuomk on 2026-10-10 (cron.unschedule returned true).
-- Idempotent so a migration replay does not fail when the job is already gone.
do $$
begin
  perform cron.unschedule('satus-e2e-health-daily');
exception when others then null;
end$$;
