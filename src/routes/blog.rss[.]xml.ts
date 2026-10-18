/**
 * /blog/rss.xml—RSS 2.0 feed for the blog.
 *
 * RSS still beats email newsletters for the developer audience we target.
 * Posts are built into the bundle, so the feed only changes on deploy. A
 * deploy gets a fresh CDN cache, so the edge never serves the old feed after
 * a scheduled post's rebuild; max-age=300 caps how long a reader or browser
 * that fetched just before the rebuild keeps the old copy (was 3600, which
 * could hide a 09:00 post until 10:00).
 */

import { createFileRoute } from "@tanstack/react-router";
import { getAllPosts } from "@/lib/blog";

const SITE_URL = "https://satus.sh";
const FEED_URL = SITE_URL + "/blog/rss.xml";

/* RSS requires escaped XML entities. Keep this local—the wider site never
 * embeds raw user input, so a one-call helper is enough. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* RFC 822 / RSS pubDate format. Posts only carry a date (no time), so we
 * pin them to 12:00 UTC; readers don't care about minute precision. */
function toRfc822(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toUTCString();
}

export const Route = createFileRoute("/blog/rss.xml")({
  server: {
    handlers: {
      GET: async () => {
        const posts = getAllPosts();
        const lastBuildDate = posts[0] ? toRfc822(posts[0].date) : new Date().toUTCString();

        const items = posts
          .map((p) => {
            const url = `${SITE_URL}/blog/${p.slug}`;
            return [
              "    <item>",
              `      <title>${xmlEscape(p.title)}</title>`,
              `      <link>${url}</link>`,
              `      <guid isPermaLink="true">${url}</guid>`,
              `      <pubDate>${toRfc822(p.date)}</pubDate>`,
              `      <description>${xmlEscape(p.description)}</description>`,
              `      <content:encoded><![CDATA[${p.html}]]></content:encoded>`,
              ...p.tags.map((t) => `      <category>${xmlEscape(t)}</category>`),
              "    </item>",
            ].join("\n");
          })
          .join("\n");

        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
          "  <channel>",
          "    <title>satus.sh blog</title>",
          `    <link>${SITE_URL}/blog</link>`,
          `    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml"/>`,
          "    <description>Field notes on Postgres schemas, satus CLI changelogs, and seed-data post-mortems.</description>",
          "    <language>en-us</language>",
          `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
          "    <generator>satus.sh</generator>",
          items,
          "  </channel>",
          "</rss>",
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },
  },
});
