# Fresh original-grant accounting review

Reviewer `/root/a1_development_accounting_review`, branch `codex/a1-development-accounting-review-20261011`, frozen source `21619386698f52d5d4f8b0a938fc6374cb79f544` (bridge `b37854d`, repaired envelope included). Actual finite goal started before inspection. Root owns A1-L09 and production repair; this reviewer owns only this evidence and the two new review test files.

## Pre-code scope and failure hypotheses

Frozen before review tests, 2026-10-11. Requirements RW10/RW15/RW16/RW19 and the original-grant accounting specification govern this review. Inspect exact bridge, application factory, broker entry/response interception and bounded operational artifact read. Test public behavior through real SQLite ledgers, fake host transport/receivers and bounded data. No native worker, physical acquisition, network/provider, account, deployment, push or root aggregate is authorized here.

Independent hypotheses:

1. Cancellation or expiry of a nested allocation between durable dispatch and immediate provider/receiver entry might escape the role-only live check. The whole request lineage must remain authorized at entry, while an already dispatched authentic late response remains retainable and settleable.
2. Changed original immutable anchors, profiles, configurations, mappings and allocation lineage must refuse work. Scoped restart must preserve other roles, lifetime and orphans, with no additional allowance or replay.
3. Original reserve/transition atomicity must survive transition failure and local rollback. Candidate shared state must charge once. Unknown transport cannot release ceilings; known usage needs retained raw evidence. Retry/compaction identifiers must remain distinct and parent-linked.
4. Prompt/fragments are written before `reserveEvidence`; an aborted draft or reservation failure must still be charged to the finite recorder. This is an explicit recorder dependency, not a joined claim from a successful bridge callback fixture.
5. A bounded operational read must inspect SQLite storage type and actual byte length before selecting the BLOB, reject Unicode TEXT and oversized/corrupt/foreign references, permit a valid empty BLOB with zero bound, and prevent a competing mutation between size check and read.

Tests will retain causal failures at the pre-repair revision before owner fixes. Acceptance distinguishes fixture mechanics from physical composition, external clock/context/observer qualification, competence, growth, lane admission and H1. The envelope's unsupported manual cancellation during the tail remains a truthful unavailable closure; no false cancellation flag is permitted. Separate SQLite stores are separate commits, never a distributed transaction.

## Causal failure checkpoint: R1

On unchanged source `2161938`, Node 24 command `node --test deployment/development-accounting-review.test.ts` returned **11 tests: 6 passed, 5 failed, zero skipped/cancelled**, exit 1. All five failures are one consequential **P1** defect: after original durable dispatch, `entered()` checks live role/root authority and dispatched status but omits the physical request's nested allocation lineage. Cancelling the child or parent, or advancing past either intermediate deadline while still inside the root/behavioral window, leaves `assertEntry()` successful. The actual wrapped effect receiver is also entered after parent cancellation. The tests expected refusal and observed missing exceptions/rejection.

The positive late-response control passes: authentic response retention and trusted settlement still work after nested cancellation and root expiry. Other passing controls establish real original reserve/transition rollback, held original orphan after local failure/replacement, role-scoped recovery without releasing charges, one shared candidate charge, and refusal to accept known usage without raw retention. Repair must fence every ancestor at immediate entry without changing late settlement authority, increasing allowance or rewriting historical failure evidence.

## Additional independent controls before repair

Four new bounded SQLite controls passed: real UTF-8 BLOB byte length and valid zero; foreign URI refusal before BLOB allocation; Unicode TEXT and integer storage refusal; same-size corrupted BLOB hash refusal; and competing mutation refusal during a bounded read nested inside a caller transaction. The final item uses actual independent SQLite connections and a lock attempt at BLOB selection. Command `node --test packages/storage/test/storage-bounds-review.test.ts`: **4 passed**, zero failed/skipped/cancelled.

Three further bridge controls passed on the same original production source: an uncertain pre-registration anchor refuses construction and stays uncertain; changed settled anchor bytes fence immediate entry; retry/compaction requests retain distinct mapped identities and parent provenance while consumed IDs refuse replay. Targeted command `node --test --test-name-pattern='pre-registration|changed settled|retry and' deployment/development-accounting-review.test.ts`: **3 passed**, zero failed/skipped/cancelled.

Initial `npm run check` could not locate `tsc` because this isolated worktree lacked dependencies (exit 127). Root authorized an ignored symlink to the existing pinned `/home/palimpsest/src/palimpsest/node_modules`; no dependency install occurred. Normal `npm run check` with Node 24 PATH then passed twice, including the complete review source. This setup failure was not a product defect.

The root is the sole production repair writer in the original author's idle worktree. Its forthcoming optional trusted `retainResponse(mappedRequestId, bytes)` hook extends review scope: model, effect and reconciliation replies must consume their own reserved capacity and retain exact hashed bytes, even if subsequent draft capture is refused. The finite recorder's accounting of every preceding draft/fragment remains a downstream integration obligation. A separate document-mutation journal has another owner and is outside this review.

