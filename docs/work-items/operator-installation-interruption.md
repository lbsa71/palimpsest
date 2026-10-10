# Operator installation interruption

Status: open, P1, 2026-10-10. Source review of collector integration `f7f4415`; no release acceptance. Applies to P12/P13, R17–R19 and [ADR 0024](../adr/0024-serving-responsive-candidate-collection.md).

## Problem and evidence

The CLI's stop handler aborts the signal supplied to Git publication, but `host-baseline install` does not pass that signal to `GenerationHost.installHostBaseline` or check stopping before installation. Stopping the runtime does not revoke the worker's custody authority. Host collection is aborted only when `host.close()` runs in `finally`, after the awaited installation returns. Source review therefore finds a reachable path where SIGTERM during verification can be followed by custody preparation, fencing and activation before cleanup.

The earlier full source run separately timed out the original operator installation command at its unchanged 20-second deadline; it produced empty successful output after SIGTERM. That observation does not by itself prove post-stop activation. An unchanged isolated rerun and the integrated source run's operator case pass. Neither exercises this interruption boundary. A direct reproduction of post-stop custody mutation remains required; do not count the source finding as a completed runtime reproduction.

Relevant receivers are [the CLI](../../src/cli.ts), [GenerationHost](../../src/generations.ts) and [Custodian](../../src/custodian.ts). The evaluator and custodian bytes remain unchanged by the collector correction.

## Expected behavior and acceptance

- Before transfer is committed, stopping prevents new collection stages and installation admission. Cancel positively owned work and retain ownership until actual drain; unknown cleanup remains held.
- Revalidate interruption at the queued custody boundary and after verification, alongside the existing incumbent and authority checks. A completed verifier is evidence, not permission to continue a stopped operation.
- After transfer has crossed its irreversible boundary, finish the necessary mechanical reconciliation or retained recovery. Do not abandon a fenced successor, rewind current memory, refund spent calls or replay an uncertain effect.
- Reproduce the pre-transfer race with the actual operator CLI and blocked collector, then show no new preparation/fencing/activation after the stop. Exercise interruption around transfer separately and verify recovery, current memory and exact release identity.
- Retain the original operator deadlines, assertions, protected checks, evaluator identity, grants, budgets and configuration. Report an interrupted command honestly rather than treating empty output as successful installation.

## Scope and completion

This requires an explicit operation cancellation contract across CLI, host collection and queued admission. The exact post-transfer reporting/recovery behavior must be specified before implementation. Dependencies are the existing custody queue, collector ownership/drain and original operator fixture.

Non-goals are Git discovery optimization, broader release authority, retained-environment implementation and general coding integration. The material risk is cancelling at the wrong phase and leaving custody fenced or cleanup unproven.

Done when actual failing behavior is reproduced, the phase-specific repair and recovery checks pass, independent review resolves the finding, and the installation contract and evidence agree. The source merge does not close this item or authorize deployment of the collector correction.
