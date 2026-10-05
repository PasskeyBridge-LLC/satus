/**
 * /docs/troubleshooting—single-page guide to every known failure mode.
 *
 * Organised by symptom, not by exit code: most users land here from a
 * stack trace, not from reading the reference. Every entry maps back to a
 * fact already documented in /cli (exit codes, env vars, flags) or
 * /quickstart (the day-one failures). Do not invent new error names here;
 * if you need a new one, add it to cli.tsx first.
 *
 * GEO: FAQPage JSON-LD so generative engines can lift individual Q/A
 * pairs verbatim when answering "satus error X" queries.
 */

import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageShell } from "@/components/site/chrome";
import { Prose, Section, type SectionMeta } from "@/components/site/primitives";

const SITE_URL = "https://satus.sh";

const SECTIONS: ReadonlyArray<SectionMeta> = [
  { id: "install", n: "01", label: "Install & setup" },
  { id: "schema", n: "02", label: "Schema errors" },
  { id: "llm", n: "03", label: "LLM provider" },
  { id: "runtime", n: "04", label: "Runtime & rollback" },
  { id: "license", n: "05", label: "License & billing" },
  { id: "still-stuck", n: "06", label: "Still stuck" },
];

/* Strict-typed FAQ entries. `q` becomes the FAQPage Question.name; the
 * plain-text body becomes Answer.text. Keep both in sync if you edit. */
type Faq = { q: string; a: string; render?: ReactNode };

