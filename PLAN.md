# Implementation plan

Planning baseline: **2026-10-08**. This is a repository backlog, not a schedule or a claim of deployed capability. Work-item granularity, sequencing, and IDs are newly proposed to make the conversation actionable. No external issues have been created.

## Current state

- [x] Distill the accessible conversation and attached brief into requirements, engineering rules, architecture, ADRs, memory/growth specifications, and acceptance scenarios.
- [ ] Resolve implementation decisions and build the seed.
- [ ] Execute the acceptance suite and demonstrate recovery and self-directed growth.

The implementation lead owns integration; bounded store/isolation, communications/procedures, provider/growth, candidate, review, and custodian workstreams are delegated under [AGENTS.md](AGENTS.md). Status below is based on executed checks, not the existence of source files. Detailed results and unresolved gaps are in [progress](docs/progress.md).

| Item | Status | Implemented evidence / remaining gate |
|---|---|---|
| P01 | In progress | Node 24/TypeScript, SQLite, direct API, external state and local sandbox selected in ADR 0008/0009; Mistral model verified; production host remains open. |
| P02 | In progress | Task, effect, memory, growth, communications, procedure and succession contracts implemented with deterministic positive/negative checks; consolidated seed evidence is being assembled. |
| P03 | In progress | Durable tasks, cancellation, call budgets, provider adapters and recovery tests pass; live Mistral structured output and direct runtime pass; full crash/outage matrix pending. |
| P04 | Done at local seed scope | Direct/HTTP, signed Slack HTTP and Socket Mode checks pass, including scope, controls and reconnect. Live user mention → Mistral → Slack thread reply passed after large-history recovery was repaired. R21 direct testing supported. |
| P05 | Done at local seed scope | Real macOS restrictions, process-bound workers, serving CLI, independent review and provider-independent mechanical recovery verified. Hard resource quotas and production-host deployment remain outside this local disposition. |
| P06 | In progress | Scoped storage, bounded consolidation, source-version invalidation, current snapshots, actual rollback continuity and local benchmark verified. Live consolidation mechanics passed; qualitative evidence calibration failed and remains open. R22 external state enforced. |
| P07 | Done at direct API scope | Numeric CSV aggregation, independent held-out execution, policy-bound fresh review and exact-identity reuse verified. Live Mistral publication passed after a protocol correction; two new inputs/reopen/republish used no further inference. |
| P08 | Done at local seed scope | Four-dimensional agenda, bounded experiments, priority, autonomous timer, persistent daily windows and concurrent debit verified. Serving queues proposals through governed evolution; an operator-selected live inquiry produced an admitted source improvement. |
| P09 | Done at local seed scope | Frozen candidate checks, compile-but-wrong rejection and actual live behavior change verified. Two model proposals failed the held-out scope gate; the third passed and was pushed unchanged as 5044b57. |
| P10 | Done at local seed scope | Fresh digest-bound review, strict evidence/coverage validation and fixture calibration verified; live procedure/source reviews passed. Review remains fallible. |
| P11 | In progress | Live role-bound succession messages, acceptance and readiness passed, but the question was largely an assessment and no new challenge arose. Improve stage-specific questioning and demonstrate grounded disagreement before full A12 acceptance. |
| P12–P14 | Done at local seed scope | Actual handoff, fencing, provider-independent failure recovery, retirement and governance boundaries verified; a live model-authored release completed cutover/probation. Full custodian replacement remains disabled. |
| P15 | In progress | Initial runbook and local checks available; complete seed demonstration pending. |

## Milestones

| Milestone | Outcome | Work items | Exit evidence |
|---|---|---|---|
| M0 — Contracts and choices | An implementable first slice with explicit authority and storage boundaries | P01–P02 | Resolved ADRs, versioned contracts, selected checks |
| M1 — Working companion slice | Real provider/tool work and Slack interaction survive process interruption | P03–P05 | A05–A07; configured adapter smoke results |
| M2 — Memory and initiative | Developmental continuity, reusable procedures, and autonomous growth within budgets | P06–P08 | A01, early A02, A03, A08–A09 |
| M3 — Candidate evaluation | Immutable candidates, independently gathered checks, fresh review, and continuity interview | P09–P11 | A10–A12 |
| M4 — Skin Shed | Single authority, safe transfer, probation, and provider-independent recovery | P12–P14 | A13–A17 and integrated A02, including combined failure demonstration |
| M5 — Operable seed | Reproducible bootstrap, recovery instructions, end-to-end evidence, reconciled docs | P15 | Full seed acceptance report; no unaddressed release blockers |

