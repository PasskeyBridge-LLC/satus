# Changelog

All notable changes to `@passkeybridge/satus` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The CLI tarball ships from `packages/cli/` under `@passkeybridge/satus`. The marketing site at <https://satus.sh> bumps the version chip in the same release.

## [Unreleased]

### Added

- **`xai` provider.** `--provider xai` (or `"provider": "xai"` in `satus.config.json`) generates rows with xAI's Grok models through `https://api.x.ai/v1/chat/completions` and strict `json_schema` output, using your own `XAI_API_KEY`. Default model `grok-4.20-0309-non-reasoning`. `XAI_BASE_URL` overrides the endpoint. On reasoning models the cost meter counts reasoning tokens as output, since xAI bills them. `XAI_API_KEY` is auto-detected only when neither `OPENAI_API_KEY` nor `ANTHROPIC_API_KEY` is set, so existing setups pick the same provider as before. OpenAI and Anthropic are unchanged, and so are their defaults. The GitHub Action accepts `provider: xai`.

## [0.3.11] — 2026-08-27

### Fixed

- **Run telemetry is opt-in, which is what the privacy page always said.** <https://satus.sh/security> has stated "Telemetry. Off by default" since the page went up. That was true of `telemetry.share_failure_fingerprints`, and false of the run record: `reportRun` was called unconditionally at the end of every `satus generate`, with no config key, environment variable, or flag able to stop it. Nothing identifying was ever collected — the payload has been the minimal one since v0.3.7, and all twelve records in the table are our own release-test runs — but the published claim described behaviour the CLI did not have. The run record is now off unless `telemetry.enabled` is `true` in `satus.config.json` or `SATUS_TELEMETRY=1` is exported. `DO_NOT_TRACK=1` overrides both and always wins. `satus init` asks, and defaults to no. The switch is latched once at startup and initialised to off, so a path that never configures it sends nothing rather than everything; seven tests pin the precedence rules and the default.

- **Primary keys and unique constraints are read from `pg_catalog`.** `v_fks` moved to the catalogs in v0.2.0 precisely because `information_schema` is privilege-filtered, but `v_pks` and `v_uniques` still went through `information_schema.table_constraints`, whose predicate accepts `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` but not `SELECT`. A role holding only `SELECT` therefore introspected every table as having no primary key and no unique columns, silently. That path is reachable: `--dry-run` writes nothing, so a read-only credential is the natural thing to give a CI job, and `uniqueColumns` is what gates the validator's `unique_duplicate` finding. Verified on PostgreSQL 16.13 against a `varchar(4) unique` column: v0.3.10 as a read-only role reported "no validation findings" and exited `0` where it should have reported four errors and exited `2`. Five tests pin which catalog each CTE reads.

### Notes

- Anthropic shipped structured outputs (`output_config.format`) after this provider was written, and the supported-model list includes the `claude-haiku-4-5` family we default to. We have not migrated; tool-use forcing works and costs no parsing. The stale comment asserting no such API exists has been corrected. Separately, the OpenAI provider sets `strict: true` and the Anthropic one sets no equivalent, so those tool calls are schema-shaped rather than schema-guaranteed. Both are recorded as outstanding work.

## [0.3.10] — 2026-08-14

### Fixed

- **The 24-hour license grace is now enforced, not just marketed.** The pricing page has always said a paid verdict is cached for 24 hours and then fails closed; the expiry email says a revoked license "will expire within 24 hours". Neither was true: `satus generate` read the cache with no TTL check, and `satus activate` never persisted the key — so nothing could ever re-verify, and a canceled subscription kept paid caps forever. Activation now stores the key in `~/.satus/license-cache.json`, `generate` re-verifies any verdict older than 24 hours, and a verdict that cannot be refreshed (offline past the grace window, server error, or a keyless cache written by an older CLI) falls back to Free caps with a printed explanation. `satus whoami` notes when the cache is stale. Nine tests pin the contract.

