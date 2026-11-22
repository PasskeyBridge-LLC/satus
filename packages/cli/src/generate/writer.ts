/**
 * Transactional writer. All inserts for a single `satus generate` run
 * happen inside one BEGIN/COMMIT, so a failure half-way through leaves
 * the database exactly as it was. The writer returns the inserted PK
 * values to the orchestrator so downstream tables can use them as FK
 * targets.
 *
 * We use parameterized multi-row INSERT ... RETURNING. COPY would be
 * faster but it does not return generated PKs, which we need to chain
 * FKs across tables in the same run.
 */
import type { Client } from "pg";
import type { Column, Table } from "./introspect.js";
import { elementUdtName, isArrayColumn } from "./schema.js";

export interface InsertResult {
  inserted: number;
  /** Rows of returned PK columns, in insertion order. */
  returnedPkRows: Array<Record<string, unknown>>;
}

function quoteIdent(s: string): string {
  // Defensive: identifiers come from information_schema (trusted), but we
  // still double-quote so reserved words and mixed case round-trip safely.
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function insertRows(
  client: Client,
  table: Table,
  columnNames: string[],
  rows: Array<Record<string, unknown>>,
  /**
   * Extra columns to RETURN alongside the primary key. The runner passes
   * every column of this table that some other table's FK points at, so a
   * FK referencing a UNIQUE non-PK column (`orders.user_email ->
   * users.email`) can still find its target value in the pool.
   *
   * Before v0.3.7 only PK columns were returned; a FK to a non-PK column
   * read `undefined` off the pooled row, which `serialize()` turned into
   * NULL. A nullable FK column then inserted silently unlinked.
   */
  alsoReturn: string[] = [],
): Promise<InsertResult> {
  if (rows.length === 0) {
    return { inserted: 0, returnedPkRows: [] };
  }

  const colSql = columnNames.map(quoteIdent).join(", ");
  const colByName = new Map(table.columns.map((c) => [c.name, c]));
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let p = 1;
  for (const row of rows) {
    const tuple: string[] = [];
    for (const c of columnNames) {
      tuple.push(`$${p++}`);
      values.push(serializeValue(row[c], colByName.get(c)));
    }
    placeholders.push("(" + tuple.join(", ") + ")");
  }

  // Dedupe while preserving order: a referenced column is often also the PK.
  const returnCols = [...new Set([...table.primaryKey, ...alsoReturn])];
  const returning =
    returnCols.length > 0 ? " returning " + returnCols.map(quoteIdent).join(", ") : "";

  const sql =
    `insert into ${quoteIdent(table.schema)}.${quoteIdent(table.name)} ` +
    `(${colSql}) values ${placeholders.join(", ")}${returning}`;

  const result = await client.query(sql, values);
  return {
    inserted: result.rowCount ?? 0,
    returnedPkRows: result.rows ?? [],
  };
}

/**
 * Coerce model output to a pg-friendly parameter.
 *
 * Postgres array columns get a JavaScript array so the `pg` driver can
 * encode it as an array literal (including quoting, NULLs, and empty
 * arrays). json/jsonb columns still go through JSON.stringify, including
 * when the value is a JSON array.
 */
export function serializeValue(v: unknown, col?: Column): unknown {
  if (v === undefined) return null;
  if (col && isArrayColumn(col) && Array.isArray(v)) {
    const elem = elementUdtName(col);
    return v.map((el) => serializeArrayElement(el, elem));
  }
  if (v !== null && typeof v === "object") {
    return JSON.stringify(v);
  }
  return v;
}

function serializeArrayElement(el: unknown, elementUdt: string): unknown {
  if (el === undefined) return null;
  if (el === null) return null;
  if (Array.isArray(el)) {
    return el.map((inner) => serializeArrayElement(inner, elementUdt));
  }
  if (elementUdt === "json" || elementUdt === "jsonb") {
    return typeof el === "string" ? el : JSON.stringify(el);
  }
  if (typeof el === "object") {
    return JSON.stringify(el);
  }
  return el;
}

/**
 * Empty the run set before seeding it (`satus generate --truncate`).
 *
 * Deliberately **without CASCADE**. Every table in the run set is named in
 * one statement, so Postgres is satisfied whenever the FK graph is closed
 * over that set — the ordinary case. It refuses only when a table *outside*
 * the set references one inside, which is precisely the case where CASCADE
 * would have emptied a table the user never asked us to touch (an audit
 * log, an `exclude`d table, a table in another schema). Through v0.3.6 we
 * passed CASCADE and Postgres carried out that deletion with nothing more
 * than a NOTICE. Refusing is the correct answer; the user can widen the run
 * set or truncate the outside table themselves.
 */
export async function truncate(client: Client, tables: Table[]): Promise<void> {
  if (tables.length === 0) return;
  const names = tables.map((t) => `${quoteIdent(t.schema)}.${quoteIdent(t.name)}`).join(", ");
  // RESTART IDENTITY resets sequences so re-runs produce the same low IDs.
  try {
    await client.query(`truncate ${names} restart identity`);
  } catch (err) {
    // 0A000 (feature_not_supported) is what Postgres raises for
    // "cannot truncate a table referenced in a foreign key constraint".
    const e = err as { code?: string; detail?: string; message?: string };
    if (e.code !== "0A000") throw err;
    throw new Error(
      `--truncate cannot run: a table outside the run set has a foreign key into it. ` +
        `${e.detail ?? e.message ?? ""} `.trim() +
        `\n  satus will not TRUNCATE ... CASCADE, because that would also empty a table ` +
        `you did not ask it to seed.` +
        `\n  Either bring the referencing table into the run set (remove it from "exclude" ` +
        `in satus.config.json), or truncate it yourself first.`,
    );
  }
}

/**
 * Populate a previously-NULLed FK column on already-inserted rows. Used to
 * close soft cycles (see dag.ts BrokenEdge): the child rows landed with
 * NULL in `column`, and now that the parent table is fully seeded we wire
 * each child to a random parent PK.
 *
 * One UPDATE per child row keyed by PK. The row count is bounded by --rows
 * times the number of broken edges, which in practice is one or two.
 */
export async function updateBrokenEdge(
  client: Client,
  childTable: Table,
  column: string,
  parentRefColumn: string,
  parentPkRows: Array<Record<string, unknown>>,
): Promise<number> {
  if (parentPkRows.length === 0 || childTable.primaryKey.length === 0) return 0;
  const pkCols = childTable.primaryKey.map(quoteIdent).join(", ");
  const sel = await client.query(
    `select ${pkCols} from ${quoteIdent(childTable.schema)}.${quoteIdent(childTable.name)} ` +
      `where ${quoteIdent(column)} is null`,
  );
  if (sel.rowCount === 0) return 0;

  let updated = 0;
  for (const row of sel.rows as Array<Record<string, unknown>>) {
    const parent = parentPkRows[Math.floor(Math.random() * parentPkRows.length)]!;
    const where = childTable.primaryKey.map((c, i) => `${quoteIdent(c)} = $${i + 2}`).join(" and ");
    const sql =
      `update ${quoteIdent(childTable.schema)}.${quoteIdent(childTable.name)} ` +
      `set ${quoteIdent(column)} = $1 where ${where}`;
    const params = [parent[parentRefColumn], ...childTable.primaryKey.map((c) => row[c])];
    const r = await client.query(sql, params);
    updated += r.rowCount ?? 0;
  }
  return updated;
}
