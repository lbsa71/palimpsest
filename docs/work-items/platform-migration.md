# Operator platform migration

Status: bounded implementation verified with eleven migration fixtures, five publication fixtures, 21 existing custodian tests and the integrated CLI startup guard on macOS. Native Linux confinement, actual copied-state recovery and sealed service cutover are now separately verified in the [migration acceptance report](../migration-acceptance-2026-10-10.md); final preservation/cleanup remains a separate operation. This is the user's explicitly authorized move from the stopped macOS installation to the dedicated Linux host, not autonomous P18 environment evolution.

## Problem and boundary

Existing custody binds its known-good release to Darwin Node/compiler bytes and an absolute toolchain path. Ordinary recovery and host-baseline installation cannot reinterpret it as a Linux release. A copied operational database must retain memory, tasks, delivery deduplication, uncertainty and all spent budgets.

The trusted offline importer accepts a copied external state directory and an operator shutdown attestation bound to its inventory digest. The attestation is evidence about the source host; observing a PID absent on the destination is insufficient. Original custody, events, releases and evidence remain an immutable archive. Import copies the complete operational database without changing its records, retains custody history, and appends an explicit migration transition under a later epoch. A newly evaluated native baseline must preserve the admitted cognitive digest, frozen configuration/model and every protected check, including the current three-check minimum.

## Expected behavior

- Import into a new private destination only, under exclusive destination ownership. A durable migration gate blocks ordinary startup until independent cold recovery succeeds. Failures retain a held destination and never report readiness or remove source material.
- Require a normally serving source known-good identity, no ambiguous custody launch/stop/installation, no unresolved effects, and no running work. Reject unfinished evolution, publication, proposed/queued development or candidate/workspace ownership that this bounded importer cannot safely relocate. Paused historical authoring attempts remain unchanged and spent; any future attempt uses the existing finite attempt and allocation policy.
- Publication blockers follow the actual reconciler: a finished promoted evolution queue item remains pending unless its latest publication result is published. A standalone historical promoted report with neither queue work nor publication intent is archival evidence, not invented pending work. Independently reject recorded Git reservation/preparation/push intents until a later exact completion or published result settles their candidate, target and recorded commit; uncertainty, a different target/commit or a later new intent cannot be erased by an older success.
- Verify the complete archive inventory, original known-good manifest/source bytes and retained Git base closure. Archive integrity does not establish current native runtime compatibility. Never rewrite old manifests, approvals, reports or paths to make them runnable.
- Evaluate a fresh native baseline using trusted current checks. Import custody through a dedicated operator API, unavailable to cognitive tools. Only this new release becomes the destination known-good; historical Darwin artifacts remain lineage evidence and are never selected as its platform fallback.
- Reopen the new custody in a separate provider-free verification operation, start/probe/close an actual restricted worker and repeat from cold custody. Preserve all operational records throughout. Record the exact new release and increasing epochs before opening the startup gate. This establishes one independently tested native recovery baseline, not cross-platform execution of historical releases.
- Idempotent retries identify the exact snapshot and destination. A completed import is inspected rather than replayed; a partial import is held for explicit operator disposal/retry in a fresh destination. No cleanup or network/provider operation is part of this command.

## Acceptance

1. A synthetic file-backed source with scoped/versioned memory, task/effect records, topic outcomes and budget journal rows imports with an identical logical operational database, original archive bytes and original custody event prefix.
2. New custody has a later epoch and a native known-good with the identical admitted cognition/configuration/model; old artifacts remain historical. Cold recovery never attempts the old release.
3. Wrong shutdown binding, archive tampering, changed cognition/configuration, missing checks, failed evaluation, ambiguous source ownership or unsupported pending work cannot open the gate or grant authority.
4. A failed or interrupted import leaves source bytes intact and destination blocked. Exact completed retries make no new migration transition. Conflicting retries fail.
5. Real confined worker recovery twice, with a provider that throws on any call and without draining tasks, precedes readiness. Its operational database remains logically identical and its final custody can recover normally on another restart.
6. Standalone promoted history without queue or Git intent remains byte-preserved and does not block import. Actual queue-promoted unpublished work and independently unresolved Git intents still block, including missing queue history, uncertain results and mismatched or superseded completion evidence.

## Dependencies, non-goals and risks

