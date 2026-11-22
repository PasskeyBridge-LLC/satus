/**
 * Postgres schema introspection. We pull tables, columns, primary keys,
 * foreign keys, and single-column unique constraints from the catalog
 * scoped to a single schema. The output feeds both the topological sort
 * and the LLM JSON schema builder.
 *
 * v0.1 deliberately stayed in one schema (default: public). Cross-schema
 * FKs are flagged but the referenced rows must already exist; we do not
 * attempt to introspect or seed schemas the user did not target.
 *
 * v0.2 collapses the five catalog lookups into one round-trip and
 * surfaces FK deferrability flags so the runner can break cycles
 * via SET CONSTRAINTS ALL DEFERRED.
 */
import type { Client } from "pg";

export interface Column {
  name: string;
  dataType: string; // information_schema.data_type, e.g. "text", "integer"
  udtName: string; // pg_catalog name, e.g. "int4", "uuid", "_text"
  isNullable: boolean;
  hasDefault: boolean;
  defaultExpr: string | null;
  charMaxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  /**
   * GENERATED ALWAYS AS (expr) STORED. Note this is *not* identity — in
   * information_schema, `is_generated` reports 'NEVER' for identity
   * columns. See `isIdentity`.
   */
  isGenerated: boolean;
  /**
   * GENERATED ALWAYS / BY DEFAULT AS IDENTITY. Postgres reports these with
   * `column_default = NULL` and `is_generated = 'NEVER'`, so neither
   * `hasDefault` nor `isGenerated` catches them and they must be tracked
   * separately. Verified against PostgreSQL 16.13.
   */
  isIdentity: boolean;
  /** 'ALWAYS' | 'BY DEFAULT' when isIdentity, else null. */
  identityGeneration: string | null;
  /**
   * pg_type.typcategory when joined during introspection. 'A' is an
   * array, 'E' is an enum. Optional so unit tests can omit it.
   */
  typeCategory?: string | null;
  /**
   * Element typname for an array column. When the element is a domain,
   * this is the domain's base typname (one level).
   */
  elementUdtName?: string | null;
  /** True when the column, or an array element, is a Postgres enum. */
  isEnum?: boolean;
  /** Enum labels in sort order, when isEnum. */
  enumLabels?: string[];
  /** information_schema.columns.domain_name, when the column is a domain. */
  domainName?: string | null;
  /** Domain CHECK constraint text from pg_get_constraintdef, when present. */
  domainChecks?: string[];
}

export interface ForeignKey {
  column: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
  /** SQL-level DEFERRABLE (vs the default NOT DEFERRABLE). */
  deferrable: boolean;
  /** DEFERRABLE INITIALLY DEFERRED. Implies deferrable=true. */
  initiallyDeferred: boolean;
}

