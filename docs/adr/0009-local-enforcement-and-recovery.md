# ADR 0009: Local isolation, durable ownership, and conservative recovery

- **Status:** Accepted for the local seed; complete succession still requires integration evidence.
- **Recorded:** 2026-10-08.
- **Requirements:** R09, R14–R19, R22; P03, P05, P07–P14.

## Context

Docker's daemon is unavailable on the development host. An ordinary subprocess would retain access to lived experience, credentials and release controls. Separately, restarting a coordinator while its predecessor still runs can duplicate work, and a network timeout does not prove an outgoing message failed.

## Decision

Use a deny-by-default macOS Seatbelt profile for disposable code execution. Permit only trusted executables, necessary OS libraries, explicit reads and scratch writes. Deny networking and arbitrary child processes. Unsupported platforms fail closed. The actual filesystem, symlink, network, process and cancellation restrictions are tested; see [isolation](../isolation.md). This does not provide hard memory, disk or CPU quotas.

Acquire an exclusive SQLite transaction in a separate external coordinator lock database before recovering interrupted work. SQLite releases ownership on process termination. Do not infer death from an old timestamp or automatically recover tasks whenever a storage object opens.

Journal outgoing effects before delivery. An uncertain result enters reconciliation and cannot be replayed automatically. Persist inference results before attempting delivery, so a known result can be resumed without another model call. Persist task completion and its episode atomically. Terminal task and growth outcomes are immutable.

Debit a growth experiment's configured call allocation atomically before inference. A failed or interrupted call is not refunded. Pause for new allocation rather than silently refill a counter. Store stable lesson publication identities independently of memory contents so recovery cannot resurrect a forgotten lesson. Follow-up experiments initially receive no allocation; a later explicit scheduling policy must bound replenishment.

Keep all operational databases, journals, growth records, procedure registries, candidate runs and lived memory outside Git. Resolve repository and storage symlinks, including dangling database-path ancestors, before writes. API keys are not enumerable runtime configuration fields and are omitted from diagnostics.

## Alternatives and consequences

Waiting for Docker would delay local restriction checks without adding evidence. Running unconfined would fail the candidate boundary. Seatbelt is a narrow platform-specific choice that must be retested after OS/runtime changes. Portable isolation and hard resource quotas remain future work.

The single-host coordinator lock avoids an unnecessary distributed lease protocol. It does not replace generation-specific capabilities and epochs at effect receivers. Those remain mandatory before live succession. Logical forgetting is not forensic erasure of every database copy or provider record.

A provider outage is not itself a failed release. Recovery must use deterministic health signals and current external state, under a new authority epoch. The upcoming custodian implementation must prove this with actual worker processes; mocked launch callbacks alone are insufficient.
