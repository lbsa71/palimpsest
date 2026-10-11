# Current progress and evidence

## 2026-10-11 — Aeon 1 implementation started

The user authorized the full Aeon 1 implementation goal with maximal useful parallelism and goals for subagents. Contracts, Pi integration and evaluation are being implemented in three isolated worktrees while the lead implements supervisor/release foundations. The [execution record](rewrite/execution.md) tracks ownership, integration and remaining evidence. No replacement service is deployed; acceptance has not been claimed.

## 2026-10-11 — shell choice delegated and recorded

The user prioritized autonomous dependency editing, simple builds/reloading and minimal justified scope, while excluding personal language aesthetics from the decision. [ADR 0032](adr/0032-select-pi-core-and-source-owned-dependencies.md) selects **Pi agent core with a narrow editable source closure and TypeScript/Node shell integration**. The final three-contender SWOT includes Rig as the first Rust fallback and AI SDK as the provider-oriented alternative. Codex, DeepAgentsJS and Claude Agent SDK retain explicit dispositions.

Parallel source audits and a second Rig check informed the choice; [evidence](rewrite/evidence/A1-L02/2026-10-11-source-audit.md) distinguishes inspected source from unperformed build/behavior checks. RW21 and the affected lanes now require a real local dependency edit → check/build → successor activation demonstration. The former five-candidate selection exercise is replaced by focused Pi qualification and a bounded fallback. No packages were installed, implementation or paid model run performed, or service restarted. A1-L02 remains incomplete.

## 2026-10-11 — rewrite planning and decommission

The user chose a full rewrite with no legacy support after reviewing the gap between operational mechanics and general reasoning/development. Current source remains the retired implementation. **No rewrite implementation lane is complete, and no replacement service is deployed.**

Completed work in this planning change:

- Persisted [diagnosis](rewrite/findings.md), active requirements, architecture, prompt ownership, finite agent-shell comparison and component reuse ledger.
- Replaced active entry points with the [Aeon plan](../PLAN.md): nine Codex bootstrap lanes and five internal Autark development lanes, with fourteen copyable goals and 74 delegable tasks.
- Made the Aeon → Lane → Task method a requirement in [AGENTS](../AGENTS.md), [RW19](../REQUIREMENTS.md) and the [workflow](rewrite/workflow.md).
- Preserved nine prior entry-point documents under [history](history/pre-aeon-2026-10-11/README.md), with rebased links and explicit superseded status. Prior source, work items and ADRs remain available as historical evidence.
- Stopped, disabled and removed the actual systemd installation. [Decommission evidence](rewrite/decommission.md) records absent unit, zero main PID and no API listener. Lived data and private configuration remain preserved.

The preceding Slack recovery fix had already been pushed/deployed and recovered the two known missed messages without duplicates; the new [diagnosis](rewrite/findings.md) preserves its evidence and limits. That success is separate from cognitive competence and from this deliberate shutdown.

[Planning validation](rewrite/validation.md) records checks and review dispositions for these artifacts. The [prior progress log](history/pre-aeon-2026-10-11/docs/progress.md) retains older results, including historical deployment statements that are no longer current.

Next eligible work: A1-L01 contract specification, A1-L02 selected-core extraction/qualification, A1-L08 baseline design and A1-L09 release-boundary design in parallel. Each fresh session claims its lane, reads its exact goal and dependencies, and works within its separately established authority.
