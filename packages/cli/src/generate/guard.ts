/**
 * Production-database safety guard.
 *
 * `satus generate` writes rows. The single mistake most likely to hurt is
 * pointing `DATABASE_URL` at production and finding out afterwards. This
 * module is the one confirmation prompt between a user and that mistake,
 * expressed as a refusal and an exit code rather than an interactive
 * question (the CLI has to work unattended in CI).
 *
 * The rule, as published at https://satus.sh/docs/how-it-works:
 *
 *   Count rows in every table outside pg_catalog, information_schema and
 *   pg_toast. Refuse to run if the total exceeds 10,000. `--force`
 *   bypasses. A guard trip exits 11 (E_DB_NOT_EMPTY) so CI can tell
 *   "refused to run" from "tried and failed".
 *
 * Two things it is deliberately not: a permission check (Postgres roles do
 * that better) and a rollback mechanism (the single transaction does that).
 *
 * ## Why the counting is shaped this way
 *
 * A naive `count(*)` per table is unbounded work on exactly the databases
 * we most want to stop — a production table can be hundreds of millions of
 * rows. But we never need the true total: we only need to know whether it
 * exceeds the threshold. So each table is counted through a subquery capped
 * at threshold+1 rows, and the running total short-circuits as soon as it
 * crosses. On production the first large table trips it and we stop; on a
 * dev database every table is tiny and the full pass is trivial.
 *
 * Planner estimates (pg_class.reltuples) would be free, but they are stale
 * between ANALYZEs and report -1 for a never-analyzed table — which is the
 * exact state of a freshly restored production dump. A safety guard that
 * mis-reads a restored production database as empty is worse than no
 * guard, so this counts real rows.
 */
import type { Client } from "pg";

/** Published threshold. Changing this changes a documented contract. */
export const ROW_LIMIT = 10_000;

/** Re-exported for convenience; the contract lives in ../exit-codes.ts. */
export { E_DB_NOT_EMPTY } from "../exit-codes.js";

/**
 * Tables per counting statement. Bounds both the SQL text length and the
 * work done before the running total gets a chance to short-circuit.
 */
const CHUNK = 100;

export interface GuardResult {
  /** Rows counted. Saturates at ROW_LIMIT + 1 when the guard trips. */
  total: number;
  /** True when total exceeds ROW_LIMIT. */
  exceeded: boolean;
  /** Tables the guard was able to read. */
  tablesScanned: number;
  /** Tables skipped because the role lacks SELECT on them. */
  tablesSkipped: number;
}

function quoteIdent(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * Candidate tables.
 *
 * relkind 'r' covers ordinary tables *and* partitions. Partitioned parents
 * ('p') are excluded on purpose: their rows physically live in the
 * partitions, so counting both would double every partitioned row and could
 * trip the guard on a database half the stated size.
 *
 * Foreign tables ('f') are excluded too — counting one reaches out to
 * another system, which is not something a safety check should do.
 *
 * The readable flag keeps an unreadable table from turning the guard into
 * a hard error. A role that cannot read a table also cannot be seeding it.
 * It needs USAGE on the schema as well as SELECT on the table, and both
 * checks take OIDs: resolving a schema-qualified name (for example
 * `'audit.events'::regclass`) itself fails with "permission denied for
 * schema" when the role lacks USAGE, which used to exit 1 instead of
 * skipping the table.
 */
const TABLE_LIST_SQL = `
  select n.nspname as schema_name, c.relname as table_name,
         (has_schema_privilege(n.oid, 'USAGE')
          and has_table_privilege(c.oid, 'SELECT')) as readable
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg\\_toast%'
    and n.nspname not like 'pg\\_temp%'
    and n.nspname not like 'pg\\_toast\\_temp%'
  order by n.nspname, c.relname
`;

export async function countUserRows(
  client: Client,
  limit: number = ROW_LIMIT,
): Promise<GuardResult> {
  const res = await client.query<{ schema_name: string; table_name: string; readable: boolean }>(
    TABLE_LIST_SQL,
  );

  // Readability comes back with the table list, so a permission error can
  // never masquerade as a guard failure.
  const readable: Array<{ schema_name: string; table_name: string }> = [];
  let tablesSkipped = 0;
  for (const t of res.rows) {
    if (t.readable === true) readable.push(t);
    else tablesSkipped += 1;
  }

  let total = 0;
  let tablesScanned = 0;

  for (let i = 0; i < readable.length; i += CHUNK) {
    const chunk = readable.slice(i, i + CHUNK);
    // Each table contributes at most limit+1, so one chunk can never scan
    // more than CHUNK * (limit + 1) rows regardless of table size.
    const parts = chunk.map(
      (t) =>
        `(select count(*) from (select 1 from ${quoteIdent(t.schema_name)}.${quoteIdent(
          t.table_name,
        )} limit ${limit + 1}) s)`,
    );
    const sql = `select (${parts.join(" + ")})::bigint as n`;
    const out = await client.query<{ n: string }>(sql);
    total += Number(out.rows[0]?.n ?? 0);
    tablesScanned += chunk.length;
    // Short-circuit: the answer cannot change back once we are over.
    if (total > limit) {
      return { total, exceeded: true, tablesScanned, tablesSkipped };
    }
  }

  return { total, exceeded: total > limit, tablesScanned, tablesSkipped };
}

/**
 * Human-readable refusal. Kept here so the message and the rule that
 * produced it stay in one file.
 */
export function guardMessage(result: GuardResult, limit: number = ROW_LIMIT): string {
  const skipped =
    result.tablesSkipped > 0
      ? ` (${result.tablesSkipped} table(s) skipped — no SELECT privilege)`
      : "";
  return (
    `Refusing to run: this database already holds more than ${limit.toLocaleString()} rows ` +
    `across ${result.tablesScanned} user table(s)${skipped}.\n` +
    `  satus generate writes rows, and a database this full is usually not the one you meant\n` +
    `  to seed. Check DATABASE_URL.\n` +
    `  If it is the right database — a staging environment with real fixtures, say — re-run\n` +
    `  with --force.`
  );
}
