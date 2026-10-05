/**
 * Provider abstraction for LLM-backed row generation.
 *
 * Each concrete provider (OpenAI, Anthropic, ...) returns a `Provider`
 * object with a stable `generate()` method. The runner never imports a
 * provider directly — it receives one from the command layer and calls
 * `generate()` per batch. This keeps the runner free of provider-specific
 * HTTP shapes, auth headers, and structured-output quirks.
 *
 * v0.2.0 hardcoded OpenAI; v0.3.0 introduces this interface as a refactor
 * with no behavior change, then adds Anthropic alongside in Pass 3.
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface ProviderRequest {
  /** System prompt; provider-agnostic plain text. */
  system: string;
  /** User turn; provider-agnostic plain text. */
  user: string;
  /**
   * JSON Schema for the desired structured output. Providers map this to
   * their native structured-output surface (OpenAI: response_format
   * json_schema; Anthropic: tool-use with input_schema).
   */
  jsonSchema: { name: string; schema: Record<string, unknown> };
}

export interface ProviderResponse<T> {
  data: T;
  usage: LlmUsage;
}

/**
 * USD per million tokens for the model this provider is configured with.
 *
 * Exposed on the Provider so the dry-run estimator (`planRun`) and the live
 * meter inside `generate()` price the *same* model with the *same* numbers.
 * Before v0.3.7 `planRun` hardcoded gpt-4o-mini's rates, so an Anthropic
 * dry-run quoted an OpenAI price and the two figures a user saw for one run
 * could not be reconciled. Sourcing both from one field makes them agree by
 * construction rather than by discipline.
 */
export interface TokenRates {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface Provider {
  /**
   * Stable identifier; surfaces in telemetry and JSON output. The
   * 'simulated' variant is used by `satus generate --dry-run` to drive the
   * runner without an upstream LLM call (see ../simulate.ts).
   */
  readonly id: "openai" | "anthropic" | "xai" | "simulated";
  /** Model id actually being called; surfaces in telemetry and logs. */
  readonly model: string;
  /** Rates used by both the live cost meter and the dry-run estimator. */
  readonly rates: TokenRates;
  generate<T>(req: ProviderRequest): Promise<ProviderResponse<T>>;
}

/**
 * USD budget tracker shared across providers. Lives here (not in any
 * single provider file) because every provider feeds the same budget and
 * the runner enforces it provider-agnostically.
 */
export class CostBudget {
  private spent = 0;
  constructor(public readonly maxUsd: number) {}
  add(usage: LlmUsage) {
    this.spent += usage.usd;
  }
  get spentUsd() {
    return this.spent;
  }
  remainingUsd() {
    return this.maxUsd - this.spent;
  }
  exceeded() {
    return this.spent > this.maxUsd;
  }
}
