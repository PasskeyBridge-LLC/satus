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

/** Longest inline code token kept on one line; a 320px column fits it. */
const SHORT_TOKEN = 24;

/**
 * Browsers may break inline code after a hyphen, so `max-cost` could render
 * as "max-" / "cost". A short inline token with no whitespace gets
 * class="code-token", which `.prose-satus code.code-token` keeps on one line.
 * Longer tokens (URLs, paths) keep the overflow-wrap rule, so they still
 * wrap instead of widening the page. Code inside <pre> is left alone.
 */
export function keepShortCodeTogether(html: string): string {
  return html
    .split(/(<pre\b[\s\S]*?<\/pre>)/i)
    .map((part) =>
      /^<pre\b/i.test(part)
        ? part
        : part.replace(/<code>([^<\s]+)<\/code>/g, (full, text: string) => {
            const visible = text.replace(/&[#\w]+;/g, "x");
            return visible.length <= SHORT_TOKEN && visible.includes("-")
              ? `<code class="code-token">${text}</code>`
              : full;
          }),
    )
    .join("");
}
