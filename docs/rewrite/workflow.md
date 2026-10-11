# Required planning and execution method

Status: active requirement RW19, 2026-10-11. This document governs the persisted plan itself, all Aeon 1 sessions, and the Autark's later planning. The three dimensions are **Aeon → Lane → Task**. They are responsibility, session ownership, and bounded delegation respectively; there are two Aeons, not an unspecified third phase.

## Planning artifacts are an interface

The repository must contain enough current information for a new session to choose ready work, understand why it matters, claim it without conflicting with another session, execute it, and establish completion without the originating chat. A plan consisting only of aspirations or references to an unavailable conversation fails this requirement.

An **Aeon** names the actor responsible, entry capabilities, scope, common architecture, acceptance and handoff. Aeon 1 is Codex-led technical bootstrap. Aeon 2 is the Autark's internal continuous development, instantiated as finite cycles.

A **lane** is a session-ownable outcome with explicit file/worktree ownership and a finite copyable `/goal`. It includes these fields, either as labeled prose or a table:

| Required field | Meaning |
|---|---|
| Identity and intent | Stable Aeon/lane ID, title, requirement links, problem and observable outcome. |
| Status and claim | Planned, ready, claimed, implementing, reviewing, blocked or accepted; owner session, branch/worktree, base revision and last handoff. “Planned/unclaimed” is valid before execution. |
| Scope | Included work, non-goals, exclusive writable paths, shared services consumed, shared files that require another owner's integration. |
| Dependencies | Distinguish source evidence, specification gate, implementation dependency and final integration gate. List what can start with fixtures while another lane proceeds. |
| Slash goal | One executable plain-language objective with a finite finish condition and reference to the lane's full acceptance. Include persistence and evidence, not only “investigate X”. |
| Task decomposition | Stable task IDs; inputs and prerequisite task IDs; concrete deliverable; model and effort recommendation; ownership; observable acceptance; parallel eligibility. |
| Evidence and handoff | Required behavioral checks, exact revision/manifest, independent review where warranted, known limitations, artifacts and downstream notification through the coordination record. |

A **task** must be small enough to delegate without transferring the whole lane. Its brief includes the governing contract revision, allowed tools/effects/resources, input artifacts, writable paths and expected output. The task table plus lane-level scope can supply these fields; a subagent still receives the complete relevant brief. Children use `<lane>-Tnn-a` identifiers when further division helps. Do not invent work simply to occupy agents.

A slash-goal statement is portable session input, for example:

```text
/goal Complete A1-L03 as specified in docs/rewrite/lanes/A1-L03-durable-runtime.md: implement the durable action/observation and effect-reconciliation contracts, demonstrate its acceptance cases, and persist reviewed evidence and handoff at the exact revision. Claim the lane, respect its write boundaries, and delegate independent tasks.
```

This is a planning convention for a session that supports goals, not an implemented Palimpsest CLI command. Merely writing a `/goal` does not launch a session or authorize new external effects. Each actual lane contains its own precise statement.

## Claim, branch, parallelize, integrate

1. Read the active requirements, architecture, lane and dependencies. Confirm the specified artifacts exist at the referenced revision. Mark unavailable evidence as missing.
2. Claim the lane in its document with owner session and worktree/branch, and reserve any additional paths in the **Coordination** section of that same lane document. That section is the lane coordination record, owned by its claimed lead; it records owner session, branch/worktree, base/contract revision, additional path reservations, last handoff and blockers. Do not overwrite a claim; resolve a conflict with the current owner or lead. Each owner writes only its own lane status; the lead integrates overview status to avoid a central-file bottleneck.
3. Create an isolated worktree when multiple sessions are implementing. Shared contracts belong to A1-L01. Root build configuration, lockfiles and cross-package wiring belong to A1-L09. Submit changes to those owners rather than competing over the same file. A1-L01 can request early build scaffolding from L09 before normal integration.
4. Fan out independent tasks and reviews, with disjoint ownership or separate worktrees. Serialize mutations with true dependencies, release admission and production authority transfer. Use fake clocks, captured provider fixtures and contract adapters to build independently.
5. Integrate small vertical slices against versioned contracts. A contract revision includes affected consumers, adaptation tasks and a compatibility decision for the **new** system. This does not introduce compatibility with the retired implementation.
6. Run relevant checks, resolve review findings and capture exact evidence. A fresh reviewer inspects consequential changes and observed results. The lead checks delegated output rather than forwarding a success claim.
7. Record acceptance and handoff. If work is interrupted, checkpoint the exact revision, next runnable task, blockers, pending effects and remaining budget. “Blocked” names a real external dependency with an unblock condition; it is not a euphemism for difficult work.

