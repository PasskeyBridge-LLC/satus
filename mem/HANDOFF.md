# HANDOFF

Written 2026-11-16 after the weekly E2E. Replace this file next session; do not append.

## State

`main` is `c3606bd` (#94). Production `dpl_H7h6gShKLLbD7sHYTCt4trS6uM1Z`, READY, aliases `satus.sh` / `www.satus.sh`, same SHA.

npm `latest` and `next` are both 0.3.13 (tag `v0.3.13` → `3f647b0`, shasum `70a4126e7cd1dd3d564d2f335e383378efc4a757`, SLSA provenance). Weekly E2E 2026-11-16: NEW 0 / FIXED 1 / STILL-OPEN 0 / REGRESSED 0. ST-W-2026-10-26-1 verified via `scripts/test-db.sh` hold.

## Next

1. Joel: Stripe sandbox secret and Stripe CLI on this agent for S1 issuance. Do not send sandbox events to the production webhook.
2. Content bot: 0.3.13 release notes. Include the config-pinned `gpt-4o-mini` line: those runs keep the old model until `model` in satus.config.json changes.
3. Roadmap item 1: model and price freshness check in CI (`providers/deprecations.ts` is maintained by hand).
4. Optional: leftover site `bun audit` 3 (minimatch/glob moderate, deepmerge low). `origin/fix/blog-320-copy-ci-gate` is the pre-squash leftover of #94; safe to delete. D4 agent mode.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP unchanged. Multi-column UNIQUE, cross-column arithmetic and `--seed` stay documented limits. Do not repair hosted `schema_migrations` in passing. Do not add `ANTHROPIC_API_KEY`.

## Graduated this session

- weekly-e2e/2026-11-16.md and snapshots: full Heavy pass. ST-W-2026-10-26-1 FIXED.
