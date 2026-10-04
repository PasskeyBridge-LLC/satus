/**
 * Third-party GitHub Actions and the pagila fixture must be pinned to a
 * commit. A floating tag or `master` can change underneath a green CI run.
 */

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const PAGILA_SHA = "9baf49c4149e43229f6021e6218d6b2ac8ef4f34";

function read(rel: string): string {
  return readFileSync(new URL(rel, ROOT), "utf8");
}

describe("supply-chain pins", () => {
  it("pins third-party GitHub Actions to a commit and names the tag", () => {
    const dir = new URL(".github/workflows/", ROOT);
    const files = readdirSync(dir).filter((name) => name.endsWith(".yml"));
    const uses = files.flatMap((name) => {
      const text = readFileSync(new URL(name, dir), "utf8");
      return [...text.matchAll(/^[ \t]*(?:- )?uses:\s+(\S+)(?:\s+#\s*(\S+))?/gm)].map((match) => ({
        file: name,
        ref: match[1] ?? "",
        tag: match[2],
      }));
    });
    const thirdParty = uses.filter((row) => !row.ref.startsWith("./"));
    expect(thirdParty.length).toBeGreaterThan(0);
    for (const row of thirdParty) {
      expect(row.ref, `${row.file} ${row.ref}`).toMatch(/@[0-9a-f]{40}$/);
      expect(row.tag, `${row.file} ${row.ref}`).toMatch(/^v\d+/);
    }
  });

  it("loads pagila from the same commit in the local script and the action self-test", () => {
    const pinned = `pagila/${PAGILA_SHA}/pagila-schema.sql`;
    for (const rel of ["scripts/test-db.sh", ".github/workflows/action-selftest.yml"]) {
      const text = read(rel);
      expect(text, rel).not.toMatch(/pagila\/master\//);
      expect(text, rel).toContain(pinned);
    }
  });
});
