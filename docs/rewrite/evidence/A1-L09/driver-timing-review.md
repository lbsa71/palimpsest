# Independent driver and timing review

2026-10-12; A1-L09 finite review owned by `/root/a1_driver_timing_review`, isolated `driver-timing-review`, branch `codex/a1-driver-timing-review-20261012`, base `0d1cd9614e791e61b2052e24ece855cef6d9411c`. Actual finite goal created. Exclusive writes are this evidence and `deployment/driver-timing-review.test.ts`; all source and prior tests remain read-only. Governing inputs: AGENTS, REQUIREMENTS (RW10/RW15/RW16/RW19), PLAN, rewrite workflow, L09 lane, execution claim, author timing evidence through `e0f4c39`, b3 `620694a` (the brief's concatenated `b3620694a` denotes b3 + this revision), imports `c253c61`/`48ebbf7`, frozen recorder `a919d98`.

## Frozen independent criteria (before tests)

1. Capture host timing and worker function identities at driver/application/broker composition before operational callbacks. Caller mutation later cannot replace them; worker initial configuration and retained provider provenance do not serialize these capabilities. Inspect each composition boundary and run the existing actual driver capture predicate.
2. Initial monotonic readings must be finite and nonnegative, completion readings finite and no earlier than initial. Initial clock throw and timeout factory throw must prevent physical entry, retain a consumed reservation, and settle conservatively exactly once. Completion exceptions/invalid readings must retain authentic raw bytes and full unknown charges rather than release resources.
3. Worker failure/early completion while a physical request is pending must not finish the shell or settle prematurely. Drain through the actual completion; late authentic usage must survive authority withdrawal/cancellation. Timing failure in that race must retain raw bytes and unknown charges. No retries or duplicate physical calls/settlements.
4. Injected timeout/cancellation races may abort entry or the transport, but cannot discard an already acquired authentic response or overwrite its usage with worker advice. A measured one-millisecond overrun must cancel the original real ledger, with unchanged grants.
5. Mechanical b3 methods forward only to the recorder behind the close barrier; detached source admission reaches both preclaim and claim, refusals precede durable claim/application construction, selectors remain recorder-validated, and absent option behavior stays intact. This does not accept recorder semantics or its known pending-error taxonomy defects.
6. Inspect both authorized prior fixture adaptations against original diffs: only two `undefined` adapter entries in the exhaustive options table; only an explicit per-role fake transport clock for the original single pending-freeze opt-in. Preserve every original assertion, resource ceiling and grant. A synthetic zero clock proves fixture mechanics, never real elapsed qualification.

New probes use explicit worker/clock/timeout DI and controlled temporary real SQLite, no global/module patches. Run pinned Node24.13.0, strict TypeScript, independent cases plus meaningful selected prior regressions serially (`--test-concurrency=1`). Existing old regression module mocks are read-only. Do not repeat complete 56/57 aggregates absent causal need. No physical worker, native child, provider/network, private credentials, Slack, full benchmark, push or deployment. Whole environmental DI29, b2 pending classification, DC2 payload repair, semantic b2b and H1 remain separate open gates. Finish this review without waiting for them, preserving all observed failures.

## Inspection and causal results

The review checks exact unchanged source contents: application blob `1d5f95f0679ed032080c8c09dd81893738477dfe` and broker blob `52d2c6c38c958fb1d8e0641feebc2bb3ace51384` match `e0f4c39`; driver blob `ee82c089abbf1cfdbe96f65793a61ff9da31fbb8` matches `620694a`. Recorder `acquire.ts`, `source-admission-reservation.ts`, and `development-source-admission.ts` match `a919d98` exactly. A read-only comparison initially named a nonexistent `source-admission-recorder.ts`; that diagnostic exited1 after confirming the other paths. Correcting the inspection pathname confirmed all three actual recorder paths; no product check failed and no source was changed.

Driver `prepare` detaches source admission before its clock/verifier callbacks, captures each role's timing methods and worker function before invoking the clock or constructing applications, and supplies the detached admission to both plan verification and recorder claim. Application captures before authority/accounting callbacks and keeps these capabilities outside validated configuration. Broker captures before authority/fragment/worker callbacks, serializes only its worker configuration, and measures provider work with the captured functions. The five driver methods add only the close barrier and direct recorder delegation; the driver adds no signer, reader or semantic judgment.

Ten independent probes use a new small protocol worker plus actual SQLite and a real parent/child ResourceLedger. They demonstrate initial-clock and timeout-factory throws before transport entry; invalid final infinity/negative readings with retained exact raw response; worker loss and early worker completion while a gated transport remains pending; rejected premature settlement; late response after both worker abort and original-root cancellation; completion-clock failure after worker loss; timeout/worker cancellation racing authentic completion; and one-millisecond measured overrun cancelling the original parent budget. Pending transport keeps the shell unresolved and the reservation fully charged. Authentic late usage is charged exactly once even after authority withdrawal; advisory worker zeros cannot overwrite it. Unknown completion retains all original tokens/cost/5,000ms and concurrency. Raw bytes are read back from retained artifacts. All ten passed on their first run; strict passed on its first run.

The host-capability serialization probe checks the complete keys of worker initial state/options, not only that JSON happened to omit a function value. Callback poisoning after composition still reaches captured timing/runner identities. Existing actual application/driver poisoning adds the upstream composition witness and measures25ms in original accounting. Cancellation/early worker result status remains the worker result; these probes establish authoritative request state and draining, not a new application completion-policy contract.

### Prior fixture integrity

A byte-for-byte comparison against `48ebbf7^` reconstructs the entire old driver file by undoing exactly three substitutions: optional fixture argument, conditional per-role `brokerTiming`, and the single `fixture(t, true)` in the pending-freeze case. It equals the original file. The intermediate global `performance.now` patch in `620694a^` is absent from the final file. Every other fixture invocation, assertion, original allocation/grant, capacity and ceiling is unchanged. A second byte comparison against `c253c61^` reconstructs the entire exhaustive application-option file by removing only `brokerTiming: undefined, runWorker: undefined`; it too equals the original. Own/inherited option read counts and all original tests remain intact.

The freeze case deliberately measures synthetic zero transport elapsed; the broker/ledger retains uncertain5,000ms and original unknown resource charges. It is a valid deterministic fixture correction, not an elapsed-performance qualification. Independent root-overrun tests above and unchanged runtime-resource tests still enforce measured ceilings. Existing scheduler Date/module mocks and broader environment seams remain the adopted DI workstream's responsibility.

### Commands and receipts

All commands use `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` and the symlink to `/home/palimpsest/src/palimpsest/node_modules`; no install. Commands ran serially. Complete author57/driver56 receipts remain in their original evidence and were not rerun as redundant aggregates.

| Check | Result | Local receipt |
|---|---|---|
| New independent file |10/10, zero failures/skips/cancellations,1.291s|`/tmp/aeon-driver-timing-review-first.log`|
| Unchanged timing10 + exhaustive application5 + resource4 |19/19, zero failures/skips/cancellations,4.002s|`/tmp/aeon-driver-timing-review-broker-regressions.log`|
| Unchanged b3 actual source forwarding, refusal, captured timing/worker and closing |12/12, zero failures/skips/cancellations,28.410s|`/tmp/aeon-driver-timing-review-source-forwarding.log`|
| Selected absent-source-option old-driver/independent checks: captured options, unchanged anchors, late authentic shutdown, pending freeze, clock replacement and sample/close exclusion |6/6, zero failures/skips/cancellations,29.639s|`/tmp/aeon-driver-timing-review-driver-regressions.log`|
| Selected independent provider model/tier refusal after cancellation/worker loss and exact retained tool provenance reopened under both providers |5/5, zero failures/skips/cancellations,1.209s|`/tmp/aeon-driver-timing-review-provenance.log`|
| Strict TypeScript |pass|`/tmp/aeon-driver-timing-review-strict.log`|
| Diff whitespace and exact two-path ownership |pass|Git comparison against `0d1cd96`|

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/driver-timing-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 deployment/broker-timing.test.ts deployment/development-controls-rereview.test.ts packages/runtime/test/resources.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/development-driver-source-admission.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='prepare binds six|accepted callbacks, plain|shutdown drains late authentic|freezing an open actual|OD3 accepted synthetic clock|OD3 in-flight sample' evaluations/development/development-driver.test.ts evaluations/development/development-driver-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='Mistral independent review|host snapshot survives' deployment/mistral-profile-review.test.ts deployment/tool-instruction-review.test.ts
git diff --check
```

Name-pattern commands intentionally select the stated cases; other cases in those files were not rerun. Total executed here is52/52 across five bounded test commands, zero failures/skips/cancellations. No source/test repairs or suppressed failures were needed. The historical authored construction failures and mixed-clock freeze failures remain in the linked author evidence; this review does not rewrite those receipts.

## Disposition and handoff

**Accepted for the bounded driver/timing mechanics reviewed here.** No actionable defect was found against the frozen criteria. This independently accepts captured host adapters, conservative timing accounting/draining, b3's mechanical forwarding and the two exact old fixture adaptations at base `0d1cd96`. The new independent probes do not use module/global patches; selected historical fixtures retain their pre-existing mocks unchanged.

Hand off exactly the new `deployment/driver-timing-review.test.ts` and this evidence file from the final clean review commit; source is unchanged and remains identified above. The actual finite review goal ends here, without waiting for another lane. Root owns integration and any broader gate decision.

**Separate gates remain open:** the parallel b2a review's four pending-error classification reds require their own repair/re-review; DC2 current-original bridge payload repair and semantic b2b/control signing are not accepted by this driver receipt. Whole environmental DI29, physical confinement, native execution, provider/account/tokenizer qualification, real timing/autonomy/competence, deployment and H1 are neither tested nor claimed. Synthetic clock authority is trusted host composition, not live sensor attestation or candidate permission.
