/**
 * packages/action/action.yml passes every input to its shell script through
 * `env:` and reads it as a quoted variable.
 *
 * Through 0.3.12 the script wrote inputs as `${{ inputs.* }}` expressions
 * inside `run:`. GitHub substitutes those into the script text before bash
 * parses it, so an input value could end a quoted string and run a command.
 * These tests run the real script from action.yml under bash, with a stub
 * `satus` on PATH that records the arguments it receives.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTION = readFileSync(new URL("../../packages/action/action.yml", import.meta.url), "utf8");
// The payload the 0.3.13 brief names, and one shaped to close the
// `FLAGS+=(--model "...")` line it lands in so the injected command parses.
const PAYLOAD = '"; echo injected';
const CLOSING_PAYLOAD = 'x"); echo injected; FLAGS+=("';

/** Lines of one YAML block scalar or mapping that starts after `key:` in the run step. */
function stepBlock(key: "env" | "run"): string {
  const lines = ACTION.split("\n");
  const step = lines.findIndex((l) => /^\s*- name: Run satus generate\s*$/.test(l));
  expect(step, "action.yml has the 'Run satus generate' step").toBeGreaterThan(-1);
  const start = lines.findIndex((l, i) => i > step && new RegExp(`^\\s+${key}:`).test(l));
  expect(start, `the step has a ${key} block`).toBeGreaterThan(step);
  const indent = lines[start]!.search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= indent) break;
    body.push(line);
  }
  const strip = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(strip)).join("\n");
}

const declaredInputs = [
  ...(/^inputs:\n([\s\S]*?)\n^outputs:/m.exec(ACTION)?.[1] ?? "").matchAll(/^ {2}([a-z-]+):$/gm),
].map((m) => m[1]!);

const envName = (input: string) => `INPUT_${input.toUpperCase().replace(/-/g, "_")}`;

function runScript(script: string, overrides: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "satus-action-"));
  const argsFile = join(dir, "args");
  const stub = join(dir, "bin", "satus");
  spawnSync("mkdir", ["-p", join(dir, "bin")]);
  writeFileSync(
    stub,
    `#!/usr/bin/env bash\nfor a in "$@"; do printf '%s\\0' "$a"; done > "${argsFile}"\n` +
      `echo '{"status":"dry_run","tables":[]}'\n`,
  );
  chmodSync(stub, 0o755);
  writeFileSync(join(dir, "run.sh"), script);
  const env: Record<string, string> = {
    PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
    GITHUB_OUTPUT: join(dir, "github-output"),
    DATABASE_URL: "postgres://localhost/none",
    INPUT_ROWS: "5",
    INPUT_PROFILE: "saas",
    INPUT_PROVIDER: "",
    INPUT_MODEL: "",
    INPUT_MAX_COST: "1.00",
    INPUT_DRY_RUN: "true",
    INPUT_TRUNCATE: "false",
    INPUT_FORCE: "false",
    INPUT_SATUS_VERSION: "0.0.0",
    ...overrides,
  };
  const res = spawnSync("bash", [join(dir, "run.sh")], { cwd: dir, env, encoding: "utf8" });
  let args: string[] = [];
  try {
    args = readFileSync(argsFile, "utf8").split("\0").slice(0, -1);
  } catch {
    args = [];
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, args };
}

describe("action.yml passes inputs through env", () => {
  const run = stepBlock("run");
  const env = stepBlock("env");

  it("has no inputs expression inside the run script", () => {
    expect(run).not.toMatch(/\$\{\{/);
  });

  it("maps every input the script reads to an INPUT_* variable", () => {
    expect(declaredInputs.length).toBeGreaterThan(5);
    for (const input of declaredInputs) {
      if (input === "database-url" || input === "working-directory") continue;
      expect(env, input).toContain(`${envName(input)}: \${{ inputs.${input} }}`);
      expect(run, input).toContain(`$${envName(input)}`);
    }
    expect(env).toContain("DATABASE_URL: ${{ inputs.database-url }}");
  });

  it("hands a hostile model input to the CLI as one argument without running it", () => {
    for (const payload of [PAYLOAD, CLOSING_PAYLOAD]) {
      const res = runScript(run, { INPUT_MODEL: payload, INPUT_PROVIDER: payload });
      expect(res.status, res.stderr).toBe(0);
      expect(res.args[0]).toBe("generate");
      expect(res.args[res.args.indexOf("--model") + 1]).toBe(payload);
      expect(res.args[res.args.indexOf("--provider") + 1]).toBe(payload);
      expect(res.stdout.split("\n")).not.toContain("injected");
      expect(res.stderr.split("\n")).not.toContain("injected");
    }
  });

  it("keeps the flag list and defaults the CLI saw in 0.3.12", () => {
    const res = runScript(run, {});
    expect(res.args).toEqual([
      "generate",
      "--json",
      "--rows",
      "5",
      "--profile",
      "saas",
      "--max-cost",
      "1.00",
      "--dry-run",
    ]);
  });

  it("shows what pasting the value into the script text did before 0.3.13", () => {
    // GitHub replaced `--model "${{ inputs.model }}"` with the raw value and
    // then handed the text to bash. The brief's payload leaves an unmatched
    // quote, so the step dies before satus runs; a payload that closes the
    // line runs its command.
    const paste = (value: string) => run.replace(`--model "$INPUT_MODEL"`, `--model "${value}"`);
    const broken = runScript(paste(PAYLOAD), { INPUT_MODEL: "x" });
    expect(broken.status).not.toBe(0);
    expect(broken.args).toEqual([]);
    const ran = runScript(paste(CLOSING_PAYLOAD), { INPUT_MODEL: "x" });
    expect(ran.stdout.split("\n")).toContain("injected");
  });
});
