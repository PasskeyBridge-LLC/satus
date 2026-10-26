---
slug: medical-booking-profile
title: "Inside the medical-booking profile: why appointments are harder than they seem"
seoTitle: The satus medical-booking profile: appointments and no-shows
description: Appointments cluster mid-morning and afternoon, almost never on holidays, with a long tail of no-shows. What the satus medical-booking profile encodes, and why.
date: 2026-05-28
author: satus.sh
tags: [profile, medical, distributions, postgres, seeding]
draft: false
---

> **Editor's note (2026-07-16):** This post describes profile-system design intent from spring 2026. The shipped CLI (v0.3.5) uses simpler prompt-based profiles — `saas`, `ecommerce`, `b2b` — with no YAML profile files, no `satus profile show`, and no separate `satus plan` subcommand (use `satus generate --dry-run`). See [/profiles](/profiles) for the current behavior. The post is preserved as-is for its schema-modeling arguments; treat the CLI ergonomics described here as design notes, not current commands.



Appointment data looks easy and isn't. A uniformly random `timestamptz` between two dates will pass every NOT NULL constraint, every foreign key, and almost every CHECK clause your schema has, and it will still produce a fixture that no real clinic could ever generate. Appointments cluster around mid-morning and just-after-lunch, collapse at night, never happen on public holidays, and trail a long, lopsided distribution of cancellations, reschedules, and no-shows. If your tests, dashboards, or planner statistics depend on those shapes, uniformly random data is silently wrong. The `medical-booking` profile in [satus](/) is the choices we made about which of those shapes to encode and which to push back on the user. This post is the inventory.

We will cover three things: the distributions baked into the profile, the constraints we generate to keep them honest, and the things we deliberately chose not to model. The post assumes you have read [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild) and [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question), because the profile leans on both ideas.

## Why "realistic" is the whole job

A schema-aware seeder has two failure modes. It can violate the schema, which the database catches loudly, or it can satisfy the schema with data that no production system would produce, which nothing catches until a customer reports a strange dashboard. The second failure mode is the one that motivates profiles at all. The `medical-booking` profile exists because half a dozen early users were patching the same five things by hand on top of generic seed output: business hours, weekends, holidays, no-show ratios, and the ordering of timestamps within a single appointment.

