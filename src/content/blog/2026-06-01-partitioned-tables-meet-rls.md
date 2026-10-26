---
slug: partitioned-tables-meet-rls
title: Partitioned tables meet RLS, and nobody wins
description: RLS policies on a partitioned parent do not protect the children. What Postgres actually does, and the two-line workaround satus now prints.
date: 2026-06-01
author: satus.sh
tags: [postgres, rls, partitioning, seeding]
draft: false
---

If you `ENABLE ROW LEVEL SECURITY` on a partitioned parent and call it a day, you have not secured the children, and you have probably broken your seed job. Postgres treats the parent and each partition as separate tables for RLS purposes. Policies attached to the parent apply to queries that go *through* the parent; the partitions carry their own, independent RLS state. We hit this in two customer schemas in the same week. Both teams thought they had locked the table down. Neither had. satus v0.2.0 now detects the shape and prints the fix inline.

## The setup

A canonical multi-tenant events table, partitioned by month:

```sql
CREATE TABLE events (
  id          bigint generated always as identity,
  tenant_id   uuid    not null,
  occurred_at timestamptz not null,
  payload     jsonb   not null
) PARTITION BY RANGE (occurred_at);

CREATE TABLE events_2026_05 PARTITION OF events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE events_2026_06 PARTITION OF events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON events
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

This reads like a complete RLS setup. It is not. Two things are quietly true.

First, `ENABLE ROW LEVEL SECURITY` on `events` does *not* enable RLS on `events_2026_05` or `events_2026_06`. Each partition is a real table with its own `pg_class.relrowsecurity` flag. The parent's flag is independent.

Second, the `CREATE POLICY tenant_isolation ON events` row lives in `pg_policy` attached to the parent only. When a query goes through the parent, the planner expands it to the partitions and applies the parent's policy at each child. When a query goes *directly* at a child, the parent's policy is not in scope. Only the child's own policies, if any, are.

The combined effect, summarized:

| Access path                                  | Parent policy enforced? | Child policy enforced? |
| -------------------------------------------- | ----------------------- | ---------------------- |
| `SELECT FROM events WHERE …`                 | yes                     | yes, if any            |
| `INSERT INTO events VALUES (…)` (routed)     | yes                     | yes, if any            |
| `SELECT FROM events_2026_05 WHERE …`         | no                      | yes, if any            |
| `COPY events_2026_05 FROM …`                 | no                      | yes, if any            |
| `INSERT INTO events_2026_05 VALUES (…)`      | no                      | yes, if any            |

If "yes, if any" reads as "no, because nobody created one", that is exactly the failure mode. A tenant-isolation policy on the parent is a fence around the front door. The partitions are unlocked back doors.

## The bug as it actually shows up

Neither customer noticed the security gap directly. They both noticed seeding broke. The shape was the same on each ticket.

Their migration tool created the policy as above, then ran `satus generate` to fill the database with realistic fixture rows. The tool was running as the role that owned `events`. Postgres documents an important detail: a table's owner is not subject to its policies unless `FORCE ROW LEVEL SECURITY` is set ([PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)). In both schemas, `FORCE` was set, because the team's security review had asked for it. So the owner *was* subject to RLS.

satus computes the FK DAG, sees `events` is a partitioned parent, and chooses its insert path. Pre-v0.2.0 it preferred direct-to-partition inserts for partitioned tables, because routing every row through the parent is measurably slower for the bulk-load case. Direct inserts into `events_2026_05` bypassed the parent's `tenant_isolation` policy entirely, and there was no policy on the child, so a default-deny outcome should follow only if RLS was *enabled* on the child. It was not. The inserts went through.

So far so good for seeding, except now the application opened a session, set `app.tenant_id`, and ran `SELECT count(*) FROM events`. The parent policy did its job: only rows matching the session's tenant were returned. Most of the seeded rows had been generated with a uniform tenant distribution across the profile's tenant pool, so the count came back at roughly `1/N` of the expected total, where `N` was the number of tenants. The test suite, naturally, asserted on the full count. Red.

The customer's read of this was reasonable and wrong: *"satus is dropping rows."* satus had not dropped anything. The rows were physically present, distributed across partitions, and visible to the postgres superuser. They were invisible to the application role, because the parent policy filtered them, and the application happened to read through the parent.

The second customer had the inverse symptom: their test runner connected as a role *with* `BYPASSRLS` and saw all the rows fine, but their integration test, which spun up an application connection, saw a different count from `events_2026_05` directly than from `events`. Same root cause, opposite confusion.

## What we now print

When the planner sees a partitioned parent with at least one RLS policy and at least one child whose `relrowsecurity` is `false`, satus stops and prints the following before any DML runs:

```text
satus: partitioned table `public.events` has RLS policies but
       1 of 2 partition(s) do not have RLS enabled.

       partition                     rls?    own policies
       ───────────────────────────── ─────── ────────────
       public.events_2026_05         OFF     0
       public.events_2026_06         ON      0

       Direct inserts into a partition skip parent policies.
       Direct selects from a partition skip parent policies.

       To inherit the parent's posture on every partition:

         ALTER TABLE public.events_2026_05 ENABLE ROW LEVEL SECURITY;
         ALTER TABLE public.events_2026_05 FORCE  ROW LEVEL SECURITY;

       Or pass --route-through-parent to force satus to insert via
       the parent. Slower; preserves the parent's policy on every row.
