import { decide, parseTestInstants } from "@/lib/scheduled-publish.server";
import { createFileRoute } from "@tanstack/react-router";
import { builtAt, pending } from "virtual:blog-schedule";

/**
 * /api/internal/blog/scheduled-publish: Vercel Cron, every minute
 * (vercel.json). Fires the production deploy hook when a withheld post's
 * `publishAt` has passed, so the post is live a few minutes after its
 * scheduled instant. Decision logic and its rationale:
 * src/lib/scheduled-publish.server.ts.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sends.
 *
 * Env (Vercel project, Production):
 * - CRON_SECRET (Sensitive): shared with the email queue cron.
 * - SCHEDULED_PUBLISH_DEPLOY_HOOK (Sensitive): deploy hook URL for `main`.
 *   Never logged or returned.
 * - SCHEDULED_PUBLISH_TEST_AT (optional): comma-separated ISO instants
 *   treated like a `publishAt`; the rebuild they trigger redeploys current
 *   `main` and publishes nothing. For proving the trigger fires on time.
 *
 * `?dryRun=1` reports the decision without firing; `?at=<ISO>` (dry run
 * only) evaluates it as of another instant.
 *
 * .github/workflows/scheduled-publish.yml stays as a slower backup.
 */
export const Route = createFileRoute("/api/internal/blog/scheduled-publish")({
  server: {
    handlers: {
      GET: async ({ request }) => handleScheduledPublish(request),
    },
  },
});

const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

async function handleScheduledPublish(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("scheduled-publish: CRON_SECRET is not set");
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (authHeader.slice("Bearer ".length).trim() !== cronSecret) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const atParam = url.searchParams.get("at");
  const now = dryRun && atParam ? Date.parse(atParam) : Date.now();
  if (Number.isNaN(now)) {
    return Response.json({ error: "at must be an ISO 8601 instant" }, { status: 400 });
  }

  const testInstants = parseTestInstants(process.env.SCHEDULED_PUBLISH_TEST_AT);
  const decision = decide({ builtAt, instants: [...pending, ...testInstants], now });
  const summary = {
    now: iso(now),
    builtAt: iso(builtAt),
    pending: pending.map(iso),
    testAt: testInstants.map(iso),
    due: decision.due.map(iso),
    fire: decision.fire,
    next: iso(decision.next),
    dryRun,
  };

  if (!decision.fire || dryRun) {
    if (decision.due.length) console.log("scheduled-publish: due, not firing", summary);
    return Response.json({ ...summary, triggered: false });
  }

  const hook = process.env.SCHEDULED_PUBLISH_DEPLOY_HOOK;
  if (!hook) {
    console.error("scheduled-publish: due but SCHEDULED_PUBLISH_DEPLOY_HOOK is not set", summary);
    return Response.json(
      { ...summary, triggered: false, error: "hook not configured" },
      { status: 500 },
    );
  }

  let status = 0;
  try {
    const res = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(15_000) });
    status = res.status;
  } catch (err) {
    console.error("scheduled-publish: deploy hook request failed", {
      ...summary,
      error: err instanceof Error ? err.name : "unknown",
    });
    return Response.json({ ...summary, triggered: false }, { status: 502 });
  }
  const ok = status >= 200 && status < 300;
  (ok ? console.log : console.error)(
    `scheduled-publish: deploy hook HTTP ${status} at ${new Date().toISOString()}`,
    summary,
  );
  return Response.json(
    { ...summary, triggered: ok, hookStatus: status },
    { status: ok ? 200 : 502 },
  );
}
