# PasskeyBridge-LLC/satus/packages/action

Run [`satus`](https://satus.sh) inside a GitHub Actions workflow. This composite action wraps `npx @passkeybridge/satus@<version> generate --json` and uploads the run manifest as a workflow artifact. No Docker image, no container startup cost.

The action is a thin wrapper around the CLI. If a run works on your laptop it works here, with the same flags and the same exit codes.

## Requirements

- A Postgres database the workflow can reach (a service container, a preview branch on Neon/Supabase/RDS, an ephemeral instance).
- An OpenAI, Anthropic or xAI API key exposed as an environment variable to the step (not as an input — see the security notes below).
- A satus license key is only required for runs that exceed the free-tier caps (25 rows/table, 5 tables); dry-runs and small runs do not need one.

## Usage

```yaml
name: Seed preview database
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
          database-url: ${{ secrets.PREVIEW_DATABASE_URL }}
          rows: 250
          profile: saas
          max-cost: '0.50'
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

For an Anthropic-first workflow, swap the two lines that mention OpenAI:

```yaml
      - uses: PasskeyBridge-LLC/satus/packages/action@main
        with:
          database-url: ${{ secrets.PREVIEW_DATABASE_URL }}
          provider: anthropic
          rows: 250
          max-cost: '0.50'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

For xAI, set `provider: xai` and expose `XAI_API_KEY` the same way. The `xai` provider needs a satus CLI release after 0.3.11; until that release is out, the pinned `satus-version` does not include it.

```yaml
      - uses: PasskeyBridge-LLC/satus/packages/action@main
        with:
          database-url: ${{ secrets.PREVIEW_DATABASE_URL }}
          provider: xai
          rows: 250
          max-cost: '0.50'
        env:
          XAI_API_KEY: ${{ secrets.XAI_API_KEY }}
```

## Inputs

| Name | Required | Default | Description |
|------|:--------:|---------|-------------|
| `database-url` | yes | | Postgres connection string. Pass as a secret. |
| `rows` | no | `50` | Rows to generate per table. Free tier caps at 25. |
| `profile` | no | `saas` | Reference profile (`saas`, `ecommerce`, `b2b`). |
| `provider` | no | auto | `openai`, `anthropic` or `xai`. Auto-detected from which env key is set (`XAI_API_KEY` only when neither of the other two is set). |
| `model` | no | provider default | Model id override. |
| `max-cost` | no | `'1.00'` | USD ceiling. Must be quoted so YAML keeps it a string. |
| `dry-run` | no | `false` | Validate without inserting or spending. |
| `truncate` | no | `false` | TRUNCATE target tables before inserting (RESTART IDENTITY, no CASCADE). |
| `force` | no | `false` | Bypass the 10,000-row safety guard. Without it satus exits `11` (`E_DB_NOT_EMPTY`) against a database that already holds more than 10,000 rows, and writes nothing. |
| `working-directory` | no | `.` | Directory to run the CLI in (where `satus.config.json` lives). |
| `satus-version` | no | `0.3.11` | npm version to install. Pin for reproducibility. |

## Outputs

Parsed from the `--json` payload the CLI emits on stdout.

| Name | Description |
|------|-------------|
| `run-id` | Server-side run UUID for correlation. |
| `tables-seeded` | Number of tables the run touched. |
| `rows-inserted` | Total rows inserted (0 on dry-run). |
| `tokens-in` | Total input tokens across the run. |
| `tokens-out` | Total output tokens across the run. |
| `spent-usd` | Actual LLM spend in USD. |

## Security

Three deliberate choices in the example above are worth reading before you copy it:

1. **`database-url` is an input, not an env var.** GitHub redacts inputs in logs the same way it redacts env vars, but making it an input surfaces it in the Marketplace UI as a required field, so a caller cannot leave it empty by accident.
2. **`max-cost` is a string.** YAML parses `0.5` as a float, and the CLI expects a string so it can normalise the format itself. The action forwards it verbatim.
3. **The provider key stays in `env:`, not `with:`.** The action never touches the provider key. That keeps it off the action's public input schema and out of anything a compromised action version could exfiltrate through inputs.

The action does not log inputs, does not read the database, and does not send anything anywhere except the child CLI process.

## What this action does not do

- Does not run any hosted-key tier. Bring your own OpenAI, Anthropic or xAI key.
- Does not commit generated seed data back to your repository. Seed data belongs in the preview database, not in git.
- Does not cache generated rows between runs. Every invocation regenerates.
- Does not ship variants for GitLab CI, CircleCI, or Buildkite. The CLI runs anywhere Node runs.

## References

- [`@passkeybridge/satus` on npm](https://www.npmjs.com/package/@passkeybridge/satus)
- [satus.sh docs](https://satus.sh/docs/github-action)
- [GitHub Actions: security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
