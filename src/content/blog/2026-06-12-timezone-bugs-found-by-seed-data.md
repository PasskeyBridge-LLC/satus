---
slug: timezone-bugs-found-by-seed-data
title: Three timezone bugs we found by seeding production-shaped data
seoTitle: Three timezone bugs found by seeding production-shaped data
description: Uniformly random timestamps hide timezone bugs. Business-hours timestamps surface them. Three bugs from support, and the catalog signals that predict each.
date: 2026-06-12
author: satus.sh
tags: [postgres, timezones, testing, seeding]
draft: false
---

> **Editor's note (2026-07-16):** Passages referencing a `medical-booking` profile with per-profile default timezones and DST-aware date windows describe design intent from mid-2026. The shipped CLI (v0.3.5) ships `saas`, `ecommerce`, and `b2b` prompt profiles ([/profiles](/profiles)) that bias value choice but do not encode timezone rules. The three DST bugs and the argument for reproducing them with seed data stand on their own.



Most seed-data tools draw timestamps from a uniform random distribution over some window: pick a `created_at` somewhere between `now() - interval '90 days'` and `now()`, repeat. The resulting fixture is statistically smooth. It is also, in a very specific way, a lie. Real Postgres tables almost never look like that. They look like the traffic that filled them: a daily sine wave clipped to the business hours of whatever timezone the users live in, with a weekly notch on weekends, and the occasional spike when marketing sends an email.

That shape difference matters because a long list of bugs that production has are bugs *about time*: cron windows, daily roll-ups, locks held across midnight, DST transitions, indexes that get hot at the wrong hour. A uniform fixture will not surface any of them. A fixture that looks like real traffic will. This post walks through three bugs we have reproduced in customer schemas after they switched their tests from uniform timestamps to satus's business-hours sampler, and the catalog signals satus uses to know when to apply that sampler in the first place.

## The sampler, briefly

The default `timestamptz` generator in satus is not uniform. For columns that smell like event timestamps (`created_at`, `updated_at`, `occurred_at`, anything with a `_at` suffix on a `timestamptz` column) it draws from a piecewise distribution:

```text
local hour      weight
─────────────   ──────
00–06             0.5×    overnight floor
06–09             3×      morning ramp
09–17             8×      business hours, flat
17–20             3×      evening ramp
20–24             1×

weekend day       0.4×    applied multiplicatively
holiday calendar  off by default; per-profile opt-in
```

"Local" means a per-profile timezone, defaulting to `America/Los_Angeles` for `saas-subscriptions`, `America/New_York` for `medical-booking`, and `Europe/London` for `ecommerce`. The shape is intentionally generic; the point is not that any one schedule is correct, it is that *any* business-hours shape exposes the bugs a flat distribution hides.

When satus inserts these timestamps into a `timestamptz` column, Postgres stores them as UTC instants. The local clustering survives the conversion because it is encoded in the instant itself. The same row in a UTC dashboard appears as a 17:00-UTC spike for a Los Angeles profile, which is exactly where the first bug lives.

## Bug 1: The 02:00 UTC cron that was actually 18:00 Pacific

The schema was a SaaS application with a nightly billing roll-up. The job was scheduled in `pg_cron` at `0 2 * * *`, with a comment in the migration that read `-- runs during the low-traffic window`. Under uniform-random seed data the comment was true: the test suite saw flat 4% of daily inserts in each hour bucket, and 02:00 UTC was indistinguishable from any other hour. The roll-up finished in seconds.

With business-hours-clustered seed data on a Pacific profile, 02:00 UTC is 18:00 Pacific, which is inside the evening ramp. The seeded fixture put roughly half of the day's `invoices` rows inside a four-hour window straddling that time. The roll-up was a single `UPDATE ... FROM (SELECT ...)` that took an exclusive lock on a summary table the application's hot read path also wanted. In the new fixture, that read path piled up behind the lock and the integration test that asserted "homepage renders in under 500ms" started timing out.

Nothing about the application logic was wrong, in the sense that no query was incorrect and no constraint was violated. The bug was the assumption baked into the comment. The fix was either to move the cron (the team chose `0 9 * * *` UTC, which is 02:00 Pacific and actually low-traffic for their user base) or to drop the exclusive lock (a longer refactor they took on later). The point for this post is that the test suite could not have flagged the issue without a fixture whose timestamps clustered the way production's did.

The catalog signal satus used to flag the columns participating in this bug:

```text
signal                                   how it fires
──────────────────────────────────────   ─────────────────────────────────
column type is timestamptz               pg_attribute.atttypid = 1184
column name matches event suffix         attname ~ '_(at|_on|_time)$'
column is the partition key of a         pg_partitioned_table.partattrs
  range-partitioned parent                 includes this column
column appears in a daily index           covering index whose first key
  (`(date_trunc('day', col))`)             is `date_trunc('day', col)`
```

Any one of the first two is enough to switch the sampler on. The last two raise the weight of the clustering; if the table is partitioned by day, satus also makes sure the seed data spans enough partitions to exercise constraint exclusion in the planner.

## Bug 2: `date_trunc('day', ts)` in the wrong timezone

