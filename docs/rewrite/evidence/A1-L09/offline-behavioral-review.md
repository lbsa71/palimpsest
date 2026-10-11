# A1-L09 prior-owned offline behavioral review

Status: **bounded implementation handoff; fresh independent lifecycle review pending**. Owner `/root/a1_changed_host_readiness`, branch `codex/a1-changed-host-readiness-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/changed-host-readiness`; base `8cef300`, readiness inquiry `fdefe3b`. Parent `/root` owns central coordination and integration. This is the first bounded implementation slice proposed in [changed-host readiness](changed-host-readiness.md), under L09 T03/T05 with L08 evaluation ownership. A new actual finite goal, without a token budget, was started after the inquiry goal completed.

```text
/goal Implement and verify prior-owned offline Validator behavioral checks in separately confined candidate processes, binding original receipts to the existing external review, admission and fresh probation path with exact evaluator identity and original resource lineage; preserve evidence and hand off reviewed boundaries.
```

## Behavioral specification and scope

Before implementation, the parent accepted these concrete checks: execute frozen `Validator` string-length behavior outside the judge process; independently assess empty/BMP strings, surrogate pairs, unpaired surrogates, minimum/maximum length and invalid primitive types; a good candidate passes and an actual `s.length` semantic regression fails. Candidate execution cannot see reviewer keys or expected outcomes. The original prior policy binds the runner, inputs, expected results and bounds. Every candidate command and every sealed reviewer is a separate physical operation under the original author allocation. Staging and fresh probation reuse existing ordinary interfaces, including concurrency one and unchanged clocks.

Exclusive changes are `evaluations/offline-review/**`, `deployment/evaluation-dispatch.ts`, `deployment/evaluation-resources.ts` and their tests. The parent explicitly expanded ownership to `deployment/candidate.ts` and its focused test: the dispatcher imports the new offline module into the host, so its executable source must belong to the control closure. The existing qualification observer/manifest/store, C1 contracts, reviewer registry, supervisor and configuration schemas remain unchanged. No dependency was added.

## Implementation boundary

A reviewer declares `/reviewer/offline-validator-plan.json` in its existing exact hashed file list. Its private canonical JSON contains the supported case inputs, expected booleans, limits and actual prior-owned runner source/runtime digest. The existing reviewer descriptor therefore binds this plan under the old admission policy; no unsigned extra setting chooses a checker or expected answers. A missing file preserves the existing reviewer-only path. Removing a required file changes the accepted evaluator artifact. Direct `runExternalReview` refuses a behavioral plan without accounted probes.

`parseOfflinePlan` rejects noncanonical/duplicate-key JSON, unknown fields, duplicate cases, unsupported schemas, excessive inputs and individual/aggregate bounds. At most eight commands run, each at most five seconds, with an aggregate 15-second command limit and 256 KiB output limit. The current concrete runner invokes only frozen `packages/narrow-schema/index.ts`; it offers no arbitrary command or import path selected by an author.

`runAccountedExternalReview` verifies the original policy, candidate, retained rescue and runner identity before execution. `runOfflineCase` writes only the fixed public runner and invocation inputs into a disposable workspace, uses existing `runConfined` with the frozen candidate image and prior Node runtime. Inside that namespace, the runner captures and freezes invocation inputs before dynamically importing candidate code, and passes fresh schema copies to the validator because the validator annotates schema objects. The expected array, complete private plan, signing key, state and reviewer files are protected and never mounted into this sibling namespace. Candidate modules are never imported by the judge process. This tests the candidate library under the prior runtime; it does not qualify a changed Node executable or arbitrary host behavior.

The original command receipt and host ledger record bind the request, candidate, policy, evaluator, plan, runner, case and inputs. The sealed reviewer receives these original observations, independently compares the output with the private expected values and emits the existing signed `ExternalEvaluation`. The dispatcher checks that each declared case has exactly one result preserving the original verdict, receipt content address and usage. Existing artifact/signature checks, mailbox completion, staged admission and old-policy fresh probation remain consumers. No candidate-authored pass flag or usage assertion substitutes for a host observation.

A probe uses a stable distinct physical ID derived from review ID and case ID. Every probe and the sealed reviewer reserve/dispatch/settle separately in `ResourceLedger`. Sequential execution works at concurrency one. Probation reserves its first operation before authority transfer; that reservation includes activation time. Further post-transfer operations require a completed, claimed predecessor of the exact same review/evaluator and the successor's current physical authority. They retain the original author allocation and its clock. Cancellation/expiry, interruption recovery and unknown physical outcomes preserve their original charges and never grant an automatic fresh attempt. Product-policy behavioral runs require the accepted kernel resource profile.

