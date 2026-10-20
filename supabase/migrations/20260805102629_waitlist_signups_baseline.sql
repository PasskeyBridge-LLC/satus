-- Waitlist signup capture for /pricing Pro and Team CTAs.
-- Public insert-only; reads gated to backend/admin via dashboard.
-- (Baseline replay of repo migrations 20260525203755, 20260525203817, 20260525205446.)

create type public.waitlist_tier as enum ('pro', 'team');

create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tier public.waitlist_tier not null,
  note text,
  source text,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  -- One signup per (email, tier). Re-submitting the same pair is a no-op.
  unique (email, tier)
);

-- Lightweight email shape check; full validation happens server-side via zod.
-- search_path pinned (lint 0011).
create or replace function public.waitlist_signups_validate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;
  if length(new.email) > 254 then
    raise exception 'email_too_long';
  end if;
  if new.note is not null and length(new.note) > 500 then
    raise exception 'note_too_long';
  end if;
  new.email := lower(trim(new.email));
  return new;
end;
$$;

create trigger waitlist_signups_validate_trg
before insert on public.waitlist_signups
for each row execute function public.waitlist_signups_validate();

alter table public.waitlist_signups enable row level security;

-- Bounded-payload insert policy (lint 0024). Authoritative validation still
-- happens in the trigger + the server route.
create policy "Public waitlist insert with bounded payload"
on public.waitlist_signups
for insert
to anon, authenticated
with check (
  length(email) between 5 and 254
  and (note is null or length(note) <= 500)
  and (source is null or length(source) <= 64)
  and (user_agent is null or length(user_agent) <= 512)
);

create index waitlist_signups_created_at_idx on public.waitlist_signups (created_at desc);
create index waitlist_signups_tier_idx on public.waitlist_signups (tier);
