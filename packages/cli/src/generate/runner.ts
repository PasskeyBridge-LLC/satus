/**
 * Orchestrator. Walks the topologically sorted table list and for each
 * table:
 *
 *   1. Builds a JSON schema from the column metadata (see schema.ts).
 *   2. Calls the LLM in batches to produce row dicts.
 *   3. Injects FK values from previously-inserted parents at random.
 *   4. Sends one multi-row INSERT … RETURNING to capture generated PKs.
 *   5. Tracks USD spend against the budget; aborts cleanly on overrun.
 *
 * The whole run is wrapped in a single transaction by the caller (`generate`
 * command) — this module never opens or commits transactions itself.
 */
import pc from "picocolors";
import type { Client } from "pg";
import { assertSupportedTypes, buildRowSchema } from "./schema.js";
import type { Table } from "./introspect.js";
import { CostBudget, type Provider } from "./providers/index.js";
import { profilePrompt, type ProfileName } from "./profiles.js";
import { insertRows, updateBrokenEdge } from "./writer.js";
import { validateTable, type Finding } from "./validate.js";
import { synthesizePkRows } from "./simulate.js";

export interface BatchEvent {
  table: string;
  /** 1-based batch index within the table. */
  batch: number;
  rows: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface RunOptions {
  rowsPerTable: number;
  /** Hard cap on rows per LLM call. Keeps response sizes predictable. */
  batchSize: number;
  profile: ProfileName;
  /**
   * Concrete provider (OpenAI / Anthropic / simulated). Carries its own
   * model id and credentials; the runner stays provider-agnostic.
   */
  provider: Provider;
  maxCostUsd: number;
  dryRun: boolean;
  /**
   * Run the relational validator after each table is generated. Meaningful
   * only when dryRun is true and provider is the simulated provider; the
   * runner still calls it under dryRun + real provider, in which case it
   * validates the model's output instead of the simulator's.
   */
  validate?: boolean;
  /** Soft-cycle back-edges to populate after every table is seeded. */
  brokenEdges?: Array<{ table: string; column: string; refTable: string; refColumn: string }>;
  /**
   * Optional per-batch hook. Fires after every successful LLM call so the
   * CLI can render a verbose breakdown without the runner deciding the
   * presentation. Errors thrown here propagate and abort the run.
   */
  onBatch?: (event: BatchEvent) => void;
}

export interface TablePlan {
  table: string;
  willInsert: number;
  estimatedCostUsd: number;
}

export interface RunReport {
  inserted: Record<string, number>;
  spentUsd: number;
  /** v0.3.0: aggregate token usage across every LLM call in the run. */
  inputTokens: number;
  outputTokens: number;
  /**
   * Populated when RunOptions.validate is true. Empty array means a clean
   * dry-run; non-empty means the validator surfaced at least one issue.
   */
  findings: Finding[];
}

/**
 * Dry-run estimate. Uses a rough heuristic of 80 input tokens per column
 * per row + 40 output tokens per cell. Good enough to choose --rows safely;
 * the real number is logged at the end of a real run.
 *
 * Rates come from the provider the caller built for the *real* run, so an
 * Anthropic dry-run is priced with Anthropic rates. Through v0.3.6 this
 * function hardcoded gpt-4o-mini's $0.15/$0.60, which meant the estimate a
 * user saw before a Claude run and the spend reported after it were priced
 * off two unrelated tables.
 */
export function planRun(tables: Table[], opts: RunOptions): TablePlan[] {
  const ratePerMillionInput = opts.provider.rates.inputPerMTok;
  const ratePerMillionOutput = opts.provider.rates.outputPerMTok;
  return tables.map((t) => {
    const cells = t.columns.length * opts.rowsPerTable;
    const inputTokens = cells * 80;
    const outputTokens = cells * 40;
    const usd =
      (inputTokens / 1_000_000) * ratePerMillionInput +
      (outputTokens / 1_000_000) * ratePerMillionOutput;
    return {
      table: t.name,
      willInsert: opts.rowsPerTable,
      estimatedCostUsd: usd,
    };
  });
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/**
 * For each table in the run set, the columns some other table's FK points
 * at. The writer adds these to its RETURNING list so the pool carries the
 * values children actually need — not every FK targets a primary key.
 */
function referencedColumnsByTable(tables: Table[]): Map<string, string[]> {
  const byTable = new Map<string, Set<string>>();
  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      const set = byTable.get(fk.refTable) ?? new Set<string>();
      set.add(fk.refColumn);
      byTable.set(fk.refTable, set);
    }
  }
  return new Map([...byTable].map(([k, v]) => [k, [...v]]));
}

