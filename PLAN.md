# Implementation plan

Planning baseline: **2026-10-08**; implementation status reconciled **2026-10-09**. This is a repository backlog, not a schedule or a claim of deployed capability. Work-item granularity, sequencing, and IDs are newly proposed to make the conversation actionable. No external issues have been created.

## Current state

**Current disposition, 2026-10-09:** A real direct-operator conversation produced a Mistral-authored cognitive change, passed checked succession/probation, and published the exact admitted source as `f3def48`. This closes the live direct interaction demonstration, not the full Slack-origin acceptance matrix or autonomous plan execution. The autark cannot yet select and complete this backlog itself. The catalog, durable executor and item-specific checks are implemented with successive-shed fixture evidence; final verification, installation and repeated live Mistral sheds remain pending. Earlier “done at local seed scope” entries describe component verification, not readiness of the complete companion. The [2026-10-08 capability audit](docs/capability-audit-2026-10-08.md) records the earlier baseline; [progress](docs/progress.md) records subsequent changes.

- [x] Distill the accessible conversation and attached brief into requirements, engineering rules, architecture, ADRs, memory/growth specifications, and acceptance scenarios.
- [ ] Resolve implementation decisions and build the seed.
- [ ] Execute the acceptance suite and demonstrate recovery and self-directed growth.

The implementation lead owns integration; bounded store/isolation, communications/procedures, provider/growth, candidate, review, and custodian workstreams are delegated under [AGENTS.md](AGENTS.md). Status below is based on executed checks, not the existence of source files. Detailed results and unresolved gaps are in [progress](docs/progress.md).

| Item | Status | Implemented evidence / remaining gate |
|---|---|---|
| P01 | In progress | Node 24/TypeScript, SQLite, direct API, external state and local sandbox selected in ADR 0008/0009; Mistral model verified; production host remains open. |
| P02 | In progress | Task, effect, memory, growth, communications, procedure and succession contracts implemented with deterministic positive/negative checks; consolidated seed evidence is being assembled. |
| P03 | Infrastructure and bounded dispatcher verified; general coding workflow incomplete | Durable tasks/providers and bounded conversational source proposals pass, including live Mistral. General repository/tool execution and the full crash/outage matrix remain open. |
| P04 | Transport verified; authority refinement and work reporting incomplete | Direct/HTTP, signed Slack HTTP and Socket Mode checks pass, including scope, controls and reconnect. Live user mention → Mistral → Slack thread reply passed after large-history recovery was repaired. R21 direct testing supported. Separate broad human conversation admission from self-modification eligibility under ADR 0014; new behavior needs verification. Periodic progress/error notifications and real conversational work integration remain open. |
| P05 | Done at local seed scope | Real macOS restrictions, process-bound workers, serving CLI, independent review and provider-independent mechanical recovery verified. Hard resource quotas and production-host deployment remain outside this local disposition. |
| P06 | In progress | Scoped storage, bounded consolidation, source-version invalidation, current snapshots, actual rollback continuity and local benchmark verified. Live consolidation mechanics passed; qualitative evidence calibration failed and remains open. R22 external state enforced. |
| P07 | Direct API verified; conversational use incomplete | Numeric CSV aggregation, independent held-out execution, policy-bound fresh review and exact-identity reuse verified. Live Mistral publication passed after a protocol correction; two new inputs/reopen/republish used no further inference. Ordinary Slack turns cannot invoke it yet. |
| P08 | Scheduler verified; developmental/product acceptance open | Four-dimensional agenda, bounded experiments, priority, autonomous timer, persistent daily windows and concurrent debit verified. Serving queues proposals through governed evolution; an operator-selected live inquiry produced an admitted source improvement. Recent six automatic queue attempts yielded no promotion; conversational initiation and demonstrated useful development remain open. |
| P09 | Candidate mechanics and targeted source demonstration verified | Frozen candidate checks, compile-but-wrong rejection and actual live behavior change verified. Two model proposals failed the held-out scope gate; the third passed and was pushed unchanged as 5044b57. |
| P10 | Done at local seed scope | Fresh digest-bound review, strict evidence/coverage validation and fixture calibration verified; live procedure/source reviews passed. Review remains fallible. |
| P11 | In progress | Live role-bound succession messages, acceptance and readiness passed, but the question was largely an assessment and no new challenge arose. Improve stage-specific questioning and demonstrate grounded disagreement before full A12 acceptance. |
| P12–P14 | Mechanical release/recovery components verified | Actual handoff, fencing, provider-independent failure recovery, retirement and governance boundaries verified; a live model-authored release completed cutover/probation. These replace cognitive workers, not the outer service. Full custodian replacement remains disabled. |
| P15 | In progress | Bootstrap/local evidence available. Complete product demonstration, operational health/recovery commands and backup/restore validation remain open. |
| P16 | Bounded interaction implemented; live direct shed/publication verified | ADR 0015 connects eligible conversation → deliberation → cognitive source proposal → governed worker succession → configured trusted publication → actual thread result. Real Mistral direct-operator release published `f3def48`. Live Slack-origin release, general coding/procedure dispatch and full product acceptance remain open. |
| P08/P09 plan-driven refinement | Executor and item checks implemented; integrated fixtures verified; deployment/live model evidence pending | ADR 0017 defines dependency-linked, independently checkable P06 work. Durable selection, source binding, real-worker shedding/publication and restart passed fixtures. Final verification and two live Mistral sheds remain gates. |

