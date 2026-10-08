/**
 * Sentry init options shared by the client and server instrument files.
 *
 * `initSentry` is the only place that calls `Sentry.init`. An empty DSN
 * is a true no-op: the caller must not import this module (and therefore
 * the SDK) until a DSN is present. The instrument files dynamic-import
 * this module for that reason.
 */

import type { Breadcrumb, ErrorEvent, EventHint, TransactionEvent } from "@sentry/core";
import * as Sentry from "@sentry/tanstackstart-react";
import { scrubBreadcrumb, scrubSentryEvent } from "./sentry-scrub";

export type SentryRuntime = "client" | "server";

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
    // Same-origin only. Empty would drop useful client traces to our own
    // APIs; a wildcard would attach sentry-trace to third parties.
    tracePropagationTargets: [/^https?:\/\/([^/]*\.)?satus\.sh/i, /^\//],
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

export function initSentry(runtime: SentryRuntime): ReturnType<typeof Sentry.init> | undefined {
  const options = sentrySharedOptions(runtime);
  if (!options.dsn) return undefined;
  return Sentry.init(options);
}
