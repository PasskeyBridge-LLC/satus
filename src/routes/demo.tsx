/**
 * /demo — in-browser instant demo.
 *
 * The whole pipeline runs client-side against PGlite (real Postgres
 * compiled to WASM), so the visitor's DDL never leaves the browser:
 *
 *   1. Run the pasted DDL in a fresh in-memory PGlite database.
 *   2. Introspect it from pg_catalog — the same source of truth the CLI
 *      uses (trimmed: no partition handling in the demo).
 *   3. Topo-sort tables by FK dependency; break soft cycles on a
 *      nullable back-edge, exactly like the CLI's dag.ts.
 *   4. Ask our server (/api/public/demo/generate) for rows — one
 *      xAI call on our key, capped at 5 rows x 6 tables. FK
 *      columns are never sent to the model; they're injected here from
 *      actually-inserted parent PKs.
 *   5. INSERT row-by-row so constraint rejections surface per-row, then
 *      back-patch broken cycle edges, then display what landed.
 *
 * Anything Postgres rejects is shown honestly — that's the point.
 */
import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { track } from "@vercel/analytics";

import { PageShell } from "@/components/site/chrome";
import { Prose, Section, type SectionMeta } from "@/components/site/primitives";

const SITE_URL = "https://satus.sh";

const SECTIONS: readonly SectionMeta[] = [
  { id: "try", n: "01", label: "Try it" },
  { id: "results", n: "02", label: "Results" },
  { id: "reality", n: "03", label: "Demo vs CLI" },
] as const;

const SAMPLE_DDL = `create type order_status as enum ('pending','paid','fulfilled','refunded');

create table customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null,
  country char(2) not null
);

create table categories (
  id serial primary key,
  name text not null unique,
  featured_product_id int  -- cycle: closed after products exists
);

create table products (
  id serial primary key,
  category_id int not null references categories(id),
  sku text not null unique,
  name text not null,
  price_usd numeric(8,2) not null check (price_usd > 0)
);

alter table categories add constraint categories_featured_fk
  foreign key (featured_product_id) references products(id);

create table orders (
  id bigserial primary key,
  customer_id uuid not null references customers(id),
  status order_status not null default 'pending',
  total_usd numeric(10,2) not null
);

create table order_items (
  id bigserial primary key,
  order_id bigint not null references orders(id),
  product_id int not null references products(id),
  qty int not null check (qty between 1 and 20),
  unit_price_usd numeric(8,2) not null
);`;

const ROWS_PER_TABLE = 5;
const MAX_TABLES = 6;

type Profile = "saas" | "ecommerce" | "b2b";

/* ---------------- introspection shapes ---------------- */

interface DemoColumn {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  hasDefault: boolean;
  isGenerated: boolean;
  /** GENERATED ALWAYS / BY DEFAULT AS IDENTITY — distinct from isGenerated. */
  isIdentity: boolean;
  maxLength: number | null;
  enumValues?: string[];
}

interface DemoFk {
  column: string;
  refTable: string;
  refColumn: string;
}

interface DemoTable {
  name: string;
  columns: DemoColumn[];
  primaryKey: string[];
  foreignKeys: DemoFk[];
}

interface BrokenEdge {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
}

interface TableResult {
  name: string;
  inserted: number;
  rejected: Array<{ row: number; message: string }>;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

type Phase = "idle" | "engine" | "ddl" | "introspect" | "generate" | "insert" | "done" | "error";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  engine: "loading postgres (wasm)...",
  ddl: "running your DDL...",
  introspect: "introspecting pg_catalog...",
  generate: "generating rows (grok-4.20-0309-non-reasoning)...",
  insert: "inserting + validating...",
  done: "",
  error: "",
};

/* ---------------- pure helpers (mirrors of the CLI's dag.ts) ---------------- */

