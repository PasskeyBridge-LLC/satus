/** Provided by scripts/vite-plugin-blog-posts.ts. Path -> raw markdown. */
declare module "virtual:blog-posts" {
  const posts: Record<string, string>;
  export default posts;
}

/**
 * Provided by scripts/vite-plugin-blog-posts.ts. Build instant and the
 * `publishAt` instants (epoch ms, ascending) of withheld non-draft posts.
 */
declare module "virtual:blog-schedule" {
  export const builtAt: number;
  export const pending: number[];
}
