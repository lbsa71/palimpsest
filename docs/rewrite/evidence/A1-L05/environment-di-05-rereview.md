# DI05 repair and driver floor integration independent re-review

2026-10-12. A1-L05-DI05, reviewer `/root/a1_environment_initiative_rereview`; branch `codex/a1-environment-di-05-rereview-20261012`, frozen joined base `4d795f3`. Exclusive writes are this evidence and new `deployment/environment-di-05-rereview.test.ts`. All production source and existing tests are read-only. Governing inputs: AGENTS, REQUIREMENTS, PLAN, workflow, L05 lane, DI plan, DI01 and final execution claim. Actual finite goal created before investigation.

```text
/goal Independently review the DI05 operation/cleanup repair and exact driver floor fixture integration at 4d795f3; add held-out causal checks, run unchanged 52 plus the exact driver preparation case and strict compilation, and return accepted or changes required in the two assigned files without repairing source or waiting for repair.
```

## Criteria frozen before source and test inspection

1. Every outgoing operation failure, including a failure inside an existing catch and any thrown non-Error value, survives cleanup. Single operation or cleanup failures retain exact identity; simultaneous failures expose both values in operation/cleanup order with the operation as cause. Caller-owned errors are not modified.
2. Existing handled execution and deferred-start flows retain their original successful control semantics. Cleanup failure must not misreport a handled value as a new operation failure. Setup failure must prevent entry, and timer cancellation, parent listener removal and latch release remain observable on terminal paths; later ticks remain usable.
3. Held-out cases use manual explicit environmental adapters and controlled actual Store transactions. Observe durable state, resource charges, cancellation and listener lifetime rather than merely matching error text. No new module/global mocking, sleep, physical process, network, provider, native comparator, credentials, Slack, deployment or full benchmark.
4. Independently compare the exact old and changed driver loop. The sole admissible expectation change is elapsed-floor metadata implied by DI03: max(previous floor, observed registeredAt minus original startedAt) on touched root/behavior ancestors, unchanged reviewer rows. Full grants, identity, caps, startedAt, cancellation and zero-dispatch/listener assertions must survive unchanged.
5. Run the unchanged 52 DI05/initiative checks serially, only the positively anchored driver construction case with its preexisting module-mock flag, new held-out tests, and strict compilation. Preserve failures and limits. DI14 application propagation, DI28 closure and H1 remain root gates.

Precode freeze committed as `1acf149` before implementation/test inspection.

## Disposition: accepted within the reviewed scope

Accept the DI05-R1 repair `3a61b0c` (joined as `2366c47`) and exact driver fixture integration `0e7c0bf` (joined as `06c02c4`) at frozen source `4d795f3`. No source or previous test was changed. The final commit containing these two assigned files is the handoff revision, reported to root with this record. Prior review `114f42c` and its preserved failure remain historical evidence; this review independently exercises the joined repair rather than changing that predicate.

The outer failure boundary captures the actual outgoing result of the entire previous body/catch. Its explicit boolean distinguishes an absent failure from a thrown `undefined`. Timer cleanup preserves sole failure identity or emits exactly `[operation, cleanup]` with `cause=operation`, without modifying caller-owned values. Deferred-start rollback still returns idle. Runtime-handled shell failures remain durable resumable state, not a fabricated new operation rejection. Cancellation remains once-only, late callbacks are closed before cleanup, and the listener/latch finally remains unconditional for the real AbortSignal boundary.

Nine held-out controlled-Store cases pass:

- Deferred start with successful cleanup rolls back the entire selection/admission snapshot and returns the exact idle result; with a frozen caller-owned AggregateError from cleanup, that same object is the sole rejection. Both permit a subsequent actual selection without consuming a prior slice.
- A runtime-handled shell Error remains recorded in execution state with a waiting goal. A simultaneous timer error remains the sole outgoing failure; neither frozen Error gains properties. There are no request rows and a subsequent tick observes backoff.
- A post-execution goal-event supplier throws a Symbol. The existing catch successfully blocks the goal and the aggregate retains that Symbol. A second variant makes the catch's own goal revision throw `undefined`: the aggregate correctly retains that actual outgoing value and cleanup Error. Both preserve the completed runtime, one consumed scheduler slice and zero requests; explicit termination followed by another tick demonstrates latch reuse.
- Synchronous timer firing plus cancellation failure composes both failures before any durable selection; late firing is inert and a restored timer permits entry.
- Setup throws an immutable non-Error object, then a preaborted signal carries `false`. Each sole value retains identity, with unchanged Store, no timer cancellation and no listener left attached; the next tick executes once.
- A manually fired quantum aborts a pending shell while concurrent tick admission is refused. Runtime persistence records the handled interruption; cleanup's object remains the sole rejection, late callbacks/parent abort cannot change state, and the next tick observes backoff.
- An actual resource hierarchy proves a new child only advances root/behavior ancestor floors. Full old allocation objects, including every envelope, identity, startedAt and cancellation field, remain equal except the exact floor. A fresh ledger at rolled-back wall time retains a previously persisted 7,000ms floor; later 9,000ms observation advances only touched ancestors, with reviewer and earlier-child rows unchanged and zero requests.

