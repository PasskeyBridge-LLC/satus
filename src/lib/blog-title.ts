/**
 * Document <title> for a blog post.
 *
 * `seoTitle` wins when set. Otherwise the headline gets the blog suffix, but
 * only when the result fits in 60 characters. The Oct 26 2026 audit found 21
 * post titles over 60, every one of them pushed there by the suffix. A
 * headline that is too long on its own needs a `seoTitle`;
 * scripts/validate-titles.mjs fails the build when one is missing.
 *
 * Kept out of src/lib/blog.ts so the route can import it without pulling
 * every post into the route chunk.
 */
export const BLOG_TITLE_SUFFIX = "—satus.sh blog";
export const MAX_TITLE_LENGTH = 60;

export function postDocumentTitle(post: { title: string; seoTitle?: string }): string {
  if (post.seoTitle) return post.seoTitle;
  const withSuffix = `${post.title}${BLOG_TITLE_SUFFIX}`;
  return withSuffix.length <= MAX_TITLE_LENGTH ? withSuffix : post.title;
}
