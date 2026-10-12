# Shell and retained Pi environmental injection

Root DI06 under the active Aeon 1 goal. Claim/base `19b1777`, isolated `environment-di-06`. Exclusive paths are the shell index, both transports, new local environment module, retained Pi agent loop/types/stream-function module and AI types/diagnostics/event stream, new DI06 test and this evidence. Other source and all prior tests are read-only. DI06a schema interface is released; no schema change. DI26 exact Pi provenance and DI14 application forwarding remain separate owners.

```text
/goal Inject the environmental boundaries used by the actual shell, transports and retained Pi loop; preserve prompt ownership, native replay, durable request/tool accounting and causal recovery, and return exact source plus deterministic failure evidence for fresh review and separately staged source-manifest closure.
```

## Frozen behavioral design

Use a narrow local host environment with wall and monotonic callbacks, ID supplier and cancelable timeout scheduling. Existing explicit fetch, rotating API-key and host receiver callbacks remain usable but their function identities are captured once at construction. A named Node factory owns concrete globals; supplied adapters never fall back after failure. No general container, model-supplied function, mutable global default provider or hidden import-time observation. The retained loop requires its explicit stream function. The same captured clock reaches loop-generated system/tool messages, tool execution durations, assistant event streams and shell compaction/recovery timestamps.

Wall readings must be finite; monotonic readings finite, nonnegative and nonregressing. IDs must satisfy the original nonempty identity contract; injected repeated physical/step identities must not overwrite durable evidence. Each timeout is cancelled once on a terminal attempt, including failed setup/dispatch/read/settlement. Partial cleanup failures remain observable; no retry follows uncertain transport/cleanup or a failed settlement. Preserve explicit 429 retry ceilings and separate reservations for compaction.

Time is metadata and accounting evidence, never a reason to fabricate zero elapsed or successful work. Sample a request's starting clock before its reservation where possible. Failure after dispatch must settle conservatively as uncertain with unknown usage and the original reserved elapsed estimate, then block continuation; ResourceLedger retains its full original ceiling for uncertainty. A failed clock cannot refund that reservation even when provider usage was returned. Preserve native responses and existing provider redaction boundaries; no raw secret-bearing exception is exposed to the model.

Retained event streams must not strand a final result or iterator if an injected clock throws. If a host infrastructure failure cannot produce a trustworthy timed protocol message, propagate that failure through an explicit stream failure path; distinguish this from ordinary provider failures, which remain error/aborted protocol messages. Low-level asynchronous loop wrappers must terminalize that failure. Tool timing failures cannot silently become successful observations or trigger a second execution; cleanup/update drain and simultaneous failure identity require causal checks. Existing upstream stream sequencing and untimed forwarded-message behavior remain unchanged.

## Planned acceptance

Use controlled Response/ReadableStream transports, explicit fake clocks/manual schedulers and real retained loop calls without global/module mocks or wall sleeps. Test two independent instances and callback mutation after construction; wall/monotonic failures/regression before and after reservation; timeout/parent abort and cleanup failure; retry/compaction reservation count; deterministic durable step and recovered-tool identities; native replay; event stream terminal failure and no hanging iterator/result; tool-duration failure and subsequent dispatch refusal. Preserve all existing shell, provider, schema and upstream stream regressions. Run serial focused checks and strict. No network/listener/provider/native/confined process/privatecredentials/Slack/full benchmark/deployment. Exact local vendor changes must be supplied to DI26 before fresh acceptance.

## Authored implementation and verification

Precode `1f0dafb`. `ShellOptions` and both transport option surfaces accept host-only `environment?: ShellEnvironment` with wallNow/monotonicNow/newId/scheduleTimeout. Named Node factories own ambient calls. Environment and existing fetch/key/reserve/dispatched/settle callback identities are captured at composition; the rotating key callback is still invoked per attempt. Retained AgentLoopConfig and RunToolCallOptions accept an explicit clock; AssistantMessageEventStream and its factory accept one too. Diagnostic construction accepts its fourth wall callback. No environment enters provider options, serialized messages, prompts or wire schemas. No provider-default singleton remains.

