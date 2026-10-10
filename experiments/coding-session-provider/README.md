# P17 general native single-step coding provider fixture

Status: local testable work item implemented and fixture-verified, 2026-10-10. Fifty-four synthetic checks and strict source/interface typechecking pass. This extends the selected [ADR 0019](../../docs/adr/0019-coding-autonomy-and-reusable-agent-plumbing.md) adapter boundary for the durable coding-session host. It is fixture-only code, with no production dependency installation or live compatibility claim.

Problem: the selected baseline advertises one fixed read function, model and synthetic credential. A general coding session needs trusted model/credential/catalog configuration and completed read/command/failure history while keeping the SDK protocol behind Palimpsest-owned records.

Expected behavior: one request returns validated text or raw function intents, with no effects, loops, retries or automatic repair. Caller-owned configuration supplies the model, credential, function descriptions, JSON schemas, synchronous semantic validators and finite limits. Strict text/function history pairs every ordered unique native nine-character call ID with exactly one matching named success/failure result. The host supplies result provenance; accepting a transcript's shape establishes no authority. Original argument strings survive storage and native request serialization.

Acceptance criteria:

- RED fixtures precede implementation. Real pinned SDK conversion, with synthetic native Mistral responses, advertises a general command/read catalog and respects caller model/key/limits.
- Independent single-step calls continue a completed failing-command/repair transcript, including exact raw argument strings and ordered, globally unique IDs within supplied history and response.
- Invalid configuration, unsupported messages, malformed arguments, unknown tools, mismatched/orphan/incomplete results, duplicate IDs, excess history/catalog/intents and contradictory finishes are rejected at the proper boundary.
- Current preauthorization and physical-request reservation veto dispatch. Reservation binds the exact final UTF-8 body, model, bytes and hash. Physical transport receives `redirect: 'error'`; redirects, errors and aborts never retry.
- Request/response bytes, output tokens and deadline are finite. Cancellation settles independently of an uncooperative transport/hook/reader and disposes late bodies. Provider details, prompt, credential and thrown private causes never enter safe errors.
- Usage is known only for coherent explicitly reported safe counts. Sparse/malformed usage fails the step with unknown spent usage; the pinned SDK can reject sparse wire usage as a sanitized provider parse failure before facade validation, while invalid parsed counts produce `invalid-usage`. Coherent counts survive later intent/finish failures. Strict typecheck and meaningful fixtures run against the existing selected dependency closure; inventory records exact pins, source hashes and verification limits.

Non-goals: durable session state, authority grants, workspace execution, host result provenance, root dependency/build packaging, retained environments, live requests, network access, credentials, release admission, installation or publication. The host owns every effect and current resource reservation. A transcript alone cannot establish authenticated source, current epoch, durable effect identity or IDs excluded by context truncation.

Dependencies: Node 24.13.0, the already-installed selected `@ai-sdk/mistral` 4.0.62 / `@ai-sdk/provider` 4.0.26 / Zod 4.6.5 experiment closure, and the root TypeScript 7.0.2 / Node 24 declarations. Material risks: protocol upgrades change conversion behavior; request cancellation does not undo remote billing; the trusted transport can allocate one oversized chunk before the facade checks it; validator callbacks are trusted local code and must be synchronous and bounded.

Remaining gates: retained-environment/dependency continuity and separately staged production installation, production static/build/isolated-artifact verification, provenance-bound durable host integration, current receiver authority and peer isolation, independently reviewed frozen admission, and separately authorized actual-provider conformance. Synthetic fixtures complete none of these gates.

## Port and bounds

[contracts.ts](contracts.ts) exports `CodingProviderPort`, `CodingStepInput`, `CodingStepResult`, `CodingMessage`, `RawToolIntent`, `ToolOutcome`, `Usage`, `CodingToolDefinition`, `CodingProviderLimits` and `TrustedCodingProviderOptions`. These contain only Palimpsest records, standard JavaScript values and trusted host hooks; no SDK type appears in the public port. [facade.ts](facade.ts) exports `createCodingProvider(options): CodingProviderPort` and reexports those contracts.

Configuration supplies `model`, `apiKey`, `tools`, `transport`, `preauthorize`, `reserve` and optional limits. Each tool supplies `name`, `description`, a JSON-data `inputSchema`, and `validateArguments(value): boolean`. Acceptance requires exactly synchronous `true`; false, exceptions and asynchronous results reject the intent, with rejected promises contained. The schema advertises the tool; the validator checks arguments; neither grants execution. Catalog data and hook references are snapshotted at construction. Model input cannot replace any configuration field. Only leading system text, user text, assistant text/intents and ordered completed named tool results are supported. The host must authenticate every supplied result and retain operation/call identity beyond truncated context.

| Limit | Local fixture default |
| --- | --- |
| Catalog entries | 32 |
| Intents per assistant history step or returned step | 8 |
| History messages | 64 |
| History UTF-8 JSON bytes | 131,072 |
| Final request UTF-8 JSON bytes | 262,144 |
| Response bytes | 262,144 |
| Advertised output tokens | 512 |
| Deadline | 2,000 ms |

