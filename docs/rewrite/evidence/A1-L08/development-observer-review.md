# A1-L08-OD2-a independent source review

Review owner `/root/a1_development_observer_review`; root claim `e1dc8fc`; branch `codex/a1-development-observer-review-20261012`. Exact author subject `ebbb96cc78b3c45e365f48ecabd7808de29159d2`, source `e4b2bb4`, pre-code `a495782`, accepted JR1 v2 base `5bc15dc`. Only this report and `evaluations/development/development-observer-review.test.ts` are writable. Production, author tests and earlier evidence are read-only.

Actual finite tool goal: independently review that source using frozen causal criteria, offline tests and source-bound evidence, ending with an accepted or changes-required handoff. Governing requirements RW09/RW10/RW18–20, AGENTS, workflow, L08 and ordinary-driver specification apply.

## Criteria frozen before independent tests

1. Retained canonical content-addressed bytes must reconstruct a complete v2 prefix, all intermediate versions and exact withdrawal graph. Missing, corrupt, duplicate, substituted or unsupported paged sources fail closed without manufacturing facts.
2. Before/after bound only new untimed events. Old selections cannot be restamped; raw host labels do not qualify time; caller-provided current is only a latest-known assumption. Withdrawal in an actually supplied later current must fence all used versions.
3. Cycle proofs must bind exact selected goal/scheduler/execution/run/admitted ancestry, newly reserved request, actual prompt/payload or tool effect and retained outcome. Cross-role/run/request/artifact substitution cannot produce an unsupported cycle. Self labels remain unknown origin.
4. Packet and actual communication input/steering identity must match. Reused runs must bind results to the message consumption associated with that specific result, including checkpoint, interruption and subsequent revision paths. Advancing a checkpoint must not assign an earlier result to a later revision.
5. All reads receive fixed bounds; output is bounded with failures retained. Malformed input and insufficient proof capacity must refuse. Unsigned proposed facts cannot imply accepted observations, completed success, semantic judgment, spontaneity, host independence or freshness authority.
6. Run author 27 cases and strict TypeScript with pinned Node, then independent small causal checks. Preserve any red checks unchanged; return defects to author instead of modifying production. No live/provider/native/host/mount/network/private-account or paged-source operations. Full-snapshot capacity remains a separate unresolved boundary, including root inquiry `a11b21a`.

Freeze recorded before independent fixture/test implementation; source reading suggests checkpoint/result consumption deserves an actual runtime causal check, not a fabricated row-only assertion.

## Disposition: changes required

The review criteria checkpoint is `9e8e462`; unchanged failing tests are retained at `be63324`. The reviewed production source remains exactly `ebbb96cc78b3c45e365f48ecabd7808de29159d2`. Two findings prevent acceptance of this unsigned projector as a trustworthy mechanical source for OD2-b. Neither finding claims that an unsigned projection has already admitted signed evidence.

### R1 — High: carried runtime result is attributed to later work