function topoSortDemo(tables: DemoTable[]): {
  order: DemoTable[];
  brokenEdges: BrokenEdge[];
  cycle: string[] | null;
} {
  const byName = new Map(tables.map((t) => [t.name, t]));
  interface Edge {
    from: string;
    to: string;
    column: string;
    refColumn: string;
    nullable: boolean;
  }
  let edges: Edge[] = [];
  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      if (fk.refTable === t.name) continue;
      if (!byName.has(fk.refTable)) continue;
      const col = t.columns.find((c) => c.name === fk.column);
      edges.push({
        from: fk.refTable,
        to: t.name,
        column: fk.column,
        refColumn: fk.refColumn,
        nullable: col?.nullable === true,
      });
    }
  }
  const brokenEdges: BrokenEdge[] = [];

  const kahn = (es: Edge[]) => {
    const inDeg = new Map<string, number>();
    const out = new Map<string, Edge[]>();
    for (const t of tables) {
      inDeg.set(t.name, 0);
      out.set(t.name, []);
    }
    for (const e of es) {
      out.get(e.from)!.push(e);
      inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    }
    const queue = [...inDeg.entries()]
      .filter(([, d]) => d === 0)
      .map(([n]) => n)
      .sort();
    const order: DemoTable[] = [];
    while (queue.length > 0) {
      const n = queue.shift()!;
      order.push(byName.get(n)!);
      for (const e of out.get(n) ?? []) {
        const next = (inDeg.get(e.to) ?? 0) - 1;
        inDeg.set(e.to, next);
        if (next === 0) queue.push(e.to);
      }
    }
    const unresolved = new Set(tables.filter((t) => !order.includes(t)).map((t) => t.name));
    return { order, unresolved };
  };

  for (let round = 0; round <= tables.length; round++) {
    const { order, unresolved } = kahn(edges);
    if (unresolved.size === 0) return { order, brokenEdges, cycle: null };
    const candidates = edges
      .filter((e) => unresolved.has(e.from) && unresolved.has(e.to) && e.nullable)
      .sort((a, b) => (a.to + "." + a.column).localeCompare(b.to + "." + b.column));
    const pick = candidates[0];
    if (!pick) {
      return { order, brokenEdges, cycle: Array.from(unresolved).sort() };
    }
    brokenEdges.push({
      table: pick.to,
      column: pick.column,
      refTable: pick.from,
      refColumn: pick.refColumn,
    });
    edges = edges.filter((e) => e !== pick);
  }
  return { order: [], brokenEdges, cycle: tables.map((t) => t.name) };
}

