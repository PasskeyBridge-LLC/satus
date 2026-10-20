/**
 * Unit tests for the production-database safety guard.
 *
 * The SQL is exercised end-to-end against a live PostgreSQL 16.13 in the
 * release checks; what is pinned here is the logic that decides *which*
 * tables get counted and *when* counting stops — the parts where a
 * regression would silently weaken a safety check rather than break a run.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { countUserRows, guardMessage, ROW_LIMIT } from "./guard.js";
import { E_GENERAL, E_VALIDATION, E_FK_CYCLE, E_DB_NOT_EMPTY } from "../exit-codes.js";

/**
 * Minimal fake Client. Records every statement so the tests can assert on
 * the shape of the SQL, and answers counting queries from a table->rows map.
 */
function fakeClient(
  tables: Array<{ schema: string; name: string; rows: number }>,
  opts: {
    unreadable?: Set<string>;
  } = {},
) {
  const queries: string[] = [];
  const unreadable = opts.unreadable ?? new Set<string>();
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("from pg_class")) {
        return {
          rows: tables.map((t) => ({
            schema_name: t.schema,
            table_name: t.name,
            readable: !unreadable.has(`${t.schema}.${t.name}`),
          })),
        };
      }
      // Counting statement: sum the rows of every table it names, each
      // capped the way the real subquery caps it.
      let n = 0;
      const cap = Number(/limit (\d+)/.exec(sql)?.[1] ?? ROW_LIMIT + 1);
      for (const t of tables) {
        if (sql.includes(`"${t.schema}"."${t.name}"`)) n += Math.min(t.rows, cap);
      }
      return { rows: [{ n: String(n) }] };
    },
  };
  return { client: client as unknown as Client, queries };
}

