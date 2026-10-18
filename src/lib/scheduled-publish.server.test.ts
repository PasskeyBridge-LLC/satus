import { describe, expect, it } from "vitest";
import { pendingPublishAts } from "../../scripts/vite-plugin-blog-posts";
import { decide, parseTestInstants } from "./scheduled-publish.server";

const T = (s: string) => Date.parse(s);
const FRIDAY_9AM_ET = T("2026-10-23T09:00:00-04:00");

describe("pendingPublishAts", () => {
  const posts: { frontmatter: Record<string, string> | null }[] = [
    { frontmatter: { slug: "a", publishAt: "2026-10-23T09:00:00-04:00" } },
    { frontmatter: { slug: "b", publishAt: "2026-10-30T09:00:00-04:00", draft: "true" } },
    { frontmatter: { slug: "c", publishAt: "2026-10-01T09:00:00-04:00" } },
    { frontmatter: { slug: "d" } },
    { frontmatter: { slug: "e", publishAt: "not a date" } },
    { frontmatter: null },
  ];

  it("keeps only future publishAt of non-draft posts", () => {
    expect(pendingPublishAts(posts, T("2026-10-18T12:00:00Z"))).toEqual([FRIDAY_9AM_ET]);
  });

  it("drops an instant once the build is at or after it", () => {
    expect(pendingPublishAts(posts, FRIDAY_9AM_ET)).toEqual([]);
  });
});

describe("decide", () => {
  const builtAt = T("2026-10-22T22:00:00Z");

  it("is idle before the instant", () => {
    const d = decide({ builtAt, instants: [FRIDAY_9AM_ET], now: FRIDAY_9AM_ET - 1 });
    expect(d).toEqual({ due: [], fire: false, next: FRIDAY_9AM_ET });
  });

  it("fires in the minute the instant falls due (2026-10-23T13:00Z)", () => {
    expect(FRIDAY_9AM_ET).toBe(T("2026-10-23T13:00:00Z"));
    for (const offset of [0, 1_000, 59_999]) {
      const d = decide({ builtAt, instants: [FRIDAY_9AM_ET], now: FRIDAY_9AM_ET + offset });
      expect(d.fire).toBe(true);
      expect(d.due).toEqual([FRIDAY_9AM_ET]);
    }
  });

  it("does not refire every minute while the rebuild is in flight", () => {
    for (const minute of [1, 2, 3, 4]) {
      const d = decide({
        builtAt,
        instants: [FRIDAY_9AM_ET],
        now: FRIDAY_9AM_ET + minute * 60_000,
      });
      expect(d.fire).toBe(false);
      expect(d.due).toEqual([FRIDAY_9AM_ET]);
    }
  });

  it("retries every five minutes while the old build is still live", () => {
    expect(
      decide({ builtAt, instants: [FRIDAY_9AM_ET], now: FRIDAY_9AM_ET + 5 * 60_000 }).fire,
    ).toBe(true);
    expect(
      decide({ builtAt, instants: [FRIDAY_9AM_ET], now: FRIDAY_9AM_ET + 10 * 60_000 + 30_000 })
        .fire,
    ).toBe(true);
  });

  it("gives up after six hours", () => {
    expect(
      decide({ builtAt, instants: [FRIDAY_9AM_ET], now: FRIDAY_9AM_ET + 360 * 60_000 }).fire,
    ).toBe(false);
  });

  it("is idle once the live build postdates the instant", () => {
    const rebuilt = FRIDAY_9AM_ET + 3 * 60_000;
    const d = decide({
      builtAt: rebuilt,
      instants: [FRIDAY_9AM_ET],
      now: FRIDAY_9AM_ET + 5 * 60_000,
    });
    expect(d).toEqual({ due: [], fire: false, next: null });
  });

  it("reports the next instant", () => {
    const next = T("2026-10-30T13:00:00Z");
    expect(decide({ builtAt, instants: [next, FRIDAY_9AM_ET], now: FRIDAY_9AM_ET }).next).toBe(
      next,
    );
  });
});

describe("parseTestInstants", () => {
  it("parses comma-separated instants and ignores junk", () => {
    expect(parseTestInstants(" 2026-10-18T19:00:00Z, nope ,2026-10-18T15:30:00-04:00")).toEqual([
      T("2026-10-18T19:00:00Z"),
      T("2026-10-18T19:30:00Z"),
    ]);
    expect(parseTestInstants(undefined)).toEqual([]);
    expect(parseTestInstants("")).toEqual([]);
  });
});
