# A1-L09-T03/T05: bounded whole-host source succession

2026-10-11. Engineering evidence, not product qualification or complete RW14 acceptance.
Implementation: `e704a07` on `codex/a1-whole-host-20261011`, integrated by the lead as `993454f`.

## Behavioral result

`deployment/cli.ts launch HOST_CONFIG` runs a verified frozen launcher and coordinator. A control candidate's service enters probation while the incumbent coordinator and admission implementation continue judging it. Fresh probation acceptance under the retained prior policy commits the new release before requesting host replacement. Pending handoff prevents another concurrent release operation.

The incumbent closes controls, withdraws authority, stops its service and releases the coordinator lease. The launcher uses `execve` to replace itself with the accepted candidate's frozen launcher and CLI. That launcher starts the candidate coordinator, which obtains the exclusive coordinator lease and recovers the accepted service against the current operational directory. Coordinator PID and loaded module URL are visible in host status. No ancestor coordinator remains serving.

A host-private durable selection records the accepted target, retained old target and boot phase. An interrupted post-accept selection is reconstructed from the committed release journal. A failed successor coordinator selects the retained old host and service; a launcher that fails before startup leaves a pending boot marker so the retained bootstrap selects old code on the next process-manager restart. Recovery restores only a target previously accepted in the release journal, retains its admission evidence IDs, reconciles against the actual monotonic authority ledger, and does not restore a memory snapshot. The unattended fallback is bounded to one retained target.

## Verification

Pinned runtime: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (Node 24.13.0).

- `npm run check`: pass.
- `npm run build`: pass.
- `node --test deployment/host-successor.test.ts deployment/supervisor.test.ts packages/release/controller.test.ts`: 14/14 passed before the final dedicated launcher-crash case was added.
- Final `node --test deployment/host-successor.test.ts` rerun before adding the third case: 2/2 passed (60.9 seconds). These tests verify actual new admission behavior, different coordinator PID, the launcher's changed frozen command line, the stopped predecessor, fresh prior-policy probation, failed coordinator startup, absent signer/evidence/provider inputs during recovery, retained old source execution, monotonic authority and exact latest operational state including an unresolved effect record. Zero physical model requests were recorded in the state-preservation case.
- `node --test --test-name-pattern='broken accepted launcher' deployment/host-successor.test.ts`: 1/1 passed (21.0 seconds). The dedicated launcher-crash case verifies an accepted launcher failing before coordinator startup, followed by offline retained-bootstrap recovery with no surviving predecessor coordinator.

These are real frozen-process engineering fixtures with fixture-authored signatures. They do not establish independent model competence, model-authored self-improvement, product-policy evaluator qualification, or live deployment. Fresh independent implementation review remains the lead's integration gate.

## Explicit remaining scope

The finite task implements source/coordinator/evaluator/launcher succession. It does **not** complete all RW14 requirements. The physical `HostBindings.nodeBinary` remains pinned; replacement runtime binaries need a separately staged, bounded, artifact-bound registry and coordinated materialization/service-process changes. The installed root-owned initial bootstrap and `ExecStartPre` remain the non-serving startup/recovery trust anchor. Their eventual policy-governed replacement is still required; this work must not be described as making them permanently human-only or already autonomously replaceable.

The installation must use `launch`, not standalone `supervise`, to enable whole-host succession. Standalone `supervise` retains the prior embedding/test behavior. Process-manager restart is required if the new launcher itself fails before it can perform fallback. Existing installation resource confinement and state-volume bounds remain separate acceptance evidence. Recovery assumes accepted host code has preserved the durable journal/schema; arbitrary destructive accepted host code is not repaired by code selection alone.
