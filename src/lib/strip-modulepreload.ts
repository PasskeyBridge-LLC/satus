/**
 * TanStack Start emits `<link rel="modulepreload">` for the entry chunk
 * even when Vite's `modulePreload` is off. That chunk is ~300KB gzipped
 * and it is discovered before the LCP font. The module script at the end
 * of the body still loads it.
 */
export function stripModulePreloads(html: string): string {
  return html.replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/g, "");
}
