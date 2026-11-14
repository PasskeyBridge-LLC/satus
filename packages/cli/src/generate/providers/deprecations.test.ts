import { describe, expect, it } from "vitest";
import { MODEL_SHUTDOWNS, shutdownFor } from "./deprecations.js";
import { DEFAULT_MODELS } from "../../commands/generate.js";
import { OPENAI_PRICING } from "./openai.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("provider default models", () => {
  it("no default model has an announced shutdown", () => {
    for (const [provider, model] of Object.entries(DEFAULT_MODELS)) {
      const row = shutdownFor(provider, model);
      expect(row, `${provider} default ${model} shuts down on ${row?.shutdown}`).toBeUndefined();
    }
  });

  it("no default model shuts down before the build date", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [provider, model] of Object.entries(DEFAULT_MODELS)) {
      const row = shutdownFor(provider, model);
      if (row) expect(row.shutdown > today, `${provider} ${model}`).toBe(true);
    }
  });

  it("matches a dated snapshot to its alias row", () => {
    expect(shutdownFor("openai", "gpt-4o-mini-2024-07-18")?.model).toBe("gpt-4o-mini");
    expect(shutdownFor("openai", "gpt-6-luna")).toBeUndefined();
    expect(shutdownFor("anthropic", "gpt-4o-mini")).toBeUndefined();
  });
});

describe("the shutdown list", () => {
  it("has a source page and dates on every row", () => {
    expect(MODEL_SHUTDOWNS.length).toBeGreaterThan(0);
    for (const row of MODEL_SHUTDOWNS) {
      expect(row.shutdown, row.model).toMatch(ISO_DATE);
      expect(row.readOn, row.model).toMatch(ISO_DATE);
      expect(row.source, row.model).toMatch(/^https:\/\//);
      expect(row.readOn <= row.shutdown, row.model).toBe(true);
    }
  });

  it("lists only OpenAI models the price table still carries", () => {
    for (const row of MODEL_SHUTDOWNS.filter((r) => r.provider === "openai")) {
      expect(OPENAI_PRICING[row.model], row.model).toBeDefined();
    }
  });

  it("names a replacement that is itself not on the list", () => {
    for (const row of MODEL_SHUTDOWNS) {
      expect(shutdownFor(row.provider, row.replacement), row.replacement).toBeUndefined();
    }
  });
});
