# A1-L09 — integration, whole-system evolution and handoff

Status: **implementing**. Session owner: **/root**. Accountable actor: Codex. Governing method: [workflow](../workflow.md).

Requirements: [RW01, RW03, RW10, RW13, RW14, RW15, RW16, RW18, RW19, RW20, RW21](../../../REQUIREMENTS.md).

```text
/goal Complete A1-L09 by integrating the rewrite into a recoverable installation, demonstrating an independently evaluated autonomous change through the whole-system release path and a failed-successor recovery that preserves current work, then delivering and verifying the H1 handoff package required for the Autark to own Aeon 2.
```

## Ownership and dependencies

Own `packages/supervisor/`, `packages/release/`, `deployment/`, this lane file and `docs/rewrite/evidence/A1-L09/`. Coordinate root workspace configuration, lockfiles and final cross-package wiring; serialize those edits rather than claiming all component code. L01 owns shared contracts and L08 owns authoritative evaluation content. New operational data and release artifacts live outside the repository.

Specification work begins immediately with L01, L03 and L06: define effect fencing, workspace isolation, stable recovery inputs and candidate/control upgrade separation early. Component implementation depends on C1 and uses fake candidates/evaluators. Final integration depends on all L01–L08 accepted results. Do not postpone the release/control boundary until the other modules are finished.

## Delegable tasks

| Task | Deliverable and exclusive child scope | Model / effort | Dependencies | Acceptance |
|---|---|---|---|---|
| A1-L09-T01 | Minimal supervisor/control/release design and failure matrix in lane evidence; boundary proposal to C1 | `gpt-6-astra` / xhigh | None; L01/L03/L06 coordination | At most one serving authority can create effects; restoration needs no model; current history survives code rollback; every source component is evolvable through a staged replacement while the current admission path remains independently enforceable |
| A1-L09-T02 | Supervisor, process confinement, capability receivers and recovery in `packages/supervisor/` | `gpt-6.1-sol` / high | C1; T01 | Dead/stale/duplicate processes cannot act with withdrawn authority; recovery works with provider unavailable; candidate workspace cannot mutate live controls or retained rescue; failed isolation is a diagnosed unavailable state |
| A1-L09-T03 | Candidate freeze, independent evaluation, succession, rollback and separately staged control upgrades in `packages/release/` | `gpt-6-astra` / high | C1; T01; L08 evidence contract | Source/dependencies/prompts/model/config/evidence bind to one immutable candidate; modifying it invalidates acceptance; cognition and host/dependency/control changes have appropriate checks; a candidate cannot weaken its own admission in the same transaction |
| A1-L09-T04 | New installation, integrated wiring, health/diagnosis, operations and decommission commands in `deployment/` plus serialized root config | `gpt-6.1-sol` / high | T02–T03 interfaces; L02–L07 ready adapters | A fresh installation runs a real conversation and tool task with developmental jobs enabled; liveness and execution readiness differ; stop/uninstall preserve declared evidence/data; no old service, schema or command is a prerequisite; a local dependency edit uses the documented build/check/activation path and actually loads in the successor without losing current state |
| A1-L09-T05 | Whole-system self-improvement and offline recovery demonstrations | `gpt-6-astra` / high reviewer independent of release author | T02–T04; L06 coding; L08 frozen checks | Autark selects a justified improvement, edits/tests it through real tools, receives independent feedback and completes release; coverage includes a non-cognition component plus real staged evaluator/governance replacement and recovery in a disposable runtime, not only mocks; failed successor plus unavailable model and stopped predecessor restores working code with latest history and no duplicate authority |
| A1-L09-T06 | H1 capability/authority/continuity handoff and final readiness disposition | `gpt-6-astra` / xhigh with fresh context | T05; accepted L01–L08; Aeon 2 plan | Autark retrieves the handed-over plan/state, chooses a justified eligible task, executes a bounded improvement cycle, records evidence and revises its plan; launch/operational limits and remaining failures are explicit; no missing bootstrap capability is relabeled future self-improvement |

