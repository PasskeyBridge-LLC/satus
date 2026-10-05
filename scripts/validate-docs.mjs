#!/usr/bin/env node
/**
 * Fail the build when the docs and the code disagree.
 *
 * Between 2026-08-10 and 2026-08-11 we found eleven published claims that
 * the code did not support: a safety guard that did not exist, an exit
 * code that was never emitted, a free tier overstated by 4x, a price that
 * was wrong on npmjs.com, a 14-day grace that was 24 hours, two flags that
 * were never implemented, an algorithm we do not use. Every one was
 * written in good faith and went stale quietly.
 *
 * "Read the page next to the code at each release" is a real practice and
 * we do it, but a practice that depends on remembering is not a control.
 * This script is the control for everything mechanically checkable:
 *
 *   1. Every CLI flag named in the docs exists in the CLI.
 *   2. Every exit code named in the docs exists in exit-codes.ts.
 *   3. The free-tier caps in the docs match FREE_MAX_ROWS / FREE_MAX_TABLES,
 *      and the stated per-run total is their product.
 *   4. The safety-guard threshold in the docs matches ROW_LIMIT.
 *   5. Profile names in the docs match the ProfileName union.
 *   6. Default model ids in the docs match DEFAULT_MODELS.
 *   7. The version is identical across all six places that carry it.
 *   8. The RFC 9116 security.txt has not expired (and is not about to).
 *
 * It cannot check prose — "Tarjan's algorithm" is still a human's job.
 * It covers the categories that actually broke.
 *
 * Wired into `npm run build` ahead of `vite build`, so a mismatch fails
 * the Vercel deploy rather than shipping.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const failures = [];
const fail = (msg) => failures.push(msg);

/* ---------- ground truth, parsed from source ---------- */

const generateCmd = read("packages/cli/src/commands/generate.ts");
const initCmd = read("packages/cli/src/commands/init.ts");
const exitCodes = read("packages/cli/src/exit-codes.ts");
const guard = read("packages/cli/src/generate/guard.ts");
const profiles = read("packages/cli/src/generate/profiles.ts");

const num = (src, name) => {
  const m = new RegExp(`${name}\\s*=\\s*([0-9_]+)`).exec(src);
  return m ? Number(m[1].replace(/_/g, "")) : null;
};

