/**
 * `virtual:blog-posts`: the blog's markdown sources, filtered at build time.
 *
 * Replaces `import.meta.glob("/src/content/blog/*.md")` in src/lib/blog.ts.
 * The glob bundled every post, drafts and embargoed ones included, into
 * both the Worker and the public client chunks; the render-time filter in
 * publicPosts() hid them from pages but not from anyone reading the JS.
 *
 * - `vite build` (any mode): the module inlines only posts that are
 *   publishable at build time (scripts/blog-visibility.mjs). A draft or a
 *   post whose `publishAt` is still in the future is never read into the
 *   module graph, so no chunk, SSR bundle or prerendered page can carry it.
 *   An embargoed post therefore appears only after a rebuild once its
 *   `publishAt` passes. The Vercel Cron route
 *   src/routes/api/internal/blog/scheduled-publish.ts triggers that rebuild
 *   within a minute; .github/workflows/scheduled-publish.yml is the backup.
 * - `vite dev`: unchanged from before. The module is the same eager glob,
 *   so HMR and new files work, and publicPosts() hides drafts and embargoed
 *   posts at request time exactly as it always has.
 *
 * Keys keep the old glob's shape (`/src/content/blog/<file>.md`).
 *
 * `virtual:blog-schedule`: when the next rebuild is due. Exports the build
 * instant and the `publishAt` instants (epoch ms, sorted) of non-draft posts
 * that were withheld only because their `publishAt` is after that instant.
 * Numbers only: no slug, title or body, so it reveals nothing about an
 * unpublished post beyond the minute it goes live. Imported only by the
 * scheduled-publish server route.
 */
import type { Plugin } from "vite";
import { BLOG_DIR, isPublishable, publishAtMs, readPosts } from "./blog-visibility.mjs";

const VIRTUAL_ID = "virtual:blog-posts";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const SCHEDULE_ID = "virtual:blog-schedule";
const RESOLVED_SCHEDULE_ID = "\0" + SCHEDULE_ID;

/**
 * `publishAt` instants (epoch ms, ascending, deduplicated) of non-draft posts
 * that are not yet publishable at `nowMs`: the instants at which a rebuild
 * will change what the site shows.
 */
export function pendingPublishAts(
  posts: { frontmatter: Record<string, string> | null }[],
  nowMs: number,
): number[] {
  const out = new Set<number>();
  for (const p of posts) {
    if (!p.frontmatter || p.frontmatter.draft === "true") continue;
    const at = publishAtMs(p.frontmatter);
    if (at === null || Number.isNaN(at) || at <= nowMs) continue;
    out.add(at);
  }
  return [...out].sort((a, b) => a - b);
}

export function blogPosts(): Plugin {
  /* One instant for the whole build. TanStack Start builds the client, SSR
   * and server environments separately; they must agree on which posts
   * exist or a client route could reference a post its server lacks. */
  const buildNow = Date.now();
  let isBuild = false;

  return {
    name: "satus:blog-posts",
    enforce: "pre",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      if (id === SCHEDULE_ID) return RESOLVED_SCHEDULE_ID;
      return undefined;
    },
    load(id) {
      if (id === RESOLVED_SCHEDULE_ID) {
        /* In dev there is no build instant; "now" keeps the route's logic
         * meaningful when exercised locally. */
        const builtAt = isBuild ? buildNow : Date.now();
        const pending = pendingPublishAts(readPosts(), builtAt);
        if (isBuild) {
          this.addWatchFile(BLOG_DIR);
          const env = (this as { environment?: { name?: string } }).environment?.name;
          this.info(
            `scheduled-publish: ${pending.length} pending publishAt` +
              (pending.length
                ? `: ${pending.map((t) => new Date(t).toISOString()).join(", ")}`
                : "") +
              (env ? ` [${env}]` : "") +
              ` (built ${new Date(builtAt).toISOString()})`,
          );
        }
        return `export const builtAt = ${builtAt};\nexport const pending = ${JSON.stringify(pending)};\n`;
      }
      if (id !== RESOLVED_ID) return undefined;

      if (!isBuild) {
        return `export default import.meta.glob("/src/content/blog/*.md", { eager: true, query: "?raw", import: "default" });`;
      }

      this.addWatchFile(BLOG_DIR);
      const posts = readPosts();
      const kept = posts.filter((p) => isPublishable(p.frontmatter, buildNow));
      const withheld = posts.length - kept.length;
      const env = (this as { environment?: { name?: string } }).environment?.name;
      this.info(
        `${kept.length} publishable post(s) bundled, ${withheld} draft/embargoed withheld` +
          (env ? ` [${env}]` : "") +
          ` (as of ${new Date(buildNow).toISOString()})`,
      );
      const entries = Object.fromEntries(kept.map((p) => [`/src/content/blog/${p.file}`, p.raw]));
      return `export default ${JSON.stringify(entries)};`;
    },
  };
}
