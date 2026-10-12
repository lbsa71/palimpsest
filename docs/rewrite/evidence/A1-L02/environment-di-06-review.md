# Independent DI06 shell and retained-loop review

Review owner `/root/a1_environment_shell_review`, isolated branch `codex/a1-environment-di-06-review-20261012`, base `89c183b`. Read-only reviewed source `1667278`, provenance `abad092`, joined `d53ccda`; DI01 governs local captured ports. Exclusive writes: this evidence and new `deployment/environment-di-06-review.test.ts`. Actual finite goal created before code. Reviewer uses inherited fresh consequential-review context; no additional delegation is needed for this bounded independent review.

```text
/goal Independently challenge DI06 transport/environment/retained-loop behavior and verify immutable Pi provenance; preserve prior73 and new causal outcomes, strict and exact two-path handoff, concluding accepted or changes required without source repairs or waiting.
```

## Frozen precode cases

Exercise both providers with explicit reader/clock/manual timer/key/host callbacks. Verify asynchronous body cancellation and lock release finish before settlement/retry, reader acquisition/read/cancel/unlock failures cannot claim cleanup or cheap known settlement, key rotation and callback capture survive mutation, timer setup and caller abort refuse dispatch, and terminal timing failures remain observable through result and iteration. Challenge fail/end ordering and retained parallel tools with pending update work and non-Error failures. Check shell receiver capture at run entry, wall failures, and durable reservation preservation through the actual bridge; preserve author compaction/recovery/native/prompt/duplicate-ID regressions unchanged.

Independently read all ten pinned upstream objects from cached `/tmp/pi-shell-audit-20261011` at immutable `89e5c2c075535e2f427c30fc74720d65b2944ff9`, check original and retained hashes, apply complete local.patch with zero fuzz to fresh staged source, compare all bytes, and check six changed retained files, local metadata, license and unchanged upstream fixture. Run original73, held-out cases and strict serially with pinned Node24.13.0. Source, metadata, previous tests and qualification controls remain read-only. Explicit fakes and controlled in-process SQLite only; no module/global mocks or physical/network/provider/qualification/full benchmark/deployment actions. DI09 transaction-entry R1 and its two old storage fixture failures are separate, not shell review failures. DI14/21/25/26/28/live/H1 remain open.

## Disposition: changes required

Precode `47362e0`. Source and metadata match their exact author revisions byte-for-byte. The bounded review is complete; source acceptance is withheld for the following two findings, reproduced by four intentionally failing checks. No production repair or prior-test edit is included.

### R1 / P1 — OpenAI reader cleanup failure loses resource uncertainty

`packages/agent-shell/openai.ts:120` assigns `outcome.status = 'failed'` before `readShellJson`. That helper owns reader cancellation and lock release, and can reject after either fails. The transport's catch records this failure before its own finally block (`:138–144`), so its `beforeCleanup` comparison cannot detect those helper cleanup failures. Both read rejection plus rejected cancellation and successful EOF plus failed unlock settle as `failed`, not `uncertain`. Mistral passes the same cases because its outcome remains uncertain until parsing finishes. Neither provider retries these failures; the defect is settlement classification and accounting, not hidden retry.

The additional actual `ResourceLedger`/controlled in-process SQLite case demonstrates the consequence through the real shell: despite rejected response cancellation, the shell's blocked request releases outstanding concurrency from1 to0 and refunds its entire original elapsed ceiling50 to0. Tokens100 and cost1 remain charged. Expected uncertainty retains all four dimensions. No DI09 injected BEGIN fault is involved. Preserve cleanup error classification across the helper boundary and settle conservatively; do not classify genuine protocol-only failures as incomplete cleanup merely to satisfy these checks.

Failing cases: `openai: rejected reader cancellation remains uncertain after dispatch`; `openai: EOF unlock failure cannot earn known settlement`; `OpenAI cleanup uncertainty preserves actual ledger elapsed ceiling and concurrency`.

### R2 / P1 — Shell receiver identities remain mutable during execution

`packages/agent-shell/index.ts:54` retains the caller's mutable `ShellBridge`; later work repeatedly reads methods from it (`:123–135`, plus checkpoint/tool/recovery paths). A supplied `capturePrompt` callback can replace `bridge.settle` after run entry. The held-out case observes the replacement called once, the original settlement receiver called zero times, and shell status `completed`. Transport-level callback capture is correct but captures closures that still look up mutable bridge methods. This contradicts DI01's requirement to capture each supplied callback before caller callbacks and the authored host-receiver claim. Snapshot/bind the actual receiver operations at run entry before any host callback, preserving the receiver required by existing methods; test the full receiver family rather than only settlement.

