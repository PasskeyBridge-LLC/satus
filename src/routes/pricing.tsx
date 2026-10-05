/**
 * Pricing route ("/pricing").
 *
 * Pass B expansion: tier matrix (#tiers) + frequently asked questions (#faq).
 * The FAQ section also emits FAQPage JSON-LD so generative search engines can
 * quote answers directly—same source of truth, no duplication risk.
 */

import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/site/chrome";
import { Prose, Section, type SectionMeta } from "@/components/site/primitives";
import { WaitlistForm } from "@/components/site/WaitlistForm";

const SITE_URL = "https://satus.sh";

const SECTIONS: ReadonlyArray<SectionMeta> = [
  { id: "tiers", n: "04", label: "Tiers" },
  { id: "waitlist", n: "05", label: "Waitlist" },
  { id: "faq", n: "06", label: "FAQ" },
];

/* CTA hrefs route to the embedded checkout. The server function holds the
 * source-of-truth whitelist of priceIds; this table just hands them off. */
const TIERS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "free tier · 25 rows × 5 tables",
    cta: "install from npm",
    href: "/quickstart",
    primary: false,
    secondary: null as null | { label: string; href: string },
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19",
    cadence: "per month · or $190/yr",
    cta: "subscribe monthly",
    href: "/checkout?price=satus_pro_monthly",
    primary: true,
    secondary: { label: "or pay annually ($190)", href: "/checkout?price=satus_pro_yearly" },
  },
  {
    id: "team",
    name: "Team",
    price: "$49",
    cadence: "per seat · monthly (waitlist)",
    cta: "join the waitlist",
    href: "#waitlist",
    primary: false,
    secondary: null,
  },
];

type Cell = string | { mark: true } | null;
const FEATURES: { label: string; row: [Cell, Cell, Cell] }[] = [
  { label: "CLI core", row: [{ mark: true }, { mark: true }, { mark: true }] },
  { label: "Bring-your-own LLM key", row: [{ mark: true }, { mark: true }, { mark: true }] },
  {
    label: "Built-in profiles (saas/ecommerce/b2b)",
    row: [{ mark: true }, { mark: true }, { mark: true }],
  },
  { label: "Row & table caps lifted", row: [null, { mark: true }, { mark: true }] },
  { label: "License, 24-hour offline grace", row: [null, { mark: true }, { mark: true }] },
  { label: "Priority issue triage", row: [null, { mark: true }, { mark: true }] },
  { label: "Shared team profiles (planned)", row: [null, null, { mark: true }] },
  { label: "CI mode (planned)", row: [null, null, { mark: true }] },
  { label: "Audit log (planned)", row: [null, null, { mark: true }] },
  { label: "Invoiced billing", row: [null, null, { mark: true }] },
];

/* FAQ entries kept as data so the rendered <dl> and the JSON-LD payload
 * stay in lockstep—no risk of the schema drifting from the page. */
const FAQ: { q: string; a: string }[] = [
  {
    q: "Why bring-your-own LLM key?",
    a: "Token costs are the dominant variable in this tool. Reselling them means we mark up your usage; BYO means you pay your provider directly, see the bill on their dashboard, and we charge a flat fee for the software. It also keeps your schema out of any vendor we don't control.",
  },
  {
    q: "Which LLM providers are supported?",
    a: "OpenAI and Anthropic are supported today, and xAI from the CLI release after 0.3.11. The CLI auto-detects which key is present (OPENAI_API_KEY, ANTHROPIC_API_KEY or XAI_API_KEY) and uses structured outputs against the corresponding provider. Google Gemini is not yet supported. Email support@satus.sh if your stack needs another provider.",
  },
  {
    q: "Is there a free trial on Pro?",
    a: "No. The Free tier is the trial: the same CLI binary, capped at 25 rows per table across 5 tables, with no time limit. All three built-in profiles (saas, ecommerce, b2b) are available on every tier. Pro lifts the row and table caps and adds priority triage and a 24-hour offline license grace. If those don't earn $19 a month, you should stay on Free. The source is published for inspection under a proprietary license; commercial use is governed by the license you activate.",
  },
  {
    q: "What's the refund policy?",
    a: "Full refund within 14 days of initial purchase, no questions asked. Email support@satus.sh with your order ID. After 14 days the current period is non-refundable, but you can cancel future renewals any time and keep using the CLI until the period ends.",
  },
  {
    q: "Does it work offline?",
    a: "Pro and Team licenses cache their verdict locally for 24 hours, so the CLI keeps generating against your own LLM provider even if it can't reach our license server — enough to cover a flight or a license-server outage. Past that window with no network, activation fails closed. Free is fully offline forever.",
  },
  {
    q: "When does the Team tier launch?",
    a: "When we have ten teams on the waitlist asking for the same three features. Joining the waitlist is the vote.",
  },
];

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "satus pricing—free tier, Pro and Team for Postgres seed data" },
      {
        name: "description",
        content:
          "satus pricing: Free tier (25 rows × 5 tables), Pro at $19/mo, Team at $49/seat. Bring-your-own LLM key on every tier. We don't resell tokens.",
      },
      {
        property: "og:title",
        content: "satus pricing—free tier, Pro and Team for Postgres seed data",
      },
      {
        property: "og:description",
        content:
          "Free, Pro $19/mo, Team $49/seat. Bring-your-own LLM key on every tier. No token reselling.",
      },
      { property: "og:url", content: SITE_URL + "/pricing" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: SITE_URL + "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: SITE_URL + "/og-image.png" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/pricing" }],
    scripts: [
      {
        // GEO: FAQPage schema mirrors the visible Q&A list verbatim so AI
        // search can answer common questions about pricing without scraping
        // the marketing prose around them.
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        }),
      },
    ],
  }),
});

