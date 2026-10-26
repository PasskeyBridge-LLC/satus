# HANDOFF

Written 2026-10-26 after the blog inline-wrap fix. Replace this file next session; do not append.

## State

The wrap fix is on `cursor/blog-inline-wrap-5033`. It is not merged and not deployed. The coordinator merges. CSP was not changed.

`.prose-satus a` and `code` use `overflow-wrap: anywhere` and `word-break: break-word`. `pre`, `pre code`, and `pre a` reset both, so a code block still scrolls inside itself. `.blog-dek` uses the same wrap. The v0.3.3 dek is the plain-text path `passkeybridge/satus/packages/action@main`, which sits outside `.prose-satus` and was widening that post.

Playwright WebKit and Chromium, all 51 non-draft posts, widths 320, 360, 390, 768, and 1280: 510 checks, `scrollWidth === clientWidth` on every one. Before the change, 63 overflowed. WebKit at 360 on `what-satus-0-3-11-checks-before-a-write` was 373/360 and is 360/360. `packages/cli/src/generate/validate.ts` stays one line at 390 and wider. A `pre` on that post still scrolls internally (724 vs 310 at 360).

`git branch -r --no-merged origin/main` listed nothing.

## Left open on purpose

Production was not re-checked. This session does not merge or deploy.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP on `/`. Multi-column UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits.

## Graduated this session

Joel’s open items (cli-publish.yml, the old npm token, the Auth leaked-password toggle) are in `mem/followups/satus-supabase-advisor-deferred.md`.

## Next

1. Coordinator: merge the inline-wrap PR once CI is green.