const FAQS: Faq[] = [
  // -------- Install & setup --------
  {
    q: "satus: command not found",
    a: "The CLI was installed to a directory not on your PATH. Run `npm prefix -g` to find npm's global bin directory and add it to your shell's PATH, or reinstall with `npm i -g @passkeybridge/satus` after fixing your npm prefix.",
  },
  {
    q: "Which Node versions are supported?",
    a: "Node 20 and 22 on macOS and Linux (the package declares engines >=20). Windows is supported via WSL2. Older Node versions are not tested and will likely fail at install or first run.",
  },
  {
    q: "Do I need any environment variables to run `satus init`?",
    a: "No. `init` only writes files into ./satus/ and needs neither DATABASE_URL nor OPENAI_API_KEY. The two variables become required at `satus plan` and `satus generate`.",
  },

  // -------- Schema errors --------
  {
    q: "E_FK_CYCLE: foreign-key cycle could not be broken automatically",
    a: "Your schema has a cycle in its foreign keys, and every column on the cycle is NOT NULL with no DEFAULT and is not declared DEFERRABLE. satus refuses to guess which constraint to violate. Fix one of three ways: mark one side of the cycle nullable, add a column DEFAULT, or declare the constraint DEFERRABLE INITIALLY DEFERRED. The /docs/how-it-works page explains why each option works.",
  },
  {
    q: "E_DB_NOT_EMPTY: database has more than 10,000 user rows",
    a: "Safety guard. satus refuses to write into a database that already holds more than 10,000 user-table rows, because that's almost always a sign DATABASE_URL points at production by accident. If you really do mean to append seed data, re-run with --force. Better: point at a fresh Supabase/Neon branch or a Docker container.",
  },
  {
    q: "E_PROFILE_NOT_FOUND: profile name doesn't match",
    a: "The --profile value must be one of the three bundled profiles: saas, ecommerce, or b2b. There are no hyphens in the names, and custom profile files are not supported yet—`satus init` writes the chosen profile into satus.config.json, which `satus generate` reads when the flag is omitted.",
  },
  {
    q: "satus generated rows that violate a CHECK constraint I didn't think to declare in the profile",
    a: "The whole transaction will have rolled back, so your database is fine. File an issue with the CREATE TABLE statement and the CHECK constraint—the planner reads NOT NULL, FK, and unique constraints from pg_catalog, but CHECK predicates are out of scope for the 0.1.x line.",
  },

  // -------- LLM provider --------
  {
    q: "E_LLM_AUTH: provider key missing, malformed, or rejected",
    a: "Either the variable for the selected provider isn't set (OPENAI_API_KEY, ANTHROPIC_API_KEY or XAI_API_KEY), the key has the wrong shape, or the provider rejected it (revoked, billing problem, wrong organisation). Check `echo $OPENAI_API_KEY` (or `$ANTHROPIC_API_KEY`) returns a value, and verify the key in the provider's dashboard. satus never proxies your key—the call goes from your machine directly to the provider.",
  },
  {
    q: "E_LLM_RATE_LIMIT: provider rate-limited the run",
    a: "satus retries with exponential backoff up to 5 attempts before giving up. If you hit a hard tier ceiling, drop --batch-size below the default of 25 (try 10), wait a minute, switch to a different provider with --provider, or upgrade your account tier. We never resell tokens—the bill is on your provider's dashboard.",
  },
  {
    q: "The run cost more than I expected.",
    a: "Use --max-cost <usd> to cap the spend; by default the planner refuses to proceed if the estimated cost exceeds $1.00. Always preview with `satus generate --profile <name> --dry-run` first—the planner prints `estimated cost · $X.XX` before any LLM calls actually fire. For per-batch detail, add `-v` / `--verbose`; for machine-readable summaries pipe `--json` into jq.",
  },
  {
    q: "Can I use Anthropic, xAI or Gemini instead of OpenAI?",
    a: "Anthropic, yes, as of v0.3.0. Set ANTHROPIC_API_KEY and the CLI picks it up; the default model is claude-haiku-4-5. If both OPENAI_API_KEY and ANTHROPIC_API_KEY are exported, pass --provider openai|anthropic (or set the provider field in satus.config.json) so we know which one to use. xAI is supported from the CLI release after 0.3.11: set XAI_API_KEY and pass --provider xai (the default model is grok-4.20-0309-non-reasoning). Gemini is not supported yet; see the changelog for the active roadmap.",
  },

  // -------- Runtime & rollback --------
  {
    q: "satus generate failed halfway. Is my database half-seeded?",
    a: "No. The entire run executes inside a single Postgres transaction. A failure—any failure, including Ctrl-C—rolls back to the state your database was in before you ran the command. There is nothing to clean up.",
  },
  {
    q: "Can I run satus generate twice in a row?",
    a: "Yes. Each run inserts on top of whatever is there—satus never deletes data unless you ask. Pass --truncate to clear the target tables (TRUNCATE ... RESTART IDENTITY, no CASCADE) inside the same transaction before re-seeding. Since 0.3.7 there is deliberately no CASCADE: if a table outside the run set has a foreign key into one inside it, satus errors out instead of emptying a table you never asked it to touch. For CI loops, point at a database branch and reset between runs.",
  },
  {
    q: "How do I produce the same data twice for snapshot tests?",
    a: "You can't—LLM output is non-deterministic and satus has no --seed flag, on purpose: we won't promise reproducibility the model providers don't offer. For snapshot tests, seed once and capture the state with pg_dump (or a database branch snapshot), then restore that fixture between runs.",
  },
  {
    q: "Does satus need superuser access on Postgres?",
    a: "No. It needs SELECT on the catalog (pg_catalog, information_schema—both world-readable by default) and INSERT/UPDATE on the user tables you're seeding. A standard application role is enough.",
  },

  // -------- License & billing --------
  {
    q: "I bought Pro. How do I activate it on the CLI?",
    a: "Run `satus activate` and paste the license key from your purchase email. The CLI verifies the key against satus.sh once, caches the result for 24 hours, and works fully offline within that window.",
  },
  {
    q: "How do I check what tier I'm on?",
    a: "Run `satus whoami`. It prints the current license tier, the verification cache expiry, and the email the key is registered to.",
  },
  {
    q: "My team needs more than one seat.",
    a: "Team tier is on the waitlist—email support@satus.sh with how many seats you need and we'll prioritise. In the meantime, every developer can self-serve a Pro seat.",
  },
  {
    q: "Can I get a refund?",
    a: "Yes—within 14 days of purchase, no questions. Email support@satus.sh from the address on the order.",
  },
];

export const Route = createFileRoute("/docs/troubleshooting")({
  component: TroubleshootingPage,
  head: () => ({
    meta: [
      { title: "satus troubleshooting—exit codes, FK cycles, seeding errors" },
      {
        name: "description",
        content:
          "Every known satus failure mode with the fix. Install errors, schema errors (E_FK_CYCLE, E_DB_NOT_EMPTY), LLM rate limits, license activation, recovery.",
      },
      {
        property: "og:title",
        content: "satus troubleshooting—exit codes, FK cycles, seeding errors",
      },
      {
        property: "og:description",
        content:
          "Symptom-first guide to every documented satus failure. Read it before you file an issue.",
      },
      { property: "og:url", content: SITE_URL + "/docs/troubleshooting" },
      { property: "og:type", content: "article" },
      { property: "og:image", content: SITE_URL + "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: SITE_URL + "/og-image.png" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/docs/troubleshooting" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          url: SITE_URL + "/docs/troubleshooting",
          mainEntity: FAQS.map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        }),
      },
      {
        /* BreadcrumbList: Home › Docs › Troubleshooting. */
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL + "/" },
            { "@type": "ListItem", position: 2, name: "Docs", item: SITE_URL + "/docs" },
            {
              "@type": "ListItem",
              position: 3,
              name: "Troubleshooting",
              item: SITE_URL + "/docs/troubleshooting",
            },
          ],
        }),
      },
    ],
  }),
});

