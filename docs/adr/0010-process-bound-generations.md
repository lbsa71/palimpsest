# ADR 0010: Restricted generations with trusted effect receivers

- **Status:** Accepted for the local seed; live cognitive succession is verified separately.
- **Recorded:** 2026-10-08.
- **Requirements:** R09–R19, R21–R22.

**Subsequent scope refinement, 2026-10-09:** [ADR 0019](0019-coding-autonomy-and-reusable-agent-plumbing.md) requires full-codebase authoring and autonomous component-specific upgrade routes. The cognitive-only permission below describes the current local implementation. P17/P18 must broaden that implementation while preserving current receiver authority, separate old-rule admission and an older rescue for governance/custodian changes.

## Context

A model's role label cannot establish authority. A successor must be able to fail while both the predecessor observer and inference are unavailable. Initial isolated jobs proved filesystem restrictions, but did not establish a running generation, a responsive operator interface, or receiving-boundary checks on late results.

## Decision

Run each generation's cognitive module behind a restricted Node worker and a trusted private JSON-lines bridge. The parent retains provider credentials, stores, communications and release controls. Bind custody to actual child PID plus a fresh launch identity; opaque in-memory handles cannot be reconstructed from model text. Persist authority epochs and transition/launch/stop intent in an external custodian journal.

Verify authority at tool, storage, memory and message receivers, including after asynchronous work. Reject results from a closed worker even before the next health poll. The main worker is bound to the authorized local continuity scope. Other conversation scopes use fresh restricted processes, so candidate module globals and staged snapshots cannot cross conversations. Health probes receive synthetic empty context and execute source behavior without inference.

An interview snapshot does not stop incumbent work. Cutover quiesces all task and command effects, reconciles uncertainty, catches up current state, fences the predecessor, and grants a new epoch. Correction/forgetting/access-policy changes invalidate stale interview approval. Status, cancellation and correction commands share durable task/effect records and remain responsive during ordinary inference.

Recovery stops or reconciles previously launched processes, verifies a retained known-good artifact, obtains current state, starts a restricted worker, probes behavior and grants a new epoch. Startup failure, explicit crash and hang are tested with real processes and with the observer/provider absent. A failed fallback has bounded retries, quarantine and an explicit recovery-required state. Uncertain health observations alone do not prove a bad release. Interrupted launch/stop intent cannot be discarded to make recovery appear successful.

Normal candidates may change only cognitive source under `src/agent/`. Admission/runtime controls, trusted tests, dependency/toolchain contracts and rescue remain protected. Full custodian replacement is disabled; its separate upgrade contract must retain an older rescue mechanism and pass dedicated failure tests before enablement.

## Consequences

This keeps the mechanical parent larger than a bare process launcher but smaller than a cognitive agent framework. Fresh processes for nonlocal conversations trade latency for enforceable context separation. The current worker lifetime is bounded to five minutes; the serving supervisor mechanically renews expired workers through recovery and a new epoch. Tasks retain finite call allocations across this restart. Catch-up input frames permit the custodian’s existing 1 MiB snapshot allowance plus 4 KiB of metadata; ordinary requests retain a 256 KiB limit. Aligning these bounds was necessary when the first live Slack setup accumulated history above the ordinary request limit. History is transferred intact, with scope/sequence checks unchanged.

The restriction is still local macOS Seatbelt, with the limitations in ADR 0009. Current data/schema version is fixed at 1; ordinary candidates cannot migrate it. Candidate and known-good bytes live externally. Retiring a process does not erase its release or history. Real model review and the self-authored pushed change require their own evidence beyond deterministic transition fixtures.

The [first live release](../self-improvement-2026-10-08.md) subsequently verified the model-originated source, review, protocol, cutover and probation path. It also demonstrated why these layers stay separate: syntactically valid interview messages can still offer weak questioning, while two compiling authoring proposals failed independent behavioral gates. Protocol validity is not a complete measure of cognitive continuity or judgment.
