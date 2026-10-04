# satus: weekly end-to-end quality and security run

Repo: `PasskeyBridge-LLC/satus` (drafted against `main` @ `396a3543`, 2026-10-04, which carries `AGENTS.md` and the Cloud Agent environment).
Executor: the repo's Cursor cloud "Heavy" agent, once a week, one pass.
Two products in one repo: the CLI `packages/cli` (npm `@passkeybridge/satus`, `latest` 0.3.11, `next` 0.3.11-orgmove.0), with the GitHub Action in `packages/action/action.yml`; and the site `src/` (satus.sh, TanStack Start 1.168.60, Vercel), which hosts marketing, docs, blog, checkout and the license API. Supabase `xbnrjwzryuonuinzuomk` (26 migrations, no edge functions). Stripe sandbox and live on the Stripe account **shared with booked.co, petsupplies.co and PasskeyBridge**. Resend from `mail.satus.sh`. xAI for `/demo`.

## 0. Read first, every run

1. `CLAUDE.md` (product rules), `AGENTS.md` (toolchain, verify commands, secret names), `mem/HANDOFF.md`, then `mem/features/*`, `mem/followups/*`, `mem/incidents/*`. HANDOFF is replaced every session; **the stricter rule wins**. Quote the line whenever a rule stops you.
2. Run `git branch -r --no-merged origin/main` (CLAUDE.md requires it). On 2026-10-04 two branches had commits not on main: `origin/content/correct-07-17-pg-dump-claims` (4) and `origin/feat/xai-demo` (2). Report them; do not merge or delete them in this run.
3. Last week's ledger, `mem/weekly-e2e/<previous date>.md`.
4. Read every file and every search hit before deciding.

### 0.1 What already runs

| Existing job | Schedule (UTC → ET, EDT) | What it covers |
|---|---|---|
| `site-ci.yml` | PR and push | typecheck, 42 unit tests (server modules only, no DOM, no network), validators (`bun run validate`), eslint, build, `scripts/check-blog-leaks.mjs` |
| `cli-ci.yml` | PR and push | Node 20 and 24: typecheck, 78 tests, build (CLI lint is not a CI step) |
| `cli-publish.yml` | `v*.*.*` tags or dispatch | npm trusted publishing (OIDC, `--provenance`); the only publish path |
| `secret-scan.yml` | PR and push | gitleaks 8.30.1, checksum-pinned |
| `action-selftest.yml` | push, dispatch | ephemeral Postgres, pagila schema from GitHub `master` (unpinned), dry run, then a real xAI seed |
| `scheduled-publish.yml` | hourly at :07 | Vercel deploy hook when a post's `publishAt` falls in the window |
| pg_cron `satus-e2e-health-daily` | 06:00 UTC (02:00 ET) | GET `https://satus.sh/api/public/hooks/e2e-health?by=cron`; writes `e2e_health_log`, mails support on failure. Read 2026-10-04: one `pass` row per day for the last 8 days |
| pg_cron `prune-satus-runs-daily`, `prune-e2e-health-log-daily`, `prune-rate-limit-counters` | 03:00, 03:05 UTC, hourly | retention |

Live `cron.job` on 2026-10-04 holds exactly those four jobs. There is **no `process-email-queue` job**, although the four `supabase/migrations/*_email_infra.sql` files say one is applied outside git, and the header of `src/routes/api/public/hooks/e2e-health.ts` says check 4 confirms it ran in the last 5 minutes. The code of `checkEmailQueue` checks only `email_send_state.retry_after_until` and that `suppressed_emails` is readable. Both queues (`pgmq.q_transactional_emails`, `q_auth_emails`) and the DLQ were empty, and the last `email_send_log` row was 2026-09-29 22:02 UTC. Check S7 settles how mail is drained.

