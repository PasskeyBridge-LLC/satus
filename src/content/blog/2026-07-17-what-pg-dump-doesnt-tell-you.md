---
slug: what-pg-dump-doesnt-tell-you
title: "What pg_dump doesn't tell you about your own schema"
description: pg_dump is a backup tool, not a schema description. Three things it omits or reorders, and why a seeder should read pg_catalog directly instead.
date: 2026-07-17
author: satus.sh
tags: [postgres, introspection, pg_dump]
draft: false
---

> **Correction (2026-10-05).** As published, this post said satus reads planner statistics from `pg_stats`, enumerates extension-owned objects through `pg_extension` and `pg_depend`, and reads indexes from `pg_index` and `CHECK` constraints from `pg_constraint`, and it linked a `satus plan` command. None of that is in the CLI. Checked against `packages/cli/src` in 0.3.11: introspection reads tables from `pg_class`, column types from `information_schema.columns`, and primary keys, foreign keys and single-column unique constraints from `pg_constraint`. There is no `plan` command; the dry run is `satus generate --dry-run`. The three "What we do instead" paragraphs and the closing link have been corrected to match. The worked example in section 3 was also corrected: it declared `UNIQUE (lower(email))`, which PostgreSQL rejects as a syntax error, and showed approximated `pg_dump` output. It now uses a unique expression index and a real `pg_dump` 17.11 transcript. Two claims about our own practice that could not be verified were removed: that we once treated `pg_dump --schema-only` output as ground truth, from the introduction and the section framing, and that we use `pg_dump` daily, from the closing section. The rest of the sections on `pg_dump` are unchanged.

