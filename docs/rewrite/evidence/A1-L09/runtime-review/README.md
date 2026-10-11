# Fresh runtime and communication join review

A1-L09-T02/T03/T05, 2026-10-11. Reviewer `/root/a1_runtime_review`, isolated worktree `runtime-review`, branch `codex/a1-runtime-review-20261011`. Frozen review base `987b278` includes runtime implementation `1440e40` and communication visibility `6cb6d0a`. Fix revision: `327e91a57c860a831b914d1378f3686adacdadf0`.

## Reproduced defect and repair

A real frozen child can finish startup after its authority has been withdrawn. `ServiceProcess.start` previously accepted a matching old ready packet and returned serving readiness without consulting the current authority ledger. The independent regression starts a real child, waits for its filesystem startup witness, withdraws authority through the real SQLite store, then permits the child to send its old ready packet. The frozen implementation returns readiness; the repaired implementation rejects and drains that child.

The parent now serializes the spawn and exact candidate/authority check with authority withdrawal using the existing synchronous dispatch transaction. It revalidates the current candidate/authority transaction when receiving readiness, and refuses readiness during stop. No contract, host-successor, bootstrap, installer, mailbox, supervisor, communication or evolution-tools implementation was changed.

The child is deliberately a minimal engineering lifecycle fixture with placeholder toolchain directories. It proves the real process/ledger race, not an ordinary model turn, actual compiler competence, or product admission. The separate existing service and host fixtures exercise the real ordinary application and actual replacement executables.

## Checks and retained failures

Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0), Linux, same physical architecture. The worktree received a physical copy of the accepted root `node_modules` compiler closure for artifact checks.

- Frozen reproduction: restore only `deployment/service-process.ts` from `987b278`, run `node --test deployment/runtime-review.test.ts`, then restore the fix. **0 passed, 1 failed**, with `Missing expected rejection`; [before.txt](before.txt).
- Fixed joined command: `node --test deployment/runtime-review.test.ts deployment/runtime-bundle.test.ts deployment/candidate.test.ts deployment/service-process.test.ts deployment/host-successor.test.ts deployment/evolution-tools.test.ts deployment/application.test.ts packages/communications/test/communications.test.ts`. **68 passed, 1 failed, 0 skipped**; [joined.txt](joined.txt). All four real host replacement/interruption tests passed, including the different-ELF launcher/coordinator/service and offline latest-state recovery test. The independent race regression, ordinary service restart, runtime budget/adversarial snapshot cases, application communication visibility and 23 communications cases passed.
- The joined failure was review-harness contamination: output initially went into `docs/rewrite/evidence`, which is itself frozen by the candidate test. The candidate correctly rejected changing source. Output capture was moved outside the source, and the failed case was rerun with `node --test deployment/candidate.test.ts > /tmp/aeon-runtime-review-candidate-rerun.txt 2>&1`: **1 passed, 0 failed**; [candidate-rerun.txt](candidate-rerun.txt). This is a repaired capture procedure plus isolated pass, not a claim of one wholly green joined run.
- `npm run check`, `npm run build`, and `git diff --check` passed. The code was unchanged after these checks. No additional broad repeat was run because concurrent worktrees were performing expensive artifact freezes; the lead owns the final joined aggregate.

## Reviewed boundaries and limits

Read-only staging and application verification do not execute candidate ELF bytes. Descriptor-pinned ancestor traversal rejects source symlinks and hardlinks, enforces separately granted runtime bytes, checks content identity and read-time changes, and accepts only Node 24 descriptors for the physical Linux platform. New runtime proposals require the accepted grant; retained runtime inheritance reads the existing accepted private artifact. The classifier binds the runtime into controls so changing it takes the staged-control path. Launcher, coordinator, service and worker selection use candidate-bound runtime paths; retained rescue uses the retained candidate and current external lived state. Existing adversarial and actual process checks were rerun; this is not independent validation of every possible filesystem race or of arbitrary native runtimes.

Communication review found no additional reproducible defect: current target/grant audience checks and channel/thread gap filtering omit foreign channels and threads, including error details. A completed bounded scan explicitly does not imply complete message delivery or repaired historical gaps. Existing ordinary reasoning and tool checks passed with zero live Slack calls; network clients were fixtures.

All disposable children and temporary fixture trees were cleaned by their tests. No paid inference, live provider call, Slack send, production installation, push or H1 acceptance occurred. This review does not qualify product competence, provider portability, comparator parity or developmental transfer. Exact staging of future controls and qualified provider profile additions remain separately owned work.

The finite review goal releases its runtime/candidate/materialization/service and communication ownership to the lead. `frozenInputs`/evolution-tools ownership was released earlier after inspection, before the lead's profile/governance extension. The lead integrates this evidence and performs the final joined checks.
