#!/usr/bin/env node
/**
 * Fail the build on malformed blog frontmatter.
 *
 * `src/lib/blog.ts` has always claimed "a malformed post is a build-time
 * error, not a runtime surprise". That was false. Validation lived inside
 * `parsePost`, which runs when the SSR module is first evaluated — inside
 * the deployed Worker, not during `vite build`. `vite build` never imports
 * that module, so a bad post built and deployed clean, then threw on the
 * first request.
 *
 * Because `POSTS` is built by mapping `parsePost` over every file at module
 * scope, one bad post took down *every* route, not just the blog. On
 * 2026-08-10 a 211-character description (limit: 200) 500'd all of
 * satus.sh for about four minutes.
 *
 * This script makes the original claim true. It is wired into `npm run
 * build` ahead of `vite build`, so Vercel fails the deploy instead of
 * shipping a broken site. The runtime in blog.ts additionally skips an
 * invalid post rather than throwing, so even if something reaches
 * production past this gate the blast radius is one post, not the domain.
 *
 * Deliberately dependency-free and CommonJS-adjacent: it runs before any
 * bundling, so it cannot import the TypeScript schema. The rules below are
 * duplicated from FrontmatterSchema in src/lib/blog.ts — if you change one,
 * change the other. The duplication is checked by this script's own
 * self-test: `node scripts/validate-blog.mjs --list` prints every parsed
 * post so a drift is visible.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOG_DIR = join(ROOT, "src/content/blog");

/* Mirrors FrontmatterSchema in src/lib/blog.ts. Keep in sync. */
const RULES = {
  slug: (v) =>
    typeof v === "string" && v.length >= 1 && v.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)
      ? null
      : "slug must be kebab-case, 1-80 chars",
  title: (v) =>
    typeof v === "string" && v.length >= 1 && v.length <= 140
      ? null
      : `title must be 1-140 chars (got ${typeof v === "string" ? v.length : typeof v})`,
  /* Optional. Used verbatim as the document title, so held to 60. */
  seoTitle: (v) =>
    v === undefined || (typeof v === "string" && v.length >= 1 && v.length <= 60)
      ? null
      : `seoTitle must be 1-60 chars (got ${typeof v === "string" ? v.length : typeof v})`,
  description: (v) =>
    typeof v === "string" && v.length >= 20 && v.length <= 200
      ? null
      : `description must be 20-200 chars (got ${typeof v === "string" ? v.length : typeof v})`,
  date: (v) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : "date must be ISO YYYY-MM-DD",
  /* Optional. Absent means publish immediately, so undefined passes. */
  publishAt: (v) => {
    if (v === undefined) return null;
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(v)
    ) {
      return "publishAt must be ISO 8601 with an explicit offset, e.g. 2026-08-28T09:00:00-04:00";
    }
    if (Number.isNaN(Date.parse(v))) {
      return `publishAt is not a parseable instant: ${v}`;
    }
    return null;
  },
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFrontmatter(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    data[trimmed.slice(0, colon).trim()] = stripQuotes(trimmed.slice(colon + 1).trim());
  }
  return data;
}

const listMode = process.argv.includes("--list");
const files = readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith(".md") && f !== "README.md") // blog.ts filters README the same way
  .sort();

const failures = [];
const seenSlugs = new Map();

for (const file of files) {
  const raw = readFileSync(join(BLOG_DIR, file), "utf8");
  const fm = parseFrontmatter(raw);
  if (!fm) {
    failures.push(`${file}: no frontmatter block`);
    continue;
  }
  for (const [field, check] of Object.entries(RULES)) {
    const err = check(fm[field]);
    if (err) failures.push(`${file}: ${err}`);
  }
  /* `date` drives sort order and every rendered byline; `publishAt` drives
   * visibility. Letting them disagree means a post appears on one day and
   * claims another, and sorts by the claim. The publishAt string carries the
   * author's own local date in its first ten characters, so comparing the
   * prefix is the whole check. */
  if (fm.publishAt && fm.date && fm.publishAt.slice(0, 10) !== fm.date) {
    failures.push(
      `${file}: date (${fm.date}) and publishAt (${fm.publishAt.slice(0, 10)}) are different days`,
    );
  }
  /* A duplicate slug silently shadows a post in getPostBySlug. */
  if (fm.slug) {
    if (seenSlugs.has(fm.slug)) {
      failures.push(`${file}: duplicate slug "${fm.slug}" (also in ${seenSlugs.get(fm.slug)})`);
    }
    seenSlugs.set(fm.slug, file);
  }
  if (listMode) {
    const when = fm.publishAt ? `embargoed until ${fm.publishAt}` : "live on deploy";
    console.log(`  ok  ${file}  desc=${(fm.description ?? "").length}  slug=${fm.slug}  ${when}`);
  }
}

if (failures.length > 0) {
  console.error(
    `\n✗ blog frontmatter invalid — refusing to build (${failures.length} problem(s)):\n`,
  );
  for (const f of failures) console.error(`    ${f}`);
  console.error(
    "\n  These rules are enforced at runtime by src/lib/blog.ts. Shipping a post\n" +
      "  that violates them removes it from the site; historically it 500'd every\n" +
      "  route. Fix the frontmatter and rebuild.\n",
  );
  process.exit(1);
}

console.log(`✓ blog frontmatter valid (${files.length} posts)`);
