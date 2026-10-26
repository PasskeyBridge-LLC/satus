---
slug: v0-3-10-release-notes
title: "v0.3.10: the 24-hour license grace is now real"
description: satus 0.3.10: activation stores the key, generate re-verifies stale verdicts, and a canceled subscription loses paid caps within 24 hours.
date: 2026-08-14
author: satus.sh
tags: [release, cli, licensing]
draft: false
---

`@passkeybridge/satus@0.3.10` is on npm. One fix, and it is another entry in the marketed-versus-delivered ledger we keep in public.

## What the docs promised

The pricing page has said, since it went up: a paid license caches its verdict locally for 24 hours, so the CLI keeps working through a flight or a license-server outage — and past that window, verification fails closed. The subscription-expired email says a revoked license "will expire within 24 hours."

## What the code did

Neither half was true. `satus activate` verified the key, cached the verdict — and threw the key away. `satus generate` read that cache with no age check at all. Nothing could ever re-verify, because nothing knew the key anymore. The practical consequence: cancel your subscription and the CLI kept honoring the stale `plan: pro` verdict forever. An infinite grace window, sold as 24 hours.

We found this auditing our own revenue path, not because anyone exploited it. As far as telemetry shows, no one was in a position to: every license ever issued belongs to us.

## What 0.3.10 does

- `satus activate` stores the key alongside the cached verdict in `~/.satus/license-cache.json`.
- `satus generate` honors a fresh verdict as-is. A verdict older than 24 hours is re-verified with the stored key.
- When no verdict newer than 24 hours can be produced — offline past the grace window, a server error, or a cache written by an older CLI that carries no key — the run falls back to Free-tier caps and prints one line saying why. No silent downgrade.
- `satus whoami` now flags a cache older than 24 hours.

Nine tests pin the contract: the fresh-cache short-circuit, stale re-verification, the canceled-license downgrade, offline and server-error behavior past the grace, the legacy keyless cache, and that invalid verdicts are never cached.

## If you activated with an older version

Your cache has no stored key. The first `generate` after its 24-hour window prints a notice and applies Free caps; run `satus activate <key>` once and everything works as documented from then on.

That is the whole release. The offline window you were sold is the offline window you get — in both directions.
