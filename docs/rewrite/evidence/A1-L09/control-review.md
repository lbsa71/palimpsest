# A1-L09 fresh control continuation review

Finite task: independently review ordinary control activation through original-policy physical probation, including resource ownership, cancellation, acknowledgement, restart, audience and recovery boundaries. Requirements RW09, RW10, RW14, RW15, RW16 and RW19. Owner `/root/a1_control_review`; branch `codex/a1-control-review-20261011`; isolated worktree `/home/palimpsest/migration/aeon-1-20261011/control-review`; reviewed base `7dfbf9f`. The parent owns lane coordination, dispatcher implementation and complete composition acceptance. The sibling continuation reviewer owns asynchronous evaluation continuation and application/offline-provider changes.

## Findings and changes

1. **Reproduced and fixed: duplicate prepared-review ownership.** `accountedReview` validated the unused reservation before asynchronous preparation without claiming it. Two calls could both pass that check. The second failed launch then settled the first caller's dispatched reservation as failed, releasing its concurrency and breaking the first caller's eventual settlement. The new regression failed before the fix with `request was not dispatched`; the second invocation had overwritten the shared physical status. A transactional durable claim now precedes any asynchronous operation. A losing claimant never enters preparation or settlement. The test observes one operation, one physical launch, retained concurrency while the first caller is active, and successful original settlement. No reservation identity, resource ceiling, elapsed start or unknown outcome is reset.

2. **Dispatcher-owned liveness defect, coordinated fix.** `reserveProbation` acquired logical dispatcher ownership, while only `reviewProbation` released it. A partial reservation response, activation failure or lost activation response could prevent `reviewProbation` from running and leave the dispatcher permanently busy until restart. This change adds optional `finishProbation` to the continuation contract and invokes it in `finally`, including a reservation callback that partially commits and throws. Tests cover both partial reservation and lost actual activation responses without replay. The root coordinator owns the exact-context dispatcher implementation and supervisor wiring: only known unlaunched reservations may be settled failed; dispatched/uncertain physical records must remain held. This child does not claim that root implementation was tested at this revision.

3. **Acceptance serialization verified.** Inspection of `ServiceSupervisor.acceptProbation` confirms authority lock then operational write lock enclosing `assertProbationLineage` and the synchronous controller commit. A new fixture invokes the real controller and has another process attempt both write locks at the commit boundary; both are locked. Existing cases reject cancellation after fresh review but before acceptance, preserve the original rescue, and recover without resurrecting cancelled work.

4. **Remaining integration question: producer eligibility race.** Ordinary acknowledgement readiness is read before reservation, while explicit steering may resume a pending author. The application checks eligibility before the runtime writes `running`, so merely rechecking the host predicate outside that shared transaction does not establish cross-process serialization. This was reported to root and the application/async reviewer. It is a source-level race hypothesis, not a reproduced failure or a claimed repair in this handoff.

Reviewed scope/identity checks retain exact proposal, run, audience, stage, submission and original judging policy; public tool status omits frozen candidate payload, allocation lineage and reviewer keys. Original allocation clocks and request identities survive authority adoption. Unknown review records are not retried. Local acknowledgement recovery requires matching effect payload, authority, receipt and physical receiver identity, while known outcomes wake only the existing eligible author once. These conclusions are bounded by the inspected sources and fixtures; they do not certify live reviewer competence or product readiness.

## Observed checks

Node v24.13.0 at `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`; isolated worktree uses a symlink to the trusted development compiler closure, not candidate payload dependencies.

```text
node --test --test-name-pattern='concurrent claimant' deployment/evaluation-resources.test.ts
# Before fix: 0 passed, 1 failed, request was not dispatched.
node --test deployment/control-continuation.test.ts deployment/control-tools.test.ts deployment/evaluation-resources.test.ts
# After fix: 30 passed, 0 failed/skipped/cancelled, 8.803 seconds.
node node_modules/typescript/bin/tsc --noEmit
# Passed.
```

The root's complete ordinary control composition log was separately read at `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/ordinary-control-composition-first.log`: one passed test, zero failures/skips/cancellations, 38.621 seconds, frozen source `7dfbf9f`. That result predates these review fixes. It is parent-produced fixture evidence, not a run performed by this child. The root must integrate and review these changes and its dispatcher cleanup, resolve the producer-race question, then verify the resulting composition before broader component acceptance.

No paid inference, external messages, production installation, rescue retirement, new resource grant or admission-policy relaxation occurred. Candidate self-assessment and engineering fixtures are not product qualification. Exact source handoff is the commit containing this document and the four changed source/test files, reported to the root coordinator.
