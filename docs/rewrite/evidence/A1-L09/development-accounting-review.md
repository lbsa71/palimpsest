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
