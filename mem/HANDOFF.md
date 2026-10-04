# HANDOFF

Written 2026-10-04. Replace this file next session; do not append.

## State

`main` is production. `@passkeybridge/satus@0.3.11` is the CLI version in
`packages/cli/package.json`. Cloud Agent bootstrap is `.cursor/environment.json`:
Node v24.21.0 and Bun 1.3.11 in `/opt/satus-toolchain`, site via
`bun install --frozen-lockfile`, CLI via `npm ci`. Dev server is tmux
session `dev-server` on port 5173. Verify commands and secret names are in
`AGENTS.md`.

Gates on that toolchain: tsc clean, eslint 0 errors (9 react-refresh
warnings), 42 site tests, 78 CLI tests, six validators, site build, blog-leak
check, CLI typecheck/lint/test/build. Homepage and `/pricing` returned 200
from the dev server.

## Today

Read-only system map, then the agent environment. No product code changed.
`git branch -r --no-merged origin/main` lists 12 branches; `git cherry` marks
most as already applied. Non-equivalent leftovers:
`origin/content/correct-07-17-pg-dump-claims` (4) and `origin/feat/xai-demo` (2).
The TanStack Start advisory (GHSA-qx66-fv34-fjm8) is on `main` as `9c431bf`
(`@tanstack/react-start@1.168.60`, lockfile `start-server-core@1.169.39`).
Whether production is serving that SHA was not checked.

## Needs the owner

- Cursor secrets named in `AGENTS.md`. Leave the two live Stripe secrets off.
- Revoke the old npm token on npmjs.com (handoff of 2026-09-25; not rechecked).
- Draft post `src/content/blog/2026-10-09-pg-dump-snapshots-as-test-fixtures.md`
  is `draft: true`, `publishAt` 2026-10-09 09:00 ET. The build withholds it.

## Flags, unchanged

CSP absent. e2e-health is rate limited, not authenticated. Site `bun audit`
is 38 findings (1 critical vitest, plus undici/sharp via nitro and the
Cloudflare plugin). 79 poisoned suppression rows were left in place as of
2026-09-04; current count not rechecked. `minimumReleaseAge` is 24h.
Pagila in `action-selftest.yml` is still unpinned.

## Graduated this session

None.

## Next

1. Confirm the 2026-10-09 post before Friday, or leave it draft.
2. CSP report-only, then the e2e-health shared secret.
