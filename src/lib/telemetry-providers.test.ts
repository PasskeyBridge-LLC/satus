import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TELEMETRY_PROVIDERS } from "./telemetry-providers";

describe("telemetry provider enum", () => {
  it("accepts every provider the CLI ships, including xai", () => {
    expect([...TELEMETRY_PROVIDERS]).toEqual(["openai", "anthropic", "xai"]);
  });

  it("matches the CLI's ProviderId union", () => {
    const src = readFileSync(`${process.cwd()}/packages/cli/src/commands/generate.ts`, "utf8");
    const union = /export type ProviderId = ([^;]+);/.exec(src)?.[1] ?? "";
    const ids = union.split("|").map((s) => s.trim().replace(/"/g, ""));
    expect(ids.sort()).toEqual([...TELEMETRY_PROVIDERS].sort());
  });
});