`pg_dump` is the canonical way to serialise a Postgres database to a file, and for restoring a database that is precisely what it should do. It is not, and does not claim to be, a faithful description of your schema as the server sees it. A seeder that takes `pg_dump --schema-only` output as its description of a table goes wrong in three different ways, and each of the three is documented behaviour rather than a bug. This post names them, points at the [`pg_dump` reference](https://www.postgresql.org/docs/current/app-pgdump.html) for each, and describes what we read out of [`pg_catalog`](https://www.postgresql.org/docs/current/catalogs.html) instead.

## The short version

`pg_dump` produces a file that, when replayed, reconstructs the objects in one database. To do that reliably across major versions and across cyclic dependencies, it normalises what it emits. It omits planner statistics by default, it emits `CREATE EXTENSION` in place of the tables, types, and functions that the extension actually installed, and it hoists constraints and indexes into a post-data section so the DDL order in the file is not the DDL order you wrote. A schema-understanding tool has to look past the file at the catalogs, because the file is the restore plan, not the schema.

## What pg_dump is for, and what it isn't for

`pg_dump` reads a live server and writes a script (or a custom-format archive) that will recreate the same database elsewhere. The reference is explicit about scope: it dumps "a single database", it "does not dump roles or other database objects including tablespaces that are only present at the cluster level", and the emitted script is meant to be reloaded by `psql` or `pg_restore`. Everything the tool does is optimised for that. Used as an introspection source, it is a restore tool asked to describe a schema, and it answers honestly, in the vocabulary of a restore.

The tool we actually want is the catalog. `pg_class`, `pg_attribute`, `pg_attrdef`, `pg_constraint`, `pg_index`, `pg_depend`, `pg_statistic`: every fact `pg_dump` had to normalise is available there, unnormalised, in the form the planner and the executor themselves use. The three sections below walk through the specific facts that are lost by reading the dump instead of the catalog.

## 1. Planner statistics are omitted by default

The first surprise is the loudest. A seeder that wants to reproduce the shape of a production dataset needs to know, for each column, roughly what the distribution looks like: the most common values, the number of distinct values, the null fraction, a histogram. Postgres already computes all of that, stores it in `pg_statistic`, and exposes it through the `pg_stats` view. `ANALYZE` maintains it and the autovacuum daemon keeps it fresh; see [Updating Planner Statistics](https://www.postgresql.org/docs/current/routine-vacuuming.html#VACUUM-FOR-STATISTICS) in the manual.

`pg_dump` does not include any of it by default. The `--statistics` and `--no-statistics` flags exist, and the default is `--no-statistics`. The reference is unambiguous:

> Do not dump statistics. This is the default.

For a dump-and-restore workflow the default is correct, because `ANALYZE` on the restored database will produce fresher and more accurate statistics than the ones frozen into the dump would have been. For a workflow that wants to look at the shape of the data without pulling the data, the default is a wall.

Even with `--statistics` set, the reference names three categories the flag does not cover: user-defined `CREATE STATISTICS` objects that are extended-statistics rather than per-column, statistics added by extensions, and everything in the [cumulative statistics system](https://www.postgresql.org/docs/current/monitoring-stats.html) (`pg_stat_user_tables`, `pg_stat_all_indexes`, and the family). The `pg_dump` reference calls this out explicitly and recommends running `ANALYZE` after restore.

What we do instead. For statistics, nothing yet. `satus` does not read `pg_stats`: introspection covers tables, columns, primary keys, foreign keys, and single-column unique constraints, and value choices come from the selected profile (`saas`, `ecommerce`, or `b2b`) and the model. `pg_stats` is where a seeder would get the shape of production data without pulling the data, through `null_frac`, `n_distinct`, `most_common_vals`, `most_common_freqs`, and `histogram_bounds`. We wrote about the sampling side in [Picking distributions, not values](/blog/picking-distributions-not-values).

## 2. Extension member objects are hidden behind CREATE EXTENSION

The second surprise is quieter. When a database uses [`CREATE EXTENSION`](https://www.postgresql.org/docs/current/sql-createextension.html) to install a package like `citext`, `pg_trgm`, `postgis`, or `pgcrypto`, Postgres records every object the extension creates in `pg_depend` with a `deptype` of `'e'` (extension member). The extension owns those objects; a `DROP EXTENSION` removes them all together, and `pg_dump` respects that ownership.

The consequence is that `pg_dump` emits one line, `CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;`, in place of the several tables, types, operators, casts, and functions that `citext` actually installed. The extension's own SQL script, installed under `share/extension/`, is the source of truth for those objects; the dump does not repeat it. This is correct behaviour for a restore, because replaying `CREATE EXTENSION` on the target server will reproduce exactly the same objects at whatever version of the extension the target has installed. It is very wrong behaviour for an introspector, because a schema that uses `citext` for its case-insensitive columns, or `postgis` for its geometry columns, or `pg_trgm` for its trigram indexes, looks in the dump as if those columns and indexes are of types that the server has never heard of.

The related trap is version drift. A schema that was designed against `postgis` 3.3 can be replayed on a server that has `postgis` 3.5 installed, and the geometry types will resolve, but the exact set of operators and functions available will differ. `pg_dump` does not pin the extension version by default; the header records the extension name and the schema it lives in, and that is all. The [`CREATE EXTENSION`](https://www.postgresql.org/docs/current/sql-createextension.html) documentation covers the `VERSION` clause and its restore-time behaviour.

What we do instead. `satus` does not query `pg_extension` or `pg_depend`. It reads each column's type name (`udt_name`) from `information_schema.columns`, so a `citext` column arrives named as `citext`, with no `CREATE TABLE` text to parse. The row schema maps it to a string, which is also the fallback for any type the mapping does not recognise; a `geometry` column receives no special handling, and the other objects an extension installs are not enumerated. The [`citext` field guide](/blog/the-citext-trap) is the longer version of why this matters for a seeder specifically; the general point is that any schema that uses extensions has meaningful surface area that a `pg_dump` script cannot describe on its own.

## 3. Constraints and indexes are hoisted to a post-data section

The third surprise is a reordering, not an omission. `pg_dump` (and `pg_restore`) organise the output into three sections named `pre-data`, `data`, and `post-data`. The reference describes the split under the [`--section`](https://www.postgresql.org/docs/current/app-pgdump.html) flag: `pre-data` holds the object definitions "other than indexes, triggers, rules, and constraints other than validated check constraints", `data` holds the table contents, and `post-data` holds everything the split moved out of `pre-data`. This is what lets `pg_restore` load the data with indexes and triggers absent, then build the indexes and enable the triggers afterwards, which is much faster than loading into a fully-constrained schema.

For introspection this reordering means the `CREATE TABLE` you read in the dump is not the full definition of the table. Non-validated `CHECK` constraints, unique constraints backed by indexes, foreign keys, primary keys defined via an index, exclusion constraints, triggers, and rules are all in the post-data section, well below the `CREATE TABLE` they belong to, in `ALTER TABLE ... ADD CONSTRAINT` form. A regex over `CREATE TABLE` blocks will miss most of the relational structure of the schema. Foreign keys in particular are always hoisted, because they cannot be added until the referenced table exists, and cycles among referencing tables force the constraint to be added after all the tables are in place. We wrote about the cycle case specifically in [Cyclic FKs in the wild](/blog/cyclic-fks-in-the-wild); the reordering in the dump is a direct consequence.

A worked example makes the split obvious. This schema, written the way an engineer would type it:

```sql
CREATE TABLE customers (
  id    bigserial PRIMARY KEY,
  email text NOT NULL
);

CREATE UNIQUE INDEX customers_email_lower_unique ON customers (lower(email));

CREATE TABLE orders (
  id          bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id),
  total_cents integer NOT NULL CHECK (total_cents >= 0)
);

CREATE INDEX orders_customer_id_idx ON orders (customer_id);
```

comes back out of `pg_dump` 17.11 (PostgreSQL 17.11) as the file below. Nothing has been removed from it; `--no-owner` leaves out the ownership statements, and `--restrict-key` pins the `\restrict` key so that two runs print the same thing:

```text
$ pg_dump --schema-only --no-owner --restrict-key=example -d example
--
-- PostgreSQL database dump
--

\restrict example

-- Dumped from database version 17.11 (Debian 17.11-0+deb13u1)
-- Dumped by pg_dump version 17.11 (Debian 17.11-0+deb13u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id bigint NOT NULL,
    email text NOT NULL
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    total_cents integer NOT NULL,
    CONSTRAINT orders_total_cents_check CHECK ((total_cents >= 0))
);


--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: customers_email_lower_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_email_lower_unique ON public.customers USING btree (lower(email));


--
-- Name: orders_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_customer_id_idx ON public.orders USING btree (customer_id);


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- PostgreSQL database dump complete
--

\unrestrict example
```

Neither `CREATE TABLE` block, on its own, tells you that `customers.id` is a primary key, that `customers.email` is unique case-insensitively, that `orders.customer_id` has an index, or that it points at `customers.id`. All of that arrives near the end of the file, after the sequences and defaults, as `ALTER TABLE ... ADD CONSTRAINT` and `CREATE INDEX` statements. Apart from `NOT NULL`, the validated `CHECK` on `total_cents` is the only constraint the `CREATE TABLE` keeps inline, because validated `CHECK` constraints are the exception in the `--section` description quoted above.

What we do instead. `satus` builds the dependency graph from `pg_constraint` joined against `pg_attribute` and `pg_class`. Primary keys have `contype = 'p'`, single-column unique constraints have `contype = 'u'`, and foreign keys have `contype = 'f'` plus `confrelid` and `confkey` for the target. It does not read `pg_index`, so a bare `CREATE UNIQUE INDEX`, like `customers_email_lower_unique` above, is not seen, and `CHECK` constraints are not introspected yet. The topological order our DAG produces is derived from those foreign-key edges, not from the position of `ALTER TABLE ADD CONSTRAINT` statements in a file.

## What to read out of pg_catalog instead

For anyone starting from scratch, the smallest set of catalogs that gives you back what `pg_dump` normalised away is short:

| What you want                            | Where it actually lives                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Tables and their storage flags           | `pg_class` (`relkind`, `relpersistence`, `relispartition`)                           |
| Columns, types, nullability, defaults    | `pg_attribute` joined to `pg_type`; defaults in `pg_attrdef` via `pg_get_expr`       |
| Primary keys, unique, FK, CHECK, exclusion | `pg_constraint` filtered by `contype`; text via `pg_get_constraintdef`             |
| Indexes and their expressions            | `pg_index` joined to `pg_class`; `pg_get_indexdef` for the text                      |
| Partitions and partition keys            | `pg_inherits`, `pg_partitioned_table`                                                |
| Extension-owned objects                  | `pg_extension` joined to `pg_depend` on `deptype = 'e'`                              |
| Planner statistics                       | `pg_stats` (view over `pg_statistic`); `pg_stats_ext` for `CREATE STATISTICS`        |
| Object dependencies (for DAG order)      | `pg_depend`, `pg_constraint.confrelid`                                               |
| Row-level security                       | `pg_policy`; `pg_class.relrowsecurity` and `relforcerowsecurity`                     |

These are all documented in the [System Catalogs](https://www.postgresql.org/docs/current/catalogs.html) chapter, they are versioned with the server rather than with any client tool, and they answer the questions a seeder needs to ask about a table in one round trip per table. The [`pg_stats`](https://www.postgresql.org/docs/current/view-pg-stats.html) view is worth calling out specifically, because it is the one that closes the loop on the first section: it is how a tool that never touches production data can still reason about the shape of production data.

## Where this leaves pg_dump

`pg_dump` is the right tool for exactly what it was written for: capturing a database so it can be restored. Backups against production, seed captures for a staging environment that already has representative data, migrations across major Postgres versions, cluster moves. The three limitations above are the price of the guarantees the tool provides. It is a restore plan first, and a restore plan is not the same object as a schema description.

If you have been treating a `pg_dump --schema-only` file as the schema for tooling you are writing, start with the table above. For satus itself, `satus generate --dry-run` (see the [quickstart](/quickstart)) prints the plan it derives from the catalog, the tables in foreign-key order with a cost estimate and validation findings, and writes nothing. If the tooling you are writing is more general than a seeder, the sections here are the ones we would spend our own time re-reading; the catalog is small, well-named, and stable across releases in a way very little else in this ecosystem is.

## References

- PostgreSQL documentation, [`pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html).
- PostgreSQL documentation, [`CREATE EXTENSION`](https://www.postgresql.org/docs/current/sql-createextension.html).
- PostgreSQL documentation, [Updating Planner Statistics](https://www.postgresql.org/docs/current/routine-vacuuming.html#VACUUM-FOR-STATISTICS).
- PostgreSQL documentation, [System Catalogs](https://www.postgresql.org/docs/current/catalogs.html), including [`pg_class`](https://www.postgresql.org/docs/current/catalog-pg-class.html), [`pg_attribute`](https://www.postgresql.org/docs/current/catalog-pg-attribute.html), [`pg_constraint`](https://www.postgresql.org/docs/current/catalog-pg-constraint.html), [`pg_index`](https://www.postgresql.org/docs/current/catalog-pg-index.html), [`pg_depend`](https://www.postgresql.org/docs/current/catalog-pg-depend.html), and [`pg_extension`](https://www.postgresql.org/docs/current/catalog-pg-extension.html).
- PostgreSQL documentation, [`pg_stats`](https://www.postgresql.org/docs/current/view-pg-stats.html) and [Cumulative Statistics System](https://www.postgresql.org/docs/current/monitoring-stats.html).
