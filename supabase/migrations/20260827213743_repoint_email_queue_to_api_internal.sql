-- Repoint the email queue dispatchers off the retired /lovable/ path.
-- Rewrites each function from its own pg_get_functiondef output with only
-- the URL substituted, so no body is retyped and nothing else can drift.
do $$
declare
  def text;
  new_def text;
begin
  for def in
    select pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('email_queue_dispatch', 'email_queue_wake')
  loop
    new_def := replace(
      def,
      'satus.sh/lovable/email/queue/process',
      'satus.sh/api/internal/email/queue/process'
    );
    if new_def = def then
      raise exception 'expected the old URL in the function body but did not find it';
    end if;
    execute new_def;
  end loop;
end $$;
