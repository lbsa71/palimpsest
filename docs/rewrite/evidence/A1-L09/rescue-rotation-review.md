# A1-L09 fresh finite rescue-rotation review

Reviewer: `/root/a1_rescue_rotation_review`, fresh context independent of the implementation author. Branch `codex/a1-rescue-rotation-review-20261011`; isolated worktree `/home/palimpsest/migration/aeon-1-20261011/rescue-rotation-review`. Actual finite tool goal created before inspection, without a token budget. Parent delegated exclusive review/fix ownership of rescue rotation and its tests, the already approved tiny bootstrap callback seam, and this new evidence; shared wiring remained read-only. This completes the scoped consequential review for A1-L09-T03/T05, not A1-L09 or H1.

Reviewed frozen root `2aa202c126dcedce23d9712726583c90bac5727b`, including implementation commits `10affe86077c7e42173d8876a21f409eee1c11c1`, `8ae8a4445abf648262209738e08b4e09e58f6082`, and `2aa202c126dcedce23d9712726583c90bac5727b`. These integrate the author's `3221af0`, `cc5fa4e`, and `93b5dae`. Reviewer behavioral additions are `872d762`; production implementation was unchanged.

## Disposition

No unresolved implementation defect found in the scoped review. Read-only tracing covered ordinary mailbox tool registration, supervisor processor lifecycle/readiness, CLI callback, runtime/effect/resource settlement, and installed bootstrap publication/authority guards. The author already repaired duplicate receipts and the resumed-producer race before this fresh review; both repairs were exercised, including a duplicate lost reply after a completed pointer decision.

The explicit request binds original run, audience, serving authority, configured candidate and policy. The host requires the accepted and active target and defers while the producer is running. The installed bootstrap callback checks the actual retained target/readiness/runtime, failed latch and actual authority ledger. Its mutation ordering is publication lease, authority transaction, then operational transaction. The operational guard rechecks the original author and allocation ancestry at pointer mutation. Local receipt reconciliation uses current serving authority to account for a known old local return; it does not reauthorize the old request or create a grant.

Two added adversarial cases exercise behavior beyond the original suite:

- Change the original audience, expire an ancestor allocation, or replace the accepted target after preliminary validation but before the actual commit callback. Each rejects without entering pointer mutation or spending another request.
- Lose the local reply, cancel the parent allocation, withdraw the author, activate a successor authority, and reopen the operational store. The exact old local effect settles once with its original authority and conservative elapsed charge; its rescue request is rejected. Run, allocation and budget records remain identical, concurrency is released, and no additional model/receiver dispatch occurs.

The model-facing result contains bounded request/target/status/diagnosis fields; private error artifacts and host paths are retained outside that result. Unknown pointer outcomes stay uncertain across restart, and completed decisions survive a lost callback return. Neither release acceptance nor receipt reconciliation automatically creates another rotation. Existing retained snapshots are preserved.

## Observed commands and results

Runtime: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, v24.13.0. The isolated worktree links the existing trusted development `node_modules` closure; no dependency change occurred.

```text
node --test deployment/rescue-rotation.test.ts
node --test --test-skip-pattern='actual bootstrap' deployment/rescue-rotation.test.ts
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The full original twelve-case suite at exact `2aa202c` passed 12/12 with zero failures, cancellations or skips in 12.385 seconds. Its real private bootstrap pointer/retention case took 8.371 seconds. The reviewer claimed and released the parent's heavy-test window for this one run.

After the two reviewer cases, all thirteen selected light cases passed in 5.656 seconds with zero failures, cancellations or reported skips. The suite now has fourteen total cases; the explicitly excluded bootstrap case was unchanged and was not repeated. TypeScript and diff whitespace checks passed. No failed experiment occurred in this review. Earlier author/compiler/private-mode fixture failures remain recorded in [the author evidence](rescue-rotation.md), unchanged.

## Limits and handoff

The bootstrap fixture operates real private retained Node snapshots and filesystem pointers but supplies an engineering readiness witness. It verifies enforcement of that witness, not a fresh full application boot, mounted isolation, or systemd recovery. Installed successor/recovery evidence and the final integrated aggregate are parent responsibilities. Process-crash uncertainty is covered by injected pointer failure and persisted interrupted state, not a fresh operating-system kill experiment in this review.

No providers, paid inference, Slack, production service, publication, deployment, snapshot deletion, external retries or allowance resets were used. This is fixture/integration review evidence only; it makes no H1, live competence or autonomous-use qualification claim. Parent `/root` owns integration of `872d762` and this evidence, shared lane/execution status, aggregate verification and the wider acceptance decision.
