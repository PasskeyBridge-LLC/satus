// Guards the docs → blog links in further-reading.tsx against unpublished or renamed posts.
import { describe, expect, it } from "vitest";
import { isPublishable, readPosts } from "../../../scripts/blog-visibility.mjs";
import { FURTHER_READING } from "./further-reading";

describe("docs further reading", () => {
  it("links only published posts", () => {
    const now = Date.now();
    const published = new Set(
      readPosts()
        .filter((p) => isPublishable(p.frontmatter, now))
        .map((p) => p.frontmatter?.slug),
    );
    for (const [page, posts] of Object.entries(FURTHER_READING)) {
      for (const p of posts) expect(published.has(p.slug), `${page}: ${p.slug}`).toBe(true);
    }
  });
});
