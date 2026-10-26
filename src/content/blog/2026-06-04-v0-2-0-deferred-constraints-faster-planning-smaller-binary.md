---
slug: v0-2-0-deferred-constraints-faster-planning-smaller-binary
title: "v0.2.0: deferred constraints, faster planning, and a smaller binary"
seoTitle: satus v0.2.0: deferred constraints and a smaller binary
description: Cyclic foreign keys now seed end to end via deferred constraints. Introspection drops from five round trips to one. The npm tarball is 77.6% smaller.
date: 2026-06-04
author: satus.sh
tags: [postgres, satus, release, foreign-keys, performance]
draft: false
---

`@passkeybridge/satus@0.2.0` is on npm. Three changes are worth writing up: cyclic foreign keys now seed in a single transaction without a workaround, catalog introspection collapses from five sequential round-trips to one CTE, and the published tarball shrinks from 104 kB to 23 kB by dropping shipped sourcemaps and turning on minification. None of these are headline-feature work. They are the kind of changes you make once the v1 surface is stable and the bug reports start to cluster.

## Cyclic foreign keys, end to end

A two-table cycle is the smallest example that previously failed: `users.primary_org_id → orgs.id` and `orgs.owner_user_id → users.id`. There is no insert order that satisfies both `NOT NULL` and both foreign keys at once. We wrote about the general shape in [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild); v0.2.0 is the implementation.

The algorithm is unglamorous. After Kahn's topological sort fails, the planner scans the residual edges for a foreign-key column declared nullable. The first such edge it finds is removed from the DAG and recorded as a `BrokenEdge`. Kahn's runs again. Repeat until the graph is acyclic or no nullable back-edge remains. At runtime:

1. `SET CONSTRAINTS ALL DEFERRED` is issued at the top of the transaction, so any `DEFERRABLE` foreign keys the user already declared validate at `COMMIT` instead of after each statement.
2. Parents in the broken-edge relationship are inserted first. Children are inserted with `NULL` in the broken column.
3. After both tables are seeded, a single `UPDATE` per broken edge wires each child row to a random parent primary key, still inside the same transaction.
4. `COMMIT`.

If every edge in a cycle is `NOT NULL`, the planner refuses to run and prints the cycle with a one-line remediation: make a column nullable, or drop one of the cycle members from the run. We do not synthesize a placeholder row, we do not disable constraints, and we do not silently widen `NULL` semantics on a column the user said was `NOT NULL`.

The integration test we ran on the release runner, against a local PostgreSQL 17 instance:

```text
fixture        users(primary_org_id -> orgs)
               orgs(owner_user_id  -> users NOT NULL)
broken edge    users.primary_org_id (nullable)
command        satus generate --rows 5

result
  rows inserted              10  (5 users, 5 orgs)
  NULL FKs after wire-up      0  (5/5 users.primary_org_id resolved)
  cycle members reachable    yes (both directions)
```

