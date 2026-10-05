/**
 * Build-time blog visibility (scripts/blog-visibility.mjs). This decides
 * which posts the Vite plugin hands to the bundler, so a regression here
 * ships unpublished posts in public JS.
 */
import { describe, expect, it } from "vitest";
import { isPublishable, readPosts, splitPost } from "../../scripts/blog-visibility.mjs";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const post = (fm: string) => splitPost(`---\n${fm}\n---\n\nBody text.\n`).frontmatter;

describe("isPublishable", () => {
  it("keeps a post with no draft flag and no publishAt", () => {
    expect(isPublishable(post("slug: a"), NOW)).toBe(true);
  });
  it("withholds draft: true regardless of publishAt", () => {
    expect(isPublishable(post("slug: a\ndraft: true"), NOW)).toBe(false);
    expect(isPublishable(post("draft: true\npublishAt: 2020-01-01T00:00:00Z"), NOW)).toBe(false);
  });
  it("keeps draft: false", () => {
    expect(isPublishable(post("draft: false"), NOW)).toBe(true);
  });
  it("withholds a future publishAt and keeps a past or exactly-now one", () => {
    expect(isPublishable(post("publishAt: 2026-09-26T08:00:01-04:00"), NOW)).toBe(false);
    expect(isPublishable(post("publishAt: 2026-09-26T08:00:00-04:00"), NOW)).toBe(true);
    expect(isPublishable(post('publishAt: "2026-09-25T09:00:00-04:00"'), NOW)).toBe(true);
  });
  it("fails closed on an unparseable publishAt or missing frontmatter", () => {
    expect(isPublishable(post("publishAt: next tuesday"), NOW)).toBe(false);
    expect(isPublishable(splitPost("no frontmatter here").frontmatter, NOW)).toBe(false);
  });
});

describe("readPosts", () => {
  it("reads every post and skips the README", () => {
    const files = readPosts().map((p) => p.file);
    expect(files.length).toBeGreaterThan(0);
    expect(files).not.toContain("README.md");
    expect(files.every((f) => f.endsWith(".md"))).toBe(true);
  });
});
