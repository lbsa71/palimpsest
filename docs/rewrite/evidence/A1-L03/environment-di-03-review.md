# DI03 independent environmental boundary review

2026-10-12. Aeon 1 → A1-L03 → DI03 fresh review. Owner `/root/a1_environment_runtime_review`, isolated branch `codex/a1-environment-di-03-review-20261012`, base `0553002`. Governing claim is the final section of [execution](../../execution.md); [DI01](../A1-L01/environment-di-01.md), [DI plan](../A1-L09/environment-di-plan.md), [author](environment-di-03.md), and [integration](environment-di-03-integration.md) are read-only inputs. Exact author `c4d9280`, production `1d25d5d`, root fixture correction `9b57ba6`, imported join `e36b503` and prior passing join `39ccde7`.

Actual finite tool goal: complete independent review, add held-out tests, run the explicitly enumerated affected suite and strict checking, and return a bounded accepted-or-changes-required disposition without source repair. Only this NEW evidence and NEW `deployment/environment-di-03-review.test.ts` are writable.

## Independent criteria frozen before review test code

1. Supplied wall/elapsed/ID functions are captured at construction and called without an implicit receiver. Controlled fixture state may change; replacing the options functions must not replace captured ports. No ambient fallback after supplied failures.
2. Creation, status, adoption, cancellation, effect transitions and recovery preserve transactional state/event consistency on supplier exceptions or duplicate IDs. A failure after receiver entry must leave dispatched/uncertain work charged; failure cannot imply no effect occurred.
3. Checkpoint artifact, assigned execution state and journal event commit atomically. A failed replacement must leave the prior assigned checkpoint readable and the rejected artifact absent, including after reopen.
4. Independent overlapping runs can finish in reverse order using one monotonic runtime clock. An invalid or throwing reading on one completion must retain that request's original reservation without corrupting another completion or its duration.
5. Committed root and each ancestor allocation floor survive reopen and wall regression. A narrow expired branch must not become usable through a fresh descendant or lower clock; a roomy sibling retains legitimate authority. Known settlement may release unused reservation but cannot lower committed wall consumption.
6. Snapshot under the actual read-only development fence changes no Store documents/events/artifacts. A later explicit mutation may commit its local floor. An enclosing transaction rollback also rolls back floor persistence: a new instance/reopen is only guaranteed the previously committed floor; no independent durable observation is claimed.
7. Audit the old combined resource test by exact diff: retain the original identity mismatch, 11ms expiry under a 10ms grant, and 31-token/cancellation overrun predicates; the overrun uses a genuinely separate fresh root/request and rollback must leave the original expired.
8. Enumerate and rerun all 41 affected checks using only these six exact files: `deployment/environment-di-03.test.ts`, `packages/effects/test/effects.test.ts`, `packages/runtime/test/resources.test.ts`, `packages/runtime/test/runtime.test.ts`, `packages/runtime/test/shell-joined.test.ts`, `packages/runtime/test/start-gate.test.ts`. Add meaningful held-out tests through explicit DI and controlled real Store adapters; no new global/module patches. Run serial test concurrency 1 with pinned Node 24 and existing dependencies; strict `tsc --noEmit` and diff/ownership checks. Do not use a runtime wildcard or select `recovery-composition.test.ts`.

No physical/native/provider/network/private-credential/Slack/full-benchmark/push/deploy operations. DI09 Store internals, DI14 broader application composition, DI28 closure and H1 remain separate gates. A preserved defect completes this review as changes required; it does not authorize reviewer source repair.

## Disposition and observed behavior

**Accepted for the bounded DI03 engineering slice.** Precode criteria were committed as `5465e2e` before creating the held-out test file. All 12 independent cases and all 41 affected cases passed, with no failures, skips or cancellations. Strict checking passed with no diagnostics. Production files compare byte-for-byte with `1d25d5d`; the corrected old resource fixture compares byte-for-byte with `9b57ba6`. No source or existing tests were edited.

Static review places ambient wall/elapsed/entropy calls only in the named production factories. Elapsed uses a bound native method; supplied runtime/resource/effect callbacks are invoked as local functions without a receiver. Runtime options are captured once. Every supplied failure propagates into the existing failure path without selecting a production fallback. Supplied Store, shell, receiver and fence remain explicit dependencies. This does not audit those dependencies' internals or confer live adapter authenticity.

