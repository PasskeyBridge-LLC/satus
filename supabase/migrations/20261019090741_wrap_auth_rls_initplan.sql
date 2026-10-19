-- SAT-2 (2026-10-19): stop re-evaluating auth.role() once per row.
--
-- The performance advisor reported auth_rls_initplan on these 13 policies.
-- Each predicate is auth.role() = 'service_role'. Wrapping the call in a
-- scalar subquery makes Postgres initPlan it once per statement. The
-- comparison result does not change: service_role still matches, and anon
-- and authenticated still do not. service_role also has BYPASSRLS, so the
-- service-key Data API path does not evaluate these policies either way.
-- Policies that do not call auth.* (public.waitlist_signups) are left alone.
-- rate_limit_counters stays RLS-enabled with no policy: that is the
-- service-only deny-by-default shape, and adding a policy would change it.
--
-- Undo, as one transaction:
--
--   ALTER POLICY "Service role can read send log" ON public.email_send_log
--     USING (auth.role() = 'service_role');
--   ALTER POLICY "Service role can insert send log" ON public.email_send_log
--     WITH CHECK (auth.role() = 'service_role');
--   ALTER POLICY "Service role can update send log" ON public.email_send_log
--     USING (auth.role() = 'service_role')
--     WITH CHECK (auth.role() = 'service_role');
--   ALTER POLICY "Service role can manage send state" ON public.email_send_state
--     USING (auth.role() = 'service_role')
--     WITH CHECK (auth.role() = 'service_role');
--   ALTER POLICY "Service role can read suppressed emails" ON public.suppressed_emails
--     USING (auth.role() = 'service_role');
--   ALTER POLICY "Service role can insert suppressed emails" ON public.suppressed_emails
--     WITH CHECK (auth.role() = 'service_role');
--   ALTER POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens
--     USING (auth.role() = 'service_role');
--   ALTER POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens
--     WITH CHECK (auth.role() = 'service_role');
--   ALTER POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens
--     USING (auth.role() = 'service_role')
--     WITH CHECK (auth.role() = 'service_role');
--   ALTER POLICY "service role full access licenses" ON public.licenses
--     USING (auth.role() = 'service_role')
--     WITH CHECK (auth.role() = 'service_role');
--   ALTER POLICY "service role full access e2e_health_log" ON public.e2e_health_log
--     USING (auth.role() = 'service_role')
--     WITH CHECK (auth.role() = 'service_role');
--   ALTER POLICY "service role full access satus_runs" ON public.satus_runs
--     USING (auth.role() = 'service_role')
--     WITH CHECK (auth.role() = 'service_role');
--   ALTER POLICY "service_role full access" ON public.webhook_alerts_sent
--     USING (auth.role() = 'service_role')
--     WITH CHECK (auth.role() = 'service_role');

DO $sat2_initplan$
DECLARE
  bare integer;
BEGIN
  EXECUTE 'ALTER POLICY "Service role can read send log" ON public.email_send_log USING ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "Service role can insert send log" ON public.email_send_log WITH CHECK ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "Service role can update send log" ON public.email_send_log USING ((SELECT auth.role()) = ''service_role'') WITH CHECK ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "Service role can manage send state" ON public.email_send_state USING ((SELECT auth.role()) = ''service_role'') WITH CHECK ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "Service role can read suppressed emails" ON public.suppressed_emails USING ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "Service role can insert suppressed emails" ON public.suppressed_emails WITH CHECK ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens USING ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens WITH CHECK ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens USING ((SELECT auth.role()) = ''service_role'') WITH CHECK ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "service role full access licenses" ON public.licenses USING ((SELECT auth.role()) = ''service_role'') WITH CHECK ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "service role full access e2e_health_log" ON public.e2e_health_log USING ((SELECT auth.role()) = ''service_role'') WITH CHECK ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "service role full access satus_runs" ON public.satus_runs USING ((SELECT auth.role()) = ''service_role'') WITH CHECK ((SELECT auth.role()) = ''service_role'')';
  EXECUTE 'ALTER POLICY "service_role full access" ON public.webhook_alerts_sent USING ((SELECT auth.role()) = ''service_role'') WITH CHECK ((SELECT auth.role()) = ''service_role'')';

  SELECT count(*) INTO bare
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN (
      'Service role can read send log',
      'Service role can insert send log',
      'Service role can update send log',
      'Service role can manage send state',
      'Service role can read suppressed emails',
      'Service role can insert suppressed emails',
      'Service role can read tokens',
      'Service role can insert tokens',
      'Service role can mark tokens as used',
      'service role full access licenses',
      'service role full access e2e_health_log',
      'service role full access satus_runs',
      'service_role full access'
    )
    AND (
      (qual IS NOT NULL AND lower(qual) NOT LIKE '%select auth.role()%')
      OR (with_check IS NOT NULL AND lower(with_check) NOT LIKE '%select auth.role()%')
    );

  IF bare <> 0 THEN
    RAISE EXCEPTION
      'SAT-2 abort: % policies still call auth.role() without a scalar subquery',
      bare;
  END IF;
END
$sat2_initplan$;
