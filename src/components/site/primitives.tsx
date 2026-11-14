/**
 * Shared primitives for satus.sh marketing site.
 *
 * Section: numbered §xx block with label + lowercase headline, hairline rule,
 *          and content slot. Renders the page's content units consistently.
 * Prose:   body-copy container with ~62ch max measure and tuned inline-element styling.
 * Mono:    inline JetBrains Mono span used inside Prose for code-style terms.
 *
 * Kept presentational only—no routing, no state. Each route composes these.
 */

import type { ReactNode } from "react";

export type SectionMeta = { id: string; n: string; label: string };

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono ${className}`}>{children}</span>;
}

/**
 * Hairline-framed terminal block shared by /cli, /quickstart and /recipes.
 * The pre scrolls on the x axis, so it is in the tab order (axe
 * scrollable-region-focusable) and keyboard users can scroll it with the
 * arrow keys. The global :focus-visible ring marks it when focused.
 */
export function Terminal({ children }: { children: ReactNode }) {
  return (
    <div className="mt-8 max-w-[760px] border-y border-[var(--ink)]">
      <pre tabIndex={0} className="overflow-x-auto px-1 py-6 font-mono text-[13px] leading-[1.85]">
        {children}
      </pre>
    </div>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[62ch] text-[15.5px] leading-[1.7] text-[var(--ink)]/85 [&_code]:font-mono [&_code]:text-[14px] [&_code]:text-[var(--ink)] [&_code]:[overflow-wrap:anywhere] [&_code]:[word-break:break-word] [&_em]:not-italic [&_em]:text-[var(--ink)] [&_strong]:font-medium [&_strong]:text-[var(--ink)] [&_p]:mb-4 last:[&_p]:mb-0">
      {children}
    </div>
  );
}

export function Section({
  id,
  n,
  label,
  title,
  heading = "h2",
  children,
}: {
  id: string;
  n: string;
  label: string;
  title: ReactNode;
  /**
   * Every page here is a stack of Sections, so with h2 hardcoded thirteen
   * pages shipped with no h1 at all -- the entire marketing and docs surface,
   * everything except the blog posts and the legal/checkout routes, which
   * build their own headings.
   *
   * Pass "h1" on the FIRST Section of a page and leave the rest alone. The
   * class list is identical either way, so this changes the document outline
   * and nothing visual. `scripts/validate-headings.mjs` runs ahead of
   * `vite build` and fails a route that ends up with none or more than one.
   */
  heading?: "h1" | "h2";
  children: ReactNode;
}) {
  const Heading = heading;
  return (
    <section
      id={id}
      className="scroll-mt-20 border-t border-[var(--hairline)] py-16 first:border-t-0 first:pt-0"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--mute)]">
        <span className="text-[var(--signal)]">§{n}</span>
        <span className="mx-3 text-[var(--hairline)]">|</span>
        <span>{label}</span>
      </div>
      <Heading className="mt-5 font-mono text-[26px] font-medium leading-[1.2] tracking-tight text-[var(--ink)] md:text-[32px]">
        {title}
      </Heading>
      <hr className="mt-6" />
      <div className="mt-8">{children}</div>
    </section>
  );
}
