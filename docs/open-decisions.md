# Open decisions and risks

Status: planning baseline, 2026-10-08. These are decisions to resolve with evidence, not a request to reconfirm the user's established direction. The development lead may resolve routine implementation choices within the authorized scope and record them in an [ADR](adr/README.md). Only genuine missing product preferences or authority/resource constraints require user input.

## Decision register

The implementation lead owns the register. D01 and D03 have an initial local disposition; D02/D04/D05/D09/D11 have partial dispositions below. Other details remain open until their gates pass. A proposed ADR is not proof its mechanics were implemented.

### Implementation dispositions, 2026-10-08

- **D01:** TypeScript, Node 24, npm lockfile, native test runner and built-in SQLite selected; runtime and type checks exercised. See ADR 0008.
- **D02:** Local macOS arm64 development verified. Actual Seatbelt restrictions tested, Docker daemon unavailable. Production host, hard resource quotas and outer rescue deployment remain open. See ADR 0009.
- **D03:** One external SQLite store with separate task/event/effect/memory/growth tables; separate exclusive coordinator lock. Unknown effects require reconciliation. Durable reopen and transition tests pass.
- **D04:** SQLite chosen for the seed; scoped literal retrieval, provenance, correction, logical forgetting, bounded consolidation and dependent-summary invalidation tested. A 1,000-episode local benchmark and live probe are recorded in [memory runtime](memory-runtime.md). Live publication mechanics passed, but qualitative review found unsupported single-episode generalization. Evidence calibration remains open; Memvid is not adopted.
- **D05:** Mistral and explicit Codex adapters implemented with finite calls/time/output; live model configuration and smoke tracked in progress. Procedures use restricted Node code with schemas and content identities.
- **D09:** Four persistent growth dimensions, debit-before-call allocation, user-work priority and interruption recovery implemented. Continuous idle windows and finite replenishment have deterministic integration coverage. Serving adoption is being connected to the governed evolution coordinator.
- **D11:** Shared direct/HTTP/Slack contracts implemented, with idempotent task ingress, thread scoping and status/cancel/correction commands. Signed HTTP and Socket Mode services have integration tests; live Slack connectivity still awaits private credentials.
- **D06–D08:** Local custodian API, opaque actor handles, actual child identity, durable launch/stop intents, exact candidate/evidence/snapshot bindings and bounded interview/probation contracts implemented. Tests include malformed evidence, actual worker failure and late authority rejection. Live cognitive review/interview remains an execution gate, not an unresolved transport choice.
- **D09 update:** Fixed daily windows (default four calls), autonomous timer initiation, persistent fairness and atomic concurrent allocation now have tests. CLI serving integration is being verified. Models cannot increase the allocation.
- **D10:** Seed data schema fixed at version 1; ordinary candidates cannot migrate data or replace custodian/admission code. Real rollback preserves the current external store. Full custodian replacement remains disabled pending a separate rescue demonstration.
- **D11 update:** Signed HTTP ingress and scoped status/cancel/correction commands have integration coverage. Socket Mode was selected when the user asked to supply connectivity; the app manifest and private token fields are prepared. Live installation remains unverified until supplied and connected.
- **R21/R22 steering:** Direct communications testing and external lived state are explicit user requirements, now included in specs, acceptance and plan. Private Mistral credentials are supplied outside the repository.
- **Live evaluation update:** A Mistral-authored behavior change passed independent checks, fresh review, the succession protocol and local probation, then was pushed unchanged. Two earlier candidates were correctly rejected. The live question was largely an assessment, so stage-specific questioning and grounded disagreement remain a P11 quality gate. See the [release evidence](self-improvement-2026-10-08.md).

