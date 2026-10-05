/**
 * /terms—Terms of Service for satus.sh.
 *
 * Adapted from the PasskeyBridge LLC master terms to the narrower satus.sh
 * surface: a CLI that generates Postgres seed data, a marketing site, a
 * Stripe-backed license-verification API, and a license-delivery email.
 * Single contact mailbox (support@satus.sh) for v1; dpo@ stays under the
 * parent company until satus.sh scales enough to warrant a dedicated DPO
 * channel.
 *
 * Kept as plain prose with §-numbered sections to match the rest of the
 * site's technical-spec aesthetic. No JSON-LD—Google does not index legal
 * pages as rich results and the markup overhead is wasted.
 */

import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageShell } from "@/components/site/chrome";
import { Prose, Section, type SectionMeta } from "@/components/site/primitives";

const SITE_URL = "https://satus.sh";
const EFFECTIVE_DATE = "May 26, 2026";

const SECTIONS: ReadonlyArray<SectionMeta> = [
  { id: "acceptance", n: "01", label: "Acceptance" },
  { id: "service", n: "02", label: "Service" },
  { id: "license", n: "03", label: "License" },
  { id: "byo-key", n: "04", label: "BYO key" },
  { id: "billing", n: "05", label: "Billing" },
  { id: "acceptable-use", n: "06", label: "Acceptable use" },
  { id: "warranty", n: "07", label: "Warranty" },
  { id: "liability", n: "08", label: "Liability" },
  { id: "indemnification", n: "09", label: "Indemnification" },
  { id: "termination", n: "10", label: "Termination" },
  { id: "law", n: "11", label: "Governing law" },
  { id: "changes", n: "12", label: "Changes" },
  { id: "contact", n: "13", label: "Contact" },
];

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "satus terms of service—the Postgres seed-data CLI and site" },
      {
        name: "description",
        content:
          "Terms of Service for the satus.sh CLI and marketing site, operated by PasskeyBridge LLC. Effective May 26, 2026.",
      },
      {
        property: "og:title",
        content: "satus terms of service—the Postgres seed-data CLI and site",
      },
      {
        property: "og:description",
        content:
          "Terms governing use of the satus.sh CLI, license API, and marketing site. Operated by PasskeyBridge LLC.",
      },
      { property: "og:url", content: SITE_URL + "/terms" },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/terms" }],
  }),
});

