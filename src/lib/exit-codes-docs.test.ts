/**
 * The exit codes listed in /llms.txt, on /cli and in the CLI README match
 * packages/cli/src/exit-codes.ts.
 *
 * Until 2026-11-10 /cli said every command returned only 0 or 1, three
 * releases after 10 and 11 shipped. packages/cli/README.md ships in the
 * npm tarball, so its exit-code table is checked too. The expected list here is built from
 * the module's exports, so adding a code to exit-codes.ts fails this test
 * until /llms.txt, /cli and the CLI README all list it with its constant name.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as exitCodes from "../../packages/cli/src/exit-codes";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/** [name, value] for every exported code, plus success, sorted by value. */
const named: [string, number][] = Object.entries(exitCodes as Record<string, unknown>)
  .filter(([name, value]) => /^E_[A-Z_]+$/.test(name) && typeof value === "number")
  .map(([name, value]): [string, number] => [name, value as number])
  .sort((a, b) => a[1] - b[1]);
const expected = [
  { code: 0, name: undefined as string | undefined },
  ...named.map(([name, code]) => ({ code, name })),
];

function listed(text: string, re: RegExp) {
  return [...text.matchAll(re)].map((m) => ({ code: Number(m[1]), name: m[2] }));
}

describe("documented exit codes match exit-codes.ts", () => {
  it("exit-codes.ts exports the four named codes the docs describe", () => {
    expect(named.map(([n]) => n)).toEqual([
      "E_GENERAL",
      "E_VALIDATION",
      "E_FK_CYCLE",
      "E_DB_NOT_EMPTY",
    ]);
  });

  it("src/content/llms.txt lists every code with its constant name", () => {
    const line = read("src/content/llms.txt")
      .split("\n")
      .find((l) => l.startsWith("- Exit codes:"));
    expect(line, "llms.txt has an '- Exit codes:' line").toBeDefined();
    expect(listed(line!, /`(\d+)`(?: \(`(E_[A-Z_]+)`\))?/g)).toEqual(expected);
  });

  it("the /cli operational notes list every code with its constant name", () => {
    const src = read("src/routes/cli.tsx");
    const from = src.indexOf('id="notes"');
    const to = src.indexOf("</ul>", from);
    expect(from, "cli.tsx has the notes section").toBeGreaterThan(-1);
    expect(to, "the notes section has an exit-code list").toBeGreaterThan(from);
    const items = listed(
      src.slice(from, to),
      /<li>\s*<code>(\d+)<\/code>(?: \(<code>(E_[A-Z_]+)<\/code>\))?:/g,
    );
    expect(items).toEqual(expected);
  });

  it("packages/cli/README.md lists every code with its constant name", () => {
    const readme = read("packages/cli/README.md");
    const from = readme.indexOf("\n## Exit codes\n");
    expect(from, "the CLI README has an Exit codes section").toBeGreaterThan(-1);
    const next = readme.indexOf("\n## ", from + 1);
    const section = readme.slice(from, next === -1 ? undefined : next);
    expect(listed(section, /^\| `(\d+)` \| (?:`(E_[A-Z_]+)`)?/gm)).toEqual(expected);
  });
});
