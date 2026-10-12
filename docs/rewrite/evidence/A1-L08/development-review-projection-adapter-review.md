# CP2-P3 independent bounded adapter review

2026-10-12. Owner `/root/a1_development_p2_review`, fresh astra/high review; actual finite tool goal created before inspection. Claim: root `99e0765`, execution record read only. Review checkout `3fd78a19b06ac1369ec49619950a3798cbf082c5`, incorporating P2 source `52c0ea05f7d88271c6e619cc85c1290a57fbdddf`. Final author evidence `409fe11` read through git. Exclusive writes: this NEW evidence file and NEW `evaluations/development/review-projection-adapter-review.test.ts`. Production and existing tests remain read only.

## Frozen independent predicates (before tests)

1. Missing/substituted accepted session, host, template, context, or instruction bytes must reject before raw-store growth, recorder ownership, reviewer claims or original request allocation. A valid externally accepted fixture must still admit. Mutation of the accepted descriptor after recorder claim must not acquire reviewer admission.
2. Concrete preclaim reservations include distinct raw draft, raw response, local response, observation, claim, binding and read-entry copies. Protect review draft slots independently of bytes. A forged actual reservation, undersized slot budget, repeated escaped instruction aggregate, or insufficient checkpoint singleton must reject without borrowing another pool or changing a consumed grant.
3. Current-use callback reads require exact durable inventory membership and an explicit operational bound. Leaked readers after success, throw and hostile thenable callbacks cannot read. Recursive entry and source/owner writes are rejected; stale source withdrawal prevents callback invocation. A refused callback does not silently invalidate otherwise current evidence.
4. An actual dispatched request can bind a retained response whose bytes were already charged to any original pool, without relabeling/refunding that inventory or creating another raw copy. Unmapped, cross-request, aliased, changed-stream, oversized and terminal-undispatched response attempts refuse. The immutable mapped response remains readable after withdrawal and failed phase, and a genuinely pending receiver settles late against its original request. New work remains refused.
5. Real in-process Pi/broker/recorder review using mocked transport must preserve original request counts, exact receipt settlements, read-before-final provenance and finite one-use claims. Concurrent/replayed entry must not create additional physical calls. Hostile input/read attempts or failed final decoding retain truthful unavailable results and accounted successful reads. Authentic response arrival after withdrawal is retained without allowing another reviewer/model request.

Tests may reuse ONLY the public test-only `pagedRecorderFixture(t,true)` setup and use independently written orchestration/assertions. No consumer or old snapshot fixtures are changed. Assertions are behavioral and copy-accounting causal checks, not prose tests or source-text tests. Small synthetic SQLite/in-process mocked provider only; pinned Node24, explicit module mocks, targeted new/author component tests and strict. No physical/native/provider/network/private credentials/Slack/push/deploy/full benchmark or full126 trace.

## Prior evidence and receipt discipline

Author new profile:29/29 pass. Old authored-base model regression:84 total,78 pass,6 old250000-byte snapshot failures; component:167 total,159 pass,8 old capacity failures. Root separately owns fixture corrections; this review does not waive or retest those broad files. No live/model competence/full-workload/H1 claim follows from this bounded disposition.

Inspection command initially named a nonexistent lane file `A1-L08-development-evaluation.md`; command failed after successfully reading REQUIREMENTS/PLAN. Correct lane `A1-L08-evaluation.md` was then read. This is an inspection-path error, not a runtime test failure.

Results and final disposition will be appended after execution, preserving all failed attempts and distinguishing test setup errors from source defects.

## Independent finding P3-R1 — owner callback fence permits mutation and stale release

**Changes required (P1).** `acquire.ts:578` wraps the recorder and optional custodian stores in ordinary writable `transaction` calls. Its authority check runs before `use()`. The captured role stores do receive `withDevelopmentVersionsAvailable` write fences at line579, which correctly refuse source writes; the owner stores do not. `withEvidenceRead` at line289 checks lease liveness, exact inventory and size, but does not recheck authority after callback-controlled owner mutation.

The independent causal case invokes the actual public `withdrawAttemptUse('inside-scoped-read')` inside `withEvidenceRead`, then calls the supplied reader. The source returns normally after releasing bytes; the signed withdrawal marker survives the outer transaction. A separate case uses public `withCurrentUse` to write an ordinary owner document; that write commits and no exception occurs. Thus this is a shared current-use owner-store fence gap exposed by the new read lease, not a byte-identity or synthetic provider defect. It violates the frozen P2 callback-write contract and the existing `withCurrentUse` source/ledger/state-read-only contract. The tests do not claim an untrusted model can access the host store directly.

Repair belongs to the owner. Reuse the existing storage write-fence mechanism (`OperationalStore.assertDevelopmentWrite` and private `withDevelopmentReadFence`, storage lines121–129) for owner/custodian participation in current-use callbacks, through an explicitly owned narrow API if necessary. Do not invent historical journal/cut metadata for owner stores to get access to that fence. Preserve ordinary final-cut writes, terminal marker persistence after an observed refusal, and original-request late-response maintenance. Guarding only recorder mutators misses direct owner/custodian store writes; checking only after the callback misses byte release inside it. No source edit or repair is performed in this review. The exact shared API repair and legacy branch implications require the owner's separate frozen task.

