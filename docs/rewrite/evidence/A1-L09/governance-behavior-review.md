# Independent concrete reviewer behavior review

Status: reviewing. A1-L09-T03/T05, RW14–RW16/RW19/RW20. Fresh reviewer `/root/a1_governance_behavior_review`; isolated branch `codex/a1-governance-behavior-review-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/governance-behavior-review`. Initial runtime source `1908b3e` from `codex/a1-governance-behavior-20261011`. Reviewer owns only this evidence and `evaluations/offline-review/governance-review.test.ts`; author owns runtime repairs. Root serializes all confined physical runs.

```text
/goal Independently review the A1 L09 governance behavior implementation and retained evidence, verify the narrow v2 prior-owned plan, same-source reviewer/CLI/probe binding, exact evidence authentication and old-judge isolation, and produce finite review tests and an honest evidence handoff.
```

The actual finite goal was created before investigation. Required repository, workflow, lane and prior behavioral specification were read. This is fresh source review, pure adversarial testing and inspection of author-produced physical evidence; it does not establish model authorship, autonomous improvement, deployment, whole-lane completion or H1.

## Consequential finding

At `1908b3e`, `reviewer-runner.mjs` imported candidate `review-core.ts` directly while the actual sealed entrypoint was `reviewer.mjs`. A candidate could preserve a passing core and alter its entrypoint without that alteration affecting the probe. All five original physical mutants changed the core. Source identity alone did not demonstrate behavior of the changed executable adapter. Root agreed this violated the same-implementation requirement; author accepted the finding.

The coordinated narrow repair is to bind the adapter to the prior runner's actual bytes and reject changes before candidate imports. A changed CLI is thereby explicitly ineligible for this first slice; broader adapter evolution requires a separately supported behavioral path. This avoids treating an unexecuted changed adapter as reviewed. Author repair, wrapper-only regression and retained physical evidence inspection are pending.

## Independent regressions and initial results

The reviewer supplies its own two-case synthetic packets rather than importing the author's provisioning test. Four tests verify reordered observation association and genuine negative evidence with independently computed HMAC and artifacts; every physical identity plus invalid/nonzero usage; re-signed semantic/proof/artifact substitutions; and explicit refusal versus process failure, timeout, signal or missing output. These tests use no candidate namespace, provider, authority signing key or external effect.

On `1908b3e` plus the new review tests, Node `v24.13.0` from `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin`:

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH node --test evaluations/offline-review/governance-review.test.ts evaluations/offline-review/governance.test.ts evaluations/offline-review/plan.test.ts deployment/offline-behavioral-review-audit.test.ts
```

Strict compilation passed. The selected suite passed 13/13, zero failures/skips, 922.916 ms. Initial reviewer-only TypeScript errors (purpose enum, readonly signed array and signal literal widening) were corrected before this successful run; no runtime implementation was altered. No broad lifecycle repeat was performed.

## Limits and pending handoff

The trusted dispatcher pipe remains observation provenance. A wholly recomputed internally consistent packet after compromise of that trusted producer is outside this contract. Candidate probe keys are intentionally nonauthority. Synthetic behavior tests do not establish resistance to an adaptive adversary that recognizes the test or demonstrate held-out model competence. Existing control staging, probation and provider-independent recovery remain separately evidenced. Final repair revision, retained evidence verification and review disposition will be recorded before handoff.
