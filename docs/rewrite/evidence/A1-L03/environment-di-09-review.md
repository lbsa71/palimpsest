# DI09 independent storage review

Reviewer `/root/a1_environment_storage_review`; branch `codex/a1-environment-di-09-review-20261012`, base `be91168`; reviewed source `39d995b` imported as `af817a9`, author precode `12bdc1b`. Governing inputs read: AGENTS, REQUIREMENTS, PLAN, workflow, A1-L03, DI01 and final execution claim. Exclusive writes are this new evidence and `deployment/environment-di-09-review.test.ts`; source and every prior test remain read-only. Actual finite tool goal created before this precode. Runtime pinned to `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`; only ignored dependencies symlink to main, no install.

```text
/goal Independently challenge the DI09 storage boundary with explicit ports and controlled real in-process SQLite, preserve existing failures, rerun required serial checks, and deliver a clean two-path source acceptance or changes-required disposition without repairs or waiting.
```

## Independent criteria frozen before new test code

Challenge callback capture/receivers and independent instances; physical containment for aliases and absent descendants; acquisition and exceptional cleanup including exact non-Error identity; actual transaction effects before errors, including BEGIN, SAVEPOINT, RELEASE, COMMIT and ROLLBACK; uncertain handles must not expose or accept additional SQL, caught inner rollback failure cannot commit or release pending state, successful full rollback restores use. Probe statement callback acquisition failures independently of ordinary statement invocation. Journal ID collisions must not overwrite deleted or withdrawn history and actual WAL/FULL/CAS/reopen must preserve all committed state. Existing source limits, owner/control guards, captured source fences and original predicates remain unchanged.

Required serial checks: authored35 in `deployment/environment-di-09.test.ts`; downstream50 in exact DI03 author/reviewer and current-use owner author/reviewer files; enumerated old199 from all twelve named storage files in author evidence; meaningful new cases; strict compile and diff. Prior files and launch exclusions inspected: no actual process/crash, network, listener, provider, native confinement, private credentials, Slack, full benchmark or deployment. Existing source-bound measurement mocks remain read-only; new cases use explicit ports only. The two old application failures remain preserved; independently inspect first allocation versus later elapsed-floor writes and page accounting without claiming a reopen failure or changing fixture expectations. DI14, DI27, DI28 and live/H1 remain separate gates.

## Disposition: changes required

Independent precode commit `cef4b88` preceded all new test code. One source finding blocks bounded DI09 acceptance. Source and every prior test remain unchanged. The final review commit contains exactly the two reserved new paths; root owns source repair and fresh re-review. This finite review is complete independently of that repair.

### R1 — P1: a lost BEGIN receipt strands acknowledged artifact writes

`packages/storage/index.ts:169` executes BEGIN/SAVEPOINT before entering the transaction try/catch. The injected `exec` can execute actual SQLite `BEGIN IMMEDIATE` and then throw an arbitrary value, exactly as the accepted COMMIT adapter can report failure after committing. In this case the Store neither rolls back nor marks uncertainty. Its logical depth stays zero while the real SQLite handle still holds a transaction. `putArtifact` subsequently returns a successful artifact reference; close rolls the untracked transaction back, and reopening fails `readArtifact` with `missing artifact`. This violates durable acknowledgement and the stated uncertain-handle fence.

Held-out case `DI09 review error after actual BEGIN must recover or refuse subsequent artifact acknowledgement` reproduces this without modifying any global, module, source method or old test. Diagnostic receipt: `{"acknowledged":true,"nativeTransaction":true,"logicalTransaction":false}`. The primary non-Error object is preserved and the callback body does not execute. The test accepts either verified recovery (later acknowledged artifact survives reopen) or explicit uncertainty refusal (no acknowledgement). It does not demand a particular implementation. Current source fails at the post-reopen read, not at an artificial expected error message.

Required repair: include transaction setup in outcome handling; on possibly effected setup failure, establish successful cleanup before admitting further operations, or refuse the uncertain handle until close. Preserve exact primary/cleanup values, nesting/depth and existing positive before-BEGIN failures. Extend meaningful tests to before/after setup and cleanup failures while keeping this red unchanged. No repair was made by this reviewer.

### Positive boundary evidence

Fourteen held-out cases pass. They establish acquired exec/prepare selector failure cleanup exactly once with non-Error cause identity; each get/all/run statement-selector failure rolls back actual journal/document writes; containment traversal captures filesystem callbacks despite callback replacement; actual SAVEPOINT followed by throw remains fully rollbackable; actual RELEASE followed by throw makes the caught inner failure uncertain, blocks continuation and allows confirmed full outer rollback; actual COMMIT/ROLLBACK followed by non-Error throw preserves uncertainty, both original failure identities and real reopen disposition. Colliding with a deleted or withdrawn historical version cannot overwrite retained payloads, including across reopen. Controlled real SQLite retains WAL/FULL, second-handle stale CAS refusal and native rollback.

