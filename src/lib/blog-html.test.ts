import { readFileSync } from "node:fs";
import { marked } from "marked";
import { describe, expect, it } from "vitest";
import { keepShortCodeTogether } from "./blog-html";

describe("keepShortCodeTogether", () => {
  it("marks a short hyphenated inline token", () => {
    expect(keepShortCodeTogether("<p>a <code>max-cost</code> value</p>")).toBe(
      '<p>a <code class="code-token">max-cost</code> value</p>',
    );
  });

  it("leaves long tokens such as URLs to wrap", () => {
    const html = "<p><code>https://satus.sh/api/public/license/verify</code></p>";
    expect(keepShortCodeTogether(html)).toBe(html);
  });

  it("leaves tokens without a hyphen and tokens with spaces alone", () => {
    const html = "<p><code>generate</code> and <code>satus generate --json</code></p>";
    expect(keepShortCodeTogether(html)).toBe(html);
  });

  it("does not touch code inside pre", () => {
    const html = '<pre tabindex="0"><code>max-cost</code></pre><p><code>dry-run</code></p>';
    expect(keepShortCodeTogether(html)).toBe(
      '<pre tabindex="0"><code>max-cost</code></pre><p><code class="code-token">dry-run</code></p>',
    );
  });

  it("marks `max-cost` in the v0.3.3 release note intro", () => {
    const raw = readFileSync(
      new URL("../content/blog/2026-07-15-v0-3-3-release-notes.md", import.meta.url),
      "utf8",
    );
    const html = keepShortCodeTogether(marked.parse(raw, { async: false }) as string);
    const intro = html.split("\n").find((l) => l.includes("Three choices in that block matter"));
    expect(intro).toContain('<code class="code-token">max-cost</code>');
  });
});

describe("shared Terminal", () => {
  it("puts the scrolling pre in the tab order", () => {
    const src = readFileSync(new URL("../components/site/primitives.tsx", import.meta.url), "utf8");
    const terminal = src.slice(src.indexOf("export function Terminal"));
    expect(terminal).toMatch(/<pre tabIndex=\{0\}/);
  });
});