const REAL = {
  flags: new Set(
    // Declared as `.option("--profile <name>", ...)`, so the flag name is
    // followed by an argument placeholder, not the closing quote.
    //
    // Match either quote character. This scan was written against CLI source
    // that was uniformly single-quoted; `.prettierrc` sets
    // "singleQuote": false, so running prettier rewrites all of them and a
    // single-quote-only regex silently yields an EMPTY flag set — which
    // surfaces as every documented flag reported missing at once, rather than
    // as a parse error. Keep this quote-agnostic.
    [...generateCmd.matchAll(/['"](--[a-z-]+)/g), ...initCmd.matchAll(/['"](--[a-z-]+)/g)]
      .map((m) => m[1])
      // commander provides these two on every command.
      .concat(["--help", "--version"])
      // registered as `-v, --verbose`, so the flag scan above misses it.
      .concat(/['"]-v, --verbose['"]/.test(generateCmd) ? ["--verbose"] : []),
  ),
  exitCodes: new Set([...exitCodes.matchAll(/export const \w+ = (\d+)/g)].map((m) => Number(m[1]))),
  freeRows: num(generateCmd, "FREE_MAX_ROWS"),
  freeTables: num(generateCmd, "FREE_MAX_TABLES"),
  rowLimit: num(guard, "ROW_LIMIT"),
  profileNames: new Set(
    (/export type ProfileName = ([^\n]+)/.exec(profiles)?.[1] ?? "")
      .split("|")
      // Strip either quote style and a trailing semicolon. Same reason as the
      // flag scan above: a single-quote-only strip leaves literal `"`
      // characters in every name once the repo is formatted, so each name
      // fails to match itself.
      .map((s) => s.trim().replace(/['"]/g, "").replace(/;$/, ""))
      .filter(Boolean),
  ),
  models: new Set(
    [...generateCmd.matchAll(/(?:openai|anthropic|xai):\s*['"]([a-z0-9.-]+)['"]/g)].map(
      (m) => m[1],
    ),
  ),
};

/* Doc surfaces. Third-party CLI examples (supabase, neon, tsup, npm) live
 * in recipes and the dev docs; their flags are not ours to validate. */
const DOC_FILES = [
  ...readdirSync(join(ROOT, "src/routes"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `src/routes/${f}`),
  "public/llms.txt",
  "README.md",
  "packages/cli/README.md",
  "packages/action/README.md",
];
const FOREIGN_FLAG_FILES = new Set([
  "src/routes/recipes.tsx",
  "packages/cli/README.md",
  "packages/action/README.md",
  "README.md",
]);

/* ---------- 1. flags ---------- */
for (const file of DOC_FILES) {
  if (FOREIGN_FLAG_FILES.has(file)) continue;
  const text = read(file);
  for (const m of text.matchAll(/(?<![-\w])--[a-z][a-z-]{1,24}(?![\w-])/g)) {
    const flag = m[0];
    // CSS custom properties (--ink, --paper) share the syntax.
    if (/^--(ink|paper|mute|signal|hairline|radius|font|bg|fg)$/.test(flag)) continue;
    // Documented precisely because it does not exist ("satus has no --seed
    // flag, on purpose"). Its absence is a published promise of its own.
    if (flag === "--seed") continue;
    if (!REAL.flags.has(flag)) {
      fail(`${file}: documents \`${flag}\`, which is not a satus CLI flag`);
    }
  }
}

/* ---------- 2. exit codes ---------- */
for (const file of DOC_FILES) {
  const text = read(file);
  for (const m of text.matchAll(/exit(?:s| code|ed)?[^.\n]{0,24}?\b(\d{1,2})\b/gi)) {
    const code = Number(m[1]);
    if (code === 0) continue;
    if (!REAL.exitCodes.has(code)) {
      fail(`${file}: documents exit code ${code}, which is not defined in exit-codes.ts`);
    }
  }
}

/* ---------- 3. free-tier caps ---------- */
const freeTotal = REAL.freeRows * REAL.freeTables;
for (const file of DOC_FILES) {
  const text = read(file);
  for (const m of text.matchAll(/([\d,]+) rows per run/gi)) {
    const claimed = Number(m[1].replace(/,/g, ""));
    if (claimed !== freeTotal) {
      fail(
        `${file}: states ${claimed} rows per run; ` +
          `FREE_MAX_ROWS(${REAL.freeRows}) x FREE_MAX_TABLES(${REAL.freeTables}) = ${freeTotal}`,
      );
    }
  }
  for (const m of text.matchAll(/up to (\d+) rows per table across (\d+) tables/gi)) {
    if (Number(m[1]) !== REAL.freeRows || Number(m[2]) !== REAL.freeTables) {
      fail(
        `${file}: claims free caps of ${m[1]}x${m[2]}; source says ${REAL.freeRows}x${REAL.freeTables}`,
      );
    }
  }
  for (const m of text.matchAll(/capped at (\d+) rows per table across (\d+) tables/gi)) {
    if (Number(m[1]) !== REAL.freeRows || Number(m[2]) !== REAL.freeTables) {
      fail(
        `${file}: claims free caps of ${m[1]}x${m[2]}; source says ` +
          `${REAL.freeRows}x${REAL.freeTables}`,
      );
    }
  }
}

/* ---------- 4. safety-guard threshold ---------- */
const limitStr = REAL.rowLimit.toLocaleString("en-US");
for (const file of DOC_FILES) {
  const text = read(file);
  for (const m of text.matchAll(/([\d,]{4,})[- ]row safety guard/gi)) {
    if (Number(m[1].replace(/,/g, "")) !== REAL.rowLimit) {
      fail(`${file}: says a ${m[1]}-row safety guard; ROW_LIMIT is ${limitStr}`);
    }
  }
}

/* ---------- 5. profiles ---------- */
for (const file of DOC_FILES) {
  const text = read(file);
  const profileMentions = [
    // pipe-lists: `--profile saas|ecommerce|b2b`
    ...[...text.matchAll(/--profile\s+([a-z0-9]+(?:\|[a-z0-9]+)+)/g)].map((m) => m[1]),
    // real invocations: `satus generate --profile ecommerce`
    ...[...text.matchAll(/satus generate[^\n`"]*--profile\s+([a-z0-9]+)/g)].map((m) => m[1]),
  ];
  for (const mention of profileMentions) {
    for (const name of mention.split("|").filter(Boolean)) {
      if (!REAL.profileNames.has(name)) {
        fail(
          `${file}: documents profile "${name}"; ProfileName is ` +
            `${[...REAL.profileNames].join(" | ")}`,
        );
      }
    }
  }
}

/* ---------- 6. default models ---------- */
for (const file of DOC_FILES) {
  const text = read(file);
  for (const m of text.matchAll(
    /defaults?:?\s*\)?\s*([a-z0-9.-]*(?:gpt|claude|grok)[a-z0-9.-]*)/gi,
  )) {
    const model = m[1].toLowerCase();
    if (!REAL.models.has(model)) {
      fail(
        `${file}: names default model "${model}"; DEFAULT_MODELS has ${[...REAL.models].join(", ")}`,
      );
    }
  }
}

/* ---------- 7. version consistency ---------- */
const versions = {
  "packages/cli/package.json": JSON.parse(read("packages/cli/package.json")).version,
  "packages/cli/package-lock.json": JSON.parse(read("packages/cli/package-lock.json")).version,
  // Quote-agnostic, here and for action.yml below. A single-quote-only match
  // reports "(unparsed)" rather than a mismatch, so the check goes quiet
  // instead of going red — and prettier rewrote both files to double quotes
  // the first time it ran over the repo.
  "packages/cli/src/version.ts": /version = ['"]([^'"]+)['"]/.exec(
    read("packages/cli/src/version.ts"),
  )?.[1],
  "src/lib/version.ts": /SATUS_VERSION = "([^"]+)"/.exec(read("src/lib/version.ts"))?.[1],
  "packages/action/action.yml": /satus-version:[\s\S]*?default: ['"]([^'"]+)['"]/.exec(
    read("packages/action/action.yml"),
  )?.[1],
  "packages/action/README.md": /`satus-version` \| no \| `([^`]+)`/.exec(
    read("packages/action/README.md"),
  )?.[1],
};
const distinct = [...new Set(Object.values(versions))];
if (distinct.length > 1) {
  fail(
    "version drift across release files:\n" +
      Object.entries(versions)
        .map(([f, v]) => `        ${v ?? "(unparsed)"}  ${f}`)
        .join("\n"),
  );
}

/* ---------- 8. security.txt freshness (RFC 9116 §2.5.5) ---------- */
const SECURITY_TXT = "public/.well-known/security.txt";
if (!existsSync(join(ROOT, SECURITY_TXT))) {
  fail(`${SECURITY_TXT} is missing, but /security tells researchers it exists`);
} else {
  const expires = /^Expires:\s*(.+)$/m.exec(read(SECURITY_TXT))?.[1]?.trim();
  if (!expires) {
    fail(`${SECURITY_TXT}: no Expires field (mandatory under RFC 9116 §2.5.5)`);
  } else {
    const days = (Date.parse(expires) - Date.now()) / 86_400_000;
    if (Number.isNaN(days)) fail(`${SECURITY_TXT}: Expires "${expires}" is not a valid timestamp`);
    else if (days < 0) fail(`${SECURITY_TXT}: expired ${Math.abs(Math.round(days))} days ago`);
    else if (days < 30)
      fail(`${SECURITY_TXT}: expires in ${Math.round(days)} days — refresh it now`);
  }
}

/* ---------- report ---------- */
if (failures.length > 0) {
  console.error(`\n✗ docs contradict the code — refusing to build (${failures.length}):\n`);
  for (const f of failures) console.error(`    ${f}`);
  console.error(
    "\n  Every check here exists because the corresponding claim was wrong in\n" +
      "  production at some point. Fix the code or fix the copy — but not by\n" +
      "  loosening this script.\n",
  );
  process.exit(1);
}

console.log(
  `✓ docs agree with the code ` +
    `(flags, exit codes ${[...REAL.exitCodes].sort((a, b) => a - b).join("/")}, ` +
    `free ${REAL.freeRows}x${REAL.freeTables}, guard ${limitStr}, ` +
    `v${distinct[0]}, security.txt current)`,
);