A useful starting reference for how skewed real appointment behaviour is comes from the published literature on outpatient no-shows. Reported rates vary widely by specialty, setting, and country, and a published systematic review of the field is the most defensible starting point ([Dantas et al., 2018, "No-shows in appointment scheduling – a systematic literature review", *Health Policy* 122(4):412–421, PubMed 29482948](https://pubmed.ncbi.nlm.nih.gov/29482948/)). The exact rate is not the point. The point is that any fixture that treats `status = 'no_show'` as a 1%-of-rows curiosity will hide problems in code paths that, in production, fire constantly.

## What the profile actually encodes

The profile is a YAML document the CLI reads at planning time. The fields below are the ones that matter for an appointments-shaped table; the full file ships with the binary and is dumped by `satus profile show medical-booking`. Distributions are intentionally coarse, not parameter-rich, because we would rather ship one defensible curve than a knob the user has to tune.

| Shape | Encoded as | Default | Notes |
| --- | --- | --- | --- |
| Business hours | bimodal triangular over local time | peaks 10:00 and 14:00, floor 08:00, ceiling 18:00 | local to the row's clinic time zone, not UTC |
| Day of week | weighted per-day multiplier | Mon–Fri 1.0, Sat 0.35, Sun 0.05 | Sat/Sun shaped by ambulatory-care patterns, not 0 |
| Holidays | calendar-driven mask | US federal + configurable list | clinic time zone, not seeder host |
| Appointment length | discrete distribution | 15m 0.55, 30m 0.30, 45m 0.10, 60m 0.05 | snapped to 5-minute grid |
| Status | weighted categorical | scheduled 0.62, completed 0.20, no_show 0.10, cancelled 0.07, rescheduled 0.01 | tunable per profile run |
| Lead time | log-normal in days | median ≈ 8d, p95 ≈ 45d | clipped at the schema's CHECK if present |
| Per-provider load | Zipf-like over provider IDs | top provider ~3× the median | so query planners see realistic skew |

The "status" row is the one users override most. Our default mix sits inside the literature's range, but a teledermatology clinic and a paediatric ER do not have the same mix, and we make no claim that ours is the right one for either. A two-line override in the profile lets you swap it.

```text
status:
  weights:
    scheduled:   0.50
    completed:   0.30
    no_show:     0.05
    cancelled:   0.13
    rescheduled: 0.02
```

A quick visualisation of the default appointment-time distribution within a weekday, sampled at 30-minute buckets:

```text
appointments per 30-min bucket, weekday, defaults
08:00 ███
08:30 █████
09:00 ████████
09:30 ███████████
10:00 ██████████████   ← morning peak
10:30 █████████████
11:00 ███████████
11:30 ████████
12:00 ████             ← lunch dip
12:30 █████
13:00 ████████
13:30 ████████████
14:00 ██████████████   ← afternoon peak
14:30 █████████████
15:00 ██████████
15:30 ████████
16:00 ██████
16:30 ████
17:00 ██
17:30 █
```

Two peaks, a midday dip, and zero coverage outside the local business window. Uniform random gives you a flat line at every bucket, including 03:00 on a Sunday.

## Time zones, which are where this gets hard

The single largest source of bad appointment fixtures is treating `timestamptz` as if it were a wall-clock time. Postgres stores `timestamptz` as UTC and converts on read using the session's `TimeZone` setting ([PostgreSQL documentation: Date/Time Types](https://www.postgresql.org/docs/current/datatype-datetime.html)). A naive seeder that samples "between 09:00 and 17:00" in the seeder's own time zone will produce 02:00 appointments for a clinic in Honolulu and 22:00 appointments for one in Auckland. Both pass the schema.

The profile takes the clinic's time zone from a configurable column path (default: `clinics.tz`, IANA name such as `America/Los_Angeles`) and samples the local hour in that zone, then converts to UTC for storage. If the column is missing, we degrade to the database's `current_setting('TimeZone')` and print a warning at plan time. The IANA Time Zone Database ([iana.org/time-zones](https://www.iana.org/time-zones)) is the canonical source we round-trip against; for Postgres specifics the `pg_timezone_names` catalogue is the practical surface ([PostgreSQL documentation: pg_timezone_names](https://www.postgresql.org/docs/current/view-pg-timezone-names.html)).

Holidays are the same problem in a different costume. A US clinic's calendar is not a Brazilian clinic's calendar. The profile ships with US federal holidays as the default mask because we had to ship something, and exposes a `holiday_calendar` field that accepts either an ISO country code (resolved against a bundled list compiled from publicly documented sources) or an explicit array of `YYYY-MM-DD` dates. We do not pretend to know your clinic's observed holidays. We do refuse to generate a fixture full of appointments on Christmas Day unless you ask.

## Constraints we recommend, and sometimes generate

The profile is more useful when the schema has constraints that match its shape, because the constraints catch the cases the profile alone cannot. Two we lean on heavily:

```sql
-- 1. No appointment can end before it starts.
ALTER TABLE appointments
  ADD CONSTRAINT appt_time_ordered
  CHECK (ends_at > starts_at);

-- 2. A given provider cannot be double-booked.
-- Requires the btree_gist extension.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments
  ADD CONSTRAINT appt_no_overlap
  EXCLUDE USING gist (
    provider_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  );
```

The first is a plain `CHECK` and we always honour it. The second is an `EXCLUDE` constraint built on `tstzrange` and a GiST index, which is the canonical Postgres pattern for non-overlapping time ranges ([PostgreSQL documentation: EXCLUDE constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-EXCLUSION), [btree_gist](https://www.postgresql.org/docs/current/btree-gist.html)). Most appointment schemas we see do not have it; about a quarter that do have it had silently violating rows before they added it. When the constraint is present, `satus` switches from "sample and hope" to a retry-with-jitter strategy that keeps each provider's appointments disjoint. When the constraint is absent we still try, because two overlapping appointments for the same surgeon is a fixture nobody wants to debug.

## Status transitions and the per-row timestamp chain

A single appointment row in most schemas carries several timestamps that have to occur in the right order: `created_at`, `scheduled_for`, `checked_in_at`, `seen_at`, `discharged_at`, and sometimes `cancelled_at` or `no_show_marked_at`. The profile encodes the implicit state machine so that, for a row whose terminal status is `completed`, the timestamps satisfy:

```text
created_at  ≤  scheduled_for          (booked before the slot)
checked_in_at  ≤  scheduled_for + 15m (most patients arrive on time)
checked_in_at  ≤  seen_at             (you wait, then you are seen)
seen_at        ≤  discharged_at       (the visit ends after it starts)
```

For terminal `no_show`, `checked_in_at`, `seen_at`, and `discharged_at` stay NULL — which is the case discussed at length in [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question), and is exactly why the `medical-booking` profile has more state-flag columns than the other two built-in profiles.

A quick reminder of where that lands across profiles, from the table in that earlier post:

| Profile | State-flag columns hit | Median `frac_null` | Range |
| --- | --- | --- | --- |
| saas-subscriptions | 12 | 0.97 | 0.90 – 0.995 |
| medical-booking | 7 | 0.94 | 0.85 – 0.99 |
| ecommerce | 9 | 0.96 | 0.88 – 0.99 |

`medical-booking` has the lowest median because more of its state-flag timestamps are actually populated in the common case (a completed visit fills three of them), not because the heuristic is weaker.

## What the profile deliberately does not encode

We get asked for these regularly and have, so far, declined to ship them. The reasons matter more than the list.

- **Patient names, addresses, or demographics tied to real distributions.** We seed names from a generic multilingual pool and explicitly do not vary them by clinic location. Geographic name distributions are real but using them in a default profile risks producing fixtures that look like a particular real population, which is the opposite of what de-identification expects under, for example, the HIPAA Privacy Rule's Safe Harbor method ([45 CFR §164.514(b)(2)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.514#p-164.514(b)(2))). Synthetic data is not protected health information; we still see no reason to generate data that mimics a specific cohort by default.
- **Diagnoses, ICD-10 codes, medications.** We will fill an `icd10` column with codes that pass format validation (one letter, two digits, optional decimal and subcode) but we do not weight them by epidemiology. A fixture that says 4% of all encounters are myocardial infarctions is wrong in a way that is worse than obviously fake. ICD-10-CM is published by the CDC's National Center for Health Statistics ([NCHS ICD-10-CM](https://www.cdc.gov/nchs/icd/icd-10-cm/index.html)); using it as a vocabulary is fine, sampling it as a distribution is a research project.
- **Insurance, billing codes, claims lifecycles.** Out of scope for v1. Plausibly a future `medical-billing` profile if enough users ask for it.
- **PHI-shaped free text.** Notes, complaint fields, and discharge summaries are filled with neutral lorem-ipsum-style strings, not LLM-generated prose that looks like a clinical note. The risk of an indistinguishable-from-real note ending up in a screenshot or a public bug report is, in our view, not worth the realism.

None of these are technically hard. They are choices about what a default profile should look like. A user who needs any of them can override the relevant column in their own profile file. We will help. We will not ship them on by default.

## How to inspect what you are getting

Two commands cover most questions:

```bash
# Dump the resolved profile (defaults + your overrides) as JSON
satus profile show medical-booking --resolved

# Plan a run without writing rows; prints the distribution
# satus will sample from for every column it touches
satus plan --profile medical-booking --schema appointments
```

`satus plan` is the same dry-run planner mentioned in the last post; it now annotates each appointments column with the distribution name, the parameters, and the source (default, profile override, or schema-derived). If a number in your fixture looks wrong, the plan output is where to look first.

## The shorter version

A medical-booking profile is mostly a list of opinions about time. The opinions are: clinics open in the morning and close in the evening; weekends are quieter, not empty; holidays exist; appointments cluster; some never happen; time zones belong to clinics, not to seeders; and the timestamps inside a single appointment row are ordered. Encoding those opinions turns out to be much more of the value than any single distribution, because almost any sane curve over the right local window beats a uniform curve over the wrong one.

If you are seeding a clinic-shaped schema and the default profile is wrong for your setting, override the bits that matter and leave the rest. If you want a profile we do not yet ship, the [/profiles](/profiles) page lists the three built-ins, the [/quickstart](/quickstart) shows how to point the CLI at your schema, and the [/recipes](/recipes) page has a worked example of a profile override.

## References

- Dantas, L. F., Fleck, J. L., Cyrino Oliveira, F. L., Hamacher, S. (2018), "No-shows in appointment scheduling – a systematic literature review", *Health Policy* 122(4):412–421. [PubMed entry](https://pubmed.ncbi.nlm.nih.gov/29482948/).
- PostgreSQL documentation, [Date/Time Types](https://www.postgresql.org/docs/current/datatype-datetime.html).
- PostgreSQL documentation, [pg_timezone_names](https://www.postgresql.org/docs/current/view-pg-timezone-names.html).
- PostgreSQL documentation, [EXCLUDE constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-EXCLUSION).
- PostgreSQL documentation, [btree_gist extension](https://www.postgresql.org/docs/current/btree-gist.html).
- IANA, [Time Zone Database](https://www.iana.org/time-zones).
- US Department of Health and Human Services, [45 CFR §164.514(b)(2), HIPAA Safe Harbor de-identification](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.514#p-164.514(b)(2)).
- CDC National Center for Health Statistics, [ICD-10-CM](https://www.cdc.gov/nchs/icd/icd-10-cm/index.html).
- Earlier in this log: [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild), [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question), [Introducing the satus log](/blog/introducing-the-log).

—the satus.sh team
