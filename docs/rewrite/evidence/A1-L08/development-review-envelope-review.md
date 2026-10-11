# Developmental review envelope: fresh integrity review

2026-10-11, A1-L08-T05-a consequential review. Owner `/root/a1_development_envelope_review`, branch `codex/a1-development-envelope-review-20261011`, exact author checkpoint `9e45d0f426490d0b62a88e6fe7b81c7076a7ae84`, root reservation `3998f38`. The actual finite goal was created before inspection. Exclusive writes are this document and [the independent review tests](../../../../evaluations/development/review-envelope-review.test.ts). Production source, author fixtures and prior evidence remain read-only. **Initial disposition: source acceptance blocked by R1–R3 below; repairs belong to the exclusive author.**

```text
/goal Independently review the developmental v2 review envelope at author commit 9e45d0f426490d0b62a88e6fe7b81c7076a7ae84; retain focused causal offline review tests and evidence, report actionable defects for author repair, and commit only the two assigned new review files.
```

The review read root requirements/plan/AGENTS, workflow, L08, the [adopted acquisition design](development-acquisition-design.md), [frozen envelope specification](development-review-envelope.md), current envelope and v1 witness/fixture/review code, shared authentication/contracts, and actual `ResourceLedger` reserve/dispatch/settle semantics. It examines mechanical integrity and explicit trust boundaries. It cannot establish live elapsed development, observation completeness, provider/model/reviewer competence, actual host allocation enforcement, parity, H1 or admission authority.

## Retained first failures

The baseline builder in the new test file is copied, with attribution, from the exact author checkpoint. Independent mutations and assertions are new. Reusing its valid signed starting fixture holds unrelated behavior constant; public fixture keys are synthetic and confer no actual authority. Mutations resign documents and recompute internally consistent closure inventories/totals where necessary. They therefore test causal conservation rather than merely invalid signatures or stale totals.

