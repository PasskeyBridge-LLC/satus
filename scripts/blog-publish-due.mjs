#!/usr/bin/env node
/**
 * Is a rebuild due? Used by .github/workflows/scheduled-publish.yml.
 *
 * Production builds withhold embargoed posts (scripts/vite-plugin-blog-posts.ts),
 * so a post only goes live on the first build after its `publishAt`. This
 * prints `due=true` when some non-draft post's `publishAt` falls in
 * (since, now], plus the matching slugs, in GITHUB_OUTPUT `key=value` form.
 * Human-readable detail goes to stderr.
 *
 * Usage: node scripts/blog-publish-due.mjs --since <ISO instant> [--now <ISO instant>]
 */
import { publishAtMs, readPosts } from "./blog-visibility.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const since = Date.parse(arg("since") ?? "");
const now = arg("now") ? Date.parse(arg("now")) : Date.now();
if (Number.isNaN(since) || Number.isNaN(now)) {
  console.error("blog-publish-due: --since (and --now, if given) must be ISO 8601 instants");
  process.exit(2);
}

const due = readPosts().filter((p) => {
  if (!p.frontmatter || p.frontmatter.draft === "true") return false;
  const at = publishAtMs(p.frontmatter);
  return at !== null && !Number.isNaN(at) && at > since && at <= now;
});

console.error(
  `blog-publish-due: window (${new Date(since).toISOString()}, ${new Date(now).toISOString()}]: ` +
    (due.length
      ? due.map((p) => `${p.frontmatter.slug} @ ${p.frontmatter.publishAt}`).join(", ")
      : "nothing due"),
);
console.log(`due=${due.length > 0}`);
console.log(`slugs=${due.map((p) => p.frontmatter.slug).join(" ")}`);
