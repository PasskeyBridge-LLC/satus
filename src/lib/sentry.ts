/**
 * Sentry init options shared by the client and server instrument files.
 *
 * `initSentry` is the only place that calls `Sentry.init`. An empty DSN
 * is a true no-op: the SDK is never imported. The instrument files also
 * dynamic-import this module only when a DSN is present.
 */

import type { Breadcrumb, ErrorEvent, EventHint, TransactionEvent } from "@sentry/core";
import type * as SentrySdk from "@sentry/tanstackstart-react";
import { scrubBreadcrumb, scrubSentryEvent } from "./sentry-scrub";

export type SentryRuntime = "client" | "server";

/** Same-origin only. Anchored so satus.sh.evil.example does not match. */
export const SATUS_TRACE_PROPAGATION_TARGETS: Array<string | RegExp> = [
  /^https?:\/\/([a-z0-9-]+\.)*satus\.sh(?=[/:?#]|$)/i,
  /^\//,
];

export function matchesSatusTraceTarget(value: string): boolean {
  return SATUS_TRACE_PROPAGATION_TARGETS.some((target) =>
    typeof target === "string" ? value === target : target.test(value),
  );
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
    sendDefaultPii: false as const,
    environment,
    ...(release ? { release } : {}),
    tracesSampleRate: 0.1,
    maxBreadcrumbs: 30,
    tracePropagationTargets: SATUS_TRACE_PROPAGATION_TARGETS,
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

/**
 * The SDK itself is imported here, dynamically, and only after the DSN check.
 * A static import would be hoisted into the server bundle (Nitro inlines
 * dynamic imports) and evaluate the SDK on every cold start, DSN or not.
 */
export async function initSentry(
  runtime: SentryRuntime,
): Promise<ReturnType<typeof SentrySdk.init> | undefined> {
  const options = sentrySharedOptions(runtime);
  if (!options.dsn) return undefined;
  const Sentry = await import("@sentry/tanstackstart-react");
  return Sentry.init(options);
}