function PricingPage() {
  return (
    <PageShell sections={SECTIONS} currentPath="/pricing">
      <Section
        heading="h1"
        id="tiers"
        n="04"
        label="Tiers"
        title={<>honest, narrow, easy to leave.</>}
      >
        <Prose>
          <p>Bring-your-own LLM key on every tier. We don&rsquo;t resell tokens.</p>
        </Prose>

        {/* Horizontal scroll on mobile is intentional—the table is denser
         *  than any 4-column layout we could honestly stack. */}
        <p className="mt-6 font-mono text-[11px] text-[var(--mute)] md:hidden">scroll table →</p>
        <div className="mt-3 max-w-[860px] overflow-x-auto md:mt-8">
          <table className="w-full min-w-[640px] border-collapse font-mono text-[13px]">
            <thead>
              <tr className="border-y border-[var(--ink)]">
                <th className="w-[44%] py-3 text-left text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--mute)]">
                  Feature
                </th>
                {TIERS.map((t) => (
                  <th
                    key={t.id}
                    className={`py-3 text-left text-[11px] uppercase tracking-[0.18em] ${
                      t.primary
                        ? "border-l border-r border-l-[var(--signal)] border-r-[var(--hairline)] text-[var(--ink)]"
                        : "text-[var(--mute)]"
                    }`}
                  >
                    <div className="px-4">
                      <div className="text-[var(--ink)]">{t.name}</div>
                      <div className="mt-1 font-sans text-[11px] normal-case tracking-normal text-[var(--mute)]">
                        <span className="text-[var(--ink)]">{t.price}</span> · {t.cadence}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f, i) => (
                <tr key={i} className="border-b border-[var(--hairline)]">
                  <td className="py-2.5 pr-4 text-[var(--ink)]/85">{f.label}</td>
                  {f.row.map((cell, ci) => {
                    const isPrimary = TIERS[ci].primary;
                    return (
                      <td
                        key={ci}
                        className={`py-2.5 ${
                          isPrimary
                            ? "border-l border-r border-l-[var(--signal)] border-r-[var(--hairline)] px-4"
                            : "px-4"
                        }`}
                      >
                        {cell && typeof cell === "object" ? (
                          <span className="text-[var(--signal)]">●</span>
                        ) : (
                          <span className="text-[var(--hairline)]">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td />
                {TIERS.map((t) => (
                  <td
                    key={t.id}
                    className={`pb-2 pt-5 ${
                      t.primary
                        ? "border-l border-r border-l-[var(--signal)] border-r-[var(--hairline)] px-4"
                        : "px-4"
                    }`}
                  >
                    <a
                      href={t.href}
                      className={`inline-flex h-9 items-center whitespace-nowrap px-3 text-[11px] uppercase tracking-[0.16em] transition-colors ${
                        t.primary
                          ? "bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--signal)]"
                          : "border border-[var(--ink)] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--paper)]"
                      }`}
                    >
                      {t.cta}
                    </a>
                    {t.secondary && (
                      <a
                        href={t.secondary.href}
                        className="mt-2 block font-mono text-[11px] text-[var(--mute)] underline-offset-2 hover:text-[var(--signal)] hover:underline"
                      >
                        {t.secondary.label}
                      </a>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="waitlist" n="05" label="Waitlist" title={<>two fields, no marketing list.</>}>
        <Prose>
          <p>
            Pro is live, billable on the card above. Team opens when ten organizations have asked
            for it. Drop your email, pick the tier, and that&rsquo;s the entire ceremony. One email
            when your tier ships; nothing else.
          </p>
        </Prose>
        <WaitlistForm />
      </Section>

      <Section id="faq" n="06" label="FAQ" title={<>questions we get before the receipt.</>}>
        {/* Definition list maps cleanly onto the JSON-LD FAQPage above. */}
        <dl className="mt-2 max-w-[760px] divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="py-6">
              <dt className="font-mono text-[14px] font-medium text-[var(--ink)]">
                <span className="mr-3 text-[var(--signal)]">Q.</span>
                {q}
              </dt>
              <dd className="mt-3 max-w-[64ch] pl-7 text-[15px] leading-[1.65] text-[var(--ink)]/80">
                {a}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </PageShell>
  );
}
