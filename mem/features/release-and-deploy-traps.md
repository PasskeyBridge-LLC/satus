# Release and deploy traps in this repo

Six things that cost real time, all verified by reproduction.

## `.vercel/` must stay gitignored

`.gitignore` covered `.output` but not `.vercel`. A `git add -A` swept 157
build artifacts into the repo (there were zero at v0.3.6). Vercel treats a
checked-in `.vercel/output` as **prebuilt output and ships it instead of
building from source**, so the live site froze on whatever snapshot got
committed while later source changes only ever landed in `.output`.

Symptom: `/blog/rss.xml` 500ing with
`Cannot find package 'tslib' imported from /var/task/_ssr/start--wyh4sTq.mjs`.
The committed chunk had a bare `import "tslib"`; a fresh build emits
`import "../_libs/tslib.mjs"`. `tslib` is transitive-only (via `@radix-ui`,
`@supabase`), so a bare specifier cannot resolve in the deployed function.
Fixed in `c3e2767`. `.vercel` is now ignored — keep it that way.

## A tag push runs the workflow *at that tag's commit*

Not the one on `main`. `cli-publish.yml` was changed so that a tag naming an
already-published version is a green no-op rather than a failure — but that
only helps tags whose commit is at-or-after the fix (`8c182b0`). Tagging an
older release still runs the older workflow and still goes red. `v0.3.9`
went green; `v0.3.8` did not. Harmless, permanent, not worth re-running.

## Releases are published by dispatch, then tagged

Tag pushes are blocked from some environments (the sandbox git proxy 403s
them; branch pushes work). So the normal shape is: publish via
`workflow_dispatch` on `cli-publish.yml`, then push the tag afterwards for
reproducibility. That is why the no-op branch above exists.

Consequence to watch: **a published version can end up with no git tag.** It
has happened to 0.3.6, 0.3.7, 0.3.8, 0.3.9, 0.3.10 and 0.3.11. All are
tagged as of 2026-08-30, but nothing enforces it, so check
`git ls-remote --tags origin` against `npm view @passkeybridge/satus
versions` when picking up work.

## Ship a safeguard and its override together, everywhere

0.3.8 added the 10,000-row guard with `--force` as its documented escape
hatch, but the GitHub Action exposed no matching input. A workflow pointed at
a preview branch with real fixtures — the exact case `--force` exists for —
exited `11`, wrote nothing, and offered no way to proceed. A safeguard that
cannot be overridden in the one environment that runs unattended is worse
than the bug it prevents. Fixed in 0.3.9. When adding a guard, add its bypass
to the CLI *and* the action in the same release.

## Pushing `main` is not deploying `main`

Vercel appears to deduplicate its GitHub deployments by commit SHA. Push the
same commit to `main` and to a working branch a couple of seconds apart and
you can get **one** deployment, attributed to the branch, `target: null` —
a preview. `main` advances, production does not, CI is green, and nothing
anywhere reports a failure.

Observed 2026-09-04 on `b1a31b0`: `main` moved, the only deployment for that
SHA was the branch preview, and production stayed on `a7baead`. Harmless
that time — the commit touched CLAUDE.md, a workflow, a validator and the
`build` script, none of which change what the site serves — but the same
sequence with a code change ships nothing while looking like it shipped.

Two earlier commits the same day (`95772ab`, `a7baead`) *did* get both a
production and a preview deployment from the same dual-push pattern, so this
is timing-dependent, not deterministic. Do not rely on having got away with
it.

**Sequence that works:** push `main` alone, confirm a deployment exists for
that SHA with `target: "production"` and state `READY`, then push the
working branch. Checking `git push` output or the CI badge is not checking
the deploy.

**Read the `alias` list, not the state.** A deployment object is `READY`
with `target: "production"` a moment *before* the domains move. What proves
it is serving traffic is `satus.sh` appearing in its `alias` array. State
and timestamps do not distinguish "built" from "live".

## Grep the saved page with `-a`, or it will lie about the `h1`

Verifying headings against production means `curl` to a file and count
`<h1>`. The pages contain a byte grep treats as binary, so plain
`grep -o '<h1' page.html | wc -l` prints **`h1=0`** while grep itself says
`binary file matches` on stderr — a false failure on a page that is fine,
and easy to misread as a regression worth rolling back. It has happened
twice.

```sh
curl -sS --compressed "https://satus.sh$p" -o page.html   # --compressed: gzip is the other way this misreads
grep -ao '<h1' page.html | wc -l                          # -a: treat as text
```

Command substitution drops the NUL as well, so write to a file rather than
capturing the body into a shell variable. Same caution for any future
rendered-output check: confirm the tool can *see* the thing before trusting
it to say the thing is missing.

## A 403 from `curl` in this sandbox is probably about the sandbox

2026-09-18, verifying the embargoed post: `curl https://satus.sh/...` from
the session container returned `403 Forbidden` with a 70-byte body and a
Vercel `iad1::` request id — on `/`, `/pricing`, the health endpoint, and
the new post, intermittently, even with six seconds between requests. The
same URLs fetched through `mcp__Vercel__web_fetch_vercel_url` (Vercel's
own network) were 200, and the Supabase cron's health run that morning
had passed. Deployment protection was not involved: SSO applies to
non-custom domains only.

It is Vercel's edge rate-limiting one IP that had just made a few hundred
automated requests. Before reporting a 403 as a production fault, fetch
the URL from a second vantage point — the Vercel fetch tool, or the
`e2e_health_log` table, which is written from Supabase's network — and
compare. Two hundreds from elsewhere and a 403 from here is a fact about
here.

## Reading Vercel runtime logs for an audit finding

From the 2026-09-21 "Soft 404" on `/blog/agent-mode-postponed`
(investigated 09-26):

- **Audit timestamps are Eastern; the logs are UTC.** "13:52" in the SEO
  audit had no request in the logs. 17:52:52 UTC did — the same minute in
  America/New_York. Convert before concluding a request never happened.
- **`get_runtime_logs` times out on windows wider than about an hour**
  when returning lines. `group_by` works over a whole day; for lines, use
  windows of a few hours or less, and the `query` filter.
- Retention reached back at least five days on 09-26.

The finding itself: four 200s from the then-production deployment, cache
MISS, no deploy in flight, no error cluster. Google judged a 200 page as
not-found content; the server side gave it nothing to judge from. The
page passed Google's live test the same week. No code change.

## Release order for a CLI version bump (from 0.3.12 and 0.3.13)

validate-docs check 7 keeps two version groups: the CLI files
(`packages/cli/package.json`, lockfile root, `src/version.ts`) and the
published files (`src/lib/version.ts`, the `action.yml` `satus-version`
default, the Action README). Merge the CLI group first and tag. Move the
published group only after `npm view @passkeybridge/satus@<v>` answers.
The Action default is what `npx` installs for callers without `satus`
on PATH, so a default that is not on npm fails their workflow. 0.3.12:
published 15:26 UTC 2026-10-26, Action moved in #69 at 15:41. 0.3.13
merged in #87 with the published group held at 0.3.12.

## No Vercel preview for agent branches

The project's Ignored Build Step is
`[ "$VERCEL_ENV" = production ] && exit 1; case "$VERCEL_GIT_COMMIT_REF" in claude/*|cursor/*|dependabot/*) exit 0;; esac; ...`.
Previews for `claude/*` and `cursor/*` branches are canceled by design
(seen on #87, 2026-11-14). For viewport checks on such a PR, build
locally (`bun run build`, then `npx vite preview`) and note that
`/_vercel/insights/script.js` 404s off Vercel.