/* Group FAQs by section index so the IDs in SECTIONS line up with what
 * the user clicks in the LeftRail. Keep the order in sync with FAQS above. */
const GROUPS: { id: string; range: [number, number] }[] = [
  { id: "install", range: [0, 3] },
  { id: "schema", range: [3, 7] },
  { id: "llm", range: [7, 11] },
  { id: "runtime", range: [11, 15] },
  { id: "license", range: [15, 19] },
];

function TroubleshootingPage() {
  const groupFor = (id: string) => {
    const g = GROUPS.find((x) => x.id === id)!;
    return FAQS.slice(g.range[0], g.range[1]);
  };

  return (
    <PageShell sections={SECTIONS} currentPath="/docs/troubleshooting">
      <Section
        heading="h1"
        id="install"
        n="01"
        label="Install & setup"
        title={<>the binary, the path, the variables.</>}
      >
        <Prose>
          <p>
            Three things that go wrong on the first run: a stale PATH after the global install, an
            unsupported Node version, and confusion about which commands need credentials.
          </p>
        </Prose>
        <FaqList items={groupFor("install")} />
      </Section>

      <Section id="schema" n="02" label="Schema errors" title={<>the planner refused to write.</>}>
        <Prose>
          <p>
            The planner reads <code>pg_catalog</code> before any insert. When it sees something it
            can&rsquo;t resolve safely it exits with a named code and writes nothing. Every error
            below is recoverable without database surgery.
          </p>
        </Prose>
        <FaqList items={groupFor("schema")} />
      </Section>

      <Section id="llm" n="03" label="LLM provider" title={<>your key. your bill. your retries.</>}>
        <Prose>
          <p>
            satus calls your LLM provider directly from your machine. Authentication and rate-limit
            errors come straight from the provider; we map them to stable exit codes so CI can
            branch on them.
          </p>
        </Prose>
        <FaqList items={groupFor("llm")} />
      </Section>

      <Section
        id="runtime"
        n="04"
        label="Runtime & rollback"
        title={<>what happens when a run dies mid-flight.</>}
      >
        <Prose>
          <p>
            <code>satus generate</code> runs inside a single Postgres transaction. Most &ldquo;is my
            database corrupted?&rdquo; questions have the same answer: no, the transaction rolled
            back. The mechanics are covered in{" "}
            <a
              href="/docs/how-it-works#transaction"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              how it works
            </a>
            .
          </p>
        </Prose>
        <FaqList items={groupFor("runtime")} />
      </Section>

      <Section
        id="license"
        n="05"
        label="License & billing"
        title={<>activation, seats, refunds.</>}
      >
        <Prose>
          <p>
            Free runs uncapped time-wise but caps each run at 25 rows per table across 5 tables;
            license-keyed activation lifts those caps and applies to Pro and Team. The CLI verifies
            once, caches for 24 hours, and works offline within that window.
          </p>
        </Prose>
        <FaqList items={groupFor("license")} />
      </Section>

      <Section
        id="still-stuck"
        n="06"
        label="Still stuck"
        title={<>open an issue. include the schema.</>}
      >
        <Prose>
          <p>
            If nothing above matches, the fastest path to a fix is a GitHub issue with three things:
            the full stack trace (or the named exit code), the offending <code>CREATE TABLE</code>{" "}
            statement(s), and the satus version (<code>satus --version</code>). Schema reproduction
            is the single thing we triage hardest—the more faithful your repro, the faster the fix.
          </p>
          <p>
            For private questions (procurement, security disclosures, anything you don&rsquo;t want
            on a public tracker), email{" "}
            <a
              href="mailto:support@satus.sh"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              support@satus.sh
            </a>
            . Humans answer; we aim to acknowledge within two business days.
          </p>
        </Prose>
      </Section>
    </PageShell>
  );
}

/* -------------------- Local primitives -------------------- */

/* Each FAQ renders as a question + answer block separated by hairlines.
 * Plain <p> so the body can include inline <code> and <a> from the
 * Markdown-like answer text without an MDX dependency. */
function FaqList({ items }: { items: Faq[] }) {
  return (
    <ul className="mt-8 max-w-[760px] divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
      {items.map((item) => (
        <li key={item.q} className="py-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--signal)]">
            question
          </div>
          <div className="mt-1.5 max-w-[62ch] font-mono text-[14px] font-medium text-[var(--ink)]">
            {item.q}
          </div>
          <p className="mt-3 max-w-[62ch] text-[14.5px] leading-[1.6] text-[var(--ink)]/80">
            {item.a}
          </p>
        </li>
      ))}
    </ul>
  );
}