### Backward compatibility

- A cache written by <= 0.3.9 contains no key. The first `generate` after its 24-hour window prints a one-line notice and applies Free caps; running `satus activate <key>` once restores paid caps and stores the key for future re-verification.

## [0.3.9] — 2026-08-11

### Fixed

- **The GitHub Action could not bypass the safety guard.** 0.3.8 added the 10,000-row guard but the composite action exposed no way to override it, so a workflow pointed at a long-lived preview branch with real fixtures would exit `11` and write nothing, with no input to set. A safety feature that cannot be turned off in the one environment that runs unattended is a regression, and it was ours. `packages/action/action.yml` gains a `force` input (and `truncate`, which had also never been exposed) wired through to the CLI flags.

- **An unbreakable foreign-key cycle now exits `10` (`E_FK_CYCLE`), as documented.** <https://satus.sh/docs/how-it-works> has specified that code — and the reason for it, "so CI can distinguish refused-to-run from tried-and-failed" — while the CLI exited `1`, indistinguishable from a connection failure. Exit codes now live in `packages/cli/src/exit-codes.ts` as one documented contract (`1`, `2`, `10`, `11`), `generate/guard.ts` re-exports `E_DB_NOT_EMPTY` from there rather than defining it twice, and a test pins every value and asserts none collide.

### Changed

- `packages/action/action.yml` pins `satus-version` to `0.3.9`.
- `packages/cli/README.md` corrects the license-tier table: Team is **$49/seat/month and on a waitlist**, not `$79/mo`, and no tier has custom or private profiles — the CLI ships exactly three (`saas`, `ecommerce`, `b2b`) on every tier. This README ships inside the npm tarball, so the wrong price was public on npmjs.com.

### Backward compatibility

- Exit `10` replaces exit `1` on the unbreakable-FK-cycle path only. A pipeline testing `!= 0` is unaffected; one testing `== 1` for that specific case should widen to `!= 0` or add `10`.
- Both new action inputs default to `false`, so existing workflows are unchanged.
- No CLI flag added, removed, or renamed. `satus.config.json` from 0.3.x works unchanged.

## [0.3.8] — 2026-08-11

### Added

- **The 10,000-row safety guard — the one satus.sh already advertised.** `satus generate` writes rows, and the single most expensive mistake available to a user is pointing `DATABASE_URL` at production. <https://satus.sh/docs/how-it-works> has described a guard against exactly that since the v0.3.x docs went up: count user-table rows, refuse above 10,000, bypass with `--force`, exit `11` (`E_DB_NOT_EMPTY`) so CI can tell "refused to run" from "tried and failed". None of it existed in the code. `resolveDsn` took the string and connected.

  This release implements the published contract exactly, and it now runs before anything else touches the database — ahead of introspection, not just ahead of the first `INSERT`. Rows are counted in **every** schema outside `pg_catalog`, `information_schema`, and `pg_toast`, not just the schema being seeded, because a production database is rarely all in `public`.

  Counting is bounded rather than naive: each table is counted through a subquery capped at 10,001 rows and the running total short-circuits the moment it crosses, so the guard costs roughly the same against a 400-million-row table as against an empty one. Planner estimates (`pg_class.reltuples`) would be free but report `-1` for a never-analyzed table — the exact state of a freshly restored production dump — and a guard that reads restored production as empty is worse than no guard. Partitioned parents (`relkind = 'p'`) are excluded so partitioned rows are not counted twice; tables the connecting role cannot `SELECT` are skipped and reported rather than raising.

  `--dry-run` is never blocked, since it writes nothing, but it warns that a real run would be refused — which is what a dry run is for.

### Fixed

- **`/cli` still documented `--truncate` as using `CASCADE`.** The 0.3.7 change removed it and updated `/recipes`, `/docs/troubleshooting`, and `llms.txt`, but the flag table on the CLI reference page was missed. Corrected, and `--force` added alongside it.

### Changed

