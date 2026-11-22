---
slug: what-we-shipped-in-2026-what-we-killed
title: What we shipped in 2026, what we killed
description: The 2026 ship and cut record for satus: npm publish times, git tags, CHANGELOG.md sections, and the posts that recorded each decision. Each item is dated.
date: 2026-12-25
publishAt: 2026-12-25T09:00:00-05:00
author: satus.sh
tags: [release, cli, roadmap]
draft: false
---

On 2026-11-22, `npm view @passkeybridge/satus version` printed `0.3.13`, and `satus --version` printed `0.3.13`. The publish times below are the `npm view @passkeybridge/satus time --json` output from that day. Tag names are `git tag -l 'v0.*'` in this clone. Where a tag exists, the commit is that tag's commit. Changelog sections are [`CHANGELOG.md` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/CHANGELOG.md). A version npm published, with no section in that file, is listed as a timestamp only.

```sql
select version();
```

```
 PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
(1 row)
```

```
$ npm view @passkeybridge/satus version
0.3.13
$ satus --version
0.3.13
```

```json
{
  "created": "2026-05-26T15:49:01.558Z",
  "modified": "2026-11-16T13:35:33.216Z",
  "0.1.0": "2026-05-26T15:49:01.936Z",
  "0.1.1": "2026-05-26T15:49:41.899Z",
  "0.2.0": "2026-06-04T14:15:13.429Z",
  "0.3.0": "2026-06-20T13:20:39.052Z",
  "0.3.1": "2026-06-24T11:07:00.717Z",
  "0.3.2": "2026-06-24T11:08:03.409Z",
  "0.3.3": "2026-07-14T13:06:15.665Z",
  "0.3.4": "2026-07-14T15:36:21.066Z",
  "0.3.5": "2026-07-14T16:44:46.301Z",
  "0.3.6": "2026-08-06T13:09:21.695Z",
  "0.3.7": "2026-08-10T23:35:57.035Z",
  "0.3.8": "2026-08-11T00:36:21.276Z",
  "0.3.9": "2026-08-11T14:52:03.159Z",
  "0.3.10": "2026-08-14T22:12:54.387Z",
  "0.3.11": "2026-08-27T19:13:45.065Z",
  "0.3.11-orgmove.0": "2026-09-27T16:32:05.067Z",
  "0.3.12": "2026-10-26T15:26:29.240Z",
  "0.3.13": "2026-11-15T12:40:09.867Z"
}
```

`git tag -l 'v0.*'` printed nine names: `v0.3.3`, `v0.3.5`, `v0.3.7`, `v0.3.8`, `v0.3.9`, `v0.3.10`, `v0.3.11`, `v0.3.12`, `v0.3.13`.

## Releases the changelog names

**2026-05-26.** npm `0.1.0` at `2026-05-26T15:49:01.936Z` and `0.1.1` at `2026-05-26T15:49:41.899Z`. The changelog section `[0.1.1]` calls that the initial public release. The log opened the same day: [Introducing the satus log](/blog/introducing-the-log). There is no `v0.1.0` or `v0.1.1` tag in the list above.

**2026-06-04.** npm `0.2.0` at `2026-06-04T14:15:13.429Z`. The changelog lists deferred-constraint handling for soft foreign-key cycles, single-CTE catalog introspection, a tarball shrink from 104 kB to 23 kB, CITEXT detection, and partitioned-parent RLS detection. There is no `v0.2.0` tag in the list above. Notes: [v0.2.0](/blog/v0-2-0-deferred-constraints-faster-planning-smaller-binary).

**2026-06-20.** npm `0.3.0` at `2026-06-20T13:20:39.052Z`. The changelog adds the Anthropic provider, `--provider`, `--json`, and `-v` / `--verbose`. There is no `v0.3.0` tag in the list above. Notes: [v0.3.0](/blog/v0-3-0-anthropic-and-machine-readable-output).

**2026-06-24.** npm `0.3.1` at `2026-06-24T11:07:00.717Z` and `0.3.2` at `2026-06-24T11:08:03.409Z`. `CHANGELOG.md` has no section for either version.