## Independent repair verification and final disposition

**R1 is resolved. The reviewed bridge and optional SQLite bound are accepted as bounded source-level engineering, subject to the integration limits below.** Exact production repair `c022227fdbb62d692efa34dd1ef1e750812ea83e` and its prior specification `e86f5667a856c60299637b59a11f093c1b6b26bb` were inspected and imported as `54ad87b` / `f59e6e1`. Production source remains exclusively author/root written. This reviewer changed only the three reserved review paths. The evidence cherry-pick initially conflicted because the reviewer base lacked the author's final evidence follow-up; it was resolved by importing the exact author specification document. An accidentally continued test command during that conflict reran the unchanged old source: 13 passed / the same five R1 failures. That was not a repair failure. Tests were rerun after the production import completed.

The repair performs the immediate entry check under one original-store transaction, verifies tracked registration/role and accepted lineage, checks cancellation including the actual request allocation, and compares every ancestor's elapsed ceiling against both its original wall lifetime and cumulative charged elapsed time. It does not reauthorize a consumed identity or change response/settlement authority. All original five rejection predicates pass unchanged. The legitimate late-response control still passes. A new positive control confirms that cancelling one role preserves another role's live entry.

The optional trusted `retainResponse` receives the mapped physical request ID and copied original bytes. The bridge checks its finite byte cap, original dispatched/uncertain role binding, original bytes' digest, returned artifact digest and a bounded retained read. The actual model response, effect reply and separately charged reconciliation reply paths use it; ordinary absent-hook behavior remains available. Independent new controls verify two roles with the same local request ID route replies to distinct original reservations, in reverse order after draft exhaustion and root cancellation/expiry. A throwing hook and a hook that mutates its supplied bytes and substitutes a matching artifact both fail; worker-reported zero usage cannot release the original held charges. Author effect/reconciliation variants also passed independently below. This verifies the bridge interface, not an implemented recorder's total-byte reservation policy.

Final independently executed commands used `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin` first on `PATH`:

```text
node --test --test-concurrency=1 deployment/development-accounting-review.test.ts deployment/development-accounting.test.ts packages/storage/test/storage-bounds-review.test.ts packages/storage/test/storage-bounds.test.ts packages/storage/test/storage.test.ts deployment/provider-gateway.test.ts
71 passed, 0 failed, 0 cancelled, 0 skipped; exit 0 (10.448 seconds)
npm run check
normal strict TypeScript compilation passed; exit 0
git diff --check
passed
```

The 71 checks contain **22 independent reviewer cases** (18 bridge, four storage), 36 author bridge cases, seven author bounds cases, four existing storage cases and two mocked gateway/receipt cases. The 22 reviewer-only cases also passed immediately after import and new-hook controls. No original causal predicate was weakened. Source inspection confirms the application factory is trusted construction-only, not candidate model configuration; the actual runtime uses its ledger/shell/effect wrappers; the broker checks entry immediately before `performRequest`, retains raw response before interpretation, and supplies the finite response limit to the streaming gateway. Custom `performRequest` callbacks still return an already allocated string and need separate qualification for preallocation claims.

### Remaining boundaries and handoff

- The finite recorder must account for all draft payload, fragment and manifest writes before reservation, including aborted drafts and failed physical reservations, and preserve each admitted response's reserved capacity. These are explicit downstream recorder acceptance obligations. Callback fixture success is not joined recorder/envelope acceptance.
- Actual confined Pi invocation, native process boundaries and full acquisition/envelope composition remain root's later serialized window. This review used real SQLite, durable runtime/journal fixtures, fake effect receivers and mocked provider transport only. It did not run the physical aggregate or a network/provider/account operation.
- The immutable quiescent original boundary is deliberately conservative: pre-registration uncertainty is refused, changed anchors are fenced, and an orphan consumed reservation blocks continuation. Separate local/original databases have separate commits; a local failure can leave consumed authoritative original state. No cross-database atomicity or transparent recovery is claimed.
- Full role/configuration/closure bindings and request lineage are mechanical provenance, not independent proof of source completeness, competent roles, isolated fresh contexts, correct real clock observation or three real developmental intervals. Those qualifications remain external.
- The repaired envelope's unsupported manual cancellation during T must retain actual cancellation and charges and report unavailable closure. No false flag, enlarged allowance or fresh grant is accepted. Capacity for five transitions remains finite; further reconciliation refuses.
- The separate document-mutation journal is outside this source review. Growth, model-review competence, live access, parity, autonomy, deployment, lane completion, automatic admission and H1 are not established.

Root receives the clean reviewer test/evidence commit and owns recorder integration, exact-source physical composition and later acceptance. This finite review goal is complete; the broader Aeon goal remains separate.
