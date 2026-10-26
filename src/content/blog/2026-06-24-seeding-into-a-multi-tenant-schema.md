---
slug: seeding-into-a-multi-tenant-schema
title: "Seeding into a multi-tenant schema without leaking tenants"
description: Seed data leaks across tenants through shared lookup tables, FK chains that drop tenant_id, and RLS bypassed by a superuser connection. What satus does.
date: 2026-06-24
author: satus.sh
tags: [postgres, multi-tenant, rls, seeding, security]
draft: false
---

A multi-tenant schema is one that stores data for more than one customer in the same set of tables, distinguished by a `tenant_id` column (or `org_id`, `workspace_id`, the name does not matter). The contract every such schema makes with its users is the same: a query issued on behalf of tenant A returns only tenant A's rows, and a write on behalf of tenant A cannot land in tenant B's space. Seed data, generated for development or staging, is supposed to honour the same contract. It very often does not, because the failure modes that leak tenants at seed time are different from the ones that leak tenants at runtime, and none of them are visible until somebody looks for them.

This post is the field guide. Three shapes of seed-time leak, what each one looks like in `pg_catalog`, and the discipline `satus` applies to avoid producing rows that cross the boundary. None of it requires a new schema feature; most of it requires the schema to be precise about what "tenant-scoped" means.

## The shape of the bug

A minimal example, stripped to the parts that matter:

```sql
CREATE TABLE tenants (
  id   uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE categories (
  id   uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE products (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  category_id uuid NOT NULL REFERENCES categories(id),
  name        text NOT NULL
);
```

`products` is tenant-scoped. `categories` is a shared lookup. Nothing in the schema says a category is global, and nothing in the schema says a product's category must belong to the same tenant as the product. A generator that reads `pg_constraint` and follows the foreign keys sees three tables, two FKs, and no cycles. It will happily place a product for tenant A pointing at a category that, when an application developer later adds `tenant_id` to `categories`, will turn out to belong to tenant B.

The same shape, rendered as a graph:

```text
tenants ───────────────┐
                       │ (tenant_id)
                       ▼
                   products ◀──── categories
                       (category_id; no tenant predicate)
```

The FK arrow from `products.category_id` to `categories.id` carries no tenant information, because `categories` has no tenant column. The constraint is satisfied for every category in the table. The constraint that the application *meant* to enforce, "category belongs to the same tenant as the product, or is explicitly global", is not in the schema and therefore not in the catalog and therefore not visible to a generator that only reads the catalog.

## Leak #1: the shared lookup table

The example above is the most common case. A lookup table (`categories`, `tags`, `currencies`, `roles`, `plans`) is referenced by tenant-scoped rows and is itself untagged. There are two intentions hiding under the same DDL.

**The lookup is meant to be global.** Currencies, ISO country codes, payment-method types: these exist once for the whole installation. The fix is to say so in the schema. A `is_global boolean NOT NULL DEFAULT true` column, or a separate `global_categories` table, makes the intent legible. `satus` then knows the row pool for `category_id` is shared, and any tenant may reference any row.

**The lookup is meant to be per-tenant.** Order statuses customized per workspace, custom fields, user-defined categories: these are tenant-scoped in spirit and untagged in DDL. The fix is to add the column the schema is missing:

```sql
ALTER TABLE categories
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES tenants(id);

ALTER TABLE products
  DROP CONSTRAINT products_category_id_fkey,
  ADD CONSTRAINT products_category_same_tenant
    FOREIGN KEY (tenant_id, category_id)
    REFERENCES categories(tenant_id, id);
```

The composite FK is the load-bearing change. Once `categories` has its own `tenant_id` and `products.category_id` is part of a composite FK that also includes `tenant_id`, the database itself rejects cross-tenant references. A generator no longer has to be clever, and an attacker who finds a SQL injection that mutates `category_id` cannot use it to traverse out of their tenant either. PostgreSQL's treatment of multi-column foreign keys is in [Foreign Keys](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK).

