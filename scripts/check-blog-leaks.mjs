#!/usr/bin/env node
/**
 * Post-build gate: no draft or embargoed blog post may appear in any build
 * artifact.
 *
 * Run after `bun run build`. Walks the build output (Nitro's `.output/`,
 * plus `dist/` and `.vercel/output/` when present), covering public JS
 * chunks, the SSR/Worker bundle, prerendered HTML and any JSON manifests,
 * and fails if any artifact carries an unpublished post's slug, its
 * description, or a sample of phrases from its body.
 *
 * Content-agnostic: which posts count as unpublished is decided from their
 * frontmatter by scripts/blog-visibility.mjs, relative to now. Now is at
 * or after the build instant, so this is never stricter than the build
 * filter.
 *
 * Matching normalises both sides to lowercase alphanumeric words, so a
 * phrase is found whether it leaked as raw markdown, a JSON-escaped string,
 * or rendered HTML. Body phrases are 8-word runs of plain words only,
 * taken from outside code blocks and inline markup.
 *
 * Also asserts that every published post's slug IS present, which proves
 * the scan is looking at a real build with the blog in it.
 *
 * Usage: node scripts/check-blog-leaks.mjs [outputDir ...]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { ROOT, isPublishable, readPosts } from "./blog-visibility.mjs";

const PHRASE_WORDS = 8;
const PHRASES_PER_POST = 6;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|wasm|woff2?|ttf|otf|eot|data|tar|zip)$/i;

const normalise = (s) =>
  s
    .replace(/&#39;|&#x27;|&apos;|&quot;|&amp;|&lt;|&gt;|&nbsp;/g, " ")
    .replace(/\\u[0-9a-fA-F]{4}|\\[nrt]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

/** Up to PHRASES_PER_POST 8-word plain-prose runs from a markdown body. */
function bodyPhrases(body) {
  const prose = body
    .replace(/```[\s\S]*?```/g, "\n\n")
    .split(/\n\s*\n/)
    .filter((para) => !/^\s*(#|\||<|>|    |\t|---)/.test(para))
    .join("\n")
    /* Cut at inline markup so a phrase never spans markdown syntax that
     * renders differently in HTML. */
    .split(/`[^`]*`|\[|\]\([^)]*\)|[*_~]|\n/);
  const phrases = [];
  for (const segment of prose) {
    const words = segment.trim().split(/\s+/);
    let run = [];
    for (const w of words) {
      if (/^[A-Za-z0-9]+[.,;:]?$/.test(w)) {
        run.push(w);
        if (run.length === PHRASE_WORDS) {
          phrases.push(normalise(run.join(" ")).trim());
          run = [];
          break; // one phrase per segment, spread across the post
        }
      } else {
        run = [];
      }
    }
    if (phrases.length >= PHRASES_PER_POST) break;
  }
  return phrases;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      yield* walk(p);
    } else if (!BINARY_EXT.test(name)) {
      yield p;
    }
  }
}

function readArtifact(p) {
  const buf = readFileSync(p);
  try {
    if (p.endsWith(".gz")) return gunzipSync(buf).toString("utf8");
    if (p.endsWith(".br")) return brotliDecompressSync(buf).toString("utf8");
  } catch {
    /* not actually compressed; fall through */
  }
  return buf.toString("utf8");
}

const args = process.argv.slice(2);
const dirs = (args.length ? args : [".output", "dist", ".vercel/output"])
  .map((d) => join(ROOT, d))
  .filter((d) => existsSync(d));
if (dirs.length === 0) {
  console.error("check-blog-leaks: no build output found. Run `bun run build` first.");
  process.exit(1);
}

const now = Date.now();
const posts = readPosts();
const withheld = posts.filter((p) => !isPublishable(p.frontmatter, now));
const published = posts.filter((p) => isPublishable(p.frontmatter, now));

const needles = withheld.flatMap((p) => {
  const fm = p.frontmatter ?? {};
  const out = [];
  if (fm.slug) out.push({ file: p.file, kind: "slug", raw: fm.slug });
  if (fm.description && fm.description.length >= 20)
    out.push({ file: p.file, kind: "description", norm: normalise(fm.description).trim() });
  for (const ph of bodyPhrases(p.body)) out.push({ file: p.file, kind: "body", norm: ph });
  return out;
});

const artifacts = dirs.flatMap((d) => [...walk(d)]);
const leaks = [];
const seenPublished = new Set();
for (const path of artifacts) {
  const text = readArtifact(path);
  const norm = normalise(text);
  for (const n of needles) {
    const hit = n.raw ? text.includes(n.raw) : norm.includes(n.norm);
    if (hit) leaks.push({ ...n, path: relative(ROOT, path) });
  }
  for (const p of published)
    if (p.frontmatter?.slug && text.includes(p.frontmatter.slug)) seenPublished.add(p.file);
}

console.log(
  `check-blog-leaks: scanned ${artifacts.length} artifact(s) in ${dirs.map((d) => relative(ROOT, d)).join(", ")}; ` +
    `${withheld.length} unpublished post(s), ${needles.length} needle(s); ${published.length} published post(s).`,
);

let failed = false;
if (leaks.length) {
  failed = true;
  console.error(`\n  FAIL: ${leaks.length} leak(s) of unpublished posts in build output:`);
  for (const l of leaks) console.error(`    ${l.file} [${l.kind}] in ${l.path}`);
}
const missing = published.filter((p) => !seenPublished.has(p.file));
if (missing.length) {
  failed = true;
  console.error(`\n  FAIL: ${missing.length} published post(s) missing from build output:`);
  for (const p of missing) console.error(`    ${p.file}`);
}
if (failed) process.exit(1);
console.log("  ok: no unpublished post in any artifact; every published post present.");
