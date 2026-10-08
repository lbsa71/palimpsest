# Provider boundary (P03 / P10)

This work item implements a stateless text-completion interface shared by normal
work, successor conversations, and fresh review. It supports the application
default, Mistral, and an explicitly selected local Codex CLI. A provider response
is evidence to validate, never permission to run code or release a candidate.

## Specification

- A request supplies system instructions, prompt, optional JSON schema,
  cancellation signal, and output token limit. Every request is independent.
- Configuration supplies an explicit model and credentials appropriate to the
  selected provider. Missing configuration is unavailable; there is no fallback.
- Report provider, model, and known input/output tokens. Missing or invalid usage
  stays `null`, never zero. Neither adapter estimates money spent.
- Enforce time and byte limits, reject malformed/truncated/empty responses, and
  reject invalid JSON when structured output was requested. The calling work or
  review contract must validate the full schema and semantic meaning.
- Errors carry a stable classification, with safe messages that do not include
  credentials, remote response bodies, subprocess diagnostics, or prompts.
- The Mistral adapter performs one HTTPS request with redirects disabled and no
  automatic retries. An explicitly configured endpoint is an operator trust
  decision because it receives the key and prompt.
- Codex runs a fresh, ephemeral subprocess in a private empty temporary directory,
  never a candidate checkout. It uses no shell, no resumed conversation, and no
  inherited user configuration/rules. Tools, hooks, plugins, apps, browser,
  skills search, and project instructions are disabled. The subprocess is given
  only a small environment allowlist, plus an explicitly selected authentication
  home. Candidate code is never executed by this credentialed process.

Acceptance checks use deterministic HTTP and subprocess fixtures: request
encoding; missing keys; unknown usage; HTTP and protocol errors; timeout and
cancellation; body/output limits; fresh Codex contexts; failed/missing turn
completion; unexpected tool events; structured output parsing; and cleanup.
Live provider smoke checks are separate and require configured access. This
work item does not implement task persistence, review verdict policy, tool
execution, Slack, or automatic provider selection.

Dependencies: Node 24 native TypeScript, global `fetch`, and the authenticated
local Codex CLI when selected. Material risks: a provider may return convincing
but incorrect data; cancellation may occur after billable work; a CLI upgrade may
change the events or tool controls. These must never produce a fabricated pass.

## Verified interface references

On 2026-10-08, implementation was checked against the
[Mistral chat endpoint](https://docs.mistral.ai/api/endpoint/chat),
[Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode),
[Codex CLI flags](https://learn.chatgpt.com/docs/cli/reference), and
[Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference),
plus local `codex exec --help` and `codex features list`.

Mistral accepts the request token ceiling as `max_tokens`. Codex does not expose a
verified hard generation-token ceiling here: its bound is timeout/output bytes;
a requested token ceiling is checked against reported usage after generation.
That cannot prevent spending past a token target, and unknown usage cannot prove
that target was respected. Callers requiring a hard token ceiling must use a
provider offering one. Ephemeral execution suppresses Codex session persistence,
but does not promise that the remote service has no retention.

## API and configuration

`src/providers.ts` exports `Provider`, `CompletionRequest`, `CompletionResult`,
`ProviderError`, `MistralProvider`, `CodexProvider`, and `createProvider`.
`createProvider` requires a discriminated configuration with `provider` set to
`mistral` or `codex`; it never guesses a model. Configuration loading and secret
storage belong to the caller. Keep credentials outside the source repository.

```ts
const provider = new MistralProvider({ apiKey, model });
const result = await provider.complete({
  system: 'Answer the supplied question concisely.',
  prompt: 'What should this acceptance scenario demonstrate?',
  maxOutputTokens: 512,
});
```

Mistral defaults to `https://api.mistral.ai/v1/`, a 60-second deadline, a
1-MiB response ceiling, and 2,048 generated tokens. Codex defaults to executable
`codex`, a 120-second deadline, and a combined stdout/stderr limit of 1 MiB. Its
final file has a separate 1-MiB ceiling. Both accept configured `timeoutMs` and
`maxResponseBytes`. All requests cap system/prompt/schema data together at 1 MiB.
Codex `codexHome` selects an authenticated CLI home; otherwise existing
`CODEX_HOME` or `~/.codex` is used without reading credentials in this adapter.

The stable error codes are `configuration`, `unavailable`, `rejected`,
`protocol`, `timeout`, `cancelled`, and `limit`. HTTP status may accompany an
error. No response body or stderr is included. `unavailable` and `timeout` do
not establish a worker defect and must not cause executable rollback.

## Evidence

`node --test test/providers.test.ts` establishes deterministic behavior including
real local subprocess timeout, cancellation, output overflow, and missing
executable cases. The test was first observed failing without the implementation;
additional limit checks were observed failing before their fixes. Fifteen checks
pass on Node 24.13.0. These fixtures do not assert real account/model access or
remote model quality. No live paid provider call was made by this work item;
configured smoke execution remains part of integrated seed verification.
