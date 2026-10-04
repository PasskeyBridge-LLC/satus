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
| `XAI_API_KEY` | `/demo` generation and the action self-test |
| `OPENAI_API_KEY` | CLI generation against OpenAI |
| `ANTHROPIC_API_KEY` | CLI generation against Anthropic |
| `DATABASE_URL` | Postgres the CLI should seed. Never production |

Leave `STRIPE_LIVE_SECRET_KEY` and `PAYMENTS_LIVE_WEBHOOK_SECRET` off agent
environments. Those talk to live charges.
