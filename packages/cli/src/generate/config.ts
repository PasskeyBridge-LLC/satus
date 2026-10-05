/**
 * satus.config.json — per-project configuration. Lives at the repo root the
 * user runs `satus` from. The file is intentionally small: connection
 * details, reference profile, optional model override. Anything that
 * changes per-run (rows, max-cost, dry-run) stays on the CLI flags.
 *
 * DSN precedence on `satus generate`:
 *   1. --dsn flag
 *   2. SATUS_DATABASE_URL env
 *   3. DATABASE_URL env
 *   4. satus.config.json `databaseUrl` field
 */
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ProfileName } from "./profiles.js";

export const CONFIG_FILE = "satus.config.json";

export const ConfigSchema = z.object({
  /** Postgres connection string. May be overridden by env or --dsn. */
  databaseUrl: z.string().optional(),
  /** Schema to introspect. Defaults to "public". */
  schema: z.string().default("public"),
  /** Reference profile that guides the generator's tone and content. */
  profile: z.enum(["saas", "ecommerce", "b2b"]).default("saas"),
  /**
   * LLM provider. When omitted, the CLI auto-detects from which API key
   * env var is set (OPENAI_API_KEY vs ANTHROPIC_API_KEY). If both are
   * set, the CLI errors and asks the user to be explicit. XAI_API_KEY is
   * only auto-detected when neither of those is set.
   */
  provider: z.enum(["openai", "anthropic", "xai"]).optional(),
  /**
   * Model id. When omitted, falls back to the selected provider's
   * default (gpt-4o-mini for openai, claude-haiku-4-5 for anthropic,
   * grok-4.20-0309-non-reasoning for xai).
   * Cross-provider model names are not validated client-side.
   */
  model: z.string().optional(),
  /** Tables to skip entirely (e.g. audit logs, system tables you manage). */
  exclude: z.array(z.string()).default([]),
  /**
   * v0.3.3 telemetry knobs. All fields are opt-in.
   * `share_failure_fingerprints` sends a SHA-256 of the normalised schema
   * shape and the first-error validator class alongside the run record so
   * the maintainers can build an anonymised eval fixture set for the
   * v0.4.0 agent. Never sends identifiers or row data. Off by default.
   */
  telemetry: z
    .object({
      /**
       * v0.3.11. Master switch for the run record. Off by default, which
       * is what satus.sh/security has always promised and what the CLI
       * did not do until this release: `reportRun` was called
       * unconditionally at the end of every `satus generate`.
       *
       * `SATUS_TELEMETRY=1` enables it without a config file, for CI.
       * `DO_NOT_TRACK=1` overrides both and wins outright.
       */
      enabled: z.boolean().default(false),
      share_failure_fingerprints: z.boolean().default(false),
    })
    .default({ enabled: false, share_failure_fingerprints: false }),
});

export type SatusConfig = z.infer<typeof ConfigSchema>;

export async function loadConfig(cwd = process.cwd()): Promise<SatusConfig | null> {
  const path = resolve(cwd, CONFIG_FILE);
  try {
    await access(path);
  } catch {
    return null;
  }
  const raw = await readFile(path, "utf8");
  const parsed = ConfigSchema.parse(JSON.parse(raw));
  return parsed;
}

export async function writeConfig(cfg: SatusConfig, cwd = process.cwd()): Promise<string> {
  const path = resolve(cwd, CONFIG_FILE);
  await writeFile(path, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  return path;
}

/**
 * Resolve the DSN from precedence chain. Returns null if nothing configured;
 * caller is responsible for surfacing a helpful error.
 */
export function resolveDsn(cli: string | undefined, cfg: SatusConfig | null): string | null {
  return (
    cli ?? process.env.SATUS_DATABASE_URL ?? process.env.DATABASE_URL ?? cfg?.databaseUrl ?? null
  );
}

export function resolveProfile(cli: string | undefined, cfg: SatusConfig | null): ProfileName {
  const v = cli ?? cfg?.profile ?? "saas";
  if (v !== "saas" && v !== "ecommerce" && v !== "b2b") {
    throw new Error(`Unknown profile: ${v}. Use saas | ecommerce | b2b.`);
  }
  return v;
}
