# OpenAI default moved to gpt-6-luna in 0.3.13

**Status:** open, 2026-11-14 (item 1 done in #89)

OpenAI shuts down gpt-4o-mini, gpt-4o, gpt-4.1-mini and gpt-4.1 on
2027-01-14. #87 made gpt-6-luna the default and recorded the four
shutdowns in `packages/cli/src/generate/providers/deprecations.ts`.

## Still open

1. **Configs written by `satus init` before 0.3.13 pin the old model.**
   init wrote `"model": "gpt-4o-mini"` into satus.config.json, and the
   config wins over DEFAULT_MODELS. Done in #89 (2026-11-14): `satus
   generate` prints one stderr line with the shutdown date, where the id
   was set and the replacement (`shutdownNotice` in deprecations.ts).
   Published in 0.3.13 on 2026-11-15. A release-notes line would also
   help; that is content work.
2. **Keep deprecations.ts current.** It is read by hand from the provider
   pages. The roadmap item "model and price freshness check" (brief
   2026-11-09, section 8.1) would fail CI 60 days before a default's
   shutdown and when a price table's "Last verified" date is 90 days old.
3. **gpt-6-luna request shape** was verified live once (2026-11-13):
   `reasoning_effort: "none"` with `temperature: 0.7` and strict
   json_schema returns 200; without reasoning_effort, temperature 0.7
   returns 400. Other gpt-6 ids get neither parameter and were not
   called live.
