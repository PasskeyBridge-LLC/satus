/**
 * `satus generate` — the headline command. Connects to Postgres, introspects
 * the target schema, sorts tables by FK dependency, asks the LLM for rows,
 * and writes them in a single transaction.
 *
 * License gating:
 *   - Free tier: max 25 rows/table, max 5 tables. Enough to demo the value;
 *     not enough to seed a real staging DB.
 *   - Pro / Team: no caps.
 *
 * Cost gating:
 *   - --max-cost USD ceiling. The budget tracks live token usage; if a run
 *     would overshoot, we abort BEFORE committing. The transaction rolls
 *     back so the database is untouched.
 */
import { Command } from "commander";
import pc from "picocolors";
import { Client } from "pg";
import { loadConfig, resolveDsn, resolveProfile } from "../generate/config.js";
import { introspect } from "../generate/introspect.js";
import { topoSort } from "../generate/dag.js";
import { runGenerate, planRun } from "../generate/runner.js";
import { truncate } from "../generate/writer.js";
import { newRunId, reportRun, classifyError, configureTelemetry } from "../generate/telemetry.js";
import { countUserRows, guardMessage, ROW_LIMIT } from "../generate/guard.js";
import { E_DB_NOT_EMPTY, E_FK_CYCLE } from "../exit-codes.js";
import { fingerprint } from "../generate/fingerprint.js";
import { currentLicense } from "../license.js";
import {
  createOpenAiProvider,
  createAnthropicProvider,
  createXaiProvider,
} from "../generate/providers/index.js";
import type { Provider } from "../generate/providers/index.js";
import { createSimulatedProvider } from "../generate/simulate.js";
import { groupFindings } from "../generate/validate.js";

export type ProviderId = "openai" | "anthropic" | "xai";

const PROVIDER_IDS: readonly ProviderId[] = ["openai", "anthropic", "xai"];

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: "gpt-4o-mini",
  // Pinned 2026-06-20 from Anthropic's model lineup. Override with
  // --model or the `model` field in satus.config.json.
  anthropic: "claude-haiku-4-5",
  // Pinned 2026-09-26 from xAI's /v1/models. Non-reasoning, so no
  // reasoning-token spend on a structured-output job.
  xai: "grok-4.20-0309-non-reasoning",
};

export const PROVIDER_ENV: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
};

/**
 * Resolve the active provider id from (in order): explicit flag, config
 * file, env-var auto-detect. Errors clearly when both keys are set with
 * no explicit choice, so a user never wonders which provider just spent
 * their budget.
 *
 * xAI auto-detect is deliberately last and only fires when neither
 * OPENAI_API_KEY nor ANTHROPIC_API_KEY is set. A user who already had
 * XAI_API_KEY exported for another tool keeps exactly the provider they
 * had before xai existed; `--provider xai` always works.
 */
export function resolveProviderId(
  cliProvider: string | undefined,
  cfgProvider: ProviderId | undefined,
): ProviderId {
  if (cliProvider) {
    if (!(PROVIDER_IDS as readonly string[]).includes(cliProvider)) {
      throw new Error(`Unknown --provider: ${cliProvider}. Use openai | anthropic | xai.`);
    }
    return cliProvider as ProviderId;
  }
  if (cfgProvider) return cfgProvider;

  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  if (hasOpenAi && hasAnthropic) {
    throw new Error(
      "Both OPENAI_API_KEY and ANTHROPIC_API_KEY are set. Pass `--provider openai|anthropic` " +
        "or set `provider` in satus.config.json so we know which one to use.",
    );
  }
  if (hasAnthropic) return "anthropic";
  if (!hasOpenAi && process.env.XAI_API_KEY) return "xai";
  // Default to openai when neither is set so the existing
  // "OPENAI_API_KEY is not set" error keeps firing (backward compat
  // with v0.2.0's error message).
  return "openai";
}

function buildProvider(id: ProviderId, apiKey: string, model: string): Provider {
  if (id === "anthropic") return createAnthropicProvider({ apiKey, model });
  if (id === "xai") return createXaiProvider({ apiKey, model });
  return createOpenAiProvider({ apiKey, model });
}

const FREE_MAX_ROWS = 25;
const FREE_MAX_TABLES = 5;

/**
 * v0.3.3 telemetry: derive the invocation shape from process.argv without
 * ever including flag values. Bounded to 16 entries so a pathological
 * argv can't blow the payload cap.
 */
