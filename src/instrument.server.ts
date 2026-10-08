/**
 * Server Sentry bootstrap.
 *
 * Nothing on the server path imports @sentry/tanstackstart-react
 * statically. `loadServerSentry` dynamic-imports the SDK (and calls
 * `initSentry("server")`) only when SENTRY_DSN is set; with an empty DSN it
 * resolves to null, the fetch handler runs unwrapped, and both global
 * middlewares are plain pass-throughs. src/server.ts and src/start.ts go
 * through the helpers below for that reason.
 *
 * Error monitoring only: no wrapFetchWithSentry (request spans and trace
 * meta tags). The middlewares capture exceptions and rethrow; the fetch
 * wrapper only flushes queued error events before the function returns.
 *
 * Vercel Cron is GET + CRON_SECRET (Authorization: Bearer <CRON_SECRET>).
 * That header is stripped in sentry-scrub.ts, not here.
 */
import type * as SentrySdk from "@sentry/tanstackstart-react";

export type SentryServerSdk = typeof SentrySdk;

let loading: Promise<SentryServerSdk | null> | undefined;

/** Resolves once per process. Null when SENTRY_DSN is empty or the SDK failed to load. */
export function loadServerSentry(): Promise<SentryServerSdk | null> {
  loading ??= (async () => {
    if (typeof process === "undefined" || !process.env.SENTRY_DSN) return null;
    try {
      const [{ initSentry }, sdk] = await Promise.all([
        import("./lib/sentry"),
        import("@sentry/tanstackstart-react"),
      ]);
      // Request isolation and request data for error events, without
      // request sessions or spans.
      await initSentry("server", [sdk.httpIntegration({ sessions: false, spans: false })]);
      return sdk;
    } catch (error) {
      // Monitoring must never take the site down with it.
      console.error("Sentry server SDK failed to load; continuing without it.", error);
      return null;
    }
  })();
  return loading;
}

export type ServerFetch = (request: Request, env: unknown, ctx: unknown) => Promise<Response>;

/** Flush timeout for queued error events at the end of a request. */
const FLUSH_TIMEOUT_MS = 2000;

/**
 * With a DSN: runs the handler, then flushes any queued error events so a
 * serverless instance does not freeze with them unsent (an empty queue
 * resolves immediately). Without one: the handler itself.
 */
export function withServerSentry(handler: ServerFetch): ServerFetch {
  return async (request, env, ctx) => {
    const sdk = await loadServerSentry();
    if (!sdk) return handler(request, env, ctx);
    try {
      return await handler(request, env, ctx);
    } finally {
      await sdk.flush(FLUSH_TIMEOUT_MS);
    }
  };
}

type MiddlewareCtx = { next: (...args: never[]) => unknown };

const MECHANISM = {
  request: "auto.middleware.tanstackstart.request",
  function: "auto.middleware.tanstackstart.server_function",
} as const;

/**
 * Body of the global request/function middlewares in src/start.ts. With
 * the SDK loaded it reports an exception thrown further down the chain
 * and rethrows it; without the SDK it just calls next(). No spans.
 */
export async function runSentryMiddleware<C extends MiddlewareCtx>(
  kind: "request" | "function",
  ctx: C,
): Promise<Awaited<ReturnType<C["next"]>>> {
  type Result = Awaited<ReturnType<C["next"]>>;
  const next = ctx.next as () => unknown;
  const sdk = await loadServerSentry();
  if (!sdk) return (await next()) as Result;
  try {
    return (await next()) as Result;
  } catch (error) {
    sdk.captureException(error, { mechanism: { type: MECHANISM[kind], handled: false } });
    throw error;
  }
}