Runner qualification deliberately binds an actual prior-owned source/runtime inventory, including its host imports. It must be recalculated and independently accepted for a changed observing host. Running the newly proposed candidate as its own observer, or relaxing that inventory check to preserve an old hash, is not supported. The current physical composition keeps the original judge running while separately activating the candidate service.

## Verification record

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` v24.13.0. Dependencies initially reused the existing root `node_modules` through a worktree symlink, then were copied locally without installing or changing the closure so source-freeze checks could run; no installation or lockfile mutation occurred. Physical composition was serialized through the parent after the unrelated native kernel rehearsal released its window.

- First code checkpoint `7bfef12`: strict `npm run check` passed; offline-plan and evaluation-resource tests passed **16/16, zero skips**.
- First ordinary composition at `7bfef12` failed after 35.837 seconds. The private dispatcher diagnosis correctly remained redacted. A direct independently allocated diagnostic exposed `not a JSON value` in canonical observation retention: `runConfined` returns an optional `stoppedFor: undefined`. Fix `71300d1` retains the exact JSON representation of that original command receipt, without changing results or permitting a failed outcome. The direct diagnostic failed after 12.463 seconds before this fix. The failed fixtures were removed by their `finally` cleanup; their transcripts remain outside Git.
- The first mid-run inspection preceded physical reservations and was not proof of zero final dispatch. The subsequent diagnostic established the failure was in the receipt/signing path. No failed run is retroactively counted as a pass.
- `71300d1` also tightens post-transfer sequencing to require a completed same-review predecessor. Strict `npm run check` and the same **16/16** focused tests passed.
- The candidate-classifier test initially encountered the existing source-freeze prohibition on a symlinked `node_modules`. This is a worktree test precondition, not a reason to weaken frozen closure verification.

- `71300d1` direct physical review passed in 15.213 seconds. Its ordinary lifecycle reached actual staging and fresh probation, then the test incorrectly used `OperationalStore.readJsonArtifact` for the signed `sha256:` observation URI. Test-only fix `9359203` uses the existing mailbox resolver. The failed lifecycle took 40.470 seconds; it is not counted as a completed pass.
- At `9359203`, actual staged admission/probation, seeded Unicode regression refusal, replay refusal and private-path read denial passed. A final malformed fixture request omitted `proposal.authority`, so it failed before its intended direct-API guard assertion. `bc89fff` fixes that request and adds a physically started hanging candidate cancellation. No production checks were relaxed.
- `bc89fff` actual lifecycle and negatives passed **5/5, zero skips**, 86.732 seconds. The actual ordinary service ran captured author tools through candidate freezing, evaluation, release submission, control activation and old-policy fresh probation. Two candidate commands and two sealed reviews completed for admission/probation. The regression and isolation trials added four successful physical operations. The cancelled probe retained one unknown charge; it never launched the signer. Restart preserved all nine records and did not replay them.
- Fresh reviewer `/root/a1_offline_review_audit` then found that this fixture copied its own source into candidate `/app`, exposing the fixed test signing key declaration and exact expected-vector literals. Thus the prior 5/5 result establishes path refusal and lifecycle/accounting mechanics, **not confidentiality of the actual fixture key or packet bytes**. `070c69c` switches to a runtime-random key and removes only the two vector-bearing test files from this disposable source before freezing. Assertions inspect the exact frozen manifest, and the candidate's read-denial attack includes both omitted paths. Production freezing is unchanged.
- Independent static review agreed with a second narrow correction in `070c69c`: capture and freeze the original invocation inputs before dynamic candidate import. A new adversarial initializer rewrites its visible input file to normalize surrogate pairs to BMP strings and uses the wrong `s.length` implementation. The old import order could hide that regression; the new order must retain the original values and reject it. This does not claim protection against every possible malicious JavaScript intrinsic modification or establish broad adversarial competence.
- Strict `npm run check`, final focused **16/16** tests and `git diff --check` passed. The materialized-closure classifier test passed **1/1** in 7.135 seconds. No no-follow/source-freeze check was weakened.

Retained trial directory: `/home/palimpsest/migration/aeon-1-20261011/offline-review-trials/`. Final direct-pair result and transcript hashes are recorded below. Root explicitly assigned the corrected full privacy lifecycle to the fresh reviewer after this author handoff, avoiding a duplicate author rerun. The earlier fixed-key trial is not accepted as the corrected privacy result.

### Final author result and review handoff

Final executable source: **`ba933f4`**. The first final direct trial at `070c69c` rejected the good candidate because schema freezing prevented the validator's legitimate `__absolute_uri__` annotation. A direct source reproduction confirmed that behavior. `ba933f4` keeps the frozen original snapshot and passes a fresh shallow schema copy to each validation call; primitive type/minimum/maximum fields retain the exact original values. The failure is retained, not reclassified as a candidate defect.

At `ba933f4`, the final direct good/initializer-attack pair passed **1/1, zero skips**, **26.125 seconds**. The test made four physical operations under one unchanged allocation: good candidate command and sealed reviewer, then initializer-attack command and sealed reviewer. The good candidate passed; rewriting the visible input file before running the wrong `s.length` implementation could not hide the original surrogate-pair regression. Strict TypeScript and three existing dispatcher cleanup/diagnostic tests also passed on the final code.

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH node --test evaluations/offline-review/plan.test.ts deployment/evaluation-resources.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH node --test deployment/candidate.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH node --test --test-name-pattern='failed probation activation|dispatcher failure diagnostics|interrupted snapshot cleanup' deployment/evaluation-dispatch.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH AEON_OFFLINE_REVIEW_FIXTURE=1 node --test --test-name-pattern='offline direct bounded' deployment/evaluation-dispatch.test.ts
# Fresh reviewer owns this one remaining final-code physical replay, coordinated with root:
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH AEON_OFFLINE_REVIEW_FIXTURE=1 node --test --test-name-pattern='offline behavioral reviewer confines' deployment/evaluation-dispatch.test.ts
git diff --check
```