M2 and parts of M3 can proceed in parallel after their dependencies. M1 alone is not the completed Palimpsest seed: growth and succession are defining requirements.

## Work items

### P01 — Resolve the seed implementation choices

**Priority:** P0. **Dependencies:** none. **Requirements:** R04–R07, R18.

Inspect actual target hardware and configuration without copying secrets. Compare the small TypeScript seed proposal with alternatives against provider, Slack, memory, build, isolation, and recovery needs. Run bounded compatibility spikes where useful. Record runtime, package management, operational store, memory adapter, and deployment-boundary decisions in ADRs.

**Done when:** D01–D05 in [open decisions](docs/open-decisions.md) have an implementable initial disposition, selected versions are verified, and the first vertical slice is specified. Do not silently inherit the attachment's stack or hardware.

### P02 — Specify contracts and trusted acceptance ownership

**Priority:** P0. **Dependencies:** P01. **Requirements:** R03, R09–R19.

Define task/event identities, candidate manifest, evidence/grade envelopes, memory and procedure contracts, actor capabilities, succession record, and failure taxonomy. Choose which checks are trusted outside candidate control. Resolve exact succession states, wire schema, transitions, and retry/idempotency semantics.

**Done when:** contracts have positive and negative examples, A01–A17 have planned fixtures and test ownership, and deterministic tests can drive the core without inference. Resolve D06–D10 sufficiently for the slice; model-supplied roles and grades cannot become authority.

### P03 — Build durable task execution and provider boundaries

**Priority:** P0. **Dependencies:** P02. **Requirements:** R05, R17, R19.

Implement a bounded task loop, durable state transitions, typed tools, cancellation/checkpoints, provider abstraction, deterministic test adapter, and real Mistral path. Separate provider unavailability from application failure; alternatives require configuration and disclosure permission.

**Done when:** A06–A07 pass, a configured real-provider smoke test records its result, and missing configuration produces an honest unavailable state. Document invocation only after verification.

### Slack conversation refinement — follow-ups without repeated mentions

**Status:** Implemented, installed and verified with a live unmentioned reply. **User direction:** Thread follow-ups should not require explicitly mentioning Palimpsest each time (2026-10-08). **Area:** P04/P15, R04/R21.

**Expected behavior:** An allowed user starts or invites Palimpsest into a thread with a mention. Subsequent ordinary messages and controls from allowed users in that exact joined thread reach the same runtime without another mention, including after restart. Ignore unrelated top-level messages, unjoined threads, bot/subtype events, DMs and disallowed users/workspaces/channels. Broader message subscriptions must not create unrelated tasks or store unrelated content. Deduplicate a single Slack message delivered through both mention and message subscriptions and across restarts.

**Implementation:** Subscribe to public/private channel message events and their required history scopes. Use durable Slack task existence to recognize joined threads, with a trusted lookup callback shared by both transports. Normalize duplicate delivery identity by workspace/channel/message timestamp. No history backfill or second task loop. Verify positive/negative cases, overlap ordering and persistent conversation membership; update the installed Slack app and reauthorize new scopes before claiming live mention-free delivery.

**Evidence:** 199 tests passed with one platform skip; typecheck, 23 combined adapter checks, manifest JSON and changed local links passed. Independent review found no blocking issue. Both installed channel history scopes authenticated after reauthorization. The updated service accepted a fresh unmentioned follow-up in an existing mentioned thread, made one Mistral call and completed a delivered Slack reply. Actual exchange and integration evidence stay outside Git. The ordering and legacy-event limits in ADR 0013 remain explicit.

### P04 — Keep Slack and long-running work coherent

**Priority:** P0. **Dependencies:** P03. **Requirements:** R04, R17–R19, R21.

Implement shared communications contracts with direct calls, an authenticated local API, and authorized Slack ingress/egress with task/thread correlation, deduplication, continuing communication, progress, corrections, and cancellation. Prepare the egress boundary for P12's authority enforcement. Multiple active contexts do not require a new chat website.

**Done when:** A05–A06 and A19 pass, running work remains addressable, repeated events do not duplicate effects, and conversations cannot acquire each other's context accidentally.

### Operational defect — recovery with accumulated continuity