The unchanged author35 additionally cover receiver-free database/statement callback capture, missing descendant and alias containment, initial schema acquisition and close failures, ID invocation errors, caught inner rollback failures and full rollback recovery, after-COMMIT uncertainty, bounded cut/owner fences, withdrawal and open connection identity. The unchanged199 storage plus downstream50 retain original bounded scalar/page/marker/source, historical/owner/current-use and control predicates. Diff review confirms no bounded constant, own-property integrity allowlist or owner/control source changed by DI09 or this review; DI09 uses actual private fields compatible with the existing Store allowlist. Passing mechanism checks do not override R1.

## Independent diagnosis of preserved fixture gates

The exact original storage suite remains **197/199**, with zero skips/cancellations. The two failures are preserved, not excused as green:

1. `packages/storage/test/development-pages.test.ts:327`: `actual application complete pages cover twelve offline admissions: separate-conversations` reports actual603/expected551. Its same-message-revisions counterpart passes. Its later expected first full-snapshot refusal at admission8 is not reached; diagnostics show admission7. No capacity was widened and no source rows were dropped.
2. `packages/storage/test/document-journal-review.test.ts:147`: `actual application binds before initial allocation and omitted-option reopen retains its anchor` compares first allocation payload revision1/floor0 with current revision2/floor6 in this run. This assertion occurs before the test's close/reopen; no reopen defect is inferred from this failure.

Independent causal positive `DI09 review controlled elapsed-floor causality adds 52 physical rows and retains first and current allocation revisions` constructs two real journal Stores and ResourceLedgers under explicit clocks. Thirteen child allocations with clock progression versus the same allocations at constant time add exactly52 physical rows. Each observation updates two existing documents (root allocation and budget), adding a historical payload and event per update:13 ×2 ×2 =52. Current document/head rows are updated, not added. The progressive fixture retains all14 root allocation versions: first revision1/floor0 and latest revision14/floor13. Latest payload equals current; first correctly differs. Its complete snapshot survives actual close/reopen unchanged. This directly exercises `ResourceLedger.allocate(parent)` → `observeElapsed(..., true)` and supports the author diagnosis without modifying old source, fixtures or predicates.

Source inspection ties the application cases to the same mechanism: constructor creates `initiative:ordinary` beneath the operating envelope; separate conversation admissions allocate further children. The old assertion selects `.find(...)` (first mutation), not the final retained mutation. Author evidence reports both same failures against exact original storage `3fe646f`; this review did not repeat source substitution because all source is read-only. The independent deterministic causal proof and unchanged rerun are separately observed evidence. DI27 must own any justified fixture update and review remaining assertions after those updates; neither case is accepted or waived here.

## Exact serial validation

Pinned executable v24.13.0 and existing TypeScript7.0.2, no install. New fixtures use explicit ports and controlled local in-process SQLite only; normal experimental SQLite warnings remain. All twelve old storage files and the four downstream files are the exact finite inventory frozen in the author evidence; launch search found no spawn/execFile/fork/listen/fetch calls in these selected files. No physical recovery or broad test runner ran. Exact commands, in execution order:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-09.test.ts > /tmp/environment-di09-review-author.log 2>&1
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-03.test.ts deployment/environment-di-03-review.test.ts evaluations/development/current-use-owner-fence.test.ts evaluations/development/current-use-owner-fence-review.test.ts > /tmp/environment-di09-review-downstream.log 2>&1
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 packages/storage/test/storage.test.ts packages/storage/test/storage-bounds.test.ts packages/storage/test/storage-bounds-review.test.ts packages/storage/test/document-journal.test.ts packages/storage/test/document-journal-review.test.ts packages/storage/test/journal-retention.test.ts packages/storage/test/journal-retention-review.test.ts packages/storage/test/development-pages.test.ts packages/storage/test/development-pages-acceptance.test.ts packages/storage/test/development-historical-fence.test.ts packages/storage/test/development-historical-fence-review.test.ts packages/storage/test/development-owner-read-fence.test.ts > /tmp/environment-di09-review-storage.log 2>&1
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-09-review.test.ts > /tmp/environment-di09-review-heldout.log 2>&1
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit > /tmp/environment-di09-review-strict.log 2>&1
git diff --check
git diff --name-only be91168 HEAD
git status --short
```

| Check | Result | Exit |
|---|---|---|
| Authored DI09 |35/35;708.716ms|0|
| Selected downstream |50/50;24,497.836ms|0|
| Unchanged storage |197/199;14,566.778ms; two exact fixture failures above|1|
| Independent held-out |14/15;548.966ms; R1 only|1|
| Strict TypeScript |No diagnostics|0|
| Diff whitespace |Pass|0|

All tests have zero skips, cancellations and todos. No earlier held-out or compiler failure is omitted: the first held-out run produced exactly R1 and the first strict compile passed. Raw local receipts remain at the exact `/tmp` paths above. Only evidence text was appended after validation; no test/source change required rerunning the checks.

## Handoff and open gates

Root receives an exact clean two-path **changes-required** review. Repair R1 and obtain fresh review before bounded DI09 source acceptance. Retain both unchanged application failures for separately claimed DI27 fixture work. DI14 production/application port wiring, DI28 whole active closure, actual process/crash recovery integration, live/H1 and deployment remain open separate gates. In-process reopen proves neither process-kill recovery nor live provenance. No authorization or acceptance is inferred from test counts.