The cost is one extra column on every lookup table and one composite unique index per parent. The benefit is that "tenant" becomes a property of the FK graph, not a convention enforced in application code.

## Leak #2: the FK chain that drops tenant_id

The second shape is subtler. Every table has a `tenant_id`, every table is RLS-protected, and yet a generator still produces rows that cross. The mechanism:

```sql
CREATE TABLE orders (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer  uuid NOT NULL  -- nominally references customers(id)
);

CREATE TABLE order_lines (
  id        uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id  uuid NOT NULL REFERENCES orders(id),
  sku       text NOT NULL
);
```

`orders` and `order_lines` are both tenant-scoped. The FK from `order_lines.order_id` to `orders.id` is single-column. A generator that picks a `tenant_id` independently for each table, then picks an `order_id` from the pool of all orders, will sometimes pick an order that belongs to tenant B while the line itself is tagged tenant A. The row inserts fine. The constraint is satisfied. The data is wrong.

Any seeder that wants to avoid this has to walk the catalog twice. First pass: identify every column whose name and type match the project's tenant key, and mark them as a *tenant axis*. Second pass: for every FK that points at a table on the tenant axis, derive the child's `tenant_id` from the parent's `tenant_id` rather than sampling it independently. The mechanics are the same topological sort the planner already runs (described in [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild)), with one extra rule layered on top: a column on the tenant axis is computed from its parent, not sampled.

The schema-side fix is the same as in leak #1: make the FK composite.

```sql
ALTER TABLE order_lines
  DROP CONSTRAINT order_lines_order_id_fkey,
  ADD CONSTRAINT order_lines_order_same_tenant
    FOREIGN KEY (tenant_id, order_id)
    REFERENCES orders(tenant_id, id);
```

After this change, the catalog itself rejects a cross-tenant order line, every generator (including `satus`) sees it through `pg_constraint`, and the rule survives application refactors. Until then, the seeder has to enforce the convention out-of-band because the catalog is silent.

## Leak #3: RLS that the seeder bypasses

The third shape is the one Postgres makes easiest to get wrong. The schema uses Row Level Security:

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON products
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

This works for the application, which connects as a role that has RLS enforced and sets `app.tenant_id` per request. It does not work for a seeder that connects as the schema owner. RLS does not apply to table owners or to superusers by default; the policy is silently bypassed and the seeder can write any `tenant_id` into any row. `pg_dump`, `pg_restore`, and ad-hoc psql sessions running as the owner all have the same exemption. The behavior is documented in [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): "Superusers and roles with the BYPASSRLS attribute always bypass the row security system… Table owners normally bypass row security as well, though a table owner can choose to be subject to row security with ALTER TABLE … FORCE ROW LEVEL SECURITY."

There are three honest ways to seed an RLS-protected schema without leaking tenants. They have different cost profiles, and the table is the short version.

| Approach | Tenant isolation | Cost | When it fits |
| --- | --- | --- | --- |
| Connect as a non-owner role with RLS enforced; `SET LOCAL app.tenant_id` per batch | Enforced by the database for every write | One transaction per tenant; one extra GRANT block | Default. The pattern we recommend whenever an RLS policy is present. |
| `ALTER TABLE … FORCE ROW LEVEL SECURITY` and connect as the owner | Enforced even for the owner | One DDL per table; affects every other tool too | When the same owner role is used for both application and maintenance |
| Connect as superuser, derive `tenant_id` from the FK chain in user code | Enforced only by the seeder | Zero schema change; full trust in the generator | Quick local fixtures only; not for shared staging |

The first row is the one to reach for. Connect as a role that has neither `BYPASSRLS` nor table ownership, open one transaction per tenant, issue `SET LOCAL app.tenant_id = '<uuid>'` (or whatever per-session GUC the policy reads), and write that tenant's rows inside that transaction. The pattern of one-transaction-per-tenant is also what the application does at runtime; the closer the seed path is to the request path, the fewer surprises move from one to the other.