describe("safety guard: counting", () => {
  it("passes an empty database", async () => {
    const { client } = fakeClient([]);
    const r = await countUserRows(client);
    expect(r).toMatchObject({ total: 0, exceeded: false, tablesScanned: 0 });
  });

  it("passes a small dev database", async () => {
    const { client } = fakeClient([
      { schema: "public", name: "tenants", rows: 50 },
      { schema: "public", name: "users", rows: 500 },
    ]);
    const r = await countUserRows(client);
    expect(r.total).toBe(550);
    expect(r.exceeded).toBe(false);
  });

  it("trips one row over the limit, and not one row under", async () => {
    const under = fakeClient([{ schema: "public", name: "t", rows: ROW_LIMIT }]);
    expect((await countUserRows(under.client)).exceeded).toBe(false);

    const at = fakeClient([{ schema: "public", name: "t", rows: ROW_LIMIT + 1 }]);
    expect((await countUserRows(at.client)).exceeded).toBe(true);
  });

  it("sums across tables rather than testing each one alone", async () => {
    // No single table exceeds the limit; together they do. A per-table
    // check would wave this database through.
    const { client } = fakeClient([
      { schema: "public", name: "a", rows: 6000 },
      { schema: "public", name: "b", rows: 6000 },
    ]);
    const r = await countUserRows(client);
    expect(r.exceeded).toBe(true);
  });

  it("counts tables in every schema, not just the one being seeded", async () => {
    // Production is rarely all in `public`; a guard that only looked at the
    // target schema would miss an archive schema holding millions of rows.
    const { client } = fakeClient([
      { schema: "public", name: "tenants", rows: 3 },
      { schema: "archive", name: "old_events", rows: 50_000 },
    ]);
    expect((await countUserRows(client)).exceeded).toBe(true);
  });

  it("excludes system schemas from the table list query", async () => {
    const { client, queries } = fakeClient([]);
    await countUserRows(client);
    const listSql = queries[0]!;
    expect(listSql).toContain("not in ('pg_catalog', 'information_schema')");
    expect(listSql).toContain("pg\\_toast%");
    expect(listSql).toContain("pg\\_temp%");
  });

  it("counts ordinary tables and partitions but not partitioned parents", async () => {
    // relkind 'r' is ordinary tables *and* partitions; 'p' parents hold no
    // rows themselves, so including them would double every partitioned row.
    const { client, queries } = fakeClient([]);
    await countUserRows(client);
    expect(queries[0]!).toContain("c.relkind = 'r'");
    expect(queries[0]!).not.toContain("'p'");
  });

  it("skips tables the role cannot read instead of erroring", async () => {
    const { client } = fakeClient(
      [
        { schema: "public", name: "readable", rows: 5 },
        { schema: "private", name: "secret", rows: 99_999 },
      ],
      { unreadable: new Set(["private.secret"]) },
    );
    const r = await countUserRows(client);
    expect(r.tablesSkipped).toBe(1);
    expect(r.tablesScanned).toBe(1);
    expect(r.total).toBe(5);
    expect(r.exceeded).toBe(false);
  });

  it("checks schema USAGE and table SELECT by OID, never by name", async () => {
    // Casting 'audit.events'::regclass errors with "permission denied for
    // schema audit" when the role has no USAGE there, which made the guard
    // exit 1 instead of skipping the table.
    const { client, queries } = fakeClient([{ schema: "audit", name: "events", rows: 10_001 }], {
      unreadable: new Set(["audit.events"]),
    });
    const r = await countUserRows(client);
    expect(queries[0]!).toContain("has_schema_privilege(n.oid, 'USAGE')");
    expect(queries[0]!).toContain("has_table_privilege(c.oid, 'SELECT')");
    expect(queries.some((q) => q.includes("::regclass"))).toBe(false);
    expect(queries.some((q) => q.includes('"audit"."events"'))).toBe(false);
    expect(r).toMatchObject({ tablesSkipped: 1, tablesScanned: 0, exceeded: false });
  });

  it("caps per-table work so a huge table cannot cause a full scan", async () => {
    const { client, queries } = fakeClient([
      { schema: "public", name: "events", rows: 400_000_000 },
    ]);
    const r = await countUserRows(client);
    expect(r.exceeded).toBe(true);
    // The subquery must carry a LIMIT; without it this is an unbounded
    // count(*) on a 400M-row table, which is exactly what we cannot do.
    const countSql = queries.find((q) => q.includes("select count(*)"))!;
    expect(countSql).toContain(`limit ${ROW_LIMIT + 1}`);
    // And the reported total saturates rather than reporting 400 million.
    expect(r.total).toBe(ROW_LIMIT + 1);
  });

  it("quotes identifiers so odd table names cannot break or inject", async () => {
    const { client, queries } = fakeClient([
      { schema: "public", name: "select", rows: 1 },
      { schema: "Weird Schema", name: 'a"b', rows: 1 },
    ]);
    await countUserRows(client);
    const countSql = queries.find((q) => q.includes("select count(*)"))!;
    expect(countSql).toContain('"public"."select"');
    expect(countSql).toContain('"Weird Schema"."a""b"');
  });

  it("honours a custom limit", async () => {
    const { client } = fakeClient([{ schema: "public", name: "t", rows: 20 }]);
    expect((await countUserRows(client, 10)).exceeded).toBe(true);
    const again = fakeClient([{ schema: "public", name: "t", rows: 20 }]);
    expect((await countUserRows(again.client, 100)).exceeded).toBe(false);
  });
});

describe("safety guard: contract", () => {
  it("pins the published threshold and exit code", () => {
    // Both are documented at satus.sh/docs/how-it-works. Changing either
    // changes a public contract, so make that require editing a test.
    expect(ROW_LIMIT).toBe(10_000);
    expect(E_DB_NOT_EMPTY).toBe(11);
  });

  it("pins every published exit code", () => {
    // CI pipelines branch on these. They are documented on
    // satus.sh/docs/how-it-works and in packages/cli/README.md; a change
    // here is a wire-format change and must be deliberate.
    expect(E_GENERAL).toBe(1);
    expect(E_VALIDATION).toBe(2);
    expect(E_FK_CYCLE).toBe(10);
    expect(E_DB_NOT_EMPTY).toBe(11);
    // No two codes may collide, or a pipeline cannot tell them apart.
    const codes = [E_GENERAL, E_VALIDATION, E_FK_CYCLE, E_DB_NOT_EMPTY];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("refusal message names the cause, the variable, and the escape hatch", () => {
    const msg = guardMessage({ total: 10_001, exceeded: true, tablesScanned: 7, tablesSkipped: 0 });
    expect(msg).toContain("10,000");
    expect(msg).toContain("DATABASE_URL");
    expect(msg).toContain("--force");
  });

  it("mentions skipped tables so an under-count is never silent", () => {
    const msg = guardMessage({ total: 10_001, exceeded: true, tablesScanned: 7, tablesSkipped: 2 });
    expect(msg).toContain("2 table(s) skipped");
  });
});