**2026-07-14.** npm `0.3.3` at `2026-07-14T13:06:15.665Z`. Tag `v0.3.3` is [`65464e67494e9ffcf53e58cc03b18c7a6c4a5a4b`](https://github.com/PasskeyBridge-LLC/satus/commit/65464e67494e9ffcf53e58cc03b18c7a6c4a5a4b). The changelog adds the GitHub Action and opt-in failure fingerprints. Notes: [v0.3.3](/blog/v0-3-3-release-notes). npm `0.3.4` at `2026-07-14T15:36:21.066Z` has no changelog section and no tag in the list above. npm `0.3.5` at `2026-07-14T16:44:46.301Z`. Tag `v0.3.5` is [`485452af18765c8848460ad065007104a7855e4b`](https://github.com/PasskeyBridge-LLC/satus/commit/485452af18765c8848460ad065007104a7855e4b). The changelog adds publishing to npm from a `v*` tag. Notes: [v0.3.5](/blog/v0-3-5-release-notes).

**2026-08-06.** npm `0.3.6` at `2026-08-06T13:09:21.695Z`. Commit [`e630272294bf64bb8e31283ad97edf86f9518b73`](https://github.com/PasskeyBridge-LLC/satus/commit/e630272294bf64bb8e31283ad97edf86f9518b73) has the subject `Release v0.3.6`. There is no `v0.3.6` tag in the list above. The changelog says `ANTHROPIC_BASE_URL` accepts a base with or without `/v1`. Notes: [v0.3.6](/blog/v0-3-6-release-notes).

**2026-08-10.** npm `0.3.7` at `2026-08-10T23:35:57.035Z`. Tag `v0.3.7` is [`137d9af3a6600e8c81434c71c98beed8a976b0b5`](https://github.com/PasskeyBridge-LLC/satus/commit/137d9af3a6600e8c81434c71c98beed8a976b0b5). The changelog records five fixes: identity columns left to the database, foreign keys aimed at a non-primary-key column resolved from inserted parent rows, `--truncate` omitting `CASCADE`, one price table for the dry-run estimate and the live meter, and a telemetry payload that no longer sends table names, the schema name, or the raw error text. Notes: [v0.3.7](/blog/v0-3-7-release-notes).

**2026-08-11.** npm `0.3.8` at `2026-08-11T00:36:21.276Z`. Tag `v0.3.8` is [`c7af672ba7256496ed4fdbfa98cd75a969dd237f`](https://github.com/PasskeyBridge-LLC/satus/commit/c7af672ba7256496ed4fdbfa98cd75a969dd237f). The changelog adds the 10,000-row guard, exit `11`, and `--force`. Notes: [v0.3.8](/blog/v0-3-8-release-notes). npm `0.3.9` at `2026-08-11T14:52:03.159Z`. Tag `v0.3.9` is [`e490b4f8e723801a4de256a0407ba367b28c38de`](https://github.com/PasskeyBridge-LLC/satus/commit/e490b4f8e723801a4de256a0407ba367b28c38de). The changelog adds exit `10` for an unbreakable foreign-key cycle, and `force` and `truncate` inputs on the GitHub Action. It corrects the README price of Team from $79/mo to $49/seat/month, on a waitlist, and says every tier ships the three profiles `saas`, `ecommerce`, and `b2b`. Notes: [v0.3.9](/blog/v0-3-9-release-notes).

**2026-08-14.** npm `0.3.10` at `2026-08-14T22:12:54.387Z`. Tag `v0.3.10` is [`9e47b64ac0281f03b6bca3dc60022db918a16707`](https://github.com/PasskeyBridge-LLC/satus/commit/9e47b64ac0281f03b6bca3dc60022db918a16707). The changelog says the 24-hour license grace is enforced. Notes: [v0.3.10](/blog/v0-3-10-release-notes).

**2026-08-27.** npm `0.3.11` at `2026-08-27T19:13:45.065Z`. Tag `v0.3.11` is [`8e17aa95d3199dd3d08a8ef51142f631a5079c35`](https://github.com/PasskeyBridge-LLC/satus/commit/8e17aa95d3199dd3d08a8ef51142f631a5079c35). The changelog makes the run record opt-in (`telemetry.enabled`, `SATUS_TELEMETRY=1`, `DO_NOT_TRACK=1` wins) and reads primary keys and unique constraints from `pg_catalog`. The [v0.3.11 notes](/blog/v0-3-11-release-notes) say the run record had been sent unconditionally, and that all twelve records then in the table were release-test runs. That twelve is the figure in those notes, on that date.

**2026-09-27.** npm `0.3.11-orgmove.0` at `2026-09-27T16:32:05.067Z`. `CHANGELOG.md` has no section for it, and the tag list above has no matching tag. The tarball's contents are not described here.

**2026-10-26.** npm `0.3.12` at `2026-10-26T15:26:29.240Z`. Tag `v0.3.12` is [`f4f33a453a9d4c5941596c81acdea31e0ae74c97`](https://github.com/PasskeyBridge-LLC/satus/commit/f4f33a453a9d4c5941596c81acdea31e0ae74c97). The version-bump commit is [`631e5b1fc95ef111f3ce6c80226ef190458b4af4`](https://github.com/PasskeyBridge-LLC/satus/commit/631e5b1fc95ef111f3ce6c80226ef190458b4af4) ([#67](https://github.com/PasskeyBridge-LLC/satus/pull/67)). The changelog adds the `xai` provider and sets the `zod` dependency to `^4.6.6`. Notes: [v0.3.12](/blog/v0-3-12-release-notes).

**2026-11-15.** npm `0.3.13` at `2026-11-15T12:40:09.867Z`. Tag `v0.3.13` points at [`3f647b0bc3d8e6816664afcd89ec1c170a95528a`](https://github.com/PasskeyBridge-LLC/satus/commit/3f647b0bc3d8e6816664afcd89ec1c170a95528a), committed 2026-11-14 ([#89](https://github.com/PasskeyBridge-LLC/satus/pull/89)). The changelog moves the OpenAI default to `gpt-6-luna`, prints a stderr line when the resolved model has an announced shutdown, and says a config that still sets `"model": "gpt-4o-mini"` keeps that model until the field changes. The docs commit [`b47edb786ff1cde318f62b3fec75632a6c02be96`](https://github.com/PasskeyBridge-LLC/satus/commit/b47edb786ff1cde318f62b3fec75632a6c02be96) ([#87](https://github.com/PasskeyBridge-LLC/satus/pull/87)), the same day, stops naming a `satus plan` command. There is no v0.3.13 release-notes file under `src/content/blog/` on `main` at `a741845f91054532f3b32b43cbb3cda289ad0c35`.

## What was cut

**2026-06-23.** [Agent mode, postponed to v0.5](/blog/agent-mode-postponed) is commit [`6e2938d2b78c183e9e41c427ae60fbdb5c074873`](https://github.com/PasskeyBridge-LLC/satus/commit/6e2938d2b78c183e9e41c427ae60fbdb5c074873). The editor's note dated 2026-07-16 says the June version dates shifted, and that after the 2026-07-03 renumber, v0.4.0 means agent mode. On 2026-11-22 the command is still absent. Stdout was empty. The exit code is 1.

```
$ satus agent

error: unknown command 'agent'
```

The usage text followed that line. [`docs/ROADMAP.md` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/docs/ROADMAP.md) still lists agent mode under Phase 3 and says it was postponed once already.

**2026-08-10.** The 0.3.7 changelog removes `CASCADE` from `--truncate`. A referencing table outside the run set is no longer emptied by that flag. The [27 November post](/blog/what-satus-truncate-empties-and-what-it-refuses-to) is the later write-up of the flag that replaced it.

**2026-08-27.** [`docs/CONTENT_PLAN_2026-2027.md`](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/docs/CONTENT_PLAN_2026-2027.md) marks two pieces cut on this date: the migration-off-the-app-builder story, and the marketing-audit article. The plan says the audit runs as the `validate-docs` build gate. `git log -S 'Cut 2026-08-27' -- docs/CONTENT_PLAN_2026-2027.md` returned [`3abfa27aafaa770432014e7340f3c7deba704e08`](https://github.com/PasskeyBridge-LLC/satus/commit/3abfa27aafaa770432014e7340f3c7deba704e08). The same release, 0.3.11, stops sending the run record unless telemetry is turned on.

**2026-08-28.** [The cycle-breaking heuristic we documented and never shipped](/blog/the-cycle-breaking-heuristic-we-never-shipped) reports that three of the four published rules for choosing which foreign key to defer are not in the code. The post file was added in [`5b293c6c2417bb63012314175b53aac3c6d293d3`](https://github.com/PasskeyBridge-LLC/satus/commit/5b293c6c2417bb63012314175b53aac3c6d293d3) on 2026-08-27. The mechanism the May post describes, a nullable back-edge left `NULL` and back-patched in the same transaction, is the part the 28 August post says still holds.

**2026-11-14.** `satus plan` is not a command. Stdout was empty. The exit code is 1.

```
$ satus plan

error: unknown command 'plan'
```

The usage text followed that line. The [generated-columns post](/blog/generated-columns-are-load-bearing-now) records the same result for 0.3.12 and 0.3.13. Commit `b47edb7`, linked above, is the docs change that stops naming the command.

## Still a published limit

`satus snapshot` exits 1. The first stderr line is `error: unknown command 'snapshot'`. `satus generate --seed` exits 1. The first stderr line is `error: unknown option '--seed'`. Phase 2 of the roadmap file linked above still names `satus snapshot`, cross-column consistency, and multi-column unique constraints.

The published v0.x limits still apply: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
