/**
 * Recipes route ("/recipes").
 *
 * Task-oriented guides. Each recipe is a self-contained "I want to do X"
 * card: problem statement, the exact commands, and a note on caveats.
 * Recipes intentionally stay short—anything longer than a page belongs in
 * the blog. The current set covers four common asks: preview-branch
 * seeding, GitHub Actions, Cypress/E2E reset, and Neon branches.
 *
 * GEO: each recipe is emitted as a HowTo node inside an ItemList so
 * generative engines can quote a single recipe without parsing the whole page.
 */

import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageShell } from "@/components/site/chrome";
import { Prose, Section, type SectionMeta } from "@/components/site/primitives";

const SITE_URL = "https://satus.sh";

const SECTIONS: ReadonlyArray<SectionMeta> = [
  { id: "preview-branch", n: "01", label: "Preview branches" },
  { id: "github-actions", n: "02", label: "GitHub Actions" },
  { id: "e2e-reset", n: "03", label: "E2E reset" },
  { id: "neon-branch", n: "04", label: "Neon branching" },
];

export const Route = createFileRoute("/recipes")({
  component: RecipesPage,
  head: () => ({
    meta: [
      { title: "satus recipes—copy-paste Postgres seeding for CI, previews" },
      {
        name: "description",
        content:
          "Copy-paste recipes for satus: seed a preview branch, wire into GitHub Actions, reset a Cypress database between tests, seed a fresh Neon branch.",
      },
      {
        property: "og:title",
        content: "satus recipes—copy-paste Postgres seeding for CI, previews",
      },
      {
        property: "og:description",
        content: "Four short, copy-paste recipes covering the most common satus integrations.",
      },
      { property: "og:url", content: SITE_URL + "/recipes" },
      { property: "og:type", content: "article" },
      { property: "og:image", content: SITE_URL + "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: SITE_URL + "/og-image.png" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/recipes" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "satus recipes",
          itemListOrder: "https://schema.org/ItemListOrderAscending",
          itemListElement: SECTIONS.map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: SITE_URL + "/recipes#" + s.id,
            name: s.label,
          })),
        }),
      },
    ],
  }),
});

