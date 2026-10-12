# Host timing dependency injection

2026-10-12. A1-L09/DI-T1, root finite implementation slice under the active Aeon1 goal. Isolated `environment-clock-injection`, branch `codex/a1-environment-clock-injection-20261012`, from the central claim. Own only narrow application/broker timing composition, new `broker-timing.test.ts` and this evidence. All old tests remain read-only. This applies the user's new whole-rewrite environmental DI requirement in AGENTS; it is not complete coverage of every environmental seam.

```text
/goal Inject host timing through application and broker composition, replace the driver's interim global clock mock through its separately owned adapter, preserve actual accounting/abort semantics and demonstrate deterministic causal checks for fresh joined review.
```

## Precode contract

Expose a narrow host timing dependency with `monotonicNow(): number` and `timeoutSignal(milliseconds): AbortSignal`. Accept it in application and broker options; capture function identities once when composing the host services. Production defaults use the actual monotonic clock and timeout facility at that composition boundary. Pure request handling calls the injected functions. Keep this dependency out of model/worker configuration, prompts and tool arguments. Do not add a general DI framework or service locator.

Read initial monotonic time before physical entry and require a finite nonnegative reading. Completion must use a finite reading no earlier than the initial reading. Preserve acquired response bytes and conservative unknown charges if the timing dependency throws or regresses; a time failure cannot silently produce elapsed0 or bypass draining/settlement. Explicit deterministic fake clocks/timeouts may model these cases in tests. Real per-request grants, unknown reservations and overrun cancellation remain enforced; dependency injection does not grant a candidate control of its budget.

Acceptance uses existing in-process worker/broker mechanics, actual retained request/receipt/resource state and new deterministic timing functions. Cover known response elapsed accounting, abort from the supplied timeout signal, an elapsed overrun cancelling the original budget, timing failure/regression with unknown charge retained, and caller mutation after composition unable to replace accepted functions. Preserve all existing provider model/tier, response-retention and source/current-use tests. No physical child, network inference or real account is needed.

Root's separately owned b3a fixture currently passes with an interim global monotonic mock; replace it after this API compiles. The actual diagnostic established6,966.853ms elapsed versus a5,000ms reservation and correct root cancellation. The new fixture injects its clock before preparation and must still hold the full original uncertain5,000ms charge. It cannot claim actual elapsed qualification.

Run focused old broker tests and new timing checks, strict compilation and diff. Fresh review of the joined recorder/driver/timing source remains required. Other ambient wall clocks/timers, random IDs, filesystem/database constructors, processes, environment and network seams need a separately owned inventory and incremental refactors; no global mock may be presented as completing that requirement.

Precode supplement: supply the existing `runWorker` function contract as an optional captured host adapter in broker/application options too. This keeps the new timing tests in-process through explicit DI without introducing another module monkeypatch. Its default remains the existing physical runner at composition. This does not refactor that runner's own environment, qualify synthetic clocks or expose a worker-controlled option. Driver forwarding carries both host adapters; future whole-environment tasks own process internals and wall-clock/lifecycle dependencies.

First new ten-case receipt:9pass/1fail,530ms; the only failure expected null for an absent Store row whose API returns undefined. Initial strict check correctly rejects the old exhaustive ApplicationOptions fixture missing the two newly declared optional adapters. Root extends only its fixture table with absent `brokerTiming`/`runWorker`; original assertions are unchanged, default adapters remain captured at composition without turning the absent public option into a present value. The new test's missing-row expectation is corrected; no production accounting predicate changes. Physical broker tests are not run in this window; in-process profile/provenance regressions cover the affected boundary.

Final authored timing source plus exhaustive-option fixture passes57/57 focused tests, zero failures/skips/cancellations,7.156seconds, with strict TypeScript and diff checks passing. Ten new explicit-DI timing cases cover retained real ResourceLedger state, finite/monotonic readings, timeout propagation/pre-entry abort, full unknown charges/raw response retention, overrun cancellation and captured timing/runner identities. The47 old cases cover in-process model/tier, provenance/retention, exhaustive application option reads, and resource accounting. Only the exhaustive fixture's two optional undefined entries change; all old assertion expressions remain unchanged.

Commands (pinned Node v24.13.0, existing node_modules symlink, no install):

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/broker-timing.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 deployment/broker-timing.test.ts deployment/mistral-profile-binding.test.ts deployment/mistral-profile-review.test.ts deployment/tool-instruction-retention.test.ts deployment/tool-instruction-review.test.ts deployment/development-controls-rereview.test.ts packages/runtime/test/resources.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Initial log `/tmp/aeon-broker-timing-first.log` and strict `/tmp/aeon-broker-timing-strict-first.log` preserve the construction failures at00135b1; final `/tmp/aeon-broker-timing-joined.log` and `/tmp/aeon-broker-timing-strict-final.log` retain complete receipts. New source and test code uses no additional dependency or global/module mock. Existing real Store construction and old fixtures still have separate environmental coupling; this narrow task does not claim whole-system DI, wall-clock/lifecycle qualification, physical confinement or H1. Fresh review and b3 driver forwarding/fixture replacement follow exact integration.
