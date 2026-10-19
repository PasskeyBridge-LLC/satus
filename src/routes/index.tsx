/**
 * Home / overview route ("/").
 *
 * Pass 3A brings the home page to depth-parity with the expanded sub-routes:
 *   §00 Overview          hero + install + run transcript
 *   §01 Problem statement faker vs satus diff table
 *   §02 How it works      five-step pipeline
 *   §03 Guarantees        the four promises the CLI makes at run time
 *   §04 Anti-features     what satus deliberately will not do
 *   §05 Sample output     one row across three tables from the medical profile
 *   §06 Continue reading  links into the sub-routes
 *
 * Prose convention: em dashes are rare and unspaced (word—word).
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { track } from "@vercel/analytics";
import { useState } from "react";
import { PageShell } from "@/components/site/chrome";
import { Mono, Prose, Section, type SectionMeta } from "@/components/site/primitives";

const SITE_URL = "https://satus.sh";

const SECTIONS: ReadonlyArray<SectionMeta> = [
  { id: "overview", n: "00", label: "Overview" },
  { id: "problem", n: "01", label: "Problem statement" },
  { id: "how", n: "02", label: "How it works" },
  { id: "guarantees", n: "03", label: "Guarantees" },
  { id: "anti-features", n: "04", label: "Anti-features" },
  { id: "sample-output", n: "05", label: "Sample output" },
  { id: "next", n: "06", label: "Continue reading" },
];

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    meta: [
      { title: "satus: Postgres seed data CLI that keeps foreign keys valid" },
      {
        name: "description",
        content:
          "satus is a CLI that reads your Postgres schema and writes realistic seed data in one transaction. Foreign key values come from the parent rows it inserted.",
      },
      {
        property: "og:title",
        content: "satus: Postgres seed data CLI that keeps foreign keys valid",
      },
      {
        property: "og:description",
        content:
          "satus is a CLI that reads your Postgres schema and writes realistic seed data in one transaction. Foreign key values come from the parent rows it inserted.",
      },
      { property: "og:url", content: SITE_URL + "/" },
      { property: "og:type", content: "website" },
      // 1200×630 Swiss-Red spec-sheet OG card. Per project rule (and TanStack
      // meta-dedupe behavior), og:image lives ONLY on leaf routes so the root
      // never overrides a per-page image. Same image is reused across leaves
      // for now since the visual identity is page-agnostic.
      { property: "og:image", content: SITE_URL + "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: SITE_URL + "/og-image.png" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "satus",
          applicationCategory: "DeveloperApplication",
          operatingSystem: "macOS, Linux",
          description: "CLI that generates relationally-coherent seed data for Postgres databases.",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          url: SITE_URL,
        }),
      },
    ],
  }),
});

function HomePage() {
  return (
    <PageShell sections={SECTIONS} currentPath="/">
      <Overview />
      <Problem />
      <How />
      <Guarantees />
      <AntiFeatures />
      <SampleOutput />
      <Next />
    </PageShell>
  );
}

/* ------------------ §00 Overview ------------------ */

function Overview() {
  return (
    <Section
      heading="h1"
      id="overview"
      n="00"
      label="RFC · SATUS-001"
      title={<>seed data that looks like a real business, not a faker dump.</>}
    >
      <Prose>
        <p>
          <Mono>satus</Mono> reads your live Postgres schema and writes rows that respect every
          foreign key, constraint, and business rule you didn&rsquo;t write down. Built for the
          demo, the screenshot, and the QA run, not for load testing.
        </p>
      </Prose>

      <div className="mt-8 max-w-[520px]">
        <InstallLine />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Link to="/demo" className="link-underline font-mono text-[13px] text-[var(--signal)]">
          try it in your browser →
        </Link>
        <Link to="/quickstart" className="link-underline font-mono text-[13px]">
          read the quickstart →
        </Link>
        <Link
          to="/docs"
          className="link-underline font-mono text-[13px] text-[var(--mute)] hover:text-[var(--ink)]"
        >
          read the docs →
        </Link>
      </div>

      <div className="mt-10 max-w-[640px] border-t border-[var(--hairline)] pt-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mute)]">
          example output · satus generate --profile saas
        </div>
        {/* Illustrative run against a hypothetical SaaS schema. Real output
            varies with the user's schema; the shape (introspect → plan →
            generate per-table → insert in a transaction) is what the CLI
            actually does. See packages/cli/src/generate/runner.ts. */}
        <pre className="mt-3 overflow-x-auto font-mono text-[12.5px] leading-[1.75] text-[var(--ink)]">
          {`$ satus generate --profile saas
  introspecting schema           14 tables · 38 FKs
  planning insert order          topological
  generating · orgs                 12 rows
  generating · users               120 rows
  generating · subscriptions        48 rows
  generating · invoices            420 rows
  inserting (transaction)        ok
`}
          <span className="text-[var(--signal)]">✓</span> <span>600 rows · $0.02 · 6.1s</span>
        </pre>
      </div>
    </Section>
  );
}

