# A1-L09 atomic author start and control activation

Finite follow-up to [control-review](control-review.md), under RW10, RW14, RW15, RW16 and RW19. Owner `/root/a1_control_review`; worktree `/home/palimpsest/migration/aeon-1-20261011/control-start-gate`; branch `codex/a1-control-start-gate-20261011`; base `b7a9a9b`. The root coordinator authorized runtime, initiative runner and narrow authority/controller mutations to close the previously recorded race. Root owns dispatcher callback/context wiring, supervisor forwarding/guard wiring and final frozen physical composition. No other application mutation was made beyond installing the runtime eligibility callback.

## Reproduced behavior

The old application checked control eligibility before `DurableRuntime.resume` independently changed the run to `running`. A staged interleave read eligibility as true, committed an activation hold through a second operational-store connection, then resumed the author. The old runtime nevertheless invoked the shell and completed the held run. Both new runtime tests failed before the implementation: the held author was `completed` rather than unchanged `ready`, and no host eligibility callback ran.

Adding the runtime gate alone was insufficient for initiative accounting. Re-running the new initiative regression against the original `b7a9a9b` runner with the guarded runtime still returned `selected` rather than `idle`: selection consumed a scheduler slice before learning that the host deferred the start. That explicit pre-fix run failed. The final test passes and observes unchanged scheduler state, goal revision, stalls/execution record, run, allocation and request count, followed by unrelated work and later continuation of the same original author.

## Implementation

`RuntimeOptions.canResume` is host-installed and evaluated under the operational write lock that claims `Run.running`. Every ordinary/direct/initiative/child call through this runtime receives the same gate. `prepareResume` permits a scheduler to include that synchronous claim in its own selection transaction and returns a single-use execution closure. Shell execution occurs only after the caller commits; rolled-back claims leave no in-memory active marker. Cancellation before execution prevents shell invocation. Existing `resume` remains a wrapper over this path.

The initiative runner now commits selection, goal/run preparation and the runtime claim together. A host-deferred claim rolls back the selection instead of consuming a lifetime slice or incrementing a stall. No database transaction spans an await or shell/model execution. Application wiring installs the existing scoped control eligibility predicate, retaining explicit queued steering and blocking activation/probation starts.

The host continuation passes a synchronous callback to `reserveProbation`. `prepareReview.commitReservation` runs under its existing authority-then-operational lock order and commits with the original physical reservation. The callback rechecks stage, original authority, lineage, producer status and readiness, then records `activating`. If a producer won the race, the callback aborts the transaction and leaves the activation pending with zero reviewer reservations. A regression starts a real `DurableRuntime` producer between the initial readiness check and reservation; activation waits and later completes exactly one review after that producer finishes.

`AuthorityStore.withdraw` now accepts a synchronous guarded commit; the controller forwards it for staged control activation. The guard runs after acquiring authority and can retain the operational lock through the actual authority write. The controller records transfer intent only when the guard invokes the commit, so cancellation winning immediately before withdrawal leaves the incumbent authority and accepted controller state intact. `assertControlActivationClaim(store, stageId, review)` checks the exact journal claim, original authority/run/scope/proposal/stage, unchanged lineage and non-running producer. Root supervisor wiring must additionally recheck the exact settled activation acknowledgement before invoking commit. Guard callbacks cannot skip, repeat, asynchronously defer or retain the authority write.

The original policy, fresh independent evidence rules, allocation identity/start time, reservation identity, uncertain physical usage and separate owner recovery path remain unchanged. The claim and guarded-withdraw tests use real SQLite databases and actual tiny successor/rescue processes. Another process observes both authority and operational write locks at the actual withdrawal and acceptance boundaries.

Fresh independent review of author and root wiring at `f6dd341` is recorded in [atomic-start-review](atomic-start-review.md). It found no actionable production defect, added three adversarial rollback/withdrawal cases, and passed 76 focused checks plus the dispatcher's logical-reservation check. Root retains the final ordinary physical composition and aggregate verification gates.

## Verification and handoff

Node v24.13.0: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`. Trusted development compiler closure is linked into the isolated worktree; no candidate build closure was changed.

```text
node --test packages/runtime/test/start-gate.test.ts packages/runtime/test/runtime.test.ts packages/initiative/test/initiative.test.ts packages/supervisor/authority.test.ts packages/release/controller.test.ts deployment/control-continuation.test.ts deployment/control-tools.test.ts deployment/evaluation-resources.test.ts
# 73 passed, 0 failed/skipped/cancelled; 7.561 seconds.
node node_modules/typescript/bin/tsc --noEmit
# Passed.
git diff --check
# Passed.
```

Development type-check failures caught three fixture calls still using the old activation signature and the truthiness check of a TypeScript `void` guard return; both were corrected before the final check. No failed assertion was weakened. Existing runtime SIGKILL, release/controller recovery, old-policy control probation, acknowledgement, resource cancellation and initiative accounting cases passed with the new code.

The root must forward `reserveProbation(review, commitReservation)` into the reservation transaction, persist the exact probation context there, forward `activate(stageId, review)` and install the guarded withdrawal body. This child intentionally did not edit those root-owned files or claim full application/dispatcher composition on the unjoined worktree. Parent integration and fresh review remain required before broader component acceptance. No paid inference, external message, production install, allowance increase or admission-policy relaxation occurred. The commit containing this document is the exact child source/evidence handoff.