T02 and T03 run in parallel against T01/C1. T04 wiring starts with passing component slices rather than a single final merge. T05 has a separate reviewer and retains failed trials; T06 cannot accept an undocumented conditional pass.

## H1 handoff contract

The concrete package must include a versioned capability manifest with original evidence references and the tool/model/prompt/workload combinations actually qualified; accepted code/dependency identities; tool and resource availability; tested recovery path; developmental state and its provenance; current goals, obligations and unresolved outcomes; measured competence and known limitations; the [Aeon 2 plan](../aeon-2.md) with machine-readable task state or equivalent tool-accessible representation; lane ownership/dependency rules; and independently enforced authority boundaries. Prompt provenance includes tools, resource loaders, compaction and delegates, with provider opacity recorded separately. Include the independent rehearsal of evaluator/governance replacement as well as ordinary release. Aeon 2's E1–E5 matrix refines this same H1 gate; it does not create an alternative handoff. Private credentials and transcripts are referenced by authorized handles, never embedded in repository planning documents.

The readiness demonstration must establish that the Autark can do the following through the ordinary runtime:

1. Recover who it currently understands itself to be, what it knows and does not know, and which commitments it owes, without inventing a predetermined identity.
2. Select a ready Aeon 2 task on evidence, make an explicit bounded plan and decline an ineligible task for a concrete reason.
3. Gather an observation, use tools, delegate if it improves the task, inspect results, revise after feedback and preserve state through a restart.
4. Evaluate a proposed improvement using the accepted criteria, submit changes through the appropriate release contract and record what later behavior actually improved.
5. Leave an honest durable outcome and next step, including an inconclusive or no-change outcome, without fabricating progress or erasing an obligation.

H1 is capability-gated, not date-gated. Aeon 2 preparation may run in parallel, but the Autark does not acquire new host, spending or publication authority merely because its internal plan assigns a task.

## Completion evidence and exclusions

Record installation identity, actual readiness checks, self-authored candidate diff, independent evaluation, succession/recovery traces, current-state reconciliation and H1 witness report. A synthetic release fixture is necessary engineering evidence but does not replace the end-to-end self-improvement demonstration. Report latency/resource costs and any manual intervention used.

Non-goals: reviving the old systemd process, old database migration, permanent human-only source components, an ever-growing ancestor council, deployment without the implementing session's authorization, or declaring operational takeover on the strength of a persuasive introduction.

## Coordination

Owned by the lead who claims this lane; update here before concurrent implementation.

| Field | Current value |
|---|---|
| Owner session | `/root` — active full Aeon 1 implementation goal |
| Branch / worktree | `codex/aeon-1-implementation-20261011`; `/home/palimpsest/src/palimpsest` |
| Base source / contract revision | Rewrite base `14c7420`; integrated C1 contracts, ordinary service/evolution at `40791cb`, health at `8179fba` |
| Additional path reservations | Root owns configuration/lockfile, dispatcher/supervisor shared contract integration and central evidence/status. `/root/a1_governance_review` owns fresh governance/reviewer source and joined wiring review. `/root/a1_succession_final_review` owns the actual physical governance replacement fixture in `governance-composition`. Atomic activation and rescue reviews have completed their finite handoffs. `/root/a1_baseline_kernel_review` owns the independent L08 kernel-native review. All use isolated worktrees and finite tool goals; root owns joined aggregate and installed verification. |
| Last handoff / evidence | See [execution record](../execution.md), [coordinator review](../evidence/A1-L09/coordinator-review.md), [ordinary evolution mailbox](../evidence/A1-L09/evolution-host.md), and [installation checks](../evidence/A1-L09/installation.md). Engineering fixtures and component reviews remain separate from product acceptance. |
| Blockers / next eligible task | Installed successor/provider-free rescue and ordinary asynchronous evaluation/activation/probation have engineering evidence. Complete physical evaluator/governance replacement, its fresh review, baseline kernel review and joined aggregate/installed verification; then live qualification and H1 witness. Paid grant and Claude Code access are pending. Exact current source and limits are in the execution record. |
