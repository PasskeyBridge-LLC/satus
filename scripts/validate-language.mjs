#!/usr/bin/env node
/**
 * Fail the build on prose that reads like it was generated rather than
 * written.
 *
 * The corpus was clean when this landed: one tell across 44 posts and every
 * site route, introduced the same morning it was found. That is the point of
 * adding the gate now rather than later — it is cheap to keep a clean corpus
 * clean, and expensive to clean one that drifted for a year.
 *
 * What it checks is the mechanical half of mem/features/house-voice.md:
 * fixed phrases with near-zero legitimate use in this repo. It cannot judge
 * whether a paragraph earns its place, and it does not try. Rhythm standing
 * in for content is a human read.
 *
 * Deliberately NOT checked, because the corpus shows they are house style
 * rather than tells: em dashes (172 of them), contractions (42), and the
 * occasional rhetorical question (49). A linter that strips those would be
 * flattening the voice it is supposed to protect.
 *
 * Escape hatch: put `<!-- voice-ok: reason -->` (or `// voice-ok: reason`
 * in a .tsx route) on the line BEFORE the flagged line. There is exactly one
 * in the corpus. If you find yourself adding a third, the pattern is wrong —
 * fix the pattern in one commit, with the reason, rather than sprinkling
 * exemptions.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/**
 * Each entry: [regex, what to do instead].
 *
 * Keep these high-precision. A pattern that fires on good prose trains
 * people to add exemptions, and a gate everyone exempts is not a gate.
 */
const TELLS = [
  // Hollow antithesis: the shape promises a reveal and restates instead.
  //
  // Both halves of the negation need contracted forms. The first draft of
  // this pattern spelled only "is not" / "was not" and so sailed straight
  // past "It wasn't about X, it was about Y" — the canonical example, and
  // the one this gate exists for. It was caught by feeding the gate a file
  // of deliberate violations, not by reading the regex. Do the same after
  // editing this list.
  [
    /\b(?:it|that|this)(?:'s|’s| is| isn'?t| was| wasn'?t| were| weren'?t|'d been| had been)\s*(?:not\s+)?(?:just |merely |only |simply )?about\b[^.?!]{0,90}?,\s*(?:it|that|this)(?:'s|’s| is| was| were)\b/i,
    "state the claim directly; the 'not about X, about Y' shape restates rather than reveals",
  ],
  [
    /\bnot (?:merely|just|simply) [a-z]+,\s*(?:it|they|that|this) (?:is|are|was|were)\b/i,
    "drop the first half and assert the second",
  ],
  // Correction by contrast: each phrase restates a claim through its
  // opposite. Write the claim once, as a plain statement of what happened
  // or what the code does. "not more than N" is a bound and stays legal.
  [/\bnot more\b(?!\s+than\b)/i, "state the direction once"],
  [/\bdoesn(?:'|’)?t just\b/i, "state the full effect directly"],
  [/\bsold as\b/i, "state what was documented and what the code did"],
  // Teaser headings and throat-clearing.
  [/\bwhat the receipts\b/i, "name the finding in the heading"],
  [/\bhere'?s the (?:thing|kicker|rub|catch)\b/i, "say the thing"],
  [/\blet'?s (?:dive|unpack|talk about|be clear)\b/i, "start with the fact"],
  [/\bat the end of the day\b/i, "delete, or state the conclusion"],
  [/\bmake no mistake\b/i, "delete; the sentence should carry itself"],
  [/\bit'?s worth noting\b/i, "delete and keep the note"],
  [/\bbuckle up\b/i, "delete"],
  [/\bwe'?ve all been there\b/i, "delete; say who hit it and when"],
  [/\bneedle[- ]moving\b/i, "give the number the needle moved"],
  // Marketing register. Zero legitimate uses in this corpus today.
  [/\bseamless(?:ly)?\b/i, "say what it does without the adjective"],
  [/\brobust\b/i, "say what it withstands"],
  [/\bgame[- ]chang(?:er|ing)\b/i, "state the change"],
  [/\bcutting[- ]edge\b/i, "name the version"],
  [/\bbest[- ]in[- ]class\b/i, "compare to something specific"],
  [/\bsuper[- ]?charge[ds]?\b/i, "say what got faster, and by how much"],
  [/\bunlock (?:the power|your)\b/i, "describe the capability"],
  [/\belevate your\b/i, "describe the change"],
  [/\bdelve\b/i, "use a plain verb"],
  [/\btapestry\b/i, "use a plain noun"],
  [/\btestament to\b/i, "state the evidence"],
  [/\bever[- ](?:evolving|changing)\b/i, "delete"],
  [/\bin today'?s [a-z-]+ (?:landscape|world|era)\b/i, "delete"],
];

/** `<!-- voice-ok: ... -->` or `// voice-ok: ...` on the preceding line. */
const EXEMPT = /(?:<!--|\/\/)\s*voice-ok:/i;

const BLOG_DIR = "src/content/blog";
const files = [
  ...readdirSync(join(ROOT, BLOG_DIR))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => `${BLOG_DIR}/${f}`),
  ...readdirSync(join(ROOT, "src/routes"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `src/routes/${f}`),
];

const failures = [];

for (const file of files) {
  const lines = read(file).split("\n");
  for (const [i, line] of lines.entries()) {
    // Skip fenced-code content cheaply: transcripts quote real tool output,
    // and we do not get to edit what a third-party CLI prints.
    if (/^\s*(?:```|\$ |\s{4,}\S)/.test(line)) continue;
    if (i > 0 && EXEMPT.test(lines[i - 1])) continue;

    for (const [re, advice] of TELLS) {
      const m = re.exec(line);
      if (m) {
        failures.push(`${file}:${i + 1}  "${m[0].trim().slice(0, 60)}" — ${advice}`);
        break;
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`\n✗ prose reads as generated — refusing to build (${failures.length}):\n`);
  for (const f of failures) console.error(`    ${f}`);
  console.error(
    "\n  mem/features/house-voice.md says what the voice is and why each of\n" +
      "  these is out. Reword it. If the phrase is genuinely right, put\n" +
      "  `voice-ok: <reason>` on the line before — and expect to justify it.\n" +
      "  Do not loosen the pattern list to make this pass.\n",
  );
  process.exit(1);
}

console.log(
  `✓ prose carries no generated-text tells (${files.length} files, ${TELLS.length} patterns)`,
);