The independent checkpoint probes compare the entire bounded Store document/event snapshot before and after both throwing and colliding event IDs, prove rejected content-addressed artifacts absent, and read the prior artifact/assignment from a second actual SQLite connection. Receipt-ID failures occur after one actual injected receiver entry: the effect and physical request remain dispatched, the original 30-token/$1/20ms charge and concurrency stay outstanding, retained receipt bytes remain readable, recovery marks uncertain, and direct redispatch is refused. Bulk recovery collision rolls back both effect updates and leaves resource requests dispatched; its crash-state fixture explicitly constructs dispatched rows through the controlled Store. Adoption rollback includes the earlier effect reauthorization inside the enclosing runtime transaction.

Two concurrent runs share the same runtime clock and finish in reverse order: the later-started request records 3ms and the earlier 10ms. If the first completion clock throws, its full 20ms reservation survives while the other still records 10ms; recovery makes only the unaccounted request uncertain and retains its actual receipt. Independent tests use receiver-free callback assertions and mutable fixture state, without replacing production/global/module methods.

Resource tests establish a committed 6ms ancestor floor against a narrow 5ms branch across reopen and rollback: both its existing request and a fresh descendant are refused while a roomy sibling still settles successfully. Settlement cannot lower the committed root floor. The read-only and enclosing-rollback probes compare full document/event snapshots and verify that the local 12ms observation is absent from a second instance until an explicit denied reservation commits it. Before that commit, reopen reports only the existing 1ms request charge. This is the intentionally specified transactional limit, not a claim that every observed time is independently durable. A same-instance later mutation can publish its conservative floor; snapshots themselves perform no Store write under the actual development read fence.

### Old fixture audit

Reviewed `git diff 013e258 9b57ba6 -- packages/runtime/test/resources.test.ts`. The only changed case retains the original changed-model refusal and expiry at time11 under maxElapsed10. It adds refusal after clock rollback to0. At time11 a new root `fresh` and new request `fresh-request` use the same 10ms envelope and original request ceiling; settlement retains input30/output1/cost0.2/elapsed1, tokens31 and cancelled=true assertions. No old grant is revived or ceiling increased; the other three resource tests are unchanged. The previously failing obsolete revival expectation remains preserved in the author's evidence and history.

## Commands and receipts

