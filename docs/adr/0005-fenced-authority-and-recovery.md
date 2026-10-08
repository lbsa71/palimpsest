# ADR 0005: Transfer one production authority and preserve current history

- **Status:** Proposed.
- **Recorded:** 2026-10-08.
- **Source:** Handoff, fencing, and rollback proposals in the [source analysis](../research/source-analysis.md).

## Context

A paused predecessor may resume after handoff and attempt production actions. Restarting an old container alone neither revokes stale authority nor reconciles interrupted work. Restoring an old database would discard the agent's newer experiences and commitments.

## Proposal

The custodian owns a durable, monotonically increasing execution epoch. Receiving tool, storage, and message boundaries enforce the current epoch together with authenticated process identity and scope. Only one generation holds production authority at a time.

Checkpoint work and reconcile in-flight operations before reassignment. Bring the successor up to date with messages, corrections, cancellations, and commitments received during evaluation. Apply current forgetting and access-scope decisions to snapshots and derived context before either cutover or restoration, so stale context cannot resurrect disallowed material. After promotion, the predecessor observes read-only during bounded probation.

Rollback restores known-good executable code under another fresh epoch and retains current memory and task history. For example: A at 41, B at 42, restored A code at 43; neither 41 nor 42 becomes valid again. Retain runnable releases after process retirement.

Provider outage alone must not trigger rollback or repeated release switching. Retain the release, pause or bound inference work, and continue available deterministic operations. Actual runtime failure remains a separate recovery trigger even during an outage.

If known-good recovery fails, use bounded retries, quarantine unusable releases from automatic selection, retain diagnostics, and enter an explicit recovery-required condition with a separate operator/rescue route. Do not oscillate indefinitely between releases or claim healthy production before verification. These are proposed mechanics; retry limits, failure classification, and formal state names remain open.

## Consequences and limits

Fencing cannot undo actions already accepted by an external service. Unknown outcomes need reconciliation and must not be replayed blindly. “Atomic authority transfer” cannot imply a global transaction with external systems.

A transactional local authority record, potentially SQLite on a single NUC, was suggested; neither database nor host topology is selected. Cutover crash recovery, idempotency, incompatible schema migrations, probation criteria, and recovery triggers need specifications and failure tests. Recovery must function without the agents, model provider, or MCP transport. See [Skin Shed](../protocols/skin-shed.md).
