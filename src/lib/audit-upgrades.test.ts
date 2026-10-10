/**
 * The bun audit findings that have a non-breaking fix must not come back
 * as the versions this lockfile used to resolve. Vitest's critical
 * advisory has no 2.x patch; 3.2.7 is the fix that still runs this suite.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lock = readFileSync(new URL("../../bun.lock", import.meta.url), "utf8");

function versions(name: string): string[] {
  return [...lock.matchAll(new RegExp(`"${name}@([^"]+)"`, "g"))].map((match) => match[1] ?? "");
}

describe("audit upgrades in the lockfile", () => {
  it("resolves the patched versions and drops the ones bun audit named", () => {
    expect(versions("vitest").some((v) => v.startsWith("2."))).toBe(false);
    expect(versions("vitest").some((v) => v.startsWith("3.") || v.startsWith("4."))).toBe(true);

    expect(versions("fast-uri")).not.toContain("3.1.5");
    expect(versions("fast-uri")).toContain("3.1.8");

    expect(versions("js-yaml")).not.toContain("4.3.1");
    expect(versions("js-yaml")).toContain("4.3.2");

    expect(versions("nanoid")).not.toContain("3.3.17");
    expect(versions("nanoid")).toContain("3.3.19");

    expect(versions("sharp")).not.toContain("0.35.2");
    expect(versions("sharp")).toContain("0.35.5");

    expect(versions("undici")).not.toContain("7.28.0");
    expect(versions("undici")).toContain("7.30.0");

    expect(versions("engine.io")).not.toContain("6.6.9");
    expect(versions("engine.io")).toContain("6.6.11");

    expect(versions("brace-expansion")).not.toContain("1.1.18");
    expect(versions("brace-expansion")).not.toContain("5.0.9");
    expect(versions("brace-expansion")).toContain("1.1.21");
    expect(versions("brace-expansion")).toContain("5.0.12");

    // vitest 2 pulled vite 5 and esbuild 0.21, both inside audit ranges.
    expect(versions("vite").some((v) => v.startsWith("5."))).toBe(false);
    expect(versions("esbuild")).not.toContain("0.21.5");
  });
});
