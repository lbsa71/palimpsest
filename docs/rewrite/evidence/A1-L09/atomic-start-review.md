# A1-L03/L05/L09 independent atomic-start review

Fresh consequential review by `/root/a1_atomic_start_review`, under RW10, RW14, RW15, RW16 and RW19, of frozen integration `f6dd34179fb51519231f15d36fc06da08226ef5d`. This includes author change `8ee37928c71d4e3539b6ccc0812c9402012cad56` (child source `1cb37b5`) and root reservation/withdrawal wiring `f6dd341`. Worktree `/home/palimpsest/migration/aeon-1-20261011/atomic-start-review`, branch `codex/a1-atomic-start-review-20261011`. A finite goal was created without a token budget. Root retains lane/central status ownership and the final joined physical and aggregate verification gate.

## Disposition

No actionable production defect was established in the assigned atomic start and control-withdrawal integration. The review adds three behavioral regressions, with no production-code, policy, grant or dependency changes. This completes the finite independent component review; it does not accept the full lanes, product competence, autonomous operation or deployment.

Reviewed `DurableRuntime.prepareResume`/execution, initiative selection/runner, `prepareReview`, control reservation/continuation, controller transfer, authority withdrawal, and the narrow supervisor/dispatcher integration. The ordinary application's runtime gate is shared by direct and delegated resumes; initiative explicitly prepares the same claim. Eligibility and the durable `running` transition share the operational write lock. The reviewed host eligibility callback reads authority and operational state without acquiring an authority write lock, avoiding inversion with reservation and withdrawal's authority-then-operational order. The scheduler commits selection, execution identity, resource lineage and runtime claim together. No reviewed callback holds a database transaction over awaited cognition or physical review.

Reservation commits the activation record, exact probation context and original physical reservation together. A producer that starts first causes deferral with no reviewer reservation. Withdrawal rechecks exact activation identity, original authority, audience, allocation lineage, producer status and settled ordinary-tool acknowledgement under authority then operational locks. Guard refusal precedes transfer intent. Guard misuse tests cover skipped, duplicate, deferred, retained and throwing commits. These observations are bounded by the exercised synchronous host callbacks and actual SQLite/process checks; they are not a universal crash-atomicity claim across the separate authority, release and operational databases.

## Additional independent cases

1. Withdraw authority after the durable start claim but before cognition. Execution invokes no shell or physical request, retains late steering, and the same run resumes after explicit successor adoption without changing its allocation.
2. Throw during prompt preparation after initiative has claimed a new run. The scheduler slice, goal revision, newly created allocations, run and execution record all roll back. A later retry runs exactly one slice, without stranded in-memory ownership.
3. Refuse reviewer resources after the host activation callback has written its claim. Contended concurrency rolls back that claim and reservation metadata, preserving the existing physical charge. Once the existing work settles, the same unused review ID can reserve exactly once under the original parent allowance.

All three passed on the frozen integration plus test additions. No red production regression was discovered or suppressed; the original author's red cases remain documented in [control-start-gate](control-start-gate.md).

## Commands and observed results

Executed from the review worktree using Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (v24.13.0). The ignored `node_modules` link points to the integration checkout's trusted development closure; TypeScript reports 7.0.2. `package-lock.json` SHA-256: `cc2956d305c7bbb1be7d58bde7b1d257ff8329ca73d55d1cfb8ee92d2712efc0`.

```text
node --test packages/runtime/test/start-gate.test.ts packages/runtime/test/runtime.test.ts packages/initiative/test/initiative.test.ts packages/supervisor/authority.test.ts packages/release/controller.test.ts deployment/control-continuation.test.ts deployment/control-tools.test.ts deployment/evaluation-resources.test.ts
# Unmodified frozen integration: 73 passed, 0 failed/skipped/cancelled; 12.338 seconds.
# With independent tests: 76 passed, 0 failed/skipped/cancelled; 6.902 seconds.

node --test --test-name-pattern='withdrawal after a committed start|prompt preparation failure|late resource refusal' packages/runtime/test/start-gate.test.ts packages/initiative/test/initiative.test.ts deployment/evaluation-resources.test.ts
# 3 passed, 0 failed/skipped/cancelled; 0.486 seconds.

node --test --test-name-pattern='failed probation activation releases processor ownership' deployment/evaluation-dispatch.test.ts
# 1 passed, 0 failed/skipped/cancelled; 1.011 seconds.

node node_modules/typescript/bin/tsc --noEmit
# Passed.
git diff --check
# Passed.
```

Full raw outputs are retained outside the checkout in `/home/palimpsest/migration/aeon-1-20261011/atomic-start-review-evidence/`: `a1-atomic-start-review-baseline.tap`, `a1-atomic-start-review-adversarial.tap`, `a1-atomic-start-review-final.tap`, and `a1-atomic-start-review-dispatch.tap`. SQLite experimental warnings were expected; no assertion failure or test skip occurred in these commands.

## Handoff and limits

The commit containing this evidence and the three test additions is the exact handoff revision. Root should integrate it, retain the original engineering-evidence labels, and run its already-owned full ordinary service/external-reviewer/controller scenario and aggregate checks on the resulting joined source. This reviewer did not occupy the separately coordinated heavy installation/bootstrap window or rerun the heavy ordinary physical composition. The focused suite includes existing actual tiny successor/rescue processes, SIGKILL recovery and second-process SQLite lock probes, but does not substitute for that pending joined gate.

No provider inference, payment, external message, production installation, push, new resource grant, admission-policy relaxation or source/dependency change occurred. Root coordinates the independent rescue-rotation and governance work, which is outside this review's frozen source.
