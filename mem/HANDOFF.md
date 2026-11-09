# HANDOFF

Written 2026-11-09 after Joel's weekly E2E decisions shipped. Replace this file next session; do not append.

## State

`main` is `bbb0658` (blog-accuracy #81). Production for that SHA is `dpl_HEPVQoPFzuzT9w7eXmJiqPpgWHaf`. Earlier today: ledger #78 `e0f7806` / `dpl_arcHE2AU4DdZjGU3yPh6an28k6vV`; ST-3 #79 `4836645` / `dpl_CkGSnVDp4mht7r2p372AbsrhnyiA`; test-db #80 `27a96ea` / `dpl_24F8kcxSfNMsJPCqTdhDK1ixz3CT`. Published npm `latest` is 0.3.12. `next` still points at `0.3.11-orgmove.0`.

## Left open on purpose

Joel still runs `npm dist-tag add @passkeybridge/satus@0.3.12 next`. Next week's S1 issuance needs sandbox Stripe secrets and the Stripe CLI on the agent. ST-W-2026-10-26-1 is fixed in #80; hosted `schema_migrations` was not repaired.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP on `/` was not changed. Multi-column UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits. Do not repair hosted `schema_migrations` in passing.

## Graduated this session

ST-15 leaked-password ON; old npm tokens deleted; ST-8 82 rows kept; ST-3 accepted (lookup decides validity, structured log in #79); test-db May–July hold in #80; 0.3.12 blog notes in #81. Deleted `origin/cursor/blog-accuracy-0312-9369` after #81 merged.

## Next

1. Joel: `npm dist-tag add @passkeybridge/satus@0.3.12 next` (granular dist-tag token on `@passkeybridge/satus`).
2. Joel: add `STRIPE_SANDBOX_SECRET_KEY` and `PAYMENTS_SANDBOX_WEBHOOK_SECRET` to this cloud agent, and install the Stripe CLI, for next week's S1 issuance.
