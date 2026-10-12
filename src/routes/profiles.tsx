/**
 * Reference profiles route ("/profiles").
 *
 * The CLI ships three reference profiles today: `saas`, `ecommerce`, `b2b`.
 * Each is a short prose hint passed to the LLM system prompt (see
 * packages/cli/src/generate/profiles.ts) — not a schema template and not
 * a set of hard-enforced invariants. Profiles influence value choice
 * (names, emails, price shapes, enum vocabulary, date clustering); the
 * table set and FK graph come from the user's own schema via introspection.
 *
 * This page documents what each profile biases toward, sample values it
 * tends to produce, and how to extend the set. The content mirrors
 * packages/cli/src/generate/profiles.ts verbatim in intent — if you edit
 * one, edit the other.
 */

import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/site/chrome";
import { FURTHER_READING, FurtherReading } from "@/components/site/further-reading";
import { Prose, Section, type SectionMeta } from "@/components/site/primitives";

const SITE_URL = "https://satus.sh";

/* Per-profile spec. Kept as data so the TOC + body stay in lockstep.
 * `hints` mirrors the prompt bullets in packages/cli/src/generate/profiles.ts.
 * `sample` shows values consistent with those hints. Nothing here is
 * enforced by the runner; the LLM is asked to follow the hints and the
 * generated rows are validated against the user's Postgres constraints. */
type Profile = {
  id: string;
  n: string;
  label: string;
  name: string;
  tagline: string;
  hints: string[];
  sample: { col: string; value: string }[];
};

const PROFILES: Profile[] = [
  {
    id: "saas",
    n: "01",
    label: "SaaS",
    name: "saas",
    tagline:
      "Bias generated values toward a B2B SaaS product: workplace emails, startup-style company names, plan-tier enums, and dates clustered in the last 18 months.",
    hints: [
      'startup and company names mixing single-word brands with "X-ly" and "Get-X" patterns',
      "workplace email addresses (alice@acme.com), not gmail / hotmail / personal domains",
      "plausible SaaS job titles (Engineer, PM, Designer, Head of Ops)",
      "billing-plan and feature-flag enums when the column name suggests them (free, pro, team)",
      "dates clustered in the last 18 months; subscriptions distributed across plans",
    ],
    sample: [
      { col: "orgs.name", value: "Northbeam Analytics" },
      { col: "users.email", value: "alice@northbeam.io" },
      { col: "users.title", value: "Staff Engineer" },
      { col: "subscriptions.plan", value: "pro" },
      { col: "users.created_at", value: "2025-11-04T09:22:11Z" },
    ],
  },
  {
    id: "ecommerce",
    n: "02",
    label: "E-commerce",
    name: "ecommerce",
    tagline:
      "Bias generated values toward a consumer e-commerce store: realistic product names across apparel/home/accessories, prices with familiar retail cents, and orders skewed toward fulfilled.",
    hints: [
      "product names across apparel, home goods, and accessories",
      "prices between 9.99 and 299.99 with cents ending in .99 / .49 / .00",
      "customer names and shipping addresses drawn from US / UK / DE / FR / JP",
      "order statuses biased toward fulfilled, with a long tail of pending and refunded",
    ],
    sample: [
      { col: "products.title", value: 'Cedar Plank Cutting Board, 18"' },
      { col: "products.price", value: "$34.99" },
      { col: "customers.country", value: "DE" },
      { col: "orders.status", value: "fulfilled" },
      { col: "orders.total", value: "$84.50" },
    ],
  },
  {
    id: "b2b",
    n: "03",
    label: "B2B",
    name: "b2b",
    tagline:
      "Bias generated values toward a B2B service or marketplace: mid-market accounts, contract values, multi-seat licensing, and procurement-style metadata. Consumer language is avoided.",
    hints: [
      "mid-market company names with a named-account feel",
      "contract values in the $5,000 to $250,000 range",
      "multi-seat licensing (seat counts, per-seat unit prices)",
      "procurement metadata: PO numbers, NET-30 terms, MSA dates",
      "no consumer language (no shopping, no household products)",
    ],
    sample: [
      { col: "accounts.name", value: "Meridian Freight Systems, Inc." },
      { col: "contracts.value_usd", value: "$78,000" },
      { col: "contracts.seats", value: "45" },
      { col: "contracts.payment_terms", value: "NET-30" },
      { col: "contracts.po_number", value: "PO-2026-01849" },
    ],
  },
];

