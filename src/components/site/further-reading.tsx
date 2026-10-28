/**
 * "Further reading" from a docs page to the blog posts that go deeper on it.
 *
 * The Oct 12 2026 audit found 15 published posts unknown to Google: the blog
 * index linked them, but nothing else did, and the docs (the site's most
 * crawled pages) linked one post. Each docs page now links the posts that
 * cover its topic. Static on purpose: plain <a> crawl paths in the SSR HTML,
 * no blog module in the docs bundle. `further-reading.test.ts` fails if a
 * slug here is not a published post, so an unpublish cannot leave a dead link.
 */
import { Link } from "@tanstack/react-router";
import { Section } from "@/components/site/primitives";

export interface ReadingLink {
  slug: string;
  title: string;
}

export const FURTHER_READING = {
  docs: [
    { slug: "null-vs-not-null-is-not-the-question", title: "NULL vs NOT NULL is not the question" },
    { slug: "check-constraints-that-lie", title: "Check constraints that lie" },
    { slug: "enum-types-that-grew-up", title: "Enum types that grew up" },
    { slug: "the-citext-trap", title: "The CITEXT trap in Postgres unique indexes" },
    {
      slug: "jsonb-that-is-secretly-relational",
      title: "JSONB columns that are secretly relational",
    },
    {
      slug: "arrays-vs-junction-tables",
      title: "Arrays vs junction tables: when Postgres arrays are a smell",
    },
    { slug: "introducing-the-log", title: "Introducing the satus log" },
  ],
  // Posts no page outside /blog linked to on 2026-10-12 (checked against the
  // sitemap and the live HTML of every other page). Listed on /docs so each
  // has a crawl path from the docs as well as from the blog index.
  docsArchive: [
    { slug: "pg-dump-snapshots-as-test-fixtures", title: "pg_dump snapshots as test fixtures" },
    {
      slug: "fixtures-vs-generation-when-each-wins",
      title: "Fixtures vs generation, and when each wins",
    },
    {
      slug: "what-pg-dump-doesnt-tell-you",
      title: "What pg_dump doesn't tell you about your own schema",
    },
    { slug: "the-schema-i-couldnt-reproduce", title: "The schema I couldn't reproduce" },
    { slug: "triggers-i-have-loved-and-hated", title: "Triggers I have loved and hated" },
    { slug: "when-uuids-arent-the-answer", title: "When UUIDs aren't the answer" },
    {
      slug: "seeding-into-a-multi-tenant-schema",
      title: "Seeding into a multi-tenant schema without leaking tenants",
    },
    {
      slug: "seeding-stripe-shaped-data-without-stripe",
      title: "Seeding Stripe-shaped data without Stripe",
    },
    {
      slug: "the-cycle-breaking-heuristic-we-never-shipped",
      title: "The cycle-breaking heuristic we documented and never shipped",
    },
    {
      slug: "the-1am-deploy-that-only-failed-in-prod",
      title: "The 1am deploy that only failed in prod",
    },
    {
      slug: "structured-output-from-claude-without-a-json-parser",
      title: "Structured output from Claude without a JSON parser",
    },
    {
      slug: "cost-estimates-are-guardrails-not-accounting",
      title: "How the dry-run cost estimate is calculated",
    },
    { slug: "free-tier-priced-honestly", title: "Free tier, priced honestly" },
    { slug: "agent-mode-postponed", title: "Agent mode, postponed to v0.5" },
    { slug: "v0-3-11-release-notes", title: "v0.3.11: two claims the code did not support" },
    { slug: "v0-3-10-release-notes", title: "v0.3.10: the 24-hour license grace is now real" },
    { slug: "v0-3-9-release-notes", title: "v0.3.9: the safety feature you couldn't turn off" },
    {
      slug: "v0-3-8-release-notes",
      title: "v0.3.8: the safety guard we had already written about",
    },
    { slug: "v0-3-7-release-notes", title: "v0.3.7: five bugs, four of them silent" },
    {
      slug: "v0-3-6-release-notes",
      title: "v0.3.6: one fix, for a footgun we stepped on ourselves",
    },
    {
      slug: "v0-3-5-release-notes",
      title: "v0.3.5: automated npm publishing, two correctness fixes",
    },
  ],
  howItWorks: [
    { slug: "cyclic-fks-in-the-wild", title: "Cyclic foreign keys in the wild" },
    {
      slug: "v0-2-0-deferred-constraints-faster-planning-smaller-binary",
      title: "v0.2.0: deferred constraints, faster planning, and a smaller binary",
    },
    { slug: "partitioned-tables-meet-rls", title: "Partitioned tables meet RLS, and nobody wins" },
    {
      slug: "generated-columns-are-load-bearing-now",
      title: "Generated columns are load-bearing now",
    },
    { slug: "when-faker-is-the-wrong-answer", title: "When faker.js is exactly the wrong answer" },
    {
      slug: "timezone-bugs-found-by-seed-data",
      title: "Three timezone bugs we found by seeding production-shaped data",
    },
  ],
  githubAction: [
    {
      slug: "v0-3-3-github-action",
      title: "Roadmap: v0.3.3 ships the GitHub Action, and v0.5 becomes v0.4",
    },
    {
      slug: "v0-3-3-release-notes",
      title: "v0.3.3: the GitHub Action, and opt-in failure fingerprints",
    },
    {
      slug: "dry-run-validation",
      title: "A $0 dry-run that catches FK and constraint bugs before the LLM call",
    },
    {
      slug: "v0-3-0-anthropic-and-machine-readable-output",
      title: "v0.3.0: Anthropic as a first-class provider, and machine-readable output",
    },
  ],
  troubleshooting: [
    { slug: "check-constraints-that-lie", title: "Check constraints that lie" },
    { slug: "the-citext-trap", title: "The CITEXT trap in Postgres unique indexes" },
    {
      slug: "postgres-extensions-that-trip-up-seeders",
      title: "Postgres extensions that trip up seeders",
    },
    {
      slug: "information-schema-is-privilege-filtered",
      title: "information_schema is privilege-filtered, and it made our CI gate lie",
    },
    { slug: "partitioned-tables-meet-rls", title: "Partitioned tables meet RLS, and nobody wins" },
    {
      slug: "timezone-bugs-found-by-seed-data",
      title: "Three timezone bugs we found by seeding production-shaped data",
    },
  ],
  profiles: [
    {
      slug: "medical-booking-profile",
      title: "Inside the medical-booking profile: why appointments are harder than they seem",
    },
    {
      slug: "ecommerce-profile",
      title: "Inside the e-commerce profile: SKUs, carts, and the long tail of returns",
    },
    {
      slug: "saas-subscriptions-profile",
      title: "Inside the saas-subscriptions profile: MRR, churn, and the dunning death spiral",
    },
    {
      slug: "picking-distributions-not-values",
      title: "Profile design 101: pick distributions, not values",
    },
    { slug: "what-a-bad-profile-looks-like", title: "What a bad profile looks like" },
  ],
  cli: [
    {
      slug: "v0-3-0-anthropic-and-machine-readable-output",
      title: "v0.3.0: Anthropic as a first-class provider, and machine-readable output",
    },
    {
      slug: "dry-run-validation",
      title: "A $0 dry-run that catches FK and constraint bugs before the LLM call",
    },
    { slug: "introducing-the-log", title: "Introducing the satus log" },
  ],
} as const satisfies Record<string, readonly ReadingLink[]>;

export function FurtherReading({
  n,
  posts,
  id = "further-reading",
  label = "Further reading",
  title = "from the blog.",
}: {
  n: string;
  posts: readonly ReadingLink[];
  id?: string;
  label?: string;
  title?: string;
}) {
  if (posts.length === 0) return null;
  return (
    <Section id={id} n={n} label={label} title={<>{title}</>}>
      <ul>
        {posts.map((p) => (
          <li key={p.slug}>
            <Link to="/blog/$slug" params={{ slug: p.slug }}>
              {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
