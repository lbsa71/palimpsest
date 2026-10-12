# P3-R1 owner current-use fence repair

2026-10-12. Owner `/root/a1_development_owner_fence_repair`, isolated branch `codex/a1-development-owner-fence-repair-20261012`, base `1c9dd8e28e8fb5c82a87cb9efd04d100ac835df2`. Actual finite tool goal created before inspection. Execution claim and A1-L08 lane are read only. Exclusive writes are `packages/storage/index.ts`, NEW `packages/storage/test/development-owner-read-fence.test.ts`, `evaluations/development/acquire.ts`, NEW `evaluations/development/current-use-owner-fence.test.ts`, and this NEW evidence file. Existing tests are read only.

## Frozen behavioral contract before code

1. A narrow public synchronous storage read-only scope reuses the existing private development read fence and existing write assertion. Ordinary nested read transactions are allowed; every public mutation and close refuses before mutation. Reentry and object/function thenables refuse. Throw restores the fence so later ordinary writes succeed.
2. During either acquisition profile's caller current-use/read callback, actual owner, custodian, original ledger and attached captured role stores are read-only. Deduplicate actual store instances already fenced as historical sources. Direct store writes and trusted withdrawal invoked inside the callback refuse before subsequent bytes release. Callback refusal preserves current evidence and inventory.
3. V1 captures and validates full current snapshots before installing its callback fence, because snapshot capture forbids development fence reentry. Paged source historical validation retains its existing fences. Neither path fabricates journal metadata or changes capacities, signatures or witness contracts.
4. Source/custodian withdrawal observed during entry stops callback invocation. Persist terminal disposition only after guards exit, including a custodian status change between the initial and guarded authority checks. Source refusal remains conservative if terminal persistence fails.
5. Preserve final-cut publication and new raw retention writes outside public read callbacks, synchronous provider promise initiation whose promise settles after guard exit, and authentic pending original response maintenance after withdrawal. No async fence or new lock service.

Independent imported P3 evidence is unchanged: 50 cases,48 pass,2 causal failures,0 skips (author29/29; independent19/21). Its two reds commit owner mutation and a signed withdrawal followed by1,501 bytes released. A post-callback authority check alone fails this contract.

Validation uses pinned Node24, real small SQLite stores and in-process module mocks. No provider/network/native/physical/private credentials/Slack/full benchmark/push/deploy. Root separately owns old v1 snapshot capacity inquiry; preserve its known compact failure and do not edit caps/assertions.

## Implementation and preserved attempts

Freeze revision `dec2888`; exact source/test revision `bcd5921`. Storage exposes only `withDevelopmentReadOnly`, delegating directly to its existing private read fence. The recorder shares one deduplicated owner/original/custodian/source callback scope across both profiles. V1 still validates full snapshots inside ordinary transactions before entering the read scope. Paged historical source gates remain unchanged; already fenced source instances are omitted from the additional owner/original scope. No final-cut publication source or response-retention maintenance path changed.

Authority checks inside the scopes observe without writing the custodian marker. An entry withdrawal persists its signed marker after transactions/fences unwind. Paged historical storage gates wrap callback errors as source corruption; the recorder preserves the actual authority/callback refusal so thenables and custodian entry races do not invalidate current evidence. V1 owner transaction reentry refuses before recursive snapshot validation can mistake its development fence refusal for graph corruption. Ordinary source accounting outer transactions and nested callback read transactions still compose, as exercised by the regression suites.

- Baseline unchanged causal subset: `/tmp/p3-r1-before.log`,2 cases,0 pass/2 fail,0 skip/cancel,exit1,5.262s. Observed diagnostics were `{"disposition":"withdrawn","refusal":null,"releasedBytes":1425}` and `{"committed":true,"refusal":null}`. The imported review's earlier1501-byte observation is preserved in its read-only evidence; this checkout reproduced the same causal release with1425 bytes. No byte/capacity assertion was changed.
- First repaired causal subset: `/tmp/p3-r1-causal-after.log`,2/2 pass,0 fail/skip/cancel,exit0,8.792s. Diagnostics: disposition null/releasedBytes0; committed false; both refuse with `ContractError: source writes forbidden during development fence`.
- New tests first attempt: `/tmp/p3-r1-new-tests-first.log`,15 cases,5 pass/10 fail,0 skip/cancel,exit1,14.467s. Five v1 setups omitted required accepted control bridge association; five paged setups omitted externally accepted P2 reviewer admission. These fixture errors were corrected in the new owned fixture; no old tests changed.
- New tests second attempt: `/tmp/p3-r1-new-tests-second.log`,15 cases,12 pass/3 fail,0 skip/cancel,exit1,12.804s. These exposed actual guard composition issues: v1 recursive callback entry attempted a marker inside its outer fence; paged thenable refusal and the new custodian entry race were wrapped as historical corruption. The source repair now preserves authority/callback refusals and rejects v1 owner reentry before snapshot validation.
- New tests third attempt: `/tmp/p3-r1-new-tests-third.log`,15/15 pass,0 fail/skip/cancel,exit0,26.707s. Final additional source-entry-race and uncaptured-original-ledger coverage: `/tmp/p3-r1-new-tests-final.log`,18/18 pass,0 fail/skip/cancel,exit0,31.290s. These are5 storage cases and13 current-use cases across v1 snapshot and v2 paged profiles.
- First strict check `/tmp/p3-r1-strict-first.log` and final strict `/tmp/p3-r1-strict-final.log` both exit0. `git diff --check` passes. Independent test SHA256 remains `9440ed0d7a5f2314d2128c2eaa84d16392379a190d4d6940db3c8fbfff265672`.
- Initial regression `/tmp/p3-r1-retention-regressions.log`:76/76 pass,0 fail/skip/cancel,exit0,24.263s. Initial P2 component run `/tmp/p3-r1-p2-components.log`:50 cases,49 pass/1 fail,0 skip/cancel,exit1,371.319s. It overlapped source refinement and is diagnostic only. The earlier-source independent callback lease case exposed the same hostile-thenable misclassification described in the second new-test attempt: expected synchronous refusal, observed document-history-corrupt-or-missing. Author29/29 passed; independent20/21 passed including both repaired P3 reds. An interim parent progress message incorrectly counted the diagnostic independent cases21/21 after overlooking that failing row; it was corrected promptly with the complete receipt. The source-stable final run is required for acceptance. Both exact final commands below run against unchanged `bcd5921` source/test content.

