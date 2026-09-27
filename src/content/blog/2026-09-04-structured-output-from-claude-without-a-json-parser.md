---
slug: structured-output-from-claude-without-a-json-parser
title: Structured output from Claude without a JSON parser
description: How satus forces typed rows out of the Messages API with tool_choice, how that differs from OpenAI's json_schema, and the Anthropic feature that landed after we built ours.
date: 2026-09-04
publishAt: 2026-09-04T09:00:00-04:00
author: satus.sh
tags: [llm, anthropic, openai, structured-output, cli]
draft: false
---

A seed generator does not want prose. It wants an array of row objects whose keys match the columns it just introspected, with the right types, every time. The failure mode that kills tools in this category is the parse-and-repair loop: ask for JSON, get JSON wrapped in an apology, strip the fences, `JSON.parse`, catch, re-prompt, give up after three tries. Every one of those retries is billed.

satus does not have that loop for either provider, and the two providers avoid it in genuinely different ways. This post is about the difference, and about a third option that appeared after we shipped ours.

## The Anthropic path: force a tool call

There is no prose to parse if the model never emits prose. The request registers exactly one tool whose `input_schema` is the row schema, then requires the model to call it:

```ts
const body = {
  model,
  max_tokens: 4096,
  system: req.system,
  messages: [{ role: 'user', content: req.user }],
  tools: [
    {
      name: TOOL_NAME,
      description: 'Emit the requested structured rows.',
      input_schema: req.jsonSchema.schema,
    },
  ],
  tool_choice: { type: 'tool', name: TOOL_NAME },
}
```

`tool_choice: { type: 'tool', name }` is the forcing part. The model's reply carries a `tool_use` content block, and reading it is the whole of our deserialisation:

```ts
const toolUse = payload.content?.find(
  (b) => b.type === 'tool_use' && b.name === TOOL_NAME,
)
if (!toolUse) {
  throw new Error(
    `Anthropic returned no '${TOOL_NAME}' tool_use block (stop_reason=${payload.stop_reason ?? 'unknown'}).`,
  )
}
const parsed = toolUse.input as T
```

No `JSON.parse`. In a non-streaming Messages response the `tool_use` block's `input` is a JSON object inside the response body, not a string containing JSON, so by the time `fetch` has decoded the response the rows are already values.

We pin `anthropic-version: 2023-06-01` rather than floating, so a default flip upstream cannot reshape the response under a released binary.