export interface Table {
  schema: string;
  name: string;
  columns: Column[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  /** Single-column unique constraints. Multi-col uniques are noted but not enforced in v0.x. */
  uniqueColumns: Set<string>;
}

export interface IntrospectedSchema {
  schema: string;
  tables: Table[];
}

// v0.2: catalog introspection collapses into a single round-trip.
//
// v0.1 issued five sequential queries. Each one paid the network
// round-trip cost (cheap on a unix socket, ~30-100ms on managed
// Postgres like Supabase/Neon). On a 70-table schema against a
// remote DB that meant roughly half a second of pure wire latency
// before the first row was generated.
//
// v0.2 wraps the five lookups in CTEs and aggregates each into a
// JSONB array, returning one row with five keys. The server still
// executes the same five scans, but the client pays one round-trip
// instead of five.
//
// This is a latency trade, not a free win, and on a local socket it
// is a net loss. Measured on PostgreSQL 16.13 over loopback TCP
// (median of 250 runs, interleaved):
//
//                      3 tables / 10 cols    70 tables / 488 cols
//   one CTE query           10.62 ms                22.16 ms
//   five queries             6.38 ms                17.23 ms
//   extra server work        4.24 ms                 4.93 ms
//
// The jsonb_agg wrapping costs roughly 4-5 ms regardless of schema
// size, while a loopback round-trip costs ~0.09 ms, so batching only
// pays once round-trip time exceeds ~1.1-1.2 ms. That covers every managed
// Postgres we target (Supabase, Neon, RDS) and no local socket. See the
// remote measurement in the v0.2.0 release notes: 378 ms of wire time
// became 43 ms against pooled Supabase.
//
// Constraint introspection (FKs, PKs, uniques) deliberately uses
// pg_catalog rather than information_schema. The information_schema
// constraint views are privilege-filtered, and the filters are stricter
// than they look:
//
//   constraint_column_usage  pg_has_role(tblowner, 'USAGE'), owner only.
//                            No grant of any kind makes it visible.
//   table_constraints        accepts INSERT/UPDATE/DELETE/TRUNCATE/
//   referential_constraints  REFERENCES/TRIGGER but *not* SELECT.
//
// So a read-only role sees zero rows from all three, and a role holding
// only SELECT would report every table as having no primary key, no
// unique columns, and no foreign keys. That fails silently: the topo
// sort still runs, it just runs on an empty edge set.
//
// pg_catalog has no such filter. Verified on PostgreSQL 16.13; see the
// three-role transcript in the 2026-08-21 blog post.
//
// FK rows also surface condeferrable / condeferred so the runner
// can decide whether a topo-cycle is breakable via
// SET CONSTRAINTS ALL DEFERRED.
// Partitioned tables need special care. In pg_catalog a partitioned
// parent has relkind='p' and each partition child has relispartition=true.
// Postgres routes INSERTs on the parent to the correct partition, so we
// want to seed only the parent — not the children. But FKs are often
// declared per-partition in real-world schemas (pagila does this), which
// means naive introspection sees the parent as FK-less and the topo sort
// places it at in-degree 0. The runner then tries to INSERT into the
// parent before its FK targets exist and Postgres rejects the row.
//
// Fix: exclude partition children from v_tables, and use
// pg_partition_root() to re-attribute any FK declared on a partition
// child back to the topmost partitioned ancestor. Duplicate FK rows
// (same parent, same column pair) are collapsed with GROUP BY.
export const INTROSPECT_SQL = `
  with
  v_tables as (
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1
      and c.relkind in ('r', 'p')
      and not c.relispartition
    order by c.relname
  ),
  v_columns as (
    select
      c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
      c.column_default, c.character_maximum_length, c.numeric_precision,
      c.numeric_scale, c.is_generated, c.is_identity, c.identity_generation,
      c.ordinal_position,
      ut.typcategory as typcategory,
      ut.typtype as typtype,
      case
        when ut.typcategory = 'A' then coalesce(elem_base.typname, elem.typname)
        else null
      end as element_udt_name,
      coalesce(ut.typtype = 'e' or elem.typtype = 'e', false) as is_enum,
      coalesce(enums.labels, '[]'::jsonb) as enum_labels,
      c.domain_name,
      coalesce(dchecks.checks, '[]'::jsonb) as domain_checks
    from information_schema.columns c
    left join pg_namespace ut_ns
      on ut_ns.nspname = c.udt_schema
    left join pg_type ut
      on ut.typnamespace = ut_ns.oid
     and ut.typname = c.udt_name
    left join pg_type elem
      on elem.oid = ut.typelem
    left join pg_type elem_base
      on elem_base.oid = case
        when elem.typtype = 'd' then elem.typbasetype
        else elem.oid
      end
    left join lateral (
      select coalesce(jsonb_agg(e.enumlabel order by e.enumsortorder), '[]'::jsonb) as labels
      from pg_enum e
      where e.enumtypid = case
        when ut.typtype = 'e' then ut.oid
        when elem.typtype = 'e' then elem.oid
        else 0
      end
    ) enums on true
    left join lateral (
      select coalesce(jsonb_agg(pg_get_constraintdef(con.oid) order by con.conname), '[]'::jsonb) as checks
      from pg_constraint con
      join pg_type dt on dt.oid = con.contypid
      join pg_namespace dn on dn.oid = dt.typnamespace
      where con.contype = 'c'
        and c.domain_name is not null
        and dt.typname = c.domain_name
        and dn.nspname = c.domain_schema
    ) dchecks on true
    where c.table_schema = $1
    order by c.table_name, c.ordinal_position
  ),
  v_pks as (
    -- pg_catalog, not information_schema.table_constraints, for the same
    -- privilege reason as v_fks below: that view's predicate accepts
    -- INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER but *not* SELECT,
    -- so a read-only role gets zero rows and every table silently reports
    -- an empty primary key. Verified on PostgreSQL 16.13.
    select
      cls.relname as table_name,
      att.attname as column_name,
      ck.ord      as ordinal_position
    from pg_constraint con
    join pg_class cls     on cls.oid = con.conrelid
    join pg_namespace ns  on ns.oid = cls.relnamespace
    join lateral unnest(con.conkey) with ordinality as ck(attnum, ord) on true
    join pg_attribute att on att.attrelid = cls.oid and att.attnum = ck.attnum
    where con.contype = 'p'
      and ns.nspname = $1
      and not cls.relispartition
    order by cls.relname, ck.ord
  ),
  v_fks_raw as (
    -- Attribute the FK to the partition root when the constraint is
    -- declared on a partition child. coalesce falls back to the table
    -- itself for non-partitioned tables.
    select
      coalesce(root_cls.relname, cls.relname)   as table_name,
      att.attname                               as column_name,
      coalesce(root_fns.nspname, fns.nspname)   as ref_schema,
      coalesce(root_fcls.relname, fcls.relname) as ref_table,
      fatt.attname                              as ref_column,
      con.condeferrable                         as is_deferrable,
      con.condeferred                           as is_initially_deferred
    from pg_constraint con
    join pg_class cls    on cls.oid = con.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    join pg_class fcls   on fcls.oid = con.confrelid
    join pg_namespace fns on fns.oid = fcls.relnamespace
    left join pg_class     root_cls  on cls.relispartition  and root_cls.oid  = pg_partition_root(cls.oid)
    left join pg_namespace root_ns   on root_ns.oid = root_cls.relnamespace
    left join pg_class     root_fcls on fcls.relispartition and root_fcls.oid = pg_partition_root(fcls.oid)
    left join pg_namespace root_fns  on root_fns.oid = root_fcls.relnamespace
    join lateral unnest(con.conkey)  with ordinality as ck(attnum, ord) on true
    join lateral unnest(con.confkey) with ordinality as fk(attnum, ord) on fk.ord = ck.ord
    join pg_attribute att  on att.attrelid  = cls.oid  and att.attnum  = ck.attnum
    join pg_attribute fatt on fatt.attrelid = fcls.oid and fatt.attnum = fk.attnum
    where con.contype = 'f'
      and coalesce(root_ns.nspname, ns.nspname) = $1
  ),
  v_fks as (
    -- Dedupe: when a FK is declared on the parent, Postgres also creates
    -- an inherited row on every partition child. All rows carry the same
    -- column pair; bool_or preserves DEFERRABLE if any copy has it.
    select
      table_name, column_name, ref_schema, ref_table, ref_column,
      bool_or(is_deferrable)         as is_deferrable,
      bool_or(is_initially_deferred) as is_initially_deferred
    from v_fks_raw
    group by table_name, column_name, ref_schema, ref_table, ref_column
  ),
  v_uniques as (
    -- Single-column unique constraints only. Multi-col uniques require
    -- coordinated generation across columns; we skip them in v0.x to
    -- keep the failure surface small.
    --
    -- pg_catalog for the same privilege reason as v_pks. As before, this
    -- sees UNIQUE *constraints* only, not bare CREATE UNIQUE INDEX.
    select
      cls.relname as table_name,
      att.attname as column_name
    from pg_constraint con
    join pg_class cls     on cls.oid = con.conrelid
    join pg_namespace ns  on ns.oid = cls.relnamespace
    join pg_attribute att on att.attrelid = cls.oid and att.attnum = con.conkey[1]
    where con.contype = 'u'
      and cardinality(con.conkey) = 1
      and ns.nspname = $1
      and not cls.relispartition
  )
  select
    coalesce((select jsonb_agg(to_jsonb(v_tables.*))  from v_tables),  '[]'::jsonb) as tables,
    coalesce((select jsonb_agg(to_jsonb(v_columns.*)) from v_columns), '[]'::jsonb) as columns,
    coalesce((select jsonb_agg(to_jsonb(v_pks.*))     from v_pks),     '[]'::jsonb) as pks,
    coalesce((select jsonb_agg(to_jsonb(v_fks.*))     from v_fks),     '[]'::jsonb) as fks,
    coalesce((select jsonb_agg(to_jsonb(v_uniques.*)) from v_uniques), '[]'::jsonb) as uniques
`;

export async function introspect(
  client: Client,
  schema: string,
  exclude: string[] = [],
): Promise<IntrospectedSchema> {
  const skip = new Set(exclude);
  const res = await client.query(INTROSPECT_SQL, [schema]);
  const row = res.rows[0] as {
    tables: Array<{ table_name: string }>;
    columns: Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
      is_generated: string;
      is_identity: string;
      identity_generation: string | null;
      typcategory: string | null;
      typtype: string | null;
      element_udt_name: string | null;
      is_enum: boolean | null;
      enum_labels: unknown;
      domain_name: string | null;
      domain_checks: unknown;
    }>;
    pks: Array<{ table_name: string; column_name: string }>;
    fks: Array<{
      table_name: string;
      column_name: string;
      ref_schema: string;
      ref_table: string;
      ref_column: string;
      is_deferrable: boolean;
      is_initially_deferred: boolean;
    }>;
    uniques: Array<{ table_name: string; column_name: string }>;
  };

