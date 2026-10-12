# DI05 independent initiative environment review

2026-10-12. A1-L05-DI05 fresh review by `/root/a1_environment_initiative_review`, branch `codex/a1-environment-di-05-review-20261012`, frozen source `73e9f83` (implementation `06f4487`, imported `e29eca6`). Exclusive writes: this evidence and new `deployment/environment-di-05-review.test.ts`. Source and all prior tests are read-only. Governing inputs: root AGENTS, REQUIREMENTS, PLAN, planning workflow, A1-L05 lane, adopted environmental DI plan, DI01, exact execution claim, and author's DI05 evidence. Model/effort inherited from the explicitly routed fresh-review task.

```text
/goal Independently review DI05 initiative environmental injection at 73e9f83, freeze held-out criteria before source/test inspection, add causal tests in the two assigned review files only, run unchanged 35 and focused serial verification, and hand off accepted or exact changes required without source repairs or waiting.
```

## Frozen precode criteria

Written before implementation and author-test inspection or rerunning their outcomes. The author's reported counts are input claims, not independent evidence.

1. Environmental callbacks are captured at construction before invocation; mutation/reentrancy cannot replace admitted IDs, ordering, time or timer cancellation. Callback exceptions retain identity and cannot commit partial durable state. Invalid callback results fail visibly.
2. A quantum cannot be entered after failed timer setup, synchronous firing or preabort. During setup, task execution and cancellation, concurrent/reentrant ticks cannot double-select or double-charge. Terminal cleanup releases the active latch and parent listener even if cancellation throws. Late timer/parent callbacks have no durable side effects.
3. Controlled Store/journal snapshots establish rollback and causal effects, including scheduler resources and obligations. ID/comparator failure is observed inside the relevant operation rather than inferred from output counts.
4. Independent restart objects retain fairness state, lifetime usage, pending reports and delivery backoff. Time rollback/preabort cannot replenish allowance or mutate protected durable work.
5. Tests inject explicit functions and manually dispatched timers, with bounded controlled SQLite/temp resources. No new module/global monkeypatch, sleeps, provider/network/physical/native activity, credentials, Slack, installs, full benchmarks or deployment.
6. Run the unchanged 19 DI05 and 16 initiative tests plus held-out cases serially, strict compilation, and only causally justified selected integration checks. Record all failures, source identities, commands and limitations. DI14 application propagation, full DI closure, live qualification and H1 remain separate.

Disposition pending. This precode freeze is committed before implementation reads and review-test creation.

## Disposition: changes required

Independent precode commit: `d1ff9fe`. Source remains exactly `73e9f83`; no source or existing test changed. The commit containing the final version of these two review files is the handoff revision (reported by root integration).

**DI05-R1 (P2), `packages/initiative/scheduling/runner.ts:132–134`: preserve both failures when timer disposal fails during error unwinding.** Reproducer: inject a scheduler `newId` that throws one Error and a timer cancellation callback that throws a different Error, then call `tick`. The scheduler transaction rolls back, but the exception from `finally` replaces the original selection exception. The caller receives only the cancellation Error: there is no `cause` or aggregate containing the primary failure. This loses the exact failure that prevented work, contrary to the frozen callback-failure retention criterion. The held-out test asserts rollback and listener/latch cleanup first, proves a subsequent tick reaches the original selection failure, and then fails specifically because the initial selection failure is absent. Required repair: retain both original thrown values on concurrent operation/cleanup failure, preserve single-failure identity, and keep unconditional timer/listener/latch cleanup. Root owns the repair; this review does not modify implementation or weaken its predicate.

**Joined regression observation, not attributed to DI05:** the unchanged driver preparation check fails at `evaluations/development/development-driver.test.ts:121`. Its exact original allocation comparison expects `elapsedFloorMs: 0`; actual is `3000`, with the rest of the displayed allocation unchanged. DI03's joined ledger persists elapsed floors; DI05 does not change that source. No baseline counterfactual was run, so this review does not classify the failure as new or as a fixture defect. Root must disposition it separately without relaxing a resource invariant. This selected case exercises construction of six actual application Stores with zero dispatch/listener intent; its allocation assertion fails before its later zero-dispatch assertions. No networking, physical worker or provider launch was requested by this preparation path; its existing in-process worker mock remains unchanged.

## Held-out evidence

Ten new causal cases, nine passed and one preserved failure:

