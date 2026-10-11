# A1-L09 bounded concrete reviewer behavior

## Finite goal and predeclared behavior

/goal Implement and verify prior-owned evaluation of a proposed replacement of the concrete offline reviewer with sibling-confined synthetic packet probes, original author accounting, and old-judge authenticated evidence. Hand off exact source, positive/negative results and limits for independent review.

This is A1-L09-T03/T05, based on 0009f81 and the parent specification 65842eb. The parent owns integration and central status. Consequential design/implementation uses Astra/high. Exclusive implementation ownership is evaluations/offline-review/**, focused dispatcher tests, and this evidence. The parent additionally authorized replacing the single dispatcher plan-mount guard/import and schema literals in the independent audit regression. No shared contract, supervisor, registry or dependency changes are intended.

Before implementation, observable semantics are fixed: a complete, correctly bound successful command produces an authenticated pass; a complete, correctly bound failed behavior produces an authenticated fail. Missing/duplicate observations, wrong request/candidate/policy/evaluator/plan/runner/input identity, false assessment claims, and nonsucceeded physical records refuse. The independent assessor checks the candidate's raw response identity, artifacts and HMAC with a disposable nonauthority probe key. Only an explicit OFFLINE_REVIEW_REFUSED function exception is a refusal; unexpected function errors, process crash, timeout, malformed output or missing responses are failures of the probe, never expected refusals. Seeded always-accept, always-refuse, omitted-binding and failed-command-promotion implementations must fail.

The trusted dispatcher pipe supplies observation provenance. These checks cannot detect a wholly recomputed valid packet after compromise of that trusted producer; no new observation-signature contract is introduced. Private real evaluator keys and outer expected outcomes remain outside the candidate. Synthetic inner packet contents and a runtime-random nonauthority key are intentionally provided to it. This tests concrete behavior and namespace confidentiality, not adversarial held-out competence or model-authored improvement.

## Implementation boundary

Use one version-2 plan with a per-case kind and generic /reviewer/offline-plan.json mount, rejecting the retired version-1 plan. Preserve current total byte/time/output bounds. Extract the actual sealed reviewer's pure decision function behind its existing CLI; the old evaluator descriptor includes every new executable dependency. The sibling runner calls that same candidate source function with captured synthetic inputs. The prior-owned assessor judges raw results. Existing dispatcher, original physical reservation chain, sealed reviewer, admission and staging/probation interfaces remain the route; each confined execution and each sealed review has its own physical record in the original author lineage. Existing succession/recovery witnesses retain their separate scope; no whole-service observer is claimed.

Validation and exact handoff are pending implementation. This document does not mark L09 or Aeon 1 complete.