Linux confinement and native candidate collection are implemented separately. The CLI/service must enforce the migration gate before ordinary startup. Operator and peer API tokens are copied as opaque private bytes, retaining their identities. Provider/Slack credentials and effective destination settings are provisioned separately: before production startup the operator must verify the configured provider/model, task/growth/evolution/plan limits, cadence, timeout and communication/author allowlists match the intended retained configuration. The importer never reads the credentials file. It freezes the original manifest's configuration and model exactly; that does not itself prove the later server's effective private configuration matches.

This work does not deploy/start production ingress, reconcile unknown external effects, change budgets, rebase unfinished coding work, delete the old machine, or complete general retained-environment support. SHA-256 inventory binding detects changes; it does not authenticate an untrusted operator attestation. The authorized operator remains responsible for proving shutdown on the source host and keeping it stopped after export. Original SQLite WAL content must be included in the offline snapshot; logical SQLite backup must preserve every table and row. Paths and native prerequisites remain part of destination runtime identity.

## Operator interface

After installing the reviewed native implementation and its dependencies at their final paths:

```sh
node scripts/platform-migration.ts inspect /absolute/offline-snapshot
node scripts/platform-migration.ts import /absolute/repository /absolute/offline-snapshot /absolute/new-data-dir /absolute/shutdown-attestation.json
node scripts/platform-migration.ts verify /absolute/repository /absolute/new-data-dir
```

The attestation is JSON with `version: 1`, `snapshotDigest` from `inspect`, `sourceHost`, `sourcePlatform`, the observed source `stoppedAt` ISO timestamp, `evidenceDigest` (SHA-256 of independently retained source-stop/transfer evidence), `sourceStopped: true`, and `keepStopped: true`. The destination's parent must already exist. The imported directory is created atomically with a private closed `platform-migration.json` gate. `import` creates a byte-preserved `migration-archive`, complete logical SQLite backups, API token copies and the new frozen release. Failed partial imports remain held; retain their evidence and retry into a new directory. Exact completed imports are inspected idempotently rather than repeated.

`verify` runs no inference or communication and never drains queued tasks. It closes each worker/coordinator before reopening the same native custody for the second recovery. Only then does it persist `status: ready` with both increasing epochs. Ordinary CLI integration calls `assertPlatformMigrationReady(config.dataDir)` before `prepareState` or Store/custody construction; the service installer/launcher must use the same gate. A ready marker is migration evidence, not a substitute for ordinary manifest/toolchain/startup verification.

## Recorded verification

The initially unavailable migration API failed its new integration test. The implemented fixture now uses real candidate freezing, native protected checks and two actual restricted-worker cold recoveries, with a provider that throws on any call. Synthetic pending conversation outcomes/reflections, a queued task, confirmed delivery, corrected and forgotten memories, growth-window usage, development/evolution debit events, opaque API tokens and the complete original custody event prefix survive. Separate cases reject shutdown/snapshot mismatch, unsupported unfinished work, unknown effects, changed cognition, failed native checks and artifact tampering. A custodian fixture retains old operator-baseline history and proves failed new-platform recovery only launches the native release; the old restore operation remains bound and rejects the historical installed ID.

`node --test test/platform-migration.test.ts test/custodian.test.ts` passed 29/29; the final populated-state migration suite passed 8/8 separately. `npm run check` and `git diff --check` passed. These are disposable macOS-host fixtures with an explicitly synthetic incompatible historical runtime, not a claim that Linux or real copied state has already passed. The lead must record actual Linux checks and cold recovery against the exact imported baseline before source cleanup.

The integrated CLI gate now runs after the read-only `doctor` early return and
before any state-opening command constructs storage. Its actual-process check
passes for `tasks`, `memory`, `growth`, `init`, `ask`, `serve` and host-baseline
preparation with a held receipt, preserving the unopened directory. The prior
CLI reproduced the defect by successfully opening `tasks` despite that receipt.
The new check passed 1/1 and strict TypeScript passed; RED/GREEN logs are retained
outside Git. This verifies startup gating, not destination readiness.

The publication classification repair first failed all three new fixtures: standalone promoted history was falsely blocked, queue-promoted work without a separate report was missed, and Git intents without queue history were missed. The corrected implementation passed `node --test test/platform-migration.test.ts test/release-publication.test.ts` (16/16), typecheck and whitespace checks. Queue expectations come from the real scheduler/reconciler selectors; intent cases cover exact completion, independently observed publication without a completed event, uncertainty, different candidate/target/commit and later reservations. Independent source review found no remaining blocker. These checks use synthetic disposable state and perform no provider, network or live-state operation.

