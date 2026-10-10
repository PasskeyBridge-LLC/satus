/**
 * `.prose-satus pre` and `table` scroll on the x axis. Axe's
 * scrollable-region-focusable rule fails those nodes on the v0.3.11 post
 * unless the region itself is in the tab order. `/favicon.ico` has to be
 * a real icon file; browsers request it even when the SVG icon is linked.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { focusableScrollRegions } from "./blog-html";

function postBody(): string {
  const raw = readFileSync(
    new URL("../content/blog/2026-08-27-v0-3-11-release-notes.md", import.meta.url),
    "utf8",
  );
  const end = raw.indexOf("\n---", 3);
  return raw.slice(end + 4);
}

describe("blog scroll regions and favicon", () => {
  it("puts tabindex=0 on every pre and table in the v0.3.11 post", () => {
    const html = focusableScrollRegions(marked.parse(postBody(), { async: false }) as string);
    const tags = [...html.matchAll(/<(pre|table)\b[^>]*>/g)].map((match) => match[0]);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toMatch(/\stabindex="0"/);
  });

  it("runs that transform when the blog module builds post HTML", () => {
    const src = readFileSync(new URL("./blog.ts", import.meta.url), "utf8");
    expect(src).toContain("focusableScrollRegions(");
  });

  it("serves a real /favicon.ico", () => {
    const path = new URL("../../public/favicon.ico", import.meta.url);
    expect(existsSync(path)).toBe(true);
    const bytes = readFileSync(path);
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.readUInt16LE(0)).toBe(0);
    expect(bytes.readUInt16LE(2)).toBe(1);
    expect(bytes.readUInt16LE(4)).toBeGreaterThan(0);
  });
});
