# Independent control-journal and fixture rebase review

A1-L08/L09, 2026-10-12. Owner `/root/a1_development_paged_join_review`; NEW finite actual goal, isolated `development-controls-journal-review`, branch `codex/a1-development-controls-journal-review-20261012`, exact base/root claim `0bcc8be18a9f72b1f2931c72605114b133d75269`. Only this new evidence and `deployment/development-controls-journal-review.test.ts` are writable. Existing source/tests/evidence remain read-only. Inputs: helper fix `79d1c41` under precode `804e000`; fixture precode `088a372`, first implementation `61f1b80`, final refinements in the frozen base. Previous paged review `f311683` is complete and is not being reopened.

## Independent criteria frozen before new tests

1. Actual SQLite journal/ResourceLedger setup emits the existing `document-mutation` wire. Preparing and binding an actual journaled application accepts only the established setup namespaces, including legitimate post-token accounting setup; both shared candidate and separate control stores work. The helper source diff is exactly the two event-name comparisons, with no storage/schema/limits/allowed-namespace/legacy-event fallback change.
2. Before seal, forbidden operational history remains forbidden even after deletion of its current row. After seal, actual journaled standing-goal history is forbidden under no-standing-goals and every scripted mode; consolidation history is forbidden under no-memory and every scripted mode, including deleted current rows. Positive modes remain able to retain their permitted history. Reopen must not erase the historical denial; ordinary Store APIs produce the events, with no fabricated legacy journal or raw SQL authority assumption.
3. The recorder rebase changes exactly eight preclaim fixture selections and preserves every existing behavioral assertion: seven authored and one independent positive. New 13/500000/6600000 allocation and the separately diagnosed late-response 8/750000/6600000 allocation are signed before one-use claim. Original default allocation, witness 512-record/1000000-singleton/8388608-total limits and all physical resource grants remain unchanged. Original 300000-byte refusal remains a durable failed claim with no B and immutable allowance. No source cap change, assertion weakening, skipping or post-claim grant expansion is acceptable.
4. Inspect exact diffs and run the two affected recorder files plus four existing control files on pinned Node24 with explicit module mocks for application tests, new causal probes, strict compilation and final source identity/diff checks. Preserve first 81/83 and refined 2/2 authored receipts as distinct history; do not overwrite production source in-process for a red run.
5. Finish finite accepted-or-changes-required without waiting for repairs. OD1 red checkpoint `17ee151` (10 pass/14 fail), active driver/P2 source, future admission, full workload/performance benchmark, semantic controls/review, live development and H1 remain separate. Small in-process fixtures only; no physical/native recovery children, provider/network/credentials/Slack/push/deploy/full suite.

## Independent disposition

**Accepted within the bounded component scope: the two-line actual-journal helper correction and the eight explicitly rebased recorder positives.** Root owns adoption/integration. No source defect was reproduced by this review. Criteria were committed before new probes at `26fa02f`; independent actual-journal tests are `b05c37e`. Both written files are new, and all existing source/tests/evidence remain byte-identical to reviewed base `0bcc8be`.

The helper source at `79d1c41` changes precisely two comparisons from the nonexistent producer spelling `document-journal-mutation` to the actual `document-mutation`. Storage, journal payload/ref wire, snapshots, setup namespace sets, post-seal mode rules, ancestor restrictions, control seals and all capacities are unchanged. The helper matches the actual producer; no alternate legacy event is admitted. The author/OD1 red checkpoint `17ee151` remains separate reported history (10 pass/14 fail). This reviewer did not overwrite source to replay that old revision or import active OD1 source.

The 57 independent cases use actual AutarkApplication construction, actual journaled OperationalStores and ResourceLedger/DevelopmentAccounting setup. The worker module is explicitly replaced by an in-process function that throws on any entry; every case asserts zero worker requests. No provider call, runtime child, direct listener or scheduler workload is started. Public synthetic writes to the actual application Store intentionally exercise historical contamination, not legitimate semantic goal/consolidation execution.

- All six evaluation kinds accept their real fresh journal setup and reopen the identical control seal. The shared candidate explicitly exposes allocation, budget and bridge mutation events; separate local controls expose their own accounting mutation. No misspelled journal event is present. Construction/reopen consumes zero original requests.
- Three pre-seal deleted rows (standing goal, consolidation job and other prior operational content) refuse before the accounting factory despite empty current namespaces. A synthetic event carrying the old misspelling and an otherwise allowed setup namespace also refuses before accounting; this is a no-fallback negative, not supported historical journal data.
- Forty-four distinct post-seal mode/namespace cases insert then delete current rows via ordinary Store APIs. The real immutable event stream contains exactly the put/delete mutations with the deletion's `after:null`. All nine standing namespaces are denied under no-standing-goals and each script; both consolidation namespaces are denied under no-memory and each script. Every case refuses both immediate restored-state validation and actual application reopen, retaining the history and zero requests.
- Three matched positive-mode cases retain deleted history that their modes permit: all eleven families under ordinary, standing families under no-memory, consolidation families under no-standing-goals. Restored-state validation succeeds. The fix does not accidentally disable capabilities that are part of the control distinction.

