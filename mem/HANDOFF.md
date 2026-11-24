# HANDOFF

Written 2026-11-23 after the weekly E2E. Replace this file next session; do not append.

## State

`main` is `14034fe` (#106 ledger). Production `dpl_APiR3PY4dF4Uyv2mPTp33yjqXY4U`, READY, aliases `satus.sh` / `www.satus.sh`, same SHA. Product code is still `efe80cc` (#104); the squash only added `mem/`.

npm `latest` and `next` are both 0.3.13 (tag `v0.3.13` → `3f647b0`, shasum `70a4126e7cd1dd3d564d2f335e383378efc4a757`, SLSA provenance). `#104` (array udt `_int4` → JSON array) is on `main` and not in that tarball. Weekly E2E 2026-11-23: NEW 0 / FIXED 0 / STILL-OPEN 0 / REGRESSED 0.

## Next

1. Joel: Stripe sandbox secret and Stripe CLI on this agent for S1 issuance. Do not send sandbox events to the production webhook.
2. Joel: whether to publish a CLI release that includes #104. Only through `cli-publish.yml`.
3. Optional: leftover site `bun audit` 2 (minimatch/glob moderate). `origin/fix/array-udt-types` still holds `337af18` (inet/cidr/bytea/enum labels) beyond #104; leftover squash branches listed in the ledger. Do not merge or delete them unasked.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP unchanged. Multi-column UNIQUE, cross-column arithmetic and `--seed` stay documented limits. Do not repair hosted `schema_migrations` in passing. Do not add `ANTHROPIC_API_KEY`.

## Graduated this session

- weekly-e2e/2026-11-23.md and snapshots: full Heavy pass. No new ST ids.
