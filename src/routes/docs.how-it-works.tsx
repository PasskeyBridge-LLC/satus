/**
 * /docs/how-it-works—concept page.
 *
 * Long-form explanation of the three guarantees satus makes. Each section
 * mirrors a claim already on /quickstart and /cli; this page is the
 * canonical "why," not a duplicate reference. Facts here MUST stay in sync
 * with quickstart.tsx + cli.tsx (env vars, exit codes, flag names, row
 * threshold). If you change behaviour in one place, change it here too.
 */

import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageShell } from "@/components/site/chrome";
import { Prose, Section, type SectionMeta } from "@/components/site/primitives";

const SITE_URL = "https://satus.sh";

const SECTIONS: ReadonlyArray<SectionMeta> = [
  { id: "overview", n: "01", label: "Overview" },
  { id: "fk-planner", n: "02", label: "FK-cycle planner" },
  { id: "safety-guard", n: "03", label: "Safety guard" },
  { id: "transaction", n: "04", label: "One transaction" },
  { id: "boundaries", n: "05", label: "What it isn't" },
];

export const Route = createFileRoute("/docs/how-it-works")({
  component: HowItWorksPage,
  head: () => ({
    meta: [
      { title: "How satus works—FK planner, row guard, one transaction" },
      {
        name: "description",
        content:
          "The three guarantees satus makes: the FK-cycle planner, the 10,000-row safety guard, and the single-transaction write that is all-or-nothing.",
      },
      { property: "og:title", content: "How satus works—FK planner, row guard, one transaction" },
      {
        property: "og:description",
        content:
          "FK-cycle planning, the 10,000-row safety guard, and the one-transaction write—explained end to end.",
      },
      { property: "og:url", content: SITE_URL + "/docs/how-it-works" },
      { property: "og:type", content: "article" },
      { property: "og:image", content: SITE_URL + "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: SITE_URL + "/og-image.png" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/docs/how-it-works" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: "How satus works",
          description:
            "Concept guide to the three guarantees satus makes when seeding a Postgres database.",
          url: SITE_URL + "/docs/how-it-works",
          inLanguage: "en",
          author: { "@type": "Organization", name: "satus.sh" },
          publisher: {
            "@type": "Organization",
            name: "PasskeyBridge LLC",
            url: "https://passkeybridge.io",
          },
          dateModified: "2026-05-27",
          proficiencyLevel: "Intermediate",
          about: [
            { "@type": "Thing", name: "PostgreSQL foreign keys" },
            { "@type": "Thing", name: "Database seeding" },
            { "@type": "Thing", name: "ACID transactions" },
          ],
        }),
      },
      {
        /* BreadcrumbList: Home › Docs › How it works. Gives Google the
         * route ancestry explicitly so the SERP can render the trail. */
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
              name: "How it works",
              item: SITE_URL + "/docs/how-it-works",
            },
          ],
        }),
      },
    ],
  }),
});

