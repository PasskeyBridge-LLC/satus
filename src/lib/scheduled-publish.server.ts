/**
 * Scheduled publish: decide whether a production rebuild is due right now.
 *
 * Production builds withhold posts whose `publishAt` is after the build
 * instant (scripts/vite-plugin-blog-posts.ts), so a scheduled post goes live
 * only on the first production build after its `publishAt`. Vercel Cron
 * calls src/routes/api/internal/blog/scheduled-publish.ts every minute; that
 * route asks `decide()` whether to fire the project's deploy hook.
 *
 * Stateless by construction. The running deployment knows the instant it was
 * built and the `publishAt` instants it withheld. An instant is due when it
 * lies in (builtAt, now]. Once the rebuild it triggers is live, that build's
 * own builtAt is past the instant, so the instant stops being due without
 * anything being recorded anywhere.
 *
 * The rebuild takes a few minutes, during which the old deployment keeps
 * answering the cron and still sees the instant as due. To avoid a deploy
 * per minute, the hook fires only on the minute the instant falls due and
 * then every RETRY_EVERY_MINUTES while it stays due (a failed or cancelled
 * build gets retried), up to GIVE_UP_AFTER_MINUTES.
 */

export const RETRY_EVERY_MINUTES = 5;
export const GIVE_UP_AFTER_MINUTES = 6 * 60;

export interface Decision {
  /** Instants (epoch ms) in (builtAt, now] that the live build predates. */
  due: number[];
  /** Whether this invocation should fire the deploy hook. */
  fire: boolean;
  /** Next instant after now that will fall due, if any. */
  next: number | null;
}

/**
 * Parse `SCHEDULED_PUBLISH_TEST_AT`: comma-separated ISO 8601 instants that
 * are treated exactly like a post's `publishAt`. Used to prove on-time firing
 * without a real post: at that minute the route redeploys the current `main`,
 * which publishes nothing new. Unparseable entries are ignored.
 */
export function parseTestInstants(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Date.parse(s.trim()))
    .filter((t) => !Number.isNaN(t));
}

export function decide(opts: { builtAt: number; instants: number[]; now: number }): Decision {
  const { builtAt, instants, now } = opts;
  const sorted = [...new Set(instants)].sort((a, b) => a - b);
  const due = sorted.filter((t) => t > builtAt && t <= now);
  const fire = due.some((t) => {
    const elapsedMinutes = Math.floor((now - t) / 60_000);
    return elapsedMinutes < GIVE_UP_AFTER_MINUTES && elapsedMinutes % RETRY_EVERY_MINUTES === 0;
  });
  const next = sorted.find((t) => t > now) ?? null;
  return { due, fire, next };
}