## Preserved execution attempts

- Initial strict check `/tmp/cp2-p3-strict-first.log`: passed. The first independent test draft ran17 cases,13 passed/4 failed/0 skipped in61.284s (`/tmp/cp2-p3-independent-first.log`). The owner-write assertion was a genuine missing-refusal red. Two failures compared inert null-prototype inventory objects against `structuredClone` objects using prototype-sensitive deep equality; those test assertions now compare canonical identity while preserving every inventory field. One setup attempted to make an undispatched request terminal using untrusted worker advice; the bridge correctly required trusted non-dispatch proof. The final fixture explicitly asserts that denial and uses the real host ledger's supported reserved→failed transition before challenging response maintenance. These three were fixture errors, not source defects.
- The targeted second diagnostic selected five cases:4 passed/1 failed/0 skipped in53.295s (`/tmp/cp2-p3-targeted-second.log`). Source-pool deduplication, genuine terminal-undispatched refusal, authentic late draft-origin settlement and overlapping one-use entry passed. The sole remaining selected failure was withdrawal followed by successful scoped byte release. This was a named diagnostic subset, not full independent acceptance.
- Strict checks during refinement (`cp2-p3-strict-second.log`, `cp2-p3-strict-final.log`) passed. The committed test revision is `3fd9d69`; freeze revision is `aa7c304`. The final committed strict receipt is `/tmp/cp2-p3-strict-final-committed.log`.

## Final command manifest

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/development/acquisition-pages.test.ts evaluations/development/review-projection-adapter.test.ts evaluations/development/review-projection-adapter-review.test.ts > /tmp/cp2-p3-final-components.log 2>&1
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check > /tmp/cp2-p3-strict-final-committed.log 2>&1
git diff --check
git diff 52c0ea0 -- evaluations/development/acquire.ts evaluations/development/acquisition-plan.ts evaluations/development/model-review.ts evaluations/development/review-reservation.ts
```

The source comparison is empty. Existing tests and source files remain unchanged. The run uses real SQLite, Pi, broker, original ledger, recorder and final verifier with an explicitly mocked in-process worker/provider; no provider/network/physical/native task or broad regression file was run. Root's consumer join and v1 fixture inquiry are separate inputs, not this review's evidence.

The first evidence-append shell command emitted an unterminated heredoc warning and left literal patch markers in this owned document; a local formatting correction removed them. No runtime code or test result changed.

## Final observed causal diagnostics and bounded disposition

At committed independent test revision `3fd9d69`, all21 new cases executed:19 passed and2 failed, with no skips. Both failures are the single P3-R1 defect:

```json
{"disposition":"withdrawn","refusal":null,"releasedBytes":1501}
{"committed":true,"refusal":null}
```

The first diagnostic reads the persisted signed disposition after the outer current-use transaction has completed, so this is a committed withdrawal with stale release, not a rolled-back mutation. The second reads the owner document after the guard has returned. Positive controls retain the original inventory pools for source-origin and draft-origin responses, forbid cross-request/alias/changed-stream access, and settle genuine pending responses after historical source withdrawal and phase failure. Source writes, reentry, hostile thenables, escaped leases and newly stale callbacks refuse correctly. Accepted-identity mutations, changed instruction bytes, reused claimed descriptors and exhausted reserved slots refuse; original allocation/claims/raw usage remain unchanged where refusal must precede admission. Actual bounded receipts precede the final model request; successful and interrupted/overlapping one-use claims add no repeat physical calls. The synthetic unavailable judgments do not establish semantic review competence.

Disposition is **changes-required for the bounded joined P2 component**. Root is the next owner to serialize P3-R1 repair and fresh re-review against these unchanged independent predicates. This finite review is complete once the exact final component receipt and clean evidence revision are handed off. Consumer integration, old v1 fixture feasibility, source signing, actual compaction/provider workloads, full126/156 trace and H1 remain outside acceptance.

Final three-file receipt: **50 total,48 passed,2 failed,0 skipped,0 cancelled,211.561s**, process exit1. The unchanged author component cases are29/29 passing (18 paged recorder,11 adapter); the independent21 are19 passing/2 P3-R1 reds. The final command has no name filter. Strict exits0 and `git diff --check` passes. Test file SHA-256: `9440ed0d7a5f2314d2128c2eaa84d16392379a190d4d6940db3c8fbfff265672`. No timing/benchmark qualification is inferred.

Handoff consists only of the two reserved new paths, freeze `aa7c304`, exact tested code `3fd9d69`, and this final evidence commit. The finite independent review goal is complete; root's overall goal and P3-R1 repair remain active. No source fix or acceptance waiver is included.