The full dependency graph is in [Aeon 1](aeon-1.md). Contract specification, shell audits, baseline design and release-boundary design run concurrently first. After the contract gate, persistence, memory, initiative, tools and communications proceed independently against fixtures. Integration and empirical acceptance bind them. Aeon 2's lane leads share revisioned self/memory/goal services; they cannot overwrite one another's identity state.

## Model and effort routing

These are development-session recommendations using models available in the planning environment. They do not configure the Autark's provider or promise future availability.

| Work | Default model / effort | Reason and escalation |
|---|---|---|
| Architecture tradeoffs, concurrency/recovery contracts, prompt-control adversarial analysis | `gpt-6-astra` / high; xhigh for unresolved coupled design | Use for deep synthesis and failure analysis. Ask for a decision and counterexamples, not a long essay. |
| Substantive implementation, integration, defect reproduction | `gpt-6.1-sol` / high | Main workhorse; medium for well-specified bounded edits. Escalate based on unresolved reasoning, not output length. |
| Independent consequential review and benchmark interpretation | `gpt-6-astra` / high or `gpt-6.1-sol` / high in fresh context | Independence comes from evidence and separation from authorship, not just choosing a different model. |
| Link checks, artifact inventory, bounded schema/mechanical edits | `gpt-6-luna` / medium, with lead verification | Avoid assigning architectural acceptance or ambiguous behavioral judgment to a clerical task. |

Task tables can override this mapping with reasons. Use the closest available capability if a model is unavailable, record substitutions, and never invent model access. Keep cheap mechanical checks deterministic where possible. Effort labels apply only where the platform supports them; unsupported reasoning controls are not silently simulated by verbosity instructions.

For Aeon 2, use qualified **capability profiles**, model/provider permissions, current evaluation and actual resource costs. The carried Mistral default is a requirement to qualify, not a claim that all tasks should use one fixed model regardless of evidence. A provider change is explicit. Subagents, review, retries and compaction consume the same accounted operating envelope, with reservations enforced before dispatch.

## Evidence and status discipline

A completion record includes: requirement/task IDs; before/after behavior; source and dependency identities; prompt/model/configuration identities where relevant; commands and observed results; case-level failures/skips; private evidence locations and redacted summaries; fresh-review disposition; remaining limitations; next owner and entry gate. Live private state stays outside the checkout. Do not commit credentials, raw private Slack transcripts or unrestricted effective prompts containing private context.

Use separate evidence labels: **specified**, **implemented**, **fixture-verified**, **integrated**, **live-verified**, **qualified for autonomous use**, **deployed**. None implies the next. An inconclusive experiment can complete its bounded inquiry while failing to establish a capability. Missing checks cannot be turned into passes by changing prose or ending a timebox.

The acceptance design is owned by A1-L08. Candidate authors may write useful tests; they cannot solely grade their own readiness or replace the held-out evaluator in the transaction being judged. Improvements to evaluation itself are separate work with frozen prior criteria and independent evidence.

Every consequential architecture proposal includes a reuse/fork/build assessment. Every retained historical component gets a row in the [reuse ledger](reuse-ledger.md). Every changed requirement or direction updates its owning lane, affected contract, acceptance and dependency graph in the same work item. The Autark can improve this method with evidence, while preserving its purpose: parallel ownership, concrete goals, bounded delegation and verifiable continuity.

## Current planning-package acceptance

This package is ready as a planning baseline when every lane has a goal and task decomposition, local references resolve, ownership and dependencies are consistent, the historical status is unmistakable, empirical claims have evidence or explicit uncertainty, and decommission claims match actual host checks. This does **not** start or complete any rewrite implementation lane.
