/**
 * The daily health check's header used to claim it confirmed
 * `process-email-queue` had run in the last five minutes. The function
 * never queried cron. Production has no such job, so teaching the check
 * to require one would turn the daily sample red and mail support.
 *
 * The header and `checkEmailQueue` must describe the two reads that
 * actually run: `email_send_state` is not paused, and `suppressed_emails`
 * answers.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./e2e-health.ts", import.meta.url), "utf8");

function sliceBetween(start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`missing ${start} .. ${end}`);
  return src.slice(from, to);
}

describe("e2e-health email check", () => {
  it("describes the two reads the check actually makes", () => {
    const header = sliceBetween(" * Checks:", "import { createFileRoute");
    expect(header).not.toMatch(/process-email-queue/);
    expect(header).not.toMatch(/pg_cron/);
    expect(header).toMatch(/email_send_state/);
    expect(header).toMatch(/suppressed_emails/);
  });

  it("checks send-state pause and suppression reachability, and does not query cron", () => {
    const body = sliceBetween("async function checkEmailQueue", "async function sendFailureAlert");
    expect(body).toMatch(/email_send_state/);
    expect(body).toMatch(/retry_after_until/);
    expect(body).toMatch(/suppressed_emails/);
    expect(body).not.toMatch(/cron\.job|process-email-queue|pg_cron/);
  });
});
