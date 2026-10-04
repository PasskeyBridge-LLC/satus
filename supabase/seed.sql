-- Synthetic local data only. Nothing here is copied from production.
-- Applied by `supabase db reset` after migrations (see [db.seed] in config.toml).

-- The e2e migration schedules a daily GET of the production health hook.
-- A local stack must not call satus.sh. Prune jobs stay; they only delete
-- local rows.
do $$
begin
  perform cron.unschedule('satus-e2e-health-daily');
exception when others then null;
end$$;

insert into public.licenses (
  license_key,
  email,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status,
  environment,
  current_period_end
) values (
  'satus_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'local-seed@example.test',
  'cus_local_seed',
  'sub_local_seed',
  'satus_pro_monthly',
  'active',
  'sandbox',
  now() + interval '30 days'
)
on conflict (license_key) do nothing;