## Milestones

| Milestone | Outcome | Work items | Exit evidence |
|---|---|---|---|
| M0 — Contracts and choices | An implementable first slice with explicit authority and storage boundaries | P01–P02 | Resolved ADRs, versioned contracts, selected checks |
| M1 — Working companion slice | Real provider/tool work and Slack interaction survive process interruption | P03–P05 | A05–A07; configured adapter smoke results |
| M2 — Memory and initiative | Developmental continuity, reusable procedures, and autonomous growth within budgets | P06–P08 | A01, early A02, A03, A08–A09 |
| M3 — Candidate evaluation | Immutable candidates, independently gathered checks, fresh review, and continuity interview | P09–P11 | A10–A12 |
| M4 — Skin Shed | Single authority, safe transfer, probation, and provider-independent recovery | P12–P14 | A13–A17 and integrated A02, including combined failure demonstration |
| M5 — Operable seed | Reproducible bootstrap, recovery instructions, end-to-end evidence, reconciled docs | P15 | Full seed acceptance report; no unaddressed release blockers |

**Milestone disposition after audit:** M1 has verified Slack/task/provider mechanics but lacks general tool work. M2 is partial. M3/M4 have substantial tested infrastructure and one narrow live source demonstration, with meaningful-interview quality still open. M5 and complete seed acceptance are not met.

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

**Expected behavior at the verified ADR 0013 baseline:** An allowed user starts or invites Palimpsest into a thread with a mention. Subsequent ordinary messages and controls from allowed users in that exact joined thread reach the same runtime without another mention, including after restart. Ignore unrelated top-level messages, unjoined threads, bot/subtype events, DMs and disallowed users/workspaces/channels. Broader message subscriptions must not create unrelated tasks or store unrelated content. Deduplicate a single Slack message delivered through both mention and message subscriptions and across restarts. ADR 0014 supersedes only the conversation user gate: all human participants in configured scopes may converse, while the whitelist determines self-modification suggestion eligibility. The baseline evidence below does not establish that newer refinement.

**Implementation:** Subscribe to public/private channel message events and their required history scopes. Use durable Slack task existence to recognize joined threads, with a trusted lookup callback shared by both transports. Normalize duplicate delivery identity by workspace/channel/message timestamp. No history backfill or second task loop. Verify positive/negative cases, overlap ordering and persistent conversation membership; update the installed Slack app and reauthorize new scopes before claiming live mention-free delivery.

**Evidence:** 199 tests passed with one platform skip; typecheck, 23 combined adapter checks, manifest JSON and changed local links passed. Independent review found no blocking issue. Both installed channel history scopes authenticated after reauthorization. The updated service accepted a fresh unmentioned follow-up in an existing mentioned thread, made one Mistral call and completed a delivered Slack reply. Actual exchange and integration evidence stay outside Git. The ordering and legacy-event limits in ADR 0013 remain explicit.

