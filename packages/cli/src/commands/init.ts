/**
 * `satus init` — scaffold satus.config.json in the current working
 * directory. Uses Node's built-in readline so we don't pull a prompt
 * library into the bundle. Existing config is preserved unless --force.
 */
import { Command } from "commander";
import pc from "picocolors";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { CONFIG_FILE, writeConfig, ConfigSchema } from "../generate/config.js";
import { DEFAULT_MODELS } from "./generate.js";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Scaffold satus.config.json in the current directory")
    .option("--force", "overwrite existing satus.config.json")
    .action(async (opts: { force?: boolean }) => {
      const path = resolve(process.cwd(), CONFIG_FILE);
      const exists = await access(path)
        .then(() => true)
        .catch(() => false);
      if (exists && !opts.force) {
        console.error(pc.red(`${CONFIG_FILE} already exists. Use --force to overwrite.`));
        process.exit(1);
      }

      const rl = createInterface({ input: stdin, output: stdout });
      const ask = async (q: string, def: string) => {
        const answer = (await rl.question(`${q} ${pc.dim(`[${def}]`)} `)).trim();
        return answer.length === 0 ? def : answer;
      };

      console.log(pc.bold("\nsatus init\n"));
      const databaseUrl = await ask(
        "Postgres connection string (leave blank to read from $DATABASE_URL):",
        "",
      );
      const schema = await ask("Schema to seed:", "public");
      const profile = await ask("Reference profile (saas | ecommerce | b2b):", "saas");
      const provider = await ask("LLM provider (openai | anthropic | xai):", "openai");
      // Read from DEFAULT_MODELS so init and generate cannot disagree. Until
      // 0.3.13 this was a second copy of the ids, and it would have kept
      // writing gpt-4o-mini into new configs after the default moved.
      const defaultModel =
        provider === "anthropic" || provider === "xai"
          ? DEFAULT_MODELS[provider]
          : DEFAULT_MODELS.openai;
      const model = await ask("Model id:", defaultModel);
      // v0.3.11 opt-in: the run record itself. Off by default, and the
      // prompt says what the record contains so consent means something.
      const telemetryOn = (
        await ask(
          "Send anonymous run records? (provider, model, profile, table count, row/token totals, duration; never schema, table names, or row data) [y/N]:",
          "n",
        )
      )
        .toLowerCase()
        .startsWith("y");
      // v0.3.3 opt-in: anonymised failure fingerprints. Off by default.
      // Wording matches the CLI's other consent surface — plain English,
      // states exactly what leaves the machine and what does not.
      // Only meaningful when the run record is being sent at all.
      const shareFp = telemetryOn
        ? (
            await ask(
              "Also share anonymised failure fingerprints? (SHA-256 of schema shape + validator rule name; never row data or identifiers) [y/N]:",
              "n",
            )
          )
            .toLowerCase()
            .startsWith("y")
        : false;
      rl.close();

      const cfg = ConfigSchema.parse({
        databaseUrl: databaseUrl || undefined,
        schema,
        profile,
        provider,
        model,
        exclude: [],
        telemetry: { enabled: telemetryOn, share_failure_fingerprints: shareFp },
      });
      const written = await writeConfig(cfg);
      console.log(pc.green("\n✓ ") + `wrote ${pc.bold(written)}`);
      const envVar =
        provider === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : provider === "xai"
            ? "XAI_API_KEY"
            : "OPENAI_API_KEY";
      console.log(
        pc.dim(`\nNext: export ${envVar}=... and run \`satus generate --rows 25 --dry-run\``),
      );
    });
}
