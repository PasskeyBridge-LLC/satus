/**
 * Fixtures for checks 9 and 10 in scripts/validate-docs.mjs. Each "before"
 * fixture is the text that was live on satus.sh before the fix; each must
 * fail. The current files must pass.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkExitCodeDenials,
  checkNodeClaims,
  ciNodeMatrix,
  ciOperatingSystems,
  enginesFloor,
} from "../../scripts/docs-parity.mjs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const CLI_CI = read(".github/workflows/cli-ci.yml");
const facts = {
  matrix: ciNodeMatrix(CLI_CI)!,
  oses: ciOperatingSystems(CLI_CI),
  floor: enginesFloor(JSON.parse(read("packages/cli/package.json")).engines.node)!,
};
const list = { ...facts, requireList: true, requireFloor: false };

/* Live on /quickstart and /docs/troubleshooting through 2026-11-13. */
const QUICKSTART_BEFORE = `<p>
  satus ships as a single Node binary. We test on Node 20 and 22 across macOS and Linux.
  Windows is supported via WSL2.
</p>`;
const TROUBLESHOOTING_BEFORE = `a: "Node 20 and 22 on macOS and Linux (the package declares engines >=20). Windows is supported via WSL2. Older Node versions are not tested and will likely fail at install or first run.",`;

/* Live on /cli until 2026-11-10 (src/routes/cli.tsx at 21ae09d). */
const CLI_EXIT_CODES_BEFORE = `<p>
  Every command returns <code>0</code> on success and <code>1</code> on any error, with a
  one-line diagnostic written to stderr. Stable per-failure-mode exit codes are planned
  for a future minor release; today, scripts that need to branch on failure should match
  the stderr message.
</p>`;

describe("ground truth parsed from the repo", () => {
  it("reads the cli-ci.yml matrix, its OS and the engines floor", () => {
    expect(facts.matrix).toEqual([20, 22, 24, 26]);
    expect([...facts.oses]).toEqual(["Linux"]);
    expect(facts.floor).toBe(20);
  });
});

describe("check 9: Node lines, OS and floor", () => {
  it("fails the old /quickstart sentence", () => {
    const f = checkNodeClaims("quickstart", QUICKSTART_BEFORE, list);
    expect(f.some((m) => m.includes("names Node 20, 22"))).toBe(true);
    expect(f.some((m) => m.includes("tested on macOS"))).toBe(true);
  });

  it("fails the old /docs/troubleshooting answer", () => {
    const f = checkNodeClaims("troubleshooting", TROUBLESHOOTING_BEFORE, list);
    expect(f.some((m) => m.includes("names Node 20, 22"))).toBe(true);
    expect(f.some((m) => m.includes("tested on macOS"))).toBe(true);
  });

  it("fails a page that drops the tested lines altogether", () => {
    expect(checkNodeClaims("quickstart", "<p>satus ships as a Node binary.</p>", list)).toEqual([
      "quickstart: does not name the Node lines cli-ci.yml tests (20, 22, 24, 26)",
    ]);
  });

  it("fails a floor that differs from engines.node", () => {
    const opts = { ...facts, requireList: false, requireFloor: true };
    expect(checkNodeClaims("README", "Requires Node.js 20+.", opts)).toEqual([]);
    expect(checkNodeClaims("README", "Requires Node.js 18+.", opts)).toEqual([
      "README: says Node 18+; engines.node floor is 20",
    ]);
    expect(checkNodeClaims("README", "Requires Node.js.", opts)).toEqual([
      "README: does not name the Node floor (20+)",
    ]);
  });

  it("passes the current /quickstart, /docs/troubleshooting and CLI README", () => {
    expect(checkNodeClaims("q", read("src/routes/quickstart.tsx"), list)).toEqual([]);
    expect(checkNodeClaims("t", read("src/routes/docs.troubleshooting.tsx"), list)).toEqual([]);
    expect(
      checkNodeClaims("r", read("packages/cli/README.md"), {
        ...facts,
        requireList: false,
        requireFloor: true,
      }),
    ).toEqual([]);
  });
});

describe("check 10: pages that deny the exit codes", () => {
  const codes = new Set([1, 2, 10, 11]);

  it("fails the old /cli operational note on both sentences", () => {
    const f = checkExitCodeDenials("cli", CLI_EXIT_CODES_BEFORE, codes);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain("returns 0 on success and 1 on any error");
    expect(f[1]).toContain("exit codes are planned");
  });

  it("fails 'only 0 and 1' phrasing", () => {
    expect(checkExitCodeDenials("x", "satus exits with only 0 or 1.", codes)).toHaveLength(1);
  });

  it("stays quiet when exit-codes.ts exports no code but 1", () => {
    expect(checkExitCodeDenials("cli", CLI_EXIT_CODES_BEFORE, new Set([1]))).toEqual([]);
  });

  it("passes the current /cli page", () => {
    expect(checkExitCodeDenials("cli", read("src/routes/cli.tsx"), codes)).toEqual([]);
  });
});
