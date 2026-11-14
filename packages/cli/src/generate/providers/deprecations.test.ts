import { describe, expect, it } from "vitest";
import { MODEL_SHUTDOWNS, shutdownFor, shutdownNotice } from "./deprecations.js";
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

describe("shutdownNotice", () => {
  it("names the model, the date, where the id came from, and the replacement", () => {
    expect(shutdownNotice("openai", "gpt-4o-mini", "satus.config.json", "2026-11-14")).toBe(
      'gpt-4o-mini shuts down on 2027-01-14 (OpenAI deprecations page). It comes from "model" ' +
        "in satus.config.json; set it to gpt-6-luna, or pass --model.",
    );
    expect(shutdownNotice("openai", "gpt-4o-2024-11-20", "--model", "2026-11-14")).toBe(
      "gpt-4o-2024-11-20 shuts down on 2027-01-14 (OpenAI deprecations page). " +
        "It comes from --model; pass --model gpt-6-luna.",
    );
  });

  it("uses the past tense on and after the shutdown date", () => {
    expect(shutdownNotice("openai", "gpt-4.1", "--model", "2027-01-14")).toMatch(
      /^gpt-4\.1 shut down on 2027-01-14 /,
    );
  });

  it("says nothing for a model with no announced shutdown", () => {
    expect(shutdownNotice("openai", "gpt-6-luna", "default", "2026-11-14")).toBeNull();
    for (const [provider, model] of Object.entries(DEFAULT_MODELS)) {
      expect(shutdownNotice(provider, model, "default", "2026-11-14"), model).toBeNull();
    }
  });
});
