/**
 * /docs/github-action — reference for PasskeyBridge-LLC/satus/packages/action@main.
 *
 * Documents the composite GitHub Action that wraps `satus generate` in a
 * PR-preview workflow. Facts here MUST stay in sync with:
 *   - packages/action/action.yml (inputs, outputs, defaults)
 *   - packages/action/README.md (Marketplace listing copy)
 *   - src/lib/version.ts SATUS_VERSION (default satus-version input)
 * If any of those change, update the tables below.
 */

import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageShell } from "@/components/site/chrome";
import { Prose, Section, type SectionMeta } from "@/components/site/primitives";
import { SATUS_VERSION } from "@/lib/version";

const SITE_URL = "https://satus.sh";

const SECTIONS: ReadonlyArray<SectionMeta> = [
  { id: "overview", n: "01", label: "Overview" },
  { id: "usage", n: "02", label: "Usage" },
  { id: "inputs", n: "03", label: "Inputs" },
  { id: "outputs", n: "04", label: "Outputs" },
  { id: "security", n: "05", label: "Security" },
  { id: "boundaries", n: "06", label: "What it isn't" },
];

export const Route = createFileRoute("/docs/github-action")({
  component: GitHubActionPage,
  head: () => ({
    meta: [
      { title: "satus GitHub Action—seed a preview Postgres database in CI" },
      {
        name: "description",
        content:
          "PasskeyBridge-LLC/satus/packages/action@main: a composite GitHub Action that runs `satus generate` against your PR-preview Postgres database. Inputs, outputs, security notes.",
      },
      {
        property: "og:title",
        content: "satus GitHub Action—seed a preview Postgres database in CI",
      },
      {
        property: "og:description",
        content:
          "Run satus against your PR-preview Postgres from GitHub Actions. Composite action, no Docker, BYO provider key.",
      },
      { property: "og:url", content: SITE_URL + "/docs/github-action" },
      { property: "og:type", content: "article" },
      { property: "og:image", content: SITE_URL + "/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:image", content: SITE_URL + "/og-image.png" },
    ],
    links: [{ rel: "canonical", href: SITE_URL + "/docs/github-action" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: "satus GitHub Action reference",
          description:
            "Reference for the PasskeyBridge-LLC/satus/packages/action@main composite GitHub Action.",
          url: SITE_URL + "/docs/github-action",
          inLanguage: "en",
          author: { "@type": "Organization", name: "satus.sh" },
          publisher: {
            "@type": "Organization",
            name: "PasskeyBridge LLC",
            url: "https://passkeybridge.io",
          },
          dateModified: "2026-07-15",
          proficiencyLevel: "Intermediate",
          about: [
            { "@type": "Thing", name: "GitHub Actions" },
            { "@type": "Thing", name: "PostgreSQL seeding" },
            { "@type": "Thing", name: "PR preview environments" },
          ],
        }),
      },
      {
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
              name: "GitHub Action",
              item: SITE_URL + "/docs/github-action",
            },
          ],
        }),
      },
    ],
  }),
});

const WORKFLOW_YAML = `name: Seed preview database
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  seed:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: PasskeyBridge-LLC/satus/packages/action@main
        with:
          database-url: \${{ secrets.PREVIEW_DATABASE_URL }}
          rows: 250
          profile: saas
          max-cost: '0.50'
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
`;

function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="my-4 overflow-x-auto border border-[var(--ink)] bg-[var(--paper)] p-4 font-mono text-[12.5px] leading-[1.55] text-[var(--ink)]">
      <code>{children}</code>
    </pre>
  );
}

function TableRow({ cells, header }: { cells: string[]; header?: boolean }) {
  const Cell = header ? "th" : "td";
  return (
    <tr className="border-b border-[var(--ink)]/20">
      {cells.map((c, i) => (
        <Cell
          key={i}
          className={`px-3 py-2 text-left align-top font-mono text-[12.5px] ${
            header ? "font-semibold text-[var(--ink)]" : "text-[var(--ink)]"
          }`}
        >
          {c}
        </Cell>
      ))}
    </tr>
  );
}

