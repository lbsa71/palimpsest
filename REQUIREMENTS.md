# Requirements

Status: requirements baseline, **2026-10-08**, refined for explicit full-codebase autonomy and seed coding on **2026-10-09**, with implementation progress tracked in [PLAN.md](PLAN.md). A requirement's presence does not establish implementation or test completion.

## Intent and provenance

Palimpsest is a self-evolving coding companion with continuing memory, developing personality and interests, and a strong internal drive to improve. The seed must be small enough to understand and capable of advancing toward the wider ambition without making recovery depend on a functioning model.

Source classes used below:

- **Explicit**: directly expressed by the user in retrieved turns.
- **Carried direction**: earlier preferences recapped by the assistant before the user accepted taking the best of both designs; original earlier messages were not returned.
- **Design proposal**: a concrete mechanism proposed in the discussion or a testable operationalization in this repository. Preserve it for implementation review; do not claim the user selected every detail.

The [source analysis](docs/research/source-analysis.md) identifies the underlying turns, attachment, conflicts, and retrieval gaps. Requirements describe the desired system; proposed mechanisms require their listed decision gates. [Acceptance scenarios](docs/acceptance.md) make the target reviewable.

## Product and development requirements

| ID | Requirement | Provenance | Acceptance |
|---|---|---|---|
| R01 | Maintain a strong, persistent drive to improve personality, interests, code quality, and potential. Initiate useful growth without waiting for a new instruction. | Explicit; standing agenda is a design proposal | A01, A02 |
| R02 | Develop nuanced judgment, intellectual independence, curiosity, and distinctive interests. Retain ordinary experiences and allow changed beliefs; avoid optimizing personality solely for agreeableness or immediate utility. Make reasoned progress on ordinary conversational choices without repetitive generic plan-approval demands; distinguish examples, factual reports, corrections and preferences from instructions. | Explicit growth dimensions and observed conversation-autonomy refinement, 2026-10-09; carried developmental direction | A01, A03, A12 |
| R03 | Use specification-driven development, pragmatic TDD, the Boy Scout Rule, suitable model-aware subagent fan-out, well-documented code, and current documentation. Inspect the quality of self-authored changes as well as their results; adjust authoring/review instructions and evidence-grounded hints when deficiencies appear. Mandate these in AGENTS.md. | Explicit; self-authored quality-inspection refinement, 2026-10-09 | A04 |
| R04 | Use Slack as the primary interaction surface and keep communication available while work runs. Converse with all human users in configured workspaces/channels: a mention starts or invites a thread, and joined-thread follow-ups require no repeated mention. Conversation admission is independent of the self-modification whitelist. Preserve task ownership, corrections, cancellations, and commitments across interruption. | Carried direction; explicit joined-thread and broad human conversation refinements, 2026-10-08; configured scope is the retained operational boundary | A05, A06, A13; P04 authority checks |
| R05 | Default to Mistral API inference with configurable provider/model choices and explicit alternatives. Independent review must not impose Codex or a different provider as a prerequisite. | Carried direction and accepted synthesis | A07, A10 |
| R06 | Bootstrap from a small understandable seed with full autonomy over its own codebase: author, test and evolve cognition, planning, tools, memory, provider adapters, host/service, dependencies and governance/custodian code through the appropriate release contracts. It may maintain a local library fork without requiring upstream acceptance. Keep a recoverable outer layer during each particular upgrade; no source component is permanently human-only. Broader environment evolution remains bounded by configured authority. | Carried direction and accepted synthesis; explicit full-codebase autonomy and possible library-fork refinement, 2026-10-09 | A09, A17, A22, A23 |
| R07 | Separate operational task/release state from developmental memory. Support experience recording, consolidation, retrieval, correction, supersession, and forgetting with provenance and uncertainty. | Carried direction; process details proposed | A03, A08 |
| R08 | Treat tested reusable procedures as procedural memory. Prefer a reliable existing operation when appropriate; do not force all conversation or exploration into scripts. | Accepted synthesis | A09 |

## Succession and release target

The user explicitly requested overlapping generations with an incumbent interviewing the successor before transfer and retirement, then raised a dedicated custodian-mediated tool. The following requirements capture that direction and the associated engineering contract. Provenance distinguishes the original proposals; subsequent local implementation decisions are recorded in ADRs 0008–0012 and the component specifications. Their implementation status is tracked separately in PLAN.md.