function invocationSequence(): string[] {
  const seq: string[] = [];
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) {
      // Strip `--flag=value` -> `--flag`.
      const eq = arg.indexOf("=");
      seq.push(eq === -1 ? arg : arg.slice(0, eq));
    } else if (arg.startsWith("-") && arg.length === 2) {
      seq.push(arg);
    } else if (seq.length === 0) {
      // Positional subcommand (e.g. "generate"). Everything after the first
      // positional is a flag value and gets dropped.
      seq.push(arg);
    }
    if (seq.length >= 16) break;
  }
  return seq;
}

export function registerGenerate(program: Command): void {
  program
    .command("generate")
    .description("Generate seed data for the configured database")
    .option("--profile <name>", "reference profile (saas | ecommerce | b2b)")
    .option("--rows <n>", "rows to generate per table", "50")
    .option("--max-cost <usd>", "abort if estimated LLM spend exceeds this", "1.00")
    .option("--batch-size <n>", "rows per LLM call", "25")
    .option("--dsn <url>", "Postgres connection string (overrides config + env)")
    .option("--schema <name>", "Postgres schema to seed (overrides config)")
    .option(
      "--provider <id>",
      "LLM provider (openai | anthropic | xai); auto-detected from env when omitted",
    )
    .option("--model <id>", "model id (overrides config; falls back to the provider default)")
    .option("--truncate", "truncate target tables before inserting")
    .option(
      "--force",
      `bypass the ${ROW_LIMIT.toLocaleString()}-row safety guard (exit ${E_DB_NOT_EMPTY} when it trips)`,
    )
    .option(
      "--dry-run",
      "simulate LLM output and run relational validation without writing rows or spending credits",
    )
    .option("-v, --verbose", "print per-batch token + cost breakdown")
    .option(
      "--json",
      "emit a single machine-readable JSON object on stdout (human output goes to stderr)",
    )
    .action(async (opts) => {
      // --json mode contract: stdout MUST contain exactly one JSON object
      // when the run finishes, so every human-readable byte gets routed to
      // stderr. We capture the real stdout write first to use for the
      // final JSON emission. Saves threading a logger through every site.
      const jsonMode = Boolean(opts.json);
      const realStdoutWrite = process.stdout.write.bind(process.stdout);
      if (jsonMode) {
        const stderrWrite = process.stderr.write.bind(process.stderr);
        (process.stdout as unknown as { write: typeof process.stdout.write }).write =
          stderrWrite as unknown as typeof process.stdout.write;
        console.log = (...args: unknown[]) =>
          stderrWrite(args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n");
      }
      const verbose = Boolean(opts.verbose);
      const cfg = await loadConfig();
      const dsn = resolveDsn(opts.dsn, cfg);
      if (!dsn) {
        console.error(
          pc.red("No database connection configured.") +
            "\n  Pass --dsn, set $DATABASE_URL, or run `satus init`.",
        );
        process.exit(1);
      }

      let providerId: ProviderId;
      try {
        providerId = resolveProviderId(opts.provider, cfg?.provider);
      } catch (err) {
        console.error(pc.red((err as Error).message));
        process.exit(1);
      }

      const apiKeyEnv = PROVIDER_ENV[providerId];
      const apiKey = process.env[apiKeyEnv];
      if (!apiKey && !opts.dryRun) {
        console.error(
          pc.red(`${apiKeyEnv} is not set.`) +
            `\n  Export it before running, or pass --dry-run to plan without calling the model.`,
        );
        process.exit(1);
      }

      const { license, note: licenseNote } = await currentLicense();
      if (licenseNote) console.log(pc.yellow(`! ${licenseNote}`));
      const isPaid = license?.valid && (license.plan === "pro" || license.plan === "team");
      const requestedRows = Number(opts.rows);
      const rowsPerTable = isPaid ? requestedRows : Math.min(requestedRows, FREE_MAX_ROWS);
      if (!isPaid && requestedRows > FREE_MAX_ROWS) {
        console.log(
          pc.yellow(
            `! Free tier capped at ${FREE_MAX_ROWS} rows/table (you asked for ${requestedRows}).`,
          ) + pc.dim(" Run `satus activate <key>` to unlock."),
        );
      }

      const schemaName = opts.schema ?? cfg?.schema ?? "public";
      const profile = resolveProfile(opts.profile, cfg);
      const model = opts.model ?? cfg?.model ?? DEFAULT_MODELS[providerId];
      const exclude = cfg?.exclude ?? [];

      // Hosted Postgres (Supabase, Neon, RDS) terminates TLS with certs that
      // node-postgres can't verify out of the box. If the DSN asks for SSL or
      // points at a known managed host, enable TLS without strict CA check.
      const wantsSsl =
        /\bsslmode=(require|verify-ca|verify-full|prefer)\b/i.test(dsn) ||
        /(supabase\.co|neon\.tech|rds\.amazonaws\.com|render\.com)/i.test(dsn);
      const client = new Client({
        connectionString: dsn,
        ...(wantsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      });
      try {
        await client.connect();
      } catch (err) {
        console.error(pc.red("Failed to connect to Postgres: ") + (err as Error).message);
        process.exit(1);
      }

      try {
        // Safety guard, before anything else touches the database. Documented
        // at https://satus.sh/docs/how-it-works: a database already holding
        // more than ROW_LIMIT rows is almost never the one you meant to seed.
        //
        // Skipped for --dry-run, which writes nothing — but a dry run against
        // an over-threshold database still says so, because the whole point of
        // a dry run is to learn what the real run would do.
        if (!opts.force) {
          const guard = await countUserRows(client);
          if (guard.exceeded) {
            if (opts.dryRun) {
              console.log(
                pc.yellow(
                  `  ! this database holds more than ${ROW_LIMIT.toLocaleString()} rows; ` +
                    `a real run would be refused (exit ${E_DB_NOT_EMPTY}). Use --force to override.`,
                ),
              );
            } else {
              console.error(pc.red(guardMessage(guard)));
              await client.end().catch(() => {});
              process.exit(E_DB_NOT_EMPTY);
            }
          }
        }

        const schema = await introspect(client, schemaName, exclude);
        if (schema.tables.length === 0) {
          console.error(pc.red(`No tables found in schema "${schemaName}".`));
          process.exit(1);
        }

        // v0.3.3: opt-in schema fingerprint. Computed here so it's
        // available for both the dry-run failure path and the real-run
        // telemetry. Off by default; never contains identifiers or rows.
        const shareFp = cfg?.telemetry?.share_failure_fingerprints === true;
        const schemaFingerprint = shareFp ? fingerprint(schema) : undefined;
        const invocation = shareFp ? invocationSequence() : undefined;

        // v0.3.11: latch the run-record switch before anything can report.
        // Off unless the user opted in via satus.config.json or
        // SATUS_TELEMETRY; DO_NOT_TRACK overrides both. Every reportRun
        // call below is a no-op until this says otherwise.
        configureTelemetry(cfg?.telemetry?.enabled);

        const sort = topoSort(schema.tables);
        if (sort.cycle) {
          console.error(
            pc.red("FK cycle detected with no nullable back-edge: ") +
              sort.cycle.join(", ") +
              "\n  satus v0.2 breaks cycles by NULLing a nullable back-edge column and populating" +
              "\n  it after every table is seeded. None of the cycle FKs are nullable, so the" +
              "\n  cycle cannot be broken without violating NOT NULL." +
              "\n  Fix: make one of the FK columns nullable, or `exclude` one of the tables in" +
              "\n  satus.config.json and re-run.",
          );
          // Documented as E_FK_CYCLE so CI can tell an unseedable schema from
          // a run that failed for some other reason. Nothing was written.
          process.exit(E_FK_CYCLE);
        }

        let ordered = sort.order;
        if (!isPaid && ordered.length > FREE_MAX_TABLES) {
          console.log(
            pc.yellow(
              `! Free tier capped at ${FREE_MAX_TABLES} tables (schema has ${ordered.length}).`,
            ) + pc.dim(" Run `satus activate <key>` to unlock all tables."),
          );
          ordered = ordered.slice(0, FREE_MAX_TABLES);
        }

        // brokenEdges may reference tables we trimmed off the free-tier cap;
        // filter so the runner never tries to UPDATE a table it never wrote.
        const includedNames = new Set(ordered.map((t) => t.name));
        const brokenEdges = sort.brokenEdges.filter(
          (e) => includedNames.has(e.table) && includedNames.has(e.refTable),
        );

        console.log(pc.bold(`\nsatus generate`));
        console.log(pc.dim(`  schema:   ${schemaName}`));
        console.log(pc.dim(`  profile:  ${profile}`));
        console.log(pc.dim(`  provider: ${providerId}`));
        console.log(pc.dim(`  model:    ${model}`));
        console.log(pc.dim(`  rows:     ${rowsPerTable} per table`));
        console.log(pc.dim(`  tables:   ${ordered.map((t) => t.name).join(" -> ")}`));
        if (brokenEdges.length > 0) {
          console.log(
            pc.dim(`  cycles:   `) +
              brokenEdges
                .map((e) => `${e.table}.${e.column} -> ${e.refTable} (deferred)`)
                .join(", "),
          );
        }
        console.log();

        if (opts.dryRun) {
          // Phase 1 — cost estimate against the user-selected real provider's
          // pricing. Shapes the answer to "what would this run cost if I took
          // --dry-run off?" without spending anything.
          const planProvider = buildProvider(providerId, apiKey ?? "", model);
          const plan = planRun(ordered, {
            rowsPerTable,
            batchSize: Number(opts.batchSize),
            profile,
            provider: planProvider,
            maxCostUsd: Number(opts.maxCost),
            dryRun: true,
          });
          let total = 0;
          for (const p of plan) {
            console.log(
              `  ${p.table.padEnd(28)} ${String(p.willInsert).padStart(6)} rows` +
                pc.dim(`  ~$${p.estimatedCostUsd.toFixed(4)}`),
            );
            total += p.estimatedCostUsd;
          }
          console.log(pc.bold(`\n  estimated cost: $${total.toFixed(4)}`));
          if (total > Number(opts.maxCost)) {
            console.log(
              pc.yellow(`  ! exceeds --max-cost $${opts.maxCost}; raise the cap or lower --rows.`),
            );
          }

          // Phase 2 — simulated execution + relational validation. The
          // simulated provider is offline (no API key, no spend), but the
          // runner code path is identical to a real run: same topo order,
          // same FK injection, same broken-edge handling. Findings reflect
          // what the database would have rejected.
          console.log(pc.bold("\n  simulating + validating..."));
          const simulated = await runGenerate(client, ordered, {
            rowsPerTable,
            batchSize: Number(opts.batchSize),
            profile,
            provider: createSimulatedProvider(),
            // Cost budget is meaningless for the simulator; disable it so
            // a too-small --max-cost can't abort an offline validation run.
            maxCostUsd: Number.POSITIVE_INFINITY,
            dryRun: true,
            validate: true,
            brokenEdges,
          });

          const groups = groupFindings(simulated.findings);
          const errorCount = simulated.findings.filter((f) => f.severity === "error").length;
          const warnCount = simulated.findings.length - errorCount;

          if (groups.length === 0) {
            console.log(pc.green(`\n  ✓ no validation findings across ${ordered.length} tables`));
          } else {
            console.log(
              pc.bold("\n  findings: ") +
                (errorCount > 0 ? pc.red(`${errorCount} error`) : pc.dim("0 error")) +
                pc.dim(" / ") +
                (warnCount > 0 ? pc.yellow(`${warnCount} warn`) : pc.dim("0 warn")),
            );
            for (const g of groups) {
              const tag = g.severity === "error" ? pc.red("  error") : pc.yellow("  warn ");
              const where = g.column ? `${g.table}.${g.column}` : g.table;
              const sample =
                g.sampleRows.length > 0
                  ? pc.dim(
                      `  rows[${g.sampleRows.join(",")}${g.count > g.sampleRows.length ? "+" : ""}]`,
                    )
                  : "";
              console.log(
                `${tag} ${where.padEnd(36)} ${g.rule.padEnd(18)} x${g.count}${sample}\n         ${pc.dim(g.sampleMessage)}`,
              );
            }
          }

          if (jsonMode) {
            const payload = {
              status: errorCount > 0 ? ("dry_run_invalid" as const) : ("dry_run" as const),
              provider: providerId,
              model,
              profile,
              target_schema: schemaName,
              tables: plan.map((p) => ({
                name: p.table,
                will_insert: p.willInsert,
                estimated_cost_usd: Number(p.estimatedCostUsd.toFixed(6)),
              })),
              estimated_total_cost_usd: Number(total.toFixed(6)),
              max_cost_usd: Number(opts.maxCost),
              validation: {
                error_count: errorCount,
                warn_count: warnCount,
                findings: simulated.findings,
              },
            };
            realStdoutWrite(JSON.stringify(payload) + "\n");
          }

          // Surface validation failures as a non-zero exit so CI gates work.
          if (errorCount > 0) {
            // v0.3.3: fingerprint + validator_class telemetry (opt-in).
            // Fire-and-forget; dry-run itself never depends on the network.
            if (shareFp) {
              const firstError = simulated.findings.find((f) => f.severity === "error");
              await reportRun(newRunId(), {
                profile,
                provider: providerId,
                model,
                table_count: ordered.length,
                environment: (process.env.SATUS_ENV === "live" ? "live" : "dev") as "dev" | "live",
                status: "failed",
                error_class: "dry_run_validation_failed",
                schema_fingerprint: schemaFingerprint,
                validator_class: firstError?.rule?.slice(0, 64),
                invocation_sequence: invocation,
              });
            }
            process.exit(2);
          }
          return;
        }

        const runId = newRunId();
        const startedAt = Date.now();
        const env = (process.env.SATUS_ENV === "live" ? "live" : "dev") as "dev" | "live";
        // Every field here is one the published privacy promise names.
        // Table names and the schema name are deliberately absent; see the
        // header of generate/telemetry.ts before adding anything.
        const baseTelemetry = {
          profile,
          provider: providerId,
          model,
          table_count: ordered.length,
          environment: env,
          // v0.3.3 opt-in fields (undefined when the knob is off).
          schema_fingerprint: schemaFingerprint,
          invocation_sequence: invocation,
        };
        await reportRun(runId, { ...baseTelemetry, status: "running" });

        await client.query("begin");
        try {
          if (brokenEdges.length > 0) {
            await client.query("set constraints all deferred");
          }
          if (opts.truncate) {
            console.log(pc.dim("  truncating target tables..."));
            await truncate(client, ordered);
          }
          const provider = buildProvider(providerId, apiKey!, model);
          const report = await runGenerate(client, ordered, {
            rowsPerTable,
            batchSize: Number(opts.batchSize),
            profile,
            provider,
            maxCostUsd: Number(opts.maxCost),
            dryRun: false,
            brokenEdges,
            onBatch: verbose
              ? (ev) =>
                  // Stable, parseable line shape: `verbose  table batch=N
                  // rows=R in=I out=O $0.XXXX`. Routed through console.log
                  // so --json mode redirects it to stderr.
                  console.log(
                    pc.dim(
                      `  · ${ev.table.padEnd(28)} batch=${ev.batch} rows=${ev.rows} ` +
                        `in=${ev.inputTokens} out=${ev.outputTokens} $${ev.usd.toFixed(4)}`,
                    ),
                  )
              : undefined,
          });

          await client.query("commit");
          const total = Object.values(report.inserted).reduce((a, b) => a + b, 0);
          const durationMs = Date.now() - startedAt;
          console.log(
            pc.green(
              `\n✓ inserted ${total} rows across ${Object.keys(report.inserted).length} tables`,
            ),
          );
          console.log(
            pc.dim(
              `  tokens: ${report.inputTokens} in / ${report.outputTokens} out` +
                `   spent: $${report.spentUsd.toFixed(4)}`,
            ),
          );
          const tablesReport = Object.entries(report.inserted).map(([name, rows_generated]) => ({
            name,
            rows_generated,
          }));
          await reportRun(runId, {
            ...baseTelemetry,
            status: "success",
            total_rows: total,
            total_cost_usd: Number(report.spentUsd.toFixed(6)),
            input_tokens: report.inputTokens,
            output_tokens: report.outputTokens,
            duration_ms: durationMs,
          });

          if (jsonMode) {
            // The contract documented in the README + llms.txt. snake_case
            // matches the telemetry payload and Postgres column names.
            const payload = {
              run_id: runId,
              status: "success" as const,
              provider: providerId,
              model,
              profile,
              target_schema: schemaName,
              tables: tablesReport,
              total_rows: total,
              total_cost_usd: Number(report.spentUsd.toFixed(6)),
              input_tokens: report.inputTokens,
              output_tokens: report.outputTokens,
              duration_ms: durationMs,
            };
            realStdoutWrite(JSON.stringify(payload) + "\n");
          }
        } catch (err) {
          const durationMs = Date.now() - startedAt;
          await client.query("rollback").catch(() => {});
          const errorMessage = (err as Error).message?.slice(0, 1900);
          await reportRun(runId, {
            ...baseTelemetry,
            status: "failed",
            // Classified, not verbatim: raw Postgres errors embed column
            // names and offending row values. The full message still goes
            // to the user's own stderr and --json stdout below.
            error_class: classifyError(err),
            duration_ms: durationMs,
          });
          if (jsonMode) {
            const payload = {
              run_id: runId,
              status: "failed" as const,
              provider: providerId,
              model,
              profile,
              target_schema: schemaName,
              duration_ms: durationMs,
              error_message: errorMessage,
            };
            realStdoutWrite(JSON.stringify(payload) + "\n");
          }
          throw err;
        }
      } finally {
        await client.end().catch(() => {});
      }
    });
}
