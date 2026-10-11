# A1-L08 fresh calibration review and repair

Date: 2026-10-11. Reviewer: `/root/a1_calibration_review`, fresh context separate from the implementation author. Reviewed input: `75fdec8a30dd44ef53dce3697f39d4438d7449a7`. Isolated branch: `codex/a1-calibration-review-20261011`; worktree: `/home/palimpsest/migration/aeon-1-20261011/calibration-review`. Scope: A1-L08-T01/T02/T05/T06, RW03/RW16/RW18/RW19/RW20. Exclusive writes: `evaluations/calibration/**`, the [method document](../../evaluation/calibration-analysis.md), and this new evidence record. The integrating lead retains the lane coordination record and protocol ownership.

Finite goal: independently review the derivation, clustered sampling, finite sample selection, authenticated evidence and negative-result behavior; reproduce and repair material defects; test and hand off the exact revision. The review read AGENTS.md, REQUIREMENTS.md, PLAN.md, workflow, the L08 lane, protocol v2 and the original implementation evidence. No protocol change or numerical criterion relaxation was necessary.

## Material finding and repair

**P1 — the JavaScript API could authenticate one score and analyze another.** The shared canonical JSON helper accepts accessor properties and omits hidden properties. The original calibration API hashed and cloned caller objects but subsequently ingested those original objects. A getter could return the authenticated candidate score zero for the records digest, report clone and receipt digest, then return three during validation and aggregation. A focused reproduction on the original implementation returned `criterion-met`, retained candidate records with score zero, and reported candidate family means of three. The zero-score receipt set was fixed before installing getters. This is an authentication/analysis mismatch, not a statistical ambiguity.

The ordinary parsed-JSON path cannot contain accessors; the exposed JavaScript API can. The fix therefore stays local: reject executable/hidden properties, proxies, symbol keys, non-plain objects and malformed arrays; recursively detach and freeze the exact data subsequently authenticated and analyzed. Trust callbacks receive immutable record snapshots. Mutating caller-owned records during authentication cannot alter the observations. Both accessor and hidden-field regression tests failed before repair; the accessor exploit was separately verified with explicit assertions on its false positive and contradictory retained evidence.

The implementation method domain changes from `A1-L08-v2-cluster-empirical-bernstein-v1` to `A1-L08-v2-cluster-empirical-bernstein-v2`. This prevents silent reuse of old artifact identities under the repaired implementation. Protocol v2, its thresholds and all statistical formulas are unchanged. The common contracts helper was not edited. The lead must integrate/review this bounded repair before relying on it.

## Statistical and integrity disposition

The primary source was opened directly: [Maurer and Pontil (2009), Theorems 1 and 4](https://www.cs.mcgill.ca/~colt2009/papers/012.pdf). Reflection and range scaling give the implemented lower-bound constants; their pairwise sample variance equals the unbiased centered variance used here. A task mean, not an individual repeat, is the sampling unit. The five-family allocation is 0.01 per family, further divided by three for two comparisons and the absolute floor. These union bounds do not require independence between the comparisons. Monte Carlo lower bounds use Hoeffding's inequality with a union allocation over every family, comparator, scenario and searched count; reusing simulation prefixes across counts does not invalidate a union bound.

Independent checks and counterexamples covered:

- Three correlated repeats remain one task mean in summaries and paired analysis. Between-task and within-task variances remain distinct; no repeat pseudoreplication was found.
- The equality model resamples comparator cluster means, not candidate outcomes. Symmetric tail contamination and scale assumptions are explicit host inputs. A newly tested all-tail sensitivity prevents planning despite the optimistic scenario passing. Five tasks cannot empirically identify unknown candidate variance, correlation or tails; positive tail mass alone is not sufficient scientific justification.
- Selection requires every comparator/scenario's Monte Carlo lower bound to clear 80%. An additional scenario enlarges the multiplicity penalty. The selected count is conditional on those models and does not establish 80% joint probability of passing both comparators, the absolute floors and every hard gate.
- The finite work ceiling, failed planning and execution-grant infeasibility checks remain active. Whole-plan cost uses all three systems and three repeats. Supplied prices and resource identities require independent host verification; the analysis is not a physical spending enforcer.
- All four seal stages are mandatory. Configuration/source identity changes, altered seeds/counts/order, pilot reuse, duplicate records and candidate pilot records fail closed. Canonical ordering remains stable on inert JSON. Actual authenticated chronology, no earlier candidate exposure, evaluator independence, randomized dispatch, source provenance and secret task isolation remain host obligations; a true-returning callback proves none of them.
- Failed outcomes remain zero scores with reasons. Absent/missing results and unknown accounting remain indeterminate; hard violations override mean quality. A frozen attempt cannot gain cases or change margins based on candidate outcomes. No record was removed to obtain a pass.

Disposition: the reviewed statistical implementation is consistent with its declared conditional method; the material seal mismatch is repaired and regression-tested. This is a finite engineering review, not acceptance of a real sampling model, margin, source authentication system or live experiment. Every analysis remains `admissionEligible: false`. No comparator pilot, candidate competence, parity, growth or H1 claim is established.

## Validation and handoff

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (v24.13.0). Existing root `node_modules` was symlinked read-only for the TypeScript check; no package or lockfile changed.

```text
node --test evaluations/calibration/index.test.ts
Original implementation and original tests: 12 passed, 0 failed.
Original implementation plus first two regression assertions: 12 passed, 2 failed.
Original implementation, explicit accessor exploit assertions: 1 passed.
Repaired implementation and expanded suite: 18 passed, 0 failed, 0 skipped.

node node_modules/typescript/bin/tsc --noEmit
exit 0
```

All runs were local pure checks. No physical application, systemd, provider/comparator, deployment, Slack, paid call or push occurred. The integrating lead receives exact handoff commit IDs separately; this committed record travels with the repair. Remaining gates are a qualified host with authenticated real observations and chronology, justified calibration assumptions/resources and independent private acceptance execution. Engineering completion does not open candidate live scoring by itself.