### P04 — Keep Slack and long-running work coherent

**Priority:** P0. **Dependencies:** P03. **Requirements:** R04, R17–R19, R21, R23–R24.

Implement shared communications contracts with direct calls, an authenticated local API, and authorized Slack ingress/egress with task/thread correlation, deduplication, continuing communication, progress, corrections, and cancellation. Prepare the egress boundary for P12's authority enforcement. Multiple active contexts do not require a new chat website.

**Done when:** A05–A06 and A19 pass, running work remains addressable, repeated events do not duplicate effects, and conversations cannot acquire each other's context accidentally.

### P04 refinement — conversation admission and modification authority

**Status:** Immediate policy/provenance slice implemented; deterministic verification completed and live service reloaded. A live capability-answer probe is recorded separately. **Priority:** P0. **Dependencies:** Existing authenticated Slack transports and external task store. **Requirements:** R04, R23; [ADR 0014](docs/adr/0014-conversation-and-modification-authority.md).

**Problem:** The former Slack user allowlist blocked ordinary conversation as well as potential privileged requests. Removing that gate without durable per-message provenance would let a later participant, quotation, memory or growth inquiry inherit another user's apparent authority.

**Expected behavior:** Accept human mentions and joined-thread follow-ups in authenticated configured workspace/channel scope regardless of modification whitelist membership. Preserve bot/subtype/DM exclusions, unrelated-message filtering and canonical duplicate identity. A trusted host records authenticated Slack workspace/user identity as immutable task metadata in the external store; message text, provider output or candidate code cannot supply those facts. At inference, the host assesses current self-modification eligibility and supplies capability/storage facts plus author and per-memory source facts after candidate request construction. `SLACK_SELF_MODIFICATION_USER_IDS` is the new whitelist; if absent, use legacy `SLACK_ALLOWED_USER_IDS`. An explicitly empty new whitelist denies all Slack human self-modification eligibility. This does not disable conversation. Legacy records without authenticated authors are ineligible, rather than inheriting trust from a thread. Status remains available in its thread; cancellation/correction of a Slack task requires its original author, with a correction retaining the command author's provenance.

**Acceptance criteria:** Both HTTP and Socket Mode admit a nonwhitelisted human mention/follow-up inside configured scope and deny invalid authentication, out-of-scope identities/channels, bots/subtypes, DMs and unjoined ordinary messages. Each message keeps its authenticated author in a mixed-author thread, in either duplicate delivery order and after reopening storage; a duplicate with conflicting authors fails rather than overwriting identity. Whitelist assessment reflects current host policy, including legacy fallback, an explicitly empty new whitelist, and unknown legacy authors. Quoted whitelist identities or claimed roles in text do not grant eligibility. A different thread participant cannot cancel/correct another author's task; the original author can, and correction provenance is retained. Candidate request construction cannot replace host capability or authority facts. Durable storage is truthfully distinguished from in-memory test storage. These facts expose source restrictions for each supplied memory, not an inferred authority from the thread as a whole.

**Non-goals:** Implementing semantic deliberation, action tools, proposal dispatch, a shared conversation-to-growth feed, Git publication, unsolicited channel listening, DM support or a broader deployment boundary. These checks prove ingress, host facts and provenance, not a functioning self-modification request path.

**Material risks:** More permitted humans can consume the existing shared inference budget; task/thread context remains shared within an admitted thread. Provenance on new messages does not automatically label old memories or authorize future consumers. P16 must preserve and check sources through cognition, consolidation and growth before dispatching privileged work. No document grants broader host or release authority.

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

### P16 — Connect conversation to real capabilities and governed work

**Priority:** P0, active product integration work. **Dependencies:** P03–P04, P07–P14, the conversation/authority refinement. **Requirements:** R04–R08, R10–R19, R21–R24. **Status:** Bounded interaction implemented; integrated fixtures and a live direct-operator Mistral shed with production Git publication verified. Live Slack-origin release and full acceptance remain pending. General action integration remains open.

