---
slug: v0-3-8-release-notes
title: "v0.3.8: the safety guard we had already written about"
description: satus 0.3.8 implements the 10,000-row production guard our docs have described since v0.3.x. It was documented, linked, and explained. It was never in the code.
date: 2026-08-11
author: satus.sh
tags: [release, cli, postgres, safety]
draft: false
---

`@passkeybridge/satus@0.3.8` is on npm. It adds one feature, and the feature is one our documentation has claimed we already had.

## What the docs said

[How it works](/docs/how-it-works) has carried a section titled *"Safety guard—ten thousand rows. then we stop and ask."* since the v0.3.x docs went up. It reads, in part:

> Before any write, satus counts user-table rows—every table outside `pg_catalog`, `information_schema`, and `pg_toast`—and refuses to run if the total exceeds **10,000**. The intent is narrow: catch the case where `DATABASE_URL` was set to production by accident.

It goes on to specify the bypass (`--force`), the exit code (`11`, `E_DB_NOT_EMPTY`), and why 10,000 is the number. It is a precise, well-argued spec.

None of it was implemented. `resolveDsn` read the string and `client.connect()` opened the connection. There was no count, no threshold, no refusal.

## How we found out

Not by auditing. By nearly doing the thing the guard exists to prevent.

Someone on our side was setting up a local test, exported `DATABASE_URL` pointing at the wrong Supabase project—a production one—and ran `satus generate`. It hung, because the value pasted was the project's HTTPS API URL rather than a Postgres connection string, and `pg` sat there trying to open a socket to port 5432 on a host that only speaks TLS to a REST API.

That typo is the only reason nothing happened. Had the connection string been correct, satus would have introspected a production schema and written generated rows into it, inside one transaction, reporting success. The documented guard that would have stopped it did not exist.

We checked afterwards, carefully: `client.connect()` runs before introspection, before telemetry, before `BEGIN`. The connection never succeeded, no telemetry row was ever posted, and `pg_stat_user_tables` on that database shows only its normal traffic. Nothing was written. But the margin was a malformed URL, not a safeguard.

## What 0.3.8 does

Exactly what the page said, with no reinterpretation:

```
$ satus generate --rows 25
error: Refusing to run: this database already holds more than 10,000 rows across 7 user table(s).
  satus generate writes rows, and a database this full is usually not the one you meant
  to seed. Check DATABASE_URL.
  If it is the right database — a staging environment with real fixtures, say — re-run
  with --force.
$ echo $?
11
```

The count covers every schema, not only the one being seeded—production is rarely all in `public`, and a guard that ignored an `archive` schema holding fifty million rows would miss the databases it most needs to catch. It runs before introspection, so it is the first thing that happens after the connection opens. `--force` bypasses it. `--dry-run` is never blocked, because it writes nothing, but it does warn that a real run would be refused.

## Counting without scanning production

The obvious implementation—`count(*)` on every table—is unbounded work on precisely the databases we most want to stop. A production table can be hundreds of millions of rows.

But we never need the true total. We only need to know whether it exceeds 10,000. So each table is counted through a subquery capped at 10,001 rows, and the running total short-circuits the moment it crosses the threshold. On production the first large table trips it and we stop; on a dev database every table is tiny and the whole pass is trivial. The guard costs about the same against a 400-million-row table as against an empty one.

The tempting shortcut is `pg_class.reltuples`, the planner's row estimate, which is free. We didn't use it. It goes stale between `ANALYZE`s, and it reports `-1` for a never-analyzed table—which is the exact state of a freshly restored production dump. A safety guard that reads restored production as empty is worse than no guard at all, because it converts caution into false confidence.

Two smaller details worth stating, since both are places a guard can quietly under-count. Partitioned parents (`relkind = 'p'`) are excluded: rows physically live in the partitions, so counting parents as well would double every partitioned row. And tables the connecting role cannot `SELECT` are skipped rather than raising—a role that cannot read a table is not seeding it either—but the number skipped is reported in the refusal message, so an under-count is never silent.

## Tests

Fourteen new tests, and each was mutation-checked: we reintroduced the bug and confirmed the suite went red. Removing the per-table `LIMIT`, narrowing the scan to `public`, including partitioned parents, weakening `>` to `>=`, and silently dropping unreadable tables each turned the suite red before being reverted. Two of the checks pin the published contract itself—the threshold `10000` and the exit code `11`—so changing either requires deliberately editing a test that says it is a public promise.

The end-to-end behaviour was verified against live PostgreSQL 16.13: a 550-row database seeds normally, a 10,510-row database exits `11` with its row count unchanged, `--force` proceeds and writes, `--dry-run` warns without blocking, and a database whose rows live in a non-target schema still trips.

## The wider point

This is the fifth documented-but-absent behaviour we have found and closed in a week. The others were smaller—profile names, flags that didn't exist, a `--dry-run` that was described as emitting SQL. This one is different in kind, because it is a *safety* claim. A user who reads that page and believes it is protected will be less careful, not more. Documentation that overstates a safeguard doesn't just fail to help; it actively removes the caution the reader would otherwise have applied.

We would rather ship the feature than delete the paragraph. But the general rule we're now applying to satus is the harsher one: if the docs describe behaviour, there is a test that fails when the behaviour goes away. `10000` and `11` are now assertions, not prose.

`satus.config.json` from 0.3.x works unchanged. One behaviour change to note: a run against a database with more than 10,000 rows now fails where it previously succeeded. That is the point. Add `--force` if the target really is a large staging database.
