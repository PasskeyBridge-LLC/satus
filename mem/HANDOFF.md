# HANDOFF

Written 2026-11-09 after Joel closed the weekly E2E items. Replace this file next session; do not append.

## State

`main` is `d540c93` until the ledger PR squash-merges. Production `dpl_ADAJ9SmaWZe75eak3hD2yX3yAhGy` is READY for that SHA and aliases `satus.sh`. Published npm `latest` is 0.3.12. `next` still points at `0.3.11-orgmove.0` (no npm auth on this agent).

## Left open on purpose

ST-W-2026-10-26-1: automate the May–July hold in `scripts/test-db.sh`. Do not repair hosted `schema_migrations`. ST-3 structured log follow-up. Blog-accuracy branch still needed.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP on `/` was not changed. Multi-column UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits. Do not repair hosted `schema_migrations` in passing.

## Graduated this session

Joel 2026-11-09: old npm tokens deleted; Auth leaked-password protection ON (ST-15); ST-8 82 rows kept; ST-3 accepted (lookup still decides validity). Recorded in the 2026-11-09 ledger.

## Next

1. Squash-merge the ledger PR once CI is green at HEAD.
2. ST-3 structured log PR. ST-W-2026-10-26-1 test-db.sh PR. Rebase blog-accuracy.
3. Joel runs `npm dist-tag add @passkeybridge/satus@0.3.12 next` and adds sandbox Stripe secrets plus the Stripe CLI for next week's S1 issuance.
