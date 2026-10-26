import { describe, expect, it } from "vitest";
import { BLOG_TITLE_SUFFIX, MAX_TITLE_LENGTH, postDocumentTitle } from "./blog-title";

describe("postDocumentTitle", () => {
  it("uses seoTitle verbatim", () => {
    expect(postDocumentTitle({ title: "A long headline", seoTitle: "Short" })).toBe("Short");
  });

  it("adds the suffix when the result fits", () => {
    const title = "x".repeat(MAX_TITLE_LENGTH - BLOG_TITLE_SUFFIX.length);
    expect(postDocumentTitle({ title })).toBe(title + BLOG_TITLE_SUFFIX);
  });

  it("drops the suffix when it would push the title over the limit", () => {
    const title = "x".repeat(MAX_TITLE_LENGTH - BLOG_TITLE_SUFFIX.length + 1);
    expect(postDocumentTitle({ title })).toBe(title);
  });
});