export async function runGenerate(
  client: Client,
  tables: Table[],
  opts: RunOptions,
): Promise<RunReport> {
  assertSupportedTypes(tables);
  const budget = new CostBudget(opts.maxCostUsd);
  const inserted: Record<string, number> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const findings: Finding[] = [];
  // PK values per table, keyed by table name. Used to satisfy FKs from
  // children later in the run. In dry-run mode this is populated with
  // synthesized PKs so downstream tables still get plausible FK targets.
  const pkPool: Map<string, Array<Record<string, unknown>>> = new Map();
  const referenced = referencedColumnsByTable(tables);

  for (const table of tables) {
    if (budget.exceeded()) {
      throw new Error(
        `Cost budget exceeded ($${budget.spentUsd.toFixed(4)} > $${opts.maxCostUsd}). Aborting before ${table.name}.`,
      );
    }

    process.stdout.write(pc.dim(`  ${table.name} `));

    const remaining = opts.rowsPerTable;
    const allRows: Array<Record<string, unknown>> = [];
    let batchIndex = 0;

    for (let produced = 0; produced < remaining;) {
      const thisBatch = Math.min(opts.batchSize, remaining - produced);
      const rowSchema = buildRowSchema(table, thisBatch);

      const system =
        profilePrompt(opts.profile) +
        " Return ONLY data that conforms to the provided JSON schema. " +
        "Do not narrate. Do not add fields. Do not invent IDs for foreign keys.";

      const user =
        `Generate ${thisBatch} realistic rows for the Postgres table "${table.name}". ` +
        `Columns and their constraints are encoded in the JSON schema. ` +
        `Vary the values; do not repeat row 1 for row N. ` +
        `For status / enum-like text columns, choose values that read as plausible domain vocabulary.`;

      const { data, usage } = await opts.provider.generate<{
        rows: Array<Record<string, unknown>>;
      }>({
        system,
        user,
        jsonSchema: rowSchema.jsonSchema,
      });

      budget.add(usage);
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      batchIndex += 1;
      opts.onBatch?.({
        table: table.name,
        batch: batchIndex,
        rows: thisBatch,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        usd: usage.usd,
      });
      if (budget.exceeded()) {
        throw new Error(
          `Cost budget exceeded mid-table ($${budget.spentUsd.toFixed(4)} > $${opts.maxCostUsd}). Aborting at ${table.name}.`,
        );
      }

      // Inject FK values from parent pools. If the column is nullable and
      // we have no parents, leave it null; otherwise we fail loudly because
      // a NOT NULL FK with no parent rows is a planning bug.
      for (const row of data.rows) {
        for (const fk of rowSchema.fkColumns) {
          if (fk.refTable === table.name) {
            // Self-reference: leave null (caller can wire up post-hoc).
            row[fk.column] = null;
            continue;
          }
          const parents = pkPool.get(fk.refTable);
          if (!parents || parents.length === 0) {
            const col = table.columns.find((c) => c.name === fk.column);
            if (col?.isNullable) {
              row[fk.column] = null;
            } else {
              throw new Error(
                `No parent rows available for ${table.name}.${fk.column} -> ${fk.refTable}.${fk.refColumn}. ` +
                  `Check that ${fk.refTable} is in the run set and not excluded.`,
              );
            }
            continue;
          }
          const parent = pickRandom(parents);
          // A missing key means the parent's referenced column never made
          // it into the pool. Historically this fell through to undefined,
          // which the writer serialized to NULL — a nullable FK column then
          // inserted silently unlinked and nobody found out. Fail instead.
          if (!(fk.refColumn in parent)) {
            throw new Error(
              `Cannot resolve ${table.name}.${fk.column} -> ${fk.refTable}.${fk.refColumn}: ` +
                `column "${fk.refColumn}" is absent from the seeded rows of ${fk.refTable} ` +
                `(available: ${Object.keys(parent).join(", ") || "none"}). ` +
                `This is a satus bug — please report the schema at https://satus.sh/support.`,
            );
          }
          row[fk.column] = parent[fk.refColumn];
        }
      }

      allRows.push(...data.rows);
      produced += thisBatch;
      process.stdout.write(pc.dim("."));
    }

    if (opts.dryRun) {
      // Validator runs against the same rows the writer would have sent
      // to Postgres. Findings are accumulated on the report; the CLI
      // decides exit code from there.
      if (opts.validate) {
        const tableFindings = validateTable(table, { rows: allRows, pkPool });
        findings.push(...tableFindings);
      }
      // Without DB inserts there is no RETURNING to seed the PK pool, so
      // children would have no FK targets. Synthesize PKs that match the
      // table's actual PK column types and the simulator's deterministic
      // counter, so the FK existence check in validate.ts sees the same
      // values the runner injects into child rows.
      const synthetic = synthesizePkRows(table, allRows, referenced.get(table.name) ?? []);
      if (synthetic.length > 0) pkPool.set(table.name, synthetic);
      inserted[table.name] = 0;
      process.stdout.write(pc.yellow(" (dry-run)\n"));
      continue;
    }

    const result = await insertRows(
      client,
      table,
      buildRowSchema(table, 1).insertColumns,
      allRows,
      referenced.get(table.name) ?? [],
    );
    inserted[table.name] = result.inserted;
    pkPool.set(table.name, result.returnedPkRows);
    process.stdout.write(pc.green(` ${result.inserted}\n`));
  }

  // Soft-cycle close-out. Each broken edge corresponds to a child table that
  // was inserted with NULL in `column` because its parent hadn't been seeded
  // yet (the dependency was a cycle back-edge). Now that every table is
  // populated, wire the children to random parent PKs. Failures here roll
  // back the whole transaction along with the inserts.
  if (!opts.dryRun && opts.brokenEdges && opts.brokenEdges.length > 0) {
    const byName = new Map(tables.map((t) => [t.name, t]));
    for (const edge of opts.brokenEdges) {
      const child = byName.get(edge.table);
      const parents = pkPool.get(edge.refTable) ?? [];
      if (!child || parents.length === 0) continue;
      const n = await updateBrokenEdge(client, child, edge.column, edge.refColumn, parents);
      if (n > 0) {
        process.stdout.write(
          pc.dim(`  wired ${edge.table}.${edge.column} -> ${edge.refTable} (${n} rows)\n`),
        );
      }
    }
  }

  return {
    inserted,
    spentUsd: budget.spentUsd,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    findings,
  };
}
