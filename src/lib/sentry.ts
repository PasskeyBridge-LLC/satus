/**
 * Sentry init options shared by the client and server instrument files.
 *
 * PasskeyBridge Sentry standard: ERROR MONITORING ONLY.
 * - No tracing: no tracesSampleRate (so no spans or transactions), no
 *   browser tracing integration, and tracePropagationTargets is [] so no
 *   sentry-trace/baggage headers are attached to any outgoing request.
 * - No sessions: the browser and process session integrations are
 *   removed, and the server Http integration runs with sessions and
 *   spans off.
 * - No client reports (sendClientReports: false), no Replay, Feedback,
 *   Logs, or profiling.
 * - Personal data off via `dataCollection` (same block as
 *   PasskeyBridge-LLC/passkeybridge#434). In SDK 11 `sendDefaultPii` no
 *   longer exists, and an unset `dataCollection` collects user info,
 *   cookies, headers, bodies, and query params by default. `userInfo:
 *   false` is also what makes the browser client send
 *   `sdk.settings.infer_ip: "never"`, so Sentry does not infer the IP.
 * - Every event, transaction, and breadcrumb also goes through the PII
 *   scrubber.
 *
 * `initSentry` is the only place that calls `Sentry.init`. An empty DSN
 * is a true no-op: the SDK is never imported. The instrument files also
 * dynamic-import this module only when a DSN is present.
 */

import type {
  Breadcrumb,
  ErrorEvent,
  EventHint,
  Integration,
  TransactionEvent,
} from "@sentry/core";
import type * as SentrySdk from "@sentry/tanstackstart-react";
import { scrubBreadcrumb, scrubSentryEvent } from "./sentry-scrub";

export type SentryRuntime = "client" | "server";

/** Empty: no trace headers are propagated to any origin, including our own. */
export const SATUS_TRACE_PROPAGATION_TARGETS: Array<string | RegExp> = [];

/**
 * Default integrations that send session or tracing envelopes. "Http" is
 * dropped from the defaults and re-added on the server with sessions and
 * spans off.
 */
export const NON_ERROR_INTEGRATIONS: ReadonlySet<string> = new Set([
  "BrowserSession",
  "BrowserTracing",
  "ProcessSession",
  "Http",
  "Console",
  "Replay",
  "ReplayCanvas",
  "Feedback",
  "BrowserProfiling",
]);

/** Collect nothing about a person or a request. Mirrors passkeybridge#434. */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} as const;

/** Keep only the default integrations needed for error capture, then add `extra`. */
export function errorOnlyIntegrations(
  defaults: Integration[],
  extra: Integration[] = [],
): Integration[] {
  return [...defaults.filter((i) => !NON_ERROR_INTEGRATIONS.has(i.name)), ...extra];
}

export function sentrySharedOptions(runtime: SentryRuntime) {
  const dsn =
    runtime === "client"
      ? (import.meta.env.VITE_SENTRY_DSN as string | undefined)
      : process.env.SENTRY_DSN;
  const environment =
    runtime === "client"
      ? ((import.meta.env.VITE_VERCEL_ENV as string | undefined) ?? "development")
      : (process.env.VERCEL_ENV ?? "development");
  const releaseRaw =
    runtime === "client"
      ? (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined)
      : process.env.VERCEL_GIT_COMMIT_SHA;
  const release = releaseRaw ? releaseRaw : undefined;

  return {
    dsn,
    environment,
    ...(release ? { release } : {}),
    dataCollection: {
      ...SENTRY_DATA_COLLECTION,
      httpBodies: [...SENTRY_DATA_COLLECTION.httpBodies],
      graphQL: { ...SENTRY_DATA_COLLECTION.graphQL },
      genAI: { ...SENTRY_DATA_COLLECTION.genAI },
    },
    /* No tracesSampleRate and no tracesSampler. In 11.4.0 hasSpansEnabled() is
     * true whenever tracesSampleRate != null, so even 0 would turn tracing on. */
    /* Backstop, as in passkeybridge#434: if tracing were ever turned on,
     * transactions stay whole events so beforeSendTransaction (the scrubber)
     * still runs. The 11.x default, span streaming, ignores that hook. */
    traceLifecycle: "static" as const,
    maxBreadcrumbs: 30,
    tracePropagationTargets: SATUS_TRACE_PROPAGATION_TARGETS,
    sendClientReports: false,
    beforeSend(event: ErrorEvent, _hint: EventHint) {
      return scrubSentryEvent(event);
    },
    beforeSendTransaction(event: TransactionEvent, _hint: EventHint) {
      return scrubSentryEvent(event);
    },
    beforeBreadcrumb(breadcrumb: Breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
  };
}

/** Everything passed to Sentry.init, apart from the transport. */
export function buildSentryInitOptions(
  runtime: SentryRuntime,
  extraIntegrations: Integration[] = [],
) {
  return {
    ...sentrySharedOptions(runtime),
    integrations: (defaults: Integration[]) => errorOnlyIntegrations(defaults, extraIntegrations),
  };
}

/**
 * The SDK itself is imported here, dynamically, and only after the DSN check.
 * A static import would be hoisted into the server bundle (Nitro inlines
 * dynamic imports) and evaluate the SDK on every cold start, DSN or not.
 */
export async function initSentry(
  runtime: SentryRuntime,
  extraIntegrations: Integration[] = [],
): Promise<ReturnType<typeof SentrySdk.init> | undefined> {
  const options = buildSentryInitOptions(runtime, extraIntegrations);
  if (!options.dsn) return undefined;
  const Sentry = await import("@sentry/tanstackstart-react");
  return Sentry.init(options);
}
