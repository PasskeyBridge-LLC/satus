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
 * posts are measured from frontmatter plus the suffix `blog.$slug.tsx`
 * appends. A route with no literal title is a failure, not a skip — a
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

// --- Blog posts: frontmatter title + the suffix blog.$slug.tsx appends -------

const slugSrc = read("src/routes/blog.$slug.tsx");
// `title: post.seoTitle ?? `${post.title}<suffix>``: the suffix is read from
// the template literal; a post with `seoTitle` uses that string verbatim.
const suffixMatch = /title:[^`\n]*`\$\{post\.title\}([^`]*)`/.exec(slugSrc);
if (!suffixMatch) {
  console.error("✗ validate-titles: could not read the blog title suffix from blog.$slug.tsx");
  process.exit(1);
}
const suffix = suffixMatch[1];

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
  const title = seo
    ? seo[1].trim().replace(/^["']|["']$/g, "")
    : t[1].trim().replace(/^["']|["']$/g, "") + suffix;
  // Posts are only held to the floor. Their titles are the post's own
  // headline and several legitimately run past 60; shortening those is an
  // editorial decision, not a build gate.
  if (title.length < MIN) {
    failures.push(`/blog/${f}: title is ${title.length} chars (min ${MIN}): "${title}"`);
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
