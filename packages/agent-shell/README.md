# Selected Pi agent shell

`createAgentShell(options)` implements C1 `ShellPort`. Node 24.13.0 and the project TypeScript/TypeBox lockfile are required. `model` defaults explicitly to `mistral-large-latest`; deployment should pin a concrete qualified model revision. This identifier is a routing default, not a live competence claim.

The selected source is ordinary editable source in `vendor/pi`. The loop itself is retained from Pi commit `89e5c2c075535e2f427c30fc74720d65b2944ff9` with only import redirection. See the MIT notice and `experiments/agent-shell/audit/source-manifest.json`. No provider SDK, OAuth path, coding application, UI, catalog refresh or Pi durable package is loaded. The source-owned narrow JSON Schema validator supplies strict argument validation; TypeBox is removed. See [ADR 0033](../../docs/adr/0033-source-owned-json-schema-validation.md) for scope, licensing and the intentional rejection of coercion.

The host resolves each supplied prompt fragment, with its exact digest and audience checked before assembly. All historical system layers are replaced with that current manifest. Tool declarations belong to the host and are captured in every final request. The transport uses Mistral's [documented chat completions endpoint](https://docs.mistral.ai/studio/conversations/chat-completion) and [tool message protocol](https://docs.mistral.ai/studio/conversations/function-calling); it consumes complete JSON responses, including native thinking chunks, rather than token-by-token SSE. Pi still performs real model → tool observation → model iteration. Unsupported response formats fail closed.

Every physical attempt follows `capturePrompt → reserve → dispatched → fetch → settle`. There are no SDK retries, redirects, WebSockets, implicit provider fallback or network/catalog discovery. Only explicitly configured HTTP 429 retries run, each with its own reservation. Network/5xx/abort-after-dispatch outcomes retain uncertain usage; credentials and provider error bodies never enter audit payloads. Cost remains unknown unless the host provides authoritative settlement pricing; Pi's zero-valued convenience cost fields are not accounting evidence.

`bridge.execute` is the only tool executor. It must enforce authority, journal intent, deduplicate completed stable call IDs and reconcile unknown effects before another dispatch. Complete assistant tool calls are checkpointed before execution. An unresolved effect halts the loop and stays pending. Recovery calls the same receiver with the durable step/call identity. Checkpoint artifacts use C1 canonical JSON SHA256; `observationIds` must match the saved content. Current goals, memory and obligations remain host-owned.

Compaction is opt-in, using a host-supplied instruction artifact and the same counted transport. Context cuts preserve adjacent assistant/tool-result transactions. Steering is polled by Pi's retained queue hooks. Delegation is an ordinary declared tool handled/accounted by the host; this package does not start unaccounted child models.

Run `npm run check`, `npm test`, and `npm run build` after integration into the root workspace. For a focused network-free extraction/edit/load qualification after dependency provisioning:

```sh
node experiments/agent-shell/qualify-source.ts
```

That operation builds a clean temporary closure, runs retained regression cases, changes a vendored function in the candidate, rebuilds/retests, and loads the changed output in a fresh Node process. It records measurements without altering the active source. Actual supervised production successor activation and rollback remain L09 acceptance gates.

Reasoning effort is explicit: `modelProfile: { contextWindow, reasoning: true }` plus `reasoningEffort: "none" | "high"`. Unknown model context capacity is represented as zero rather than assumed. Complete native thinking/text chunks and metadata are retained in private checkpoints and replayed exactly on continuation, as required by the [Mistral reasoning protocol](https://docs.mistral.ai/studio/conversations/reasoning). Tool results link to durable assistant steps even when provider tool IDs repeat. Compaction stores its complete private response and only inserts summary text into the reduced context. This package publishes no model text automatically.
