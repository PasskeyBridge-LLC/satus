# satus

> Generate realistic seed data for Postgres. Respects foreign keys, unique constraints, and your schema.

`satus` is a command-line tool that introspects your Postgres schema, topologically sorts your tables by foreign-key dependency, and writes seed rows that actually look like the product you're building. No more `user_1@example.com`, `Lorem ipsum`, or invoices that reference orders that reference customers that don't exist.

- Website: <https://satus.sh>
- Marketing repo: [PasskeyBridge-LLC/satus](https://github.com/PasskeyBridge-LLC/satus) (public, source-visible)
- Contact: <support@satus.sh>

## Status

`v0.3.11` — released 2026-08-27. Two corrections, both cases of shipped behaviour not matching a published claim. Run telemetry is now opt-in (`telemetry.enabled`, `SATUS_TELEMETRY=1`, `DO_NOT_TRACK=1` wins), which is what satus.sh/security has always promised and the CLI did not do. And primary keys and unique constraints are read from `pg_catalog` instead of `information_schema`, so a role holding only `SELECT` no longer introspects every table as having no primary key — which made `--dry-run` return a false green as a CI gate.

`v0.3.10` — released 2026-08-14. Enforces the 24-hour license grace as documented: `satus activate` now stores the key locally, `satus generate` re-verifies any cached verdict older than 24 hours, and a verdict that cannot be refreshed falls back to Free-tier caps with a printed reason. Caches written by older versions carry no key; run `satus activate <key>` once to restore paid caps.

`v0.3.9` — released 2026-08-11. Exposes `force` and `truncate` on the GitHub Action, which had no way to bypass the new safety guard, and makes an unbreakable FK cycle exit `10` (`E_FK_CYCLE`) as the docs have always specified.

`v0.3.8` — released 2026-08-11. Adds the production-database safety guard described below: `satus generate` now refuses to run against a database already holding more than 10,000 rows, exiting `11` without writing anything. The guard had been documented on satus.sh since v0.3.x but was never implemented; this release makes the documentation true. `--force` bypasses it.

`v0.3.7` — released 2026-08-10. Correctness release: identity columns are left to the database instead of being handed to the model, foreign keys targeting non-primary-key columns resolve instead of silently inserting NULL, the dry-run estimate and the live cost meter share one price table, `--truncate` no longer cascades outside the run set, and run telemetry was cut back to match the published privacy promise. Full detail in [CHANGELOG.md](../../CHANGELOG.md); previous release notes at [satus.sh/blog](https://satus.sh/blog) and [satus.sh/cli](https://satus.sh/cli).

## Install

```bash
npm install -g @passkeybridge/satus
```

The package is published under the PasskeyBridge namespace on npm. The binary it installs is `satus`, so all commands below are typed as `satus ...`.

Requires Node.js 20+.

## Quickstart

```bash
satus init                                # write satus.config.json
satus generate --profile saas --rows 25   # seed against the configured DB
satus generate --profile saas --dry-run   # plan only, no LLM call, no writes
```

## Commands

| Command | Description |
|---|---|
| `satus init` | Scaffold `satus.config.json` in the current directory. Flags: `--force`. |
| `satus generate` | Introspect schema and write seed rows. Flags: `--profile`, `--rows`, `--max-cost`, `--batch-size`, `--dsn`, `--schema`, `--provider`, `--model`, `--truncate`, `--force`, `--dry-run`, `-v / --verbose`, `--json`. |
| `satus activate <key>` | Activate a Pro or Team license key. |
| `satus whoami` | Print the currently activated license (from local cache). |
| `satus --help` | Full command reference. |

## Safety guard

`satus generate` writes rows, so before it writes anything it counts rows in every user table — every table outside `pg_catalog`, `information_schema`, and `pg_toast`, in every schema, not just the one being seeded. If the total exceeds **10,000** the run is refused.

The intent is narrow: catch the case where `DATABASE_URL` was pointed at production by accident. 10,000 is deliberately conservative — a fresh dev database sits at zero, a container with today's migrations sits in the low hundreds, an already-seeded test database sits in the low thousands. For a local throwaway, `scripts/test-db.sh` in the marketing repo starts pagila on `127.0.0.1:5432` and writes that URL into gitignored `.env.local`. Do not put the hosted project in `DATABASE_URL`.

```
Refusing to run: this database already holds more than 10,000 rows across 7 user table(s).
  satus generate writes rows, and a database this full is usually not the one you meant
  to seed. Check DATABASE_URL.
  If it is the right database — a staging environment with real fixtures, say — re-run
  with --force.
```

Pass `--force` to bypass it. `--dry-run` is never blocked (it writes nothing) but warns that a real run would be refused.

Counting is bounded: each table is counted through a subquery capped at 10,001 rows and the total short-circuits as soon as it crosses the threshold, so the guard costs about the same on a 400-million-row production table as on an empty one. Tables the connecting role cannot `SELECT` are skipped and reported rather than raising.

The guard is not a permission check (Postgres roles do that better) and not a rollback mechanism (the single transaction does that).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | General failure — bad config, connection refused, LLM or database error. |
| `2` | `--dry-run` completed but the relational validator found errors. Use as a CI gate. |
| `10` | `E_FK_CYCLE` — a foreign-key cycle exists in which no edge is nullable, defaulted, or deferrable, so satus will not guess which invariant to break. Nothing was written. |
| `11` | `E_DB_NOT_EMPTY` — the safety guard refused to run. Nothing was written. |

Codes `10` and `11` both mean "satus declined to act" as opposed to "satus tried and failed" — the distinction a bare `1` cannot carry. They are defined in one place, `packages/cli/src/exit-codes.ts`, and pinned by a test.

## Reference profiles

| Profile | Shape |
|---|---|
| `saas` | Users, orgs, memberships, subscriptions, usage events. |
| `ecommerce` | Customers, products, variants, orders, line items, inventory. |
| `b2b` | Accounts, contacts, opportunities, activities, line items. |

## License tiers

| Tier | Price | Rows/table | Max tables | Profiles | LLM key |
|---|---|---|---|---|---|
| Free | $0 | 25 | 5 | all three | BYO |
| Pro | $19/mo (or $190/yr) | unlimited | unlimited | all three | BYO |
| Team | $49/seat/mo — **waitlist, not yet purchasable** | unlimited | unlimited | all three | BYO |

The CLI ships exactly three profiles (`saas`, `ecommerce`, `b2b`) on every tier; custom or private profiles do not exist in any version. See <https://satus.sh/pricing> for the current tier matrix.

License keys are verified against `https://satus.sh/api/public/license/verify` and cached locally for 24 hours under `~/.satus/`.

## Bring your own LLM key

`satus` calls an LLM provider for structured content generation. You bring the key; the request goes from your machine directly to the provider. satus.sh is never in the data path.

### Supported providers

| Provider | Env var | Default model | Get a key |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` | <https://platform.openai.com/api-keys> |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-haiku-4-5` | <https://console.anthropic.com/settings/keys> |
| xAI | `XAI_API_KEY` | `grok-4.20-0309-non-reasoning` | <https://console.x.ai> |

The `xai` provider was added after 0.3.11 and ships in the next release. It calls `https://api.x.ai/v1/chat/completions` with strict `json_schema` output. On reasoning models (for example `grok-4.3`) the cost meter counts reasoning tokens as output tokens, because xAI bills them.

### Selecting a provider

Precedence (highest first):

1. `--provider openai|anthropic|xai` flag on `satus generate`.
2. `provider` field in `satus.config.json`.
3. **Auto-detect** from which env var is set.

If both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are exported and you pass no flag and no config, the run aborts with a clear message — auto-detect deliberately refuses to guess so a misplaced key never spends on the wrong invoice. `XAI_API_KEY` is auto-detected only when neither of the other two is set; otherwise pass `--provider xai`.

Model resolution is the same shape: `--model` flag wins, otherwise the config field, otherwise the provider's default model. Cross-provider model names are not validated client-side; the upstream 4xx surfaces verbatim if you pass `gpt-4o-mini` with `--provider anthropic`.

### Cost reporting

Every run prints `tokens: N in / M out   spent: $X.XXXX` on success. The estimate uses a small built-in price table per provider; `--max-cost` (default `$1.00`) is enforced live and aborts the run before commit if you'd overshoot.

For per-call detail, pass `-v` / `--verbose` — every batch logs a line:

```
· users                        batch=1 rows=25 in=842 out=1310 $0.0011
```

For CI, pass `--json` to get a single newline-terminated JSON object on stdout while all human output is redirected to stderr. This report stays on your machine, so unlike the telemetry payload it does name your tables and schema:

```json
{"run_id":"...","status":"success","provider":"openai","model":"gpt-4o-mini","profile":"saas","target_schema":"public","tables":[{"name":"users","rows_generated":25}],"total_rows":25,"total_cost_usd":0.001100,"input_tokens":842,"output_tokens":1310,"duration_ms":3142}
```

Both cost numbers you see for a run — the `--dry-run` estimate and the live meter — read the same per-model rate table, selected by `--provider` and `--model`. Rates are pinned and dated in `packages/cli/src/generate/providers/openai.ts`, `anthropic.ts` and `xai.ts`; a model id not in its provider's table falls back to the most expensive entry in its own table, so an unpriced model can only make `--max-cost` abort early, never overshoot. Rates drift — treat every figure as an estimate and your provider's dashboard as the invoice.

### Custom endpoints

`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` and `XAI_BASE_URL` are honored if you need to point at an OpenAI- or Anthropic-compatible proxy (Groq, Together, a local gateway, a corporate egress).

## Privacy

`satus` never sends your schema, your data, or your column names to satus.sh. LLM calls go directly from your machine to your provider with your key.

Two requests can reach satus.sh:

- **License verify** — sends your license key and nothing else. Only on paid tiers; Free never contacts the license server.
- **Run telemetry** — **off by default since v0.3.11.** Nothing is sent unless you opt in.

Enable the run record with either:

```jsonc
// satus.config.json
{ "telemetry": { "enabled": true } }
```

```bash
SATUS_TELEMETRY=1 satus generate
```

`DO_NOT_TRACK=1` overrides both and always wins. `satus init` asks, and defaults to no.

When enabled, one record is posted as `satus generate` finishes. It carries a random run UUID, the CLI version, provider, model, profile, the *number* of tables touched, total rows, token totals, estimated spend, duration, and — on failure — a fixed-vocabulary error class (`pg_23505`, `provider_http_429`, `budget_exceeded`, …). No table names, no column names, no schema name, no row data, no raw error text. Failures swallow silently and never break a run.

`telemetry.share_failure_fingerprints` is a second, narrower opt-in on top: it adds a SHA-256 of the normalised schema shape and the first validator rule that fired. It does nothing unless `telemetry.enabled` is also true.

The exact payload is defined by `RunTelemetry` in `packages/cli/src/generate/telemetry.ts`, and that file's header treats this section as its specification.

> **Correction (v0.3.7).** CLI versions 0.2.0–0.3.6 also sent the list of table names, the target schema name, and the raw error message — and a Postgres unique-violation message embeds the offending row value. That contradicted this section as written. v0.3.7 stops sending all three, and the ingest endpoint discards them from any payload an older CLI still sends. The only runs ever recorded under the old behaviour were our own release tests.

> **Correction (v0.3.11).** Through v0.3.10 the run record was sent unconditionally, with no config key, environment variable, or flag able to stop it, while satus.sh/security said telemetry was off by default. Only the failure-fingerprint sharing was ever gated. The payload was already the minimal one described above, so nothing identifying was collected, and all twelve records in the table are our own release-test runs — but the published claim described behaviour the CLI did not have. v0.3.11 makes the run record opt-in.

## Development

```bash
git clone git@github.com:PasskeyBridge-LLC/satus.git
cd satus/packages/cli
npm install
npm run dev       # tsup --watch
npm test
```

## License

Proprietary. Copyright (c) 2026 PasskeyBridge LLC. All rights reserved. See [`LICENSE`](./LICENSE).

## Security

Report vulnerabilities to <support@satus.sh>. Do not open public issues for security reports.