function TermsPage() {
  return (
    <PageShell sections={SECTIONS} currentPath="/terms">
      <header className="mb-10">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--mute)]">
          <span className="text-[var(--signal)]">§00</span>
          <span className="mx-3 text-[var(--hairline)]">|</span>
          <span>Legal · ToS</span>
        </div>
        <h1 className="mt-5 font-mono text-[32px] font-medium leading-[1.15] tracking-tight text-[var(--ink)] md:text-[40px]">
          terms of service.
        </h1>
        <p className="mt-4 font-mono text-[12px] text-[var(--mute)]">Effective: {EFFECTIVE_DATE}</p>
      </header>

      <Section
        id="acceptance"
        n="01"
        label="Acceptance"
        title={<>by using satus, you accept these terms.</>}
      >
        <Prose>
          <p>
            By installing the satus CLI, purchasing a license, or accessing the satus.sh website
            (collectively, the &ldquo;Service&rdquo;), you agree to be bound by these Terms of
            Service. The Service is provided by <strong>PasskeyBridge LLC</strong>, a Wyoming
            limited liability company (&ldquo;PasskeyBridge,&rdquo; &ldquo;we,&rdquo; or
            &ldquo;us&rdquo;). If you do not agree to these terms, do not install or use the
            Service.
          </p>
        </Prose>
      </Section>

      <Section id="service" n="02" label="Service" title={<>what satus is, and what it is not.</>}>
        <Prose>
          <p>
            satus is a command-line tool that reads the schema of a Postgres database and produces
            realistic, relationally-coherent seed data. It runs entirely on your own infrastructure,
            against databases you control. The Service consists of:
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li>The satus CLI binary, distributed via npm.</li>
            <li>The satus.sh marketing site, blog, and documentation.</li>
            <li>
              A license-verification API at <code>/api/public/license/verify</code>.
            </li>
            <li>A transactional email that delivers your license key after purchase.</li>
          </ul>
          <p>
            satus is <em>not</em> a hosted database, a managed AI service, an analytics platform, or
            a data-processing pipeline. We do not see, store, or transmit the rows the CLI generates
            on your machine.
          </p>
        </Prose>
      </Section>

      <Section
        id="license"
        n="03"
        label="License"
        title={<>one seat, one human, non-transferable.</>}
      >
        <Prose>
          <p>
            Subject to payment of the applicable fees, PasskeyBridge grants you a limited,
            non-exclusive, non-transferable, revocable license to install and use the satus CLI on
            machines under your control. Each license key is bound to a single named seat. You may
            not share your license key, resell it, embed it in a public repository, or use it to
            provide the satus functionality as a hosted service to third parties.
          </p>
          <p>
            All title and intellectual property rights in the Service remain with PasskeyBridge LLC.
            Nothing in these terms transfers ownership of the source code, the trademarks{" "}
            <em>satus</em>, <em>satus.sh</em>, or the satus wordmark.
          </p>
        </Prose>
      </Section>

      <Section id="byo-key" n="04" label="BYO key" title={<>you supply your own llm api key.</>}>
        <Prose>
          <p>
            satus requires an API key from a supported LLM provider (OpenAI or Anthropic; xAI from
            the CLI release after 0.3.11) to generate column-level values. You are responsible for:
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li>Procuring and paying for your own provider account.</li>
            <li>The token usage, costs, and rate limits incurred by your runs.</li>
            <li>Complying with the provider&rsquo;s terms of service.</li>
            <li>
              Treating the API key as a secret. satus reads the key from the environment and never
              transmits it to PasskeyBridge.
            </li>
          </ul>
          <p>
            We are not a sub-processor for your LLM provider. Prompts and completions flow directly
            from your machine to the provider; we never see them.
          </p>
          <p>
            The in-browser demo at satus.sh/demo is the exception: it runs on our API key, and the
            column names, types and enum labels you enter are sent to xAI to generate rows.
          </p>
        </Prose>
      </Section>

      <Section
        id="billing"
        n="05"
        label="Billing"
        title={<>monthly or annual. stripe processed. refundable for 14 days.</>}
      >
        <Prose>
          <p>
            Licenses are sold as monthly or annual subscriptions through Stripe. Prices are listed
            at{" "}
            <a href="/pricing" className="underline decoration-[var(--signal)] underline-offset-4">
              satus.sh/pricing
            </a>{" "}
            and are charged in U.S. dollars. Subscriptions renew automatically at the end of each
            billing period unless cancelled at least 24 hours in advance.
          </p>
          <p>
            <strong>Refunds.</strong> We offer a full refund within 14 days of initial purchase, no
            questions asked. After 14 days the current billing period is non-refundable, except
            where required by applicable consumer-protection law; you may cancel future renewals at
            any time and continue using the CLI until the period ends. To request a refund or cancel
            a renewal, email{" "}
            <a
              href="mailto:support@satus.sh"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              support@satus.sh
            </a>{" "}
            with your order ID.
          </p>
          <p>
            <strong>Taxes.</strong> Prices are exclusive of applicable sales tax, VAT, or GST.
            Stripe collects taxes at checkout where required.
          </p>
        </Prose>
      </Section>

      <Section
        id="acceptable-use"
        n="06"
        label="Acceptable use"
        title={<>don&rsquo;t do illegal things with seeded data.</>}
      >
        <Prose>
          <p>You agree not to use the Service to:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>Generate data that impersonates a real, identifiable person without consent.</li>
            <li>Produce content that is unlawful, defamatory, infringing, or harmful.</li>
            <li>
              Reverse-engineer, decompile, or remove the license-verification logic from the CLI.
            </li>
            <li>
              Run satus against a production database with more than 10,000 user rows without the
              <code> --force</code> flag and an explicit understanding of what that flag does.
            </li>
            <li>
              Probe, scan, or attempt to compromise the satus.sh infrastructure, license API, or any
              account other than your own.
            </li>
          </ul>
          <p>
            We may suspend or terminate licenses used in violation of this section without refund.
          </p>
        </Prose>
      </Section>

      <Section id="warranty" n="07" label="Warranty" title={<>provided &ldquo;as is.&rdquo;</>}>
        <Prose>
          <p>
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT
            WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
            WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.
            PASSKEYBRIDGE DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR
            FREE OF HARMFUL COMPONENTS. YOU ASSUME ALL RISK FOR USE OF THE SERVICE AGAINST YOUR OWN
            DATABASES.
          </p>
          <p>
            <strong>Backups are your responsibility.</strong> Always run satus against a development
            or preview database first. Use <code>--dry-run</code> to review the insert plan, the
            per-table row counts, and the cost estimate before any write. Since v0.3.8 satus also
            refuses to run against a database already holding more than 10,000 rows unless you pass{" "}
            <code>--force</code>, but that guard is a backstop, not a substitute for pointing{" "}
            <code>DATABASE_URL</code> at the right database.
          </p>
        </Prose>
      </Section>

      <Section
        id="liability"
        n="08"
        label="Liability"
        title={<>capped at fees paid in the prior twelve months.</>}
      >
        <Prose>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, PASSKEYBRIDGE LLC SHALL NOT BE LIABLE FOR ANY
            INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT
            LIMITATION LOSS OF DATA, LOST PROFITS, OR BUSINESS INTERRUPTION, ARISING OUT OF OR
            RELATED TO YOUR USE OF THE SERVICE. OUR TOTAL CUMULATIVE LIABILITY FOR ALL CLAIMS SHALL
            NOT EXCEED THE AMOUNT YOU PAID FOR THE SERVICE IN THE TWELVE (12) MONTHS PRECEDING THE
            EVENT GIVING RISE TO THE CLAIM.
          </p>
        </Prose>
      </Section>

      <Section
        id="indemnification"
        n="09"
        label="Indemnification"
        title={<>you indemnify us for misuse.</>}
      >
        <Prose>
          <p>
            You agree to indemnify, defend, and hold harmless PasskeyBridge LLC, its officers, and
            its contractors from any claims, damages, or expenses (including reasonable
            attorneys&rsquo; fees) arising from your use of the Service, your violation of these
            terms, or your violation of any law or third-party right.
          </p>
        </Prose>
      </Section>

      <Section id="termination" n="10" label="Termination" title={<>either side may walk away.</>}>
        <Prose>
          <p>
            You may terminate your license at any time by emailing{" "}
            <a
              href="mailto:support@satus.sh"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              support@satus.sh
            </a>{" "}
            with your order ID, or self-serve through the Stripe billing portal linked from your
            license-delivery email. PasskeyBridge may terminate or suspend your license immediately
            for material breach of these terms, fraudulent payment, or use that poses a security
            risk to other users.
          </p>
          <p>
            On termination, your license key stops verifying and the CLI will refuse to run.
            Sections governing license ownership, warranty disclaimers, liability caps, and
            indemnification survive termination.
          </p>
        </Prose>
      </Section>

      <Section
        id="law"
        n="11"
        label="Governing law"
        title={<>wyoming. arbitration. unless consumer law says otherwise.</>}
      >
        <Prose>
          <p>
            These Terms are governed by the laws of the State of Wyoming, United States, without
            regard to its conflict-of-law principles. Disputes arising out of or relating to these
            Terms shall be resolved through binding arbitration administered by the American
            Arbitration Association, except where prohibited by applicable consumer-protection law
            (including, but not limited to, the GDPR or PIPEDA).
          </p>
        </Prose>
      </Section>

      <Section
        id="changes"
        n="12"
        label="Changes"
        title={<>we&rsquo;ll tell you before material changes take effect.</>}
      >
        <Prose>
          <p>
            We may revise these Terms from time to time. Material changes will be announced via the
            email address associated with your license at least 30 days before they take effect.
            Continued use of the Service after the effective date constitutes acceptance of the
            revised Terms.
          </p>
        </Prose>
      </Section>

      <Section id="contact" n="13" label="Contact" title={<>where to reach a human.</>}>
        <Prose>
          <p>
            <strong>PasskeyBridge LLC</strong>
            <br />
            5830 E 2nd St., Ste 7000 #33652
            <br />
            Casper, WY 82609
            <br />
            United States
          </p>
          <p>
            Email:{" "}
            <a
              href="mailto:support@satus.sh"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              support@satus.sh
            </a>
            <br />
            Web:{" "}
            <a
              href="https://satus.sh"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              satus.sh
            </a>
          </p>
        </Prose>
      </Section>
    </PageShell>
  );
}

// Silence unused-import lint when Prose isn't pulled in from a sub-component.
type _PreserveImports = ReactNode;