**Status:** Fixed and verified. **Area:** P05/P14/P15. **Trigger:** The first live Slack mention was durably queued after the five-minute worker lifetime expired, but both known-good recovery attempts failed. Accumulated continuity exceeded the worker pipe’s 256 KiB input-frame bound while remaining below the custodian’s existing 1 MiB snapshot bound.

**Expected behavior:** Known-good restart transfers the entire accepted snapshot and drains the queued request. Align the catch-up frame allowance with the existing snapshot limit, retain the smaller ordinary-request limit and scope/sequence validation, and preserve fail-closed bounded recovery. No state deletion or snapshot truncation. Verify a real restricted worker receiving more than 256 KiB and real generation recovery with that history; then retry the live queued mention through the operator recovery API.

**Evidence:** Both new checks reproduced the former mismatch. After the fix, real restricted-worker Unicode catch-up and real stopped-worker recovery with 300 KiB growth history passed, including scope/sequence and oversized-input rejection. TypeScript and the integrated suite passed: 196 tests, one platform skip. Operator `retryRecovery()` restored the same known-good generation; restarted service completed the queued mention with one Mistral call and a completed delivered Slack effect. Current data was preserved.

**Operations follow-up (P15):** Expose current execution health and a supported operator recovery command. A running listener/socket can outlive the active worker; startup connection status alone does not show execution readiness. Today recovery-required retry is a library operator API, not a CLI command.

### P05 — Establish isolation and mechanical recovery skeleton

**Priority:** P0. **Dependencies:** P02; integrate with P03. **Requirements:** R06, R09, R18.

Build the independent custodian skeleton, isolated jobs/candidates, scoped credentials, fixed release operations, health signals, and recoverable known-good artifact. Keep personality/planning in the agent. Document host versus environment authority and an outer rescue path.

**Done when:** relevant A11/A14 isolation failures are denied at boundaries and the custodian can restart known-good code with worker and provider absent. This preliminary restart test does not replace full A15.

### P06 — Implement memory and continuity

**Priority:** P0. **Dependencies:** P03, P05. **Requirements:** R02, R07, R19, R22.

Implement operational history separately from episodic, semantic, procedural, and autobiographical memory; provenance, uncertainty, revision, consolidation, retrieval, and authorized read-only snapshots. Benchmark the selected backend. If separate stores are used, demonstrate retryable publication and reconciliation across them.

**Done when:** A03/A08/A20 pass, mundane experiences survive consolidation, conflicting evidence can correct beliefs, and executable rollback preserves current history. Document forgetting versus erasure and backend limits. All lived state belongs in a local folder outside the checkout.

### P07 — Implement reusable procedures

**Priority:** P1. **Dependencies:** P03, P05; publication integrates with P09–P10. **Requirements:** R08, R18.

Add versioned manifests, schemas, permissions, examples, tests, bounded scratch execution, and reuse. Separate validating/publishing a procedure from executing identical approved code. Select a runtime through P01; Python-only was a colleague choice.

**Done when:** A09 passes and outputs are independently checked. Reuse requires neither regeneration nor repeated identical review. Unreviewed code remains scratch until publication gates exist.

### P08 — Implement the standing growth agenda

**Priority:** P0. **Dependencies:** P03, P06; release of code-changing experiments depends on P09–P14. **Requirements:** R01–R03, R17, R19.

Implement [GROWTH.md](GROWTH.md): all four dimensions, bounded idle/scheduled initiation, persistent experiments, evidence, failure lessons, and fair resource scheduling. Exploration can start before release automation; promotion of self-modifications must await its gates.

**Done when:** A01 and A02's early restart/fairness assertions pass without a new human prompt and interruption resumes the right experiment. Later A13/A16 must demonstrate agenda continuity across succession. Improvement cannot rest solely on an agent's own rating.

### P09 — Freeze candidates and collect trusted evidence

**Priority:** P0. **Dependencies:** P02, P05. **Requirements:** R10–R11, R18–R19.

Create isolated candidates, immutable manifests, independent behavioral/held-out checks, artifact identity, stale-base rejection, and evidence storage. Build with isolation and no deployment credentials. Include an actual assistant-source behavior change and a compiling but behaviorally incorrect counterexample.

**Done when:** A10–A11's deterministic gates pass, changing any frozen release input invalidates its evaluation, and only the evaluated artifact is eligible for promotion. Reviewer-specific assertions complete in P10.