function RecipesPage() {
  return (
    <PageShell sections={SECTIONS} currentPath="/recipes">
      <Section
        heading="h1"
        id="preview-branch"
        n="01"
        label="Preview branches"
        title={<>seed every supabase preview branch.</>}
      >
        <Prose>
          <p>
            Supabase preview branches ship with an empty database. Run satus once after the branch
            is created and every PR review gets a fully seeded environment. The 10,000-row safety
            guard is harmless here: preview branches start at zero.
          </p>
        </Prose>

        <Terminal>
          <Cmt>{`# pull the postgres url from the supabase CLI`}</Cmt>
          <Shell>{`export DATABASE_URL=$(supabase --experimental branches get $BRANCH --output json | jq -r .POSTGRES_URL)`}</Shell>
          <Shell>{`export OPENAI_API_KEY=$OPENAI_API_KEY`}</Shell>
          <Blank />
          <Cmt>{`# seed it. one transaction. all-or-nothing.`}</Cmt>
          <Shell>{`satus generate --profile ecommerce --rows 50`}</Shell>
          <Out>{`✓ inserted 250 rows across 5 tables`}</Out>
        </Terminal>

        <Note>
          Each run generates fresh data—the model varies values by design. If a review depends on
          stable fixtures, keep the branch alive instead of re-seeding it, or snapshot the seeded
          state with <code>pg_dump</code>.
        </Note>
      </Section>

      <Section
        id="github-actions"
        n="02"
        label="GitHub Actions"
        title={<>one job. one step. one secret per env.</>}
      >
        <Prose>
          <p>
            The most common shape. Plan in PR jobs (no writes, free), generate on merge to{" "}
            <code>main</code> or against ephemeral DBs.
          </p>
        </Prose>

        <Terminal>
          <Cmt>{`# .github/workflows/seed.yml`}</Cmt>
          <Shell>{`name: seed`}</Shell>
          <Shell>{`on: { pull_request: {}, push: { branches: [main] } }`}</Shell>
          <Shell>{`jobs:`}</Shell>
          <Shell>{`  seed:`}</Shell>
          <Shell>{`    runs-on: ubuntu-latest`}</Shell>
          <Shell>{`    env:`}</Shell>
          <Shell>{`      DATABASE_URL: \${{ secrets.DATABASE_URL }}`}</Shell>
          <Shell>{`      OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}`}</Shell>
          <Shell>{`    steps:`}</Shell>
          <Shell>{`      - uses: actions/checkout@v4`}</Shell>
          <Shell>{`      - uses: actions/setup-node@v4`}</Shell>
          <Shell>{`        with: { node-version: 20 }`}</Shell>
          <Shell>{`      - run: npm i -g @passkeybridge/satus`}</Shell>
          <Shell>{`      - run: satus generate --profile saas --dry-run --json`}</Shell>
          <Shell>{`        if: github.event_name == 'pull_request'`}</Shell>
          <Shell>{`      - run: satus generate --profile saas`}</Shell>
          <Shell>{`        if: github.ref == 'refs/heads/main'`}</Shell>
        </Terminal>

        <Note>
          <code>satus generate --dry-run --json</code> introspects but never writes and never calls
          the model—no LLM key needed, no spend. It exits non-zero when the relational validator
          finds errors, so it works as a PR gate for schema-breaking changes.
        </Note>
      </Section>

      <Section
        id="e2e-reset"
        n="03"
        label="E2E reset"
        title={<>fresh data between every test suite.</>}
      >
        <Prose>
          <p>
            Cypress, Playwright, and Vitest E2E suites need a known-good database state. The
            pattern: seed once with <code>--truncate</code>, snapshot the result with{" "}
            <code>pg_dump</code>, and restore that fixture between suites— restores are fast and
            byte-identical, which generation is not.
          </p>
        </Prose>

        <Terminal>
          <Cmt>{`# scripts/reset-test-db.sh`}</Cmt>
          <Shell>{`#!/usr/bin/env bash`}</Shell>
          <Shell>{`set -euo pipefail`}</Shell>
          <Blank />
          <Cmt>{`# truncate the target tables and re-seed in one run`}</Cmt>
          <Shell>{`satus generate --profile ecommerce --truncate`}</Shell>
        </Terminal>

        <Note>
          <code>--truncate</code> issues <code>TRUNCATE ... RESTART IDENTITY</code> on the
          run&rsquo;s tables inside the same transaction as the inserts, so sequences reset and a
          failed run leaves the old data in place. Note the absent <code>CASCADE</code>: if a table
          outside the run set has a foreign key into one inside it, satus stops with an error rather
          than emptying a table you never asked it to seed. Bring that table into the run set or
          truncate it yourself. Wire this into Cypress&rsquo;s <code>before(...)</code> hook or
          Playwright&rsquo;s <code>globalSetup</code>.
        </Note>
      </Section>

      <Section
        id="neon-branch"
        n="04"
        label="Neon branching"
        title={<>seed a fresh neon branch in one shell.</>}
      >
        <Prose>
          <p>
            Neon's copy-on-write branches make per-developer or per-PR databases cheap. Combine that
            with satus and every engineer gets their own seeded database for the cost of the branch
            metadata.
          </p>
        </Prose>

        <Terminal>
          <Cmt>{`# create a branch and capture its connection string`}</Cmt>
          <Shell>{`BRANCH=$(neon branches create --name pr-$PR --project-id $NEON_PROJECT_ID --output json)`}</Shell>
          <Shell>{`export DATABASE_URL=$(echo "$BRANCH" | jq -r .connection_uris[0].connection_uri)`}</Shell>
          <Blank />
          <Cmt>{`# seed`}</Cmt>
          <Shell>{`satus generate --profile saas`}</Shell>
        </Terminal>

        <Note>
          Tear the branch down on PR close. Neon charges per active branch—a stale fleet of seeded
          branches will surprise the bill.
        </Note>
      </Section>

      <p className="mt-12 max-w-[62ch] font-mono text-[12.5px] text-[var(--mute)]">
        Have a recipe you want documented? Email{" "}
        <a
          href="mailto:support@satus.sh?subject=Recipe%20request"
          className="underline decoration-[var(--signal)] underline-offset-4"
        >
          support@satus.sh
        </a>
        . We add the most-requested integrations first.
      </p>
    </PageShell>
  );
}

/* -------------------- Local primitives -------------------- */

function Terminal({ children }: { children: ReactNode }) {
  return (
    <div className="mt-8 max-w-[760px] border-y border-[var(--ink)]">
      <pre tabIndex={0} className="overflow-x-auto px-1 py-6 font-mono text-[13px] leading-[1.85]">
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

/* Aside note. Sits below a terminal block, sets a slightly muted tone. */
function Note({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 max-w-[760px] border-l-2 border-[var(--signal)] bg-[var(--ink)]/[0.02] px-5 py-4">
      {/* #b91c1c is 5.92:1 on the tinted note. Signal red (#dc2626) is 4.42:1 at 10px. */}
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#b91c1c]">note</div>
      <p className="mt-2 max-w-[62ch] text-[14px] leading-[1.6] text-[var(--ink)]/85 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-[var(--ink)]">
        {children}
      </p>
    </div>
  );
}
