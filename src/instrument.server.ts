/**
 * Server Sentry bootstrap. Called from src/server.ts before the request
 * handler. Dynamic import: an empty SENTRY_DSN never loads the SDK.
 *
 * Vercel Cron is GET + CRON_SECRET (Authorization: Bearer <CRON_SECRET>).
 * That header is stripped in sentry-scrub.ts, not here.
 */
export async function instrumentServer(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const { initSentry } = await import("./lib/sentry");
  initSentry("server");
}