| ID | Requirement | Provenance | Acceptance |
|---|---|---|---|
| R09 | Separate engineering orchestration, cognitive succession judgment, and mechanical operational enforcement. Recovery must work without either reasoning agent, model inference, or MCP connectivity. | Explicit checks-and-balances direction; mechanism proposed | A10, A15, A17 |
| R10 | Freeze source, dependencies, build identity, configuration, prompts, model profile, acceptance contract, and evidence. Review and deploy the same immutable candidate; any change to the frozen candidate invalidates approval. | Accepted synthesis; manifest details proposed | A10, A11 |
| R11 | Require mandatory checks, independent review, incumbent acceptance, successor readiness, and an available recovery path together. Neither eloquence nor agreement overrides a failed check. | Design proposal supporting requested governance | A10, A11, A12 |
| R12 | Interview for memory, current commitments, judgment, competence, intended improvement, and justified disagreement. Use scoped read-only real context for continuity, disposable fixtures for ordinary tests, and bounded dispute resolution. | Explicit interview direction; rubric and snapshots proposed | A12, A13 |
| R13 | Have the custodian own a durable, versioned, authenticated and role-restricted succession protocol. Agents negotiate; the custodian validates transitions and evidence. MCP may wrap the core API but cannot become the recovery dependency. | User suggestion; eight-tool protocol proposed | A11, A14 |
| R14 | Allow at most one generation to hold production authority. Transfer after checkpoint, catch-up, and in-flight reconciliation; enforce process-bound capabilities and increasing epochs at every effect boundary. Retain the predecessor as a read-only probation observer. | Design proposal | A13, A14, A15 |
| R15 | Separate approval, authority transfer, and process retirement. Retain a recoverable known-good release after retirement. Roll back code under a new epoch while preserving current memories, tasks, and external-effect records. | Design proposal and accepted rollback principle | A15, A16 |
| R16 | Let governance, memory, personality policy, models, the executable work catalog, authoritative checks and the custodian evolve autonomously through distinct evaluation contracts. A candidate cannot alter the rules admitting itself within the same transaction; previously accepted controls judge their separately staged replacement with an older rescue retained. Protection is specific to an upgrade, not a permanent human-maintenance requirement. Do not accumulate a permanent council of ancestors. | Accepted broader autonomy; explicit full-codebase priority, 2026-10-09; upgrade mechanism to be implemented | A17, A23 |

## Operational quality target