### P10 — Add fresh independent review

**Priority:** P0. **Dependencies:** P03, P09. **Requirements:** R05, R11, R17–R19.

Implement fresh reviewer sessions with bounded source/diff/task/evidence context, strict pass/fail/inconclusive validation, provider configuration, and independently collected results. Calibrate against known defects and deceptive candidate material. Run candidate code separately from the credentialed reviewer.

**Done when:** remaining A10–A11 review assertions pass. Invalid, missing, mismatched, incomplete, or unavailable review never becomes a pass; a positive review cannot bypass failed checks.

### P11 — Implement mediated successor interviews

**Priority:** P0. **Dependencies:** P06, P09–P10. **Requirements:** R12–R13, R17.

Implement role-restricted succession methods, mailbox, continuity snapshot, readiness, verdict evidence, successor challenges, and bounded dispute handling.

**Done when:** A12 and the relevant A14 caller/state checks pass. Disagreement can improve a handoff without endless debate. Rejection preserves the incumbent and records a follow-up. MCP remains an adapter choice.

### P12 — Enforce cutover and reconcile in-flight work

**Priority:** P0. **Dependencies:** P04–P05, P11. **Requirements:** R13–R14, R18.

Checkpoint ownership, reconcile outstanding operations, catch up messages/corrections/cancellations, fence the predecessor, and activate the successor. Validate process-bound capabilities and epochs at tool, storage/memory, and message boundaries. Do not promise exactly-once effects across arbitrary external services.

**Done when:** A13–A14 pass under retries, crashes, delayed requests, and cancellation races. Ambiguous external effects enter reconciliation instead of blind replay.

### P13 — Prove probation, rollback, and retirement

**Priority:** P0. **Dependencies:** P12. **Requirements:** R09, R15, R19.

Implement bounded probation, event-triggered predecessor observation, regression reports, deterministic health checks, new-epoch rollback, and retirement retaining runnable recovery artifacts. Test compatibility with current data/schema.

**Done when:** A15–A16 pass, including B failing while A's observer is stopped and inference unavailable. Ordinary recovery requires no model reasoning or routine human maintenance.

### P14 — Establish separate governance and custodian evolution

**Priority:** P0 for the boundary; full replacement may be staged. **Dependencies:** P13. **Requirements:** R06, R16, R18.

Test that ordinary candidates cannot rewrite their admission criteria. Specify a separately evaluated custodian/governor upgrade contract retaining an older rescue path. Enable actual custodian replacement only after its dedicated failure tests pass.

**Done when:** A17's seed admission-boundary assertions pass and the separate upgrade/rescue contract is reviewed. Autonomous custodian replacement remains explicitly disabled/unimplemented until its own recovery demonstration passes.

### P15 — Bootstrap, runbook, and seed demonstration

**Priority:** P0. **Dependencies:** P04, P06–P08, P10–P14. **Requirements:** R01–R19.

Produce reproducible bootstrap, configuration without secrets, operational and backup/restore instructions, limitations, and an evidence report. Execute integrated scenarios and outage/recovery controls; reconcile documentation and milestone status.

**Done when:** A01–A17 pass at their stated seed scope, deferred capabilities remain explicit, and another operator can follow bootstrap/recovery instructions. A18 is required only if temporary mode is selected.

## Deferred and optional work

| Item | Trigger / gate |
|---|---|
| MCP adapter | Interoperability need; verify current transport/authentication requirements and retain inference-free recovery |
| Temporary conversations | Explicit product selection; complete A18 before retention claims |
| Website or another conversation UI | Demonstrated need; preserve Slack direction |
| Memory/personality/model succession | Tailored acceptance and rollback contracts |
| Additional/local providers | Explicit configuration, capability evaluation, cost/data policy; no silent fallback |
| Full custodian/environment replacement | Separate rescue path and demonstrated upgrade-failure recovery |

## Completion record

For every item, record owner, status, requirement and ADR, criteria, actual checks/results, evidence location, review findings, deviations, and follow-ups. Statuses: `not started`, `in progress`, `blocked` with a concrete dependency, and `done` with evidence. Failed experiments can complete learning items; they do not satisfy implementation criteria that failed.

Use the [work-item template](.github/ISSUE_TEMPLATE/work-item.md) and [pull-request template](.github/pull_request_template.md). No deadlines or estimates are inferred from the conversation.