This is mechanical control-seal/source-history evidence. It does not qualify ablation comparability, actual scripted judgments, learning, model competence or delayed transfer.

## Exact fixture rebase audit

The old tests in `088a372` are byte-identical to original `02ce31b`. Inspection and a read-only normalization comparison show that the final files are **exactly byte-identical** to those old files after removing only the declared fixture parameter/allocation additions, reversing five authored `fixture(t,true,false,true)` opt-ins, one late-response opt-in, one assignment opt-in, the one independent `fixture(t,true)` opt-in, and the newly added original-allocation negative. Thus every old test name, assertion, regex, setup step after its fixture call and substantive behavioral predicate remains unchanged. No skips or name filters appear in the final review run.

The default old fixture remains 20 captures/300,000 bytes per snapshot/6,100,000 capture bytes. Seven selected positives use the newly signed unclaimed 13/500,000/6,600,000 allocation; the independently diagnosed late-response positive alone uses 8/750,000/6,600,000. Capacity selection precedes the fixture's signing/accepted-plan digest and the first recorder claim. The same 512-record, 1,000,000-singleton and 8,388,608-total witness limits and physical resource grants remain unchanged. Both new declarations reserve 7,165,632 bytes in aggregate; they are small fixture profiles, not the full 126-delivery profile or a workload-fit proof. Production acquire/plan/witness/storage blobs are unchanged across the rebase.

The original 300,000-byte negative now executes its real source-capacity refusal, asserts no B and a retained terminal failure, refuses mutation of the frozen claimed allowance and denies a duplicate claim. Returning only its injected clock to registration makes that last probe reach durable duplicate admission; no existing attempt/grant is renewed. The original eight red positives remain reproducible at `02ce31b`; passing a separately signed new fixture does not establish old-plan feasibility.

Root's first authored rebased run remains 81/83, no skips, 121.696 seconds. Its two failures were the late response's later 547,612-byte conservative cut exceeding the first 500,000-byte choice, and the new negative encountering clock refusal before duplicate-claim admission. Root predeclared the narrowed late-response allocation and clock-probe correction before making them; the resulting two-case receipt remains 2/2, 5.011 seconds. Those receipts are not relabeled a single all-green authored run. This review supplies its own complete final joined receipt below.

One attempted auxiliary assertion audit used the older TypeScript compiler-API import shape; installed TypeScript 7's package root exposes version metadata, so that read-only script failed before comparison. It changed nothing. The subsequent exact whole-file normalization comparison succeeded and is stronger than the intended assertion-only comparison. Strict compilation uses the installed supported compiler entrypoint and passes.

## Verification and finite handoff

Pinned executable for every Node command: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (v24.13.0). Authorized local dependency symlink points to `/home/palimpsest/src/palimpsest/node_modules`. SQLite and module mocks print their standard experimental notices.

```sh
node --experimental-test-module-mocks --test --test-concurrency=1 deployment/development-controls-journal-review.test.ts
# 57/57 pass, 0 fail/cancel/skip/todo; 7794.610943 ms
# /tmp/control-journal-review-heldout.log
node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/development/acquire.test.ts evaluations/development/acquire-review.test.ts deployment/development-controls.test.ts deployment/development-controls-composition.test.ts deployment/development-controls-review.test.ts deployment/development-controls-rereview.test.ts
# 153/153 pass, 0 fail/cancel/skip/todo; 141525.053493 ms
# /tmp/control-journal-review-regressions.log
node node_modules/typescript/bin/tsc --noEmit
# exit 0; /tmp/control-journal-review-strict.log
git diff --exit-code 79d1c41 -- deployment/development-controls.ts
git diff --exit-code 088a372 0bcc8be -- packages/storage/index.ts evaluations/development/acquire.ts evaluations/development/acquisition-plan.ts evaluations/development/witness.ts
git diff --exit-code 02ce31b 088a372 -- evaluations/development/acquire.test.ts evaluations/development/acquire-review.test.ts
git diff --exit-code 0bcc8be -- . ':!docs/rewrite/evidence/A1-L08/development-controls-journal-review.md' ':!deployment/development-controls-journal-review.test.ts'
git diff --check
# all exit 0
```

The 153-case regression receipt contains all 83 cases in the two final recorder files plus all 70 cases in the four original control files. Total selected review coverage is **210 passing cases**. The independent R4 pending-physical-pressure positive now reaches and passes its original B/T/final assertions in 26,937.716 ms; this honest runtime is not hidden as the old quick capacity refusal. The full selected run's 141.525 seconds includes the control compositions and ordinary test-runner isolation. It is not a full-suite, full-workload, physical recovery or performance qualification. No test timed out, skipped or used a source overwrite/temporary production patch.

Finite review complete with the bounded acceptance above and a clean two-path handoff. The six old model-adapter snapshot failures are **not** repaired or accepted here; P2 owns separately declared adaptation. The active OD1 driver, its fourteen original failed compositions, future review-admission/preclaim inputs, private workload/checker validity, semantic control behavior, elapsed developmental transfer and H1 require their own exact joins/reviews. No physical/native runtime child, provider/network/private credential/Slack, push, publication or deployment occurred. Root owns central status and integration; no waiting for sibling repair is part of this completed goal.
