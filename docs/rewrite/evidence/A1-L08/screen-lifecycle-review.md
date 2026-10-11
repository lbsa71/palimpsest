# Independent S08/S09/S11/S12 lifecycle review

Reviewer `/root/a1_screen_lifecycle_review`; finite review goal: independently review remaining real product-screen lifecycle S08/S09/S11/S12 and hand off exact meaningful engineering evidence without live/Q3/H1 claims. Investigation branch `review/a1-screen-lifecycle-20261011`; final handoff branch `review/a1-screen-lifecycle-handoff-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/screen-lifecycle-review`. Initial implementation `02e6428`, then author preflight successor `aeea1cd`, based on the reviewed tool-retention source `e1b57ee`. Governing requirements RW04/RW10/RW16/RW19/RW20; L08 evaluation lane, rewrite workflow, completion-readiness screen mapping and frozen lifecycle plan apply. Reviewer owns only this evidence and `evaluations/product/lifecycle-review.test.ts`; author owns the four lifecycle implementation/author-test files. Production code and shared configuration remain untouched.

## Final disposition

**Accepted only as bounded public engineering evidence.** All four normal lifecycle cases and all four named rejection controls now have meaningful observed evidence across the preserved original matrix and separately authorized focused repair attempt. The original `c574445` eight-case aggregate remains failed and unchanged; this is not a claim that a single clean-source full matrix was rerun successfully. The reviewer launched no physical lifecycle process; author execution was serialized and authorized by root.

| Case | Accepted normal evidence | Meaningful negative evidence |
|---|---|---|
| S08 | `c4b8950` attempt2: 10 original-ledger request rows, real stopped predecessor/fresh process, retained unknown charge, authenticated correction, digest-bound write9/readback and delivered output | `c574445` attempt1: same process completes work; only the actual restart predicate fails |
| S09 | `c4b8950` attempt2: 72 rows, actual ordinary compaction with exact response/source digest/empty tool artifact, all32 note receipts, reduced retained context, final indigo artifact/output | `c574445` attempt1: short history completes but has no genuine compaction/context reduction |
| S11 | `c574445` attempt1: 4 rows, one local durable delivery, lost reply, charged host lookup/reconciliation, explicit resume and no replay | `c574445` attempt1: 6 rows, actual second ordinary delivery; only exactly-one/no-replay fails |
| S12 | `c4b8950` attempt2: 27 rows, admitted current payload actually loaded; resumed/plain/child current system layer; inspected accepted child integrated into completed parent/output | `c4b8950` attempt2: 27 rows, all12 non-profile checks pass; only current-profile/admission checks fail |

Executable source is `c4b8950`, but the focused attempt's full source closure includes one static predispatch evidence-document delta, described below. No production runtime, contracts, broker, configuration, network, paid provider, external Slack, credential or service changes were made by this review. Live competence, held-out Q3, parity, development, product admission and H1 remain unavailable/unaccepted. Synthetic fixture token values are not billed provider usage; interrupted physical outcomes retain unknown usage and full original reservation charges.

Read-only source review confirms S12 freezes both complete source closures using `freezeApplication`, validates them using `verifyApplication`, obtains engineering-only admission under the original synthetic host policy, materializes each frozen prompt, and spawns `lifecycle-child.ts` under that artifact's payload root. Relative application imports therefore use the corresponding frozen payload. These mechanisms support actual artifact loading, unlike merely attaching an unused manifest to mutable application execution. The synthetic judgment remains explicitly ineligible for product qualification.

## Reproduced assessment defects

The pure reviewer inputs are deliberately synthetic adversarial packets. They are never physical observations and establish only rejection behavior. All six checks falsely pass at `aeea1cd`:

