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
 *   `publishAt` passes; .github/workflows/scheduled-publish.yml triggers
 *   that rebuild.
 * - `vite dev`: unchanged from before. The module is the same eager glob,
 *   so HMR and new files work, and publicPosts() hides drafts and embargoed
 *   posts at request time exactly as it always has.
 *
 * Keys keep the old glob's shape (`/src/content/blog/<file>.md`).
 */
import type { Plugin } from "vite";
import { BLOG_DIR, isPublishable, readPosts } from "./blog-visibility.mjs";

const VIRTUAL_ID = "virtual:blog-posts";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

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
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
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
