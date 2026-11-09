/**
 * /llms.txt: the fixed text in `src/content/llms.txt`, with every public
 * blog post listed before its "## Optional" section.
 *
 * The post list comes from `getAllPosts()`, the same accessor `/sitemap.xml`
 * uses, so draft and embargoed posts are left out and a scheduled post is
 * listed from its `publishAt` instant without a deploy.
 */

import { createFileRoute } from "@tanstack/react-router";
import { getAllPosts } from "@/lib/blog";
import base from "@/content/llms.txt?raw";

const BASE_URL = "https://satus.sh";
const OPTIONAL = "\n## Optional";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        const posts = getAllPosts();
        const at = base.indexOf(OPTIONAL);
        const head = (at === -1 ? base : base.slice(0, at)).trimEnd();
        const tail = at === -1 ? "" : base.slice(at).trimEnd();
        const lines = [
          head,
          "",
          `## Blog posts (${posts.length}, newest first)`,
          "",
          ...posts.map(
            (p) =>
              `- [${p.title}](${BASE_URL}/blog/${p.slug}): ${p.description.replace(/\s+/g, " ").trim()}`,
          ),
          "",
          ...(tail ? [tail, ""] : []),
        ];

        /* Same cache lifetime as /sitemap.xml. */
        return new Response(lines.join("\n"), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },
  },
});
