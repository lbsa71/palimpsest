# A1-L09 fresh evolution boundary review

Status: implemented and fixture-verified; finite review delivery, not H1 acceptance. Review owner `/root/a1_evolution_review`, branch `codex/a1-evolution-review-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/evolution-review`, starting revision `119b2e970d06ac7491948b171ddb20228434cb5f`. Governing contracts: `aeon1.c1.v1`; RW09, RW10, RW12, RW14–RW16 and RW21; A1-L09-T03/T04/T05.

```text
/goal Freshly review the model-accessible proposal, freeze, evaluate and submit boundaries; reproduce and fix consequential defects, verify actual boundary behavior, persist evidence and return an exact commit to the integrating lead.
```

Exclusive writes are `deployment/evolution-tools.ts`, its tests, `packages/release/proposals.ts` and this record. Root subsequently delegated fresh review and fixes of `deployment/proposal-origin.ts` and its test at root revision `6c97c75de528a3a7e474a3981180cd14c907562d` (cherry-picked locally as `c8b45b2`). Root owns application/IPC integration; the host-boundary reviewer owns candidate/materialization/source-workspace/artifact-reader changes. This task is one of three concurrent delegated tasks under the lead's maximal-useful-parallelism instruction; no further subdivision was needed. The reviewer read the active root requirements, plan, AGENTS, workflow, L09 lane and source handoff, and inspected the actual implementation and dependent contracts rather than treating the handoff's claims as acceptance.

## Findings and changes

1. **Uncertain requests could change identity on policy rotation.** A frozen/dispatched proposal retained its candidate but not its judging policy. A fresh tool factory with another host `policyDigest` generated another request ID and called the evaluator again. A regression using a reopened operational database reproduced the second callback on the baseline. Freezing now persists `judgingPolicyDigest` atomically with the candidate. Evaluation and submission require that exact policy before issuing a callback; a changed-policy retry stays dispatched and explicitly requires reconciliation under the original host policy. The submission reply-loss test also verifies no callback runs under a changed policy. Reconciliation tests compare complete canonical request bodies, as well as request IDs.

2. **Legitimate autonomous provenance failed after generation adoption.** Actual `DurableRuntime.admit` followed by `adopt` changes the execution grant but preserves its authenticated original initiative input. The prior check compared that historical actor with the new generation and rejected the proposal. The regression failed on the baseline. The producer now retains the actor authenticated in the host-bound input, while separately checking the current serving grant, current run/goal execution binding, exact goal-origin attestation and absence of human admission/steering. The regression proves an adopted run can create a new self proposal, its provenance still identifies the original generation, the previous grant is rejected, and subsequent human steering denies the self path. Existing proposals keep their original authority; this does not silently reauthorize a prior-generation uncertain release.

3. **Submission now revalidates the stored evaluation's binding.** The earlier submit path checked only verdicts after loading its immutable artifact. It now verifies the evaluation request ID for this proposal, exact candidate, frozen policy, judging controls and evaluator independence before dispatch. A deliberately transplanted host-store fixture receipt from another proposal is rejected without calling the submitter. This is defense against malformed host integration or durable-state construction, not a claim that the model can write the protected operational database.

4. **The new origin wrapper could launder a tainted origin through another initiative generation.** A marker's source run could subsequently receive human steering. Evolution provenance rejects that marker, but the new wrapper initially checked only its goal-definition identity, allowing an initiative executing that child to create a newly attested grandchild with a clean origin run. Actual initiative proposal tools reproduced the unexpected grandchild marker. The wrapper now also checks the original independent run's authenticated initiative provenance and absence of human inputs before propagating a marker. Inquiry-origin selection applies the same check. Expanded actual drive/offer/select cases prove human-authored offers, human selections, human acceptance and subsequently tainted offer origins cannot mint or retain independent-goal markers. Goal and marker persistence remains transactional.

The callback interruption regression aborts after a synthetic evaluator has completed: the tool reports `mayHaveApplied`, retains `evaluation-dispatched`, and a fresh descriptor reconciles the identical request without another completion. Existing cases still exercise private-experience denial, independent-origin attestations, human eligibility, source grant denial, symlinks, hardlinks, special files, cumulative bounds and a file growing after its descriptor read.

## Verification and limitations

Runtime: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, v24.13.0. The ignored development `node_modules` symlink targets the lead checkout's installed check tools; the acceptance fixture copies the concrete resolved compiler directory into an ordinary accepted source tree. No symlink is accepted into a frozen payload.

Commands, with the pinned runtime directory prepended to PATH:

```text
node --test --test-name-pattern='runtime adoption' deployment/evolution-tools.test.ts
node --test deployment/evolution-tools.test.ts
node node_modules/typescript/bin/tsc --noEmit
node --test deployment/evolution-tools.test.ts packages/release/release.test.ts packages/release/controller.test.ts
node node_modules/typescript/bin/tsc --noEmit false --rewriteRelativeImportExtensions --outDir dist
node --test deployment/proposal-origin.test.ts
node --test deployment/evolution-tools.test.ts deployment/proposal-origin.test.ts packages/release/release.test.ts packages/release/controller.test.ts
```

The baseline adoption case failed at the old generation/actor equality check. The baseline changed-policy case failed because a second evaluator callback ran. The origin-wrapper regression failed with a newly persisted `laundered-grandchild` marker before the wrapper fix. After the fixes, type checking and the emitted build passed; the initial combined evolution/release/controller suite passed 25 tests; the expanded evolution suite passed 12; and the final origin-specific regression passed. The final combined evolution/origin/release/controller run passed **27 tests**, zero failures or skips, in 21.4 seconds. `git diff --check` also passed.

The existing integration fixture freezes an actual retained dependency edit, prompt edit and permitted model change, compiles the whole frozen source with the accepted compiler and loads the emitted dependency. It passes a host-signed mechanical fixture judgment through the real `ReleaseController.stageControlUpgrade`. This fresh source review is independent of the original implementation author; the test evaluator is still a deterministic engineering fixture, not an independent live product evaluator or evidence of autonomous improvement. No live provider call, Slack/message, deployment, installed service change, production activation or H1 acceptance occurred.

Host callbacks still must durably reconcile request IDs and enforce audience/disclosure policy, evidence authentication and previously accepted release controls. A frozen proposal lacking the new policy binding fails closed; there is no compatibility fallback that guesses an original policy. A host policy rotation requires original-policy reconciliation, and prior-generation uncertain operations require host reconciliation. Root owns ordinary-service integration and the next consequential integration checks.

Exact handoff revision is the commit containing this record, supplied to root with the check results.