```

Two lines, run once per missing partition. The choice between `ENABLE` and `ENABLE` + `FORCE` follows whatever the parent has; if the parent has `FORCE`, the children should too, otherwise the table owner can still bypass the children directly.

There is a deeper question buried in this: should the parent's policies be *automatically* attached to new partitions? Postgres has chosen no. New partitions are independent tables; their RLS state is whatever `CREATE TABLE PARTITION OF` and any subsequent `ALTER TABLE` give them. There is no `INHERIT POLICIES` keyword. The CREATE POLICY documentation is explicit that policies are per-table ([PostgreSQL: CREATE POLICY, Notes](https://www.postgresql.org/docs/current/sql-createpolicy.html)). This is a defensible design—policies often need to differ by partition for retention or archival reasons—but it makes the partition-creation step a security boundary that most ORMs and migration tools do not surface.

We ran a structural audit of five open-source Postgres schemas that ship raw SQL migrations (listmonk, lemmy, powerdns, penpot, pagila) on Postgres 17, covering 151 user tables. The full results are in [`corpus/audit-2026-06-01.json`](https://satus.sh/corpus/audit-2026-06-01.json). The number of declarative-partitioned parent tables across all five: **one**. The number of parents whose policies could be bypassed by writing directly to a child: zero in this corpus, because only one schema partitioned at all and it has no RLS policies on the parent.

That is itself the headline. Declarative partitioning is rare in published open-source OLTP schemas; teams that adopt it almost always do so inside private codebases (per-tenant SaaS, time-series telemetry, audit logs) that are exactly where RLS *also* gets adopted. The intersection is small and almost never visible in public corpora, which is part of why this footgun keeps surprising people: there is no public schema to copy a working pattern from.

The pattern is not "some teams forgot once". It is the default outcome of every workflow we have seen on private schemas, including ones written by experienced platform teams. The migration that creates the parent enables RLS on the parent. The migration that creates the next month's partition does not, because it is a copy-paste of last month's, which did not need to.

## The seeding workaround, in two lines

For the immediate "satus made my tests red" case, the workaround the tool now prints is the right answer for most teams. Enable and (if the parent uses it) force RLS on every partition, including ones created by future migrations. The simplest enforcement is a trigger on `pg_event_trigger` that fires on `CREATE TABLE` for partitions of an RLS-enabled parent and runs the `ENABLE`/`FORCE` statements automatically. The Postgres event triggers documentation covers the mechanism ([PostgreSQL: Event Triggers](https://www.postgresql.org/docs/current/event-triggers.html)).

The shorter answer, if you genuinely never want partitions to be accessed directly, is to revoke direct privileges on each partition and force all traffic through the parent. `REVOKE ALL ON events_2026_05 FROM public, app` plus `GRANT` on the parent only. This is a privilege fix, not an RLS fix, and it is independent of the policy state. We do not print this one automatically because it has real operational consequences (no per-partition `pg_dump` as the app role, no per-partition maintenance jobs), and the right call depends on the team. The detection just notes the option.

## What this does not solve

A few things this detection deliberately does not try to handle:

- **Policy drift.** If `events_2026_05` has RLS enabled but a different policy than the parent, satus does not currently diff the policy expressions. We have not seen this be the failure mode in practice; the dominant mode is "no policy at all on the child".
- **Default partition gaps.** A `DEFAULT` partition with mismatched RLS is the worst version of this bug, because rows that do not match any other range end up there and may be silently invisible. We flag it the same way as any other partition, with no special call-out yet. That should change; it is on the v0.3 list.
- **Inheritance (the legacy `INHERITS` mechanism, not declarative partitioning).** Pre-PG10 inheritance has slightly different RLS semantics for some access paths. We see it rarely in modern schemas and currently do not run the partition check on inheritance trees. If you are on legacy inheritance and want this, file an issue.

## The shorter version

`ENABLE ROW LEVEL SECURITY` on a partitioned parent secures the parent, not the partitions. Policies are per-table, partitions are tables, and Postgres will not propagate either one for you. If your application reads through the parent and your seeder writes through a child, you will get a row count that nobody at the table can explain. Enable RLS on every partition, force it if the parent forces it, and consider an event trigger so the next partition does not reopen the back door.

## References

- PostgreSQL documentation, [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
- PostgreSQL documentation, [CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html).
- PostgreSQL documentation, [Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html).
- PostgreSQL documentation, [ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) (ENABLE / FORCE ROW LEVEL SECURITY).
- PostgreSQL documentation, [Event Triggers](https://www.postgresql.org/docs/current/event-triggers.html).
- Earlier in this log: [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question), [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild).
- The corpus underlying this post's structural counts: [`corpus/audit-2026-06-01.json`](https://satus.sh/corpus/audit-2026-06-01.json) (5 schemas, 151 tables, Postgres 17).
- See also: [satus profiles](/profiles), [quickstart](/quickstart).

—the satus.sh team
