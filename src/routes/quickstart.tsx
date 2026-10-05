/**
 * Quickstart route ("/quickstart").
 *
 * Pass B expansion: split the README into anchorable sections that map 1:1 to
 * the HowTo JSON-LD steps—#install, #configure, #preview, #ship—plus a
 * #troubleshooting section for the failure modes users will hit on day one.
 */

import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageShell } from "@/components/site/chrome";
import { Prose, Section, type SectionMeta } from "@/components/site/primitives";
import { SATUS_VERSION } from "@/lib/version";

const SITE_URL = "https://satus.sh";

const SECTIONS: ReadonlyArray<SectionMeta> = [
  { id: "install", n: "01", label: "Install" },
  { id: "configure", n: "02", label: "Configure" },
  { id: "preview", n: "03", label: "Preview" },
  { id: "ship", n: "04", label: "Ship" },
  { id: "troubleshooting", n: "05", label: "Troubleshooting" },
];

export const Route = createFileRoute("/quickstart")({
  component: QuickstartPage,
  head: () => ({
    meta: [
      { title: "satus quickstart—install the CLI, seed a Postgres database" },
      {
        name: "description",
        content:
          "Zero to a seeded Postgres database in under a minute. Install satus, point at Supabase / Neon / Railway / RDS / local, pick a profile, ship.",
      },
      {
        property: "og:title",
        content: "satus quickstart—install the CLI, seed a Postgres database",
      },
      {
        property: "og:description",
        content:
          "Install, point at any Postgres, pick a profile, ship. Zero to seeded database in under a minute.",
      },
      { property: "og:url", content: SITE_URL + "/quickstart" },
      { property: "og:type", content: "article" },
      { property: "og:image", content: SITE_URL + "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: SITE_URL + "/og-image.png" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/quickstart" }],
    scripts: [
      {
        // GEO: HowTo schema so generative search engines can quote the steps
        // verbatim. The `url` field on each step deep-links to the page anchor
        // so an AI answer can cite the exact section.
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: "Seed a Postgres database with satus",
          totalTime: "PT1M",
          step: [
            {
              "@type": "HowToStep",
              name: "Install",
              text: "Install the satus CLI globally via npm.",
              url: SITE_URL + "/quickstart#install",
            },
            {
              "@type": "HowToStep",
              name: "Configure",
              text: "Set DATABASE_URL and run satus init to scaffold satus.config.json.",
              url: SITE_URL + "/quickstart#configure",
            },
            {
              "@type": "HowToStep",
              name: "Preview",
              text: "Dry-run to validate the plan offline before anything touches your database.",
              url: SITE_URL + "/quickstart#preview",
            },
            {
              "@type": "HowToStep",
              name: "Ship",
              text: "Run satus generate to write rows in a single transaction.",
              url: SITE_URL + "/quickstart#ship",
            },
          ],
        }),
      },
      {
        /* BreadcrumbList: Home › Quickstart. Helps Google render the
         * trail in the SERP and gives AI crawlers explicit ancestry. */
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL + "/" },
            {
              "@type": "ListItem",
              position: 2,
              name: "Quickstart",
              item: SITE_URL + "/quickstart",
            },
          ],
        }),
      },
    ],
  }),
});

