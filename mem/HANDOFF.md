# HANDOFF

Written 2026-10-04. Replace this file next session; do not append.

## State

`main` is production. `@passkeybridge/satus@0.3.11` is the CLI version in
`packages/cli/package.json`. Cloud Agent bootstrap is `.cursor/environment.json`:
Node v24.21.0, Bun 1.3.11, Docker (`fuse-overlayfs`), and Supabase CLI 2.119.0.
`.cursor/start.sh` runs `scripts/test-db.sh` then the site on port 5173 against
the local stack. `DATABASE_URL` in gitignored `.env.local` is the pagila
throwaway on `127.0.0.1:5432`, not the hosted project.

Local proof on this VM: `scripts/test-db.sh --reset` applied 26 migrations and
`supabase/seed.sql` (one synthetic license, production e2e cron unscheduled).
License verify against `127.0.0.1:5173` returned valid for the seed key; the
61st call from one IP in the window was `429 rate_limited` (counter hits 61).
Webhook POSTs to that same local URL rejected a bad signature and a timestamp
older than 300s (`400`), and accepted a freshly signed `local.fixture` (`200`).
No request went to the production payments webhook.

## Needs the owner

- Cursor secrets named in `AGENTS.md`. Leave the two live Stripe secrets off.
  This environment is still DB-managed (`environmentJsonPath` null), so a
  dashboard Save is what makes the new install/start the boot default.
- Revoke the old npm token on npmjs.com (handoff of 2026-09-25; not rechecked).
- Draft post `src/content/blog/2026-10-09-pg-dump-snapshots-as-test-fixtures.md`
  is `draft: true`, `publishAt` 2026-10-09 09:00 ET. The build withholds it.

## Flags, unchanged

CSP absent. e2e-health is rate limited, not authenticated. Site `bun audit`
is 38 findings. 79 poisoned suppression rows were left in place as of
2026-09-04; current count not rechecked. `minimumReleaseAge` is 24h.
Pagila in `action-selftest.yml` is still unpinned; the local throwaway uses
that same URL. `email_queue_dispatch` and `email_queue_wake` are still not
created by any migration; the 2026-07-01 revoke now skips them when absent
so a fresh replay can finish.

## Graduated this session

Local test database: `scripts/test-db.sh`, `supabase/seed.sql`, and the
AGENTS.md database section.

## Next

1. Confirm the 2026-10-09 post before Friday, or leave it draft.
2. CSP report-only, then the e2e-health shared secret.