/* Sections array: one per profile + a closing BYO section. */
const SECTIONS: ReadonlyArray<SectionMeta> = [
  ...PROFILES.map((p) => ({ id: p.id, n: p.n, label: p.label })),
  { id: "byo", n: "04", label: "Bring your own" },
  { id: "further-reading", n: "05", label: "Further reading" },
];

export const Route = createFileRoute("/profiles")({
  component: ProfilesPage,
  head: () => ({
    meta: [
      { title: "satus reference profiles—domain-shaped Postgres seed data" },
      {
        name: "description",
        content:
          "Three reference profiles for satus—saas, ecommerce, b2b—each a prose hint that biases generated values toward a domain. Documented alongside the CLI source.",
      },
      {
        property: "og:title",
        content: "satus reference profiles—domain-shaped Postgres seed data",
      },
      {
        property: "og:description",
        content:
          "Three domain hints: saas, ecommerce, b2b. Documented biases + sample values, kept in sync with the CLI source.",
      },
      { property: "og:url", content: SITE_URL + "/profiles" },
      { property: "og:type", content: "article" },
      { property: "og:image", content: SITE_URL + "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: SITE_URL + "/og-image.png" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/profiles" }],
  }),
});

function ProfilesPage() {
  return (
    <PageShell sections={SECTIONS} currentPath="/profiles">
      {PROFILES.map((p, i) => (
        <Section
          // Only the first profile opens the document; the rest are siblings.
          heading={i === 0 ? "h1" : "h2"}
          key={p.id}
          id={p.id}
          n={p.n}
          label={p.label}
          title={<>--profile {p.name}</>}
        >
          <Prose>
            <p>{p.tagline}</p>
          </Prose>

          {/* Two-column spec strip: hints (left) + sample values (right).
              Stacks on mobile. */}
          <div className="mt-8 grid max-w-[860px] grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-[220px_1fr]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mute)]">
                prompt hints
              </div>
              <ul className="mt-3 space-y-2 text-[13.5px] leading-[1.55] text-[var(--ink)]/85">
                {p.hints.map((h) => (
                  <li key={h} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-[7px] inline-block h-px w-3 shrink-0 bg-[var(--signal)]"
                    />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mute)]">
                sample values
              </div>
              <div className="mt-3 overflow-x-auto border-y border-[var(--ink)]">
                <table className="w-full min-w-[420px] border-collapse font-mono text-[12.5px]">
                  <thead>
                    <tr>
                      <th className="w-[46%] py-2.5 pr-4 text-left text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--mute)]">
                        column
                      </th>
                      <th className="py-2.5 text-left text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--mute)]">
                        example
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.sample.map((s) => (
                      <tr key={s.col} className="border-t border-[var(--hairline)]">
                        <td className="py-2 pr-4 text-[var(--mute)]">{s.col}</td>
                        <td className="py-2 text-[var(--ink)]">{s.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-8 max-w-[860px]">
            <p className="text-[13px] leading-[1.6] text-[var(--mute)]">
              Profiles bias value choice; they don&rsquo;t define your schema. The table set, column
              types, and FK graph come from introspecting your own database. Rows are validated
              against your Postgres constraints before they land.
            </p>
          </div>
        </Section>
      ))}

      <Section id="byo" n="04" label="Bring your own" title={<>no profile? no problem.</>}>
        <Prose>
          <p>
            Omit <code>--profile</code> and the CLI runs with a neutral system prompt. Values still
            respect column types, nullability, unique constraints, check constraints, and foreign
            keys—you just don&rsquo;t get the domain-flavored biases. Useful for internal schemas
            that don&rsquo;t map cleanly onto SaaS, e-commerce, or B2B.
          </p>
          <p>
            More profiles (legal, real estate, logistics, healthcare) are on the roadmap and will be
            pinned by user demand. Open an issue with your <code>CREATE TABLE</code> statements and
            a short description of the domain and we&rsquo;ll triage.
          </p>
        </Prose>
      </Section>
      <FurtherReading n="05" posts={FURTHER_READING.profiles} />
    </PageShell>
  );
}