[Projector resultSource](../../../../evaluations/development/development-observer.ts#L170) reads the latest `execution` version, treats that document mutation as a new result boundary, and pairs its `lastResult` with the current top-level `messageSequence`. The source does **not** have an `execution.lastResult.messageSequence` field. [Runtime persistCheckpoint](../../../../packages/runtime/execution/index.ts#L102) copies the old execution state and advances the top-level cursor; the [failure path](../../../../packages/runtime/execution/index.ts#L145) also copies that state. Both preserve the prior `lastResult` without producing another shell result.

Two actual-runtime causal tests fail, with no handcrafted execution or result rows:

| Retained test | Actual sequence and observed unsupported projection |
|---|---|
| `review: new revision checkpoint cannot relabel an earlier result as consumed` | CommunicationsCore admits revision 1; the actual runtime returns a checkpointed result with `tool:review-tool:1`. Revision 2 steers the same run. A second shell invocation makes a new physical request, persists a checkpoint, then throws `review interruption after checkpoint`. Durable failure keeps the exact earlier result while advancing the cursor. The projector assigns revision 2 `{status:'checkpointed',messageSequence:36,observationIds:['tool:review-tool:1']}` instead of a null/unavailable result. |
| `review: later failed cycle cannot reuse a previous slice result` | The actual ordinary scheduler/InitiativeRunner executes one checkpointed slice. The next selected slice reuses that initiative run, makes a new physical request, checkpoints and throws. Its new execution mutation lies after selection, so the projector returns the previous slice's `{status:'checkpointed',messageSequence:21,observationIds:['tool:review-tool:1']}` as this slice's result instead of null. |

The repair must distinguish the source version/transition that **produced** a result from subsequent checkpoint/failure writes that carry it. Retain the result-producing invocation/run-step or equivalent unambiguous source event/version and the message-consumption boundary established by that invocation. A run ID, initiative admission step, latest execution mutation, current cursor, changed checkpoint, or request success is insufficient. If the existing retained source cannot distinguish an identical re-produced result from a carried result, preserve that ambiguity as unavailable; do not infer fresh production from equal or changed surrounding fields. Earlier supported assignment provenance may remain available, and the later failed physical opportunity must remain visible.

### R2 — Medium: later request row can substitute a different physical payload

[Request projection](../../../../evaluations/development/development-observer.ts#L194) loads the revision-1 reservation but only checks its run and reserved status. [Final-row linkage](../../../../evaluations/development/development-observer.ts#L201) validates the final request and uses **its** prompt identity/digest to resolve retained bytes; it never establishes that these immutable fields equal the reservation.

`review: a later request row cannot substitute an older physical prompt for its reservation` runs two actual ordinary slices, verifies their physical request digests differ, and then deliberately corrupts the second request's current row through `OperationalStore.put`, retaining a valid v2 journal mutation. Only its `promptManifestId`/`requestDigest` are replaced with the earlier request's real prompt/digest. The projector emits one cycle with no refusal instead of rejecting the inconsistent physical lineage. This is an explicit source-corruption probe, **not** a claim that the ordinary ResourceLedger permits this mutation. The graph and artifact commitments alone do not establish a coherent request transition.

Require the reserved request's identity, run, purpose, provider/model, prompt manifest, request digest and reservation ID to remain bound throughout the relevant request history. Bind the prompt/payload or tool effect to that reservation, not a substituted later row. Status/usage transitions may change legitimately; immutable physical linkage may not.

## Observed checks

All commands used `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` in the isolated review worktree with the existing ignored node_modules symlink. The only transport was a deterministic local ShellPort and local effect receiver; SQLite/runtime/ledger/effects/communications/scheduler/InitiativeRunner were real local objects.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/development/development-observer.test.ts
# 27 pass / 0 fail / 0 skipped; exit 0.
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/development/development-observer-review.test.ts
# 18 total: 15 pass / 3 fail / 0 cancelled / 0 skipped; exit 1.
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/development/development-observer.test.ts evaluations/development/development-observer-review.test.ts
# 45 total: 42 pass / 3 fail / 0 cancelled / 0 skipped; exit 1, ~7.2 seconds.
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
# exit 0 after all review cases were added.
git diff --check
# exit 0.
```

The first independent run had 17 cases, 15 passes and the two R1 failures. The only subsequent test addition was the R2 corruption probe: final 18 cases, same two failures plus R2. No red assertion was removed, weakened, marked todo or skipped. SQLite emitted its ordinary experimental warning. Author evidence's earlier 20/23 URI run is not a reviewer checkpoint and is not represented as one.

The 15 independent passing cases cover actual successful mechanical cycle provenance, unknown self origin, unsigned/synthetic interval bounds and refusal to restamp old selections; role/configuration/journal substitutions; mixed clock labels and excessive wall/monotonic drift; unsupported paged shapes; missing/duplicate/orphan payloads, ref mismatch and revision gap; exact supplied-current withdrawal; retained physical payload deletion/corruption; bounded reads, bounded refusal, thrown reader failures and explicit inability to represent a disposition in a one-byte proof allowance. Author 27 cases additionally cover assignment text/actor/audience/revision/eligibility/conversation, admitted/steering run reuse, unconsumed revision without checkpoint advance, foreign-run request substitution, intermediate withdrawal, full prefix corruption, failed/uncertain outcomes and host labels needing qualification. Passing those cases does not repair the three retained failures.

## Limits and handoff

`current` freshness remains an external recorder-owned assumption. The independent withdrawal test proves both sides: supplying the later withdrawal suppresses the cycle; reusing the older `after` as `current` still produces it. This is documented scope, not a claim of authenticated freshness. Raw `host` labels require qualification; events have no timestamps; interval endpoints cannot imply exact cycle time or separation within one interval. Self provenance labels remain unknown origin. A physical successful request or checkpointed result is not semantic success, spontaneous motivation, external judgment or growth.

The source accepts only complete bounded materialized v2 snapshots. Unsupported page shape refuses; no paged-source operations occurred. Read bounds and output byte refusal were checked, not comprehensive peak-heap profiling or hostile callback isolation. The source has fixed row limits; it is not a full ordinary-workload capacity solution. Root's `a11b21a` was inspected with `git show`: the capacity measurement retains the first refused full capture after eight separate ordinary conversations (370 combined rows, 1,127,064 conservative bytes), and twelve admissions exceed rows as well (546 / 1,668,758). Those numeric observations are root/author-reported evidence, not rerun measurements by this review. No allowance was raised and no history was truncated.

This finite review completes with **changes required**. Root assigns a new repair goal to `/root/a1_development_observer`, preserving these tests. Production and historical evidence were untouched; only the two exclusively owned review files changed. After exact author repair, fresh review must rerun these unchanged causal assertions and assess result-origin ambiguity and full request identity continuity. OD2-b signing integration, accepted JR2 durable use/withdrawal, paged capture, external feedback/control/restart/context sensors, qualified elapsed work, provider competence, live development and H1 remain separate open gates.

## Repair re-review — pre-execution targeted criteria

New actual finite review goal and root claim `f0892ef`, exact imported author handoff `f97d3c55a9246592f2400fd3ae4b1bc12ce29b9e`, repair source `853c687`, author pre-code `3b9af13`. The isolated review worktree fast-forward imported this descendant; original 18 review tests are byte-for-byte identical to `be63324` before additions. Historical red evidence above remains intact. This is a new finite source review, not resumption of the completed original goal.

Before executing repaired checks, freeze these additional independent assertions:

1. While a later invocation has persisted a checkpoint but has neither returned nor failed, its later assignment remains without a result. The prior assignment's supported result keeps the exact earlier producer execution JournalRef, running event, disposition event and original input cursor; each is retained in its proof. Release the local blocked shell deterministically after sampling.
2. A legitimate equal result after inherited failure metadata is conservatively unavailable for the later input when the runtime source cannot distinguish it from a repeated failure; this must not silently create fresh result origin. New/different results and equal results without failure metadata are covered by the author's new cases, which will be rerun.
3. Every intermediate physical request root/ceiling mutation is rejected even if a later row restores the original final identity. These are explicit journaled source-corruption probes, not ordinary ledger transitions.
4. Removing/withdrawing the exact result-producing execution source in supplied current refuses reuse of cached or surrounding origin records. The original 18 predicates remain unchanged and all author 31 checks plus strict compilation are rerun.

Acceptance requires actual source-supported producer chronology, not merely passing stale-result null assertions. No production/runtime/recorder/page/live modifications or operations are authorized in this review.

## Repair re-review disposition: accepted within bounded unsigned scope

Exact accepted source subject is author handoff `f97d3c55a9246592f2400fd3ae4b1bc12ce29b9e`, repair source `853c687`, repair pre-code `3b9af13`. Independent extra criteria were committed at `5163d77` before execution; added tests are `ace5188`. The original rejection remains historically valid for `ebbb96c`, with unchanged red tests at `be63324`. The repaired source closes R1 and R2 for the supported retained v2 runtime path. This accepts a bounded **unsigned proposed mechanical source projection**, not recorder observations, signing integration, semantic success or development qualification.

R1 is closed by source-supported producer attribution. At this exact runtime source, checkpoint saves are followed by their matching checkpoint event; result saves are followed by synchronous run mutation/status disposition; failed invocations carry the previous result while adding or retaining failure metadata. The resolver retains the actual producer execution JournalRef and its running/disposition events, and uses the input cursor belonging to that producer. It does not equate a later document mutation with result production. Independent inspection of the runtime save/checkpoint/failure branches supports these chronology distinctions. The added in-flight test holds an actual shell invocation after its checkpoint: the run is still `running`, the prior assignment retains exactly the original producer/cursor, and the later assignment has no result. The test resolves origin refs against actual journal mutations and status events and verifies their presence in proof. Author checks also establish fresh equal results without failure metadata and fresh changed results after inherited failure. Equal bytes with inherited failure and waiting/blocked disposition remain conservatively unavailable, verified independently using a legitimately returned equal result. This admitted limitation prevents unsupported attribution rather than treating equality as a production detector.

R2 is closed by checking the full retained lineage through the slice end. `developmentRequestIdentity` includes immutable fields and excludes only status/usage; every intermediate version additionally retains original root/ceiling and contiguous revisions/intervals. Prompt/effect resolution occurs after these checks, so the later row cannot substitute an identity different from its reservation. Unchanged final-prompt substitution now refuses; the author's intermediate-prompt restoration case and independent root/ceiling restoration cases also refuse. These are explicit journaled corruption probes. Legitimate status/usage changes continue through the real runtime path.

The additional producer-withdrawal case confirms that an earlier accepted result cannot survive withdrawal of its execution source in the supplied later current capture. Existing host-label, freshness, complete-prefix, artifact, intermediate-version, role/run/input, proof-bound and failure cases all pass unchanged. The result-origin proof is tied to the exact runtime implementation and retained complete graph; future changes to runtime ordering require renewed qualification. It is not a generic guarantee about caller-fabricated histories or other runtimes.

Final commands and observations:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/development/development-observer.test.ts evaluations/development/development-observer-review.test.ts
# 54 total: 54 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo; exit 0, ~7.8 seconds.
# Breakdown: original author27 + new author4 + unchanged original independent18 + new independent5.
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
# exit 0.
git diff --check
# exit 0.
git diff --exit-code f97d3c55a9246592f2400fd3ae4b1bc12ce29b9e -- evaluations/development/development-observer.ts evaluations/development/development-observer.test.ts docs/rewrite/evidence/A1-L08/development-observer.md
# exit 0: exact author source/tests/evidence unchanged.
```

A byte comparison against `git show be63324:evaluations/development/development-observer-review.test.ts` confirms the original complete file remains an identical prefix of the new review file. No original predicate, fixture or import changed. The first new-check run was 52 pass / 2 fail: the root/ceiling corruption fixtures incorrectly used nonexistent `OperationalStore.get(...).key`, and both failed before reaching the projector with `key must be nonempty`. Those two fixture call arguments were corrected to the already-known request key `review-request:1`; assertions were untouched. These were reviewer fixture construction failures, not product regressions, and no synthetic red commit is claimed. The subsequent joined run and strict compilation passed. SQLite emitted its ordinary experimental warning.

This new finite review goal completes at this accepted source handoff. Only the two owned review files changed after importing the exact author handoff. No runtime, ledger, recorder, historical evidence, configuration or author test was edited. No live/provider/network/native/private-account or paged-source operation occurred. Root may integrate this source; CP3 page adaptation and OD2-b/JR2 signing admission require their own exact joined gates. The documented caller-current freshness assumption, host-clock qualification, complete-snapshot capacity refusal, ambiguous equal-result boundary, external interpretation/control/sensor work, live development and H1 remain open and unchanged.