The numbers, the fixture schema, and the exact command are recorded in [`corpus/bench-2026-06-04.json`](https://satus.sh/corpus/bench-2026-06-04.json) so future regressions are easy to spot.

### Two limits worth naming

This is the smallest useful version of cycle handling, not the most general one.

- **Cycles where every edge is `NOT NULL` are unsupported.** Breaking them requires either pre-allocating sentinel rows or temporarily dropping a constraint, both of which we want to avoid in v0.x.
- **Cycles longer than two tables are handled by the same algorithm**, but the wire-up pass scales linearly with the number of broken edges. The test corpus does not yet include a real-world four-table cycle; if you have one, we want it.

## Catalog introspection, one round-trip

Pre-v0.2.0, the generator's first phase ran five sequential queries against `information_schema` and `pg_catalog`: tables, columns, primary keys, foreign keys, and unique constraints. On a local socket the overhead was invisible. On a remote Postgres (Supabase, Neon, RDS over the public internet, an SSH tunnel) the overhead was four extra network round-trips, each paying the full latency budget back-to-back.

v0.2.0 collapses the five into one CTE-shaped query that returns each result set as a `jsonb_agg` column. The client decodes a single response. Wire shape and per-column meaning are unchanged; only the trip count moves.

Benchmarked against pooled Supabase from the release runner, fifteen iterations after a three-iteration warmup, with `psql` process startup and the TLS handshake measured separately via `select 1` and subtracted out:

```text
                                  median (ms)
                                  ───────────
psql + TLS baseline (select 1)            603
legacy, five queries                      981   ->   378 ms wire
v0.2.0, single CTE query                  646   ->    43 ms wire

speedup on wire work                     8.79x
round-trips saved                            4
end-to-end speedup                       1.52x
```

The end-to-end number is the honest one to lead with. A 1.52x improvement on the introspection phase is not a marketing number; it is what happens when you stop spending four round-trips on something that fits in one query. The 8.79x figure on isolated wire time is the same change measured without the constant cost of opening a connection, included for completeness rather than for the headline.

| Surface           | Pre-v0.2.0 | v0.2.0     | Delta                  |
| ----------------- | ---------- | ---------- | ---------------------- |
| Catalog queries   | 5          | 1          | -4 round-trips         |
| Median end-to-end | 981 ms     | 646 ms     | -335 ms (-34%)         |
| Isolated wire     | 378 ms     | 43 ms      | -335 ms (8.79x faster) |

The CTE is built from documented relations only: `information_schema.tables`, `information_schema.columns`, `pg_constraint`, `pg_attribute`, `pg_class`, `pg_namespace`. No vendor extensions, no system-internal views, nothing that breaks on managed providers.

## A smaller tarball

The 0.1.x release shipped with sourcemaps and an unminified bundle. Sourcemaps make sense for a library that consumers re-bundle. They do not make sense for a CLI that ships as a `#!/usr/bin/env node` shebang and is never opened in a browser devtools panel. No end user has ever pointed a stack trace at our sourcemap. We removed them and turned on `tsup`'s minifier.

```text
                          0.1.1        v0.2.0
                          ─────        ──────
dist/cli.js                32134        23403   bytes
dist/cli.js.map            72243            0   bytes
total npm payload         104377        23403   bytes
reduction                                77.6%
```

The user-visible behavior change is that `npm i -g @passkeybridge/satus` installs faster on slow networks and the on-disk footprint is roughly a quarter of what it was. Error stack traces still resolve to the right file and line, because `tsup`'s minifier preserves function names and source positions sufficiently for `node --enable-source-maps`-style frames; we keep an unminified build available locally for our own debugging.

## A small bug we found by writing the integration test

While running the cyclic-schema test against `gpt-5-mini`, the LLM call returned `400`: *"`temperature` does not support 0.7 with this model. Only the default (1) value is supported."* The OpenAI GPT-5 family pins temperature at 1 and rejects any other value with a hard error. Our client sent `temperature: 0.7` unconditionally. The fix is one branch: send `temperature` only when the model is not GPT-5. The detection is by prefix, so `gpt-5`, `gpt-5-mini`, and future `gpt-5.x` minor releases are all covered.

This is not a release-worthy feature on its own. It is mentioned here because it is the kind of bug that an integration test against a real model catches, and a unit test with a mocked OpenAI client does not. The release runner now runs the cyclic-schema test against a real model on every release.

## Upgrade

```bash
npm i -g @passkeybridge/satus
satus --version    # 0.2.0
```

Existing configs work unchanged. The new behavior is opt-in only in the sense that you have to have a cycle in your schema to see the new cycle handling, a remote database to feel the round-trip improvement, and a slow network to notice the smaller tarball. If none of those describe you, the 0.2.0 upgrade is a silent improvement.

## What did not ship

For honesty, the four things we considered and explicitly deferred:

- **`NOT NULL` cycle breaking via sentinel rows.** Discussed in the cycle write-up; the v1 stance is that the workaround should be visible in the schema, not hidden in the seeder.
- **Cycle handling at the `serializable` isolation level.** The post-insert `UPDATE` pass conflicts with concurrent writers in `serializable`; we have not yet decided whether to retry the wire-up or to require `read committed` for cyclic schemas.
- **Statement-level batching of the wire-up `UPDATE`s.** A single `UPDATE … FROM (VALUES …)` would be tighter than the current per-row loop on schemas with thousands of broken-edge rows. Queued for v0.3.
- **A `--plan-only` flag that emits the broken-edge plan as JSON.** Useful for CI gates that want to fail on unexpected new cycles. Also queued.

## References

- PostgreSQL documentation, [`SET CONSTRAINTS`](https://www.postgresql.org/docs/current/sql-set-constraints.html).
- PostgreSQL documentation, [Constraints, Foreign Keys](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK).
- PostgreSQL documentation, [System Catalogs: `pg_constraint`](https://www.postgresql.org/docs/current/catalog-pg-constraint.html).
- PostgreSQL documentation, [`WITH` Queries (Common Table Expressions)](https://www.postgresql.org/docs/current/queries-with.html).
- Kahn, A. B., *Topological sorting of large networks*, Communications of the ACM, 1962. [ACM DL](https://dl.acm.org/doi/10.1145/368996.369025).
- Earlier in this log: [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild), [Partitioned tables meet RLS, and nobody wins](/blog/partitioned-tables-meet-rls), [The CITEXT trap in Postgres unique indexes](/blog/the-citext-trap).
- Release artifact: [`corpus/bench-2026-06-04.json`](https://satus.sh/corpus/bench-2026-06-04.json).
- Package: [`@passkeybridge/satus` on npm](https://www.npmjs.com/package/@passkeybridge/satus).
- See also: [quickstart](/quickstart), [profiles](/profiles), [how it works](/docs/how-it-works).

—the satus.sh team
