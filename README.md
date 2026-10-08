# Palimpsest

Palimpsest is a planned autonomous coding companion that develops its capabilities, interests, judgment, and implementation while preserving the history that gives it continuity.

Its defining requirement is a **strong, persistent drive for self-improvement**. It should initiate worthwhile learning and engineering work, develop interests beyond immediate utility, and leave each successor better equipped than its predecessor. Growth must have evidence; additional complexity and greater agreeableness are not measures of progress.

## Project status

**Specification and planning only.** There is no runnable agent, provider integration, custodian, deployment, or automated acceptance suite yet. This repository distills the accessible portion of [Research Autonomous Agent Stack](https://chatgpt.com/c/6ac782af-e51c-83ed-bdc9-50060dbcfde5) and its attached colleague brief, as of **2026-10-08**.

Six turns were retrieved, and the referenced attachment was recovered separately. Earlier preferences are preserved where the conversation recaps them, with their provenance identified. The earlier generated project ZIP and design addendum were not recovered. See the [source analysis](docs/research/source-analysis.md) for coverage and limitations.

## Intended system

- Slack is the carried-forward primary interface, remaining responsive while work runs.
- Mistral is the carried-forward default model provider. Other providers are configurable choices; no silent substitution or mandatory Codex reviewer.
- Memory includes experiences, beliefs, procedures, and autobiography. Personality and interests can develop over time.
- A small seed can evolve its own code and, eventually, its operating environment through separately evaluated upgrades.
- A mechanical **custodian** manages authority and recovery. An incumbent interviews its successor through **Skin Shed**, while independent checks and review provide additional evidence.
- Only one generation holds production authority. Recovery restores known-good code while retaining current memories, tasks, and commitments.

The implementation language, exact deployment environment, model identifiers, memory engine, and transport remain decisions to resolve. TypeScript, SQLite, Memvid, and an MCP adapter appear as proposals, with different levels of commitment. The colleague's Rust/Ollama/website-first stack is not automatically the Palimpsest stack.

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
| [Architecture decisions](docs/adr/README.md) | Decision status, rationale, alternatives, and consequences |
| [Acceptance scenarios](docs/acceptance.md) | Observable demonstrations and failure tests to implement |
| [Open decisions and risks](docs/open-decisions.md) | Unresolved choices and the evidence needed to resolve them |
| [Source analysis](docs/research/source-analysis.md) | Conversation provenance and selective adoption of the colleague brief |
| [Distillation checks](docs/research/distillation-validation.md) | Verification performed and source limitations |

Start with **P01–P03 in [PLAN.md](PLAN.md)**: resolve implementation choices, freeze the first behavioral contracts, and build the smallest durable task/provider/tool slice. Read [AGENTS.md](AGENTS.md) before changing the repository. No install or run command is documented until one actually works.
