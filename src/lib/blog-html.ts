/**
 * `.prose-satus` scrolls `pre` and `table` on the x axis. Axe requires a
 * scrollable region to be focusable. Markdown has no attribute for that,
 * so the tags get tabindex="0" after marked runs.
 */
export function focusableScrollRegions(html: string): string {
  return html.replace(/<(pre|table)\b([^>]*)>/gi, (full, tag: string, attrs: string) => {
    if (/\stabindex\s*=/i.test(full)) return full;
    return `<${tag} tabindex="0"${attrs}>`;
  });
}
