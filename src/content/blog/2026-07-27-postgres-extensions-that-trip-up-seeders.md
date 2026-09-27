---
slug: postgres-extensions-that-trip-up-seeders
title: "Postgres extensions that trip up seeders"
description: PostGIS wants valid geometries. pgvector wants meaningful embeddings. pgcrypto wants real ciphertext. None of the three accept random bytes.
date: 2026-07-27
author: satus.sh
tags: [postgres, extensions]
draft: false
---

Most Postgres columns will accept a syntactically-valid value and stop asking questions. A `text` column accepts any string. An `integer` column accepts any int in range. A `jsonb` column accepts any parseable JSON. This is why generic seeders, and generic type-driven fuzzers, look like they work on most schemas.

Then the schema loads a Postgres extension, and the shape of "valid" gets narrower. This post is about three extensions that show up regularly in the schemas we introspect—[PostGIS](https://postgis.net/), [pgvector](https://github.com/pgvector/pgvector), and [pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html)—and what breaks when a seeder treats their columns like ordinary `bytea` or `text`.

## PostGIS: valid geometries, not just bytes

PostGIS adds `geometry` and `geography` types that store spatial data in EWKB (extended well-known binary). The column definition can also carry a typmod that pins the geometry type and [SRID](https://postgis.net/docs/using_postgis_dbmanagement.html#spatial_ref_sys), for example `geometry(Point, 4326)`. A row that satisfies the column type still has to satisfy geometric validity: rings closed, no self-intersections for polygons, coordinates inside the declared SRID's usable range.

Three failure modes we see when a seeder drops random bytes into a PostGIS column:

- **Bytea passed as geometry** rejected at parse time. The column expects EWKB, not arbitrary bytes; the insert fails before any spatial check runs.
- **Wrong typmod.** The column is `geometry(Point, 4326)` and the seeder inserts a `LINESTRING`, or a `Point` in SRID 3857. Postgres raises "Geometry type does not match column type" or "Geometry SRID does not match column SRID."
- **Invalid geometry that parses.** A self-intersecting polygon or a ring that doesn't close will load, but downstream code that calls [`ST_IsValid`](https://postgis.net/docs/ST_IsValid.html) or any operator that assumes validity (area, contains, intersection) starts returning nonsense or throwing.

The right shape for a PostGIS seed row is: emit EWKT (well-known text with SRID prefix, e.g. `SRID=4326;POINT(-73.98 40.75)`) via [`ST_GeomFromEWKT`](https://postgis.net/docs/ST_GeomFromEWKT.html), match the column's declared geometry subtype and SRID exactly, and, for polygons, generate through a helper that closes rings and rejects self-intersections. satus reads the typmod during introspection and constrains generation accordingly; the extension is not treated as opaque bytes.

## pgvector: fixed dimension, and "valid" depends on what the column is for

pgvector adds a `vector(n)` type where `n` is a required, fixed dimension declared at column definition time. The [pgvector README](https://github.com/pgvector/pgvector#vector-type) is explicit that dimension is part of the type, and inserting a vector of a different length is a hard error. This is the first thing a naive seeder gets wrong: it emits `vector[384]` into a `vector(1536)` column and the insert rejects every row.

The second, subtler failure is that "valid" for a pgvector column depends on what the application does with it. Two cases we see:

- **Random vectors, ANN index present.** A random `vector(1536)` satisfies the type and inserts fine. Building an [HNSW or IVFFlat index](https://github.com/pgvector/pgvector#indexing) on top of random vectors also succeeds. Nearest-neighbor queries then return technically-correct but semantically-meaningless results, because random points in a 1536-dimensional space have effectively uniform pairwise distances. Recall metrics computed against this seed data are noise. If the seed is only there to make the dashboard render row counts, this is fine. If the seed is there to test the search feature, it is worse than empty.
- **Random vectors, cosine-distance operator (`<=>`) in a query.** Cosine distance is undefined for zero vectors and pgvector [returns NaN](https://github.com/pgvector/pgvector#querying) for that case. A seeder that produces all-zero vectors, or normalizes without checking for the zero case, will cause queries to sort NaN rows in ways the application did not plan for.

The right shape depends on the test. For "does the schema load and do rows exist" seeds, satus emits random unit vectors matching the column's declared dimension, and skips the zero vector. For "does the search feature return sensible results" seeds, random vectors are not the right tool at all; embed a small corpus with the same model the application uses in production, and seed the resulting real embeddings.

## pgcrypto: ciphertext has to be ciphertext

pgcrypto adds functions like [`pgp_sym_encrypt` and `pgp_sym_decrypt`](https://www.postgresql.org/docs/current/pgcrypto.html#PGCRYPTO-PGP-ENC-FUNCS) that store OpenPGP-framed ciphertext in `bytea` columns. The column type itself is just `bytea`, which is what fools generic seeders: random bytes satisfy the type, and inserts succeed silently. The failure lands in the application, on the first `pgp_sym_decrypt` call, with "Wrong key or corrupt data."

The same trap applies to schemas that store `digest(x, 'sha256')` outputs or [`crypt`](https://www.postgresql.org/docs/current/pgcrypto.html#PGCRYPTO-PASSWORD-HASHING-FUNCS) hashes. A random 32-byte value in a "sha256 of email" column will not match anything the application looks up by hash, and lookups start returning zero rows for every user. The schema does not complain; the feature does.

The right shape for a pgcrypto column is to generate through the extension's own functions. If the column is `pgp_sym_encrypt(plaintext, key)`, the seeder needs the key (or a stand-in key it also stores in the test environment) and has to call `pgp_sym_encrypt` inside the insert—not produce ciphertext offline. For hash columns, generate the plaintext, then insert `digest(plaintext, 'sha256')` (or `crypt(plaintext, gen_salt('bf'))`) so hash lookups against known plaintexts actually resolve.

## The common shape

Extensions move the definition of "valid" out of the column type and into the extension's semantics. A type-driven seeder, one that inspects `information_schema.columns` and dispatches on `data_type`, cannot see this. It will produce rows that Postgres accepts and that the application cannot use. That gap—accepted by the database, rejected by the feature—is the class of failure these three extensions produce, and it is why satus treats a schema that uses an extension differently from a schema that does not.

The [profiles](/profiles) satus ships today (`saas`, `ecommerce`, `b2b`) don't hardcode PostGIS or pgvector or pgcrypto expectations, because the extension surface a user's schema pulls in is orthogonal to the profile choice. Extension handling lives in introspection instead: satus reads `pg_extension`, respects declared typmods, and routes columns owned by these extensions through generators that produce values the extension will actually accept.

If you are writing your own seeder and your users have started reporting "the data is there but the feature doesn't work," check whether one of these three extensions is involved. It usually is.

## Reproduce it yourself

The three failure modes above are packaged as runnable SQL in [`examples/extension-pitfalls`](https://github.com/PasskeyBridge-LLC/satus/tree/main/examples/extension-pitfalls) in the satus repository. Each script creates a small schema, runs the seed a type-driven generator would produce (catching and printing the errors so the script continues), then runs the seed that respects the extension's semantics. `./run.sh` executes all three in throwaway Docker containers; a copy-paste GitHub Actions job is in the README.

## References

- [Runnable examples for this post](https://github.com/PasskeyBridge-LLC/satus/tree/main/examples/extension-pitfalls)—PostGIS, pgvector, and pgcrypto seed scripts with the failure cases included.
- [PostGIS documentation](https://postgis.net/documentation/)—geometry types, SRID handling, validity predicates.
- [PostGIS `ST_IsValid`](https://postgis.net/docs/ST_IsValid.html) and [`ST_GeomFromEWKT`](https://postgis.net/docs/ST_GeomFromEWKT.html)—validity check and text-to-geometry constructor.
- [pgvector README](https://github.com/pgvector/pgvector)—`vector(n)` type, distance operators, ANN index types.
- [Postgres pgcrypto docs](https://www.postgresql.org/docs/current/pgcrypto.html)—symmetric encryption and password-hashing functions.
- [Designing the SaaS subscriptions profile](/blog/saas-subscriptions-profile)—a schema-first counterpart to this post: valid rows the extension does not touch still need row-level composition to be useful.
- [When Faker is the wrong answer](/blog/when-faker-is-the-wrong-answer)—why column-type-driven generation misses domain semantics; extensions make the same point in stronger form.
