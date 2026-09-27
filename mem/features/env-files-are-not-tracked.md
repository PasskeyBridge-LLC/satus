# Env files are not tracked

Established 2026-09-27.

`.env`, `.env.development` and `.env.production` were tracked until
2026-09-27 (Supabase URL and publishable key, plus a Stripe test publishable
key in `.env.development`). They are removed from the tree; history was not
rewritten. `.gitignore` ignores `.env*` except `.env.example`, which holds
names only.

## Where values come from now

- **Vercel build.** `vite.config.ts` inlines every `VITE_*` from `loadEnv`,
  which reads `process.env`. The Vercel project env now carries
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for Production and
  Preview (added 2026-09-27, same values the tracked files had), next to the
  existing `VITE_PAYMENTS_CLIENT_TOKEN` and the server-only secrets.
- **Server code.** `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` are not set in
  Vercel; `client.ts` and `auth-middleware.ts` fall back to the inlined
  `VITE_` values, as they did before.
- **CI (`site-ci.yml`).** Builds and tests pass with no env at all.
- **Local dev.** Copy `.env.example` to `.env.local` (gitignored).

## Gates

- `.github/workflows/secret-scan.yml`: gitleaks on every pull request and
  every push to `main` (checked-out tree plus the commits the event adds).
  `.gitleaks.toml` allowlists only the sample licence key in email-template
  preview props and the Ahrefs data-key, each pinned to path and pattern.
- `scripts/validate-env-files.mjs` still runs in `bun run build`; it now only
  has `.env.example` to check and fails if a value lands there.

## Keys left in history

Listed by last-4 in `.gitleaks.toml` (SECURITY-NOTES). Rotating a key means
updating the Vercel env, never a file in git.