  const tablesByName = new Map<string, Table>();
  for (const r of row.tables) {
    if (skip.has(r.table_name)) continue;
    tablesByName.set(r.table_name, {
      schema,
      name: r.table_name,
      columns: [],
      primaryKey: [],
      foreignKeys: [],
      uniqueColumns: new Set(),
    });
  }

  for (const r of row.columns) {
    const t = tablesByName.get(r.table_name);
    if (!t) continue;
    t.columns.push({
      name: r.column_name,
      dataType: r.data_type,
      udtName: r.udt_name,
      isNullable: r.is_nullable === "YES",
      hasDefault: r.column_default !== null,
      defaultExpr: r.column_default,
      charMaxLength: r.character_maximum_length,
      numericPrecision: r.numeric_precision,
      numericScale: r.numeric_scale,
      isGenerated: !!r.is_generated && r.is_generated !== "NEVER",
      isIdentity: r.is_identity === "YES",
      identityGeneration: r.identity_generation ?? null,
      typeCategory: r.typcategory ?? null,
      elementUdtName: r.element_udt_name ?? null,
      isEnum: r.is_enum === true,
      enumLabels: Array.isArray(r.enum_labels)
        ? (r.enum_labels as unknown[]).map((x) => String(x))
        : [],
      domainName: r.domain_name ?? null,
      domainChecks: Array.isArray(r.domain_checks)
        ? (r.domain_checks as unknown[]).map((x) => String(x))
        : [],
    });
  }

  for (const r of row.pks) {
    tablesByName.get(r.table_name)?.primaryKey.push(r.column_name);
  }

  for (const r of row.fks) {
    tablesByName.get(r.table_name)?.foreignKeys.push({
      column: r.column_name,
      refSchema: r.ref_schema,
      refTable: r.ref_table,
      refColumn: r.ref_column,
      deferrable: r.is_deferrable === true,
      initiallyDeferred: r.is_initially_deferred === true,
    });
  }

  for (const r of row.uniques) {
    tablesByName.get(r.table_name)?.uniqueColumns.add(r.column_name);
  }

  return { schema, tables: Array.from(tablesByName.values()) };
}