function InstallLine() {
  const [copied, setCopied] = useState(false);
  const cmd = "npm i -g @passkeybridge/satus";
  return (
    <div className="relative flex items-stretch overflow-hidden border border-[var(--ink)] bg-[var(--paper)]">
      <div className="grid w-9 place-items-center border-r border-[var(--ink)] font-mono text-[12px] text-[var(--mute)]">
        $
      </div>
      <code className="flex flex-1 items-center px-3 py-2.5 font-mono text-[13.5px] text-[var(--ink)]">
        <span>{cmd}</span>
        <span
          aria-hidden="true"
          className="satus-caret ml-1.5 inline-block h-[14px] w-[7px] bg-[var(--signal)] align-middle"
        />
      </code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(cmd);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
          track("install_copy");
        }}
        className="border-l border-[var(--ink)] px-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mute)] transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)]"
        aria-label="Copy install command"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

/* ------------------ §01 Problem ------------------ */

const COMPARE: [string, string][] = [
  ["random strings per column", "rows that reference real parents"],
  ["ignores foreign keys", "topological insert from pg_catalog"],
  ["John Doe, Acme, Lorem Ipsum", "Maren Holloway, Northwind, Burlington VT"],
  ["constraints fail at runtime", "zod validation before any INSERT"],
  ["one shape per table", "tone & distribution from a profile"],
];