- `packages/cli/README.md` documents the guard and, for the first time, the full exit-code table (`0`, `1`, `2`, `11`).
- `packages/action/action.yml` pins `satus-version` to `0.3.8`.
- New `src/generate/guard.test.ts` (14 tests), each mutation-checked: removing the per-table `LIMIT`, narrowing the scan to `public`, including partitioned parents, weakening `>` to `>=`, and silently dropping unreadable tables were each introduced in turn and confirmed to turn the suite red.

### Backward compatibility

- **A run against a database holding more than 10,000 rows now fails where it previously succeeded.** That is the entire point. Add `--force` if the target really is a large staging database with real fixtures.
- No flag removed or renamed; `--force` is new and defaults off. `satus.config.json` from 0.3.x works unchanged.
- Exit codes `0`, `1`, and `2` are unchanged. `11` is new and only ever means the guard refused; nothing was written.

## [0.3.7] — 2026-08-10

Correctness release. Five defects, four of which failed silently — the run reported success and the damage showed up later, in your application. Every fix below was reproduced and then re-verified against a live PostgreSQL 16.13 instance.

### Fixed

- **Identity columns are no longer handed to the model.** Postgres reports a `GENERATED ... AS IDENTITY` column with `column_default = NULL` and `is_generated = 'NEVER'`, so neither of the flags satus checked caught it and the column was treated as one for the model to invent. `GENERATED ALWAYS AS IDENTITY` then rejected the explicit value outright (`cannot insert a non-DEFAULT value into column`), rolling back the entire run — a schema using it could not be seeded at all. `GENERATED BY DEFAULT AS IDENTITY` was worse, because it worked: Postgres accepted the invented value and left the sequence untouched, so your application's next insert collided with a seeded row. Introspection now reads `is_identity` and identity columns are omitted from both the model schema and the INSERT, letting the sequence allocate. The same gap in the in-browser demo's introspection is fixed too.

- **Foreign keys targeting a non-primary-key column resolve instead of silently NULLing.** `insertRows` only ever named primary-key columns in its `RETURNING` clause, so a FK pointing at a UNIQUE non-PK column (`orders.user_email -> users.email`) found no value in the parent pool. That read as `undefined`, the writer serialized it to `NULL`, and a nullable child column inserted unlinked with no error anywhere. The writer now returns every column referenced by some FK in the run set, and an unresolvable reference raises instead of falling through to `NULL`.

- **`--truncate` no longer reaches outside the run set.** It issued `TRUNCATE ... RESTART IDENTITY CASCADE`; `CASCADE` follows foreign keys, so a table you had put in `exclude` — an audit log, a history table — was emptied along with the run set, and Postgres reported that with nothing louder than a `NOTICE`. The statement now omits `CASCADE`. Naming the whole run set in one statement satisfies Postgres whenever the FK graph is closed over it, which is the ordinary case; when it is not, satus stops with an explanation and exit code 1 rather than deleting data you did not ask it to touch.

- **The dry-run estimate and the live cost meter now agree.** `planRun` hardcoded gpt-4o-mini's $0.15/$0.60 per MTok regardless of `--provider`, so an Anthropic run was estimated at OpenAI's cheapest rate and then metered at Anthropic's — the two figures for a single run could not be reconciled. Compounding it, the Anthropic price table had been left empty since v0.3.0 and its fallback of $3/$15 was exactly 3x the real rate for the default model, so Anthropic runs over-reported spend threefold and `--max-cost` aborted runs nowhere near the cap. Rates now live on the `Provider` and both numbers read the same table. Anthropic rates are populated and dated; both fallbacks are now the most expensive entry in their own table, so an unpriced model can only make `--max-cost` abort early, never overshoot. (OpenAI's fallback was previously *below* three of its four priced models — under-billing, the dangerous direction for a guardrail.)