Failing case: `shell captures receiver identity before caller callbacks`. This is host composition integrity, not an assertion that the model can mutate host callback objects.

## Runtime verification

The original73 pass unchanged (29 author plus44 prior), zero failures/skips/cancellations,2.061s. This includes full-charge handling for invalid final clocks, duplicate physical/assistant IDs, actual loop tool/compaction requests, recovery identity, native replay, prompt/schema rules and original upstream event-stream sequencing. New21 produce **17pass /4fail**, zero skips/cancellations,0.415s. Strict compile and diff check pass. No aggregate-green acceptance is claimed.

Independent passing checks cover both transports' captured settlement/reserve/dispatch callbacks; rotating keys across a manually blocked429 cancellation; awaited cancellation before settlement/retry; pre-dispatch caller abort and ID-supplier refusal; redacted settlement failure and no retry; exact operation/cancel/unlock failure identity and asynchronous cleanup; reader-acquisition cancellation; terminal stream failure after later end/push; actual retained tool operation/timing/update aggregate ordering; actual parallel-tool drain after a receiver failure; initial invalid wall refusal; and avoiding unnecessary/fabricated final wall reads for a completed response. New tests use explicit ports and manual promise gates, no timer sleeps or global/module mocks. The existing upstream tests retain their original short timer waits.

Commands run serially with pinned runtime:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-06.test.ts packages/agent-shell/agent-shell.test.ts packages/agent-shell/openai.test.ts packages/agent-shell/schema-regression.test.ts packages/agent-shell/upstream-event-stream.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-06-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Receipts: `/tmp/aeon-di06-review-prior73.log`, `/tmp/aeon-di06-review-new-final.log`, `/tmp/aeon-di06-review-strict-final.log`. Missing local dependencies were supplied by an ignored symlink to the main checkout's existing node_modules; no installation occurred.

Preserved new-fixture correction: the first run used throwing `afterToolCall` hooks as a supposed infrastructure rejection, but retained Pi intentionally converts hook failures into ordinary tool observations. Its fixture provider always returned more tool calls, producing an unbounded synthetic loop. The exact owned test child was stopped after25.25s; `/tmp/aeon-di06-review-new-initial.log` retains the failed process receipt. Only the new fixture was corrected to throw from `tool_execution_end` with a manually gated peer, making the intended infrastructure failure and drain finite. The corrected initial19 returned16pass/3red (`/tmp/aeon-di06-review-new.log`); adding ledger consequence and initial-wall refusal gives final21. All four final failures are preserved. Both strict runs passed; no source assertion or old test was weakened.

## Independent provenance verification

Receipt `/tmp/aeon-di06-review-provenance.log`. Independently used `git -C /tmp/pi-shell-audit-20261011 show 89e5c2c075535e2f427c30fc74720d65b2944ff9:<source>` for every manifest source, hashing the immutable object bytes with SHA256. All ten upstream hashes match both current and pre-DI06 manifests, all ten retained hashes match actual source, and cached HEAD matches the pinned commit. Fresh temporary staging of those ten verified original paths followed by `patch --batch --fuzz=0 -p1 -d <fresh-directory> -i <absolute-local.patch>` returned0 with no offset/fuzz; every resulting file equals retained source byte-for-byte. Patch SHA256 is `babe96b7eec2d28b53afa144c4569d32f7d5b599d0168b560c0618d038471d64`.

Exactly six manifest retained hashes changed from source1667278's old metadata: agent loop/types/stream-fn and AI types/diagnostics/event-stream. The local barrel and environment hashes match separate localFiles metadata. MIT license exactly equals pinned upstream bytes, SHA256 `0457f5bcec3b3b211605dfb5d1a49042fd638f3686a410fe099c24a25af13c48`. Original upstream event-stream fixture equals pinned upstream object and its declared hash; executed fixture remains byte-identical to source1667278. Retained-test metadata and upstream revision/license are unchanged. All fourteen checked source paths (four shell files plus ten retained files) match1667278; manifest, patch and README matchabad092. The current README truthfully describes local environmental dependency and intentional retained patches. No source auditor or qualification control was executed or edited.

## Handoff and limits

Root owns any separately claimed repairs for R1/R2 and the subsequent fresh review. Only this evidence and the new test are handed off; source, earlier tests, metadata and shared plans are unchanged. This finite review does not wait for repair. Full application/worker/entry forwarding, broad DI26 scripts and DI28 closure, live qualification and H1 remain separate. DI09's known transaction-entry R1 and two DI27-owned storage fixture failures are unchanged and not conflated with this review. No actual network/listener/provider/native/physical fixture/private credentials/Slack/full benchmark/qualification/install/deploy action occurred. As in the author contract, injected adapters must eventually settle; no termination guarantee is inferred for uncooperative host operations.