Forcing is not free. The `tools` parameter injects a system prompt whose size depends on the `tool_choice` you pick, and forcing costs more than leaving it automatic. Anthropic [publishes the numbers per model](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview#pricing); for Claude Haiku 4.5, our default, `auto` and `none` cost 496 tokens while `any` and `tool` cost 588. We pay that 92-token premium on every batch, which at Haiku input rates is about $0.0001 per call. Worth it to delete a retry loop, but it is a real line item rather than a free lunch.

## The OpenAI path: constrain the response format

OpenAI solves the same problem one level up, by constraining the response itself:

```ts
response_format: {
  type: 'json_schema',
  json_schema: {
    name: req.jsonSchema.name,
    schema: req.jsonSchema.schema,
    strict: true,
  },
},
```

`strict: true` is what makes this worth using rather than a politely worded request. But the delivery differs:

```ts
const content = payload.choices?.[0]?.message?.content
if (!content) throw new Error('OpenAI returned no content')
parsed = JSON.parse(content) as T
```

`message.content` is a string. Schema-conformant, reliably parseable, still a string. One `JSON.parse` on our side.

## Both, side by side

Running the two shipped providers against a local stub that replies with each API's documented response shape. The stub is a small `node:http` server, so this is a real transcript of our code exercising both request builders, not of the live APIs:

```text
  anthropic request  tool_choice = {"type":"tool","name":"emit_rows"}
  anthropic request  tools[0].name = emit_rows
  openai    request  response_format.type = json_schema
  openai    request  strict = true
  anthropic response content[0].input  -> object (object, used as-is)
  openai    response message.content   -> string, JSON.parse required
  anthropic data: {"rows":[{"id":1,"email":"ada@example.test"}]} usd: 0.007392
  openai    data: {"rows":[{"id":1,"email":"ada@example.test"}]} usd: 0.000912
```

Same 842 input and 1310 output tokens through both, priced from the same per-model table: `claude-haiku-4-5` at $1/$5 per million and `gpt-4o-mini` at $0.15/$0.60. The eight-fold gap is the rate difference, nothing else.

The practical distinction is where the boundary of "this might fail" sits. On the OpenAI path a malformed body is caught by our `JSON.parse` and surfaces as a parse error. On the Anthropic path there is no parse to fail, so the equivalent failure is structural: no `tool_use` block came back at all. That is why the error names `stop_reason`. When this fires in practice it is almost always `max_tokens`, meaning the model was cut off mid-tool-call, and the fix is a smaller `--batch-size` rather than anything about schemas.

There is a second asymmetry, and this one is ours rather than the APIs'. Look again at the two request bodies: the OpenAI side sets `strict: true`, and the Anthropic side sets no equivalent. So one provider is schema-guaranteed and the other is schema-shaped: forcing the call guarantees we get a `tool_use` block, not that its `input` satisfies every constraint in `input_schema`.

Anthropic does support [strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use), so the obvious conclusion is that we are leaving a guarantee on the table. We assumed that too, right up until we read what strict mode actually accepts.

It compiles your schema into a sampling grammar, which means it only accepts [a subset of JSON Schema](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) and returns a 400 on anything outside it. Our row schema uses four things in that excluded set:

```text
  maxLength                     on every string column
  maxItems                      pins a batch to exactly N rows
  minItems: N                   only 0 and 1 are permitted
  {"type": ["string", "null"]}  nullable columns; unions unsupported
```

Turning `strict: true` on would not tighten anything. It would fail every request we make. The official SDKs paper over this by stripping unsupported constraints out of the schema and appending them to the field descriptions as prose; we call `fetch` directly, so nothing strips them for us.

That reframes the asymmetry entirely. It is not laziness on our side, it is the price of sending a genuinely constrained schema: OpenAI's structured outputs accept all four keywords, Anthropic's grammar compiler does not. Opting in would mean maintaining a second, weaker schema for one provider, and trading real constraints for a guarantee that the constraints are followed. We would take that trade if we ever saw the model violate the schema in practice. The validator that re-checks every generated row against live database metadata has not caught it doing so.

## The option that appeared after we built this

The comment at the top of our Anthropic provider says:

```text
Structured output: Anthropic does not support OpenAI-style
`response_format: json_schema`. We use **tool-use forcing**
```

That was true when it was written. It is not true now. Anthropic ships structured outputs through `output_config`:

```json
{
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": { },
        "required": [ ],
        "additionalProperties": false
      }
    }
  }
}
```

Per the [structured outputs documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), the supported list includes `claude-haiku-4-5-20251001`, which is the family our default model resolves to. So this is not a feature we are locked out of; it is one we have not moved to.

We are not switching this week, and the reason is narrow rather than principled. Tool-forcing works, it is exercised on every Anthropic run we make, and it costs us zero parsing. Moving to `output_config.format` would mean re-verifying the `--max-cost` accounting against a response shape we have never measured, and re-testing the truncation behaviour that currently surfaces as a missing `tool_use` block. That is a release's worth of work to arrive at the same rows.

What we have done is fix the comment, which asserted something about another company's API in the present tense and had quietly gone stale. That is the same failure mode as the pricing table this provider used to carry: [empty from v0.3.0 through v0.3.6](/blog/v0-3-7-release-notes), so every Anthropic run fell through to a fallback rate three times the real one.

If you are choosing between the two approaches today, the honest summary is that they converge. Forced tool use gets you an object with no parse step and works on every model that supports tools. Structured outputs get you a schema-constrained response and read more naturally when you were never going to execute a tool. Neither needs a repair loop, which is the only property that actually mattered.

## Sources

- [Anthropic: structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic: tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview), including the per-model tool-choice token table
- [Anthropic: strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use)
- [OpenAI: structured outputs](https://platform.openai.com/docs/guides/structured-outputs)
- Our implementations: `packages/cli/src/generate/providers/anthropic.ts` and `openai.ts` in [PasskeyBridge-LLC/satus](https://github.com/PasskeyBridge-LLC/satus)
