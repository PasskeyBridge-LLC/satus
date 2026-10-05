/**
 * Axe WCAG 2.2 AA on /recipes, 2026-10-05:
 * four "note" labels at 10px in signal red (#dc2626) on the tinted note
 * (#f5f5f2) measured 4.42:1, under the 4.5:1 floor for small text, and the
 * preview-branch terminal <pre> failed scrollable-region-focusable.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(): string {
  return readFileSync(new URL("../routes/recipes.tsx", import.meta.url), "utf8");
}

/** WCAG relative luminance contrast. */
function contrast(foreground: string, background: string): number {
  const channel = (hex: string, index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex: string) =>
    0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
  const lighter = Math.max(lum(foreground), lum(background));
  const darker = Math.min(lum(foreground), lum(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("recipes axe regressions", () => {
  it("makes every terminal pre keyboard-focusable", () => {
    const tags = [...source().matchAll(/<pre\b[^>]*>/g)].map((match) => match[0]);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toMatch(/tabIndex=\{0\}/);
  });

  it("keeps the note label at or above 4.5:1 on the tinted background", () => {
    const label = source().match(/uppercase tracking-\[0\.22em\] text-\[(#[0-9a-fA-F]{6})\]/);
    expect(label, "note label must name an explicit hex, not var(--signal)").not.toBeNull();
    const ratio = contrast(label![1], "#f5f5f2");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
