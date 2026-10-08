# ADR 0012: Queued background evolution with a separate durable allocation

- **Status:** Accepted and fixture-verified implementation choice; live model-originated release evidence remains separate.
- **Recorded:** 2026-10-08.
- **Requirements:** R01, R13–R19 and the standing growth mission.

## Context

Serving growth already records source proposals, but the CLI does not send them through governed evolution. Running an entire release inside the scheduler's 30-second proposal callback would outlive its deadline and deadlock when cutover waits for that same scheduler to stop.

## Decision

The callback only enqueues the exact completed growth proposal in the external append-only journal. A separate trusted `EvolutionScheduler` claims a stable run and invokes the existing `EvolutionCoordinator`. Outcomes remain immutable. Interrupted claims are reconciled against recorded evolution reports; uncertain cognitive calls are not replayed.

Configure a separate finite UTC-day allocation with `PALIMPSEST_EVOLUTION_CALLS_PER_DAY`, default eight, with zero disabling new release inference. Debit each cognitive release call before invocation; restart, cancellation and failure never refund it. All roles use the same serialized configured provider with fresh review/interview contexts. Growth's four-call default remains separate. Models cannot change either allocation.

User work and unresolved effects prevent a new release. User arrival aborts cognitive work before fencing. After the fence, finish mechanical cutover/recovery rather than abandoning authority transfer. Queue work runs outside the proposal callback, so pausing growth cannot wait on its own caller. Suspend ordinary health ticks during a release and await any existing tick before starting; the evolution coordinator owns bounded probation observations. Health recovery can wait for bounded evaluation/provider work to yield. A dead or expired worker fails the receiving authority checks before another call or effect.

## Alternatives and consequences

Direct callback execution was rejected because of lifecycle deadlock and an insufficient deadline. Sharing four inquiry calls with release review would routinely strand interviews; a separately visible allocation makes the additional maximum explicit. Parallel custodian operations would require a broader transition gate and are deferred. The small queue keeps current serialized custodian semantics.

The queue does no Git writes, bypasses no review or protected check, and does not promise every proposal is admitted. Dirty source, unavailable models, insufficient budget, unknown effects and interrupted work can defer or decline an attempt. Frozen local promotion and operator Git publication remain distinct operations. Actual Slack delivery, live model quality and any specific improvement still require separate evidence.
