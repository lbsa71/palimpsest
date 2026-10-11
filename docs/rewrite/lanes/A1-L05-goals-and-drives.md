# A1-L05 — goals, drives and initiative

Status: **implementing**. Session owner: **Codex /root/a1_initiative**. Accountable actor: Codex. Governing method: [workflow](../workflow.md).

Requirements: [RW06, RW07, RW10, RW19](../../../REQUIREMENTS.md).

```text
/goal Complete A1-L05 by implementing persistent, revisable goals and drives that initiate useful inquiry without a fresh user prompt, turn priorities into observed work, preserve commitments through interruption, and allocate resources fairly while pausing, replanning or ending unproductive activity honestly.
```

## Ownership and dependencies

Own `packages/initiative/`, this lane file and `docs/rewrite/evidence/A1-L05/`. Own goal/drive semantics, planning, wakeups, allocation and follow-up obligations. L03 owns execution and physical accounting; L04 owns autobiographical evidence; L07 delivers messages. Scheduling policy must not encode personality as unconditional obedience or manufacture urgency to keep a process busy.

Specification dependencies: C1 goals, budgets, obligations and observations. Component implementation uses fake time, executor and memory. Integration dependencies: L03 execution/accounting, L04 retrieval, L06 inquiry tools and L07 delivery. L09 supplies externally enforced maximum permissions/resources.

## Delegable tasks

| Task | Deliverable and exclusive child scope | Model / effort | Dependencies | Acceptance |
|---|---|---|---|---|
| A1-L05-T01 | Goal/commitment registry and revision state machine in `packages/initiative/goals/` | `gpt-6.1-sol` / high | C1 | Objectives, completion evidence, provenance, priorities, dependencies, resource limits and abandonment reasons survive restart; goals distinguish active, waiting, blocked, paused and complete; unresolved commitments cannot disappear through summarization |
| A1-L05-T02 | Drive and priority formation grounded in experience in `packages/initiative/drives/` | `gpt-6-astra` / high | C1; L04 self-state interface | Four standing growth dimensions can generate concrete inquiry without a new human prompt; experience changes relative priorities; investigation seeks new observations; a reasoned refusal or independent interest is representable without being reduced to a failed instruction |
| A1-L05-T03 | Planner/executor handoff, progress checks, replanning and targeted critique in `packages/initiative/planning/` | `gpt-6.1-sol` / high | T01 interface; L03 execution contract | A failed hypothesis or tool result changes the next step; critique is used when evidence or task risk warrants it; loops stop, wait or seek a new observation when progress stalls; self-agreement alone is not verification |
| A1-L05-T04 | Fair scheduler, wakeups, cumulative limits and resource contention handling in `packages/initiative/scheduling/` | `gpt-6.1-sol` / high | T01 interface; L03 resource contract | Due commitments, active conversations and standing inquiry all receive declared service; long jobs cannot starve new inputs; budget exhaustion preserves spent usage and resumable state; cancelled work is not free; allocations can span windows under finite lifetime limits |
| A1-L05-T05 | Durable report obligations and integrated initiative demonstrations in `packages/initiative/obligations/` and lane-owned tests | `gpt-6.1-sol` / high; fresh `gpt-6-astra` / high reviewer | T01–T04; L03/L04/L06/L07 | Pending investigation resumes without a new message and produces a current, actually delivered report; holding messages do not clear the obligation; several independent cycles include non-coding inquiry and later evidence-grounded revision; an inconclusive result is honestly retained |

T02–T04 are parallel after T01's draft. The obligations subagent owns its namespace and consumes the planner state; it does not duplicate goal completion logic. Evaluation design begins with L08 before collecting demonstrations.

## Completion evidence and exclusions

Record actual unattended selections, inputs to priority decisions, tool observations, goal revisions, allocation traces and receipts for owed reports. Demonstrate a restart during inquiry and a later resource window that resumes the same objective without resetting its total allowance. Include one justified no-action decision; activity is not a growth metric.

Non-goals: simulating biological urges, hard-coding a personality, guaranteeing a chosen interest will emerge, replacing evidence with repeated reflection calls, forcing equal activity in every dimension on every day, or allowing goals to confer permissions or funding on themselves.

## Coordination

Owned by the lead who claims this lane; update here before concurrent implementation.

| Field | Current value |
|---|---|
| Owner session | Codex /root/a1_initiative |
| Branch / worktree | `codex/a1-initiative-20261011` / `/home/palimpsest/migration/aeon-1-20261011/initiative` |
| Base source / contract revision | `4e55167` / `aeon1.c1.v1` |
| Additional path reservations | None; use the exclusive scope above |
| Last handoff / evidence | Planning specification only |
| Blockers / next eligible task | Implement T01–T05 against actual L03/L04; live growth and independent review remain separate gates |
