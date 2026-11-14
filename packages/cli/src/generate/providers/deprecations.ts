/**
 * Announced model shutdowns for models this CLI prices or has used as a
 * default. Copied from each provider's deprecation page; `readOn` is the
 * date the page was read.
 *
 * Used by deprecations.test.ts, which fails when a DEFAULT_MODELS entry is
 * on this list. Add a row when a provider announces a shutdown for a model
 * in one of the price tables; remove it after the shutdown date has passed
 * and the model is out of the price table.
 */
export interface ModelShutdown {
  provider: "openai" | "anthropic" | "xai";
  /** Model id as satus users pass it to --model (alias, not snapshot). */
  model: string;
  /** Dated snapshot ids the provider lists under the same shutdown. */
  snapshots: string[];
  /** YYYY-MM-DD. The provider stops serving the model on this date. */
  shutdown: string;
  replacement: string;
  source: string;
  /** YYYY-MM-DD. When the source page was read. */
  readOn: string;
}

const OPENAI_DEPRECATIONS = "https://developers.openai.com/api/docs/deprecations";

export const MODEL_SHUTDOWNS: readonly ModelShutdown[] = [
  {
    provider: "openai",
    model: "gpt-4o-mini",
    snapshots: ["gpt-4o-mini-2024-07-18"],
    shutdown: "2027-01-14",
    replacement: "gpt-6-luna",
    source: OPENAI_DEPRECATIONS,
    readOn: "2026-11-13",
  },
  {
    provider: "openai",
    model: "gpt-4o",
    snapshots: ["gpt-4o-2024-08-06", "gpt-4o-2024-11-20"],
    shutdown: "2027-01-14",
    replacement: "gpt-6-luna",
    source: OPENAI_DEPRECATIONS,
    readOn: "2026-11-13",
  },
  {
    provider: "openai",
    model: "gpt-4.1",
    snapshots: ["gpt-4.1-2025-04-14"],
    shutdown: "2027-01-14",
    replacement: "gpt-6-luna",
    source: OPENAI_DEPRECATIONS,
    readOn: "2026-11-13",
  },
  {
    provider: "openai",
    model: "gpt-4.1-mini",
    snapshots: ["gpt-4.1-mini-2025-04-14"],
    shutdown: "2027-01-14",
    replacement: "gpt-6-luna",
    source: OPENAI_DEPRECATIONS,
    readOn: "2026-11-13",
  },
];

/** The shutdown row that covers `model`, matched on the alias or a listed snapshot. */
export function shutdownFor(provider: string, model: string): ModelShutdown | undefined {
  return MODEL_SHUTDOWNS.find(
    (row) => row.provider === provider && (row.model === model || row.snapshots.includes(model)),
  );
}

const SOURCE_NAMES: Record<ModelShutdown["provider"], string> = {
  openai: "OpenAI deprecations page",
  anthropic: "Anthropic model deprecations page",
  xai: "xAI models page",
};

/** Where the model id the run uses was set. */
export type ModelOrigin = "--model" | "satus.config.json" | "default";

/**
 * One line for stderr when the model a run resolves has an announced
 * shutdown, or null. A satus.config.json written by `satus init` before
 * 0.3.13 holds "model": "gpt-4o-mini", and the config wins over
 * DEFAULT_MODELS, so upgrading the CLI alone does not move those runs off
 * the model. `today` is YYYY-MM-DD.
 */
export function shutdownNotice(
  provider: string,
  model: string,
  origin: ModelOrigin,
  today: string = new Date().toISOString().slice(0, 10),
): string | null {
  const row = shutdownFor(provider, model);
  if (!row) return null;
  const when = today >= row.shutdown ? "shut down on" : "shuts down on";
  const fix =
    origin === "satus.config.json"
      ? `It comes from "model" in satus.config.json; set it to ${row.replacement}, or pass --model.`
      : origin === "--model"
        ? `It comes from --model; pass --model ${row.replacement}.`
        : `Pass --model ${row.replacement}.`;
  return `${model} ${when} ${row.shutdown} (${SOURCE_NAMES[row.provider]}). ${fix}`;
}
