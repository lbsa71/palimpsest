# A1-L08/L09 external dispatcher review

Owner: `/root/a1_dispatch_review`. Frozen review base: `e015cdf` (including the external dispatcher and interrupted-snapshot cleanup). Isolated worktree: `/home/palimpsest/migration/aeon-1-20261011/dispatch-review`, branch `codex/a1-dispatch-review-20261011`. Root owns lane coordination; this reviewer owns `deployment/evaluation-dispatch.ts`, its test file, and this evidence file. Author resource-accounting and launch-gate changes are coordinated separately.

Status: **finite consequential engineering review complete; joined behavior fixture-verified**. Full L08/L09 acceptance and live H1 remain open.

Finite goal: review the frozen durable external dispatcher, reproduce and fix concrete authority/privacy/recovery defects without weakening qualification, then hand off exact changes and observed checks. This is fresh consequential engineering review under RW09/RW10/RW15/RW16/RW18/RW19, not live reviewer qualification or H1 acceptance. No paid calls, Slack sends, production installation, or pushes are permitted or performed.

## Reproduced defect and repair

`processPending` copied arbitrary exception messages into public dispatcher status and `host.evaluation-dispatch` in shared operational storage. A malformed reviewer response can produce a `JSON.parse` exception containing private stdout; filesystem exceptions can contain private closure/key paths. The light regression supplies a real JSON parser exception through the host policy callback and observes the same public error boundary. On the frozen implementation it fails with `Public status must not echo private exception text` (`true !== false`).

Commit `8746074` replaces raw exception propagation with fixed evaluation/submission failure categories and the stable-job reconciliation instruction. The job remains uncertain; this change does not fabricate a result, discard its durable identity, retry it, or change admission. No raw exception text is written into shared status. The two existing physical lost-response checks now expect those public categories.

Cleanup checks additionally demonstrate that redirected snapshot roots and symlink snapshot entries are refused, while cleanup of a valid interrupted snapshot removes a nested link without following it or deleting its private target. The initial cleanup-test setup used `rmSync` on a directory symlink and encountered `ERR_FS_EISDIR`; replacing that setup operation with `unlinkSync` corrected the fixture. No production cleanup defect was inferred from that fixture error.

## Independent checks

All commands use Node `v24.13.0` from `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin`; the worktree references the existing installed development dependencies.

- `node --test --test-name-pattern='dispatcher failure diagnostics' deployment/evaluation-dispatch.test.ts`: before repair, 0 passed / 1 failed; after repair, 1 passed.
- `node --test --test-name-pattern='dispatcher failure diagnostics|interrupted snapshot cleanup' deployment/evaluation-dispatch.test.ts`: 2 passed after fixture correction, including after integration of author `a2d8830` (local cherry-pick `4e4e320`).
- `node --test deployment/evaluation-resources.test.ts`: independently reran author `a2d8830`, 5 passed. Cancellation/expiry prelaunch, retained tool-receiver concurrency, measured success, cancellation during dispatch, and reopened reserved/dispatched accounting are covered.
- `node --test deployment/evaluation-resources.test.ts`: independently reran author `d32bdca` (local `eab3944`), 7 passed, including physical launch holding authority/cancellation write locks against another process and cancellation fencing late receipt advancement while retaining known physical usage.
- `node --test --test-concurrency=1 deployment/evaluation-dispatch.test.ts deployment/evaluation-resources.test.ts deployment/evolution-mailbox.test.ts`: **28 passed, 0 failed, 0 skipped, 0 cancelled**, 88.1 seconds, at frozen implementation/test revision `70b79d72896b7f56b9832e21680bfb4ead160c07`. Temporary full output: `/tmp/aeon-dispatch-review-70b79d7.txt`. This reviewer held the coordinated heavy-test window; test files were serial. The draft of this evidence document was present in the fixture source copy, with no source mutations during the run.
- Author test-only `1f8cf6d` (local `b738715`) additionally verifies that another process sees the **committed** `dispatched` request during the locked physical launch. Independent resource-test rerun: 7 passed. This assertion would reject the earlier unsafe placement of the marker inside the still-uncommitted launch transaction. Production source is unchanged from the full 28-case run.
- `npm run check` and `npm run build`: passed after the final test-only integration.
- `git diff --check`: passed.

## Review disposition and handoff

The author accounting patch addresses the separately identified missing ResourceLedger lineage reservations. Review identified that physical launch also needs serialization against other-process authority withdrawal/cancellation; author `d32bdca` supplies that correction, independently checked above. Successful `spawnBounded` setup runs synchronously until it returns its Promise, so the `await` keyword alone was not evidence of a same-process launch race. The cross-process check/launch boundary is the relevant concern. The physical marker is committed before the locked launch so a host crash cannot roll it back to a supposedly undispatched/free reservation. The authority and operational transactions then recheck liveness and hold through launch; completion rechecks lineage under the same locks. A known rejected prelaunch settles failed/zero elapsed; an interrupted physical review retains uncertainty and its ceiling.

A completed author run can legitimately leave an already queued review pending. This review does not impose a blanket terminal-run prohibition; cancellation, withdrawn authority, allocation lineage and elapsed limits remain the relevant fences. Likewise, cancellation must not erase a previously authenticated, durably settled external outcome.

The full frozen-process suite passed. Added reviewer commit `70b79d7` covers authenticated inconclusive feedback, forged negative authentication, and authority withdrawal before signed-result acceptance. Physical closure execution, unavailable reviewer recovery with a truthful pending job, timeout cleanup, lost-response/restart uncertainty without replay, changed closure/arguments rejection, and exact supervisor staging also pass. No additional reproduced defect remains unresolved within this bounded review.

Integrate the author's original commits `a2d8830`, `d32bdca`, `1f8cf6d`, then this reviewer's `8746074`, `70b79d7`, and the commit containing this evidence document. Do not also cherry-pick the local equivalents `4e4e320`, `eab3944`, or `b738715`. The implementation/test handoff head is `b738715`; the final evidence-only revision is reported with the handoff. Root owns joined integration and lane/execution status updates.

Synthetic source-observation success remains explicitly engineering-only. No score threshold, independence rule, policy binding, evaluator identity, H1 requirement, or live competence gate is relaxed. Real cgroup-enforced product launch and live private reviewers remain outside this fixture evidence.
