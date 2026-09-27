# satus

**Realistic, FK-safe seed data for Postgres.** satus reads your schema from
`pg_catalog`, sorts tables by foreign-key dependency, asks an LLM (your
OpenAI, Anthropic or xAI key; xAI from the CLI release after 0.3.11) for rows that look like a real business, and
inserts them in a single all-or-nothing transaction.

[![cli-ci](https://github.com/PasskeyBridge-LLC/satus/actions/workflows/cli-ci.yml/badge.svg)](https://github.com/PasskeyBridge-LLC/satus/actions/workflows/cli-ci.yml)
[![npm](https://img.shields.io/npm/v/%40passkeybridge%2Fsatus)](https://www.npmjs.com/package/@passkeybridge/satus)

Website: [satus.sh](https://satus.sh) · npm: [`@passkeybridge/satus`](https://www.npmjs.com/package/@passkeybridge/satus) · Docs: [satus.sh/docs](https://satus.sh/docs)

```console
$ satus generate --profile ecommerce --rows 5

satus generate
  schema:   public
  profile:  ecommerce
  provider: anthropic
  model:    claude-haiku-4-5
  rows:     5 per table
  tables:   categories -> customers -> products -> orders -> order_items
  cycles:   categories.featured_product_id -> products (deferred)

  categories . 5
  customers . 5
  products . 5
  orders . 5
  order_items . 5
  wired categories.featured_product_id -> products (5 rows)

✓ inserted 25 rows across 5 tables
  tokens: 4723 in / 1054 out   spent: $0.0300
```

That transcript is real — including the FK cycle it detected, deferred, and
back-patched.

## Quickstart

```bash
npm install -g @passkeybridge/satus     # Node >= 20; or use npx

export DATABASE_URL="postgres://user:pass@localhost:5432/app"
export OPENAI_API_KEY="sk-..."          # or ANTHROPIC_API_KEY, or XAI_API_KEY

# Plan + validate offline — no LLM calls, no writes, no spend.
satus generate --profile ecommerce --dry-run

# Generate for real.
satus generate --profile ecommerce --rows 50
```

Full walkthrough: [satus.sh/quickstart](https://satus.sh/quickstart).

## What it actually does

- **Introspection**: one round-trip against `pg_catalog` — tables, columns,
  PKs, FKs (with deferrability), single-column uniques, enums. Partitioned
  tables are seeded via the parent, with child-declared FKs re-attributed
  to the partition root.
- **Ordering**: Kahn's topological sort over the FK graph. Soft cycles are
  broken by NULLing a nullable back-edge and back-patching it after all
  tables are seeded, inside the same transaction.
- **Generation**: batched structured-output calls (OpenAI and xAI
  `json_schema`, Anthropic tool-forcing) against a JSON schema built from your columns;
  FK values are injected from actually-inserted parent PKs, never invented.
- **Safety**: refuses to run against a database already holding more than
  10,000 rows (exit `11`, `--force` to override); one transaction per run; a `--max-cost` USD budget that
  aborts and rolls back before overshooting; `--dry-run` simulates and
  validates offline and exits non-zero on findings (CI gate).
- **Honest limits (v0.x)**: multi-column uniques are not enforced during
  generation, cross-column arithmetic is not reconciled, and output is not
  deterministic (no `--seed` — snapshot with `pg_dump` for stable fixtures).

## Repository layout

| Path | What it is |
|---|---|
| `packages/cli/` | The `satus` CLI (published to npm as `@passkeybridge/satus`) |
| `packages/action/` | Composite GitHub Action — use as `PasskeyBridge-LLC/satus/packages/action@main` |
| `src/` | satus.sh — TanStack Start site: marketing, docs, blog, checkout, license API |
| `supabase/` | Database migrations for the backing Supabase project |
| `corpus/`, `scripts/`, `examples/` | Accuracy-audit corpus, bench/audit tooling, extension pitfall examples |
| `docs/` | Roadmap, content plan, migration records |

## Developing

```bash
# Site (repo root)
bun install && bun run dev

# CLI
cd packages/cli
npm ci && npm test && npm run build
node dist/cli.js --help
```

CLI releases are tagged `v*.*.*` and published to npm with provenance by
`.github/workflows/cli-publish.yml`.

## Pricing & license

The CLI has a free tier (25 rows/table, 5 tables) with no signup. Pro and
Team licenses remove the caps — [satus.sh/pricing](https://satus.sh/pricing).

Source-visible, commercially licensed: reading this code for review and
evaluation is welcome; use beyond evaluating satus itself requires a
commercial license. See [LICENSE](LICENSE). Security reports:
[SECURITY.md](SECURITY.md).

---

A [PasskeyBridge LLC](https://passkeybridge.io) product.