The longer treatment of why RLS on a partitioned parent does not propagate to children, and why that matters for seed jobs, is in [Partitioned tables meet RLS, and nobody wins](/blog/partitioned-tables-meet-rls).

## The checklist for a multi-tenant seed run

The discipline above maps onto five questions to answer before a single row is generated. They apply to any seeder; today, `satus` answers them through a combination of catalog reads (composite FKs and topo order, already shipped via [the planner](/blog/cyclic-fks-in-the-wild)) and the profile config that names the tenant key. The questions are the contract; the implementation will harden over future releases.

1. **What is the tenant axis?** The column name (`tenant_id`, `org_id`, `workspace_id`) and the type that identifies a tenant across the schema. Pick one, write it down, and check that every table that should be tenant-scoped has it.
2. **Which tables are lookups, and which of those are global vs per-tenant?** Lookups have no tenant column today. For each one, decide whether it is meant to be shared across the installation or scoped per tenant, then either add an `is_global` flag or add a `tenant_id` and convert the inbound FKs to composite.
3. **Does every FK between two tenant-scoped tables carry the tenant axis?** A single-column FK between tenant-scoped tables is the second leak by construction. Make it composite or accept that the seeder is enforcing tenancy in user code.
4. **Does any target table have an RLS policy, and which per-session GUC does it read?** If the answer is yes, the seed run needs one transaction per tenant with `SET LOCAL` of that GUC, run as a role that has neither `BYPASSRLS` nor table ownership.
5. **Is every transaction single-tenant?** Every batch carries one `tenant_id`, every transaction carries one batch, every commit is auditable as "this transaction wrote rows for tenant X and only tenant X". This is a property of how the seed run is structured, not of the schema; the seeder has to opt in.

What no seeder can do, and the honest reason why:

- Decide whether a lookup is global or per-tenant. The schema is silent on intent; a human has to answer once.
- Detect tenant leaks that have nothing to do with foreign keys. A `jsonb` column with a tenant ID embedded in it ([as described in JSONB that is secretly relational](/blog/jsonb-that-is-secretly-relational)) is opaque to any tool that reads the catalog and not the data.
- Defend against the seeder being run by a superuser against an RLS-protected schema with no warning visible. The warning has to be acted on; reading it is on the operator.

## The shorter version

A multi-tenant Postgres schema leaks at seed time in three places. A shared lookup table without a tenant column is referenced by tenant-scoped rows and the FK is satisfied for any row in the lookup. A single-column FK between two tenant-scoped tables drops the tenant axis and the generator picks an order from the wrong tenant. An RLS policy is silently bypassed when the seeder connects as the owner or a superuser. In every case the catalog is honest about what it enforces; the gap is between what the schema says and what the application meant.

The fix is mostly schema-side: composite FKs that include the tenant axis, a `is_global` flag on lookups that are meant to be shared, and a non-owner role for the seeder. Until those changes land, `satus` enforces the discipline in the planner. The catalog is the contract; the contract should say what it means.

If you want to see the rules in action, point [`satus generate --dry-run`](/blog/dry-run-validation) at a multi-tenant schema and read the plan output before any rows are written. The [/quickstart](/quickstart) covers the connection setup; the [/profiles](/profiles) page lists the per-project tenant key conventions the bundled profiles know about.

## References

- PostgreSQL documentation, [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
- PostgreSQL documentation, [Foreign Keys](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK).
- PostgreSQL documentation, [`SET` and `current_setting`](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET).
- PostgreSQL documentation, [`pg_catalog.pg_policy`](https://www.postgresql.org/docs/current/catalog-pg-policy.html).
- Prior on this blog: [Partitioned tables meet RLS, and nobody wins](/blog/partitioned-tables-meet-rls), [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild), [A $0 dry-run that catches FK and constraint bugs before the LLM call](/blog/dry-run-validation).