Not present: CodeQL, Dependabot, Semgrep, a dependency audit in CI (site `bun audit` reported 38 findings on 2026-10-04: 1 critical in vitest, plus `undici`/`sharp` via `nitro` and `@cloudflare/vite-plugin`), browser tests, a Content-Security-Policy, HSTS in `vercel.json`, Sentry. Actions are pinned by **tag** (`actions/checkout@v4`/`@v5`, `actions/setup-node@v5`, `oven-sh/setup-bun@v2`).

## 1. Standing rules (CLAUDE.md, AGENTS.md, HANDOFF 2026-10-04). Never break these

- **CLI safety contract** (CLAUDE.md, "satus writes to someone else's database"): refuse above 10,000 rows with exit 11 unless `--force`; one transaction with rollback; `--max-cost` aborts before overshoot; `--dry-run` exits 2 on validator findings; FK values only from inserted parents' `RETURNING`; soft FK cycles back-patched in the same transaction. Never weaken any of them.
- **Telemetry stays off unless configured; `DO_NOT_TRACK` wins.** Do not make the run record unconditional or flip the default.
- Published v0.x limits stay documented (no multi-column UNIQUE enforcement, no cross-column arithmetic, no `--seed`).
- **npm publishes only through `cli-publish.yml`.** This run publishes nothing, pushes no tag, moves no dist-tag.
- `DATABASE_URL` is never production. Never point the CLI at `xbnrjwzryuonuinzuomk` or any database you do not own.
- **Stripe live keys stay off agent environments** (`STRIPE_LIVE_SECRET_KEY`, `PAYMENTS_LIVE_WEBHOOK_SECRET`; AGENTS.md). Live Stripe is read-only for this run, through a restricted read key if Joel provides one.
- The Stripe account is shared: other products' webhook endpoints, prices and customers are not touched. The satus endpoint is `we_1U13qRGTWx4Bh4zbfpSCi9a5`.
- Env files stay untracked; only `.env.example`. `.vercel/` stays gitignored. `bunfig.toml` `minimumReleaseAge = 86400` stays; confirm with Joel before bypassing it.
- Drafts and embargoed posts never appear in the build. The draft `src/content/blog/2026-10-09-pg-dump-snapshots-as-test-fixtures.md` (`draft: true`, `publishAt` 2026-10-09 09:00 ET) is Joel's to confirm; do not publish it.
- **Do not add `ANTHROPIC_API_KEY` to any environment, and do not install or use anything from Anthropic.** Joel's Anthropic account is canceled. The CLI has an `anthropic` provider (`packages/cli/src/generate/providers/anthropic.ts`, plain `fetch`); this run tests generation through the `xai` provider only and reports the Anthropic-provider path `NOT RUN: by policy`. `OPENAI_API_KEY` only if Joel has set it.
- Suppression rows from the 2026-09-04 incident were left in place by decision (`mem/incidents/2026-09-04-account-wide-resend-webhook-poisoned-suppressions.md`). Do not delete them.
- Never print a secret, a license key, or a customer email. Redact license keys to the `satus_live_`/`satus_test_` prefix plus the last 4.
- CLAUDE.md "Finish the job": finished work merges and deploys the same session. Push `main` alone and confirm a Vercel deployment for that SHA with `target: "production"` and `READY` before touching any branch (Vercel dedup trap).

## 2. Where hostile and destructive testing may run

