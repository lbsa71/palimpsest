# Palimpsest

Palimpsest is an autonomous coding companion under development. It develops its capabilities, interests, judgment, and implementation while preserving the history that gives it continuity.

Its defining requirement is a **strong, persistent drive for self-improvement**. It should initiate worthwhile learning and engineering work, develop interests beyond immediate utility, and leave each successor better equipped than its predecessor. Growth must have evidence; additional complexity and greater agreeableness are not measures of progress.

## Project status

**Local seed implementation in progress, 2026-10-08.** The CLI, durable tasks, scoped memory, direct/loopback communications, provider adapters, bounded growth experiments, and isolated procedures have automated coverage. Governed succession and the complete self-improvement demonstration remain in progress. Live provider and Slack readiness are separate checks; see [progress and evidence](docs/progress.md).

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

With Node 24 and npm installed:

```sh
npm ci
npm run verify
npm start -- doctor
```

`doctor` reports configuration without revealing credentials or calling a provider. Put `MISTRAL_API_KEY` and a verified `MISTRAL_MODEL` in the private external file `~/.config/palimpsest/credentials.env` (mode `0600`). Then `npm start -- ask "Hello"` runs a durable direct task. `npm start -- serve` starts the bearer-authenticated loopback API; its startup record gives the URL and private token file path. See the [runbook](docs/runbook.md) for configuration, current commands, and limits.

Lived experience is stored **outside the repository**, by default under `~/.local/share/palimpsest/<repository-id>/`. This includes tasks, memory, growth, transcripts, checkpoints, and runtime evidence. In-repository paths and symlink aliases are rejected. Git contains source, specifications, synthetic fixtures, and sanitized verification summaries.

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

Use [PLAN.md](PLAN.md) for current work and remaining acceptance gates. Read [AGENTS.md](AGENTS.md) before changing the repository.
