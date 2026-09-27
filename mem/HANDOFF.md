# HANDOFF

Written 2026-09-25. Replace this file next session; do not append.

## State

`main` is production; `@passkeybridge/satus@0.3.11` is npm `latest`. No
unmerged branches. Gates: tsc clean, eslint 0 errors, 34 site tests, 70 CLI
tests, six validators (blog, docs, headings, titles, env, language),
prettier clean.

## Today

**The Friday post was not staged.** The 08-27 batch ended at 09-18, and the
previous handoff's "resumes at Q3 item 9" pointed at release notes
published in August. Item 3 turned out to be already published across
06-04, 07-31 and 08-21; the plan now says so rather than restating it.

**Item 10 shipped:** "Fixtures vs generation, and when each wins",
embargoed to 09:00 ET. Every transcript ran on PostgreSQL 16.13 against
the shipped 0.3.11. No LLM key exists in this environment; `--dry-run`
needs none, and the post is built on that. Two draft claims failed
against the source and were fixed before publishing: the runner never
reads existing rows for an excluded parent (`runner.ts` fails a `NOT
NULL` FK into one, nulls a nullable one), and the v0.x limits are in the
README and `/docs/troubleshooting`, not `/security`.

**Local Postgres for the accuracy gate:** `initdb` as `nobody` under the
scratchpad (`chmod o+x` the path first; it gets reset). The server does
not survive between steps — start, run, and stop it inside one command.

## Needs the owner

- **Revoke the old npm token on npmjs.com.** Publishing is trusted
  publishing (OIDC) only since 2026-09-27; the `NPM_PUBLISH_TOKEN` repo
  secret was deleted. The token itself (granular, publish rights on
  `@passkeybridge/satus`, expires 2026-10-12) still exists until revoked.
- **Stage next Friday's post before Friday.** Unwritten: item 11 "pg_dump
  snapshots as test fixtures", item 12 "Seeding Supabase branches in CI".
- The self-test's pagila fetch is unpinned; upstream broke it twice.

## Flags, unchanged

CSP absent — ship `Content-Security-Policy-Report-Only` first. e2e-health
is rate limited, not authenticated. 19 `bun audit` findings, all dev-tree.
79 poisoned suppression rows, deliberate. `minimumReleaseAge` blocks
packages under 24h; confirm before bypassing. A `curl` 403 from this
sandbox is Vercel rate-limiting the sandbox, not production; confirm from
a second vantage point (`release-and-deploy-traps.md`).

## Voice

`house-voice.md` §Admitting mistakes, owner's rule of 09-18: say the fact,
the fix, the version, and stop.

## Do not redo

`strict: true` on the Anthropic tool; the docs-vs-code audit (run the
validator); purging the app-builder platform (`3abfa27`); the Stripe
account default API version (moot, both payload shapes handled).

## Next

1. Item 11 or 12 for 10-02, staged and gated before Friday.
2. `(planned)` Team features on `/pricing`, and a support SLA.
