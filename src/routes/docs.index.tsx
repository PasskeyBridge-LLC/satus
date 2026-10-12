/**
 * Docs hub route ("/docs").
 *
 * Lightweight index page that orients new users—explains what the docs
 * surface looks like, then links out to the existing destination pages
 * (quickstart, CLI reference, profiles, blog) instead of duplicating their
 * content. Keeps a single source of truth per topic.
 */

import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageShell } from "@/components/site/chrome";
import { FURTHER_READING, FurtherReading } from "@/components/site/further-reading";
import { Prose, Section, type SectionMeta } from "@/components/site/primitives";

const SITE_URL = "https://satus.sh";

const SECTIONS: ReadonlyArray<SectionMeta> = [
  { id: "start-here", n: "01", label: "Start here" },
  { id: "reference", n: "02", label: "Reference" },
  { id: "concepts", n: "03", label: "Concepts" },
  { id: "support", n: "04", label: "Support" },
  { id: "further-reading", n: "05", label: "Further reading" },
];

export const Route = createFileRoute("/docs/")({
  component: DocsPage,
  head: () => ({
    meta: [
      { title: "satus docs—schema-aware seed data for Postgres, from one CLI" },
      {
        name: "description",
        content:
          "Documentation hub for satus: quickstart, CLI reference, profile catalogue, and conceptual guides for the seeding CLI that respects every foreign key.",
      },
      {
        property: "og:title",
        content: "satus docs—schema-aware seed data for Postgres, from one CLI",
      },
      {
        property: "og:description",
        content: "Quickstart, CLI reference, profile catalogue, concepts. Everything in one place.",
      },
      { property: "og:url", content: SITE_URL + "/docs" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: SITE_URL + "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: SITE_URL + "/og-image.png" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/docs" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "satus documentation",
          url: SITE_URL + "/docs",
          inLanguage: "en",
          publisher: {
            "@type": "Organization",
            name: "PasskeyBridge LLC",
            url: "https://passkeybridge.io",
          },
          hasPart: [
            { "@type": "WebPage", name: "Quickstart", url: SITE_URL + "/quickstart" },
            { "@type": "TechArticle", name: "CLI reference", url: SITE_URL + "/cli" },
            { "@type": "WebPage", name: "Profiles", url: SITE_URL + "/profiles" },
            { "@type": "Blog", name: "Engineering blog", url: SITE_URL + "/blog" },
          ],
        }),
      },
    ],
  }),
});

function DocsPage() {
  return (
    <PageShell sections={SECTIONS} currentPath="/docs">
      <Section
        heading="h1"
        id="start-here"
        n="01"
        label="Start here"
        title={<>read these two pages in order.</>}
      >
        <Prose>
          <p>
            satus is a CLI. It introspects your Postgres schema, reasons about foreign keys, and
            writes seed data that respects every relationship. If you've never run it, walk through
            these two pages—about ten minutes end-to-end—before anything else.
          </p>
        </Prose>

        <CardGrid>
          <Card
            to="/quickstart"
            kicker="tutorial"
            title="Quickstart"
            body="Install, point at any Postgres, pick a profile, preview, ship. The fastest path from zero to a seeded database."
          />
          <Card
            to="/profiles"
            kicker="catalogue"
            title="Profiles"
            body="The three bundled domains—saas, ecommerce, b2b—with the tone and distribution hints each one gives the model."
          />
        </CardGrid>
      </Section>

      <Section id="reference" n="02" label="Reference" title={<>every flag, every exit code.</>}>
        <Prose>
          <p>
            One page per surface. The reference is exhaustive and stable across the 0.1.x
            line—bookmark it.
          </p>
        </Prose>

        <CardGrid>
          <Card
            to="/cli"
            kicker="reference"
            title="CLI reference"
            body="Synopsis, environment variables, every subcommand (init, plan, generate), every flag, every exit code."
          />
          <Card
            to="/recipes"
            kicker="how-to"
            title="Recipes"
            body="Copy-paste guides for the most common integrations: preview branches, GitHub Actions, E2E resets, Neon branching."
          />
          <Card
            to="/compare"
            kicker="positioning"
            title="vs Snaplet, Tonic, faker"
            body="Honest, category-by-category comparison against the alternatives developers most often weigh."
          />
          <Card
            to="/pricing"
            kicker="commercial"
            title="Pricing &amp; tiers"
            body="Free runs the same CLI binary, capped at 25 rows × 5 tables. Pro lifts the caps and adds priority triage. Team is a waitlist. All three profiles ship on every tier. No token resale."
          />
        </CardGrid>
      </Section>

      <Section id="concepts" n="03" label="Concepts" title={<>why it works the way it does.</>}>
        <Prose>
          <p>
            Long-form posts that explain the design decisions—the FK-cycle planner, the safety
            guard, the one-transaction guarantee. Read these when you want to understand the{" "}
            <em>why</em>, not just the <em>how</em>.
          </p>
        </Prose>

        <CardGrid>
          <Card
            to="/docs/how-it-works"
            kicker="concept"
            title="How it works"
            body="The three guarantees satus makes—FK-cycle planning, the 10,000-row safety guard, and the single-transaction write—explained end to end."
          />
          <Card
            to="/blog/cyclic-fks-in-the-wild"
            kicker="essay"
            title="Cyclic FKs in the wild"
            body="Why a third of production Postgres schemas have foreign-key cycles, and how satus breaks them without giving up referential integrity."
          />
        </CardGrid>
      </Section>

      <Section id="support" n="04" label="Support" title={<>one inbox. one repo.</>}>
        <Prose>
          <p>
            Hit an error code? Start with{" "}
            <a
              href="/docs/troubleshooting"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              troubleshooting
            </a>
            —every exit code, every common failure mode, with the fix.
          </p>
          <p>
            File bugs and feature requests against the public repo. For private questions—invoices,
            procurement, security—write to{" "}
            <a
              href="mailto:support@satus.sh"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              support@satus.sh
            </a>
            . Humans answer. We aim to acknowledge within two business days.
          </p>
          <p>
            Reporting a vulnerability? See our{" "}
            <a href="/security" className="underline decoration-[var(--signal)] underline-offset-4">
              security policy
            </a>{" "}
            for scope, the embargo timeline, and safe harbor.
          </p>
        </Prose>
      </Section>
      <FurtherReading n="05" posts={FURTHER_READING.docs} />
    </PageShell>
  );
}

/* -------------------- Local primitives -------------------- */

function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="mt-8 grid max-w-[760px] grid-cols-1 gap-px bg-[var(--hairline)] sm:grid-cols-2">
      {children}
    </div>
  );
}

function Card({
  to,
  kicker,
  title,
  body,
}: {
  to: string;
  kicker: string;
  title: ReactNode;
  body: string;
}) {
  return (
    <a
      href={to}
      className="group block bg-[var(--paper)] p-6 transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)]"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--signal)]">
        {kicker}
      </div>
      <div className="mt-3 font-mono text-[16px] font-medium text-[var(--ink)] group-hover:text-[var(--paper)]">
        {title}
      </div>
      <p className="mt-2 text-[14px] leading-[1.55] text-[var(--ink)]/75 group-hover:text-[var(--paper)]/80">
        {body}
      </p>
      <div className="mt-4 font-mono text-[11px] text-[var(--mute)] group-hover:text-[var(--paper)]/60">
        {to} ↗
      </div>
    </a>
  );
}