First command, with Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` selected through `PATH`:

```text
node --test evaluations/development/review-envelope-review.test.ts
5 tests: 1 passed, 4 failed, 0 skipped; exit 1
```

All four intended rejection assertions failed with exactly the unchanged baseline finding:

```json
[{"status":"unavailable","code":"synthetic","detail":"Synthetic fixture is permanently ineligible as live developmental evidence"}]
```

The permanently synthetic designation correctly prevents live use. It is not a mechanical rejection of these invalid histories. No test changes the fixture to live-development or claims that synthetic success establishes competence.

| Finding | Causal reproduction and consequence | Required disposition |
|---|---|---|
| **R1 — high: model judgments are disconnected from accounted execution** | Delete every review-tail transition, retain both signed model-role judgments, recompute C to the two remaining original/behavior requests. The result has no missing-review-execution finding. Separately move reviewer A's signed judgment to t=181, before its first reservation at t=182 and settlement at t=184; it also passes mechanics. `DevelopmentReviewBinding` has no physical request or response derivation identity, and the verifier never connects judgments to T. An internally consistent C can omit the entire cost of producing both judgments. | Introduce and verify a causal binding to the assigned role's actual retained request/response and judgment derivation, with ordering. A merely nonempty role request list does not prove that those requests produced these judgments or consumed B. Preserve human-only v1 semantics; this v2 registration explicitly assigns non-null model profiles to reviewers. |
| **R2 — high: reservation ignores original elapsed wall lifetime** | Give reviewer A an elapsed ceiling of 500,000 ms at t=182. Original issuedAt is t=-5, so the root has already used 187,000 ms of wall lifetime. The grant is 600,000 ms. The envelope accepts because its instantaneous physical sum is below 600,000 and final actual usage is small. Actual `ResourceLedger.reserve` checks `max(wall elapsed, already charged physical elapsed) + new ceiling`, i.e. at least 687,000 ms, and rejects. | Apply the original clock to every reservation, using pre-event state plus the new ceiling. Final elapsed validation cannot repair an impossible earlier reserve. Actual descendant allocation start times/limits still require qualified bridge provenance. |
| **R3 — high: physical overrun does not stop subsequent dispatch** | Set reviewer A's authenticated settled input to 200 tokens (201 total), above its 100-token physical ceiling but below the 2,000-token root allowance. Recompute C and retain reviewer B's subsequent reserve/dispatch. The envelope accepts. Actual `ResourceLedger.settle` cancels the original root on any token/cost/elapsed physical ceiling overrun, so B cannot then reserve or dispatch. | Replay cancellation caused by physical overruns across B and T, allowing valid settlement/reconciliation of existing work but blocking subsequent reserve/dispatch. Retain negative/unavailable reports and actual charges; do not erase the overrun or raise the allowance. |

R1 concerns physical model-review provenance, not proof that a model semantically understood its evidence. Even with exact request/response linkage, observer completeness, isolated fresh contexts, provider disclosures and competent independent judgments remain externally qualified facts.

## Additional bounded checks

The expanded review command returned **12 tests: 8 passed, the same 4 failed, 0 skipped; exit 1**. The seven additional probes establish that:

- An oversized raw response from a failed reviewer draft is charged against the per-artifact limit.
- B and T plus retained review bindings share the preregistered record count.
- Signed envelope overhead and raw artifacts share one evidence-byte allowance.
- Wrong raw transport-response bytes fail despite unchanged accounting.
- Two accepted reviewer IDs cannot collapse into one principal.
- A reviewer signing a different B fails even with updated C.
- A preattempt uncertain anchor cannot reconcile during B; its authenticated reconciliation during T preserves B's uncertainty and settles A1.

Normal `npm run check` (strict TypeScript, Node 24 PATH above) passed, exit 0, with the new review file included. `git diff --check` passed.

The original author reports 54 focused passing cases. This review does not relabel that report as independently executed. The new test command executes only the assigned review file. Its source read confirms separate signature domains, complete accepted role/configuration/profile bindings, explicit effect allowlists and null prompts, immutable B reconstruction, phase-specific dispatch ordering, transition identity matching, terminal replay rejection, conservative unknown charges, observable root/role concurrency, retained raw artifact hashing, two externally accepted reviewers and false admission flags. Those mechanisms do not resolve R1–R3.

## Quiescent preattempt boundary

The explicit limitation that `registration.originalRequests` must remain unchanged through B is a defensible scope restriction for this finite recorder, conditional on a **qualified, enforced quiescent boundary**. It is not evidence that such a boundary is implemented. Settled immutable original requests qualify; an uncertain request can qualify only when its pending external state and reconciliation path are understood and no original-anchor transition can occur during B. A one-time read showing no active local process cannot establish that condition. The bridge must fence existing dispatch/reconciliation writers or otherwise substantiate that no anchor changes until T. If it cannot, preflight must refuse before dispatch, or the broader behavioral-accounting adapter needs separate specification/review. It must preserve the same original root, issued-at clock, ceilings and full prior inventory; it cannot manufacture quiescence by dropping requests, opening a new grant, resetting time or postponing already observed settlements out of their causal order.

This narrowing leaves ordinary within-attempt candidate/control uncertainty at B and later T reconciliation supported. It does not change the behavioral thresholds or silently reinterpret v1 `originalAccounting`. Original v1 exported entrypoints remain fixed to candidate configuration/model; the shared v2 wrappers explicitly label their projection. Nothing here licenses using an unsigned caller map as external role qualification.

## Pending handoff

Root has received the exact reproductions and requested an immutable failure/specification checkpoint before author repair. R1–R3 are unresolved at this checkpoint. After exclusive-author repair, this reviewer must inspect the exact repair diff, adapt only fixture construction for legitimate frozen-interface changes, and rerun the unchanged rejection predicates plus directly affected valid cases. Root owns integration, serialized aggregate checks and downstream recorder/bridge/model-review reservations. No native workload, real process/clock boundary, provider/account/network operation, Slack message, deployment, push or broad materialization/hash sweep was performed.

### R3 cancellation boundary follow-up

After initial immutable checkpoint `4ce1f653cbeb3fc938b821f597a7714db87e9f2e`, two narrow cases distinguish cancellation from loss of settlement authority. With reviewer B reserved before A's overrun but dispatched afterward, the expected rejection still fails (same sole synthetic finding). With B both reserved and dispatched before A's overrun, B's later authenticated settlement correctly succeeds and preserves all 212 charged tokens. A repair must keep the second case retainable. Targeted Node command `node --test --test-name-pattern='root overrun also|physical overrun retains' evaluations/development/review-envelope-review.test.ts` returned 2 tests, 1 passed, 1 failed, exit 1. This is the same R3 finding, not a fourth defect.
