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
      const { initSentry } = await import("./lib/sentry");
      await initSentry("server");
      return await import("@sentry/tanstackstart-react");
    } catch (error) {
      // Monitoring must never take the site down with it.
      console.error("Sentry server SDK failed to load; continuing without it.", error);
      return null;
    }
  })();
  return loading;
}

export type ServerFetch = (request: Request, env: unknown, ctx: unknown) => Promise<Response>;

/** wrapFetchWithSentry when a DSN is set; the handler itself otherwise. */
export function withServerSentry(handler: ServerFetch): ServerFetch {
  let ready: Promise<ServerFetch> | undefined;
  return async (request, env, ctx) => {
    ready ??= loadServerSentry().then((sdk) => {
      if (!sdk) return handler;
      const wrapped = sdk.wrapFetchWithSentry({ fetch: handler } as Parameters<
        SentryServerSdk["wrapFetchWithSentry"]
      >[0]) as { fetch: ServerFetch };
      return wrapped.fetch;
    });
    const fetch = await ready;
    return fetch(request, env, ctx);
  };
}

type MiddlewareCtx = { next: (...args: never[]) => unknown };

/**
 * Body of the global request/function middlewares in src/start.ts. Runs
 * Sentry's own global middleware handler when the SDK is loaded, and just
 * calls next() when it is not.
 */
export async function runSentryMiddleware<C extends MiddlewareCtx>(
  kind: "request" | "function",
  ctx: C,
): Promise<Awaited<ReturnType<C["next"]>>> {
  type Result = Awaited<ReturnType<C["next"]>>;
  const sdk = await loadServerSentry();
  const middleware =
    kind === "request" ? sdk?.sentryGlobalRequestMiddleware : sdk?.sentryGlobalFunctionMiddleware;
  const server = (middleware?.options as { server?: (c: C) => unknown } | undefined)?.server;
  if (!server) return (await (ctx.next as () => unknown)()) as Result;
  return (await server(ctx)) as Result;
}
