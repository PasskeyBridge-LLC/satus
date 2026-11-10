/**
 * /llms.txt lists every public blog post from `getAllPosts()`, the accessor
 * `/sitemap.xml` reads. These tests run both handlers against one fixture
 * set: two published posts (one with a `publishAt` already past), a draft,
 * and a post embargoed until 2999.
 *
 * `virtual:blog-posts` is supplied by the Vite plugin at build time and does
 * not exist under Vitest, so the fixture replaces it. Everything after that
 * (frontmatter parsing, draft and embargo filtering, both route handlers)
 * is the real code.
 */

import { describe, expect, it, vi } from "vitest";

const post = (fm: Record<string, string>, body = "Body text for the fixture post.") =>
  `---\n${Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n${body}\n`;

vi.mock("virtual:blog-posts", () => ({
  default: {
    "/src/content/blog/2026-01-02-published-one.md": post({
      slug: "published-one",
      title: '"Published one"',
      description: "The first published fixture post, listed in llms.txt.",
      date: "2026-01-02",
      draft: "false",
    }),
    "/src/content/blog/2026-01-03-published-scheduled.md": post({
      slug: "published-scheduled",
      title: '"Published on a past schedule"',
      description: "A fixture post whose publishAt instant has already passed.",
      date: "2026-01-03",
      publishAt: "2026-01-03T09:00:00Z",
    }),
    "/src/content/blog/2026-01-04-a-draft.md": post({
      slug: "a-draft",
      title: '"A draft"',
      description: "A fixture draft that every public accessor leaves out.",
      date: "2026-01-04",
      draft: "true",
    }),
    "/src/content/blog/2999-01-01-embargoed.md": post({
      slug: "embargoed-post",
      title: '"Embargoed"',
      description: "A fixture post embargoed until the year 2999.",
      date: "2999-01-01",
      publishAt: "2999-01-01T00:00:00Z",
    }),
  },
}));

type GetHandler = () => Promise<Response>;

function getHandler(route: unknown, name: string): GetHandler {
  const handlers = (route as { options?: { server?: { handlers?: { GET?: GetHandler } } } }).options
    ?.server?.handlers;
  if (!handlers?.GET) throw new Error(`${name} GET handler is not registered`);
  return handlers.GET;
}

const { Route: LlmsRoute } = await import("./llms[.]txt");
const { Route: SitemapRoute } = await import("./sitemap[.]xml");
const { getAllPosts } = await import("@/lib/blog");

const BLOG_URL = /https:\/\/satus\.sh\/blog\/([a-z0-9-]+)/g;
const slugsIn = (text: string) => [...text.matchAll(BLOG_URL)].map((m) => m[1]);

async function llms() {
  const res = await getHandler(LlmsRoute, "/llms.txt")();
  return { res, text: await res.text() };
}

describe("/llms.txt route", () => {
  it("returns 200 with a plain-text body", async () => {
    const { res, text } = await llms();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(text.startsWith("# satus")).toBe(true);
  });

  it("lists every published post, including one whose publishAt has passed", async () => {
    const { text } = await llms();
    expect(text).toContain("## Blog posts (2, newest first)");
    expect(text).toContain(
      "- [Published one](https://satus.sh/blog/published-one): The first published fixture post, listed in llms.txt.",
    );
    expect(text).toContain("https://satus.sh/blog/published-scheduled");
  });

  it("leaves out drafts and embargoed posts", async () => {
    const { text } = await llms();
    expect(text).not.toContain("a-draft");
    expect(text).not.toContain("embargoed-post");
    expect(text).not.toContain("A fixture draft");
  });

  it("lists the same posts as /sitemap.xml and getAllPosts()", async () => {
    const { text } = await llms();
    const sitemap = await (await getHandler(SitemapRoute, "/sitemap.xml")()).text();
    const fromLlms = slugsIn(text);
    const fromSitemap = slugsIn(sitemap);
    expect(fromLlms).toEqual(getAllPosts().map((p) => p.slug));
    expect([...fromLlms].sort()).toEqual([...fromSitemap].sort());
  });

  it("keeps the post list ahead of the Optional section", async () => {
    const { text } = await llms();
    const optional = text.indexOf("\n## Optional");
    expect(optional).toBeGreaterThan(text.indexOf("## Blog posts"));
  });
});
