---
slug: v0-3-6-release-notes
title: "v0.3.6: normalize the provider base URL"
description: satus 0.3.6 normalizes ANTHROPIC_BASE_URL so both the SDK convention (no /v1) and the previous satus convention (with /v1) work. No other changes.
date: 2026-08-06
author: satus.sh
tags: [release, anthropic, cli]
draft: false
---

`@passkeybridge/satus@0.3.6` is on npm. One fix. No flag, config, or telemetry changes. If v0.3.5 worked for you, v0.3.6 works the same way—unless you had `ANTHROPIC_BASE_URL` exported, in which case v0.3.6 works and v0.3.5 may not have.

## The bug

The Anthropic provider builds its endpoint as `${ANTHROPIC_BASE_URL}/messages` and defaulted the base to `https://api.anthropic.com/v1`—so a custom base was expected to *include* the `/v1` suffix. Anthropic's official SDKs expect the opposite: their `ANTHROPIC_BASE_URL` convention is the bare host, and the SDK appends the versioned path itself.

The failure mode is what makes this worth a patch release on its own. If you had `ANTHROPIC_BASE_URL=https://api.anthropic.com` exported—increasingly common, since agent tooling and proxies set it for their own use—satus called `https://api.anthropic.com/messages`, which returns a `404` with an empty body. The CLI surfaced that as:

```
categories error: Anthropic 404:
```

Nothing about that message says "your base URL is missing `/v1`". We know because we hit it ourselves: during an end-to-end audit run this week, the CLI failed with exactly that error inside a sandbox that exports `ANTHROPIC_BASE_URL` for unrelated tooling. It cost us a diagnosis round-trip with full access to the source. A user in the same spot has no chance.

## The fix

The base URL is now normalized: trailing slashes are stripped, and `/v1` is appended unless the value already ends in a version segment. Both conventions work:

```bash
# Anthropic SDK convention — now works
export ANTHROPIC_BASE_URL=https://api.anthropic.com

# Previous satus convention — still works
export ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
```

Verified with live `claude-haiku-4-5` generation runs in both forms before tagging. `OPENAI_BASE_URL` is unchanged: OpenAI's own convention already includes `/v1`, and satus matched it correctly.

One housekeeping note for anyone building from source: `packages/cli/package-lock.json` is regenerated against the public npm registry. The old lockfile pinned a private mirror from the project's original build environment, which made `npm ci` fail everywhere else. The published tarball was never affected—it has been byte-identical to the repo build, which you can check yourself now that releases carry [npm provenance](https://docs.npmjs.com/generating-provenance-statements).
