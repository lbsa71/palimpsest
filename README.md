# Palimpsest

Palimpsest is intended to become a continuing Autark with its own developing identity, judgment, interests and agenda, capable of sustained reasoning and action at least comparable to Claude Code and Codex. That is an engineering and evaluation target, not a claim about the existing implementation or subjective experience.

**2026-10-11: Aeon 1 implementation is active. The previous systemd service is stopped and uninstalled; no replacement is deployed yet.** The [execution record](docs/rewrite/execution.md) tracks owned goals and evidence. Historical source, lived state and release evidence are preserved. There is no legacy API, data-schema, package, or deployment compatibility requirement.

Start with the [Aeon plan](PLAN.md). It organizes work into two Aeons, independently ownable lanes and concrete delegable tasks:

- **Aeon 1 — Codex bootstrap:** build the reasoning/action shell, durable mind, memory, goals, tools, communication, evaluation and whole-system self-evolution substrate.
- **Aeon 2 — Autark development:** run evidence-based cycles of identity and judgment, curiosity, capability acquisition, engineering and improvement of its own learning process.

The [requirements](REQUIREMENTS.md), [architecture](docs/rewrite/architecture.md), [agent-shell decision](docs/rewrite/agent-shell-decision.md), [planning workflow](docs/rewrite/workflow.md), and [engineering rules](AGENTS.md) govern the rewrite. Prompt ownership includes instructions introduced by libraries, tool descriptions, compaction and subagents. Reuse is welcome when it passes those requirements; locally maintaining a fork remains an option.

The initial shell choice is **Pi agent core with locally editable dependencies**, documented in [ADR 0032](docs/adr/0032-select-pi-core-and-source-owned-dependencies.md). Rig is the Rust fallback. The selected core is integrated with durable execution and locally editable dependencies; live behavioral qualification remains outstanding.

The [diagnosis](docs/rewrite/findings.md) records why a full redesign is warranted and how it relates to the previous plan. The [decommission receipt](docs/rewrite/decommission.md) records the actual host change. Earlier docs and source remain historical research material, with the [prior README](docs/history/pre-aeon-2026-10-11/README.md) as an archive entry point. Old startup commands are not instructions to resume that installation.