- **Run telemetry matches the published privacy promise.** The README and <https://satus.sh/privacy> both state that satus sends "no table or column names, no row data". The payload carried every table name, the target schema name, and the raw error message — and a Postgres unique-violation message embeds the offending row value verbatim (`Key (email)=(ada@example.com) already exists`). Those three fields are gone, replaced by `table_count` and a fixed-vocabulary `error_class` (`pg_23505`, `provider_http_429`, `budget_exceeded`, …) that is never derived from error text. `/api/public/cli/run` additionally discards the three legacy fields from payloads sent by older CLIs, so the promise holds without waiting for everyone to upgrade. The only runs ever recorded under the old behaviour were our own release tests.

### Changed

- `packages/action/action.yml` pins `satus-version` to `0.3.7` (it had been left at `0.3.5`).
- New regression suite (`src/generate/regressions.test.ts`, 18 tests) covering each defect above. Each test was mutation-checked: the fix was reverted and the suite confirmed to fail.

### Backward compatibility

- **`--truncate` behaviour changes.** A run that previously succeeded by cascading into tables outside the run set now fails with an explanation. This is intentional. If you relied on the cascade, bring the referencing tables into the run set or truncate them yourself.
- **Telemetry fields change.** `tables`, `target_schema`, and `error_message` are no longer sent; `table_count` and `error_class` are new. The ingest endpoint accepts old and new clients. Existing `satus_runs` columns are retained and simply stop being written.
- No CLI flag added, removed, or renamed. `satus.config.json` from 0.3.x works unchanged.
- Schemas with identity columns will now seed where they previously failed or corrupted their sequences; row counts and generated content are otherwise unaffected.

## [0.3.6] — 2026-08-06

### Fixed

- **`ANTHROPIC_BASE_URL` with or without `/v1`.** The Anthropic provider assumed the override included the `/v1` suffix, while Anthropic's official SDK convention excludes it — a bare `https://api.anthropic.com` (common when the variable is exported for other tooling) produced an unhelpful empty-body `Anthropic 404`. The base URL is now normalized: `/v1` is appended unless a version segment is already present. Verified with live generation runs in both forms.

### Changed

- **`packages/cli/package-lock.json` regenerated against the public npm registry.** The previous lockfile pinned tarball URLs to a private mirror that is unreachable outside the original build environment, which broke `npm ci` for contributors and CI. Dev-facing only; the published tarball is unaffected.

## [0.3.5] — 2026-07-14

### Added

- **Automated npm publishing.** New GitHub Actions workflow publishes `@passkeybridge/satus` to npm on every `v*` tag push, using the `NPM_PUBLISH_TOKEN` repo secret. Removes the manual `npm publish` step from the release checklist.

### Fixed

- **Introspection SQL alias.** Corrected a column alias in the single-CTE catalog introspection query that caused `satus generate` to fail on schemas containing quoted identifiers with mixed case. No config changes required.
- **Selftest build failure.** `.github/workflows/action-selftest.yml` no longer fails on cold clones — the composite action's build step now installs `packages/cli` dependencies before invoking `satus generate`.

### Changed

- **CLI terminal chrome.** The command-box caret is now rendered inline (matches the `satus>` prompt cadence). The red perimeter animation on the marketing hero was removed; the border now uses a static uniform red at the same weight.

### Backward compatibility

- No CLI flags added, removed, or renamed. No telemetry schema changes. `satus.config.json` from 0.3.x continues to work unchanged.

## [0.3.3] — 2026-07-14


### Added

- **GitHub Action.** `passkeybridge/satus-action@v1` — composite action that wraps `satus generate` for PR-preview databases. Ships in `packages/action/`; documented at <https://satus.sh/docs/github-action>. No CLI semantic changes; the action is a thin `npx --yes @passkeybridge/satus@<version> generate --json` wrapper plus a workflow-artifact upload of the JSON manifest.
- **Opt-in failure fingerprints.** New `telemetry.share_failure_fingerprints` field in `satus.config.json` (default `false`). When enabled, `satus generate` reports a SHA-256 of the normalised schema shape (`schema_fingerprint`), the first-error validator rule (`validator_class`), and the subcommand + flag names of the invocation (`invocation_sequence`, never flag values). Feeds the eval fixture set for v0.4.0 (`satus agent`). See `packages/cli/src/generate/fingerprint.ts`.
- **`satus init`** prompts for the new telemetry knob with plain-English wording; the default answer is `no`.