## Exact command manifest

All commands run in `/home/palimpsest/migration/aeon-1-20261011/development-owner-fence-repair`.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='scoped callback must refuse owner|shared public current-use' evaluations/development/review-projection-adapter-review.test.ts > /tmp/p3-r1-before.log 2>&1
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='scoped callback must refuse owner|shared public current-use' evaluations/development/review-projection-adapter-review.test.ts > /tmp/p3-r1-causal-after.log 2>&1
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 packages/storage/test/development-owner-read-fence.test.ts evaluations/development/current-use-owner-fence.test.ts > /tmp/p3-r1-new-tests-final.log 2>&1
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/development/acquisition-pages.test.ts evaluations/development/review-projection-adapter.test.ts evaluations/development/review-projection-adapter-review.test.ts > /tmp/p3-r1-p2-components-final.log 2>&1
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 packages/storage/test/development-historical-fence.test.ts packages/storage/test/development-historical-fence-review.test.ts packages/storage/test/journal-retention.test.ts packages/storage/test/journal-retention-review.test.ts evaluations/development/acquisition-retention.test.ts > /tmp/p3-r1-retention-regressions-final.log 2>&1
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check > /tmp/p3-r1-strict-final.log 2>&1
git diff --check
git diff 1c9dd8e --name-only
sha256sum evaluations/development/review-projection-adapter-review.test.ts
```

The first/second/third new-test attempts use the same two-file Node command, with their named log destinations. The initial P2 and retention attempts use the same respective final command with their destinations above. The initial strict attempt uses the same strict command with its named destination. No broad old model fixture, physical child fixture, full126/156 trace, provider qualification or H1 check was run. Root's unchanged compact-capacity failure remains outside this repair and is not waived. Fresh re-review belongs to root after this finite handoff.

## Final source-stable receipts and handoff

At exact source/test commit `bcd59210a55d3e79aef889d2f90e1fa5b899715a`:

- Unchanged three-file P2 component `/tmp/p3-r1-p2-components-final.log`:50/50 pass,0 fail/skip/cancel,exit0,343.001s. This is author29/29 (18 paged recorder +11 adapter), independent21/21. Both original P3 causal assertions refuse before bytes/mutation, with releasedBytes0, disposition null and committed false.
- New two-file owner fence tests `/tmp/p3-r1-new-tests-final.log`:18/18 pass,0 fail/skip/cancel,exit0,31.290s.
- Unchanged five-file storage/historical/retention regression `/tmp/p3-r1-retention-regressions-final.log`:76/76 pass,0 fail/skip/cancel,exit0,43.763s.
- Final strict exits0; final `git diff --check` exits0. Independent tests retain their exact original SHA256. Changes relative to base are exactly the five reserved paths.

The final regressions exercise committed final-cut publication, ordinary role accounting outer transactions, source/custodian entry-race marker persistence, rollback/refusal without evidence invalidation, one-use mock review, original inventory charge deduplication and authentic late response settlement after withdrawal. All failed attempts above remain evidence. Timings do not imply performance qualification.

Bounded disposition: **implemented and fixture-verified P3-R1 repair**, finite owner goal complete. Freeze `dec2888b81489cb0f85789d2b77bd691037c9adc`; source/test commit as above; final evidence commit is this document's enclosing handoff revision. Root owns integration and fresh independent re-review. No live competence, full workload, broad old v1 capacity acceptance, autonomous-use qualification or H1 claim follows. This handoff does not wait for later review.
