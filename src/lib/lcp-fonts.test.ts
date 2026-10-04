/**
 * Measured LCP on /, /pricing, and /docs is a body paragraph (Work Sans).
 * Headings are JetBrains Mono. Both faces are self-hosted latin subsets;
 * the paragraph face is preloaded first.
 *
 * The client route tree statically imports the blog routes, and those
 * routes statically import every post. That markdown was about half of the
 * entry script and one long task. Blog data loads only when a blog loader
 * runs. The page shell also used to start at opacity 0, which Lighthouse
 * does not count as a paint.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripModulePreloads } from "./strip-modulepreload";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const root = readFileSync(new URL("../routes/__root.tsx", import.meta.url), "utf8");
const auth = readFileSync(
  new URL("../integrations/supabase/auth-attacher.ts", import.meta.url),
  "utf8",
);
const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

describe("first-paint cost", () => {
  it("self-hosts the latin faces and preloads the mono face", () => {
    expect(css).not.toMatch(/fonts\.gstatic\.com/);
    const urls = [...css.matchAll(/url\("(\/fonts\/[^"]+\.woff2)"\)/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThanOrEqual(5);
    for (const url of urls) {
      const file = new URL(`../../public${url}`, import.meta.url);
      expect(existsSync(file), url).toBe(true);
      expect(readFileSync(file).length).toBeGreaterThan(1000);
    }
    expect(root).toContain('rel: "preload"');
    const work = root.indexOf("/fonts/work-sans-latin.woff2");
    const mono = root.indexOf("/fonts/jetbrains-mono-latin.woff2");
    expect(work).toBeGreaterThan(-1);
    expect(mono).toBeGreaterThan(work);
  });

  it("paints the shell on the first frame", () => {
    expect(css).not.toMatch(/@keyframes\s+satus-fade-in/);
    expect(css).not.toMatch(/\.satus-fade\s*\{[^}]*opacity\s*:\s*0/);
  });

  it("keeps blog markdown out of the initial route graph", () => {
    for (const file of ["../routes/blog.index.tsx", "../routes/blog.$slug.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/import\s+\{[^}]*\}\s+from\s+"@\/lib\/blog"/);
      expect(source, file).toMatch(/import\("@\/lib\/blog"\)/);
    }
  });

  it("does not put the Supabase client in the initial module graph", () => {
    expect(auth).not.toMatch(/^import\s+\{[^}]*supabase[^}]*\}\s+from\s+"\.\/client"/m);
    expect(auth).toMatch(/import\("\.\/client"\)/);
  });

  it("does not preload the entry chunk ahead of the font", () => {
    expect(viteConfig).toMatch(/modulePreload:\s*false/);
    const html =
      '<link rel="modulepreload" href="/assets/index-abc.js"/><link rel="preload" href="/fonts/jetbrains-mono-latin.woff2" as="font"/><script type="module" src="/assets/index-abc.js"></script>';
    const stripped = stripModulePreloads(html);
    expect(stripped).not.toContain("modulepreload");
    expect(stripped).toContain('href="/fonts/jetbrains-mono-latin.woff2"');
    expect(stripped).toContain("<script");
    const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    expect(server).toContain("stripModulePreloads");
  });
});
