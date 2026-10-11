# A1-L08 native persistent recovery independent review

Status: claimed; source review in progress; actual acquired continuation evidence pending. Owner `/root/a1_native_recovery_review`, branch `codex/a1-native-recovery-review-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/native-recovery-review`, author source `7b2ba85` and evidence base `be5bec8`. Exclusive writable files: this document and new `evaluations/baselines/native-recovery-review.test.ts`. Existing source, author tests, historical evidence, runtime/build/dependencies remain read-only. Actual finite review goal is active without a token budget.

```text
/goal Independently review the native-recovery specification and exact author source, preserve causal failures and repaired checks, audit root's later exact native acquisition evidence, and hand off bounded acceptance without claiming live competence, parity, growth or H1.
```

Pre-code behavioral review claims: genuine ready checkpoints require successful native exit, completed attributable tools/children, drained host RPCs and confinement cleanup under a held lease. Original grant, clock, ledger, source/configuration and workspace identity survive continuation; ready consumption is irreversible and dispatch waits for the observed same native identity. Model messages cannot invent completion or cleanup. Ordinary runs retain their cancellation/replay boundary. Opaque native bytes and instruction/history acquisition are not established by synthetic tests.

Review commands and first failures are retained externally at `/home/palimpsest/migration/aeon-1-20261011/native-recovery-review-evidence`. Only bounded pure tests using Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, serial test concurrency, module mocks and strict compilation are authorized here. No physical/native CLI/help/process/kernel experiment or external effects. Root owns any later physical window; acquisition failure blocks positive and does not authorize retry.

Inputs read: root AGENTS/REQUIREMENTS/PLAN, rewrite workflow, A1-L08 lane, native-recovery specification and author evidence. Initial convenience read of `packages/supervisor/worker-protocol.ts` found no file; correct import will be followed. No behavior has yet been accepted by this review.

## First source review: acceptance withheld

At author `7b2ba85`/evidence `be5bec8`, new independent controls report **1 passed, 6 failed, zero skipped**; strict TypeScript passes. The successful control parses the exact 16,886-byte native stdout from `/home/palimpsest/migration/aeon-1-20261011/claude-handback-physical-evidence/claude-handback-followup-1-8PosR0/result.json` (outcome artifact `c91f7a7e9609234509fc4fce40d6fc9bed295f8e1a297fdacf0ee598e4206688`, stdout SHA256 `140f12fe36ed905123cccf7135591da6ee6ea816d604bf88629fd0c7ef878239`). This is the previous native hand-back run, not a recovery acquisition. Its whole unchanged stdout is embedded in the new review test; each mutation first rechecks the acquired positive.

Findings requiring author disposition before source acceptance:

- **P2 — Explicit Claude tool failure can become quiescent.** `NativeSessionEvents` accepts `part.is_error === true` when the surrounding acquired Agent `tool_use_result.status` is `completed`. Setting only the explicit error flag in an acquired successful result still permits `finish()`. An explicit negative result must never be overridden by completion metadata; legitimate acquired results with omitted `is_error` must remain supported.
- **P2 — Claude child completion is insufficiently attributed.** A task notification with a changed original `run_id` or `tool_use_id` still deletes the task, and a child tool result with a changed original `parent_tool_use_id` still deletes the tool. A completed `task_id` can also be started/completed again. Four independent mutations pass the existing gate. Bind the acquired task/run/call and child parent relationships and retain completion uniqueness, without guessing unsupported native schemas or rejecting the original acquired positive.
- **P2 — Actual host kernel identity is absent from immutable continuation identity.** The specification records resource-limit configuration and host binary hashes but no host kernel release/build identity. A runner test uses only module mocks for `node:os` and `runWorker`, publishes a synthetic ready checkpoint, changes mocked release/version, and observes a second launch/dispatch rather than refusal. The repair must bind actual kernel identity before consuming readiness; do not accept caller-supplied kernel labels as proof. No host kernel experiment was performed.

The cleanup review has not found a public-runner forgery: `runNativeBaseline` creates its cleanup artifact only after `runWorker` resolves; `runWorker` awaits confinement cleanup in `finally`, and a cleanup error rejects that call. `NativeRecovery.publish` is an exported trusted host helper and accepts caller artifacts/outcome; it must not be treated as an independently secure public admission API. Review acceptance relies on the runner call path and private store, not artifact text alone. Root/author should make that trust scope explicit; adding caller-supplied proof to the runner is not an acceptable repair.

The prior Codex attribution repair is causally appropriate on source inspection: a started operation records type and command/collaboration identity, completion must match, completion IDs cannot repeat, and acquired unstarted reasoning/agent-message completion remains permitted. Existing author controls preserve actual acquired positives. No full baseline sweep or native run was performed by this reviewer.

Commands:

```sh
env -i /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/baselines/native-recovery-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The first five parser failures are preserved in `native-recovery-review-evidence/review-first.log`, SHA256 `9ecbcdcad6e3d5e8d85d8ad30dc84506f1dc3410666593429e9945863bdd697a`. The subsequent six-failure run, including kernel causality, is `review-kernel-first.log`, SHA256 `7cc0ad9c96b7c00d2088ecc14cb07265efbb7cf8119ee908adb495aa9968a552`. `strict-first.log` is the successful empty strict-compiler output. All locations are beneath the external directory recorded above. Initial failed convenience reads also included `native-recovery-quiescence.test.ts` and `source-identity.ts`; actual source was followed through imports and file discovery.

Handoff: author owns repairs in its existing files; reviewer owns these new regressions. Root must retain the initial failing logs, integrate the exact repair and arrange renewed source review before any native recovery acquisition. The actual finite review goal remains **active**, pending repair verification and later exact acquired evidence audit. This is neither source-ready acceptance nor full review completion, and it establishes no native recovery/history/flush behavior, context reduction, live competence, parity, growth or H1.