| Venue | Status | Use |
|---|---|---|
| Local site on the agent VM (`.cursor/start.sh`, port 5173) against a **local** Supabase stack (`supabase start` + the 26 migrations) | No staging project, no Supabase branch, no local stack is checked in. **Verify each run** that Docker exists and the migrations replay. Without it, every test that needs the server routes plus a database is `NOT RUN: no non-production database`; unit tests with mocks still run and are reported as their own rows. | S1-S4, S7 |
| Local throwaway Postgres for the CLI (`initdb`, or the `action-selftest.yml` pattern) | Safe: `DATABASE_URL` points at it | S4 |
| Stripe sandbox | `STRIPE_SANDBOX_SECRET_KEY`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET` named in AGENTS.md; whether they are set is **unverified**. Use with `stripe listen` forwarding to the **local** webhook. A sandbox event sent to the production webhook writes `licenses` rows with `environment` set in the production database, so do not do that. | S1, S2 |
| Production | Read-only: SELECT-only SQL and aggregate counts, Vercel and Resend reads, public GETs of pages, Stripe live **reads**, npm registry reads. No call to `/api/public/hooks/e2e-health` (it writes and can mail), `/api/public/demo/generate` (spends the company xAI key), `/api/public/cli/run`, `/api/public/waitlist`, `/api/public/billing/portal`, `/api/public/license/verify` with guessed keys, or `/api/internal/*`. | S2 reconciliation, S5, S6, S7, S8 |

Safety rules:
- Hostile, destructive, mutating and load testing only on the local stack, a local Postgres, or Stripe sandbox.
- Production gets read-only checks plus the existing daily health cron, unchanged.
- No data mutation in production except to land a verified fix, after a backup of the affected rows and a row-count readback.
- Obey every rule in section 1.

## 3. Preflight (record in the report)

1. `git rev-parse HEAD`; `git branch -r --no-merged origin/main`.
2. Toolchain per AGENTS.md (`node -v` = v24.21.0, Bun 1.3.11), docker, supabase CLI, stripe CLI, Chromium if installed.
3. Credentials **by name only** (AGENTS.md table). Confirm `ANTHROPIC_API_KEY`, `STRIPE_LIVE_SECRET_KEY` and `PAYMENTS_LIVE_WEBHOOK_SECRET` are **absent**; if present, stop using them and list it for Joel.
4. Read-only: `select jobname, schedule, active from cron.job` (never `command`); `e2e_health_log` status counts for 7 days; Vercel production deployment SHA vs `main`.

## 4. Severity scale

- **Critical**: a license issued without a matching satus payment, a revoked or expired key accepted as paid, a published npm artifact that differs from the tagged source or lacks provenance, a secret in a bundle or artifact, the CLI writing outside one transaction or past the 10,000-row guard without `--force`.
- **High**: a public endpoint that writes, mails or spends money with no working limit; a webhook accepting an unsigned or replayed event; a license or customer email exposed; a reachable critical/high dependency advisory in a runtime or published path.
- **Medium**: monitoring that reports green for something it does not check; a broken customer page; deployed build not equal to `main`; a missing security header with a known mitigation role.
- **Low**: hygiene, docs-vs-code drift with no user effect, WCAG AA off the main journeys.
- **Info**: observation.

---

# Checks (one weekly pass)

### S1. License issuance and validation abuse (local stack + Stripe sandbox)
- Verify endpoint `/api/public/license/verify` (POST `{ key }`): wrong-format, well-formed-random, revoked (`revoked_at`), `past_due`, canceled-within-period (grace, valid by design), canceled-after-period, sandbox key (`satus_test_`) presented where a live key is expected. Pass: every case answers per the file header, with no field beyond `valid`, `plan`, `expires_at`, `reason`; response timing does not distinguish an existing key from a random one by more than noise (measure 200 samples each).
- Rate limits: 61 calls in 10 minutes from one IP hash is refused. Counter failure: break `check_rate_limit` on the local stack and record the direction. Known: verify **fails open** by design comment; `/api/public/hooks/e2e-health` fails closed. Track as STILL-OPEN until Joel decides; do not flip it unasked.
- Issuance (`src/routes/api/public/payments/webhook.ts`, `ownershipOf`): in sandbox, complete a checkout for `satus_pro_monthly`, `satus_pro_yearly`, `satus_team_seat_monthly`, plus a subscription checkout **without** `metadata.source = "satus.sh"` (another product's sale on the shared account, `mem/incidents/2026-09-15-shared-account-webhook-issued-licenses-for-other-products.md`). Pass: exactly one license per satus subscription, none for the foreign one, refund or cancel revokes or ends access as designed, team seat counts match quantity.
- CLI side: free cap 25 rows x 5 tables (`packages/cli/src/commands/generate.ts`) holds with no license, with a revoked license, and with the ~24 h verify cache edited by hand. Report a client-side-only enforcement as Info (the CLI is local software), not as a defect.
- Billing portal `/api/public/billing/portal?key=` (local): malformed key 400, unknown key gives no oracle, 11th call per key per hour refused. Note the key sits in a query string; check whether Vercel request logs retain it (read-only) and report.

### S2. Stripe checkout and webhook integrity
- Sandbox, local webhook: unsigned, wrong-secret, stale-timestamp and replayed events refused; the environment is resolved from the signature, not from `?env=` (`mem/incidents/2026-09-04-webhook-env-resolved-from-signature.md`); the same event delivered twice and out of order produces one license and one `license-delivery` email intent; payload shape per `mem/features/stripe-webhook-payload-shape.md`.
- `/checkout?price=` accepts only the three lookup keys; an unknown price or a foreign product's price id is refused before a session exists.
- Live, read-only (restricted read key): every `licenses` row with `environment = 'live'` maps to a live subscription whose metadata says `satus.sh`, and every such live subscription has exactly one license. On 2026-10-04 the table held 5 rows. List mismatches by license id and subscription id only. Confirm `we_1U13qRGTWx4Bh4zbfpSCi9a5`'s enabled events and URL; do not edit them.
Pass: zero accepted forgeries, zero double effects, zero unexplained live mismatches. Any live correction is listed for Joel.

### S3. Public endpoint abuse (local stack only)
For `/api/public/hooks/e2e-health` (public GET and POST, writes `e2e_health_log`, calls `generateLink`, can mail support; 10/hour/IP and 60/day global, fails closed), `/api/public/cli/run` (unauthenticated telemetry insert into `satus_runs`), `/api/public/waitlist`, `/api/public/demo/generate` (xAI spend; caps 6 tables, 5 rows, 10/hour/IP, 300/day global), and `/api/internal/email/queue/process`, `/api/internal/email/suppression`, `/api/internal/email/transactional/send` (service-role bearer):
- oversized and malformed bodies, header spoofing of the IP used for the hash (`x-forwarded-for` variants), bursts past each limit, counter-failure direction, and the internal routes with no or a wrong bearer.
- The demo test runs with `XAI_API_KEY` unset or with a stub server; never spend the company key in a test loop.
Pass: every limit holds, every internal route refuses non-service callers, no unbounded write. Fail: otherwise. The e2e-health shared secret (HANDOFF "Next" item 2) is a reversible PR if Joel has not objected.

### S4. CLI safety contract as executable tests (local Postgres)
Against a throwaway database, with the `xai` provider or a stubbed model:
- 10,001 existing rows: exit 11, zero writes; with `--force`: proceeds.
- A forced failure mid-run (kill the connection, inject an FK error): the database is byte-identical to before (compare `pg_dump --data-only`).
- `--max-cost` below one batch: aborts before the first overshoot, rolls back.
- `--dry-run` with a validator finding: exit 2.
- Every FK value equals a parent PK inserted in the same run; a soft FK cycle is back-patched in the same transaction.
- Telemetry: no request to `/api/public/cli/run` unless configured; `DO_NOT_TRACK=1` beats every other setting (observe with a local HTTP sink).
- Docs match code: `bun run validate` covers exit codes 1/2/10/11, free 25x5, guard 10,000, version; re-run it and compare with `/docs/troubleshooting` and `/cli` as rendered.
Pass: all hold. Fail: any; any failure here is Critical (CLAUDE.md calls these irreversible in someone else's database).

### S5. CLI supply chain and release integrity
- Registry vs git: `npm view @passkeybridge/satus versions dist-tags` against `git ls-remote --tags origin` (`mem/followups/untagged-published-releases.md`). 2026-10-04: 0.3.11 tagged; `next` points at the prerelease `0.3.11-orgmove.0` (verify whether a tag exists and whether `next` should still point there; listed for Joel, not moved).
- Provenance: `npm audit signatures` on a clean install of the published package; every version since OIDC publishing (2026-09-27) carries provenance.
- Reproducibility: `npm pack` from the tagged commit vs the published tarball, file by file. Pass: identical apart from documented fields.
- Dependencies: CLI published deps (`commander`, `pg`, `zod`, `picocolors`) and the site tree, ranked by reachability (published package, site runtime bundle, dev-only). `bunfig.toml` age gate intact.
- Workflows: tag-pinned actions listed with a PR proposing SHA pins; `cli-publish.yml` keeps `id-token: write` scoped to the publish job and has no token fallback; `action-selftest.yml` pins pagila to a commit SHA (PR).
- Old npm token: whether it is revoked can only be seen on npmjs.com; listed for Joel (HANDOFF).
Pass: tags match versions, provenance present, tarball reproducible, no reachable high/critical without a PR. Fail: otherwise.

### S6. Site security headers and production drift (read-only)
- Served headers on `satus.sh` and `www`: CSP (absent today; propose `Content-Security-Policy-Report-Only` first, per HANDOFF "Next"), HSTS (not set in `vercel.json`; record what Vercel serves), `nosniff`, frame and referrer policy, permissions policy. TLS expiry over 21 days; apex/www and HTTP redirects.
- Build: Vercel production deployment SHA equals `main` HEAD, `target: "production"`, `READY`; confirm the TanStack advisory fix (GHSA-qx66-fv34-fjm8, `9c431bf`) is in what is serving. Record whether the Vercel project sets `NITRO_PRESET` (the repo default is `cloudflare-module`; unverified).
- Env names: every `process.env.*` / `import.meta.env.*` read vs Vercel env names. Report read-but-unset and set-but-unused. Names only.
- Database posture, read-only: RLS enabled on every public table; `anon`/`authenticated` grants and policies snapshotted to `mem/weekly-e2e/snapshots/YYYY-MM-DD-policies.json` and diffed with last week; Supabase security advisors.
Pass: no unexplained drift, no regression vs last week. Fail: otherwise.

### S7. Email delivery and content (no sends)
- How mail is drained: establish from code and live state what processes `pgmq` queues today (no `process-email-queue` in `cron.job` on 2026-10-04). Pass: a working drain path exists and is documented, and the e2e-health check verifies what its header says. Fail (Medium, monitoring truthfulness): the header claims a check the code does not make, or no drain exists. The fix is a reversible PR to the check or the docs; scheduling a new cron job on production is listed for Joel unless it is a verified fix with a readback.
- DNS: SPF, DKIM, DMARC and MX for `mail.satus.sh` and `satus.sh`; Resend domain status (reads only).
- Content: render license-delivery and the other templates locally. Pass: correct product name, key redacted in any preview, working unsubscribe on non-transactional mail, `support@satus.sh` as the contact.
- Suppression: the handler ignores senders other than `@mail.satus.sh`; row count trend (82 on 2026-10-04, 79 recorded on 2026-09-04). `/email/unsubscribe` and `/unsubscribe` both record an opt-out on the local stack.
Pass: all of the above. This run sends no email.

### S8. Customer journeys, accessibility and performance (production, read-only)
- Chromium against production: `/`, `/pricing`, `/checkout` (render, stop before any payment field is filled), `/checkout/success` and `/checkout/cancel` (render), `/cli`, `/quickstart`, `/docs`, `/docs/how-it-works`, `/docs/troubleshooting`, `/docs/github-action`, `/profiles`, `/recipes`, `/compare`, `/demo` (render; run DDL in the in-browser PGlite but **do not press generate**), `/security`, `/privacy`, `/terms`, `/blog`, one `/blog/$slug`, `/blog/rss.xml`, `/sitemap.xml`.
- Pass: expected status, one h1 per page, zero console errors and failed same-origin requests, no draft or embargoed post in `/blog`, RSS or sitemap before its `publishAt`.
- Lighthouse mobile and desktop on `/`, `/pricing`, `/docs`, one blog post: LCP <= 2.5 s, CLS <= 0.1, TBT <= 200 ms. axe-core WCAG 2.2 A/AA: zero serious/critical.
- Claims: `/security` and `/privacy` statements about telemetry and data match S4's observed behaviour (`mem/followups/prose-claims-have-no-automated-check.md`).

---

## 5. Honesty rules

- Every finding carries: the commit SHA, the exact request and response or command and output (keys and emails redacted), repro steps, and severity with the section 4 line and why.
- A check that could not run is `NOT RUN` with the reason, never PASS. Partial checks report each part.
- No truncated work. No estimates presented as facts.
- Complete every check every week; out of time is `NOT RUN: time`, per check.

## 6. Resolution rules

- Fix in line with industry best practice. One PR per fix with a regression test that fails before and passes after (show both). Full required CI green (`site-ci.yml`, `cli-ci.yml`, `secret-scan.yml`, and branch protection's required checks). Squash-merge.
- Deploy and verify per CLAUDE.md: push `main` alone, confirm the Vercel deployment for the squash SHA is `target: "production"` and `READY`, then confirm the behaviour against production (rendered page or live response), and re-run the failing check.
- A CLI fix ships in the repo only. Publishing a new npm version is listed for Joel unless Joel has asked for the release; it then goes only through `cli-publish.yml`.
- Reversible fixes may merge. NOT done by this run, listed for Joel with evidence: money movement or refunds; any Stripe live-mode change (endpoints, prices, subscriptions, the shared account); patents; destructive changes without a backup (including deleting suppression rows or licenses); any customer-facing email; deleting or rotating any secret or npm token; npm publish or dist-tag moves; adding `ANTHROPIC_API_KEY`.
- Do not flag users' or customers' own data choices as defects.
- If anything merged, replace `mem/HANDOFF.md` per CLAUDE.md (under 400 words, durable notes to `mem/` first).

## 7. Week-over-week ledger

Path: `mem/weekly-e2e/YYYY-MM-DD.md`, plus `mem/weekly-e2e/snapshots/` for the S6 policy snapshot and S8 numbers. Stable ids `ST-W-<first-seen date>-<n>`, with severity, status, first seen, last seen, PR. Each file and report leads with **NEW / FIXED / STILL-OPEN / REGRESSED**. Seed STILL-OPEN on the first run with the 2026-10-04 flags: CSP absent, e2e-health unauthenticated, verify rate limit fails open, site `bun audit` 38 findings, pagila unpinned, tag-pinned actions, email drain unclear, poisoned suppression rows (left by decision). No secret, key or email in the ledger.

## 8. Report back to Joel

1. Summary, at most 6 lines: HEAD SHA, NEW / FIXED / STILL-OPEN / REGRESSED counts, worst open item, what needs Joel.
2. Table: check id, name, PASS / FAIL / NOT RUN, one-line reason.
3. Findings, worst first, with the section 5 fields.
4. PRs merged: number, title, squash SHA, Vercel production deployment id and SHA, check re-run result.
5. Items needing Joel, each with evidence and the exact proposed action.

## 9. Schedule (America/New_York)

**Monday 10:30 ET** (14:30 UTC EDT, 15:30 UTC EST). Target finish by 14:30 ET.

Clear of: the other properties' weekly passes (PasskeyBridge Sat/Sun 08:30, Booked Sat/Sun 13:30, petsupplies Wednesday 10:30, ftseffect Tuesday 10:30), satus's own `satus-e2e-health-daily` (02:00 ET) and prune jobs (23:00 ET), the 6:59 AM/PM digest, and Friday blog releases (posts publish at 09:00 ET on their date). Unavoidable: `scheduled-publish.yml` at :07 every hour and `prune-rate-limit-counters` hourly; neither affects this run.