function quoteIdent(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/* ---------------- the page ---------------- */

export const Route = createFileRoute("/demo")({
  component: DemoPage,
  head: () => ({
    meta: [
      { title: "satus demo—generate seed data in your browser" },
      {
        name: "description",
        content:
          "Paste a Postgres schema and watch satus generate FK-safe, realistic seed data — running real Postgres (WASM) in your browser. No install, no signup.",
      },
      { property: "og:title", content: "satus demo—seed data in your browser" },
      {
        property: "og:description",
        content:
          "Paste CREATE TABLE statements, get realistic rows that respect your foreign keys. Real Postgres in the browser.",
      },
      { property: "og:url", content: SITE_URL + "/demo" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: SITE_URL + "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: SITE_URL + "/og-image.png" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/demo" }],
  }),
});

function DemoPage() {
  const [ddl, setDdl] = useState(SAMPLE_DDL);
  const [profile, setProfile] = useState<Profile>("ecommerce");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TableResult[]>([]);
  const [runMeta, setRunMeta] = useState<{
    order: string[];
    broken: BrokenEdge[];
  } | null>(null);
  const running = useRef(false);

  async function run() {
    if (running.current) return;
    running.current = true;
    setError(null);
    setResults([]);
    setRunMeta(null);
    try {
      setPhase("engine");
      const { PGlite } = await import("@electric-sql/pglite");
      const db = new PGlite();

      setPhase("ddl");
      await db.exec(ddl);

      setPhase("introspect");
      const cols = await db.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: string;
        column_default: string | null;
        character_maximum_length: number | null;
        is_generated: string;
        is_identity: string;
      }>(
        // is_identity is read separately from is_generated: Postgres reports
        // identity columns as column_default = NULL and is_generated =
        // 'NEVER', so neither of the other two flags catches them.
        `select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
                c.column_default, c.character_maximum_length, c.is_generated,
                c.is_identity
         from information_schema.columns c
         join pg_class pc on pc.relname = c.table_name
         join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
         where c.table_schema = 'public' and pc.relkind = 'r'
         order by c.table_name, c.ordinal_position`,
      );
      const pks = await db.query<{ table_name: string; column_name: string }>(
        `select cls.relname as table_name, att.attname as column_name
         from pg_constraint con
         join pg_class cls on cls.oid = con.conrelid
         join pg_namespace ns on ns.oid = cls.relnamespace and ns.nspname = 'public'
         join lateral unnest(con.conkey) as k(attnum) on true
         join pg_attribute att on att.attrelid = cls.oid and att.attnum = k.attnum
         where con.contype = 'p'`,
      );
      const fks = await db.query<{
        table_name: string;
        column_name: string;
        ref_table: string;
        ref_column: string;
      }>(
        `select cls.relname as table_name, att.attname as column_name,
                fcls.relname as ref_table, fatt.attname as ref_column
         from pg_constraint con
         join pg_class cls on cls.oid = con.conrelid
         join pg_namespace ns on ns.oid = cls.relnamespace and ns.nspname = 'public'
         join pg_class fcls on fcls.oid = con.confrelid
         join lateral unnest(con.conkey) with ordinality as ck(attnum, ord) on true
         join lateral unnest(con.confkey) with ordinality as fk(attnum, ord) on fk.ord = ck.ord
         join pg_attribute att on att.attrelid = cls.oid and att.attnum = ck.attnum
         join pg_attribute fatt on fatt.attrelid = fcls.oid and fatt.attnum = fk.attnum
         where con.contype = 'f'`,
      );
      const enums = await db.query<{ typname: string; enumlabel: string }>(
        `select t.typname, e.enumlabel
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         order by t.typname, e.enumsortorder`,
      );

      const enumMap = new Map<string, string[]>();
      for (const r of enums.rows) {
        const list = enumMap.get(r.typname) ?? [];
        list.push(r.enumlabel);
        enumMap.set(r.typname, list);
      }

      const tableMap = new Map<string, DemoTable>();
      for (const r of cols.rows) {
        let t = tableMap.get(r.table_name);
        if (!t) {
          t = { name: r.table_name, columns: [], primaryKey: [], foreignKeys: [] };
          tableMap.set(r.table_name, t);
        }
        t.columns.push({
          name: r.column_name,
          dataType: r.data_type,
          udtName: r.udt_name,
          nullable: r.is_nullable === "YES",
          hasDefault: r.column_default !== null,
          isGenerated: !!r.is_generated && r.is_generated !== "NEVER",
          isIdentity: r.is_identity === "YES",
          maxLength: r.character_maximum_length,
          enumValues: enumMap.get(r.udt_name),
        });
      }
      for (const r of pks.rows) tableMap.get(r.table_name)?.primaryKey.push(r.column_name);
      for (const r of fks.rows)
        tableMap.get(r.table_name)?.foreignKeys.push({
          column: r.column_name,
          refTable: r.ref_table,
          refColumn: r.ref_column,
        });

      const tables = Array.from(tableMap.values());
      if (tables.length === 0) {
        throw new Error("No tables found — the DDL must create at least one table.");
      }
      if (tables.length > MAX_TABLES) {
        throw new Error(
          `Demo is capped at ${MAX_TABLES} tables (you created ${tables.length}). The CLI has no such cap.`,
        );
      }

      const sort = topoSortDemo(tables);
      if (sort.cycle) {
        throw new Error(
          `FK cycle with no nullable back-edge: ${sort.cycle.join(", ")}. ` +
            `Make one FK column on the cycle nullable (the CLI gives the same guidance).`,
        );
      }
      setRunMeta({ order: sort.order.map((t) => t.name), broken: sort.brokenEdges });

      // Columns the model fills: not FK, not defaulted, not generated, not
      // identity. Identity columns are left to the sequence — GENERATED
      // ALWAYS rejects an explicit value outright, and GENERATED BY DEFAULT
      // accepts it without advancing the sequence.
      const fkCols = (t: DemoTable) => new Set(t.foreignKeys.map((f) => f.column));
      const generatable = (t: DemoTable) =>
        t.columns.filter(
          (c) => !c.isGenerated && !c.isIdentity && !c.hasDefault && !fkCols(t).has(c.name),
        );

      setPhase("generate");
      const requestTables = sort.order
        .map((t) => ({
          name: t.name,
          columns: generatable(t).map((c) => ({
            name: c.name,
            dataType: c.dataType,
            udtName: c.udtName,
            nullable: c.nullable,
            maxLength: c.maxLength,
            ...(c.enumValues ? { enumValues: c.enumValues } : {}),
          })),
        }))
        .filter((t) => t.columns.length > 0);

      let generated: Record<string, Array<Record<string, unknown>>> = {};
      if (requestTables.length > 0) {
        const res = await fetch("/api/public/demo/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile, rows: ROWS_PER_TABLE, tables: requestTables }),
        });
        if (res.status === 429) {
          throw new Error(
            "Demo rate limit reached — it runs on our API bill. Install the CLI (free tier, your key) for unlimited runs.",
          );
        }
        if (res.status === 503) {
          throw new Error(
            "The demo backend is not configured right now. The CLI works regardless: npm i -g @passkeybridge/satus",
          );
        }
        if (!res.ok) {
          throw new Error("Generation failed upstream. Try again in a minute.");
        }
        const body = (await res.json()) as {
          tables: Record<string, Array<Record<string, unknown>>>;
        };
        generated = body.tables;
      }

      setPhase("insert");
      const brokenByTable = new Map<string, Set<string>>();
      for (const e of sort.brokenEdges) {
        const set = brokenByTable.get(e.table) ?? new Set<string>();
        set.add(e.column);
        brokenByTable.set(e.table, set);
      }
      // PK rows per table, from RETURNING, keyed for FK injection.
      const pkPool = new Map<string, Array<Record<string, unknown>>>();
      const tableResults: TableResult[] = [];

      for (const t of sort.order) {
        const gen = generated[t.name] ?? [];
        const fkSet = fkCols(t);
        const broken = brokenByTable.get(t.name) ?? new Set<string>();
        const insertCols = t.columns
          .filter((c) => !c.isGenerated && !c.isIdentity && !c.hasDefault)
          .map((c) => c.name);
        const rejected: Array<{ row: number; message: string }> = [];
        let inserted = 0;
        const returnedPks: Array<Record<string, unknown>> = [];

        for (let i = 0; i < ROWS_PER_TABLE; i++) {
          const source = gen[i] ?? {};
          const row: Record<string, unknown> = {};
          let skip: string | null = null;
          for (const col of insertCols) {
            if (fkSet.has(col)) {
              const fk = t.foreignKeys.find((f) => f.column === col)!;
              if (broken.has(col) || fk.refTable === t.name) {
                row[col] = null;
                continue;
              }
              const parents = pkPool.get(fk.refTable) ?? [];
              if (parents.length === 0) {
                const c = t.columns.find((x) => x.name === col);
                if (c?.nullable) {
                  row[col] = null;
                } else {
                  skip = `no parent rows for NOT NULL FK ${col} -> ${fk.refTable}`;
                }
                continue;
              }
              row[col] = pickRandom(parents)[fk.refColumn];
            } else {
              const v = source[col];
              row[col] = v !== null && typeof v === "object" ? JSON.stringify(v) : (v ?? null);
            }
          }
          if (skip) {
            rejected.push({ row: i + 1, message: skip });
            continue;
          }
          const colSql = insertCols.map(quoteIdent).join(", ");
          const params = insertCols.map((_, j) => `$${j + 1}`).join(", ");
          const returning =
            t.primaryKey.length > 0 ? ` returning ${t.primaryKey.map(quoteIdent).join(", ")}` : "";
          const sql =
            insertCols.length > 0
              ? `insert into ${quoteIdent(t.name)} (${colSql}) values (${params})${returning}`
              : `insert into ${quoteIdent(t.name)} default values${returning}`;
          try {
            const r = await db.query<Record<string, unknown>>(
              sql,
              insertCols.map((c) => row[c]),
            );
            inserted += 1;
            if (r.rows[0]) returnedPks.push(r.rows[0]);
          } catch (e) {
            rejected.push({
              row: i + 1,
              message: (e as Error).message.split("\n")[0]!.slice(0, 160),
            });
          }
        }
        if (returnedPks.length > 0) pkPool.set(t.name, returnedPks);

        tableResults.push({
          name: t.name,
          inserted,
          rejected,
          columns: [],
          rows: [],
        });
      }

      // Back-patch broken cycle edges from the now-full parent pools.
      for (const e of sort.brokenEdges) {
        const parents = pkPool.get(e.refTable) ?? [];
        if (parents.length === 0) continue;
        const child = tableMap.get(e.table)!;
        if (child.primaryKey.length === 0) continue;
        const pkCols = child.primaryKey.map(quoteIdent).join(", ");
        const nulls = await db.query<Record<string, unknown>>(
          `select ${pkCols} from ${quoteIdent(e.table)} where ${quoteIdent(e.column)} is null`,
        );
        for (const r of nulls.rows) {
          const where = child.primaryKey
            .map((c, i) => `${quoteIdent(c)} = $${i + 2}`)
            .join(" and ");
          await db.query(
            `update ${quoteIdent(e.table)} set ${quoteIdent(e.column)} = $1 where ${where}`,
            [pickRandom(parents)[e.refColumn], ...child.primaryKey.map((c) => r[c])],
          );
        }
      }

      // Read back what actually landed, for display.
      for (const tr of tableResults) {
        const sel = await db.query<Record<string, unknown>>(
          `select * from ${quoteIdent(tr.name)} limit ${ROWS_PER_TABLE}`,
        );
        tr.rows = sel.rows;
        tr.columns = sel.rows[0] ? Object.keys(sel.rows[0]) : [];
      }

      setResults(tableResults);
      setPhase("done");
      track("demo_run", { profile, outcome: "done" });
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      track("demo_run", { profile, outcome: "error" });
    } finally {
      running.current = false;
    }
  }

  return (
    <PageShell sections={SECTIONS} currentPath="/demo">
      <Section
        heading="h1"
        id="try"
        n="01"
        label="Try it"
        title={<>paste a schema. get real rows. nothing to install.</>}
      >
        <Prose>
          <p>
            This page runs <em>real Postgres</em> (compiled to WASM) in your browser. Your DDL never
            leaves the tab — only column names and types are sent to our server for the one model
            call, on our API bill. Capped at {ROWS_PER_TABLE} rows across {MAX_TABLES} tables; the{" "}
            <Link to="/quickstart" className="link-underline">
              CLI
            </Link>{" "}
            has no such caps and runs against your own database with your own key.
          </p>
        </Prose>

        <div className="mt-8 max-w-[760px]">
          <textarea
            value={ddl}
            onChange={(e) => setDdl(e.target.value)}
            spellCheck={false}
            rows={16}
            aria-label="Postgres DDL"
            className="w-full resize-y border border-[var(--ink)] bg-transparent px-4 py-3 font-mono text-[13px] leading-[1.7] text-[var(--ink)] outline-none focus:border-[var(--signal)]"
          />
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--mute)]">
              profile
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value as Profile)}
                className="ml-3 border border-[var(--hairline)] bg-transparent px-2 py-1 font-mono text-[13px] normal-case tracking-normal text-[var(--ink)]"
              >
                <option value="ecommerce">ecommerce</option>
                <option value="saas">saas</option>
                <option value="b2b">b2b</option>
              </select>
            </label>
            <button
              type="button"
              onClick={run}
              disabled={phase !== "idle" && phase !== "done" && phase !== "error"}
              className="border border-[var(--ink)] bg-[var(--ink)] px-5 py-2 font-mono text-[13px] text-[var(--paper)] transition-opacity disabled:opacity-50"
            >
              {phase === "idle" || phase === "done" || phase === "error"
                ? "run demo →"
                : PHASE_LABEL[phase]}
            </button>
          </div>
          {error && (
            <p className="mt-4 border-l-2 border-[var(--signal)] pl-4 font-mono text-[13px] text-[var(--ink)]">
              <span className="text-[var(--signal)]">error · </span>
              {error}
            </p>
          )}
        </div>
      </Section>

      <Section id="results" n="02" label="Results" title={<>what actually landed.</>}>
        {results.length === 0 ? (
          <Prose>
            <p>
              Run the demo above. You&rsquo;ll see the FK-dependency order satus derived, any cycle
              it broke, and the rows Postgres accepted — including anything it rejected, shown
              honestly.
            </p>
          </Prose>
        ) : (
          <div className="max-w-[900px]">
            {runMeta && (
              <p className="font-mono text-[12.5px] text-[var(--mute)]">
                order&nbsp;·&nbsp;{runMeta.order.join(" → ")}
                {runMeta.broken.length > 0 && (
                  <>
                    <br />
                    cycles&nbsp;·&nbsp;
                    {runMeta.broken
                      .map(
                        (b) => `${b.table}.${b.column} → ${b.refTable} (deferred + back-patched)`,
                      )
                      .join(", ")}
                  </>
                )}
              </p>
            )}
            {results.map((t) => (
              <div key={t.name} className="mt-8">
                <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--mute)]">
                  <span className="text-[var(--signal)]">{t.name}</span>
                  <span className="mx-2 text-[var(--hairline)]">|</span>
                  {t.inserted} inserted
                  {t.rejected.length > 0 && (
                    <>
                      <span className="mx-2 text-[var(--hairline)]">|</span>
                      {t.rejected.length} rejected by constraints
                    </>
                  )}
                </div>
                {t.rows.length > 0 && (
                  <div className="mt-2 overflow-x-auto border-y border-[var(--hairline)]">
                    <table className="w-full font-mono text-[12px]">
                      <thead>
                        <tr className="text-left text-[var(--mute)]">
                          {t.columns.map((c) => (
                            <th key={c} className="whitespace-nowrap px-3 py-2 font-normal">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {t.rows.map((r, i) => (
                          <tr key={i} className="border-t border-[var(--hairline)] align-top">
                            {t.columns.map((c) => (
                              <td key={c} className="max-w-[220px] truncate px-3 py-2">
                                {r[c] === null ? (
                                  <span className="text-[var(--mute)]">null</span>
                                ) : (
                                  String(r[c])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {t.rejected.map((rej) => (
                  <p key={rej.row} className="mt-2 font-mono text-[12px] text-[var(--mute)]">
                    <span className="text-[var(--signal)]">row {rej.row}</span> · {rej.message}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section id="reality" n="03" label="Demo vs CLI" title={<>what the demo skips.</>}>
        <Prose>
          <p>
            The demo is the toy version: {ROWS_PER_TABLE} rows, {MAX_TABLES} tables, one shared
            rate-limited key, and no partitioned-table handling. The CLI introspects your live
            database, handles partitions and deferrable constraints, wraps every run in a single
            transaction with a <code>--max-cost</code> budget, and validates offline with{" "}
            <code>--dry-run</code>. Install it with <code>npm i -g @passkeybridge/satus</code> — the
            free tier needs no signup.
          </p>
        </Prose>
        <div className="mt-6">
          <Link to="/quickstart" className="link-underline font-mono text-[13px]">
            read the quickstart →
          </Link>
        </div>
      </Section>
    </PageShell>
  );
}