**Problem at work start:** Slack turns returned only text and deterministic controls, without a repository/procedure/source-evolution dispatcher or Git publisher. At the capability audit they received no authoritative host capability/storage facts, and a live answer incorrectly denied on-disk memory and omitted separate evolution machinery. The P04 refinement supplied that foundation; the first P16 slice now supplies bounded cognitive proposal/action dispatch. Earlier component completion labels obscured this missing product path; broader action integration remains open.

**Expected behavior:** Capability answers reflect configured tools, persistent storage, active release and actual authority. Slack conversations feed a deliberative process that considers goals, evidence, commitments and resources rather than treating every message as an imperative. It may clarify, disagree, decline, defer or propose work. For human-origin self-modification, only a whitelisted authenticated author can supply an eligible suggestion; that is permission to consider it, not permission to execute or release it. An eligible, reasoned and authorized request can perform bounded coding/procedure work, report actual progress/results, propose a change through the existing evaluation/succession path, and publish admitted bytes through a trusted Git operation when configured authority permits. No claim of action follows merely from generated text. Keep current memory, budgets, thread scope, uncertain-effect handling and process fencing intact. Do not expose unrestricted host control or silently widen cognitive-only admission.

**Done when:** One eligible user-requested Slack change completes end to end with independently observed source, checks, exact admitted/published identity, actual remote publication and a serving successor. Repeat with interruption/provider failure and current-memory continuity. Deliberation demonstrably declines or revises an unsuitable eligible suggestion; a nonwhitelisted suggestion remains conversational and cannot reach source-change dispatch through quotation, another participant's authority, consolidation or growth. Independently justified standing growth remains available under its existing mandate, with its provenance explicit. The agent correctly describes these abilities and their limits after restart. The application must perform the wired operations; an operator manually substituting for missing steps does not satisfy this item. Prompt-only fixes or simulated tool callbacks do not close it.

**First implemented slice:** [Conversational self-modification](docs/conversation-self-modification.md) and [ADR 0015](docs/adr/0015-conversational-self-modification.md) connect one structured deliberative decision, immutable source-task binding, host-enforced current whitelist eligibility, a separate durable release queue, bounded human-request allocations, existing cognitive admission gates, configured exact-artifact Git publication and actual thread results. The real-host integration fixture passed through five release calls, actual restricted worker cutover/probation, exact admitted-byte commit/push into a local bare remote, a durable original-thread notification and successor follow-up behavior. A subsequent real Mistral direct-operator request completed five release calls, cutover/probation and application publication of `f3def48`, independently observed on the configured remote. Live Slack-origin acceptance remains separate.

**Slice limits and remaining checks:** Candidate source remains direct `src/agent/*.ts`; CLI context supplies admitted `brain.ts` plus contracts/rules rather than every helper. Succession replaces the cognitive worker, not the outer Slack service. Interactive release calls default to 8/day with a maximum of 8/attempt, separate from autonomous allocation. `ask` can record a proposal; `serve` runs the queue. Focused author/policy, protected-path, context filtering, direct cancellation and effective Git destination negatives pass. The full restart/interruption/provider failure/publication reconciliation and truthful live-answer matrix remains open; do not count it as established by the successful integration path.

**Still open beyond this slice:** General coding/procedure dispatch, source-aware memory consolidation, broader source scope and host/custodian evolution, full product continuity and qualitative acceptance. A trusted decision must distinguish independent observations from acting on restricted human instructions; assigning an autonomous-growth label is not authorization. The specification grants no additional runtime or publication authority. See [the capability audit](docs/capability-audit-2026-10-08.md) and [ADR 0014](docs/adr/0014-conversation-and-modification-authority.md).

### P08/P09 refinement — autonomous implementation-plan shedding

**Status:** In progress; catalog, durable executor, source binding, authoritative item validators and serving integration implemented with fixture evidence. Deployment and repeated live model evidence pending. **Requirements:** R01, R03, R06–R07, R09–R19, R22–R24. **Dependencies:** Existing growth, checked succession, configured publication and operator host-baseline installation. See [the testable specification](docs/plan-driven-evolution.md) and [ADR 0017](docs/adr/0017-plan-driven-shedding.md).

