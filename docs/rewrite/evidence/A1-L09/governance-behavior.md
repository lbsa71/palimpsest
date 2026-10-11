# A1-L09 bounded concrete reviewer behavior

## Finite goal and predeclared behavior

/goal Implement and verify prior-owned evaluation of a proposed replacement of the concrete offline reviewer with sibling-confined synthetic packet probes, original author accounting, and old-judge authenticated evidence. Hand off exact source, positive/negative results and limits for independent review.

This is A1-L09-T03/T05, based on 0009f81 and the parent specification 65842eb. The parent owns integration and central status. Consequential design/implementation uses Astra/high. Exclusive implementation ownership is evaluations/offline-review/**, focused dispatcher tests, and this evidence. The parent additionally authorized replacing the single dispatcher plan-mount guard/import and schema literals in the independent audit regression. No shared contract, supervisor or dependency changes are intended. Fresh review demonstrated a selection prerequisite; the parent additionally authorized the exact concrete-core source-path exception in the reviewer registry and passing the existing prior policy to the selection check.

Before implementation, observable semantics are fixed: a complete, correctly bound successful command produces an authenticated pass; a complete, correctly bound failed behavior produces an authenticated fail. Missing/duplicate observations, wrong request/candidate/policy/evaluator/plan/runner/input identity, false assessment claims, and nonsucceeded physical records refuse. The independent assessor checks the candidate's raw response identity, artifacts and HMAC with a disposable nonauthority probe key. Only an explicit OFFLINE_REVIEW_REFUSED function exception is a refusal; unexpected function errors, process crash, timeout, malformed output or missing responses are failures of the probe, never expected refusals. Seeded always-accept, always-refuse, omitted-binding and failed-command-promotion implementations must fail.

The trusted dispatcher pipe supplies observation provenance. These checks cannot detect a wholly recomputed valid packet after compromise of that trusted producer; no new observation-signature contract is introduced. Private real evaluator keys and outer expected outcomes remain outside the candidate. Synthetic inner packet contents and a runtime-random nonauthority key are intentionally provided to it. This tests concrete behavior and namespace confidentiality, not adversarial held-out competence or model-authored improvement.

## Implementation boundary

Use one version-2 plan with a per-case kind and generic /reviewer/offline-plan.json mount, rejecting the retired version-1 plan. Preserve current total byte/time/output bounds. Extract the actual sealed reviewer's pure decision function behind its existing CLI; the old evaluator descriptor includes every new executable dependency. The sibling runner calls that same candidate source function with captured synthetic inputs. The prior-owned assessor judges raw results. Existing dispatcher, original physical reservation chain, sealed reviewer, admission and staging/probation interfaces remain the route; each confined execution and each sealed review has its own physical record in the original author lineage. Existing succession/recovery witnesses retain their separate scope; no whole-service observer is claimed.

Fresh review identified that probing only the core cannot qualify changes to its CLI wrapper. The first case therefore explicitly binds adapterDigest in the old private plan and checks candidate reviewer.mjs bytes before importing the proposed core. A changed wrapper with pristine core must refuse before candidate invocation or admission. Arbitrary CLI entrypoint replacements require a separate case and remain unqualified by this slice.

Fresh review also demonstrated that a canonical core source check alone does not bind an actual selected evaluator. The case now requires a frozen GovernanceProposal: only /reviewer/review-core.ts may change, mapped to the exact classified candidate core; executable, arguments, remaining mounts, signing authority and required cases stay inherited. Its next evaluator descriptor must match the proposed frozen policy. The sibling sees only copied selected core and bound adapter, with no /app mount; an undeclared relative dependency cannot borrow the full source tree. The physical fixture includes actual proposal creation and existing ReviewerRegistry preparation after old-judge admission. Registry selection, staging, later probation and recovery still retain separate evidence boundaries.

Author implementation and bounded validation are complete at the revisions below. The independent reviewer subsequently reported its retained-artifact audit passing 8/8 and final combined focused checks passing 29/29 with strict compilation; its separate review record owns those findings. This document does not mark L09 or Aeon 1 complete.

## Retained failure and review corrections

The first physical trial at 1908b3e failed after 18.902 seconds (`write EPIPE`; zero completed test cases). Its sealed CLI inherited `--jitless`, which disables WebAssembly in Node 24; Node's built-in TypeScript stripping then failed with `ReferenceError: WebAssembly is not defined`. The same failure reproduced with the local pure `node --jitless --max-old-space-size=64 --input-type=module` import. The offline fixture now omits that incompatible flag while retaining the 64 MiB V8 heap setting and existing confinement/resource limits; its descriptor binds the changed arguments. The retired marker-only fixture still uses its original arguments. No passing physical result is inferred from the failed trial.

Fresh independent review found two real prerequisites before corrected physical validation: fixed-adapter eligibility alone did not bind a selected governance descriptor, and mounting the whole candidate could provide undeclared dependencies absent from the future sealed reviewer. The selection and reduced-closure changes above address both. The correct replacement fixture's privacy instrumentation runs only in the sibling probe entrypoint, where it attempts actual key/plan/private-source paths; the exported reviewer behavior remains unchanged when invoked by the sealed CLI. No claim of universal hostile-code equivalence across environments is made.

Author strict compilation and 34 focused tests pass at runtime e644804 (test-only retention follow-up 3978673). They include prior allocation/cancellation/unknown/replay and independent first-checker admission regressions, the concrete packet/response checks, and the registry suite. The separate reviewer reported strict compilation and 27 focused tests passing with its own selection mutations before a corrected physical run. These pure checks did not substitute for the physical composition recorded below.

The 3978673 trial also stopped before a complete review response (16.955 seconds, sealed reviewer exit code 1). Its private stderr was not retained by that fixture; the precise physical cause therefore remains unavailable. A local trusted-core import under the same 8 GiB address-space and 64 MiB V8 heap limits reproduced Amaro's `WebAssembly.Instance(): Out of memory`. Adding `--disable-wasm-trap-handler` succeeded with those limits unchanged. The parent authorized that descriptor-bound flag; subsequent failed trials retain private error causes and physical reservations instead of losing those diagnostics. The retained 3978673 files include its exact first request/proposal/source and prior plan/descriptor, but no completed signed response.

Review also demonstrated that shared command confinement mounts `/usr`, which could provide an absolute system JavaScript dependency absent from the selected sealed closure. Reviewer probes now use Node's permission profile with reads restricted to `/work` and no filesystem-write, child-process, worker or addon grants; the Validator profile is unchanged. A local behavioral regression loads the real installed 138-byte `signal-exit/dist/mjs/browser.js` with the old arguments, observes `ERR_ACCESS_DENIED` with the reviewer profile, and verifies both permitted input reads and denied snapshot writes. The physical matrix includes this installed-module mutant. The OS namespace remains the private-key/network boundary; the permission profile narrows module/file access and is not a replacement sandbox.

## Completed physical validation and source handoff

Runtime checkpoint: **81a5000**. Final test fixture: **fc424dd**. No runtime change was needed after 81a5000. The fc424dd follow-up makes the pure external-module test portable and corrects the cached-output negative assertion; it does not enlarge any bound. The 81a5000 physical test had stopped on that incorrect assertion after ten retained physical records, 72.61 seconds into its body. Its cached always-accept response had correctly become signed negative evidence because 17 repeated responses would exceed the 32 KiB case limit. That failed test remains a failure, with its partial matrix retained separately.

Final commands used Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` v24.13.0, with the existing materialized toolchain (no installation/lockfile change):

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH node --test evaluations/offline-review/*.test.ts deployment/offline-behavioral-review-audit.test.ts deployment/evaluation-resources.test.ts deployment/reviewer-registry.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH AEON_GOVERNANCE_REVIEW_FIXTURE=1 AEON_GOVERNANCE_EVIDENCE_DIR=/home/palimpsest/migration/aeon-1-20261011/governance-review-trials/fc424dd-artifacts node --test --test-reporter=tap --test-name-pattern='governance reviewer probes reject' deployment/evaluation-dispatch.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH AEON_OFFLINE_REVIEW_FIXTURE=1 node --test --test-reporter=tap --test-name-pattern='offline direct bounded review' deployment/evaluation-dispatch.test.ts
```

Normal strict compilation passes. The combined focused suite passed 35/35; the subsequently portable permission regression passed 3/3 with its parser/assessor companions, and strict compilation passed again. Fresh independent source/selection review reported 28/28 focused checks and strict compilation passing. Final physical governance test: **1/1, zero skips, 101.938 seconds** (102.272 seconds including test harness). Direct Validator good/initializer pair: **1/1, zero skips, 32.467 seconds**. No full lifecycle rerun was made.

| Exact final candidate behavior | Observed outcome |
| --- | --- |
| Correct core, namespace privacy instrumentation | Authenticated pass; old-policy control-upgrade admission; existing registry prepares/loads the selected core hash and descriptor |
| Changed adapter, pristine core | Refused before a new physical reservation or candidate import |
| Undeclared relative import | Exit 1, `ERR_MODULE_NOT_FOUND`, signed fail |
| Undeclared installed system import | Exit 1, `ERR_ACCESS_DENIED`, signed fail |
| Always-refusing core | Exit 0, explicit refusals, signed fail |
| Cached always-accepting core | SIGKILL at the 32 KiB output cap, signed fail; **bounded-execution negative, not completed semantic assessment** |
| Removed request binding | Exit 0; actually returns a result for the wrong request observation; signed fail |
| Forced successful command assessment | Exit 0; actually returns pass for failed behavior; signed fail |

The final governance matrix has **14 separate physical records**: seven sibling candidate executions and seven sealed old-reviewer executions. The changed-wrapper preflight adds none. Every record is in `reviewer-author` under its original `reviewer-parent` allocation, with `maxConcurrency: 1`; both allocation objects, their original clocks and grants remain unchanged. Replay attempts add no record. Physical `succeeded` means a complete known execution receipt, not behavioral success: the command failures/output-limit above remain negative evidence. Previous cancellation/unknown and post-transfer predecessor tests retain their separate boundary; no new physical cancellation or successor activation is claimed here.

Final positive candidate: `8fa5c657bece05a619d18aeb2e292499cdfa31e55afac0a86ac2379d03699ff9`.
Original policy: `3cafc515964bc5a7e354f7e8a561a9b799f483624f8dadf998130be7c6a7e95f`.
Old evaluator descriptor: `96cca0cd203feef3bfc4fe995ec270fb01eae4e8be258de74d685cad7fe3a3a5`.
Private plan: `6aec12a3f73c5cb7d5df93dbb8dac748b82d4e04e4b746e70ce8e447f540e695`.
Prior runner: `4e433ebcc76c3459ddb4a991f3e7ff398d4e52e5f4c86cda2899410b30d9cbde`.

All raw evidence is outside Git under `/home/palimpsest/migration/aeon-1-20261011/governance-review-trials/`. The final `fc424dd-artifacts` contains actual proposals, selected core/adapter bytes, requests, raw authenticated responses and artifact bodies, ledger snapshots, original allocations, positive admission and selected next descriptor/policy. It includes only nonauthority probe keys; the real signing key is not retained. The two partial artifact directories and all failed TAP logs remain separate. Directories are owner-only and completed files are read-only.

The 91-file inventory `author-sha256.json` has SHA-256 `d463fac697081e3745569439d8f65435258bc47c1061c9f7b1d7b7462550451e`.

| Completed transcript | SHA-256 |
| --- | --- |
| governance-1908b3e.tap (failed) | 60b17a64cd321625fafdd56b27fc39f9271793605933948f73b953cc4d2030a0 |
| governance-3978673.tap (failed) | 9729f108f5c8756cb211ced4768c407cc4073dbaf73f29b9f4f8d0ea9c59d9b0 |
| governance-81a5000.tap (failed assertion) | 09929722df651cf900c96158bae374a0c8097fd40d6714ef67665a5aede552c4 |
| governance-fc424dd.tap (passed) | 8bb5d8df25500ca6d7676a5b51c0bf9f636e3669829317111d82bfa152ed9a3a |
| validator-fc424dd.tap (passed) | f0e980bb1b2478d68b3561c6ecde6bd0d08ac4c5120f7c082fb38c1b0defa3a4 |

The optional physical system-import mutant has an explicit host prerequisite: `/usr/share/nodejs/signal-exit/dist/mjs/browser.js`, a 138-byte installed module (SHA-256 `57498e3448998c32a94f884f500ac7a2c8b54872f648bebf1be1704303a5522c`). Ordinary pure tests use a generated external module and add no distro dependency.

The eligible first replacement is a selected concrete pure reviewer core under the exact inherited CLI/runtime/mount/policy arrangement described above. Arbitrary wrapper, executable, argument, dependency or policy changes need separately qualified cases and are not permanently prohibited by this gate. Real model selection/authorship, justified improvement, product qualification, and H1 remain empirical work. This is a source-backed behavioral admission capability with engineering evidence, not completion of L09 or Aeon 1.
