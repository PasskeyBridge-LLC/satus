---
slug: when-faker-is-the-wrong-answer
title: "When faker.js is exactly the wrong answer"
description: faker.js generates 10,000 plausible names. It does not generate 10,000 names whose foreign keys resolve. The gap between fake values and seed data.
date: 2026-06-18
author: satus.sh
tags: [tooling, faker, postgres, seeding, philosophy]
draft: false
---

[faker.js](https://fakerjs.dev/) is a good library. It is also the wrong tool for most of the work people reach for it to do. The community-maintained fork at [@faker-js/faker](https://github.com/faker-js/faker) (currently 10.5.0) is excellent at the thing it advertises: producing realistic-looking values, one at a time, with locale awareness and a wide vocabulary. It is not, and has never tried to be, a tool that understands a database schema. The mismatch between what faker does and what "seed data" usually means is the reason a function call that returns a perfectly good string can still land you in a `ForeignKeyViolation` on the next line.

This post is the long version of a sentence we keep writing on support tickets: faker generates *values*; seed data is about *rows that satisfy a schema*. Both are useful. They are not interchangeable.

## What faker actually is

faker is a value generator. You ask it for a first name, you get back a first name. You ask for a hundred email addresses, you get back a hundred email addresses, each one independently sampled from a vocabulary and a template. The API surface is organised by category, well documented, and impressively localised: [`faker.person.firstName()`](https://fakerjs.dev/api/person.html#firstname), [`faker.location.city()`](https://fakerjs.dev/api/location.html#city), [`faker.commerce.product()`](https://fakerjs.dev/api/commerce.html), and so on. There are 70+ locales. The randomness is seedable. The bundle is small enough to drop into a frontend test.

What faker explicitly does *not* model:

- which table a value belongs to,
- which column of that table it should satisfy,
- whether it is unique within that column,
- whether it is consistent with other values in the same row,
- whether it resolves to a row in some other table.

None of that is a bug. The library's stated purpose, repeated in its own docs, is "generate massive amounts of fake (but reasonable) data for testing and development." It delivers exactly that.

## Where faker stops being enough

The mismatch shows up the moment you move from "fake value" to "row a real database will accept". Five places, in roughly increasing order of pain.

### 1. Foreign keys

faker has no notion of a foreign key, because faker has no notion of another table. If your `orders` table has a `customer_id` column that references `customers.id`, no `faker.string.uuid()` call will produce an ID that exists in `customers`. The standard workaround is to insert customers first, hold their IDs in an array, and pick from that array when generating orders. This works for two tables. It does not scale to a real schema, where the FK graph is a DAG (and sometimes a [cyclic one](/blog/cyclic-fks-in-the-wild)), and the right order to insert tables is something you have to compute, not guess.

The corpus we audit for our test fixtures (described in [Inside the e-commerce profile](/blog/ecommerce-profile)) currently has 5 schemas, 151 tables, and 227 foreign keys across them. A hand-rolled faker script that has to keep ID arrays for each parent table, in topological order, is implementing a topological sort and a referential-integrity layer in user code. That is the job, not a detail.

### 2. Uniqueness

faker.js used to ship a `faker.helpers.unique()` wrapper. It was deprecated in [issue #1785](https://github.com/faker-js/faker/issues/1785) and [removed in v8.0.0](https://github.com/faker-js/faker/releases/tag/v8.0.0) for reasons the maintainers spelled out clearly: it could not promise uniqueness across processes, it leaked memory because it had to remember every prior call, and it would silently fall back to throwing or to long retry loops as the value space ran out. The replacement guidance is "use `faker.helpers.uniqueArray()` if you need a batch, or roll your own set". Both are correct, neither is the same as "generate 100,000 rows whose `email` column will satisfy a unique constraint and whose `(tenant_id, slug)` composite will too".

A `UNIQUE` constraint is a schema-level fact. Enforcing it requires the generator to know the column exists, know what other values it has already produced, and either reject duplicates or sample without replacement. faker does not see the column.

### 3. Within-row correlations

The most quietly broken faker output is a row where each cell is individually plausible and the row as a whole is impossible. The textbook case is an address:

```ts
{
  street:   faker.location.streetAddress(),  // "412 Oak Lane"
  city:     faker.location.city(),           // "Springfield"
  state:    faker.location.state(),          // "Oregon"
  postcode: faker.location.zipCode(),        // "30318"
  country:  faker.location.country(),        // "Norway"
}
```

Every field is a real value. The row is geographic nonsense: a Norwegian country code, an Oregonian state, and an Atlanta ZIP. If your application validates the address on read, the test fails. If it doesn't, you ship a feature with quietly broken addresses in dev and discover the validation gap in production.

The same issue recurs everywhere. `first_name = "Yuki"` with `email = "john@example.com"`. `birth_date = 1947-03-12` with `age = 24`. `currency = "JPY"` with `amount = 12.99`. faker has no row-level context, so it cannot keep the cells consistent. The fix in faker user code is to pass correlating options where the API supports them (`faker.location.zipCode({ state })` is one of the few), then build the rest of the address by hand. Done table by table, this is the bulk of the code in a real faker-based seeder.

### 4. Distributions across rows

`faker.commerce.price({ min: 1, max: 1000 })` samples uniformly. Real prices are not uniform; they cluster, they have modes at .99 and .95, and they have a long tail. `faker.date.between({ from, to })` samples uniformly. Real timestamps cluster around business hours, drop on weekends, and respect holidays ([the long version](/blog/timezone-bugs-found-by-seed-data)). `faker.number.int({ min: 0, max: 100 })` for an order's line count produces a flat histogram; real basket sizes are roughly geometric with a heavy peak at 1.

A test fixture sampled uniformly will exercise the equally-likely paths through the application equally often. A production-shaped fixture will exercise the paths that exist in production. The performance regression that only shows up when 70% of rows hit one partition does not show up in a uniform fixture. Neither does the off-by-one in the "first order discount" code path, because in a uniform fixture half of all customers have placed exactly fifty orders.

### 5. Constraints the database actually enforces

`NOT NULL`, `CHECK`, `EXCLUDE`, partial indexes, generated columns, domain constraints. None of these are visible to faker, because faker is not looking at the schema. We covered the CHECK case at length in [Check constraints that lie](/blog/check-constraints-that-lie); the short version is that a generator that does not read `pg_constraint` will produce rows the database rejects, and a generator that reads `pg_constraint` is no longer faker.

The nullable-vs-not-nullable case is its own essay: see [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question). The partitioning case is in [Partitioned tables meet RLS](/blog/partitioned-tables-meet-rls). Each one is a place where a faker user ends up writing schema-aware code around a schema-unaware library.

## Two problems, not one

The cleanest way to think about it is that there are two distinct problems hiding under the phrase "test data".

| Problem | Right tool | Wrong tool |
| --- | --- | --- |
| "I need a plausible string for this one field in this one form" | faker (or a one-line literal) | a schema-aware seeder |
| "I need N rows that satisfy a schema, with FKs, uniques, distributions, and constraints" | a schema-aware seeder | faker plus 2,000 lines of glue |

Both problems are legitimate. The first is faker's home turf and it is excellent there. The second is what `satus` is for and what people are doing, painfully, when they reach for faker and end up reimplementing topological sort, unique-set tracking, distribution sampling, and constraint introspection on top of it.

A useful sanity check: if your faker code imports `pg`, parses `information_schema`, or maintains a `Map<tableName, Set<id>>`, you have stopped using a value generator and started writing a seeder. That is the moment to either commit to the seeder (and accept that you will own a small framework) or to use a tool whose first-class object is a schema.

## What this means for satus

We use faker internally, in exactly one place: as a fallback dictionary for value categories the LLM does not need to think about. `first_name` for a US-locale person column is faker; the LLM never sees it, because there is nothing interesting to decide. The interesting decisions, the ones that make a fixture look like production rather than like a synthetic-data demo, happen above faker:

- which tables to fill first, derived from the FK graph,
- how many rows per table, derived from row-count hints and the profile's parent/child ratios,
- which values must be unique and which can repeat, derived from the index definitions,
- which distributions to draw from, derived from the profile,
- which constraints constrain the sampler vs which are advisory, derived from `pg_constraint` and the rules in [Check constraints that lie](/blog/check-constraints-that-lie),
- which rows must be consistent with which other cells in the same row, derived from the profile's correlation hints.

faker provides one of those: dictionaries. Everything else is the actual product. We are happy to recommend faker for the cases where dictionaries are all you need, and equally happy to point out that almost no production-shaped fixture is one of those cases.

## When faker is the right answer

To keep this from reading as a takedown, the cases where faker is the right answer and nothing else is needed:

- A single Storybook story that needs one realistic user object.
- A frontend unit test that needs a list of fake comments and does not care whether they reference a real post ID.
- A demo screenshot generator that writes a JSON file, not a database.
- A property-based test that needs varied strings as inputs to a pure function.
- A locale-aware placeholder generator for an empty-state UI.

In each case the problem is "give me a plausible value", not "give me a row that satisfies a schema". faker is well-engineered for the first; it has never claimed to be for the second.

## The shorter version

faker generates values; databases enforce schemas. The work of going from "values" to "rows a schema accepts" is not a thin wrapper; it is most of the code in any seeder that handles a non-trivial schema. If you reach for faker and find yourself writing a referential-integrity layer, a uniqueness tracker, a distribution sampler, and a constraint introspector around it, the library is not failing you. You have outgrown the problem it solves.

`satus generate --schema public` against your real database is the fastest way to see the difference: faker would need 200 lines of glue to insert the first 100 rows; the seeder writes them in one command because the schema is its input, not an afterthought. The [/quickstart](/quickstart) walks through it; the [/profiles](/profiles) page lists the built-in distribution profiles for verticals where uniform sampling is most obviously wrong.

## References

- [@faker-js/faker on GitHub](https://github.com/faker-js/faker) and [docs](https://fakerjs.dev/), maintained fork of the original `faker.js`.
- faker.js issue [#1785](https://github.com/faker-js/faker/issues/1785), "Deprecate helpers.unique for removal".
- faker.js release [v8.0.0](https://github.com/faker-js/faker/releases/tag/v8.0.0), notes removing `helpers.unique`.
- PostgreSQL documentation, [INSERT](https://www.postgresql.org/docs/current/sql-insert.html), [COPY](https://www.postgresql.org/docs/current/sql-copy.html), [CHECK constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).
