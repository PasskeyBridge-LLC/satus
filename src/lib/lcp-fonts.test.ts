/**
 * The homepage LCP is text in JetBrains Mono. The faces in styles.css
 * pointed at fonts.gstatic.com URLs that 404, so the critical chain ended
 * on a failed font. The files are self-hosted latin subsets.
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
    expect(root).toContain("/fonts/jetbrains-mono-latin.woff2");
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