| ID | Requirement | Provenance | Acceptance |
|---|---|---|---|
| R17 | Bound growth, task work, delegation, candidate attempts, interviews, review, and provider usage by configured budgets and fair scheduling. Report unknown cost/usage as unknown. A failed upgrade leaves the incumbent doing other authorized work. Testing uses explicitly configured hourly plan-authoring opportunities while retaining spent calls and other limits. | Design proposal adapted from brief and later discussion; explicit hourly testing direction, 2026-10-09 | A02, A06, A07, A12 |
| R18 | Enforce permissions and authority outside the candidate's prompts. Keep the active release controls, authoritative checks and retained rescue outside the candidate's writable execution environment. Permit draft edits to their source in a separate coding workspace for a subsequent evaluated upgrade; those drafts cannot judge their own admission. Enforce workspace/tool and conversation authority at receivers. Avoid exposing unrestricted host/deployment commands through the succession surface. | Accepted synthesis; clarified authoring versus current admission boundary, 2026-10-09 | A11, A14, A17, A21–A23 |
| R19 | Keep inspectable evidence for task transitions, releases, lineage, regressions, and learning. Record actual outcomes, failures, unresolved concerns, and current state, not just model claims. | Accepted synthesis and growth operationalization | A01, A06, A10, A16 |
| R20 | If temporary conversation mode is selected later, enforce its declared retention policy across every local storage path and explain external Slack/provider retention separately. | Optional colleague feature, not a seed mandate | A18 |
| R21 | Abstract communications from task execution. Provide direct callable/local API interaction for testing, with Slack using the same runtime contracts. | Explicit user implementation steering, 2026-10-08 | A19 |
| R22 | Keep lived-experience substrate in a local folder outside the repository: memory, tasks, growth agenda, checkpoints, transcripts, lineage, and runtime records. Reject in-checkout storage, including symlink aliases. | Explicit user implementation steering, 2026-10-08 | A20 |
| R23 | Only whitelisted human authors may originate self-modification suggestions for consideration. Authenticate and retain each message's author; assess eligibility under current host policy independently of conversation admission. A whitelisted author sharing a thread does not confer authority on other participants; memory, quotations and later growth must not erase source restrictions. Whitelist eligibility permits consideration, not execution or release. | Explicit whitelist direction, 2026-10-08; durable provenance and enforcement are accepted implementation safeguards | A05, A10–A11, A14; P04 authority checks and P16 integration |
| R24 | Let Slack conversations inform internal cognition: interpret experience and suggestions against goals, evidence, commitments, resources and authority; do not execute messages mindlessly or verbatim. Deliberation may clarify, disagree, decline, defer or propose bounded work. Preserve independent standing growth without relabeling restricted human instructions as autonomous authorization. | Explicit user direction, 2026-10-08; concrete deliberation/dispatcher design remains planned | A01–A03, A06, A10–A11; P16 integration |
| R25 | Provide a separate ordinary peer role for direct live/adversarial testing. Preserve confidential information and operation authority against social engineering; evaluate disclosure and authority boundaries before public exposure. Keep finite test evidence distinct from universal security claims. | Explicit peer-role and confidentiality/testing direction, 2026-10-09; local credential/namespace mechanism is the bounded implementation decision | A21; P04/P16 peer work item |
| R26 | Include real iterative coding in the seed: directory/file discovery, text search, full and partial reads, creation, whole and partial updates, deletion, movement/renaming, diff inspection and development/test command execution. Let the autark use actual results to revise its work and preserve drafts, provenance and allocation across interruption, restart, budget pause and succession. The enumerated tools are a minimum capability, not a permanent exhaustive list. | Explicit basic coding requirement, 2026-10-09; command, recovery and tool contracts operationalize it | A06, A22, A23; P17/P18 |

## Seed boundary

The seed should demonstrate one serving incumbent, one temporary successor, fresh review on demand, a small non-LLM custodian, durable work and memory continuity, a real configured provider path, and a bounded standing growth agenda. Both succession and growth belong in the initial product acceptance, rather than being postponed indefinitely as multi-agent enhancements.

Basic repository coding and the inspect/edit/test/repair loop are also seed prerequisites. A complete-file source proposal limited to `src/agent/` is an early release demonstration, not sufficient coding capability. [P17/P18](PLAN.md#p17--implement-the-seeds-iterative-coding-capability) track the missing coding and autonomous upgrade routes; disabled host/custodian replacement cannot count as completed full autonomy. The [coding specification](docs/coding-autonomy.md) separates these target requirements from current implementation.

The decisive recovery demonstration is A15: A builds and accepts B; B takes authority and fails during probation; A's observer is also stopped and the provider unavailable; the custodian restores known-good code with current history and work intact.

This seed does not require training model weights, local inference, a GPU, a distributed consensus cluster, an elaborate general-purpose agent framework, a permanent reviewer agent, or a website. These are scope boundaries, not permanent prohibitions on later research. User accounts, multi-tenancy, an exact host specification, an Ollama adapter, a Codex teacher CLI, a Rust toolchain, mandatory Memvid, and no-idle-improvement policy are not inherited from the colleague brief.

## Open choices

Do not mistake proposed technology for settled requirements. [Open decisions](docs/open-decisions.md) tracks language/runtime, hardware, storage, transport, authority boundary, growth budgets, reviewer evaluation, retention, and future upgrade mechanisms. In particular:

- TypeScript with Node 24 is selected for the first local seed in [ADR 0008](docs/adr/0008-local-seed-runtime.md); the attachment's Rust mandate is a different product choice.
- [ADR 0019](docs/adr/0019-coding-autonomy-and-reusable-agent-plumbing.md) reopens the blanket framework exclusion. A small replaceable/forkable library may supply model/tool protocol support; AI SDK with direct Mistral is a provisional evaluation preference, not a user-selected dependency or a verified integration.
- SQLite is selected for separate operational, memory, and agenda tables in the local seed. It does not substitute for explicit coordination of external effects.
- Memvid is a candidate memory backend; developmental memory is a process above storage.
- A local typed custodian API can precede MCP. No MCP version or provider capability from the historical chat is asserted current here.
