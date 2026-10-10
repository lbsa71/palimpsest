# Palimpsest

Palimpsest is an autonomous coding companion under development. It develops its capabilities, interests, judgment, and implementation while preserving the history that gives it continuity.

Its defining requirement is a **strong, persistent drive for self-improvement**. It should initiate worthwhile learning and engineering work, develop interests beyond immediate utility, and leave each successor better equipped than its predecessor. Growth must have evidence; additional complexity and greater agreeableness are not measures of progress.

## Project status

**Priority correction, 2026-10-09:** The seed must support real iterative coding and full autonomy over its whole codebase, including local library forks when useful. The implemented cognitive-only source proposal path falls short of that requirement. [P17/P18](PLAN.md#p17--implement-the-seeds-iterative-coding-capability), the [coding specification](docs/coding-autonomy.md) and [ADR 0019](docs/adr/0019-coding-autonomy-and-reusable-agent-plumbing.md) define the next work. A pinned direct Mistral protocol adapter is selected from isolated fixture evidence; production coding integration remains pending.

**Current product status:** Slack conversation, durable external memory and governed cognitive evolution are implemented. All human users in configured Slack workspaces/channels can converse through mentions or joined threads; a separate whitelist determines self-modification suggestion eligibility. Eligible conversations can propose bounded cognitive source changes through checked succession and configured exact Git publication. A live direct-operator Mistral interaction completed that path and published `f3def48`; live Slack-origin release acceptance remains open. See [conversational self-modification](docs/conversation-self-modification.md). A durable [plan executor](docs/plan-driven-evolution.md) implements two protected P06 contracts, with real-worker fixture coverage across successive sheds and restart. The reviewed host is installed, and the first provenance item completed through a live Mistral shed and restart, with operator-assisted publication reconciliation. All three byte-budget attempts failed mandatory checks; the second accepted shed and unassisted repeated-shed acceptance remain pending. Candidate memory improvements also require final provider-request verification on the interactive path. Testing uses an explicit hourly authoring allocation, with a separate Codex inspection at minute 45; existing reservations and release gates remain enforced. Broader coding and host evolution remain unfinished; see [progress](docs/progress.md) and [the plan](PLAN.md).

The installed host `f2f8be22` retains scoped conversation outcomes and deferred-topic obligations, runs optional reflection within existing growth limits, and reports deferred topics in their original thread without a new prompt. Independent frozen review and a finite Mistral peer check verified the local report path. Peers retain outcomes and reports but cannot schedule reflection or source work. This does not establish improved naming judgment, live reflective cognition or public security readiness. See the [continuity work item](docs/work-items/p16-conversation-continuity.md).

A bounded [durable coding host](docs/adr/0027-durable-coding-sessions-and-exact-submissions.md) now connects injected direct/eligible Slack and independent-growth entrypoints to shared accounting, verified admitted-source drafts, actual tools and exact immutable submissions. Deterministic native SDK fixtures exercise failure, repair and asynchronous reporting. The CLI does not yet configure this coding provider; production dependency packaging, model competence and installation remain pending. See the [work item](docs/work-items/p17-serving-coding.md).

The operator checkout and configured publication branch use `main`. Collector source and the independent autonomy audit are integrated; collector acceptance and its [operator interruption repair](docs/work-items/operator-installation-interruption.md) remain open. The running installation retains its previously reviewed release. Publication still requires an admitted candidate, exact source and a compatible remote head; source integration is not a new release approval.

**First model-authored source release completed, 2026-10-08.** Palimpsest authored, evaluated and locally promoted a conversation-memory isolation improvement; its exact source was pushed as `5044b57`. The release-era suite passed 205 tests with one platform skip; current verification is recorded in [progress](docs/progress.md). See the [release evidence](docs/self-improvement-2026-10-08.md). Live Slack mention and subsequent unmentioned thread replies passed after fixing recovery and adding durable joined-thread handling. Full seed acceptance remains open: memory/interview quality has explicit follow-ups in [progress](docs/progress.md).

This repository began by distilling the accessible portion of [Research Autonomous Agent Stack](https://chatgpt.com/c/6ac782af-e51c-83ed-bdc9-50060dbcfde5) and its attached colleague brief.

Six turns were retrieved, and the referenced attachment was recovered separately. Earlier preferences are preserved where the conversation recaps them, with their provenance identified. The earlier generated project ZIP and design addendum were not recovered. See the [source analysis](docs/research/source-analysis.md) for coverage and limitations.

## Intended system

- Slack is the carried-forward primary interface, remaining responsive while work runs.
- Mistral is the carried-forward default model provider. Other providers are configurable choices; no silent substitution or mandatory Codex reviewer.
- Memory includes experiences, beliefs, procedures, and autobiography. Personality and interests can develop over time.
- A small seed can evolve its own code and, eventually, its operating environment through separately evaluated upgrades.
- A mechanical **custodian** manages authority and recovery. An incumbent interviews its successor through **Skin Shed**, while independent checks and review provide additional evidence.
- Only one generation holds production authority. Recovery restores known-good code while retaining current memories, tasks, and commitments.

The local seed uses TypeScript, Node 24, SQLite, and macOS Seatbelt for restricted jobs. Communications have a direct adapter and authenticated loopback API so testing does not require Slack. Mistral is the default; Codex is an explicit alternative. Model identifiers require configuration. Memvid and MCP remain optional future integrations. See [ADR 0008](docs/adr/0008-local-seed-runtime.md).

## Local development

With Node 24.13 or later in the Node 24 series and npm installed (macOS is required for the current restricted worker implementation):

```sh
npm ci
npm run verify
npm start -- doctor
```

`doctor` reports configuration without revealing credentials or calling a provider. Put `MISTRAL_API_KEY` and a verified `MISTRAL_MODEL` in the private external file `~/.config/palimpsest/credentials.env` (mode `0600`) before the first bootstrap. Then `npm start -- ask "Hello"` runs a durable direct task; the first bootstrap requires a clean Git checkout. `npm start -- serve` starts the bearer-authenticated loopback API; its startup record gives the URL and private token file path. With complete Slack configuration it also starts the selected Slack ingress. See the [runbook](docs/runbook.md) for configuration, current commands, and limits.

Lived experience is stored **outside the repository**, by default under `~/.local/share/palimpsest/<repository-id>/`. This includes tasks, memory, growth, transcripts, checkpoints, and runtime evidence. In-repository paths and symlink aliases are rejected. Git contains source, specifications, synthetic fixtures, and sanitized verification summaries.

Ordinary local peer testing uses a separate private credential and `/peer/messages` on the same running model/runtime, with isolated peer context and no self-modification eligibility. See [peer testing](docs/peer-conversation.md) and the [runbook](docs/runbook.md#local-peer-conversation). This remains a local test surface; public-release security acceptance is unfinished.

## Read and work

| Artifact | Purpose |
|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | Product direction, invariants, scope, and traceable requirements |
| [PLAN.md](PLAN.md) | Milestones, dependency-ordered work items, and completion evidence |
| [AGENTS.md](AGENTS.md) | Mandatory specification, pragmatic TDD, delegation, review, and documentation rules |
| [GROWTH.md](GROWTH.md) | Standing self-development agenda and learning cycle |
| [Architecture](docs/architecture.md) | Responsibilities, authority boundaries, and system diagrams |
| [Skin Shed](docs/protocols/skin-shed.md) | Succession roles, tools, lifecycle, handoff, and recovery |
| [Memory](docs/memory.md) | Developmental memory, provenance, correction, and continuity |
| [Growth runtime](docs/growth-runtime.md) | Autonomous scheduling, persistent allocation and experiment delivery |
| [Memory runtime](docs/memory-runtime.md) | Bounded consolidation, source version checks and scoped snapshots |
| [Worker supervision](docs/worker-supervision.md) | Real process identity, confinement and effect receivers |
| [Source evolution](docs/evolution.md) | Model-originated proposals, protected checks, interviews and local promotion |
| [Coding autonomy](docs/coding-autonomy.md) | Required workspace tools, iterative repair, fork ownership and full-codebase release routes |
| [Slack setup](docs/slack-setup.md) | Minimal app manifest, Socket Mode and private credential setup |
| [Architecture decisions](docs/adr/README.md) | Decision status, rationale, alternatives, and consequences |
| [Acceptance scenarios](docs/acceptance.md) | Observable demonstrations and failure tests to implement |
| [Open decisions and risks](docs/open-decisions.md) | Unresolved choices and the evidence needed to resolve them |
| [Source analysis](docs/research/source-analysis.md) | Conversation provenance and selective adoption of the colleague brief |
| [Distillation checks](docs/research/distillation-validation.md) | Verification performed and source limitations |

Use [PLAN.md](PLAN.md) for current work and remaining acceptance gates. Read [AGENTS.md](AGENTS.md) before changing the repository.