Each response is consumed to EOF or cancellation is attempted, and each acquired lock and timeout is released once. Failures preserve original values and ordering through cleanup/settlement; cleanup uncertainty prevents retry. Injected identity collisions cannot reuse a request or overwrite an assistant step. Request start timing precedes reservation; invalid final timing records unknown usage and uncertain status using the original reservation estimate, then stops continuation. Actual ResourceLedger tests verify full original tokens/cost/elapsed ceilings and outstanding concurrency remain charged. All original owned prompt and native-response parsing rules remain.

Retained streams have a terminal host-failure channel observed through result and iteration, including thrown undefined. Low-level wrappers forward rejected loops to that channel. Tool observation timing drains updates; parallel tool batches drain all started children before reporting failure. No tool is retried by these paths. Already timed/deferred assistant messages retain original behavior.

Final new29 plus unchanged44 shell/provider/schema/upstream-stream tests pass **73/73**, zero failures/skips/cancellations, 1.769s. Strict compile and diff pass. Commands:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-06.test.ts packages/agent-shell/agent-shell.test.ts packages/agent-shell/openai.test.ts packages/agent-shell/schema-regression.test.ts packages/agent-shell/upstream-event-stream.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Receipts: `/tmp/aeon-di06-expanded.log` and `/tmp/aeon-di06-final-strict.log`. The unchanged upstream tests retain their original small real timer waits; all new cases use manual adapters and no sleeps. Existing tests and every path outside the twelve claimed source/test/evidence paths are unchanged. An ambient-call inventory leaves Date/performance/randomUUID/timer/fetch references only in the named environment factory and inert type/comments. This inventory is not a whole-repository DI proof.

Preserved development receipts: first partial-source strict failed two tool-duration type-narrowing errors (`/tmp/aeon-di06-initial-strict.log`); explicit non-null annotations reflect the guarded timing-failure exit. The next source strict passed. Initial unchanged44 passed (`/tmp/aeon-di06-old-initial.log`). First new25 returned24/25 (`/tmp/aeon-di06-new-initial.log`): new compaction fixture used nonexistent prompt owner `compaction`. Its strict run also reported missing update details, an intentionally untyped stored JSON cast, and an assistant-only annotation for a mixed transcript (`/tmp/aeon-di06-new-strict.log`). Corrected only the new fixture to valid owner `shell`, required details and truthful transcript types;25/25 then passed (`/tmp/aeon-di06-new-corrected.log`). Four further causal checks bring final new29. No old assertion, cap or production failure was weakened to address fixture mistakes.

## Exact downstream responsibilities

DI26 must update the six changed retained Pi hashes and patch rationale, preserving every original upstream hash/license/test fixture. A complete pinned-upstream delta can be generated from the existing `/tmp/pi-shell-audit-20261011` checkout at89e5c2c; no source/network fetch is required. Retained loop is now intentionally patched for environmental injection and terminal failure/drain behavior, so “otherwise verbatim” claims must be removed from current metadata/README. Those files are outside this author claim and remain untouched here.

DI14 must capture and forward the exact environment from trusted application composition to in-process shell creation. DI21/25 worker entry roots must select their own Node environment or inject a host RPC adapter; callback objects must never be serialized as candidate options. Current production defaults remain named host construction facades. These bindings and full DI28 closure are not accepted by this component work.

Adapters must eventually settle read/cancel/host callbacks; no universal termination guarantee is claimed for uncooperative dependencies. No actual network, live provider, listener, physical child/native process fixture, credentials, Slack, benchmark, installation or deployment occurred. No live model/context qualification or H1 gate closes. Fresh consequential review of the exact source plus separately staged provenance remains required.