Overrides require positive safe integers; deadlines also fit Node's maximum timer range of `2^31-1` milliseconds. These are experiment defaults, not selected production policy. The facade validates arguments before dispatch and checks the pinned SDK's final model, advertised catalog, token cap and historical call order. It restores each validated original argument string before bounding and hashing the exact physical body. Reservation receives model, body bytes/hash and cancellation signal, without raw prompt or key. `not-sent` means no physical dispatch began; `uncertain` means transport dispatch was attempted and must not be blindly replayed or refunded.

Transport receives Fetch's `redirect: 'error'` plus the host signal. A returned 3xx or already-redirected response is also rejected. A trusted custom transport must actually honor this redirect policy; a synthetic assertion is not evidence that an arbitrary replacement transport does so. No automatic retry exists. Late bodies are cancelled; a deadline settles without waiting for a cancellation promise. Synchronous validator work must remain bounded by the trusted host because event-loop deadlines cannot interrupt synchronous code.

The [selected baseline](../coding-provider-adapter/README.md#usage-contract-provenance-and-remaining-limits) preserves the Mistral usage provenance conflict: its OpenAPI requires individual counts, while a generated client tolerates omitted counts. This fixture keeps the selected sparse-usage rejection. Known usage means coherent explicitly reported input/output/total counts, including actual zero, with validated optional cache metadata; it is not billing verification. Missing, sparse, malformed or inconsistent usage fails with unknown spent usage. Coherent counts remain known when later tool/finish validation fails. Optional missing cache data stays unknown; no cache/reasoning/audio/cost aggregates are invented.

## Fixture-only resolution and evidence

The ignored `fixture-sdk` symlink points at the **existing** installed closure in `/Users/stefan/.codex/worktrees/coding-autonomy-implementation/palimpsest/experiments/coding-provider-adapter/node_modules`. Explicit source imports use that symlink. The local `tsconfig.json` maps peer declarations to the same closure, so the checked V4 types do not silently resolve through absent production dependencies. No package was installed or changed for this increment, and neither the root package files nor root `node_modules` changed.

The selected lockfile SHA-256 is `b19be919f3f5ebb9a3d631c77472e33d074eef2115c1f4bc2476ff8df012925e`. [inventory.json](inventory.json) records actual installed package identities, integrity strings, licenses, lifecycle declarations, package tree hashes, key SDK source hashes, selected baseline hashes and this experiment's source hashes. [inventory.mjs](inventory.mjs) validates the lock/package identities and recalculates this receipt. The closure contains the selected nine packages: Mistral 4.0.62, provider 4.0.26, provider-utils 5.0.58, Zod 4.6.5, standard-schema 1.1.0, workflow serde 4.1.0, eventsource-parser 3.1.1, json-schema 0.4.0 and Undici 7.30.0. Retaining this external local closure is an experiment prerequisite, not production packaging or a retained-environment implementation.

Repeat from the repository root after resolving `experiments/coding-session-provider/fixture-sdk` to that already-installed closure:

```sh
node --test experiments/coding-session-provider/test/*.test.ts
node node_modules/typescript/bin/tsc --noEmit -p experiments/coding-session-provider/tsconfig.json
node experiments/coding-session-provider/inventory.mjs
```

The separate `serving/serving.test.ts` witness uses the actual admitted worker, Store, collector, filesystem/process receivers and this selected SDK adapter with synthetic transport. Run it explicitly with `node --test experiments/coding-session-provider/serving/serving.test.ts` after resolving the pinned fixture closure. Root TypeScript checks its SDK-independent interface; the normal `npm test` set requires no experiment SDK installation. These fixtures do not enable a production provider or establish configured-model competence.

The initial placeholder failed all 53 checks before implementation. Forty-one selected baseline fixtures were carried forward with trusted catalog/configuration and explicitly named tool results; twelve new fixtures establish the general native catalog, independent command-failure/read-repair continuation, exact historical strings, configuration immutability, current veto, bounded catalog/history/intents, strict correlation, leading system text and redirect policy. Root review then reproduced a rejected asynchronous validator crashing a disposable child process; the containment fix adds the fifty-fourth check. The final run passed all 54 on Node 24.13.0/macOS arm64. Strict TypeScript 7.0.2 with Node 24.19.1 declarations, exact optional properties and unchecked-index checks passed. `skipLibCheck` leaves upstream declaration validation outside this source/interface evidence.

RED/GREEN/check logs are retained outside Git at `/tmp/p17-coding-session-provider-red.log`, `/tmp/p17-coding-session-provider-async-red.log`, `/tmp/p17-coding-session-provider-green.log` and `/tmp/p17-coding-session-provider-check.log`. No runtime/serving/production milestone is marked complete by this checkpoint. No actual provider call, credential read, network access, production edit, installation or publication occurred.