| ID | Decision | Evidence / resolution criterion | Gate |
|---|---|---|---|
| D01 | Seed language, runtime, packaging, repository layout | Compare the earlier TypeScript proposal with alternatives using understandability, provider/Slack integration, memory compatibility, reliable builds, and recovery. The colleague's Rust stack is not binding. | P01 |
| D02 | Deployment host and authority boundary | Confirm actual machine, OS, resources, dedicated environment, allowed administration, and independent rescue location. Neither a NUC recap nor the brief's i7/M4 hardware is verified target inventory. Demonstrate candidates cannot change host recovery control. | P01, P05 |
| D03 | Operational journal and event identity | Evaluate the proposed local SQLite store, transactional authority/task records, stable operation IDs, queue acknowledgment, checkpoints, and crash reconciliation. Avoid adding distributed consensus to the single-host seed without need. | P01–P03 |
| D04 | Memory backend and developmental policy | Benchmark Memvid or alternatives against selected language, commit/reopen/search, scope, correction, logical forgetting, export, and current-history rollback. Decide consolidation and retention separately from the storage engine. | P01, P06 |
| D05 | Providers, models, credentials, and scripts | Keep Mistral default and explicit alternatives. Verify actual capabilities, tool schemas, model profiles, disclosure permissions, and budgets; select a procedure runtime/dependency policy. Do not hard-code historical model recommendations. | P01, P03, P07 |
| D06 | Succession schemas, transport, and caller identity | Freeze a versioned core API, exact transitions, idempotency, roles, cancellation, deadlines, and the way B challenges A. Determine authenticated local transport; add MCP only when useful. | P02, P11 |
| D07 | Effect fencing and crash-safe cutover | Specify checkpoint/catch-up boundary, process-bound capabilities, new epochs, external-effect reconciliation, and behavior after every crash point. Include forgetting and access-scope changes in candidate catch-up. | P02, P12 |
| D08 | Evaluation, review, and probation | Define trusted test ownership, candidate/evidence identity, held-out behavior, reviewer calibration, continuity/growth rubric, measurable thresholds, budgets, probation length, and recovery triggers before evaluating a candidate. | P02, P09–P13 |
| D09 | Growth scheduling and resource arbitration | Set finite experiment/interview/revision budgets, learning windows, user-work priority, fairness, interruption/resumption, and qualitative evidence. Preserve strong initiative without unbounded consumption. | P02, P08 |
| D10 | Compatibility and rescue contract | Choose rollback-compatible data/schema changes; current memory must remain usable by restored code. Specify separately evaluated governance/custodian upgrades with older rescue, bounded failed-recovery handling, and operator recovery procedure. | P02, P13–P14 |
| D11 | Slack task/conversation semantics | Define context ownership, progress, cancel/correct semantics, duplicate/reordered messages, reconnect behavior, and response targets. An optional website's FIFO/SSE rules are not automatically Slack requirements. | P04 |
| D12 | Optional features and integrations | Decide temporary mode, website, MCP exposure, local inference, Codex review, embedding providers, and search adapter only when their value and full contract are understood. | Separate scoped work |
| D13 | Historical source completeness | Reconcile missing earlier conversation turns and generated ZIP/addendum if they become available. Do not pretend the recovered six turns establish exact earlier decisions or file contents. | Future source update; does not block this distillation |

## Risk register

| ID | Risk and consequence | Required treatment / evidence | Tracking |
|---|---|---|---|
| K01 | Two generations retain authority and duplicate external effects | Fail closed at receiving tool/storage/message boundaries; test delayed old requests and actor identity. A safe transition may temporarily have no active owner. | R14, A13–A14 |
| K02 | A confident reviewer approves bad behavior or candidate instructions influence it | Trusted checks, exact evidence identity, bounded fresh review, known-bad calibration cases, and strict unavailable/inconclusive handling. Separate sessions do not prove independent errors. | R10–R11, A10–A11 |
| K03 | Executable rollback discards history or cannot read newer data | Preserve current stores, prove schema compatibility, reconcile effects and memory publication, and reject unsafe migrations before release. | R07, R15, A08/A15/A16 |
| K04 | A stale snapshot reintroduces cancelled work, forgotten data, or revoked access | Catch up authoritative events and invalidate/rebuild affected snapshots and derived contexts before promotion or resumed recovery. | R12/R14, A13/A16 |
| K05 | The agent can alter its own admission or destroy rescue | Enforce host/process boundaries and separate upgrade transactions; preserve an older rescue mechanism. Unlimited host root and unbypassable same-host recovery are incompatible goals. | R16/R18, A11/A17 |
| K06 | Growth becomes code churn, shallow self-praise, escalating cost, or task starvation | Evaluate all four dimensions, allow negative lessons, retain independent evidence, and enforce finite budgets and priority. | R01/R17, A01–A02 |
| K07 | Continuity becomes compulsory imitation or an incumbent's indefinite veto | Declare intended changes, test grounded disagreement, require evidence-backed rejection, cap disputes, and keep useful incumbent work running. | R02/R12, A12 |
| K08 | Provider outage causes endless release rollback or stops deterministic recovery | Distinguish dependency availability from release health; use non-LLM probes, bounded retries, quarantine failed releases, and explicit recovery-required state. | R09/R17, A07/A15 |
| K09 | Local non-retention is mistaken for end-to-end disappearance | Treat temporary mode as optional; if selected, test every storage/learning path and separately explain Slack/provider retention. | R20, A18 |
| K10 | A complicated supervisor freezes the very intelligence meant to evolve | Keep mechanical enforcement small; let cognitive policy evolve through evaluated procedures while maintaining recovery. | R06/R09/R16, P05/P14 |
| K11 | Historical suggestions or current-looking references become unjustified implementation facts | Preserve provenance labels; verify primary documentation and pinned integrations when choosing them; do not infer missing artifacts. | Source analysis, P01–P02 |

This register does not authorize deployment, new credentials, wider permissions, or spending. It records the technical decisions required to implement the existing project direction.
