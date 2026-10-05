/**
 * Build-time blog visibility, shared by the Vite plugin, the leak check and
 * the scheduled-publish workflow.
 *
 * Deliberately dependency-free plain ESM so that plain `node` can run it on
 * a bare CI runner without `bun install`, and Vite can import it from the
 * config. It knows exactly two frontmatter keys, `draft` and `publishAt`,
 * and parses them the same way `parseFrontmatter` in src/lib/blog.ts does.
 * Full schema validation stays in scripts/validate-blog.mjs and blog.ts.
 *
 * Why this exists: until 2026-09-26 blog.ts pulled every file in
 * src/content/blog into the bundle with `import.meta.glob` and hid drafts
 * and embargoed posts only at render time. The blog module is reachable
 * from client routes, so the full markdown of unpublished posts shipped in
 * public JS. Filtering here, before bundling, means an unpublished post's
 * frontmatter and body are never handed to the bundler at all.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BLOG_DIR = join(ROOT, "src/content/blog");

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Split a post into flat frontmatter key/value strings and its body.
 * Returns null frontmatter when the file has no frontmatter block.
 */
export function splitPost(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: null, body: raw };
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    frontmatter[trimmed.slice(0, colon).trim()] = stripQuotes(trimmed.slice(colon + 1).trim());
  }
  return { frontmatter, body: match[2] };
}

/**
 * `publishAt` as epoch ms, null when absent, NaN when present but
 * unparseable.
 */
export function publishAtMs(frontmatter) {
  const v = frontmatter?.publishAt;
  if (v === undefined || v === "") return null;
  return Date.parse(v);
}

/**
 * Whether a post may ship in a build made at `nowMs`.
 *
 * Fails closed: no frontmatter, `draft: true`, an unparseable `publishAt`
 * or a `publishAt` after `nowMs` all mean "keep it out of the bundle".
 * Mirrors publicPosts() in src/lib/blog.ts, which still applies the same
 * rule at request time.
 */
export function isPublishable(frontmatter, nowMs) {
  if (!frontmatter) return false;
  if (frontmatter.draft === "true") return false;
  const at = publishAtMs(frontmatter);
  if (at === null) return true;
  if (Number.isNaN(at)) return false;
  return at <= nowMs;
}

/** Every post file (top-level `*.md`, README excluded), sorted by name. */
export function readPosts(dir = BLOG_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), "utf8");
      const { frontmatter, body } = splitPost(raw);
      return { file, raw, frontmatter, body };
    });
}