Pinned executable: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`. Worktree dependencies are a symlink to `/home/palimpsest/src/palimpsest/node_modules`; no installation. All test commands explicitly use concurrency1. The selected unchanged recovery/start-gate tests include their existing controlled Node/SQLite crash and lock fixtures; no confined physical `recovery-composition.test.ts`, native comparator, provider, network, credentials, Slack, full benchmark or deployment was run.

| Command after pinned Node path | Receipt | Result |
| --- | --- | --- |
| `--test --test-concurrency=1 deployment/environment-di-03-review.test.ts` | `/tmp/environment-di-03-review-new.log` | 12/12 pass |
| `--test --test-concurrency=1 deployment/environment-di-03.test.ts packages/effects/test/effects.test.ts packages/runtime/test/resources.test.ts packages/runtime/test/runtime.test.ts packages/runtime/test/shell-joined.test.ts packages/runtime/test/start-gate.test.ts` | `/tmp/environment-di-03-review-existing.log` | 41/41 pass |
| `node_modules/typescript/bin/tsc --noEmit` | `/tmp/environment-di-03-review-strict.log` | Pass, empty diagnostics |

`git diff --check` passes. Exact production and root fixture comparisons against their declared revisions are empty. There were no failing review test receipts to repair or discard. The 12-case and 41-case logs emit only the normal experimental SQLite warning besides passing tests. SHA-256:

```text
3bbf7f7b0472512046ecde4980136762480aa110ef61ceb8880f4b79f448cd87  environment-di-03-review-new.log
2abb8a279b67912b827a6b33cf7b202842c54ec9bbb97c8f6a5443b5da0e9e86  environment-di-03-review-existing.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  environment-di-03-review-strict.log
```

## Explicit affected-case inventory

All entries below passed; these are the actual 41 executed names, grouped by exact file. The author deployment file expands its parameterized loops to16 checks.

### `deployment/environment-di-03.test.ts`

1. independent captured ports determine timestamps, elapsed usage and every runtime/effect journal ID
2. duplicate status/checkpoint IDs roll back logical writes and leave the prior checkpoint readable
3. throwing status supplier rolls back a claim before shell entry; effect ID failures roll back creation/dispatch
4. wall rollback cannot replenish a denied durable parent allowance after reopen
5. resource snapshot stays read-only under the actual development source fence
6. elapsed floors share enclosing transaction rollback and do not mutate a fenced snapshot
7. unknown usage keeps original charges and concurrency through recovery and cancellation
8. invalid wall reading NaN rolls back allocation and cancellation
9. invalid wall reading Infinity rolls back allocation and cancellation
10. elapsed clock regression after receiver entry preserves reservation and actual receipt
11. elapsed clock throws after receiver entry preserves reservation and actual receipt
12. elapsed clock nonfinite after receiver entry preserves reservation and actual receipt
13. invalid elapsed reading -1 before entry retains authorization without dispatch
14. invalid elapsed reading NaN before entry retains authorization without dispatch
15. empty ID suppliers fail atomically without silently selecting production IDs
16. cancellation aborts active receiver, retains late receipt and original charge, and prevents new effects

### `packages/effects/test/effects.test.ts`

17. stale receiver grant cannot dispatch; payload identity conflicts rejected
18. late receipt after recovery/withdrawal settles old generation without allowing replay
19. reconciliation admission rejects stale grants while current generation can settle old effects

### `packages/runtime/test/resources.test.ts`

20. retries, compaction, reviewers and children share ceiling; unknown usage survives reopen
21. cancelled child does not cancel parent; cancelled parent bars every descendant
22. request immutable identity and deadline enforced before dispatch; over-ceiling usage freezes budget
23. narrow child grant cannot borrow unallocated requests from a roomy parent

### `packages/runtime/test/runtime.test.ts`

24. duplicate admission retains one run; multi-step failure changes action and completes
25. SIGKILL after checkpoint reopens SQLite and resumes from actual retained observation
26. SIGKILL during dispatch preserves uncertainty and never replays; old grant reconciliation permits takeover
27. cancellation withdraws run effects and persists through reopen
28. bridges reject foreign physical receipts and checkpoint artifacts; cancelled checkpoint writes are refused
29. shell results cannot invent authoritative observation receipts
30. shell results cannot invent authoritative checkpoint receipts
31. SIGKILL at pending permits explicit adoption of never-dispatched effects
32. SIGKILL at authorized permits explicit adoption of never-dispatched effects
33. SIGKILL at resource-dispatched permits explicit adoption of never-dispatched effects
34. resource and effect dispatch intent commit together before the receiver and roll back together on failure

### `packages/runtime/test/shell-joined.test.ts`

35. selected Pi shell + durable bridge observe failure, repair and verify with complete request accounting
36. selected shell resumes a persisted assistant tool call after unknown outcome reconciliation without effect replay
37. SIGKILL of selected Pi host reopens retained checkpoint and continues without repeating inspection

### `packages/runtime/test/start-gate.test.ts`

38. runtime rechecks host eligibility after stale scheduling, preserving steering and unrelated progress
39. host eligibility and running claim share a write lock, released before shell execution
40. rolled back prepared claims leak no active ownership; cancellation before execution invokes no shell
41. withdrawal after a committed start fences cognition and preserves unconsumed steering for takeover

## Independent held-out inventory

1. review: captured callbacks are receiver-free through messages, effects, checkpoint and cancellation
2. review: checkpoint throw removes rejected artifact and preserves prior assignment across reopen
3. review: checkpoint collision removes rejected artifact and preserves prior assignment across reopen
4. review: receipt ID throw after receiver entry keeps conservative work and prevents replay
5. review: receipt ID collision after receiver entry keeps conservative work and prevents replay
6. review: duplicate recovery event rolls back the entire effect batch before resources recover
7. review: runtime adoption ID failure rolls back previously reauthorized effects
8. review: reverse async completions preserve per-run elapsed and reservations (clock failure=false)
9. review: reverse async completions preserve per-run elapsed and reservations (clock failure=true)
10. review: persisted narrow lineage survives reopen while a roomy sibling remains usable
11. review: read-only floor is local until an explicit commit and reopen retains only committed floors
12. review: rolled-back-dispatch floor is local until an explicit commit and reopen retains only committed floors

## Handoff

The commit containing this final evidence is the exact accepted two-path handoff: NEW `deployment/environment-di-03-review.test.ts` and NEW `docs/rewrite/evidence/A1-L03/environment-di-03-review.md`. Root owns central status and integration. This review's finite goal ends with that handoff; no repair is required by these observations. DI09 storage injection, DI14 complete application composition, DI28 closure, live timing qualification and H1 remain independently open. Counts alone do not establish those gates or product competence.