function QuickstartPage() {
  return (
    <PageShell sections={SECTIONS} currentPath="/quickstart">
      <Section
        heading="h1"
        id="install"
        n="01"
        label="Install"
        title={<>one global binary. node 20+.</>}
      >
        <Prose>
          <p>
            satus ships as a single Node binary. We test on Node 20 and 22 across macOS and Linux.
            Windows is supported via WSL2.
          </p>
        </Prose>
        <Terminal>
          <Cmt>{`# install globally`}</Cmt>
          <Shell>{`npm i -g @passkeybridge/satus`}</Shell>
          <Blank />
          <Cmt>{`# verify`}</Cmt>
          <Shell>{`satus --version`}</Shell>
          <Out>{SATUS_VERSION}</Out>
        </Terminal>
      </Section>

      <Section
        id="configure"
        n="02"
        label="Configure"
        title={<>point at any postgres. pick a profile.</>}
      >
        <Prose>
          <p>
            Supabase, Neon, Railway, RDS, or a local instance—satus reads <code>DATABASE_URL</code>{" "}
            and your LLM provider key from the environment. The free tier caps runs at 25 rows per
            table across 5 tables; a Pro or Team key (<code>satus activate</code>) removes the caps.
          </p>
          <p>
            Pick one provider: export <code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code> or{" "}
            <code>XAI_API_KEY</code> (xAI, from the CLI release after 0.3.11). If more than one is
            set, pass <code>--provider openai|anthropic|xai</code> on <code>satus generate</code>
            —auto-detect deliberately refuses to guess so a misplaced key never spends on the wrong
            invoice.
          </p>
        </Prose>
        <Terminal>
          <Cmt>{`# 1 · database & llm provider (openai shown; swap for ANTHROPIC_API_KEY for Claude)`}</Cmt>
          <Shell>{`export DATABASE_URL="postgres://user:pass@localhost:5432/app"`}</Shell>
          <Shell>{`export OPENAI_API_KEY="sk-..."`}</Shell>
          <Blank />
          <Cmt>{`# 2 · scaffold satus.config.json (interactive: schema, profile, provider, model)`}</Cmt>
          <Shell>{`satus init`}</Shell>
          <Out>{`✓ wrote satus.config.json`}</Out>
        </Terminal>
      </Section>

      <Section
        id="preview"
        n="03"
        label="Preview"
        title={<>see the sql before it hits your database.</>}
      >
        <Prose>
          <p>
            <code>--dry-run</code> runs the full pipeline offline—introspect, FK-sort, simulate,
            validate—without calling the model or writing a row. It prints a per-table cost
            estimate, then runs the relational validator against simulated output and exits non-zero
            on findings, so it works as a CI gate. Add <code>--json</code> for a machine-readable
            report.
          </p>
        </Prose>
        <Terminal>
          <Cmt>{`# plan + validate offline; no spend, no writes`}</Cmt>
          <Shell>{`satus generate --profile ecommerce --dry-run`}</Shell>
          <Out>{`  estimated cost: $0.0094`}</Out>
          <Out>{`  ✓ no validation findings across 5 tables`}</Out>
        </Terminal>
      </Section>

      <Section id="ship" n="04" label="Ship" title={<>one transaction. all-or-nothing.</>}>
        <Prose>
          <p>
            <code>satus generate</code> runs inside a single Postgres transaction. If any insert
            fails, the entire run rolls back—your database is never left in a half-seeded state.
          </p>
        </Prose>
        <Terminal>
          <Shell>{`satus generate --profile ecommerce --rows 25`}</Shell>
          <Out>{`✓ inserted 125 rows across 5 tables`}</Out>
        </Terminal>
      </Section>

      <Section
        id="troubleshooting"
        n="05"
        label="Troubleshooting"
        title={<>the three failures you&rsquo;ll hit on day one.</>}
      >
        <Prose>
          <p>
            Most issues fall into three buckets. If you hit something we haven&rsquo;t listed, open
            an issue with the stack trace and the offending <code>CREATE TABLE</code>{" "}
            statement—schema reproduction is the #1 thing we triage.
          </p>
        </Prose>

        <ul className="mt-8 max-w-[760px] divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          <Issue
            code="E_FK_CYCLE"
            title="Foreign-key cycle could not be broken automatically"
            body="satus detects cycles in your FK graph at planning time and breaks them automatically by deferring a nullable column and back-patching in pass 2 (see the cyclic FKs post). This error fires when every column on the cycle is NOT NULL with no DEFAULT, so there's nowhere to put a placeholder. Mark one side nullable, add a DEFAULT, or declare the constraint DEFERRABLE."
          />
          <Issue
            code="E_NO_PARENT_ROWS"
            title="No parent rows available for a NOT NULL foreign key"
            body="A child table's NOT NULL FK points at a table that isn't in the run set—usually because it lives in another schema or is listed under `exclude` in satus.config.json. Bring the parent into the run, make the column nullable, or seed the parent yourself first."
          />
          <Issue
            code="E_LLM_RATE_LIMIT"
            title="LLM provider rate-limited the run"
            body="The run aborts and the transaction rolls back, so your database is untouched—re-run once the limit clears. Lower --batch-size (default 25) to shrink each request, or upgrade your provider tier. We never resell tokens—the bill is on your provider's dashboard."
          />
        </ul>

        <p className="mt-10 max-w-[62ch] font-mono text-[12.5px] text-[var(--mute)]">
          satus.sh—built for engineers who hate seeing John Doe in their demo data.
        </p>
      </Section>
    </PageShell>
  );
}

/* -------------------- Terminal & line primitives --------------------
 * Local to this route. Three line "kinds"—comment, shell input,
 * success output—share padding and the surrounding hairline frame. */

function Terminal({ children }: { children: ReactNode }) {
  return (
    <div className="mt-8 max-w-[760px] border-y border-[var(--ink)]">
      <pre className="overflow-x-auto px-1 py-6 font-mono text-[13px] leading-[1.85]">
        {children}
      </pre>
    </div>
  );
}

function Cmt({ children }: { children: ReactNode }) {
  return <div className="px-4 text-[var(--mute)]">{children}</div>;
}
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 text-[var(--ink)]">
      <span className="text-[var(--mute)]">$ </span>
      {children}
    </div>
  );
}
function Out({ children }: { children: ReactNode }) {
  return <div className="px-4 text-[var(--signal)]">{children}</div>;
}
function Blank() {
  return <div className="h-3" />;
}

/* Troubleshooting list item. Three-column on desktop (code · title · body),
 * stacked on mobile. */
function Issue({ code, title, body }: { code: string; title: string; body: string }) {
  return (
    <li className="grid grid-cols-1 gap-x-8 gap-y-2 py-6 md:grid-cols-[180px_1fr]">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--signal)]">
          error
        </div>
        <div className="mt-1.5 font-mono text-[12.5px] text-[var(--ink)]">{code}</div>
      </div>
      <div>
        <div className="font-mono text-[14px] font-medium text-[var(--ink)]">{title}</div>
        <p className="mt-2 max-w-[62ch] text-[14.5px] leading-[1.6] text-[var(--ink)]/80">{body}</p>
      </div>
    </li>
  );
}