- Goal-event ID, runtime-event ID, and prompt preparation failures occur after scheduler selection begins. Each rolls back the full Store snapshot, scheduler journal, goal revision, runtime admission and child allocation; only the preexisting initiative root remains. Each retains exception identity, cleans its timer/listener, and permits exactly one later selection.
- A timer adapter reenters `tick` both while scheduling and while cancelling. Both calls refuse without another selection. Mutation of the public options' timer callback cannot substitute the captured function. Cancellation-time and post-return late callbacks cannot abort the delivered signal or mutate the Store.
- A pending delivery excludes a concurrent tick. Parent and manual timer cancellation retain an authentic delivery failure, owed obligation and backoff. Closing/reopening real SQLite preserves a dispatched reservation, charged tokens, concurrent slot, original request row and scheduler lifetime; backoff suppresses delivery until explicit clock advance.
- Restart preserves cross-service cursor and within-inquiry queue position. A rolled-back wall clock refuses with an identical Store snapshot; a later window continues the existing queue and retains lifetime usage.
- Throwing and nonfinite drive comparators fail inside opportunity selection without consuming the opportunity or creating a goal. Retry with the same captured comparator succeeds when its explicit fault state clears.
- A throwing tool wall clock retains its exact Error and leaves the complete Store unchanged.
- Simultaneous selection and timer-cancel failure demonstrates DI05-R1. Rollback/listener/latch predicates pass; the original error-retention predicate fails.

All new tests use explicitly supplied clocks, IDs, comparison, runtime/shell and timer callbacks with controlled temporary SQLite. They introduce no global/module monkeypatches, actual model transport, network or sleeps. Existing production-timer and fixture-model regression behavior is retained unchanged.

## Commands and observed receipts

Working directory: `/home/palimpsest/migration/aeon-1-20261011/environment-di-05-review`. Pinned runtime: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`. Commands ran serially, test concurrency one. `node` below denotes that exact executable.

| Command | Receipt | Result |
| --- | --- | --- |
| `node --test --test-concurrency=1 deployment/environment-di-05-review.test.ts` | `/tmp/aeon-di05-review-first.log` | 9/10 pass; DI05-R1 fails; 0 skipped/cancelled; 0.592 s |
| `node --test --test-concurrency=1 deployment/environment-di-05.test.ts packages/initiative/test/initiative.test.ts deployment/environment-di-05-review.test.ts` | `/tmp/aeon-di05-review-joined.log` | 44/45 pass: unchanged original 35/35 pass, new 9/10; sole failure DI05-R1; 0 skipped/cancelled; 6.430 s; process exit 1 |
| `node node_modules/typescript/bin/tsc --noEmit` (first attempt) | `/tmp/aeon-di05-review-strict.log` | Failed before compilation: authorized dependency symlink was absent; cannot find TypeScript module |
| Same strict command, after `ln -s /home/palimpsest/src/palimpsest/node_modules node_modules` | `/tmp/aeon-di05-review-strict-with-dependencies.log` | Pass, exit 0, no diagnostics; no install or dependency modification |
| `node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='^prepare binds six actual application Stores and unchanged original allocation anchors with zero dispatch/listeners$' evaluations/development/development-driver.test.ts` | `/tmp/aeon-di05-review-driver-construction.log` | 0/1 pass; exact elapsed-floor assertion failure above; 0 skipped/cancelled; 3.530 s; process exit 1 |
| `git diff --check`, staged ownership and source/prior-test diff inspection | git receipt | Pass; only the two assigned new review files changed; dependency symlink ignored |

Receipt SHA-256:

```text
bcbc2ed20a829ec8627cc5e30ca53ca353ba9077fcdd020f3ac5c8dd25870dbe  aeon-di05-review-first.log
d41f38701ba2050caf216cd8907fbd14639e7bf87f925c53222a22e618d3d4aa  aeon-di05-review-joined.log
0edd43708dbcc6df2d872e38b857f5bdcef1723a785216abbb1395c04b125dc6  aeon-di05-review-strict.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  aeon-di05-review-strict-with-dependencies.log
ea2709da1b9ee07d07d40f4fddd2d0988020bc824dc2e310ac5d52bae3963d65  aeon-di05-review-driver-construction.log
```

The requested bounded independent review is complete with changes required. Root receives the exact two-file handoff and retains source repair ownership; no repair wait is part of this finite goal. Full application option propagation remains DI14, old fixture adaptation remains separately owned, and DI28/full environmental closure, qualified elapsed time, live model competence, autonomy and H1 remain unproved by this review.