function HowItWorksPage() {
  return (
    <PageShell sections={SECTIONS} currentPath="/docs/how-it-works">
      <Section
        heading="h1"
        id="overview"
        n="01"
        label="Overview"
        title={<>three guarantees. one binary.</>}
      >
        <Prose>
          <p>
            Every <code>satus generate</code> run makes three promises to your database. They
            aren&rsquo;t marketing copy—they map directly to three pieces of code in the CLI, and
            each one has a named exit code you can branch on in CI.
          </p>
          <ol className="ml-5 list-decimal space-y-2">
            <li>
              <strong>The FK-cycle planner</strong> reorders inserts so every foreign key points at
              a row that already exists, even when your schema has cycles.
            </li>
            <li>
              <strong>The safety guard</strong> refuses to touch a database that already holds real
              user data, unless you explicitly opt out.
            </li>
            <li>
              <strong>The one-transaction guarantee</strong> means a failed run leaves your database
              byte-for-byte identical to how it started.
            </li>
          </ol>
          <p>
            The rest of this page explains each one—what it does, why it exists, and where it stops.
          </p>
        </Prose>
      </Section>

      <Section
        id="fk-planner"
        n="02"
        label="FK-cycle planner"
        title={<>cycles are normal. inserts still need an order.</>}
      >
        <Prose>
          <p>
            Postgres lets you declare foreign keys in any topology, including cycles—
            <code>users.primary_org_id → organizations.id</code> and{" "}
            <code>organizations.owner_id → users.id</code> is the textbook example, but the pattern
            shows up anywhere a graph has bidirectional ownership (folders ↔ root_file, accounts ↔
            default_card, threads ↔ latest_message). It compiles, it ships to production, and it
            quietly defeats every seed script that assumes a topological sort will work.
          </p>
          <p>The planner runs in three phases:</p>
          <ol className="ml-5 list-decimal space-y-2">
            <li>
              <strong>Introspect.</strong> Read <code>pg_catalog</code> to extract every table,
              column, FK, NOT NULL constraint, and DEFERRABLE status. No assumptions, no parsing of{" "}
              <code>CREATE TABLE</code> text—the source of truth is the live schema.
            </li>
            <li>
              <strong>Build the DAG, find the cycles.</strong> Treat tables as nodes and FKs as
              edges. Kahn&rsquo;s algorithm resolves 100% of acyclic schemas. When it terminates
              with nodes still unresolved, those nodes are exactly the tables caught in a cycle.
            </li>
            <li>
              <strong>Break each cycle on the weakest edge.</strong> Inside a cycle, pick the FK
              whose column is nullable (or has a DEFAULT, or is declared DEFERRABLE INITIALLY
              DEFERRED). Insert that side first with the FK column left empty, insert the other side
              normally, then run a second pass that <code>UPDATE</code>s the empty column with the
              correct id. Referential integrity holds at every commit point.
            </li>
          </ol>
          <p>
            When no edge in a cycle is breakable—every column on the cycle is NOT NULL with no
            DEFAULT and not DEFERRABLE—satus refuses to guess. It exits with code <code>10</code> (
            <code>E_FK_CYCLE</code>) and tells you which constraint to relax. We&rsquo;d rather fail
            loudly than ship a workaround that violates an invariant you spent time declaring.
          </p>
          <p>
            <a
              href="/blog/cyclic-fks-in-the-wild"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              Cyclic FKs in the wild
            </a>{" "}
            walks through a real-world example with the SQL the planner emits.
          </p>
        </Prose>
      </Section>

      <Section
        id="safety-guard"
        n="03"
        label="Safety guard"
        title={<>ten thousand rows. then we stop and ask.</>}
      >
        <Prose>
          <p>
            Before any write, satus counts user-table rows—every table outside{" "}
            <code>pg_catalog</code>, <code>information_schema</code>, and <code>pg_toast</code>—and
            refuses to run if the total exceeds <strong>10,000</strong>. The intent is narrow: catch
            the case where
            <code> DATABASE_URL</code> was set to production by accident.
          </p>
          <p>
            10,000 is deliberately conservative. A fresh development database sits at zero. A Docker
            container with the day&rsquo;s migration applied sits in the low hundreds. A test
            database that someone already seeded is in the low thousands. Anything above five digits
            is almost always a database you didn&rsquo;t mean to point at.
          </p>
          <p>
            The guard is bypassable. Pass <code>--force</code> when you know what you&rsquo;re
            doing—appending to a staging database that already has real fixtures, for example. The
            exit code on a guard trip is <code>11</code> (<code>E_DB_NOT_EMPTY</code>) so CI can
            distinguish &ldquo;refused to run&rdquo; from &ldquo;tried and failed.&rdquo;
          </p>
          <p>
            Two things the guard is not: it isn&rsquo;t a permission check (Postgres roles do that
            better), and it isn&rsquo;t a rollback mechanism (the transaction guarantee below does
            that). It is one confirmation prompt, expressed as an exit code, between you and a
            mistake that costs a Slack apology.
          </p>
        </Prose>
      </Section>

      <Section
        id="transaction"
        n="04"
        label="One transaction"
        title={<>all the rows. or none of them.</>}
      >
        <Prose>
          <p>
            <code>satus generate</code> opens a single Postgres transaction, issues every{" "}
            <code>INSERT</code> and the FK back-patch <code>UPDATE</code>s inside it, and commits
            exactly once at the end. If anything fails—an LLM timeout, an unforeseen check
            constraint, a network blip, <code>Ctrl-C</code>—the transaction rolls back and your
            database is left in the state it was in before the run started.
          </p>
          <p>
            This is plain Postgres ACID; we don&rsquo;t implement a custom rollback. The value we
            add is that the run <em>fits</em> in one transaction. The planner pre-computes the
            entire insert order, the LLM calls happen ahead of writes so token failures abort before
            anything hits the database, and the back-patch pass is small enough to stay inside the
            transaction without inflating WAL.
          </p>
          <p>Two practical consequences:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>You don&rsquo;t need cleanup scripts. A failed run is a no-op.</li>
            <li>
              You can run <code>satus generate</code> in a tight CI loop against the same database
              without worrying about half-seeded state from a previous run.
            </li>
          </ul>
          <p>
            The trade-off: very large seed runs hold a long-lived transaction. For datasets above
            ~50,000 rows we recommend running <code>--dry-run</code> first—not because the
            transaction will fail, but so you see the insert order, the per-table row counts, and
            the cost estimate before you commit to them. Note that <code>--dry-run</code> does not
            emit a SQL transcript; it reports the plan and runs the relational validator against
            simulated rows.
          </p>
        </Prose>
      </Section>

      <Section
        id="boundaries"
        n="05"
        label="What it isn't"
        title={<>three things satus does not do.</>}
      >
        <Prose>
          <p>Knowing the edges of a tool is part of trusting it.</p>
          <ul className="ml-5 list-disc space-y-2">
            <li>
              <strong>satus does not migrate your schema.</strong> It reads the schema you already
              have. Use <code>prisma migrate</code>, <code>sqitch</code>, <code>flyway</code>, or
              whatever your team standardised on—then point satus at the result.
            </li>
            <li>
              <strong>satus does not anonymise production data.</strong> It generates new rows from
              scratch, profile-shaped and referentially correct. If you need to mask real PII,
              that&rsquo;s a different category of tool (Snaplet&rsquo;s subset feature, or a
              homegrown <code>pg_dump</code> + sed pipeline).
            </li>
            <li>
              <strong>satus does not resell LLM tokens.</strong> You bring your own provider key —{" "}
              <code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code> or{" "}
              <code>XAI_API_KEY</code> (xAI, from the CLI release after 0.3.11). The request goes
              directly from your machine to the provider you selected (auto-detected from env, or
              pinned with <code>--provider</code>). Cost shows up on <em>your</em> dashboard, never
              ours. Internally, every provider is a thin adapter behind a single{" "}
              <code>Provider</code> interface ({" "}
              <code>generate&lt;T&gt;(req): Promise&lt;&#123; data, usage &#125;&gt;</code>), so the
              runner stays provider-agnostic and adding a third provider is a single new file.
            </li>
          </ul>
          <p className="mt-8 max-w-[62ch] font-mono text-[12.5px] text-[var(--mute)]">
            Concept guide for satus 0.3.x. If anything here drifts from the{" "}
            <a href="/cli" className="underline decoration-[var(--signal)] underline-offset-4">
              CLI reference
            </a>
            , the CLI reference wins—file an issue.
          </p>
        </Prose>
      </Section>
    </PageShell>
  );
}
