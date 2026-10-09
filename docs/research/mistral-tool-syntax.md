# Mistral tool invocation syntax

Status: source assessment, 2026-10-09, supporting P17.2–P17.4 and [ADR 0019](../adr/0019-coding-autonomy-and-reusable-agent-plumbing.md). The user asked which invocation syntax Mistral is most comfortable with. Native support is established below; comparative model preference is not. No provider call, allocation change or new tool implementation was performed for this assessment.

## Established interface

The [documented configured model](../runbook.md) is `mistral-large-2512`; Sol confirmed that identity from its existing latest author-call evidence. The [official Large 3 model card](https://huggingface.co/mistralai/Mistral-Large-3-675B-Instruct-2512) demonstrates structured function calling. The adapter experiment's synthetic `mistral-small-latest` setting and mocked responses establish no model's proficiency.

[Mistral's function-calling guide](https://docs.mistral.ai/studio/conversations/function-calling) defines tool advertisement through `tools` entries with `type: "function"`, a name/description and JSON Schema parameters. Responses carry `assistant.tool_calls`; each function has a name and JSON-encoded argument string. The host returns a `role: "tool"` message correlated by `tool_call_id`, and includes the preceding assistant call in subsequent history. Plain response JSON mode is a different interface.

Use the native API fields. Mistral's [tokenizer documentation](https://github.com/mistralai/mistral-common/blob/main/docs/usage/tokenizers.md) describes dedicated control tokens; typing their visible spellings into an ordinary prompt does not create those token IDs. Hosted inference owns that encoding. A custom XML, Markdown or text-command wrapper has no demonstrated advantage here.

Illustrative native response entry for a proposed edit tool, not a currently installed Palimpsest tool:

```json
{
  "id": "Ab3Cd4Ef5",
  "type": "function",
  "function": {
    "name": "edit",
    "arguments": "{\"file_path\":\"src/add.ts\",\"old_string\":\"return a - b;\",\"new_string\":\"return a + b;\"}"
  }
}
```

The model supplies ordinary argument values; API JSON serialization accounts for the escaping shown here. Validate before dispatch. Keep raw arguments as bounded evidence separately from parsed transcript values: the selected adapter stringifies prior `tool-call.input`, so replaying an already encoded string would double-encode it. Tool error results need an explicit safe failure payload; the adapter does not add a separate wire error flag. Schema forwarding likewise does not prove provider support for every JSON Schema keyword or strict mode.

## Editing representation

Mistral's own Vibe uses [native function-call messages](https://github.com/mistralai/mistral-vibe/blob/v1.0.0/vibe/core/llm/backend/mistral.py). Its launch version used [search_replace](https://github.com/mistralai/mistral-vibe/blob/v1.0.0/vibe/core/tools/builtins/search_replace.py) with SEARCH/REPLACE blocks inside a `content` argument. The inspected newer [edit implementation at commit 7cb9189](https://github.com/mistralai/mistral-vibe/blob/7cb91894c40bb25173abcfa36e5ea2b4b81eb28c/vibe/core/tools/builtins/edit.py) uses `file_path`, `old_string`, `new_string` and optional `replace_all`. It rejects missing matches and rejects multiple matches unless `replace_all` is requested. These are different edit payloads within the same native invocation mechanism.

Simple structured exact replacement is therefore a reasonable initial candidate for Palimpsest, with clear flat schemas for reading, searching, writing and other file operations. This is an engineering inference from an official coding agent, not proof of the optimum for Large 2512. Vibe/Devstral evidence does not establish Large's training-specific tool names. Retain all required operations; familiar names do not imply adopting Vibe's permissions or runtime.

Workspace identity, authority epoch, reservations and durable operation IDs remain host-owned. Bind edits to the appropriate observed file revision; do not ask the model to calculate hashes. Line offsets, replacement multiplicity and error recovery must have explicit semantics. Keep the model-facing schema separable from the internal filesystem helper contract so syntax can improve without rewriting recovery.

## Comparative evidence still needed

Within an explicitly bounded configured allocation, compare exact old/new strings with SEARCH/REPLACE blocks or patches on the same native API and exact model. Use matched repository tasks and equivalent operation authority; hold context, sampling and output limits fixed, and record repetitions and uncertainty. Include quotes/backslashes, multiline indentation, Unicode, repeated text, stale reads and repair after a rejected edit.

Measure valid-call rate, correct first edit, independently tested final behavior, repair rounds and token usage. A syntactically valid but wrong patch fails. Account for every physical request and retain unknown usage honestly. Freeze the test cases before trials and record actual outcomes rather than inferring model preference from mocked adapter tests. This comparison may refine the default; it does not block implementation of the native function-call interface or basic workspace primitives.

Verification: primary documentation and pinned Vibe/adapter source were inspected; independent review resolved one match-semantics wording error. Nine local references across this note and its coding-specification reference passed, as did whitespace checks. These are source/documentation checks, not a model benchmark.
