---
slug: v0-3-9-release-notes
title: "v0.3.9: the safety feature you couldn't turn off"
description: Yesterday's safety guard had no escape hatch in the GitHub Action. Plus exit code 10, and what a line-by-line audit of our own docs turned up.
date: 2026-08-11
author: satus.sh
tags: [release, cli, github-actions, docs]
draft: false
---

`@passkeybridge/satus@0.3.9` is on npm. Two fixes, both from the same morning's work: reading our own documentation line by line and checking whether the code agreed.

## A guard with no off switch

[v0.3.8](/blog/v0-3-8-release-notes) added the 10,000-row production guard. `--force` bypasses it, which is the documented escape hatch and works fine from a terminal.

The GitHub Action did not expose it.

So as of yesterday, a workflow pointed at a long-lived preview branch — one with real fixtures already in it, which is exactly the legitimate case `--force` exists for — would exit `11`, write nothing, and offer the user no input to set. The CLI had an escape hatch; the one environment that runs unattended could not reach it.

That is a worse failure than the bug the guard fixes, because it is *our* safety feature breaking *their* pipeline with no recourse. The action now takes `force` (and `truncate`, which had also never been wired up):

```yaml
- uses: passkeybridge/satus-action@v1
  with:
    database-url: ${{ secrets.PREVIEW_DATABASE_URL }}
    force: true          # preview branch already has real fixtures
```

Both default to `false`, so nothing changes for existing workflows.

The general lesson we're taking: a safeguard ships with its override, in every surface, in the same release. Adding the guard and the bypass to the CLI while leaving the action a version behind meant the feature was only half-built, and the half that was missing is the half that unblocks people.

## Exit code 10

[How it works](/docs/how-it-works) has specified, for as long as the page has existed, that an unbreakable foreign-key cycle exits `10` (`E_FK_CYCLE`) — and given the reason: so CI can distinguish "satus refused to run" from "satus tried and failed."

It exited `1`, indistinguishable from a bad password.

Exit codes now live in one file as a single contract — `1`, `2`, `10`, `11` — with a test that pins every value and asserts none collide. `10` and `11` both mean *satus declined to act*, which is the distinction a bare `1` cannot carry and the reason for having named codes at all.

## What the audit found

We spent the morning diffing every documented claim against the source. This is the list, in full, because a changelog that hides the embarrassing ones isn't worth writing:

- The homepage said the free tier seeds **500 rows per run**. The caps are 25 rows across 5 tables. The real number is **125** — we overstated our own free tier by 4x on the page most people read first.
- The **terms of service** told users to run `--dry` to "inspect generated SQL". The flag is `--dry-run` and it emits no SQL. Of all the pages to get that wrong, the one whose job is telling you how not to damage your database is the worst.
- The CLI README priced **Team at $79/mo**. It is $49/seat/month and it is a waitlist. That README ships inside the npm tarball, so the wrong price was sitting on npmjs.com.
- Both the README and `/docs` advertised **custom / private profiles**. No version of satus has ever had them. `ProfileName` is a union of exactly three string literals.
- Pricing promised a **14-day offline grace** on paid licenses, in the feature matrix and again in the FAQ. `LICENSE_CACHE_TTL_MS` is 24 hours. Off by 14x, on something people pay for.
- The FK-planner section credited **Tarjan's algorithm**. `dag.ts` uses Kahn's. There is no Tarjan implementation in the repository.
- Three Team features — shared profiles, CI mode, audit log — were listed in the pricing matrix identically to shipped ones. They are now marked **(planned)**, which is what they are.

Everything above is corrected. Where the documented behaviour was better than what we had, we built it (the guard in 0.3.8, exit `10` here). Where the documentation was simply wrong, we changed the documentation.

## Why this kept happening

The pattern is the same every time: prose written alongside an intention, shipped, and never re-checked against the code that eventually landed — or didn't. Nobody lied. The docs described the product we meant to build, and the gap opened up quietly afterwards.

The fix we're applying isn't "be more careful." It's that documented behaviour with a number in it now has a test asserting that number. `10000`, `11`, `10`, `2`, `1` are assertions in the suite, not prose. When someone changes one, a test fails and says it is a public contract.

That doesn't cover sentences like "Tarjan's algorithm" — you can't unit-test an adjective. For those, the only defence is reading the page next to the code, which is what we did today and will do at each release.

No [CLI flag](/cli) added, removed, or renamed. `satus.config.json` from 0.3.x works unchanged. If your CI branches on exit code `1` specifically for FK-cycle failures, widen it to `!= 0` or add `10`.
