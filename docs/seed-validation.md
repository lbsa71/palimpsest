# Local seed validation

This report maps acceptance contracts to reproducible evidence. A component test is evidence for the behavior it exercises; it is not a claim that every clause of a broad scenario has passed. Actual prompts, memories, candidate releases and per-run evidence remain in external local state.

## Acceptance ownership

| Contract | Reproducible checks | Additional integration evidence or limit |
|---|---|---|
| A01–A02: growth, fairness and continuity | `test/growth.test.ts`, `test/scheduler.test.ts`, `test/generations.test.ts` | Timer initiation, four dimensions, persistent finite windows, user priority and current growth state across generation changes. Live cognitive growth and adoption are recorded separately. |
| A03/A08: experience and storage | `test/memory.test.ts`, `test/store.test.ts`, `test/store-invariants.test.ts` | Scoped episodes, conservative interpretations, corrections, dependent-summary invalidation and interruption. See the predefined live rubric and local benchmark in [memory runtime](memory-runtime.md). Long-term personality development is unmeasured. |
| A04: engineering rules | [AGENTS.md](../AGENTS.md), component specifications, regression tests, delegated implementation and independent review | Review findings and actual test results are recorded in [progress](progress.md). |
| A05/A19: usable communications | `test/communications.test.ts`, `test/slack-service.test.ts`, `test/slack-socket.test.ts`, `test/runtime.test.ts`, `test/cli.test.ts` | Durable direct/HTTP/Slack normalization, thread scoping, status/cancel/correction during pending inference, deduplication and reconnect. Live bot authentication, native Socket Mode, durable user mention, Mistral inference and delivered thread reply passed on 2026-10-08 after fixing large-history recovery. Sustained live socket renewal and combined Slack faults remain unmeasured. |
| A06–A07: tasks and providers | `test/runtime.test.ts`, `test/providers.test.ts`, store tests | Actual Mistral structured-output and direct-runtime smokes passed. Native Codex CLI execution remains unverified. Unknown external effects are retained for reconciliation. |
| A09: reusable procedures | `test/procedures.test.ts` and publication-review integration checks | Real isolated CSV execution, independent expected totals, schemas, content identity, scratch/publication separation, reuse without inference and revocation. See [procedure contract](procedures.md). |
| A10–A11: immutable evaluation | `test/candidates.test.ts`, `test/review.test.ts`, `test/evolution.test.ts`, `test/isolation.test.ts` | Actual restricted compilation and protected behavioral assertions; compiling incorrect code, tampered inputs, forged/missing evidence and hostile access are rejected. Live model-authored source admission is recorded separately. |
| A12: bounded cognitive interview | `test/review.test.ts`, `test/custodian.test.ts`, `test/evolution.test.ts` | Fresh contexts, explicit snapshot/evidence identities, bounded disagreement, separate readiness and fail-closed decline. Fixture cognition is distinguished from a live interview. |
| A13–A14: catch-up and authority | `test/custodian.test.ts`, `test/generations.test.ts`, `test/workers.test.ts` | Real process identity, current scoped snapshots, quiescence, epoch fencing and stale tool/store/memory/message rejection. Unknown effects prevent unsafe transfer. |
| A15–A16: recovery and retirement | `test/generations.test.ts`, `test/custodian.test.ts` | Real startup failure, crash and hang while the observer is stopped and inference unavailable; persisted work resumes without a model call, with current memories/cancellations. Custodian SIGKILL recovery, bounded failed fallback, retirement and restart are exercised. These tests use deterministic cognitive fixtures. |
| A17: governance boundary | Candidate, custodian and isolation tests | Ordinary candidates cannot replace governance or change the schema. Full custodian replacement stays disabled until its separate rescue demonstration. |
| A18: temporary conversations | Not selected | No temporary-mode or end-to-end erasure claim. |
| A20: external lived state | `test/config.test.ts`, store/candidate tests, configuration inspection | Reject in-checkout paths, symlink aliases and dangling ancestors; all real state, credentials, release snapshots and run evidence stay outside Git. |

## Scope

The selected execution host is local macOS arm64 with Node 24 and Seatbelt. No production-host deployment, hard RAM/disk/CPU quota, broad cloud-provider capability calibration, physical erasure, or autonomous custodian replacement is claimed. Conversation turns currently produce text; approved procedures are explicit direct API operations. Source evolution is restricted to the cognitive module, with protected checks and release controls outside its authority.

The [first live source release](self-improvement-2026-10-08.md) records an admitted and pushed model-authored behavior change, two earlier rejected candidates, exact identities, call counts and remaining cognitive limitations. Use [PLAN.md](../PLAN.md) for current completion status and [progress](progress.md) for dated results. Full seed acceptance remains conditional on its stated integration gates; missing external credentials are never reported as successful connectivity.