function Problem() {
  return (
    <Section
      id="problem"
      n="01"
      label="Problem statement"
      title={<>faker writes strings. your customers read businesses.</>}
    >
      <Prose>
        <p>
          Seed data is the silent embarrassment of every product demo. Patients with negative ages.
          Orders that don&rsquo;t sum to their line items. &ldquo;John Doe, Lorem Ipsum Corp.&rdquo;
          in the screenshot the founder is about to post.
        </p>
        <p>
          The fix isn&rsquo;t a better random-name library. The fix is data that knows your schema
          is a <em>system</em>: a subscription marked <code>canceled</code> needs a{" "}
          <code>canceled_at</code> after its <code>created_at</code>, a clinic in Vermont
          doesn&rsquo;t employ 4,000 cardiologists, an order&rsquo;s <code>total</code> equals the
          sum of its rows.
        </p>
      </Prose>

      <div className="mt-10 max-w-[720px] overflow-hidden border border-[var(--hairline)] font-mono text-[12.5px]">
        <div className="grid grid-cols-2 border-b border-[var(--hairline)] bg-[var(--ink)] text-[var(--paper)]">
          <div className="border-r border-[var(--paper)]/20 px-4 py-2.5 text-[10px] uppercase tracking-[0.22em]">
            faker / factory_bot
          </div>
          <div className="px-4 py-2.5 text-[10px] uppercase tracking-[0.22em]">satus</div>
        </div>
        {COMPARE.map(([a, b], i) => (
          <div
            key={i}
            className={`grid grid-cols-2 ${i !== COMPARE.length - 1 ? "border-b border-[var(--hairline)]" : ""}`}
          >
            <div className="border-r border-[var(--hairline)] px-4 py-3 text-[var(--mute)]">
              <span className="mr-1">−</span>
              {a}
            </div>
            <div className="px-4 py-3 text-[var(--ink)]">
              <span className="mr-1 text-[var(--signal)]">+</span>
              {b}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------ §02 How it works ------------------ */

const STEPS = [
  {
    n: "01",
    t: "introspect",
    d: "Read tables, columns, types, foreign keys, unique constraints, checks, and enums directly from pg_catalog. No annotations. No ORM plugins.",
  },
  {
    n: "02",
    t: "plan",
    d: "Build a dependency DAG from your foreign keys and topologically sort the insert order. Parents before children, always.",
  },
  {
    n: "03",
    t: "generate",
    d: "Per table, send schema, parent-row samples, and the active profile to the LLM. Receive rows as structured JSON via tool-calling, never free-text.",
  },
  {
    n: "04",
    t: "validate",
    d: "A zod schema generated from the table catches type, length, enum, unique, and invariant violations before they ever reach the database.",
  },
  {
    n: "05",
    t: "insert",
    d: "Wrap the entire run in a single Postgres transaction. Parameterized inserts in topological order. Any failure rolls back the whole run; your database is never left half-seeded.",
  },
];

function How() {
  return (
    <Section
      id="how"
      n="02"
      label="How it works"
      title={<>five quiet steps. no magic. no daemons.</>}
    >
      <Prose>
        <p>
          The CLI runs on your machine and talks to your database. There is no hosted runtime, no
          telemetry of your row data, and no surprise infrastructure.
        </p>
      </Prose>

      <ol className="mt-8 max-w-[760px]">
        {STEPS.map((s, i) => (
          <li
            key={s.n}
            className={`grid grid-cols-[40px_140px_1fr] items-baseline gap-x-6 py-4 ${
              i !== STEPS.length - 1 ? "border-b border-[var(--hairline)]" : ""
            }`}
          >
            <span className="font-mono text-[12px] text-[var(--mute)]">{s.n}</span>
            <span className="font-mono text-[14px] font-medium tracking-tight text-[var(--ink)]">
              {s.t}
            </span>
            <span className="text-[15px] leading-[1.6] text-[var(--ink)]/85">{s.d}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ------------------ §03 Guarantees ------------------ */

/**
 * Four invariants the CLI enforces at run time. Phrased as RFC-style MUST
 * clauses so each line reads like a contract, not a marketing promise.
 */
const GUARANTEES = [
  {
    k: "G-01",
    h: "Foreign-key integrity",
    d: "Every generated row references parent keys that exist in the same run. Cycles are detected up front and either broken with nullable back-patching or fail loudly with E_FK_CYCLE.",
  },
  {
    k: "G-02",
    h: "Atomic insertion",
    d: "All inserts for a single generate run execute inside one Postgres transaction. A failure on row 4,811 of 4,812 rolls back the entire run; your database is never left half-seeded.",
  },
  {
    k: "G-03",
    h: "Cost ceiling",
    d: "The CLI prints an estimated token cost during the planning phase and refuses to proceed past --max-cost (default $1.00) without explicit confirmation. No silent overruns on your provider bill.",
  },
  {
    k: "G-04",
    h: "Row-data locality",
    d: "Your row values are sent only to the LLM provider you configure with your own API key. We have no hosted runtime, no proxy, and no telemetry that includes generated content.",
  },
];

function Guarantees() {
  return (
    <Section
      id="guarantees"
      n="03"
      label="Guarantees"
      title={<>four contracts the cli enforces at run time.</>}
    >
      <Prose>
        <p>
          Marketing copy is cheap. These are the four invariants the binary itself refuses to
          violate. If any is broken in a release, it is a P0 bug.
        </p>
      </Prose>

      <ul className="mt-8 max-w-[860px] divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
        {GUARANTEES.map((g) => (
          <li key={g.k} className="grid grid-cols-1 gap-x-8 gap-y-2 py-6 md:grid-cols-[180px_1fr]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--signal)]">
                guarantee
              </div>
              <div className="mt-1.5 font-mono text-[12.5px] text-[var(--ink)]">{g.k}</div>
            </div>
            <div>
              <div className="font-mono text-[14px] font-medium text-[var(--ink)]">{g.h}</div>
              <p className="mt-2 max-w-[62ch] text-[14.5px] leading-[1.6] text-[var(--ink)]/80">
                {g.d}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------ §04 Anti-features ------------------ */

/**
 * The "what we will not build" list. Stating non-goals up front filters out
 * the wrong customer before they file an issue, and signals taste to the
 * right one. Each row pairs a non-goal with the better tool for that job.
 */
const ANTI = [
  {
    not: "Production data anonymization",
    instead: "Use pgAnonymizer or Tonic.ai. We generate fresh data; we don't redact yours.",
  },
  {
    not: "Load-testing volume (10M+ rows)",
    instead: "Use pgbench or a faker pipeline. LLM calls cost too much at that scale.",
  },
  {
    not: "A graphical schema editor",
    instead: "Your migrations are the source of truth. We read pg_catalog, we don't replace it.",
  },
  {
    not: "ML model training datasets",
    instead: "Use real, licensed data. Synthetic rows are a demo aid, not a training corpus.",
  },
  {
    not: "Cross-database support (MySQL, Mongo)",
    instead: "Postgres-only on purpose. We use pg_catalog features that don't translate.",
  },
];

function AntiFeatures() {
  return (
    <Section
      id="anti-features"
      n="04"
      label="Anti-features"
      title={<>what satus deliberately will not do.</>}
    >
      <Prose>
        <p>
          Every line item below is a feature request we&rsquo;ve already decided to decline. Stating
          them up front saves you an issue and us a wontfix.
        </p>
      </Prose>

      <div className="mt-8 max-w-[860px] overflow-x-auto border-y border-[var(--ink)]">
        <table className="w-full min-w-[640px] border-collapse font-mono text-[13px]">
          <thead>
            <tr className="border-b border-[var(--hairline)]">
              <th className="w-[44%] py-3 pr-6 text-left text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--mute)]">
                not for
              </th>
              <th className="py-3 text-left text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--mute)]">
                use instead
              </th>
            </tr>
          </thead>
          <tbody>
            {ANTI.map((a) => (
              <tr key={a.not} className="border-b border-[var(--hairline)] last:border-b-0">
                <td className="py-3 pr-6 align-top text-[var(--ink)]">
                  <span className="mr-1 text-[var(--signal)]">✕</span>
                  {a.not}
                </td>
                <td className="py-3 align-top font-sans text-[14px] leading-[1.55] text-[var(--ink)]/80">
                  {a.instead}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* ------------------ §05 Sample output ------------------ */

/**
 * Three real-shape preview rows from the `saas` profile. Pairs the §00
 * CLI transcript (which shows the *count* of generated rows) with the
 * actual *content* of those rows, so a visitor can judge realism without
 * cloning the repo. Values are illustrative; the shipped profile is a
 * prompt hint (see packages/cli/src/generate/profiles.ts) and actual
 * output varies with the user's own schema.
 */
const SAMPLE_ROWS: { table: string; cols: { k: string; v: string }[] }[] = [
  {
    table: "orgs",
    cols: [
      { k: "id", v: "8e2c0a13-…" },
      { k: "name", v: "Northbeam Analytics" },
      { k: "plan", v: "pro" },
      { k: "created_at", v: "2025-11-04 09:22 UTC" },
      { k: "seat_count", v: "12" },
    ],
  },
  {
    table: "users",
    cols: [
      { k: "id", v: "1f9d2b77-…" },
      { k: "org_id", v: "→ orgs.id (Northbeam Analytics)" },
      { k: "email", v: "alice@northbeam.io" },
      { k: "title", v: "Staff Engineer" },
      { k: "role", v: "admin" },
    ],
  },
  {
    table: "subscriptions",
    cols: [
      { k: "id", v: "a4c11e8f-…" },
      { k: "org_id", v: "→ orgs.id (Northbeam Analytics)" },
      { k: "plan", v: "pro" },
      { k: "status", v: "active" },
      { k: "current_period_end", v: "2026-08-04 09:22 UTC" },
    ],
  },
];

function SampleOutput() {
  return (
    <Section
      id="sample-output"
      n="05"
      label="Sample output"
      title={<>three rows, three tables, one consistent story.</>}
    >
      <Prose>
        <p>
          Below: one org, its subscription, and a user with a workplace email inside the same org.
          FK values line up. Enum-shaped columns (plan, role, status) pick from plausible
          vocabularies. Timestamps cluster in the last 18 months, not uniformly across all time.
        </p>
      </Prose>

      <div className="mt-8 grid max-w-[960px] grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-3">
        {SAMPLE_ROWS.map((row) => (
          <article
            key={row.table}
            className="border-t-2 border-[var(--ink)] pt-3 font-mono text-[12px]"
          >
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--mute)]">table</div>
            <div className="mt-1 text-[13px] font-medium text-[var(--ink)]">{row.table}</div>
            <dl className="mt-4 space-y-2">
              {row.cols.map((c) => (
                <div key={c.k}>
                  <dt className="text-[var(--mute)]">{c.k}</dt>
                  <dd className="mt-0.5 break-words text-[var(--ink)]">{c.v}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>

      {/* Inline proof-stage CTA. Visitors who read the sample rows have
       *  signaled interest in realism—point them at the rest of the profiles. */}
      <Link to="/profiles" className="link-underline mt-10 inline-flex font-mono text-[13px]">
        see all three reference profiles →
      </Link>
    </Section>
  );
}

/* ------------------ §06 Continue reading ------------------ */

const NEXT_LINKS: { to: "/profiles" | "/pricing" | "/quickstart"; label: string; desc: string }[] =
  [
    {
      to: "/profiles",
      label: "Reference profiles",
      desc: "Three prompt hints: saas, ecommerce, b2b.",
    },
    {
      to: "/pricing",
      label: "Pricing",
      desc: "Free, Pro, Team. Bring-your-own LLM key on every tier.",
    },
    {
      to: "/quickstart",
      label: "Quickstart",
      desc: "Zero to a seeded database in under a minute.",
    },
  ];

function Next() {
  return (
    <>
      <Section
        id="next"
        n="06"
        label="Continue reading"
        title={<>the rest of the specification.</>}
      >
        <div className="max-w-[760px] border-t border-[var(--hairline)]">
          {NEXT_LINKS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="group grid grid-cols-[200px_1fr] gap-x-8 border-b border-[var(--hairline)] py-5 transition-colors hover:bg-[var(--ink)]/[0.02]"
            >
              <span className="font-mono text-[14px] font-medium text-[var(--ink)]">
                {item.label}
                <span className="ml-2 text-[var(--signal)] transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </span>
              <span className="text-[15px] leading-[1.6] text-[var(--ink)]/85">{item.desc}</span>
            </Link>
          ))}
        </div>
      </Section>

      <ClosingBand />
    </>
  );
}

/* ------------------ Pre-footer closing band ------------------ */

/**
 * Last-chance CTA strip. Lives outside any numbered Section so it reads as
 * page chrome rather than a numbered clause. Two-column on desktop (value
 * prop left, action right), stacked on mobile. Hairline borders only; one
 * --signal accent on the primary arrow to match the rest of the page.
 */
function ClosingBand() {
  return (
    <aside aria-label="Get started" className="mt-20 border-y-2 border-[var(--ink)] py-8">
      <div className="grid grid-cols-1 items-baseline gap-x-10 gap-y-5 md:grid-cols-[1fr_auto]">
        <p className="max-w-[52ch] font-sans text-[16px] leading-[1.55] text-[var(--ink)]">
          The free tier seeds up to 25 rows per table across 5 tables&mdash;125 rows per
          run&mdash;against any Postgres database. No account, no credit card, no hosted runtime.
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[13px] md:justify-end">
          <Link to="/quickstart" className="link-underline text-[var(--ink)]">
            start with the free tier <span className="text-[var(--signal)]">→</span>
          </Link>
          <Link to="/pricing" className="link-underline text-[var(--mute)] hover:text-[var(--ink)]">
            see pricing →
          </Link>
        </div>
      </div>
    </aside>
  );
}
