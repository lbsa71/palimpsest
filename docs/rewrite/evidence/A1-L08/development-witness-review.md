# Independent development witness review

2026-10-11. A1-L08-T05/T06. Fresh reviewer `/root/a1_development_witness_review`, separate branch `aeon1-development-witness-review`, worktree `/home/palimpsest/migration/aeon-1-20261011/development-witness-review`. Author revision: `4a42c8df302f9c7b27ea06ae1394c1888783150f`; fixed root specification: `d59f3e1:docs/rewrite/evidence/A1-L08/development-witness-specification.md`. Root reserved this review and owns integration/status. This reviewer owns the new review test/evidence and narrowly demonstrated repairs to the author files; no shared runtime, contracts, qualification or build configuration changes.

```text
/goal Independently review and repair consequential defects in the A1-L08 offline development evidence packager and acquisition procedure, and return a bounded engineering disposition with reproducible offline checks.
```

Disposition: suitable for integration as bounded, offline, proposed evidence preparation after the repairs below. This review establishes neither live development nor observer integrity, reviewer eligibility, autonomous qualification, release admission or H1. Both eligibility flags remain unconditionally false; synthetic evidence remains unavailable. Existing `assessDevelopment` remains shape-only. Three real scheduler windows, distinct cycles, one-window transfer delay, three unrelated intervening experiences and two successes in each of four families are unchanged.

## First reproductions and repairs

The first reviewer test run against the unchanged author implementation exited 1: **three tests, zero passed, three failed**. The assertions and observed `actual: false`, `expected: true` are retained here; the same initial three test cases remain in `evaluations/development/witness-review.test.ts`.

1. `physical elapsed usage cannot disappear behind a shorter wall interval`: a signed request reported and charged 700,000 ms against the 600,000 ms original grant, but final accounting retained the fixture's 185,000 ms wall-derived elapsed value. Expected an accounting failure; none occurred.
2. `uncertain physical time retains its original reservation`: a signed uncertain request retained a 5,000 ms elapsed ceiling but only a 1,000 ms charge, with its unknown request ID correctly present. Expected an accounting failure; none occurred.
3. `unavailable request bytes cannot hide authenticated physical charges`: removed the retained payload and replaced final request/token/cost totals with the original preattempt baseline. The missing artifact became unavailable, but the request dropped out of accounting reconciliation. Expected an additional accounting failure; none occurred.

The repair adds `Accounting.chargedElapsedMs` to the original and final snapshots. It conserves the exact original sum plus all attempt physical elapsed charges; final elapsed usage covers both that sum and the original elapsed lifetime plus authenticated wall duration. Each request charge covers measured elapsed usage; reserved/dispatched/uncertain requests retain at least the original elapsed ceiling. Summing overlapping physical work follows the existing conservative runtime ledger semantics; concurrency cannot erase charges. The schema remains a pre-live preparation interface with no legacy accommodation.

Accounting now collects authenticated, structurally valid, attempt/time-bound request projections before dereferencing raw/payload/prompt artifacts. An unavailable artifact remains unavailable, but cannot remove the request's physical charges or original uncertainty from reconciliation. Forged, cross-attempt and duplicate record identities still fail and do not become trusted request evidence. No new grant, replay or replacement timeline is introduced. The fixture and acquisition checklist now supply original/final physical elapsed sums.

Two further reviewer cases establish valid behavior: correct overlapping physical charges remain mechanically valid synthetic evidence, while erasing the original elapsed sum fails; complete accounting with missing payload remains unavailable, and correctly reserved uncertain work retains its unknown request ID and both false eligibility flags.

## Independent boundary assessment

Read the actual packager, fixture/example, acquisition procedure, fixed specification, v2 developmental protocol, signing/inert-snapshot primitives, captured-prompt/physical-request validators and runtime ledger charge semantics. Existing author adversarial cases were rerun alongside independent reproductions. Exact accepted attempt digest and distinct signature domains prevent objective-experiment reuse and cross-attempt substitutions. Accepted external trust supplies reviewer principals, groups, context/provenance and exclusions; distinct keys/names do not establish eligibility. Both reviewer dispositions bind the same collected evidence digest, and material disagreement stays unavailable. Source/config/model/window identities and captured request payload/prompt fragment bytes are checked; unavailable original `shell:tools` bytes remain unavailable. Recorded negative opportunities, interventions, violations and unknown requests remain retained.

The host still must qualify completeness, prior reviewer eligibility/independence, source execution, actual clock/process observations, external feedback and qualitative judgments. Signed projections do not independently prove their semantic relationship to arbitrary raw artifacts. Frozen source inventory verification is not a fresh read/attestation of every source byte. The supplied reader must enforce its bound before allocation/read. The concrete procedure selects human reviewers; model-backed reviews require separately qualified acquisition/accounting under the original grant. These are explicit external boundaries, not inferred passes or newly invented authority.

## Verification and handoff

From the review worktree, using the existing shared `node_modules` symlink (no install):

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/development/witness-review.test.ts evaluations/development/witness.test.ts evaluations/development/assess.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node evaluations/development/witness-example.ts
git diff --check
```

Observed after repair: **31 focused tests passed, zero failures/skips**; normal strict compilation passed; diff whitespace check passed. The example returns `evidenceKind: synthetic`, `status: unavailable`, sole finding `synthetic`, and both eligibility flags false. Repaired example evidence digest: `0c03aec22de92dc7baebef5b0a2c7b2e1e017eb2892da48d3e8e454ca069fdac`. The disposition rests on boundary analysis and reproduced defects, not test count. No model/provider/network/service/native/namespace/physical workload or credential inspection occurred.

The exact review handoff is the commit containing this report and the seven-file repair/test/document diff from the author revision. Root must inspect/integrate it and retain the whole-Aeon goal and empirical gates as outstanding. The finite independent engineering review is complete; real observations, resources/access, independent qualification and all other H1 gates remain separate.
