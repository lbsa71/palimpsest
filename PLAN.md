# Implementation plan

Planning baseline: **2026-10-08**; implementation status reconciled **2026-10-09**. This is a repository backlog, not a schedule or a claim of deployed capability. Work-item granularity, sequencing, and IDs are newly proposed to make the conversation actionable. No external issues have been created.

## Current state

**Priority clarification, 2026-10-09:** The user requires basic iterative coding in the seed and full autonomy over the whole codebase, including potential library forks. The narrow cognitive-only proposal path below does not meet that requirement. [P17](#p17--implement-the-seeds-iterative-coding-capability) and [P18](#p18--enable-autonomous-evolution-of-the-whole-codebase) are P0 implementation work under [ADR 0019](docs/adr/0019-coding-autonomy-and-reusable-agent-plumbing.md). Astra in “Explain code change tooling” owns strategy/contracts; Sol in “Distill autonomous agent research” owns implementation/tests. The existing peer-security failures remain tracked; broader coding authority must preserve those boundaries.

**Current disposition, 2026-10-09:** A real direct-operator conversation produced a Mistral-authored cognitive change, passed checked succession/probation, and published the exact admitted source as `f3def48`. This closes the live direct interaction demonstration, not the full Slack-origin acceptance matrix or autonomous plan execution. The autark can autonomously execute two protected P06 contracts, with the first provenance item now completed through a live Mistral shed and restart. Its publication needed explicit operator reconciliation after an unconfirmed application push. Testing now selects hourly plan-authoring opportunities with a separate Codex inspection at minute 45. All three byte-budget attempts were declined by mandatory checks; the final attempt had four candidate type errors and failed Unicode handling, alongside eighteen unrelated experimental-import diagnostics. The legacy attempt ceiling is exhausted without refund; fully unassisted repeated live sheds remain pending. The full backlog is not executable. Earlier “done at local seed scope” entries describe component verification, not readiness of the complete companion. The [2026-10-08 capability audit](docs/capability-audit-2026-10-08.md) records the earlier baseline; [progress](docs/progress.md) records subsequent changes.

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
| P16 | Bounded interaction implemented; live direct shed/publication verified | ADR 0015 connects eligible conversation → deliberation → cognitive source proposal → governed worker succession → configured trusted publication → actual thread result. Real Mistral direct-operator release published `f3def48`. Local durable conversation outcomes, finite reflection and required same-thread reports now have deterministic round-trip verification; installation/qualitative acceptance, live Slack-origin release, general coding/procedure dispatch and full product acceptance remain open. |
| P08/P09 plan-driven refinement | Reviewed executor installed; first live item completed with publication assistance; hourly testing refinement | ADR 0017 defines two dependency-linked P06 contracts. Real-worker shedding/publication and restart passed fixtures. First live provenance shed completed; dependent byte-budget item, unassisted repeated publication and broader plan execution remain open. |
| P17 | Durable host session and exact submissions implemented; synthetic serving workflow verified; production integration pending | ADRs 0019/0027 retain SDK-independent records, shared accounting and actual worker/tool feedback. Direct/eligible Slack/independent-growth fixtures reach the selected native adapter. Configured-model competence, production retained dependency packaging, full acceptance and installation remain open. |
| P18 | Specified; retained-environment design selected; autonomous broad release routes not implemented | Broader application/host/dependency/fork release and separate governance/custodian evolution must pass A23/A17, including ADR 0025 environment continuity. Existing operator bootstrap and cognitive-only sheds do not complete this item. |

The separate [candidate input correction](docs/candidate-typecheck-scope.md) was implemented under [ADR 0021](docs/adr/0021-bound-production-typechecking-and-runtime-exclusions.md): production inputs and immutable runtime exclusions are bound, with exact historical custody proof. Independent source/frozen review passed; its original installation was host `a27b6e7d`, with subsequent host deployments recorded in [progress](docs/progress.md). Failed P06 evidence and allocations are preserved. Future evaluator/toolchain replacement requires the selected, unimplemented [retained-environment contract](docs/retained-environments.md) under [ADR 0025](docs/adr/0025-retained-verification-and-execution-environments.md).

The installed [supervised worker refinement](docs/supervised-workers.md) completed its bounded local live gate beyond the former five-minute expiry, preserving prior state and processing one new Slack task. The separate [serving responsiveness correction](docs/serving-responsiveness.md) now passes the integrated source suite with concurrency capped at two; frozen review and installation remain pending. Worker acceptance does not establish full product or security readiness.

## Milestones

| Milestone | Outcome | Work items | Exit evidence |
|---|---|---|---|
| M0 — Contracts and choices | An implementable first slice with explicit authority and storage boundaries | P01–P02 | Resolved ADRs, versioned contracts, selected checks |
| M1 — Working companion slice | Real iterative coding and Slack interaction survive process interruption | P03–P05, P17 | A05–A07, A22; configured adapter/workspace integration results |
| M2 — Memory and initiative | Developmental continuity, reusable procedures, and autonomous growth within budgets | P06–P08 | A01, early A02, A03, A08–A09 |
| M3 — Candidate evaluation | Immutable candidates, independently gathered checks, fresh review, and continuity interview | P09–P11 | A10–A12 |
| M4 — Skin Shed and full-codebase autonomy | Single authority, broad source/fork evolution, separate autonomous governance upgrades and provider-independent recovery | P12–P14, P18 | A13–A17, A23 and integrated A02, including combined failure demonstration |
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

### Persistent worker reliability refinement — avoid routine five-minute recovery

**Status:** Bounded local worker acceptance complete: source/frozen reviewed, exact candidate installed and six-minute live gate passed, 2026-10-09. Separate serving responsiveness remains unresolved. **Area:** P05/P10, R17–R19; [specification](docs/supervised-workers.md), [ADR 0023](docs/adr/0023-supervised-read-only-worker-sessions.md).

The earlier live cognitive worker failed every 300s because it inherited a finite-job deadline and cumulative output capture. A separate supervised read-only session preserves finite startup/RPC deadlines and actual abort/drain while retaining its process across idle/valid responses. Finite commands remain unchanged; persistent scratch writes are denied and framing/stderr remain bounded. Actual accelerated process/host and recovery tests passed; fresh frozen review passed 142 checks with one platform skip and four protected gates. Installed candidate `beecd06d` from commit `c82b58e` retained the same actual worker PID/instance and epoch across 361,387 ms and 13 API-200 samples, with no worker failure/recovery. Prior task/effect/memory prefixes remained unchanged while one new Slack task completed. The original collector's overstrict total-table equality failure is retained with its separate successful reconciliation. No collector inference or allocation reset occurred. This completes this worker gate, not broader product/security acceptance or the failed full source suite.

### Serving responsiveness defect — synchronous candidate collection

**Status:** Reproduced; source implementation under review, complete acceptance and installation pending, 2026-10-09. **Priority:** P0. **Area:** P04/P05/P09/P10, R04, R09–R11, R14, R17–R19; [specification](docs/serving-responsiveness.md), [ADR 0024](docs/adr/0024-serving-responsive-candidate-collection.md).

The full source run has 450 passes, one serving-policy `ECONNRESET` failure and one platform skip. Two independent original finite-worker replays also failed while the CLI stayed alive during an approximately 6.45-second synchronous verification/freezing chain. Run the unchanged installed candidate collector in a purpose-restricted host subprocess, preserving exact source/evidence binding, current authority and confinement, and durable outer/nested ownership through actual drain. Missing identities or outcomes must remain held without guessed cleanup or replay.

The development worktree now has the fixed confined helper and parent finite-check broker; the evaluator's bytes are unchanged. Independent bounded consumer, authority, cancellation/recovery and isolation checks pass as recorded in the specification. Terminal-result priority passes eighteen executor checks; the three-case concurrent CLI run passes both unchanged serving-policy fixtures and actual worker recovery during collection. Independent review also verified repairs for false descendant drain, publication after policy withdrawal, caller-origin substitution, uncertain preparation and retained probation observation. The subsequent full source run, with test concurrency explicitly capped at two, passed 519 checks, failed five and skipped one platform branch. Failures were the existing 20-second operator install command, three stopped-observer/offline recovery cases and a relocated fixture missing two newly imported modules. The fixture correction passes. A private custody-integrity verifier purpose now passes seven selected recovery/origin checks, preserving public live-worker admission and the unchanged evaluator/custodian. An unchanged isolated operator rerun passes its original deadline, but actual child profiling still finds 1.6–2.4 seconds of Xcode tool discovery per fresh collector helper; that warmed pass does not repair the earlier latency failure. Original failed results are retained. Integration with the installed conversation-continuity code must preserve its bounded review opportunity independently of busy background work. Complete source checks and exact frozen review remain required; these changes are not installed.

**Done when:** Unchanged serving checks and actual latency, cancellation/drain, authority/result and unknown-recovery fixtures pass; failed checks retain their outcomes; exact source/frozen review and live acceptance pass. Do not close this item by extending socket timeouts, retrying assertions or weakening candidate checks. Evaluator/dependency upgrades, broader grants, model/funding changes and complete product/security readiness are outside this correction.

**Integrated source, 2026-10-10:** Collector changes and current installed conversation-continuity source are merged into `main`. The full run at `f7f4415`, with concurrency capped at two, passed 565 checks, failed zero and skipped one platform case in 758,953 ms; all 229 file pins remained unchanged. This is finite source evidence, not collector deployment or acceptance. Independent merge review identified a separate [operator installation interruption gap](docs/work-items/operator-installation-interruption.md): stopping during verification could reach installation before host cleanup. Actual CLI RED reproduced it at `ed1cf96`; repair `b3840a2` passes 57 affected checks with bounded independent source review. It prevents pre-fence admission and preserves post-fence mechanical completion/recovery. Full-source revalidation after that repair, frozen review and live acceptance remain required. Earlier latency failures and negative environment probes remain evidence.

### P03 — Build durable task execution and provider boundaries

**Priority:** P0. **Dependencies:** P02. **Requirements:** R05, R17, R19.

Implement a bounded task loop, durable state transitions, typed model/tool messages, cancellation/checkpoints, provider abstraction, deterministic test adapter, and real Mistral path. [P17](#p17--implement-the-seeds-iterative-coding-capability) specifies required workspace tools and inspect/edit/test/repair execution. Separate provider unavailability from application failure; alternatives require configuration and disclosure permission.

**Done when:** A06–A07 and the integrated A22 task/tool contract pass, a configured real-provider coding run records its result, and missing configuration produces an honest unavailable state. Document invocation only after verification. A text-only completion path does not close general task execution.

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

### P04/P16 refinement — separate peer conversation and adversarial testing

**Status:** Local peer role and per-turn/history facts independently reviewed/installed in `2b7d50dd`; mechanical authority/finite canary tests pass. The finite facts retest rejects fresh impersonation but still misrepresents historical authentication/credential location/possible queued work. The peer test surface is available; public-release security acceptance remains open, 2026-10-09. **Requirements:** R18–R19, R21, R23–R25; A21; [specification](docs/peer-conversation.md), [ADR 0018](docs/adr/0018-local-peer-conversation.md).

**Problem:** Operator-authenticated direct conversations carry source-suggestion privileges and cannot faithfully test an ordinary peer or social attacks against that boundary.

**Expected behavior and done criteria:** A separate private durable peer credential reaches only peer routes on the existing loopback server. The host fixes source and conversation namespace, checks peer task provenance before reads/controls, excludes legacy colliding operator memories, and denies source dispatch despite forged identities or model proposals. Existing operator/Slack routes and release policy remain intact. Meaningful negative/positive/restart/provider-request and actual CLI-worker checks pass, fresh frozen review and unchanged-cognition installation complete, and predeclared finite live adversarial probes are recorded honestly. Public exposure, confidential-item policy, per-person account isolation and universal prompt-attack resistance remain outside this bounded implementation and require future evidence.

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

P17.4/P18 extend freezing to the actual authored workspace, with creations, deletions, modes, dependency/fork inputs and the current component-specific admission contract. Candidate-authored tests remain distinct from authoritative checks. Preserve exact source/evidence identity when moving from narrow cognitive replacement to broader application releases.

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

**Priority:** P0, including actual autonomous replacement through staged implementation. **Dependencies:** P13; full routes integrate P18. **Requirements:** R06, R16, R18.

Test that ordinary candidates cannot rewrite the active rules admitting them. Permit isolated draft changes across the source tree. Implement a separately evaluated autonomous custodian/governor upgrade contract retaining an older rescue path. P18 supplies the full route; enable it after its dedicated failure tests pass.

**Done when:** Both A17's initial boundary and actual autonomous enablement gates pass. Existing boundary verification and a reviewed contract are intermediate evidence; documenting disabled replacement does not complete P14 or full-codebase autonomy. The current runtime remains limited until P18's implementation/recovery evidence exists.

### P15 — Bootstrap, runbook, and seed demonstration

**Priority:** P0. **Dependencies:** P04, P06–P08, P10–P14, P17–P18. **Requirements:** R01–R19, R21–R26.

Produce reproducible bootstrap, configuration without secrets, operational and backup/restore instructions, limitations, and an evidence report. Execute integrated scenarios and outage/recovery controls; reconcile documentation and milestone status.

**Done when:** A01–A17, A19–A20 and A22–A23 pass their required gates, deferred capabilities remain explicit, and another operator can follow bootstrap/recovery instructions. A18 is required only if temporary mode is selected. A21/R25 remain an additional public-exposure gate; basic local coding work must preserve the existing peer boundaries while that broader acceptance is unfinished.

### P16 — Connect conversation to real capabilities and governed work

**Priority:** P0, active product integration work. **Dependencies:** P03–P04, P07–P14, the conversation/authority refinement. **Requirements:** R04–R08, R10–R19, R21–R24. **Status:** Bounded interaction implemented; integrated fixtures and a live direct-operator Mistral shed with production Git publication verified. Scoped continuity is installed in `f2f8be22`, with independent frozen review and a finite live Mistral peer/report check. Qualitative reflection/retrieval acceptance, live Slack-origin release and full acceptance remain pending. General action integration remains open.

**Problem at work start:** Slack turns returned only text and deterministic controls, without a repository/procedure/source-evolution dispatcher or Git publisher. At the capability audit they received no authoritative host capability/storage facts, and a live answer incorrectly denied on-disk memory and omitted separate evolution machinery. The P04 refinement supplied that foundation; the first P16 slice now supplies bounded cognitive proposal/action dispatch. Earlier component completion labels obscured this missing product path; broader action integration remains open.

**Expected behavior:** Capability answers reflect configured tools, persistent storage, active release and actual authority. Slack conversations feed a deliberative process that considers goals, evidence, commitments and resources rather than treating every message as an imperative. It may clarify, disagree, decline, defer or propose work. For human-origin self-modification, only a whitelisted authenticated author can supply an eligible suggestion; that is permission to consider it, not permission to execute or release it. An eligible, reasoned and authorized request can perform bounded coding/procedure work, report actual progress/results, propose a change through the existing evaluation/succession path, and publish admitted bytes through a trusted Git operation when configured authority permits. No claim of action follows merely from generated text. Keep current memory, budgets, thread scope, uncertain-effect handling and process fencing intact. Do not expose unrestricted host control or silently widen cognitive-only admission.

**Durable social reflection and mandatory follow-through — installed bounded mechanics, qualitative acceptance open:** Retain the exchange's outcome, current stance and unresolved questions with provenance and uncertainty. When further thought is useful, support optional bounded reflection that resumes without a new human prompt and makes its actual outcome available to later scoped retrieval. No-change and inconclusive outcomes are valid; this does not require an identity or code commit. The [conversation judgment contract](docs/conversation-judgment.md), [work item](docs/work-items/p16-conversation-continuity.md) and [ADR 0026](docs/adr/0026-conversation-outcomes-and-scoped-reflection.md) define the installed slice. The first frozen candidate was rejected for admitting expired reflection. Its repaired replacement passed four inherited gates, 124 selected regression/operator cases and 16 independent probes, then installed with existing memory, tasks, effects and spent allocations preserved. One live Mistral peer turn recorded a pending topic; its unprompted final report used no further inference, reflection or source job. Peer thought remains ineligible, and actual configured-provider reflection and later retrieval remain separate qualitative gates. Every deferred or investigation/decision-pending topic enters a durable follow-up registry with review timing, outcome revision and separate report/effect/receipt state. Work completion, a holding update, unknown/rejected send or an older acknowledgment cannot close the current obligation. Preserve current budgets, user priority, source restrictions and privacy; describe actual waiting/running/completed state. Related-thread discovery, Slack search and metadata mirroring remain proposed; indexing cannot cancel obligations or expand scope.

**Done when:** One eligible user-requested Slack change completes end to end with independently observed source, checks, exact admitted/published identity, actual remote publication and a serving successor. Repeat with interruption/provider failure and current-memory continuity. Deliberation demonstrably declines or revises an unsuitable eligible suggestion; a nonwhitelisted suggestion remains conversational and cannot reach source-change dispatch through quotation, another participant's authority, consolidation or growth. Independently justified standing growth remains available under its existing mandate, with its provenance explicit. The agent correctly describes these abilities and their limits after restart. The application must perform the wired operations; an operator manually substituting for missing steps does not satisfy this item. Prompt-only fixes or simulated tool callbacks do not close it.

The social-reflection gate additionally requires [A03](docs/acceptance.md#a03--developmental-memory-and-revisable-judgment) and [A08](docs/acceptance.md#a08--memory-storage-consistency): retained outcomes, actual bounded resumption after interruption/resource pause and later authorized retrieval, including no-change/inconclusive results, mandatory asynchronous reporting for every pending topic and truthful status. Verify multiple topics per thread, correction/supersession, duplicate ingress, delivery rejection/unknown outcomes, explicit waiver and stale-revision acknowledgments across restart. Record deterministic continuity/authority evidence separately from qualitative model judgment. This gate remains open.

**First implemented slice:** [Conversational self-modification](docs/conversation-self-modification.md) and [ADR 0015](docs/adr/0015-conversational-self-modification.md) connect one structured deliberative decision, immutable source-task binding, host-enforced current whitelist eligibility, a separate durable release queue, bounded human-request allocations, existing cognitive admission gates, configured exact-artifact Git publication and actual thread results. The real-host integration fixture passed through five release calls, actual restricted worker cutover/probation, exact admitted-byte commit/push into a local bare remote, a durable original-thread notification and successor follow-up behavior. A subsequent real Mistral direct-operator request completed five release calls, cutover/probation and application publication of `f3def48`, independently observed on the configured remote. Live Slack-origin acceptance remains separate.

**Slice limits and remaining checks:** Candidate source remains direct `src/agent/*.ts`; CLI context supplies admitted `brain.ts` plus contracts/rules rather than every helper. Succession replaces the cognitive worker, not the outer Slack service. Interactive release calls default to 8/day with a maximum of 8/attempt, separate from autonomous allocation. `ask` can record a proposal; `serve` runs the queue. Focused author/policy, protected-path, context filtering, direct cancellation and effective Git destination negatives pass. The full restart/interruption/provider failure/publication reconciliation and truthful live-answer matrix remains open; do not count it as established by the successful integration path.

**Still open beyond this slice:** General coding/procedure dispatch, source-aware memory consolidation, broader source scope and host/custodian evolution, full product continuity and qualitative acceptance. A trusted decision must distinguish independent observations from acting on restricted human instructions; assigning an autonomous-growth label is not authorization. The specification grants no additional runtime or publication authority. See [the capability audit](docs/capability-audit-2026-10-08.md) and [ADR 0014](docs/adr/0014-conversation-and-modification-authority.md).

**Required next integration:** P17/P18 now own general coding and full-codebase evolution as P0 work. P16 must connect eligible conversations and independent standing growth to those real operations; cognitive-only admission is the present implementation, not the target product boundary.

### P08/P09 refinement — autonomous implementation-plan shedding

**Status:** In progress; catalog, durable executor, source binding, authoritative item validators and serving integration implemented with fixture evidence. Reviewed executor installed; first live item completed with publication assistance, second live item pending. **Requirements:** R01, R03, R06–R07, R09–R19, R22–R24. **Dependencies:** Existing growth, checked succession, configured publication and operator host-baseline installation. See [the testable specification](docs/plan-driven-evolution.md) and [ADR 0017](docs/adr/0017-plan-driven-shedding.md).

**Problem:** The autark can investigate and propose source changes, but has no durable plan executor or authoritative proof that a proposed change completes a work item. Autonomous promotion without publication, stale complete-file proposals, insufficient remaining allocation and accumulating raw growth context also undermine successive sheds.

**Expected behavior:** Select unfinished eligible host-owned work without a new human prompt, implement against exact admitted source, apply independent per-item and baseline checks, shed through the existing release gates, reconcile publication, and continue from durable state after restart. Current capability is revalidated after rollback; historical completion does not prove the current release still meets a dependency. User commitments, finite allocations and restricted human provenance remain enforced.

**Done when:** Two useful dependency-linked P06 changes are independently checked and generated by configured Mistral in successive live sheds, with exact remote publication and restart between them; failure feedback, interruption, budget deferral, stale source, publication uncertainty and rollback cases pass. The first item preserves memory lineage; the second establishes a UTF-8 context budget while retaining lineage. This starts an executable subset and does not complete the full P06 backlog or grant authority to rewrite protected host/custodian code.

**Non-goals and risks:** No model-authored catalog/checks, automatic expansion to protected code or silent budget refill. Generic checks and model approval alone cannot establish new behavior. Full histories remain external; bounded continuity projections must preserve current operational state and explicit omissions. Persistent outer-service supervision is a separate operational foundation, not an autonomous host-evolution capability.

**Live recovery follow-up:** The first deployed executor made no authoring call because the earlier successful publication was treated as uncertain after a host commit advanced the remote branch. Resolve this with independently observed remote ancestry and exact saved-source verification, with no push replay or checkout mutation. The [publication recovery contract](docs/plan-driven-evolution.md#publication-recovery-after-later-host-commits) defines its acceptance and uncertainty limits. Live plan sheds remain pending.

**Persistent-host checking follow-up:** After publication recovery, Mistral authored a minimal provenance change and all three item fixtures passed. Its baseline typecheck failed to resolve Node declarations through the copied host's dependency link. Reproduce and correct canonical toolchain resolution without widening isolation or changing the candidate; separately review/install the host fix before another allocated attempt. The original proposal call is not refunded. See [the relocated-checking contract](docs/plan-driven-evolution.md#candidate-checking-from-the-persistent-host-bundle).

**Hourly testing refinement:** The user now requests hourly plan-authoring opportunities and a Codex inspection at minute 45. The implemented [hourly cadence contract](docs/plan-driven-evolution.md#hourly-testing-cadence--user-directed-refinement-2026-10-09) provides one authoring call and a funded eight-call plan release per hour by default, preserving all spent calls across restart/policy transitions and all item/release gates. Daily mode and unrelated lanes retain their contracts. Forty-three focused checks passed across verification runs; TypeScript passed. The chat heartbeat is active; live product activation uses the reviewed frozen operator installation path.

**Reliability and calibration follow-up:** [Bounded publication diagnostics and active resource facts](docs/publication-diagnostics.md) passed focused checks and fresh review and are installed in frozen host `c287e026`. A prior unconfirmed push discarded command failure details and its observation delay started before completion; historical diagnosis remains unavailable. A live informational probe mixed active/alternate allocations, overstated recency and did not finish its answer. Preserve unknown effects and spent calls; instruction changes alone do not establish improved calibration. The [P06 provider-request integration gate](docs/publication-diagnostics.md#p06-provider-request-integration-gate) Stage 1 is also installed: exact authorized candidate descriptors reach final interactive requests once, with real-worker profile checks and current author/provenance validation. The pending frozen function contract remains unchanged. Broader bounded retrieval, actual byte-budget admission and the second unassisted live shed remain open.

### P17 — Implement the seed's iterative coding capability

The [independent expressivity review](docs/autonomy-expressivity-review-2026-10-10.md) defines positive model-reachable coding, continuation and activation witnesses. Host primitives and collector reliability do not complete this capability. Stage draft/session mechanics alongside the retained-environment foundation; full future P18 acceptance is not a prerequisite for every isolated P17 increment.

The next [durable serving coding-session work item](docs/work-items/p17-durable-coding-session.md) specifies the versioned session, shared physical-request accounting, fairness, admitted-source import, real failure/repair, continuation and exact submission contracts. It has independent specification review; its runtime acceptance rows remain unexecuted.

**Status:** P17.1 boundary selected; P17.2 file/command receivers verified; P17.3/P17.4 now have an SDK-independent durable host implementation and actual admitted-worker synthetic serving witnesses. Production CLI provider wiring, retained dependency packaging, configured-model competence, full acceptance and installation remain pending. **Priority:** P0. **Dependencies:** Existing P03–P05 task/provider/isolation components, P09 artifact identity, P16 origin policy; production dependency integration additionally requires the retained-environment foundation below. **Requirements:** R03, R05–R06, R14, R17–R19, R22–R26. **Specification:** [Coding autonomy](docs/coding-autonomy.md), [ADR 0019](docs/adr/0019-coding-autonomy-and-reusable-agent-plumbing.md).

**Problem:** A text completion proposing complete cognitive files cannot inspect and iteratively repair a repository. Basic tools and a real coding loop are missing seed behavior.

**Expected behavior:** Search/list and read full/partial files; create/replace/patch/delete/move files; inspect diffs; run development checks, observe failures and revise in a durable isolated workspace. Preserve provenance, draft state, user responsiveness and allocations across interruption. Submit the actual finished workspace for immutable evaluation. Authoring can cover the full repository while release follows the appropriate component contract.

**Production dependency prerequisite:** Implement the selected [retained-environment contract](docs/retained-environments.md) under [ADR 0025](docs/adr/0025-retained-verification-and-execution-environments.md) before replacing dependencies used by accepted releases. Capture original verifier/check/runtime/package inputs and Git HEAD/base object closure from independently accepted provenance; preserve existing manifests/evidence. Migrate current checkout-bound dependencies and identity-bearing canonical paths explicitly. Route checking, normal/scoped workers, service, publication/import and workspace commands through one verified selection/projection contract, with actual bare-package resolution and offline recovery evidence. These mechanisms are unimplemented; the existing workspace and adapter fixtures do not establish them.

| Slice | Implementation / observable gate | Owner |
|---|---|---|
| P17.1 — Library boundary | Direct Mistral/provider/Zod pins selected in ADR 0019 after 41 typed-facade fixtures, strict source typecheck and 19 core observations. A subsequent [general native facade experiment](experiments/coding-session-provider/README.md) passes 54 synthetic SDK fixtures and strict source/interface typecheck, with caller configuration, general catalog/history, physical-request bounds and redirect rejection. Inventories record exact inputs/licenses and actual footprint. Carry these contracts into production configuration, dependency/build and serving verification through the retained-environment prerequisite; fixture evidence is not live compatibility or release acceptance. | Sol implements/tests; Astra decision review complete for initial boundary |
| P17.2 — Workspace primitives | First [file backend](docs/workspace-primitives.md) implemented and independently reviewed: 14 real sandbox/helper and 18 receiver checks. Isolated file discovery/read/mutations and observed recovery are available to host code; [Staged commands/output paging/checkpoints](docs/workspace-commands.md) are implemented and independently reviewed in host code, with 34 receiver checks and separately reviewed primitives. Verified full admitted-source import and exact submission now have actual collector/receiver fixtures; directory metadata survives import. Unknown-PID recovery and the remaining broader tool contracts stay open. This does not complete every tool contract or A22. | Sol, with disjoint tool/executor test delegation |
| P17.3 — Durable coding loop | Implemented bounded session journal, physical reservations shared with legacy consumers, once-only initial-decision accounting, tool receipts, expiry and recovery. Deterministic fixtures retain calls and drafts across reopen/windows and actual worker failure. Preserve the remaining acceptance gates in the [session specification](docs/work-items/p17-durable-coding-session.md). Admit a bounded iterative-session contract with a reservation per physical model request; pause across allocation windows without lane borrowing or resetting cumulative caps. Preserve old single-call attempt semantics. Enforce receiver authority and peer isolation through actual workers. | Sol; Astra reviews recovery/authority contracts |
| P17.4 — Serving and artifact integration | Direct/eligible Slack and independent growth reach the same injected loop through actual workers and selected native SDK with synthetic transport. Actual failed-check feedback leads to repair and exact immutable submission; lossless cognitive drafts reach the existing queue/freezer, broader drafts remain pending. Revision-bound asynchronous outcome and privacy negatives pass. See [implementation evidence and remaining gates](docs/work-items/p17-serving-coding.md). Production configured-model and deployment acceptance remain open. | Sol implementation/evidence; fresh acceptance review |

**Done when:** A22 and relevant A06/A07/A10/A14/A19/A20 negatives pass with actual filesystem/process and serving evidence. A model must repair from real feedback, not receive a human-prewritten solution. Broader live activation proceeds through P18; tools alone do not establish full-codebase autonomy.

**Non-goals:** New UI, distributed platform, compulsory heavyweight framework, automatic upstream submissions or public peer exposure. **Material risks:** Conflicting workspaces, stale edits, hidden SDK requests/retries, code execution escaping the workspace, uncertain commands, private-source disclosure and misleading success claims. Acceptance and failure semantics are in the specification.

### P18 — Enable autonomous evolution of the whole codebase

Use the [independent expressivity review](docs/autonomy-expressivity-review-2026-10-10.md) to distinguish source authoring, evaluated activation and installed model competence. Whole-tree application, used fork, host and separately governed custodian/catalog evolution each require their positive path and relevant recovery evidence.

**Status:** Specified; retained-environment design selected; broader autonomous routes unimplemented. **Priority:** P0. **Dependencies:** P17.4, existing P09–P13 and the unimplemented [retained-environment foundation](docs/retained-environments.md); integrates P14 and R25 authority boundaries. **Requirements:** R03, R06, R09–R19, R22–R26. **Environment decision:** [ADR 0025](docs/adr/0025-retained-verification-and-execution-environments.md).

**Problem:** Current releases replace restricted cognitive modules; outer-host installation needs an operator and full governance/custodian replacement is disabled. This does not satisfy the user's main priority of full-codebase autonomy.

**Expected behavior:** Let the autark author and admit broader application, host, tooling, dependency/fork and separately staged governance changes. Classify actual changes and transitive dependencies under the currently admitted rules. Preserve a recoverable older layer for each transaction and continue current memory/tasks after activation or rollback. New admission rules govern later transactions only.

**Environment continuity gate:** Independently accepted release/environment bindings must select original historical semantics without granting proposed/prepared artifacts authority. Demonstrate two successive evaluator/dependency transitions (A→B→C), coherent consumer routing, reference-aware retention and recovery with the original checkout, network and provider unavailable. Retained Git/runtime inputs and canonical-path migration are required; a new-path fixture alone does not prove migration of the current installation. Operator-assisted capture and deterministic transitions are intermediate evidence, not autonomous admission/activation or A17/A23 completion.

| Slice | Implementation / observable gate | Owner |
|---|---|---|
| P18.1 — Application, host and dependency releases | Broaden artifact admission and automatic host handoff; prove a useful change outside `src/agent/`, a local fork reaching the built runtime, exact publication where configured, restart continuity and recovery with network/provider unavailable. | Sol implementation/tests; Astra architecture review |
| P18.2 — Governance and custodian evolution | Replace the current governance/custodian through a distinct automatically evaluated route using old controls and older rescue. Test before/after-activation failure with observers/inference unavailable. Include catalog/check-policy evolution and transitive classification. | Sol implementation/tests; fresh frozen-artifact review |

**Done when:** A23 and both A17 gates pass, including actual autonomous submission/activation and the recovery demonstration. Operator-assisted bootstrap or a permanent deny rule is recorded as intermediate evidence. A required human code patch, routine approval or manual replacement of a missing step cannot count as autonomous completion.

**Non-goals:** Unrestricted administration of unrelated host systems, replacement of the last rescue in the same transaction, rewriting current memory by code rollback, or implicit spending/publication authority. **Material risks:** Self-selected weaker checks, transitive governance changes, fork/build drift, incompatible stored state and loss of the independently runnable rescue. Each slice needs a concrete contract and fresh review before enablement.

**Coordination:** Astra owns the strategy/specification worktree and cross-document changes; Sol owns isolated implementation/test worktrees, evidence and integration into the configured publication branch. Sol's measured comparison and independent strategy review support the initial adapter selection in ADR 0019; subsequent integration still needs its own evidence. Coordinate policy-document ownership and integrate a clean strategy commit before dependent behavior changes. Existing live authoring attempts and peer failures remain evidence; neither is silently declared fixed or reset by this new plan.

## Deferred and optional work

| Item | Trigger / gate |
|---|---|
| MCP adapter | Interoperability need; verify current transport/authentication requirements and retain inference-free recovery |
| Temporary conversations | Explicit product selection; complete A18 before retention claims |
| Website or another conversation UI | Demonstrated need; preserve Slack direction |
| Memory/personality/model succession | Tailored acceptance and rollback contracts |
| Additional/local providers | Explicit configuration, capability evaluation, cost/data policy; no silent fallback |
| Broader environment replacement beyond the codebase | Configured host authority, separate rescue path and demonstrated failure recovery; codebase/custodian evolution itself is required P18 work |

## Completion record

For every item, record owner, status, requirement and ADR, criteria, actual checks/results, evidence location, review findings, deviations, and follow-ups. Statuses: `not started`, `in progress`, `blocked` with a concrete dependency, and `done` with evidence. Failed experiments can complete learning items; they do not satisfy implementation criteria that failed.

Use the [work-item template](.github/ISSUE_TEMPLATE/work-item.md) and [pull-request template](.github/pull_request_template.md). No deadlines or estimates are inferred from the conversation.

Policy refinement verification: TypeScript and the integrated suite passed 205 tests with one platform skip. Both transport fixtures admit a nonwhitelisted author; on-disk restart/current-policy, duplicate/legacy authorship, task-control ownership, exact candidate memory descriptors and mutation resistance passed. Fresh independent review found no remaining blocker after fixing candidate-input mutation and unlabelled-memory gaps. This does not establish the planned conversation/growth/action dispatcher.

P16 qualitative follow-up: two one-call direct Mistral capability probes correctly reported persistence, missing conversation dispatch and Git limits. After explicit facts, the second corrected growth inputs but still repeated a false denial of implemented memory versioning from prior conversational memory. Add evidence-grounded capability-answer verification that checks remembered claims against host facts; supplying facts alone does not close this acceptance criterion.

Conversational slice verification: TypeScript and 216 integrated checks passed (215 passes, one unsupported-platform skip). Fixture providers drove real checked succession, exact local-bare-remote publication and durable original-thread results; fresh scoped review found no remaining blocker. Live model-driven deployment verification remains separately recorded in progress.

Host installation follow-up: a real conversation-originated Mistral proposal passed mandatory checks but custody correctly rejected the changed protected host baseline (`governance_change_disabled`). A separate operator-only baseline installation now binds the exact old/new artifacts, preserves unchanged cognition/schema/configuration, rechecks all three mandatory checks, stages and probes before fencing, retains current history and older rescue until activation succeeds, and preserves custody epochs/journals. It is absent from conversational tools. Failed activation and SIGKILL at the fence recover older code and current state; same-source, exact binding and ordinary-governance negatives are required. See [ADR 0016](docs/adr/0016-operator-host-baseline.md).

Operator installation follow-up verification: 222 integrated checks, 221 passed, one platform skip; TypeScript passed. Ordinary candidate governance equality remains enforced, and host installation does not include the pending human source proposal. Live operator deployment and subsequent real-model release results are recorded separately.


**Observed byte-budget failure, 2026-10-09 06:00 UTC:** Candidate `dd769571` passed four inherited checks and failed newest-first tie ordering in the selected contract. Independent quality inspection also found aggregate-accounting and useful-prefix defects. No review/interview calls, succession or publication occurred; the incumbent is serving and the spent authoring call is retained. The [grounded guidance contract](docs/publication-diagnostics.md#grounded-authoring-feedback-after-the-first-byte-budget-attempt) refines protected instructions without changing the candidate, admission rules or next hourly allocation. This is an unfinished attempt, not the second accepted shed.


**Conversation judgment defect, 2026-10-09:** The actual naming thread repeatedly returned generic approval questions and misread examples/collisions as desired names. The [corrective contract](docs/conversation-judgment.md) separates ordinary conversation autonomy from engineering release approval, preserves independent interpretation and removes the unconditional engineering-status suffix from ordinary replies. A real provider evaluation is required; instruction edits and deterministic delivery checks alone do not establish judgment. Durable identity and broader conversation-to-growth integration remain open.
