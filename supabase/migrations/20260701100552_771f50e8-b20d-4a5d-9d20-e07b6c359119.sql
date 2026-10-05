-- email_queue_dispatch() and email_queue_wake() are not created by any
-- migration in this repo. They were installed on the hosted project with
-- the out-of-band process-email-queue cron. Revoke only when they exist
-- so a fresh replay of these files does not abort.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'email_queue_dispatch'
      and p.pronargs = 0
  ) then
    execute 'revoke execute on function public.email_queue_dispatch() from public, anon, authenticated';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'email_queue_wake'
      and p.pronargs = 0
  ) then
    execute 'revoke execute on function public.email_queue_wake() from public, anon, authenticated';
  end if;
end $$;
