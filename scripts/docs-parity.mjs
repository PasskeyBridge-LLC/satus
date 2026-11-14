/**
 * Two docs-vs-code checks used by scripts/validate-docs.mjs, kept as pure
 * functions so src/lib/docs-parity.test.ts can run them on fixtures.
 *
 * A. Node lines. Until 0.3.13, /quickstart and /docs/troubleshooting said
 *    "Node 20 and 22 on macOS and Linux" while cli-ci.yml tested 20 and 24
 *    on ubuntu-latest only. A sentence that lists Node majors must list the
 *    cli-ci.yml matrix, and any OS it names must be one cli-ci.yml runs on.
 *    "Node 20+" must name the engines floor.
 *
 * B. Exit codes. Until 2026-11-10, /cli said every command returned 0 or 1
 *    and that per-failure exit codes were "planned", three releases after
 *    10 and 11 shipped. check 2 in validate-docs.mjs catches a page that
 *    names a code exit-codes.ts lacks; it cannot catch a page that denies
 *    the codes exist. This does, while exit-codes.ts exports any code
 *    other than 1.
 */

/** Text with JSX/HTML tags and `{" "}` spacers removed and whitespace collapsed. */
export function plainText(source) {
  return source
    .replace(/\{"\s*"\}/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ");
}

function sentences(text) {
  return plainText(text).split(/(?<=[.!?])\s+|"\s*,\s*"|\n/);
}

/** Node majors in the cli-ci.yml matrix, e.g. [20, 22, 24, 26]. */
export function ciNodeMatrix(ciYaml) {
  const m = /^\s*node:\s*\[([^\]]*)\]/m.exec(ciYaml);
  if (!m) return null;
  return [...m[1].matchAll(/(\d+)/g)].map((x) => Number(x[1])).sort((a, b) => a - b);
}

const OS_BY_RUNNER = [
  [/^ubuntu-/, "Linux"],
  [/^macos-/, "macOS"],
  [/^windows-/, "Windows"],
];

/** Operating systems cli-ci.yml runs on, from its `runs-on:` values. */
export function ciOperatingSystems(ciYaml) {
  const out = new Set();
  for (const m of ciYaml.matchAll(/^\s*runs-on:\s*(\S+)/gm)) {
    for (const [re, os] of OS_BY_RUNNER) if (re.test(m[1])) out.add(os);
  }
  return out;
}

/** The major in an engines range such as ">=20". */
export function enginesFloor(range) {
  const m = /^\s*>=\s*(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) : null;
}

const LIST_RE = /\bNode(?:\.js)?\s+(\d{1,2}(?:\s*(?:,\s*and|,|and|\/|&)\s*\d{1,2})+)(?!\s*\+)/gi;
const FLOOR_RE = /\bNode(?:\.js)?\s+(\d{1,2})\+/gi;
const OS_RE = /\b(macOS|Linux|Windows)\b/g;

/**
 * Failures for one doc file.
 *   matrix       ciNodeMatrix(cli-ci.yml)
 *   oses         ciOperatingSystems(cli-ci.yml)
 *   floor        enginesFloor(packages/cli/package.json engines.node)
 *   requireList  the file must state the tested Node lines
 *   requireFloor the file must state the floor ("Node 20+")
 */
export function checkNodeClaims(file, source, { matrix, oses, floor, requireList, requireFloor }) {
  const failures = [];
  let lists = 0;
  let floors = 0;
  for (const sentence of sentences(source)) {
    for (const m of sentence.matchAll(LIST_RE)) {
      lists++;
      const named = [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0])).sort((a, b) => a - b);
      if (JSON.stringify(named) !== JSON.stringify(matrix)) {
        failures.push(
          `${file}: names Node ${named.join(", ")}; cli-ci.yml tests ${matrix.join(", ")}`,
        );
      }
      // An OS in the same sentence as the tested lines reads as tested too.
      // "macOS and Windows are not tested" is a separate sentence.
      if (!/\bnot tested\b/i.test(sentence)) {
        for (const os of sentence.matchAll(OS_RE)) {
          if (!oses.has(os[1])) {
            failures.push(
              `${file}: says Node is tested on ${os[1]}; cli-ci.yml runs on ${[...oses].join(", ") || "nothing"}`,
            );
          }
        }
      }
    }
    for (const m of sentence.matchAll(FLOOR_RE)) {
      floors++;
      if (Number(m[1]) !== floor) {
        failures.push(`${file}: says Node ${m[1]}+; engines.node floor is ${floor}`);
      }
    }
  }
  if (requireList && lists === 0) {
    failures.push(`${file}: does not name the Node lines cli-ci.yml tests (${matrix.join(", ")})`);
  }
  if (requireFloor && floors === 0) {
    failures.push(`${file}: does not name the Node floor (${floor}+)`);
  }
  return failures;
}

/**
 * Failures for one doc file whose text says commands exit only 0 or 1, or
 * that per-failure exit codes are planned. `codes` is the set of values
 * exit-codes.ts exports.
 */
export function checkExitCodeDenials(file, source, codes) {
  if (![...codes].some((c) => c !== 1)) return [];
  const extra = [...codes].filter((c) => c !== 1).sort((a, b) => a - b);
  const failures = [];
  for (const sentence of sentences(source)) {
    const s = sentence.trim();
    const denial =
      (/\bexit codes?\b/i.test(s) && /\bplanned\b/i.test(s)) ||
      /\b(?:returns?|exits?(?: with)?)\s+0\b[^.]{0,60}?\b1\b[^.]{0,20}\bon (?:any|every) (?:error|failure)\b/i.test(
        s,
      ) ||
      /\bonly\s+(?:exit codes?\s+)?0\s+(?:and|or)\s+1\b/i.test(s);
    if (denial) {
      failures.push(
        `${file}: "${s.slice(0, 90)}" — exit-codes.ts also exports ${extra.join(", ")}`,
      );
    }
  }
  return failures;
}