The schema was an analytics application with a "today" dashboard. The relevant query was, paraphrased:

```sql
SELECT count(*) AS events_today
FROM events
WHERE date_trunc('day', occurred_at) = date_trunc('day', now());
```

`occurred_at` was `timestamptz`. The cluster ran in UTC. Most users were on the US East coast. Under uniform seed data the test "events_today returns the count of today's events" passed reliably, because uniformity hides the failure mode: with events spread evenly across the day, the count for the current UTC day and the count for the current local day differ by a small constant ratio, and the assertion was a range check.

Under business-hours-clustered seed data on a New York profile, the failure mode showed up immediately. New York business hours are 09:00 to 17:00 Eastern, which is 13:00 to 21:00 UTC during EST and 13:00 to 21:00 (offset by one) under EDT. Most events landed comfortably inside a single UTC day. But the evening ramp (17:00–20:00 Eastern, roughly 21:00–00:00 UTC under EST and 21:00–00:00 shifted forward an hour under EDT) regularly pushed events past UTC midnight. The dashboard, rendered on a developer machine running in `America/New_York`, asked for "today" in local time and got back a `date_trunc` computed in UTC. A meaningful slice of the late-day events was silently filed under "tomorrow" from the user's perspective. The assertion that "events_today is non-zero at 09:30 local" broke intermittently in CI, on exactly the days the seeded clusters happened to land late enough.

`date_trunc` has had a three-argument form that takes a target timezone since Postgres 12 ([PostgreSQL: date_trunc](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-TRUNC)). The query the team landed on was:

```sql
SELECT count(*) AS events_today
FROM events
WHERE date_trunc('day', occurred_at, 'America/New_York')
    = date_trunc('day', now(),       'America/New_York');
```

Identical structure, two extra arguments, behavior that matches the user's mental model of "today". The reason the bug never showed up in development was that the developer ran the dashboard from a browser in the same timezone as the server's idea of "today" only when both happened to be UTC, which is not the case on most laptops. The reason it never showed up in CI under uniform fixtures was that uniformity averages the failure away.

The catalog signal here is weaker than for bug 1, because nothing about the column declaration tells satus that a downstream query will call `date_trunc` without a timezone argument. What satus does instead is, during `satus plan`, scan the schema for views, materialized views, and stored functions that reference `timestamptz` columns and call `date_trunc` with two arguments. When it finds them, it prints a planner note:

```text
satus plan: view `public.events_daily` calls
  date_trunc('day', occurred_at)
  on a timestamptz column without a timezone argument.
  Seed data clusters around business hours in the
  saas-subscriptions profile (America/Los_Angeles), which
  will produce events whose UTC date differs from their
  local date. If your dashboard reads this view, the count
  will not match the user's "today".
```

We do not fix the query; that is the application's call. We do make sure the test suite has the inputs that would have caught the disagreement.

## Bug 3: DST gaps in `timestamp without time zone`