| Counterexample | Incorrectly passing assessment |
|---|---|
| Checkpoint names `first-read` but no initial value4 effect, observation or receipt exists | `checkpoint-and-authenticated-correction-retained` |
| Correct final value9 and a write with invented `expectedSha256` unrelated to a boundary read | `real-corrected-artifact-readback` |
| Boundary root allowance temporarily increases and final allowance returns to original | `original-grant-clock-retained` |
| Existing per-run token allowance doubles while root allowance stays unchanged | `original-grant-clock-retained` |
| Existing run workspace changes on restart while root allowance stays unchanged | `original-grant-clock-retained` |
| Current first system message is followed by a second effective old system message | `current-owned-layer-across-resumed-plain-child` |

Command: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/product/lifecycle-review.test.ts` in the reviewer worktree. Initial five failures are preserved at `/home/palimpsest/migration/aeon-1-20261011/lifecycle-review-first-failures-aeea1cd.txt`; six-failure follow-up is `/home/palimpsest/migration/aeon-1-20261011/lifecycle-review-sixth-failure-aeea1cd.txt`. Each assertion expected rejection and observed `true` for the named check. No physical provider requests, network, credentials, external messaging or service actions were used.

Additional source findings sent to the author: require explicit durable direct output, bind S09's genuine compaction response/retained empty tool-definition artifact to its next ordinary reduced context, compare pre/post context and request ordering, preserve original run/authority/workspace/grants at each captured boundary, and make each named negative fail its intended predicate rather than any unrelated check. Retained old text in non-system history is permitted; an old effective system layer is not.

## Verification progression (preserved)

Independent replay at `aeea1cd` confirmed the author suite passes 18/18, zero skips, including complete prompt freezing/admission/materialization checks; output is retained at `/home/palimpsest/migration/aeon-1-20261011/lifecycle-review-author-pure-aeea1cd.txt`. Strict TypeScript checking also passed. Those positives coexist with the six reproduced assessor defects and do not waive them.

Root requested causal regression baselines: after tightening, each reviewer negative must start from a passing baseline for its target predicate and mutate only the intended condition. Sparse original repro packets must not produce vacuous greens from newly missing unrelated fields. Actual retained positive reports will also be copied and mutated after authorized execution.

The planned physical review covered retained positive/control reports, failures, source/payload/artifact hashes, original cumulative ledger/clock, host interventions and cleanup. The completed observations and distinct repair attempt are recorded below; original failures remain retained. Full live competence, held-out Q3, parity, development and H1 remain unverified regardless of engineering passes.

## Repaired assessor review at `b111708`

The author repaired all six reported checks and added explicit delivery, original effect-reservation linkage, exact synthetic provider-response artifacts, compaction response/summary/source/tool-definition binding, and named negative-control predicates. Reviewer tests now construct complete synthetic evidence for each target, assert that predicate passes, then apply one causal mutation; all six reject the mutations. The fixture construction follows the author’s current synthetic evidence shape, while review assertions and source analysis remain independent. Strict checking passes.

Root identified a remaining acquisition race: `captureLifecycle` read the operational SQLite namespaces and events through separate queries while the application process could still handle a held-request timeout. A paused response is not a transaction barrier. The reviewer agreed and requested the existing `OperationalStore.transaction` around capture, with no new collector framework. Root has not yet authorized the physical matrix.

## Final prephysical disposition at `c574445`

The existing transaction now encloses operational document/event/artifact/ledger capture. The fixed S09 task explicitly requests notes0..31, and its assessor requires all32 matching real note receipts while retaining the ordinary >60/retain20 compaction configuration. Reviewer causal negatives pass6/6 and strict checking passes at these source bytes. The joined author22/reviewer6 run at its immediate `b111708` predecessor passed28/28 with zero skips in9.2s; retained output is `/home/palimpsest/migration/aeon-1-20261011/lifecycle-review-pure-b111708.txt`. No physical command was run by this reviewer. Root was notified that the fixed local-only eight-case matrix is ready for its serialized window.

Original failure output SHA256 values: five-repro `929787f7ece7c35de203341bd16881a34b7067d0e8be0287002b23dc4d547069`; six-repro `3ff2097b770d0dbf28057f6d7272af17db7d585c675e7e2e891d3e99fe01934d`. These are preserved failures, not overwritten by repaired successes.

## First physical matrix: retained failure at `c574445`

Author executed the root-serialized frozen eight-case matrix at `/home/palimpsest/migration/aeon-1-20261011/lifecycle-artifacts-c574445`. Reviewer did not launch additional physical execution. Independent offline replay reproduced all eight stored assessments exactly. The review index with exact report SHA256 values and eight causal mutations is `/home/palimpsest/migration/aeon-1-20261011/lifecycle-review-observed-c574445.json`.

| Case | Original request rows | Observed result |
|---|---:|---|
| S08 normal | 3 | Real SIGKILL/restart, retained read4/checkpoint and unknown charge pass, but the host accepts transient recovery `waiting` and closes the successor before correction completes; final execution says `Worker cancelled`. Completion, write9/readback and output remain failed. |
| S09 normal | 126 | Two real compactions occurred (prefix42 then41), at unchanged >60/retain20 configuration. Fixture response counter was keyed by `hostContext.runId`, which disappeared from the compacted context, so the fixture reread notes and exhausted the unchanged64-request slice. Outcome remains blocked. |
| S11 normal | 4 | Pass: one durable SQLite delivery, one lost-reply uncertain charge, one accounted host receipt lookup, explicit resume and no replay. Local receiver only; no Slack network observation. |
| S12 normal | 24 | Current admitted payload loaded; old/current/plain/resumed/child instruction checks pass. The child completed, was inspected and accepted. Premature parent close left the answer write uncertain and parent `Worker cancelled`, so integrated completion/output remain failed. |

All four named negatives reject their intended predicate with no acquisition exception: same-process S08, short-history S09, duplicate-delivery S11 and retained-old-system S12. S12 also has the same unfinished-parent failure as its normal case, so it is not represented as an otherwise complete control.

The reviewer applied the six original causal mutations directly to real retained witnesses whose targeted predicates first passed (S12 supplies the passing write9/readback target; incomplete whole-case outcomes are not promoted). Two additional S11 mutations remove host reconciliation and add a second receipt. All eight target checks reject after the single mutation. Original reports were read only and remain unchanged.

Evidence justifies two narrow author repairs: wait for an actually completed resumed run before host stop, and retain the fixed S09 fixture sequence/routing context across compaction. Its final speech also needs the original observed routing target after the compacted transcript omits the original host frame. These are fixture/driver corrections, not grounds for changing runtime, grants, thresholds, deadlines or acceptance. Root must separately freeze/authorize a new engineering revision and attempt. The first failed matrix remains part of the handoff.

## Source repair review at `c4b8950`

The corrected IPC path joins the actual `AutarkApplication.resume` promise. It uses the exact authenticated steering sequence only to decide whether the joined predecessor turn left a correction unconsumed, allowing one join of that pending turn. It never retries a consumed failed/blocked turn. `messageSequence` can advance at a checkpoint before work finishes; it is expressly not used alone as a completion condition. The independent reviewer probe holds both predecessor and corrected promises, proves no reply while the corrected checkpoint is already consumed but still running, then observes completed status. A mutant restoring the original immediate stale-waiting reply is required to fail this same probe.

The fixed S09 public provider fixture retains its first observed run/routing frame across genuine compaction. It does not inject that frame into runtime history or change application compaction. Author tests exercise notes30/31, write, read, and explicit speech to the original route with the current host frame absent. Reviewer7/7 and strict checking pass on `c4b8950` code; root received readiness for only S08 normal, S09 normal, S12 normal and S12 retained-old-profile attempt2, preserving all original failed reports and unchanged grants/thresholds. The S12 negative must now complete all non-profile integration criteria.

Additional first-matrix integrity index: `/home/palimpsest/migration/aeon-1-20261011/lifecycle-review-raw-c574445.json`. Read-only SQLite comparisons match all final namespace rows/event streams and every retained initial/boundary/final artifact byte; final workspace files match, and all219 source-manifest SHA256 values match `git archive c574445` in every case.

## Completed focused evidence and provenance audit

Focused reports live at `/home/palimpsest/migration/aeon-1-20261011/lifecycle-artifacts-c4b8950`. Reviewer replay matched every stored assessment exactly. The old-profile S12 control was checked more strictly than the focused script aggregate: all12 non-profile checks are true, including parent completion, explicit output, accepted/inspected child and integrated artifact. It fails exactly `actual-admitted-prompt-only-successor-loaded` and `current-owned-layer-across-resumed-plain-child`.

Thirteen additional mutations of copied actual positive witnesses each start with a passing target, then reject one changed condition: missing read4 observation, invented write digest, changed boundary allowance, enlarged run allocation, switched workspace, reused process identity, removed delivered effect, removed empty compaction tool fragment, missing compaction response, missing final note read, added old effective system message, missing child inspection and replaced integrated child output. Original evidence was never edited.

Raw-store checks compare every final namespace row and event, every retained initial/boundary/final artifact byte, and every retained output file against read-only SQLite/workspaces. Accounting checks compare ledger totals with physical reservations, unchanged root budgets across phases, original unknown charges, finite elapsed bounds and actual disappearance of every observed process/descendant identity. Both original S11 receiver stores independently match recorded delivery/call rows. All eight original report hashes and the failed aggregate remain unchanged.

The predispatch documentation delta is an explicit departure from a clean Git-source freeze, not an acceptance waiver. Exact retained file `predispatch-screen-lifecycle.md` has SHA256 `e39224afef0fd8c4529be98615e41a48d24e70e35d28f0d614c1120a705ffd27`; `predispatch-author-evidence-only.diff` has SHA256 `a422fe2fc6e7b1a974ae7f4fc0b83275495a08ad887b5a8d083f3eff1dc54713`. The reviewer compared all1167 files of each of the four actual S12 frozen artifacts against its manifest. All515 tracked files match `git archive c4b8950` except exactly `docs/rewrite/evidence/A1-L08/screen-lifecycle.md` with the declared hash; the other652 files are the retained pinned check/build toolchain under `node_modules`. Independent `verifyApplication` succeeds for each artifact and all materialized prompts match their frozen input. Executable, dependency, configuration, model and controls remain identical between each old/current pair; prompt identity changes as declared. Do not describe the full closure as untouched `c4b8950`.

Independent machine-readable review indices are outside the checkout at `/home/palimpsest/migration/aeon-1-20261011/`:

- `lifecycle-review-observed-c4b8950.json`: exact focused report hashes, assessment replay and13 actual-positive causal mutation results.
- `lifecycle-review-raw-c4b8950.json`: raw store/output/source correspondence and all four1167-file closure comparisons.
- `lifecycle-review-frozen-c4b8950.json`: independent frozen application identity and materialized-prompt verification.
- `lifecycle-review-accounting-c4b8950.json`: original grants/clocks, physical totals, unknown charges and observed process cleanup.
- `lifecycle-review-observed-c574445.json` and `lifecycle-review-raw-c574445.json`: original failures and their independent integrity/mutation review.

Final verification command `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/product/lifecycle.test.ts evaluations/product/lifecycle-review.test.ts` passes32/32 with zero skips in17.4s (author25 plus reviewer7); output is `lifecycle-review-final-pure-c4b8950.txt` beside the indices. `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit` and `git diff --check` pass. The seven committed reviewer tests include explicit valid target baselines and a mutation proving the old stale-waiting reply fails the correction-completion probe.

The finite review is complete with no unresolved engineering finding in the authorized scope. Root owns integration, central lane status and every later empirical or release decision. The final review handoff commit contains only this evidence file and `evaluations/product/lifecycle-review.test.ts`, based on author `c4b8950`; prior investigation commits and all failed external reports remain retained. There is no live/Q3/parity/development/H1 claim.