**Problem:** The autark can investigate and propose source changes, but has no durable plan executor or authoritative proof that a proposed change completes a work item. Autonomous promotion without publication, stale complete-file proposals, insufficient remaining allocation and accumulating raw growth context also undermine successive sheds.

**Expected behavior:** Select unfinished eligible host-owned work without a new human prompt, implement against exact admitted source, apply independent per-item and baseline checks, shed through the existing release gates, reconcile publication, and continue from durable state after restart. Current capability is revalidated after rollback; historical completion does not prove the current release still meets a dependency. User commitments, finite allocations and restricted human provenance remain enforced.

**Done when:** Two useful dependency-linked P06 changes are independently checked and generated by configured Mistral in successive live sheds, with exact remote publication and restart between them; failure feedback, interruption, budget deferral, stale source, publication uncertainty and rollback cases pass. The first item preserves memory lineage; the second establishes a UTF-8 context budget while retaining lineage. This starts an executable subset and does not complete the full P06 backlog or grant authority to rewrite protected host/custodian code.

**Non-goals and risks:** No model-authored catalog/checks, automatic expansion to protected code or silent budget refill. Generic checks and model approval alone cannot establish new behavior. Full histories remain external; bounded continuity projections must preserve current operational state and explicit omissions. Persistent outer-service supervision is a separate operational foundation, not an autonomous host-evolution capability.

**Live recovery follow-up:** The first deployed executor made no authoring call because the earlier successful publication was treated as uncertain after a host commit advanced the remote branch. Resolve this with independently observed remote ancestry and exact saved-source verification, with no push replay or checkout mutation. The [publication recovery contract](docs/plan-driven-evolution.md#publication-recovery-after-later-host-commits) defines its acceptance and uncertainty limits. Live plan sheds remain pending.

**Persistent-host checking follow-up:** After publication recovery, Mistral authored a minimal provenance change and all three item fixtures passed. Its baseline typecheck failed to resolve Node declarations through the copied host's dependency link. Reproduce and correct canonical toolchain resolution without widening isolation or changing the candidate; separately review/install the host fix before another allocated attempt. The original proposal call is not refunded. See [the relocated-checking contract](docs/plan-driven-evolution.md#candidate-checking-from-the-persistent-host-bundle).

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

Policy refinement verification: TypeScript and the integrated suite passed 205 tests with one platform skip. Both transport fixtures admit a nonwhitelisted author; on-disk restart/current-policy, duplicate/legacy authorship, task-control ownership, exact candidate memory descriptors and mutation resistance passed. Fresh independent review found no remaining blocker after fixing candidate-input mutation and unlabelled-memory gaps. This does not establish the planned conversation/growth/action dispatcher.

P16 qualitative follow-up: two one-call direct Mistral capability probes correctly reported persistence, missing conversation dispatch and Git limits. After explicit facts, the second corrected growth inputs but still repeated a false denial of implemented memory versioning from prior conversational memory. Add evidence-grounded capability-answer verification that checks remembered claims against host facts; supplying facts alone does not close this acceptance criterion.

Conversational slice verification: TypeScript and 216 integrated checks passed (215 passes, one unsupported-platform skip). Fixture providers drove real checked succession, exact local-bare-remote publication and durable original-thread results; fresh scoped review found no remaining blocker. Live model-driven deployment verification remains separately recorded in progress.

Host installation follow-up: a real conversation-originated Mistral proposal passed mandatory checks but custody correctly rejected the changed protected host baseline (`governance_change_disabled`). A separate operator-only baseline installation now binds the exact old/new artifacts, preserves unchanged cognition/schema/configuration, rechecks all three mandatory checks, stages and probes before fencing, retains current history and older rescue until activation succeeds, and preserves custody epochs/journals. It is absent from conversational tools. Failed activation and SIGKILL at the fence recover older code and current state; same-source, exact binding and ordinary-governance negatives are required. See [ADR 0016](docs/adr/0016-operator-host-baseline.md).

Operator installation follow-up verification: 222 integrated checks, 221 passed, one platform skip; TypeScript passed. Ordinary candidate governance equality remains enforced, and host installation does not include the pending human source proposal. Live operator deployment and subsequent real-model release results are recorded separately.