The parent explicitly authorized completing this finite author goal with an honest component handoff before the independent replay. Reviewer `/root/a1_offline_review_audit` owns final corrected fixture confidentiality/lifecycle evidence, review-specific diagnostics and any independently reproduced repair. No final-code full lifecycle pass is claimed here. The last author physical window was released after the direct pair; temporary fixture roots were absent. No provider generation, native comparator, Slack message, production deployment, dependency installation or push occurred.

The retained author transcripts are read-only under the owner-private trial directory. Their hashes preserve both failures and successes. Integration removed a row accidentally captured from the fresh reviewer's still-growing transcript; the independent audit owns that completed transcript and its final hash:

| Transcript | SHA-256 |
|---|---|
| `070c69c-direct-5.tap` | `7c48db38bb62977b7d32e5cd29b8527f11cd2fb0dc708d46abde9a0bc65aa3cd` |
| `71300d1-composition-2.tap` | `0e8c45a7421bc94e1fa35eba95d3972d83b65f0adf33095d6ee512abd00fa78a` |
| `7bfef12-composition-1.tap` | `112d241a4e3dff8c15aa72e9d54f0c088c68cb7288f0682f1165a0c42d14e712` |
| `bc89fff-lifecycle-4.tap` | `cfc129361a5e944d36951cc99d039d747f48f7af77453867a7aec6cbc7848c78` |
| `candidate-classifier.tap` | `97954d423d269b9c970d0ddd3e9e7f01be25251120e155014484b973aacf1d25` |
| `direct-6.tap` | `ba20de2f0ea31e1b54123c7ec537516e2a046140c711cd9967fe4adf9188bb39` |
| `direct-diagnostic-1.tap` | `1c1de6147420f8d51803ef11acd14956071fbb387a519ad6fc40cd8fcaf8f531` |
| `dispatcher-pure.tap` | `6fa2570c1975d31df5d66907d071b4c72af3fa1147dd40ba4dd9d2df25126e81` |
| `final-focused.tap` | `566121962a667bc73603e61f3d0842a6d8b1b9121cc4789b3e72e474028c032c` |
| `lifecycle-3.tap` | `26cb2a59237929b9083c29038fed5d7743f0b8b235dfaf61449ef9097a6c1fda` |

## Limits and downstream work

This is one substantive offline behavioral case and its proof path. The fixture author, bootstrap judgment and model transport remain synthetic engineering inputs. A real candidate command and sealed reviewer do not establish a justified model-authored improvement, external evaluator qualification, live product readiness, parity, development or H1.

Governance-specific replacement-reviewer vectors are a subsequent finite task; this slice does not claim to implement them. Existing actual succession/recovery witnesses retain their own scope. No universal changed-host observer, new release framework or all-in-one witness requirement is introduced. Authorized live grants, qualification of the actual evaluator/cases, and empirical autonomous behavior remain later gates.
