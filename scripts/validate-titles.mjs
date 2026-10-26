#!/usr/bin/env node
/**
 * Fail the build when a sitemap URL would ship with a <title> under 30
 * characters or over 60.
 *
 * Found 2026-09-13, fixed 2026-09-17: thirteen of the sixteen static routes
 * in the sitemap had titles like "Docs—satus" (10 characters), "Pricing—satus"
 * (13) and "Quickstart—satus" (16). A title that short names nothing a
 * searcher typed. The floor is the acceptance criterion from that audit; the
 * ceiling is where result pages truncate.
 *
 * Ground truth is the sitemap route itself: STATIC_ROUTES is parsed out of
 * `src/routes/sitemap[.]xml.ts`, each path is mapped to its route file, and
 * the literal `{ title: "..." }` in that file's head() is measured. Blog
 * posts are measured from frontmatter with the rule in
 * `src/lib/blog-title.ts`. A route with no literal title is a failure, not a skip — a
 * template literal would need its own reading, and today none of the
 * sitemap routes uses one.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const MIN = 30;
const MAX = 60;

const failures = [];
let checked = 0;

// --- Static routes, straight from the sitemap -------------------------------

const sitemapSrc = read("src/routes/sitemap[.]xml.ts");
const routesBlock = /const STATIC_ROUTES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(sitemapSrc);
if (!routesBlock) {
  console.error("✗ validate-titles: could not find STATIC_ROUTES in the sitemap route");
  process.exit(1);
}
const paths = [...routesBlock[1].matchAll(/path:\s*["']([^"']+)["']/g)].map((m) => m[1]);
if (paths.length === 0) {
  console.error("✗ validate-titles: STATIC_ROUTES parsed to zero paths — the parser is broken");
  process.exit(1);
}

/** "/" → index.tsx, "/docs" → docs.index.tsx, "/docs/x" → docs.x.tsx, "/x" → x.tsx */
function routeFileFor(path) {
  if (path === "/") return "index.tsx";
  const seg = path.slice(1).split("/");
  const files = readdirSync(join(ROOT, "src/routes"));
  const exact = `${seg.join(".")}.tsx`;
  if (files.includes(exact)) return exact;
  const index = `${seg.join(".")}.index.tsx`;
  if (files.includes(index)) return index;
  return null;
}

for (const path of paths) {
  const file = routeFileFor(path);
  if (!file) {
    failures.push(`${path}: no route file found for this sitemap entry`);
    continue;
  }
  const src = read(`src/routes/${file}`);
  // The literal form only. A const-backed title (blog.index.tsx) is resolved
  // by looking up the identifier's string initialiser in the same file.
  let m = /\{\s*title:\s*"([^"]+)"\s*\}/.exec(src);
  if (!m) {
    const ident = /\{\s*title:\s*([A-Z_][A-Z0-9_]*)\s*\}/.exec(src);
    if (ident) {
      m = new RegExp(`const ${ident[1]}\\s*=\\s*"([^"]+)"`).exec(src);
    }
  }
  if (!m) {
    failures.push(`${path} (${file}): no literal title in head() — this check cannot measure it`);
    continue;
  }
  checked++;
  const title = m[1];
  if (title.length < MIN || title.length > MAX) {
    failures.push(`${path}: title is ${title.length} chars (${MIN}–${MAX}): "${title}"`);
  }
}

// --- Blog posts: the same rule as src/lib/blog-title.ts ---------------------
//
// seoTitle verbatim when set; otherwise headline + suffix when that fits in
// 60, else the bare headline. Until 2026-10-26 posts were held only to the
// floor and the suffix pushed 21 of them past 60. Now a post whose headline
// alone is over 60 fails until it gets a seoTitle.

const titleSrc = read("src/lib/blog-title.ts");
const suffixMatch = /export const BLOG_TITLE_SUFFIX = "([^"]*)"/.exec(titleSrc);
if (!suffixMatch) {
  console.error("✗ validate-titles: could not read BLOG_TITLE_SUFFIX from src/lib/blog-title.ts");
  process.exit(1);
}
const suffix = suffixMatch[1];
if (!/title:\s*postDocumentTitle\(post\)/.test(read("src/routes/blog.$slug.tsx"))) {
  console.error("✗ validate-titles: blog.$slug.tsx no longer uses postDocumentTitle(post)");
  process.exit(1);
}

const BLOG_DIR = "src/content/blog";
for (const f of readdirSync(join(ROOT, BLOG_DIR))) {
  if (!f.endsWith(".md") || f === "README.md") continue;
  const src = read(`${BLOG_DIR}/${f}`);
  const t = /^title:\s*(.+)$/m.exec(src);
  if (!t) {
    failures.push(`${BLOG_DIR}/${f}: no title in frontmatter`);
    continue;
  }
  checked++;
  const seo = /^seoTitle:\s*(.+)$/m.exec(src);
  const headline = t[1].trim().replace(/^["']|["']$/g, "");
  let title;
  if (seo) title = seo[1].trim().replace(/^["']|["']$/g, "");
  else if ((headline + suffix).length <= MAX) title = headline + suffix;
  else title = headline;
  if (title.length < MIN || title.length > MAX) {
    failures.push(
      `/blog/${f}: title is ${title.length} chars (${MIN}–${MAX}): "${title}"` +
        (title.length > MAX ? " (add a seoTitle)" : ""),
    );
  }
}

if (failures.length > 0) {
  console.error(`\n✗ page titles out of range — refusing to build (${failures.length}):\n`);
  for (const f of failures) console.error(`    ${f}`);
  console.error(
    `\n  Every sitemap URL needs a <title> of ${MIN}–${MAX} characters that names\n` +
      "  what the page is about. Write the title; do not loosen this script.\n",
  );
  process.exit(1);
}

console.log(
  `✓ every sitemap URL has a title of ${MIN}–${MAX} chars (${paths.length} routes + ${checked - paths.length} posts)`,
);
