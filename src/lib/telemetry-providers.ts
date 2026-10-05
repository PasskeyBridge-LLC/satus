/**
 * LLM providers the CLI can report in a telemetry run record. The ingest
 * route (/api/public/cli/run) validates `provider` against this list, so a
 * provider the CLI ships must be listed here or its run records are
 * rejected with 400. Mirrors `ProviderId` in packages/cli (the CLI is a
 * separate package and cannot import from the site).
 */
export const TELEMETRY_PROVIDERS = ["openai", "anthropic", "xai"] as const;
export type TelemetryProvider = (typeof TELEMETRY_PROVIDERS)[number];