The catch-failure case deliberately observes the preexisting behavior that a failed durable blocked-state write leaves the goal running. This narrow repair does not alter that recovery policy or claim that failing persistence can commit a transition; it preserves the actual outgoing catch error, cleans up and permits subsequent host handling. No new blocking finding is attributed to the repair.

## Independent driver audit

The fixture creates root and role allocations at `issuedAt=base-5000`, captures the complete original values, then supplies `registeredAt=base-2000` through its synthetic clock. The driver constructs exactly the six non-reviewer applications. `DevelopmentAccounting.allocate` maps their child allocations under their original role allocations; `ResourceLedger.allocate` observes and persists the parent lineage's elapsed floor. This causally implies exactly 3,000ms for the root and behavior roles, with reviewer allocation floor 0. Read-only snapshots do not persist reviewer floors. The existing registration, deadline and resource assertions remain in production accounting.

The changed expectation retains `assert.deepEqual` on the complete allocation value, spreading every original field and overriding only `elapsedFloorMs` with `max(prior, registeredAt-startedAt)` on the touched ancestors. The type assertion does not remove runtime fields. An independent byte comparison replaced the new loop with the exact prior one and proved the entire file equal to `06c02c4^`. Thus original schedule length 126, six captured Stores, grants/caps/identity/startedAt/cancelled checks, no listening direct APIs, zero workers/provider payloads/physical requests and reviewer-access refusal remain unchanged and executed in the passing case. The earlier baseline 0/1 is preserved by the integration evidence; this review did not rerun a historical checkout.

## Commands and receipts

Working directory: `/home/palimpsest/migration/aeon-1-20261011/environment-di-05-rereview`. `node` below is exactly `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`. Dependency symlink points to `/home/palimpsest/src/palimpsest/node_modules`; no install. Commands ran serially.

| Command | Receipt | Observed result |
| --- | --- | --- |
| `node --test --test-concurrency=1 deployment/environment-di-05-rereview.test.ts` | `/tmp/aeon-di05-rereview-new.log` | 9/9 pass, 0 fail/skip/cancel, 0.744s |
| `node --test --test-concurrency=1 deployment/environment-di-05.test.ts deployment/environment-di-05-review.test.ts deployment/environment-di-05-repair.test.ts packages/initiative/test/initiative.test.ts deployment/environment-di-05-rereview.test.ts` | `/tmp/aeon-di05-rereview-joined.log` | 61/61 pass: unchanged 52 plus held-out 9; 0 fail/skip/cancel, 3.610s |
| `node --test --test-concurrency=1 --experimental-test-module-mocks --test-name-pattern='^prepare binds six actual application Stores and unchanged original allocation anchors with zero dispatch/listeners$' evaluations/development/development-driver.test.ts` | `/tmp/aeon-di05-rereview-driver.log` | Exactly 1/1 pass, 0 fail/skip/cancel, 2.028s |
| `node node_modules/typescript/bin/tsc --noEmit` | `/tmp/aeon-di05-rereview-strict.log` | Strict compilation passed, no diagnostics |
| Read-only Python byte comparison using `git show 06c02c4^:evaluations/development/development-driver.test.ts`; compare runner and all five prior test files against `4d795f3`; `git diff --check` | Session tool receipt | Outside-loop identity and unchanged-source/test identity passed; whitespace check passed |

No new review-test failures occurred. Existing production-timer and fixture Pi/runtime behavior ran only as part of the explicitly required unchanged initiative suite. New tests use manual timers and explicit clocks/IDs with controlled temporary SQLite; no new global/module mock. The driver retains its preexisting in-process worker mock, with zero worker dispatch verified. No full driver, physical worker, network, provider, native comparator, private credentials, Slack, full benchmark or deployment was run.

This is fresh component/fixture integration acceptance, not full application DI propagation or environmental closure. DI14, DI28, live developmental qualification and H1 remain root gates. Root owns integration and central status updates; no repair wait is needed for this completed finite review.
