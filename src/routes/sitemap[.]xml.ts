/**
 * /sitemap.xml—dynamic sitemap.
 *
 * Replaces the legacy static `public/sitemap.xml` (which couldn't reflect
 * blog posts). Every public route is enumerated explicitly; blog posts are
 * appended from the bundled post index. Update `STATIC_ROUTES` when a new
 * indexable route ships.
 */

import { createFileRoute } from "@tanstack/react-router";
import { getAllPosts, getLatestDate } from "@/lib/blog";

const BASE_URL = "https://satus.sh";

interface Entry {
  path: string;
  lastmod?: string;
  changefreq: "weekly" | "monthly" | "yearly";
  priority: string;
}

const STATIC_ROUTES: Entry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/demo", changefreq: "monthly", priority: "0.9" },
  { path: "/profiles", changefreq: "monthly", priority: "0.8" },
  { path: "/pricing", changefreq: "monthly", priority: "0.8" },
  { path: "/docs", changefreq: "monthly", priority: "0.9" },
  { path: "/docs/how-it-works", changefreq: "monthly", priority: "0.8" },
  { path: "/docs/github-action", changefreq: "monthly", priority: "0.8" },
  { path: "/docs/troubleshooting", changefreq: "monthly", priority: "0.8" },
  { path: "/quickstart", changefreq: "monthly", priority: "0.9" },
  { path: "/cli", changefreq: "monthly", priority: "0.8" },
  { path: "/recipes", changefreq: "monthly", priority: "0.7" },
  { path: "/compare", changefreq: "monthly", priority: "0.7" },
  { path: "/blog", changefreq: "weekly", priority: "0.7" },
  { path: "/security", changefreq: "yearly", priority: "0.4" },
  { path: "/terms", changefreq: "yearly", priority: "0.3" },
  { path: "/privacy", changefreq: "yearly", priority: "0.3" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const posts = getAllPosts();
        const blogLastmod = getLatestDate();

        const entries: Entry[] = [
          ...STATIC_ROUTES.map((r) =>
            r.path === "/blog" && blogLastmod ? { ...r, lastmod: blogLastmod } : r,
          ),
          ...posts.map<Entry>((p) => ({
            path: `/blog/${p.slug}`,
            lastmod: p.date,
            changefreq: "yearly",
            priority: "0.6",
          })),
        ];

        const urls = entries
          .map((e) =>
            [
              "  <url>",
              `    <loc>${BASE_URL}${e.path}</loc>`,
              e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
              `    <changefreq>${e.changefreq}</changefreq>`,
              `    <priority>${e.priority}</priority>`,
              "  </url>",
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n");

        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          urls,
          "</urlset>",
        ].join("\n");

        /* max-age=300, not 3600: a deploy refreshes the CDN cache, and this
         * caps client staleness after a scheduled post's rebuild at 5 min. */
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },
  },
});
