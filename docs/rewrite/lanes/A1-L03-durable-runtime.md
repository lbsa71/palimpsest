# A1-L03 — durable runtime and recovery

Status: **accepted — engineering runtime/recovery gate**. Session owner: **/root after author and fresh-review handoffs**. Accountable actor: Codex. Governing method: [workflow](../workflow.md).

Requirements: [RW02, RW05, RW10, RW11, RW12, RW15, RW16, RW19](../../../REQUIREMENTS.md).

```text
/goal Complete A1-L03 by implementing a durable reasoning-action-observation runtime that resumes real work after interruption, preserves ownership and resource accounting, reconciles uncertain external outcomes without duplicate effects, and demonstrates recovery with deterministic failure injection and the selected shell.
```

## Ownership and dependencies

Own `packages/runtime/`, `packages/effects/`, `packages/storage/`, this lane file and `docs/rewrite/evidence/A1-L03/`. Supply operational storage and append/retrieve primitives to L04/L05; those lanes own developmental and initiative semantics. L09 owns process authority and deployment, not the run state machine.

Specification dependencies: C1 execution/effect/control contracts. Implementation may begin against fake shell, tools and provider. Final integration dependencies: L02 shell, L06 effect receiver and L09 process fencing. No legacy data import or API compatibility is required.

## Delegable tasks

| Task | Deliverable and exclusive child scope | Model / effort | Dependencies | Acceptance |
|---|---|---|---|---|
| A1-L03-T01 | Fresh operational persistence, transactional event append, projections and schema maintenance in `packages/storage/` | `gpt-6.1-sol` / high | C1 state contracts | Committed input cannot disappear between acknowledgement and scheduling; restart rebuilds authoritative state; partial writes and corrupted/incompatible data produce diagnosed failures; data remains outside the source checkout |
| A1-L03-T02 | Run/step lifecycle, action-observation loop, checkpoints, cancellation and steering in `packages/runtime/execution/` | `gpt-6.1-sol` / high | C1; T01 interface; fake shell | A multi-step task revises its plan after a failed tool result; ordinary simple turns can finish promptly; waiting, budget exhaustion and completion differ; restart resumes with actual retained observations rather than another one-shot reply |
| A1-L03-T03 | Effect journal, deduplication, idempotency and reconciliation in `packages/effects/` | `gpt-6-astra` / high | C1 effect contract; T01 interface | Crashes before/after send and before receipt do not invent success; safe retries are distinguished from uncertain effects; unknown outcomes have an explicit reconciliation/abandonment route; duplicate delivery does not duplicate task identity |
| A1-L03-T04 | Physical-request accounting, resource reservation, liveness and cancellation/drain metrics in `packages/runtime/resources/` | `gpt-6.1-sol` / high | C1; L02 call hooks; L05 allocation contract | Tool loops, retries, compaction, reviewers and subagents share enforceable total limits without hidden calls; spent/unknown usage survives restart; no worker or cancelled child continues effects after ownership withdrawal |
| A1-L03-T05 | Runtime recovery suite and joined shell/tool proof in `packages/runtime/test/` | `gpt-6-astra` / high reviewer with fresh context | T01–T04; L02/L06/L09 adapters | Kill/restart at declared transition boundaries, lost receipts, duplicate inputs and provider outages preserve state and authority; an interrupted inspect/edit/test/repair task finishes from a checkpoint with auditable effects |

T01 establishes an early storage interface. T02–T04 can then proceed concurrently against it and C1 fixtures; T05's failure matrix is designed before integration and executed after it. Keep storage mechanism separate from claims about what the Autark remembers or values.

## Completion evidence and exclusions

Record transition diagrams, actual crash/restart traces, authoritative before/after state, physical call accounting, uncertain-effect dispositions and fresh review. Tests must cross actual process/storage boundaries for the final recovery claim; in-memory simulation alone is not sufficient. L07 separately proves Slack-specific missed-message recovery.

Non-goals: reconstructing historical SQLite tables, making a model choose the recovery procedure, relying on an SDK transcript as the authoritative effect ledger, indefinite retries, or claiming exactly-once delivery from a network API that does not provide it.

## Coordination

Owned by the lead who claims this lane; update here before concurrent implementation.

| Field | Current value |
|---|---|
| Owner session | /root, accepting author closeout and fresh /root/a1_engineering_proof_review recommendation |
| Branch / worktree | codex/a1-runtime-closeout-20261011 / /home/palimpsest/migration/aeon-1-20261011/runtime-closeout |
| Base source / contract revision | e542f49 / aeon1.c1.v1 (ACK; C1 engineering accepted at dbab4be, evidence cc72d1c) |
| Additional path reservations | This closeout owns lane/evidence and packages/runtime/test/**; source repairs require root coordination. One joined actual process/tool/checkpoint proof, no application/supervisor/config changes. |
| Last handoff / evidence | [Engineering acceptance closeout](../evidence/A1-L03/closeout.md), exact joined test 3eceef4; original [implementation](../evidence/A1-L03/implementation.md) retained as historical evidence |
| Blockers / next eligible task | T01–T05 engineering gate accepted by root after fresh review 3b7d507 (integrated 6c6d885). Exact unchanged recovery proof passed again: 1/1, zero skips, 3.246s; 28 pure contract/storage/effect/resource checks and strict compile passed. Explicit host-assisted reconciliation and cleanup are disclosed in the [fresh review](../evidence/A1-L09/engineering-proof-review.md). Root owns later integration and live product/H1 gates. |
