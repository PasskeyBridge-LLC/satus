import { describe, expect, it } from "vitest";
import { getAllSlugs } from "../../lib/blog";
import { FURTHER_READING } from "./further-reading";

describe("docs further reading", () => {
  it("links only published posts", () => {
    const published = new Set(getAllSlugs());
    for (const [page, posts] of Object.entries(FURTHER_READING)) {
      for (const p of posts) expect(published.has(p.slug), `${page}: ${p.slug}`).toBe(true);
    }
  });
});