function GitHubActionPage() {
  return (
    <PageShell sections={SECTIONS} currentPath="/docs/github-action">
      <Section
        heading="h1"
        id="overview"
        n="01"
        label="Overview"
        title={<>satus in one composite action.</>}
      >
        <Prose>
          <p>
            <code>PasskeyBridge-LLC/satus/packages/action@main</code> runs{" "}
            <code>satus generate</code> inside a GitHub Actions workflow and uploads the run
            manifest as a workflow artifact. It is a{" "}
            <a
              href="https://docs.github.com/en/actions/creating-actions/creating-a-composite-action"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              composite action
            </a>
            , not a Docker container — three shell steps that install Node, call{" "}
            <code>npx @passkeybridge/satus@{SATUS_VERSION}</code>, and upload the result. No
            container startup cost, no root filesystem writes.
          </p>
          <p>
            The action is a wrapper. If a run works on your laptop it works here, with the same
            flags, the same exit codes, the same{" "}
            <a
              href="/docs/how-it-works"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              three guarantees
            </a>
            .
          </p>
        </Prose>
      </Section>

      <Section id="usage" n="02" label="Usage" title={<>drop it into your PR workflow.</>}>
        <Prose>
          <p>The intended shape for a preview-database workflow:</p>
          <CodeBlock>{WORKFLOW_YAML}</CodeBlock>
          <p>
            Swap <code>OPENAI_API_KEY</code> for <code>ANTHROPIC_API_KEY</code> and add{" "}
            <code>provider: anthropic</code> under <code>with:</code> to drive Anthropic instead.
            For xAI, use <code>XAI_API_KEY</code> and <code>provider: xai</code> (needs the CLI
            release after 0.3.11). The CLI auto-detects from whichever env key is present.
          </p>
        </Prose>
      </Section>

      <Section id="inputs" n="03" label="Inputs" title={<>every knob, defaulted.</>}>
        <Prose>
          <div className="my-4 overflow-x-auto">
            <table className="w-full border-collapse border border-[var(--ink)]">
              <thead>
                <TableRow header cells={["name", "required", "default", "description"]} />
              </thead>
              <tbody>
                <TableRow
                  cells={[
                    "database-url",
                    "yes",
                    "—",
                    "Postgres connection string. Pass as a secret.",
                  ]}
                />
                <TableRow cells={["rows", "no", "50", "Rows per table. Free tier caps at 25."]} />
                <TableRow
                  cells={["profile", "no", "saas", "Reference profile: saas | ecommerce | b2b."]}
                />
                <TableRow
                  cells={[
                    "provider",
                    "no",
                    "auto",
                    "openai | anthropic | xai. Auto-detected from env.",
                  ]}
                />
                <TableRow cells={["model", "no", "provider default", "Model id override."]} />
                <TableRow
                  cells={[
                    "max-cost",
                    "no",
                    "'1.00'",
                    "USD ceiling. Quote it so YAML keeps a string.",
                  ]}
                />
                <TableRow
                  cells={["dry-run", "no", "false", "Validate without inserting or spending."]}
                />
                <TableRow
                  cells={[
                    "truncate",
                    "no",
                    "false",
                    "TRUNCATE target tables before inserting (RESTART IDENTITY, no CASCADE).",
                  ]}
                />
                <TableRow
                  cells={[
                    "force",
                    "no",
                    "false",
                    "Bypass the 10,000-row safety guard. Without it satus exits 11 (E_DB_NOT_EMPTY) against a database holding more than 10,000 rows, and writes nothing.",
                  ]}
                />
                <TableRow
                  cells={["working-directory", "no", ".", "Where satus.config.json lives."]}
                />
                <TableRow
                  cells={[
                    "satus-version",
                    "no",
                    SATUS_VERSION,
                    "npm version to install. Pin for reproducibility.",
                  ]}
                />
              </tbody>
            </table>
          </div>
        </Prose>
      </Section>

      <Section id="outputs" n="04" label="Outputs" title={<>parsed from the JSON manifest.</>}>
        <Prose>
          <p>
            All outputs are parsed from the <code>--json</code> payload the CLI writes to stdout.
            They are also uploaded verbatim as the <code>satus-run-manifest</code> workflow artifact
            so a downstream job can read the full record.
          </p>
          <div className="my-4 overflow-x-auto">
            <table className="w-full border-collapse border border-[var(--ink)]">
              <thead>
                <TableRow header cells={["name", "description"]} />
              </thead>
              <tbody>
                <TableRow cells={["run-id", "Server-side run UUID."]} />
                <TableRow cells={["tables-seeded", "Number of tables the run touched."]} />
                <TableRow cells={["rows-inserted", "Total rows inserted (0 on dry-run)."]} />
                <TableRow cells={["tokens-in", "Total input tokens across the run."]} />
                <TableRow cells={["tokens-out", "Total output tokens across the run."]} />
                <TableRow cells={["spent-usd", "Actual LLM spend in USD."]} />
              </tbody>
            </table>
          </div>
        </Prose>
      </Section>

      <Section id="security" n="05" label="Security" title={<>three deliberate choices.</>}>
        <Prose>
          <ol className="ml-5 list-decimal space-y-3">
            <li>
              <strong>
                <code>database-url</code> is an input, not an env var.
              </strong>{" "}
              GitHub redacts inputs in logs the same way it redacts env vars, but making it an input
              surfaces it in the Marketplace UI as a required field so a caller cannot leave it
              empty by accident.
            </li>
            <li>
              <strong>
                <code>max-cost</code> is a string.
              </strong>{" "}
              YAML parses <code>0.5</code> as a float and the CLI expects a string so it can
              normalise the format itself. Quote it in your workflow.
            </li>
            <li>
              <strong>
                The provider key stays in <code>env:</code>, not <code>with:</code>.
              </strong>{" "}
              The action never touches your provider key. That keeps it off the action's public
              input schema and out of anything a compromised action version could exfiltrate through
              inputs.
            </li>
          </ol>
          <p>
            Pin the action to a full commit SHA if you want defence in depth against a compromised
            release tag, and pin <code>satus-version</code> to a specific npm version for
            reproducibility. Both are documented in the{" "}
            <a
              href="https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              GitHub security-hardening guide
            </a>
            .
          </p>
        </Prose>
      </Section>

      <Section
        id="boundaries"
        n="06"
        label="What it isn't"
        title={<>four things the action does not do.</>}
      >
        <Prose>
          <ul className="ml-5 list-disc space-y-2">
            <li>
              <strong>No hosted-key tier.</strong> Bring your own OpenAI, Anthropic or xAI key. A
              managed-key mode is on the roadmap for a later release, not this one.
            </li>
            <li>
              <strong>No auto-commit of generated data.</strong> The action does not open a
              follow-up PR with a SQL dump. Seed data belongs in the ephemeral preview database, not
              in git history.
            </li>
            <li>
              <strong>No cache of previously-generated rows.</strong> Every invocation regenerates.
              The correctness problem for a cache key (schema hash + profile hash + provider
              version) is not worth solving for a first release.
            </li>
            <li>
              <strong>No GitLab CI, no CircleCI, no Buildkite variant.</strong> The CLI runs
              anywhere Node runs. This action is a convenience layer for GitHub, not a portability
              layer.
            </li>
          </ul>
          <p className="mt-8 max-w-[62ch] font-mono text-[12.5px] text-[var(--mute)]">
            Reference for <code>PasskeyBridge-LLC/satus/packages/action@main</code>. If anything
            here drifts from{" "}
            <a
              href="https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/action/action.yml"
              className="underline decoration-[var(--signal)] underline-offset-4"
            >
              action.yml
            </a>
            , action.yml wins — file an issue.
          </p>
        </Prose>
      </Section>
    </PageShell>
  );
}