### Changed

- `satus_runs` telemetry table gains three optional columns (`schema_fingerprint`, `validator_class`, `invocation_sequence`). All nullable, covered by the existing service-role policy and the 90-day pruning cron.
- The `/api/public/cli/run` ingest zod schema accepts the new fields with bounded shapes (64-char hex, ≤ 64-char rule name, ≤ 16-entry array of ≤ 32-char strings).

### Backward compatibility

- v0.2.x / v0.3.0–0.3.2 CLIs continue to ingest — every new field is optional at every layer.
- No CLI flag was removed or renamed. No existing telemetry field changed shape.
- Existing `satus.config.json` files keep working unchanged; the new `telemetry` object defaults to `{ share_failure_fingerprints: false }`.


## [0.3.0] — 2026-06-20

### Added

- **Anthropic provider.** `satus generate` can now call Anthropic's Messages API as a first-class peer to OpenAI. Structured output uses tool-use forcing (`tool_choice: { type: 'tool', name: 'emit_rows' }`) so the model is required to emit the row object directly — no JSON-string parsing on our side. Default model is `claude-haiku-4-5`; pin a different one with `--model`.
- **`--provider openai|anthropic` flag** on `satus generate`, plus a matching `provider` field in `satus.config.json`. Precedence: flag > config > env-var auto-detect.
- **Auto-detect.** When no flag and no config field are set, the CLI picks the provider whose API key is exported. If both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are set, the run aborts with a clear error rather than silently picking one.
- **`-v` / `--verbose` flag.** Prints a one-line per-batch breakdown: `· <table> batch=N rows=R in=I out=O $0.XXXX`. The default one-line summary is unchanged.
- **`--json` flag.** Emits a single newline-terminated JSON object on stdout at completion (snake_case keys matching the telemetry payload and Postgres column names). All human-readable output is redirected to stderr in this mode so stdout is safe for `jq` and CI scripts. Three shapes: `success`, `failed`, and `dry_run`.
- **Token-count reporting.** The success summary now reads `tokens: <input> in / <output> out   spent: $X.XXXX`. Token totals are also persisted to `public.satus_runs` (new nullable columns `provider`, `input_tokens`, `output_tokens`).
- **`OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL`** are honored for both providers if you need to point at a compatible proxy.

### Changed

- The CLI no longer assumes OpenAI when neither key is set; the missing-key error now names whichever provider was selected (`OPENAI_API_KEY is not set.` or `ANTHROPIC_API_KEY is not set.`).
- `satus init` now prompts for the provider and chooses the matching default model.
- Internal refactor: row generation went through a new `Provider` interface (`src/generate/providers/types.ts`). Existing OpenAI behavior is preserved byte-identically.

### Backward compatibility

- v0.2.x telemetry payloads continue to ingest. The three new `satus_runs` columns are nullable and the ingest validator marks them `.optional()`.
- Existing `satus.config.json` files keep working unchanged — the new `provider` and `model` fields are both optional. Old configs that pinned `model: "gpt-4o-mini"` still run against OpenAI.
- Exit codes are unchanged.

## [0.2.0] — 2026-06-04

- Deferred-constraint handling for soft FK cycles in a single transaction.
- Single-CTE catalog introspection (five round-trips collapsed to one).
- Tarball shrunk from 104 kB to 23 kB by dropping shipped sourcemaps and turning on minification.
- CITEXT detection and case-folding before insert.
- Partitioned-parent RLS detection with inline remediation.

## [0.1.1] — 2026-05-26

- Initial public release under `@passkeybridge/satus`.