The schema was a medical-booking application with an `appointments` table. The `scheduled_for` column was declared `timestamp without time zone`, which is unfortunately common in calendar-shaped schemas because the developer intent was *"this appointment is at 9am wall-clock time on this date, regardless of what UTC thinks"*. A `timestamp without time zone` value is stored as a literal wall-clock date and time with no timezone attached; Postgres has no record of which zone the writer meant, so any later `AT TIME ZONE` conversion is purely a guess on the application's part. This is the well-known footgun documented in [Date/Time Types](https://www.postgresql.org/docs/current/datatype-datetime.html#DATATYPE-TIMEZONES) and called out in the Postgres wiki's [Don't Do This](https://wiki.postgresql.org/wiki/Don%27t_Do_This#Don.27t_use_timestamp_.28without_time_zone.29) list.

Under uniform random timestamps drawn from a 90-day window, the test suite seeded thousands of appointments and almost never produced one that landed on a DST transition. Each year has exactly one spring-forward instant per zone where a one-hour wall-clock interval does not exist, and one fall-back instant where a one-hour interval exists twice; both are vanishingly small targets for a uniform sampler whose window may not even contain the relevant Sunday. CI passed on the runs that missed and failed inscrutably on the rare runs that did not.

The `medical-booking` profile in satus does two things differently. First, it clusters appointment times on the hour and half-hour during business hours, because that is what booking systems actually do. Second, it shifts the date window deliberately to span the most recent spring-forward Sunday and the most recent fall-back Sunday in the profile's timezone (`America/New_York` by default). The result is that every test run sees a handful of appointments declared for `2026-03-08 02:30`—a wall-clock time that does not exist in Eastern time, because the clocks jumped from 01:59 to 03:00—and a handful declared for `2026-11-01 01:30`, which exists twice.

The bug surfaced in two places:

- The `INSERT` itself succeeded, because `timestamp` columns do not validate against any timezone. The string was parsed as a literal wall-clock value and stored.
- A downstream report that converted the column to UTC for export, using `scheduled_for AT TIME ZONE 'America/New_York'`, returned a duplicate row for the fall-back ambiguous time (the conversion picked the first occurrence) and a row shifted forward by an hour for the spring-forward non-existent time. The team's reconciliation script, which compared the export against the source table by exact instant, refused to reconcile and paged on-call.

The team's fix was to migrate the column to `timestamptz` and store the user's intended UTC instant at booking time, computed from the user's selected zone. This is the correct fix and also the one the Postgres documentation has been recommending for over a decade. It is not always available—some teams have application code that depends on the wall-clock semantics and cannot be rewritten on the schedule the bug demands—and in those cases the secondary fix is to add a `CHECK` constraint that uses [`pg_timezone_names`](https://www.postgresql.org/docs/current/view-pg-timezone-names.html) and an explicit conversion to validate that the stored value is not in a gap or ambiguity window for the relevant zone. Either way, the test suite needed fixtures that actually contained DST-edge values, and that is what the seeded data delivered.

Catalog signal:

```text
column type = timestamp without time zone   pg_attribute.atttypid = 1114
column name matches calendar suffix         attname ~ '(scheduled|due|
                                              starts|ends|booked|expires)'
profile has a timezone declared             profile.tz is set
```

When all three fire, the `medical-booking` and `appointments`-shaped profiles bias the seed window to include both DST transitions in `profile.tz` for the current year. The biasing is a single multiplier on the date sampler; it does not affect the hour distribution.

## What this is not

This is not a claim that seeded data substitutes for production traffic. It does not, and we will not pretend otherwise. The bugs above are reproducible because they are *structural*: they depend on the shape of the distribution, not its absolute volume. A fixture with the right shape and a thousand rows surfaces them. A fixture with the wrong shape and a billion rows will not.

The bugs we cannot reproduce with seeded data, and where load testing or shadow traffic is still the right answer, look different. They depend on absolute throughput (a query that is fine at 100 QPS and falls over at 10,000), on adversarial inputs we did not think to seed, on race conditions across processes the test harness only runs one of, or on data volumes that change which index the planner picks. We try to be honest about this in [the quickstart](/quickstart): satus generates fixtures that look like production-shaped data, not fixtures that *are* production data.

Within that scope, timezone bugs are an unusually good fit. They are deterministic given the input distribution, they almost always fail loudly once they fail, and the catalog signals are clean enough that satus can flag them without guessing. The three above are the ones we have seen most often. There are others—index hot spots that move across a daily cycle, partition pruning that breaks when the day boundary in the partition key disagrees with the day boundary in the query, materialized views refreshed on a schedule that races a write window—and they all have the same general shape: a uniform fixture would not have surfaced them.

## Where this fits in satus

The business-hours sampler is on by default for every built-in profile. The detector for bug 2 (`date_trunc` without a timezone argument) runs as part of `satus plan` and prints to stdout; it does not fail the run. The DST-window biasing for bug 3 is enabled in the `medical-booking` profile and disabled elsewhere, with a per-profile knob to turn it on:

```text
# in your profile YAML
timestamps:
  sampler: business_hours        # default for new profiles
  timezone: America/Denver       # overrides profile default
  dst_edges: include             # bias the window to span transitions
```

The dry-run planner ([quickstart](/quickstart)) prints the resolved sampler for every `timestamptz` and `timestamp` column it generates, so you can see what shape the fixture will have before you run it against your database.

## The shorter version

A uniformly random fixture is statistically smooth and operationally inert: it cannot show you the bugs whose existence depends on traffic clustering around real hours, because it has no such clustering. Business-hours-shaped fixtures surface a small, recurring set of timezone bugs that production has and CI does not. Three of them—a cron scheduled "during low traffic" that is actually peak local traffic, a `date_trunc` that disagrees with the user's "today", and an appointments table that quietly accepts non-existent DST-gap times—are common enough that satus's default profiles bias toward producing the input that reveals them. The catalog has enough signal to know which columns need the special treatment; the application has to do the rest.

## References

- PostgreSQL documentation, [Date/Time Types](https://www.postgresql.org/docs/current/datatype-datetime.html) and [Date/Time Functions](https://www.postgresql.org/docs/current/functions-datetime.html), especially [`date_trunc`](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-TRUNC) and [`AT TIME ZONE`](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-ZONECONVERT).
- PostgreSQL documentation, [`pg_timezone_names`](https://www.postgresql.org/docs/current/view-pg-timezone-names.html).
- PostgreSQL wiki, [Don't Do This—timestamp without time zone](https://wiki.postgresql.org/wiki/Don%27t_Do_This#Don.27t_use_timestamp_.28without_time_zone.29).
- IANA, [Time Zone Database](https://www.iana.org/time-zones), the source Postgres ships its zone rules from.
- `pg_cron`, [README](https://github.com/citusdata/pg_cron), for the cron-window scheduling semantics referenced in bug 1.
- Earlier in this log: [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild), [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question), [The CITEXT trap in Postgres unique indexes](/blog/the-citext-trap).
- The corpus underlying satus's structural detectors: [`corpus/audit-2026-06-01.json`](https://satus.sh/corpus/audit-2026-06-01.json) (5 schemas, 151 tables, 1,095 columns, 227 FKs, Postgres 17).
- See also: [satus profiles](/profiles), [quickstart](/quickstart).

—the satus.sh team
