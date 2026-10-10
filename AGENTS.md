# AGENTS.md

Cloud Agent setup for this repo. Product rules live in `CLAUDE.md`. Session
state lives in `mem/HANDOFF.md`.

## Toolchain

Installed by `.cursor/install.sh` into `/opt/satus-toolchain` (login shells
prepend it via `/etc/profile.d/satus-toolchain.sh`):

- Node.js **v24.21.0** — the CLI publish runtime and the Node 24 CI job.
  `packages/cli` declares `engines.node` `>=20`.
- Bun **1.3.11** — the version pinned in `.github/workflows/site-ci.yml`.
- Site dependencies: `bun install --frozen-lockfile` from `bun.lock`.
- CLI dependencies: `npm ci` in `packages/cli` from `package-lock.json`.

There are no browser tests. Playwright is not installed.

If `node -v` is not `v24.21.0`, run:

```bash
export PATH="/opt/satus-toolchain/bin:$PATH"
```

## Local databases

`scripts/test-db.sh` starts a free local Supabase stack (Docker) and a
throwaway Postgres for the CLI. It does not create a hosted project, and it
does not send events to `https://satus.sh`.

| What | Where |
|---|---|
| Supabase API | `http://127.0.0.1:54321` |
| Supabase Postgres | `127.0.0.1:54322` (user `postgres`, database `postgres`) |
| CLI `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5432/pagila` |

The throwaway matches `.github/workflows/action-selftest.yml`: image
`pgvector/pgvector:pg18`, database `pagila`, and the unpinned
`pagila-schema.sql` from that workflow plus a default `payment` partition.
`DATABASE_URL` in the generated `.env.local` is this database. Never point
it at the hosted project.

`supabase/config.toml` is the CLI local config (Postgres 17, API port
54321, database port 54322). `supabase/seed.sql` inserts one synthetic
license (`local-seed@example.test`) and unschedules `satus-e2e-health-daily`,
the migration that would GET the production health hook. Migrations:
`bash scripts/test-db.sh --reset` replays all of them and the seed.
`email_queue_dispatch` / `email_queue_wake` are revoked only when present;
those functions are not created by any file in this repo (they were
installed on the hosted project with the out-of-band email cron).

Docker on this image needs the `fuse-overlayfs` storage driver (overlay2
cannot mount here) and `net.bridge.bridge-nf-call-iptables=0` (the legacy
FORWARD policy drops traffic on user-defined bridges). `.cursor/install.sh`
installs Docker, `fuse-overlayfs`, the Postgres client, and Supabase CLI
**2.119.0**. `.cursor/start.sh` starts the daemon, both databases, writes
gitignored `.env.local` from `supabase status`, and serves the site against
that file.

```bash
bash scripts/test-db.sh
bash scripts/test-db.sh --reset
```

## Dev server

`.cursor/start.sh` serves the site in tmux session **`dev-server`**.

- Port **5173**, bound to `0.0.0.0`
- URL: `http://127.0.0.1:5173/`
- Log: `/tmp/dev-server.log`

```bash
tmux attach -t dev-server
```

## Verify

```bash
export PATH="/opt/satus-toolchain/bin:$PATH"
bunx tsc --noEmit -p tsconfig.json
bunx eslint .
bun run test
bun run validate
bun run build
node scripts/check-blog-leaks.mjs
cd packages/cli && npm run typecheck && npm run lint && npm test && npm run build
```

`satus --help` after the CLI build: `node packages/cli/dist/cli.js --help`.

## Secrets

Install, lint, typecheck, unit tests, and the production build do not need
secrets. Do not put values in the repo. Names an agent needs for live
integrations, and why:

| Name | Why |
|---|---|
| `VITE_SUPABASE_URL` | Browser Supabase URL, inlined at build time |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser Supabase key, inlined at build time |
| `VITE_PAYMENTS_CLIENT_TOKEN` | Stripe publishable key. `pk_test_` selects sandbox |
| `SUPABASE_URL` | Server Supabase URL |
| `SUPABASE_PUBLISHABLE_KEY` | Server Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client: licenses, email queue, health check |
| `STRIPE_SANDBOX_SECRET_KEY` | Sandbox Checkout and webhook fetches |
| `PAYMENTS_SANDBOX_WEBHOOK_SECRET` | Sandbox webhook signature check |
| `RESEND_API_KEY` | Outbound mail |
| `RESEND_WEBHOOK_SECRET` | Inbound Resend signature check |
| `ALERTS_TO_EMAIL` | Webhook failure mail recipient |
| `E2E_HEALTH_SECRET` | Shared secret for `/api/public/hooks/e2e-health` (`x-e2e-health-secret` header); also a GitHub Actions secret used by `e2e-health.yml` |
| `XAI_API_KEY` | `/demo` generation and the action self-test |
| `OPENAI_API_KEY` | CLI generation against OpenAI |
| `ANTHROPIC_API_KEY` | CLI generation against Anthropic |
| `DATABASE_URL` | Postgres the CLI should seed. Never production |

Leave `STRIPE_LIVE_SECRET_KEY` and `PAYMENTS_LIVE_WEBHOOK_SECRET` off agent
environments. Those talk to live charges.
