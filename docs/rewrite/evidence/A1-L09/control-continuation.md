# A1-L09 finite host control continuation

Scope: implement the host continuation for exact staged ordinary proposals, while retaining the independent owner control and offline recovery path. This is a finite child of A1-L09-T03/T05 under RW10, RW14, RW15, RW16 and RW19. It does not establish full Aeon 1 acceptance, live review competence, installed ordinary tool availability or H1.

Owner: `/root/a1_control_continuation`; worktree `/home/palimpsest/migration/aeon-1-20261011/control-continuation`; branch `codex/a1-control-continuation-20261011`; base `3c1f1e9`. The root coordinator owns lane status and downstream tool/dispatcher integration. Exclusive child files are `deployment/control-continuation.ts`, its test, supervisor integration, the minimal host-only `ReleaseController.stagedControl` read API and this evidence file. This child did not edit evolution tools, mailbox, application or evaluation dispatcher.

The previous ordinary host processor stopped after obtaining a staged receipt. The new journal accepts an exact submission/stage/proposal/run/scope/authority binding and independently resolves the completed mailbox submission and its original signed proof. A wrong stage, proposal, audience, cancelled run or stale author cannot reserve a reviewer or transfer authority.

The host reserves probation against the original run allocation before withdrawing the incumbent grant. It snapshots original root/parent/envelope/start identities and retains the original policy, judging authority, rescue and admission evidence IDs. Activation uses the actual controller, drains the old process and starts the changed control payload. Fresh review receives a separate current physical authority while signed judgment continues to target the original authority and policy. Final acceptance rechecks cancellation, authority and unchanged allocation under authority and operational write locks around the synchronous controller commit.

Caller abort before enqueue leaves no request. Caller abort after enqueue does not revoke the accepted host workflow; independent run/allocation cancellation still prevents review and acceptance. Startup marks interrupted activation/review uncertain. A reservation/journal crash gap retains a used physical identity and cannot re-activate after reservation recovery. The journal never automatically retries interrupted activation or review. Returned proofs, including invalid reused/self-judging results, remain as private content-addressed artifacts. Recovery remains a separate controller operation and does not resume cancelled author work.

The reservation callback acquires authority before operational locks. The continuation does not call it while holding an operational transaction; this prevents inverted lock acquisition. The pre-reservation resource seam comes from root commit `691d4c1` (locally cherry-picked as `1e98092`) and does not create a new budget or reset allocation elapsed time.

## Evidence

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, v24.13.0. TypeScript uses the trusted development compiler closure linked into the isolated worktree; candidate payload tests contain no linked compiler.

Commands run from the child worktree:

```text
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test deployment/control-continuation.test.ts deployment/evaluation-resources.test.ts packages/release/controller.test.ts
```

Observed: TypeScript passed; 26 tests passed, zero failed/skipped/cancelled. Eight continuation cases, ten resource cases and eight controller cases completed in about 3.8 seconds. The continuation tests freeze real tiny executable candidates, stage through the actual mailbox/controller, start actual successor/rescue processes, dispatch a separate engineering reviewer process and authenticate fresh proofs under the original policy. The root resource suite additionally covers cross-process authority/cancellation locking. These criteria and keys are engineering fixtures, not independently qualified product evidence.

Cases cover fresh old-policy acceptance with unchanged allocations; tampered audience/proposal/stage and stale author rejection; caller abort before/after durable enqueue; cancellation between activation and review and immediately before acceptance; lost actual activation response; reconstructed/reopened journals; retained reservation after the reservation/journal crash gap; fresh review self-judgment/reused admission rejection; offline accepted rescue without resurrecting cancelled work; actual controller SIGKILL during drain/start; and original resource clock/identity preservation.

Development failures retained here: the first type check caught TypeScript's inference cycle for an allocation variable; an explicit type fixed it. The first test compile used a nonexistent `global` scope; the case was corrected to a real restricted scope. Neither was presented as a passing check. No behavioral assertion was weakened after execution.

## Handoff and limits

Implementation revisions: `5c05e19` exports the continuation contract and staged read API; `d4f76c5` integrates supervisor lifecycle and guarded acceptance; `1c871e3` adds the eight actual-process fixture cases and fixes lock order/proof preservation. Root already integrated the contract under its own cherry-pick identity. This evidence commit is the exact final child handoff revision reported separately.

At this handoff the supervisor's `controlReview` callbacks are an explicit host seam. Root owns the actual dispatcher methods/default wiring and ordinary activation tools, effect acknowledgement deferral, author hold/wake and installed whole-cycle test. No claim is made that ordinary model tools can yet complete this entire workflow at this child revision. Root declined an unchanged heavy supervisor regression rerun because the coordinated heavy test window was occupied and the new integrated ordinary case is next. No paid inference, external sends, production installation or automatic rescue retirement occurred. Retained host rescue rotation remains a separate explicit accepted boot-ready request.

Downstream: integrate only the child's implementation commits, not the duplicate resource cherry-pick; wire a ready predicate that requires reviewer availability/idle state and settled activation-tool acknowledgement; reserve before authority withdrawal; reuse the original request/digest, reviewer identity, reservation and elapsed clock; dispatch/sign under separate physical/judging authority; then run the actual ordinary service/dispatcher lifecycle and fresh consequential review.
