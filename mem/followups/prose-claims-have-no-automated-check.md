# Prose claims still have no automated check

**Status:** open by design as of 2026-08-21
**Effort:** ongoing, per release

`scripts/validate-docs.mjs` gates everything mechanically checkable — flags,
exit codes, numeric caps, profile names, model ids, version parity,
`security.txt` freshness. It cannot check sentences.

The claim that motivated this file was "Tarjan's algorithm enumerates every
strongly-connected component" on `/docs/how-it-works`. `dag.ts` uses Kahn's
algorithm and there is no Tarjan implementation anywhere in the repo. No
regex catches that; it is an adjective attached to a real subsystem.

## What this means in practice

At each release, read the doc page next to the code it describes. The pages
that carry the most load-bearing prose:

- `/docs/how-it-works` — the three guarantees (FK planner, safety guard,
  single transaction). Highest risk: it explains *mechanisms*.
- `/compare` — competitor claims age without anyone touching the repo.
- `/security` — timelines and posture.
- `/pricing` — tier contents, especially anything marked `(planned)`.

## Known live gap

Three Team features on `/pricing` — shared team profiles, CI mode, audit log
— are marked `(planned)` and do not exist in the CLI. That labelling was a
deliberate choice, not an oversight. Whether to build them, drop them, or
define an actual support SLA (`/compare` previously advertised one that was
never published anywhere) is a business decision, still open.

## Live gap found 2026-11-13

`/blog/generated-columns-are-load-bearing-now` (2026-07-13) shows
`satus plan --schema public` output and links `satus plan` to /quickstart.
There is no `plan` command, and the post has no correction note, unlike
the 2026-06-17, 2026-06-22 and 2026-07-17 posts. Content fix, not built.
